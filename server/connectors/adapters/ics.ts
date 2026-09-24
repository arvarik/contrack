/**
 * server/connectors/adapters/ics.ts — Calendar (ICS) connector adapter.
 *
 * Connects to any calendar feed that publishes a private ICS URL (Google, iCloud,
 * Outlook, Fastmail, Nextcloud). Turns past meetings into `meeting` interactions on
 * matching contacts, and writes future events to `upcoming_events` for display on Pulse.
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
});

export type IcsConfig = z.infer<typeof icsConfigSchema>;

const MAX_CALENDAR_BYTES = 5 * 1024 * 1024; // 5 MB cap

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
 * Fetches calendar feed content respecting urlSafety and CONNECTORS_ALLOW_PRIVATE_HOSTS.
 */
export async function fetchIcsContent(
  urlStr: string,
  signal?: AbortSignal,
): Promise<string> {
  const allowPrivate = process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS === "true";
  let res: globalThis.Response;

  if (allowPrivate) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      res = await fetch(urlStr, {
        signal: signal
          ? AbortSignal.any([controller.signal, signal])
          : controller.signal,
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
      parsed = ical.sync.parseICS(rawIcs);
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
    log(`Fetching calendar feed from ${config.url}`);
    const rawIcs = await fetchIcsContent(config.url, signal);

    log("Parsing ICS calendar data");
    let parsed: CalendarResponse;
    try {
      parsed = ical.sync.parseICS(rawIcs);
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

        for (const instance of instances) {
          if (instance.event?.status === "CANCELLED") continue;

          // Check if explicit recurrence override marks it cancelled
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
          const startsAt = instance.start.toISOString();
          const endsAt = instance.end
            ? instance.end.toISOString()
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
        const startsAt = startDate.toISOString();
        const endsAt = endDate.toISOString();

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
