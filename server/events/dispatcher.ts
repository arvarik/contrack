// =============================================================================
// The event dispatcher: subscribers, their cursors, and one dispatch loop
// =============================================================================
// A write records events in its transaction (record.ts) and calls
// `dispatchEvents()` after the transaction returns and before it reads its
// own answer. The dispatcher hands each subscriber the events of its types
// that it has not seen, in `id` order, and moves the subscriber's cursor in
// `event_cursors` past each one it handled.
//
// The rules:
// - A handler is synchronous and short. It schedules work (the index queue,
//   a job, a fire-and-forget promise) and does not run slow work.
// - A handler that throws is logged and retried from its cursor on the next
//   dispatch. After MAX_FAILURES failures on one event, that event is skipped
//   for that subscriber with an error log. A throw never undoes the write:
//   the write committed before the dispatch began.
// - A dispatch never starts inside another one. A handler whose own write
//   calls `dispatchEvents()` sets a flag, and the outer loop goes round again.
// - Called while a transaction is open (a write nested in another write), it
//   waits for a microtask, so it never reads rows that may still roll back.
// - A new subscriber starts from now: registration creates its cursor at the
//   newest event. Register before any write in the process, or the events
//   before the registration are not handed to it.
// - Boot catches up from the cursors, by calling `dispatchEvents()` once.
// =============================================================================

import type Database from "better-sqlite3";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import type {
  EventPayload,
  EventSubjectType,
  EventType,
} from "../../shared/contracts/events.ts";

/** One recorded event, as a subscriber receives it. */
export interface DomainEvent<T extends EventType = EventType> {
  id: number;
  ownerId: string;
  type: T;
  subjectType: EventSubjectType;
  subjectId: string;
  payload: EventPayload<T>;
  createdAt: string;
}

/** Any event, narrowed by its `type`. */
export type AnyDomainEvent = { [T in EventType]: DomainEvent<T> }[EventType];

/** A reaction to events. */
export interface Subscriber {
  /**
   * The key of its cursor row. Never rename one that has shipped: a new id
   * starts from now and skips every event before it.
   */
  id: string;
  /** The event types it receives. The others pass it by. */
  types: readonly EventType[];
  /** Synchronous and short. It schedules work and returns. */
  handle(event: AnyDomainEvent): void;
}

/** Tries per event before a subscriber skips it. */
export const MAX_FAILURES = 3;

/** Events read per query. */
const BATCH_SIZE = 200;

const registry = new Map<string, Subscriber>();

/**
 * Add a subscriber. Idempotent by id: the modules list the same subscriber
 * objects as the services that register them, and the first one stays.
 *
 * A new subscriber's cursor starts at the newest event, so it reacts to
 * writes from now on and never to the history before it.
 */
export function registerSubscriber(subscriber: Subscriber): void {
  if (registry.has(subscriber.id)) return;
  registry.set(subscriber.id, subscriber);
  sqlite
    .prepare(
      // The cursor table holds one row per subscriber for the instance.
      // tenant-lint: allow instance sweep
      `INSERT OR IGNORE INTO event_cursors (subscriber, lastEventId)
       SELECT ?, COALESCE(MAX(id), 0) FROM events`,
    )
    .run(subscriber.id);
}

/** Add several subscribers, in order. */
export function registerSubscribers(subscribers: readonly Subscriber[]): void {
  for (const subscriber of subscribers) registerSubscriber(subscriber);
}

/** The ids of the subscribers registered in this process. */
export function registeredSubscriberIds(): string[] {
  return [...registry.keys()];
}

interface EventRow {
  id: number;
  ownerId: string;
  type: EventType;
  subjectType: EventSubjectType;
  subjectId: string;
  payload: string;
  createdAt: string;
}

interface CursorRow {
  lastEventId: number;
  failures: number;
}

/** One read statement per subscriber, because each filters its own types. */
const reads = new Map<string, Database.Statement>();

function readFor(subscriber: Subscriber): Database.Statement {
  let read = reads.get(subscriber.id);
  if (!read) {
    read = sqlite.prepare(
      // Every account's events: the dispatcher serves the instance, and each
      // handler acts in the scope of the event's own owner.
      // tenant-lint: allow instance sweep
      `SELECT id, ownerId, type, subjectType, subjectId, payload, createdAt
         FROM events
        WHERE id > ? AND id <= ?
          AND type IN (${subscriber.types.map(() => "?").join(", ")})
        ORDER BY id
        LIMIT ${BATCH_SIZE}`,
    );
    reads.set(subscriber.id, read);
  }
  return read;
}

function newestEventId(): number {
  return (
    (
      sqlite
        // tenant-lint: allow instance sweep
        .prepare("SELECT COALESCE(MAX(id), 0) AS id FROM events")
        .get() as { id: number }
    ).id
  );
}

