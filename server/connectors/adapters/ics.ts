/**
 * The calendar (ICS) connector, for any calendar with a private ICS URL
 * (Google, iCloud, Outlook, Fastmail, Nextcloud). Past meetings become
 * `meeting` interactions on matching contacts, and future events go to
 * `upcoming_events` for Pulse.
 *
 * @module server/connectors/adapters/ics
 */

import { z } from "zod";
import ical, {
  type CalendarResponse,
  type EventInstance,
  type VEvent,
} from "node-ical";
import { safeFetch } from "../../utils/urlSafety.ts";
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

  return readCappedBody(res, signal);
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

function parseParticipants(event: VEvent): Participant[] {
  const participants: Participant[] = [];
  const seenEmails = new Set<string>();

  // 1. Organizer
  if (event.organizer) {
    const rawVal =
      typeof event.organizer === "string"
        ? event.organizer
        : event.organizer.val;
    const email = rawVal
      ?.replace(/^mailto:/i, "")
      .trim()
      .toLowerCase();
    const name =
      typeof event.organizer === "object" && event.organizer.params?.CN
        ? event.organizer.params.CN
        : undefined;

    if (email) {
      seenEmails.add(email);
      participants.push({ email, name });
    } else if (name) {
      participants.push({ name });
    }
  }

  // 2. Attendees
  if (event.attendee) {
    const attendees = Array.isArray(event.attendee)
      ? event.attendee
      : [event.attendee];

    for (const att of attendees) {
      const rawVal = typeof att === "string" ? att : att.val;
      const email = rawVal
        ?.replace(/^mailto:/i, "")
        .trim()
        .toLowerCase();
      const name =
        typeof att === "object" && att.params?.CN ? att.params.CN : undefined;

      if (email) {
        if (!seenEmails.has(email)) {
          seenEmails.add(email);
          participants.push({ email, name });
        }
      } else if (name) {
        participants.push({ name });
      }
    }
  }

  return participants;
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

      if (event.status === "CANCELLED") {
        continue;
      }

      // Check attendees limit
      const attendeeList = event.attendee
        ? Array.isArray(event.attendee)
          ? event.attendee
          : [event.attendee]
        : [];
      if (attendeeList.length > maxAttendees) {
        continue;
      }

      const participants = parseParticipants(event);
      const title =
        typeof event.summary === "string"
          ? event.summary
          : event.summary && "val" in event.summary
            ? String(event.summary.val)
            : "Untitled Event";
      const content =
        includeDescription && event.description
          ? typeof event.description === "string"
            ? event.description
            : "val" in event.description
              ? String(event.description.val)
              : undefined
          : undefined;

      // Handle recurring events
      if (event.rrule) {
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

          const recId = instance.event?.recurrenceid
            ? instance.event.recurrenceid instanceof Date
              ? instance.event.recurrenceid.toISOString()
              : String(instance.event.recurrenceid)
            : instance.start.toISOString();

          const externalId = `${event.uid}_${recId}`;
          const startsAt = stamp(instance.start, instance.isFullDay);
          const endsAt = instance.end
            ? stamp(instance.end, instance.isFullDay)
            : new Date(instance.start.getTime() + 3600000).toISOString();

          if (instance.end && instance.end <= now) {
            yield {
              kind: "interaction",
              externalId,
              type: "meeting",
              title,
              content,
              date: startsAt,
              endsAt,
              participants,
              raw: { uid: event.uid, recId },
            };
          } else {
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
      } else {
        // Non-recurring event
        if (!event.start) continue;
        const startDate = new Date(event.start);
        const endDate = event.end ? new Date(event.end) : startDate;

        // Skip events completely outside our window
        if (endDate < lookbackStart || startDate > futureEnd) {
          continue;
        }

        const externalId = String(event.uid);
        const allDay =
          (event.start as { dateOnly?: boolean }).dateOnly === true;
        const startsAt = stamp(startDate, allDay);
        const endsAt = stamp(endDate, allDay);

        if (endDate <= now) {
          yield {
            kind: "interaction",
            externalId,
            type: "meeting",
            title,
            content,
            date: startsAt,
            endsAt,
            participants,
            raw: { uid: event.uid },
          };
        } else {
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
    }

    yield {
      kind: "progress",
      fetched,
      message: `Completed processing ${fetched} events`,
    };
    return { lastSyncAt: now.toISOString() };
  },
};
