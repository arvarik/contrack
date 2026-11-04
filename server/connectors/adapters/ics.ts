/**
 * The calendar (ICS) connector, for any calendar with a private ICS URL
 * (Google, iCloud, Outlook, Fastmail, Nextcloud). Past meetings become
 * `meeting` interactions on matching contacts, and future events go to
 * `upcoming_events` for Pulse.
 *
 * @module server/connectors/adapters/ics
 */

import crypto from "node:crypto";
import { z } from "zod";
import ical, {
  type CalendarResponse,
  type EventInstance,
  type VEvent,
} from "node-ical";
import { safeFetch } from "../../utils/urlSafety.ts";
import { canonicalEmailAddress } from "../email/normalize.ts";
import { ConnectorConfigError } from "../errors.ts";
import type {
  ConnectorAdapter,
  Participant,
  SyncContext,
  SyncEvent,
} from "../types.ts";

export const icsConfigSchema = z.object({
  url: z
    .string()
    .url("Must be a valid URL")
    .describe("Private ICS calendar URL"),
  lookbackDays: z.number().int().min(1).max(365).default(90).optional(),
  maxAttendees: z.number().int().min(1).max(500).default(25).optional(),
  includeDescription: z.boolean().default(false).optional(),
  /** The owner's addresses on the calendar, when they differ from the login. */
  aliases: z.array(z.string()).default([]).optional(),
  /** Meetings with a stranger before Contrack suggests them as a contact. */
  ghostThreshold: z.coerce.number().int().min(1).max(10).default(3).optional(),
});

export type IcsConfig = z.infer<typeof icsConfigSchema>;

const MAX_CALENDAR_BYTES = 5 * 1024 * 1024; // 5 MB cap

/**
 * The most instances one recurring event may have in the sync window (up to
 * 365 days back and 30 ahead). A daily meeting has at most 395, twice a day 790.
 */
export const MAX_INSTANCES_PER_EVENT = 1_000;

/**
 * A rule that recurs within the hour. Its expansion is not bounded by any cap
 * the parser has: one 1 KB event with every BYHOUR, BYMINUTE and BYSECOND value
 * filled a 400 MB heap in 3 s, and the process aborted. So it is skipped before
 * expansion. More than 24 times in a day is not a meeting with a person.
 */
export function recursWithinTheHour(rrule: VEvent["rrule"]): boolean {
  if (!rrule) return false;
  const o = rrule.options;
  const count = (camel: string) => {
    const list = o[camel] ?? o[camel.toLowerCase()];
    return Array.isArray(list) && list.length > 0 ? list.length : 1;
  };
  const freq = String(o.freq).toUpperCase();
  if (["HOURLY", "MINUTELY", "SECONDLY", "4", "5", "6"].includes(freq)) {
    return true;
  }
  return count("byHour") * count("byMinute") * count("bySecond") > 24;
}

/**
 * Reads a stream capped at MAX_CALENDAR_BYTES.
 */
async function readCappedBody(
  res: globalThis.Response,
  signal?: AbortSignal,
): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let text = "";
  let received = 0;

  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        if (received + value.byteLength > MAX_CALENDAR_BYTES) {
          throw new ConnectorConfigError(
            `Calendar feed exceeded 5 MB cap (received > ${MAX_CALENDAR_BYTES} bytes)`,
          );
        }
        received += value.byteLength;
        text += decoder.decode(value, { stream: true });
      }
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

/**
 * The whole feed, from request to last byte. The 15 s timers below end at the
 * headers, so without this a server that sends the body slowly, or not at all,
 * would hold the sync until shutdown.
 */
const ICS_FETCH_DEADLINE_MS = 60_000;

/**
 * Fetches calendar feed content respecting urlSafety and CONNECTORS_ALLOW_PRIVATE_HOSTS.
 */