/** Every cursor, by subscriber, in one read. */
function readCursors(): Map<string, CursorRow> {
  const rows = sqlite
    .prepare("SELECT subscriber, lastEventId, failures FROM event_cursors")
    .all() as (CursorRow & { subscriber: string })[];
  return new Map(rows.map((row) => [row.subscriber, row]));
}

/** Write the cursors a round moved, in one transaction. */
function saveCursors(moved: Map<string, CursorRow>): void {
  if (moved.size === 0) return;
  const save = sqlite.prepare(
    `INSERT INTO event_cursors (subscriber, lastEventId, failures)
     VALUES (?, ?, ?)
     ON CONFLICT(subscriber) DO UPDATE SET
       lastEventId = MAX(lastEventId, excluded.lastEventId),
       failures = excluded.failures`,
  );
  sqlite.transaction(() => {
    for (const [subscriber, cursor] of moved) {
      save.run(subscriber, cursor.lastEventId, cursor.failures);
    }
  })();
}

/**
 * Hand one subscriber its events after `from` and up to `upTo`, and put
 * where it got to in `moved`.
 *
 * @returns false when a handler threw and the subscriber stopped for this
 *   dispatch, true when it reached `upTo`.
 */
function deliver(
  subscriber: Subscriber,
  from: CursorRow,
  upTo: number,
  moved: Map<string, CursorRow>,
): boolean {
  let lastEventId = from.lastEventId;
  let failures = from.failures;
  try {
    if (subscriber.types.length > 0) {
      const read = readFor(subscriber);
      for (;;) {
        const rows = read.all(
          lastEventId,
          upTo,
          ...subscriber.types,
        ) as EventRow[];
        for (const row of rows) {
          try {
            subscriber.handle({
              ...row,
              payload: JSON.parse(row.payload),
            } as AnyDomainEvent);
            failures = 0;
          } catch (error) {
            failures += 1;
            if (failures < MAX_FAILURES) {
              // The cursor stays before this event, with the count beside it.
              log.warn(
                "Events",
                `${subscriber.id} failed on event ${row.id} (${row.type}), try ${failures} of ${MAX_FAILURES}. It runs again at the next dispatch: ${getErrorMessage(error)}`,
              );
              return false;
            }
            log.error(
              "Events",
              `${subscriber.id} failed on event ${row.id} (${row.type}) ${MAX_FAILURES} times, so it skips that event: ${getErrorMessage(error)}`,
            );
            failures = 0;
          }
          lastEventId = row.id;
        }
        if (rows.length < BATCH_SIZE) break;
      }
    }
    // No more events of its types up to `upTo`: the events between belong to
    // other subscribers, and this cursor moves past them too.
    lastEventId = upTo;
    return true;
  } finally {
    moved.set(subscriber.id, { lastEventId, failures });
  }
}

let dispatching = false;
let again = false;
let deferred = false;

/**
 * Wait for the open transaction to end. A transaction in this codebase is
 * synchronous, so it has ended by the next microtask. One held open across
 * an await would not have, and then the dispatch waits for the next turn of
 * the event loop instead, so a waiting dispatch never starves the loop.
 */
function deferUntilCommitted(): void {
  if (deferred) return;
  deferred = true;
  queueMicrotask(() => {
    deferred = false;
    if (sqlite.inTransaction) {
      setImmediate(dispatchEvents);
      return;
    }
    dispatchEvents();
  });
}

/**
 * Run every subscriber over the events it has not seen. Synchronous, and it
 * never throws: a failing subscriber is logged, and the caller's write
 * stands.
 */
export function dispatchEvents(): void {
  if (registry.size === 0) return;
  if (sqlite.inTransaction) {
    deferUntilCommitted();
    return;
  }
  if (dispatching) {
    // A handler wrote. The loop below goes round again for its events.
    again = true;
    return;
  }

  dispatching = true;
  // A subscriber that failed in this dispatch waits for the next one, so one
  // bad event costs one try per dispatch and not three in a row.
  const stopped = new Set<string>();
  try {
    do {
      again = false;
      const upTo = newestEventId();
      const cursors = readCursors();
      const moved = new Map<string, CursorRow>();
      try {
        for (const subscriber of registry.values()) {
          if (stopped.has(subscriber.id)) continue;
          const from = cursors.get(subscriber.id);
          if (!from) {
            // A cursor somebody removed: the subscriber starts from now, as
            // a new one does.
            moved.set(subscriber.id, { lastEventId: upTo, failures: 0 });
            continue;
          }
          if (from.lastEventId >= upTo) continue;
          if (!deliver(subscriber, from, upTo, moved)) {
            stopped.add(subscriber.id);
          }
        }
      } finally {
        // Where every subscriber got to, even when the round stopped early.
        saveCursors(moved);
      }
      if (newestEventId() > upTo) again = true;
    } while (again);
  } catch (error) {
    log.error(
      "Events",
      `The event dispatch stopped: ${getErrorMessage(error)}. It resumes from the cursors at the next dispatch.`,
    );
  } finally {
    dispatching = false;
    again = false;
  }
}
