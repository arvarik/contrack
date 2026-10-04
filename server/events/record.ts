// =============================================================================
// recordEvent: one row in `events`, inside the write's own transaction
// =============================================================================
// A write path calls this inside the transaction that makes its change, so
// the change and the record of it commit together or not at all. A crash
// after the commit loses nothing: the dispatcher reads the row at the next
// dispatch, or at boot. A rolled-back write leaves no row, so no subscriber
// ever reacts to a change that did not happen.
//
// It refuses to run outside a transaction. A write path that forgot its
// transaction fails in its tests, rather than recording an event that could
// outlive a write that failed after it.
// =============================================================================

import type Database from "better-sqlite3";
import { sqlite } from "../db.ts";
import type { Scope } from "../tenancy/scope.ts";
import {
  EVENT_SCHEMAS,
  subjectTypeOf,
  type EventPayload,
  type EventType,
} from "../../shared/contracts/events.ts";

let insert: Database.Statement | null = null;

/**
 * Record that a write changed `subjectId`, in the caller's transaction.
 *
 * @param scope - The owner of the subject. Every event belongs to one account.
 * @param type - The event type. Its prefix is the subject's type.
 * @param subjectId - The id of the contact, interaction, task or list.
 * @param payload - Ids, field names and facts about the write, in the schema
 *   of `type`. Parsed before the row is written, so an unknown key throws.
 * @returns the event's id.
 * @throws when no transaction is open, or when the payload does not parse.
 */
export function recordEvent<T extends EventType>(
  scope: Scope,
  type: T,
  subjectId: string,
  payload: EventPayload<T>,
): number {
  if (!sqlite.inTransaction) {
    throw new Error(
      `recordEvent("${type}") ran outside a transaction. Record the event inside the transaction that makes the change.`,
    );
  }
  const parsed: unknown = EVENT_SCHEMAS[type].parse(payload);
  insert ??= sqlite.prepare(
    `INSERT INTO events (ownerId, type, subjectType, subjectId, payload)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const result = insert.run(
    scope.ownerId,
    type,
    subjectTypeOf(type),
    subjectId,
    JSON.stringify(parsed),
  );
  return Number(result.lastInsertRowid);
}