export async function fetchIcsContent(
  urlStr: string,
  sync?: AbortSignal,
): Promise<string> {
  // The private-hosts branch below uses the global fetch, which reads a
  // `data:` address as a feed. Only a web address is one.
  let protocol = "";
  try {
    protocol = new URL(urlStr).protocol;
  } catch {
    // Refused below.
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new ConnectorConfigError(
      "The calendar address must start with http:// or https://",
    );
  }
  const deadline = AbortSignal.timeout(ICS_FETCH_DEADLINE_MS);
  const signal = sync ? AbortSignal.any([sync, deadline]) : deadline;
  const allowPrivate = process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS === "true";
  let res: globalThis.Response;

  if (allowPrivate) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      res = await fetch(urlStr, {
        signal: AbortSignal.any([controller.signal, signal]),
        redirect: "follow",
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      throw new ConnectorConfigError(
        `Failed to connect to calendar URL: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  } else {
    try {
      const { response } = await safeFetch(urlStr, {
        signal,
        timeoutMs: 15_000,
      });
      res = response;
    } catch (err: unknown) {
      throw new ConnectorConfigError(
        `Failed to connect to calendar URL: ${(err as Error).message}`,
      );
    }
  }

  if (!res.ok) {
    throw new ConnectorConfigError(
      `Calendar feed returned HTTP ${res.status}: ${res.statusText}`,
    );
  }

  const body = await readCappedBody(res, signal);
  // A sign-in or error page answers 200 too. Read as a feed, it had no events,
  // and the sync removed every upcoming one.
  if (!/BEGIN:VCALENDAR/i.test(body)) {
    throw new ConnectorConfigError(
      "The calendar address returned a page that is not a calendar",
    );
  }
  return body;
}

/**
 * When an event starts or ends, as stored. An all-day event (`VALUE=DATE`) is a
 * day, written `2026-10-09`: node-ical builds it at the server's local
 * midnight, so its local parts are the day. As an instant it would be the
 * evening before for every reader west of the server.
 */
function stamp(date: Date, allDay: boolean): string {
  if (!allDay) return date.toISOString();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The text of a property node-ical gives as a string or as `{ val }`. */
function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "val" in value) {
    return String((value as { val: unknown }).val);
  }
  return undefined;
}

/**
 * An id for an event the feed gave no UID. Before, every such event was
 * "undefined", so only the first one was kept.
 */
function noUidKey(title: string, start: Date): string {
  const digest = crypto.hash("sha1", `${title}|${start.toISOString()}`);
  return `nouid-${digest.slice(0, 16)}`;
}

/**
 * The address and name of an ORGANIZER or ATTENDEE, which node-ical gives as a
 * string or as `{ val, params }`. A CalDAV server can give the address as an
 * EMAIL parameter with a `urn:uuid:` value, and Outlook gives `invalid:nomail`
 * for an attendee whose address it hides: only a value with an "@" and no
 * scheme left is an address.
 */
function person(prop: unknown): {
  email?: string;
  name?: string;
  params: Record<string, string>;
} {
  const params =
    (prop as { params?: Record<string, string> } | null)?.params ?? {};
  const value = typeof prop === "string" ? prop : textOf(prop);
  const email = (params.EMAIL ?? value)
    ?.replace(/^mailto:/i, "")
    .trim()
    .toLowerCase();
  return {
    email: email && /^[^\s:@]+@[^\s:@]+$/.test(email) ? email : undefined,
    name: params.CN || undefined,
    params,
  };
}

/**
 * The people of an event: the organizer when a person organized it (not a
 * shared or room calendar), and the attendees who are neither a room nor
 * declined. Null when the owner, one of `self` by mailbox, declined it.
 */
function parseParticipants(
  event: VEvent,
  self: Set<string>,
): Participant[] | null {
  const participants: Participant[] = [];
  const seenEmails = new Set<string>();
  const add = (email: string | undefined, name: string | undefined) => {
    if (email) {
      if (seenEmails.has(email)) return;
      seenEmails.add(email);
      participants.push({ email, name });
    } else if (name) {
      participants.push({ name });
    }
  };

  if (event.organizer) {
    const { email, name } = person(event.organizer);
    // A shared or room calendar is not a person. A robot-looking organizer
    // may be a saved contact (info@ a law firm), and ingest never counts a
    // robot as a stranger, so it stays.
    if (!email || !/calendar\.google\.com$/i.test(email)) add(email, name);
  }

  const attendees = event.attendee
    ? Array.isArray(event.attendee)
      ? event.attendee
      : [event.attendee]
    : [];
  for (const att of attendees) {
    const { email, name, params } = person(att);
    // A room is no person, and someone who declined was not there.
    // Parameter values are case-insensitive (RFC 5545 3.2).
    const partstat = String(params.PARTSTAT ?? "").toUpperCase();
    const cutype = String(params.CUTYPE ?? "").toUpperCase();
    if (partstat === "DECLINED") {
      if (email && self.has(canonicalEmailAddress(email))) return null;
      continue;
    }
    if (cutype === "RESOURCE" || cutype === "ROOM") continue;
    add(email, name);
  }

  return participants;
}

/**
 * The key of an instance by its RECURRENCE-ID: the instant, or for an all-day
 * one its day, with the instant earlier versions used as a legacy key.
 */
function recurrenceKey(rid: Date): [string, string?] {
  return (rid as { dateOnly?: boolean }).dateOnly === true
    ? [stamp(rid, true), rid.toISOString()]
    : [rid.toISOString()];
}

export const icsAdapter: ConnectorAdapter<IcsConfig, null> = {
  kind: "ics",
  label: "Calendar",
  description: "Sync meetings and see what is coming up from a private ICS URL",
  capabilities: {
    schedule: true,
  },
  configSchema: icsConfigSchema,
  secretSchema: null,

  async test(config: IcsConfig): Promise<{ ok: true; detail: string }> {
    const rawIcs = await fetchIcsContent(config.url);
    let parsed: CalendarResponse;
    try {
      parsed = await ical.async.parseICS(rawIcs);
    } catch (err) {
      throw new ConnectorConfigError(
        `Failed to parse calendar format: ${(err as Error).message}`,
      );
    }

    const events = Object.values(parsed).filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        "type" in entry &&
        (entry as { type?: string }).type === "VEVENT",
    );

    const count = events.length;
    return {
      ok: true,
      detail:
        count === 0
          ? "Connected successfully (no events in feed)"
          : `Connected successfully (${count} event${count === 1 ? "" : "s"} found)`,
    };
  },

  async *sync(
    ctx: SyncContext<IcsConfig, null>,
  ): AsyncGenerator<SyncEvent, unknown | null> {
    const { config, since: _since, signal, log } = ctx;
    // The address is not logged: a private ICS address is the key to the
    // whole calendar, and it often names the account's email.
    log("Fetching the calendar feed");
    const rawIcs = await fetchIcsContent(config.url, signal);

    log("Parsing ICS calendar data");
    let parsed: CalendarResponse;
    try {
      // The async parser yields between batches of lines: a 5 MB feed held
      // the event loop for about 110 ms with the sync one, and 4 ms with this.
      parsed = await ical.async.parseICS(rawIcs);
    } catch (err) {
      throw new ConnectorConfigError(
        `Failed to parse calendar data: ${(err as Error).message}`,
      );
    }

    const now = new Date();
    const lookbackDays = Number(config.lookbackDays ?? 90);
    const lookbackStart = new Date(
      now.getTime() - lookbackDays * 24 * 60 * 60 * 1000,
    );
    // Expand future recurrences up to 30 days ahead
    const futureEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const maxAttendees = config.maxAttendees ?? 25;
    const includeDescription = config.includeDescription ?? false;
    const self = new Set(ctx.selfAddresses.emails.map(canonicalEmailAddress));
    /** Whether anyone but the owner is in it. Coming up shows only those. */
    const withOthers = (people: Participant[]) =>
      people.some((p) => !p.email || !self.has(canonicalEmailAddress(p.email)));
    const tooMany = (ev: VEvent) =>
      (Array.isArray(ev.attendee) ? ev.attendee.length : ev.attendee ? 1 : 0) >
      maxAttendees;

    /** The meeting or upcoming event of an event that does not recur. */
    function* single(
      ev: VEvent,
      externalId: string,
      legacyExternalIds?: string[],
    ): Generator<SyncEvent> {
      if (!ev.start || ev.status === "CANCELLED" || tooMany(ev)) return;
      const participants = parseParticipants(ev, self);
      if (!participants) return;
      const title = textOf(ev.summary) ?? "Untitled Event";
      const startDate = new Date(ev.start);
      const endDate = ev.end ? new Date(ev.end) : startDate;

      // Skip events completely outside our window
      if (endDate < lookbackStart || startDate > futureEnd) return;

      const allDay = (ev.start as { dateOnly?: boolean }).dateOnly === true;
      const startsAt = stamp(startDate, allDay);
      const endsAt = stamp(endDate, allDay);

      if (endDate <= now) {
        yield {
          kind: "interaction",
          externalId,
          ...(legacyExternalIds ? { legacyExternalIds } : {}),
          type: "meeting",
          title,
          content: includeDescription ? textOf(ev.description) : undefined,
          date: startsAt,
          endsAt,
          participants,
          raw: { uid: ev.uid },
        };
      } else if (withOthers(participants)) {
        yield {
          kind: "upcoming",
          externalId,
          title,
          startsAt,
          endsAt,
          participants,
        };
      }
    }

    let fetched = 0;
    const vEvents = Object.values(parsed).filter((entry): entry is VEvent =>
      Boolean(
        entry &&
        typeof entry === "object" &&
        "type" in entry &&
        (entry as { type?: string }).type === "VEVENT",
      ),
    );

    for (const event of vEvents) {
      signal.throwIfAborted();
      fetched++;
      if (fetched % 20 === 0) {
        yield {
          kind: "progress",
          fetched,
          message: `Processed ${fetched} calendar events`,
        };
      }

      const title = textOf(event.summary) ?? "Untitled Event";
      const content = includeDescription
        ? textOf(event.description)
        : undefined;
      const baseId = event.uid
        ? String(event.uid)
        : noUidKey(title, event.start ? new Date(event.start) : new Date(0));

      // Handle recurring events
      if (event.rrule) {
        if (event.status === "CANCELLED" || tooMany(event)) continue;
        const participants = parseParticipants(event, self);
        if (recursWithinTheHour(event.rrule)) {
          log("Skipped a recurring event that repeats within the hour");
          continue;
        }
        let instances: EventInstance[] = [];
        try {
          instances = ical.expandRecurringEvent(event, {
            from: lookbackStart,
            to: futureEnd,
            includeOverrides: true,
            excludeExdates: true,
          });
        } catch {
          // If expandRecurringEvent fails on unusual RRULE, fall back to base event
          instances = [];
        }
        // Each instance is a write. A rule that passes the check above can
        // still give thousands, such as 24 times a day for a year.
        if (instances.length > MAX_INSTANCES_PER_EVENT) {
          log(`Skipped a recurring event with ${instances.length} instances`);
          continue;
        }

        for (const instance of instances) {
          if (instance.event?.status === "CANCELLED") continue;

          // Check if explicit recurrence override marks it canceled
          const recDateStr = instance.start.toISOString();
          const shortDateStr = recDateStr.slice(0, 10);
          if (
            event.recurrences &&
            (event.recurrences[recDateStr]?.status === "CANCELLED" ||
              event.recurrences[shortDateStr]?.status === "CANCELLED")
          ) {
            continue;
          }

          // An all-day instance is keyed by its day. node-ical builds it at
          // the server's local midnight, so as an instant it moved with the
          // server's zone and with DST, and a move to a UTC container imported
          // every past instance again. That instant is kept as the legacy id.
          const rid = instance.event?.recurrenceid;
          let recId: string;
          let legacyId: string | undefined;
          if (rid instanceof Date) {
            [recId, legacyId] = recurrenceKey(rid);
          } else if (rid) {
            recId = String(rid);
          } else {
            recId = stamp(instance.start, instance.isFullDay);
            if (instance.isFullDay) legacyId = instance.start.toISOString();
          }
          const externalId = `${baseId}_${recId}`;
          const legacyExternalIds = legacyId
            ? [`${baseId}_${legacyId}`]
            : undefined;

          // A moved or renamed instance carries its own details.
          const own = instance.isOverride ? instance.event : undefined;
          const instanceTitle = textOf(own?.summary) ?? title;
          const instanceContent = includeDescription
            ? (textOf(own?.description) ?? content)
            : undefined;
          // An override that lists people uses its own list, even when
          // everyone on it declined.
          const instancePeople =
            own && (own.attendee || own.organizer)
              ? parseParticipants(own, self)
              : participants;
          if (!instancePeople) continue;
          const startsAt = stamp(instance.start, instance.isFullDay);
          const endsAt = instance.end
            ? stamp(instance.end, instance.isFullDay)
            : new Date(instance.start.getTime() + 3600000).toISOString();

          if (instance.end && instance.end <= now) {
            yield {
              kind: "interaction",
              externalId,
              ...(legacyExternalIds ? { legacyExternalIds } : {}),
              type: "meeting",
              title: instanceTitle,
              content: instanceContent,
              date: startsAt,
              endsAt,
              participants: instancePeople,
              raw: { uid: event.uid, recId },
            };
          } else if (withOthers(instancePeople)) {
            yield {
              kind: "upcoming",
              externalId,
              title: instanceTitle,
              startsAt,
              endsAt,
              participants: instancePeople,
            };
          }
        }
      } else if (event.recurrenceid instanceof Date) {
        // Single instances of a series the feed does not hold, such as
        // meetings of someone else's series the owner is invited to.
        // node-ical keeps the first as the event, and each one, under two
        // keys, in `recurrences`. Each is keyed as its series keys it, so
        // the series logs none again when it arrives. The first one was
        // keyed by the UID alone.
        const first = event.recurrenceid.toISOString();
        for (const one of new Set(Object.values(event.recurrences ?? {}))) {
          if (!(one.recurrenceid instanceof Date)) continue;
          const [recId] = recurrenceKey(one.recurrenceid);
          yield* single(
            one as VEvent,
            `${baseId}_${recId}`,
            one.recurrenceid.toISOString() === first ? [baseId] : undefined,
          );
        }
      } else {
        yield* single(event, baseId);
      }
    }

    yield {
      kind: "progress",
      fetched,
      message: `Completed processing ${fetched} events`,
    };
    return { lastSyncAt: now.toISOString() };
  },
};
