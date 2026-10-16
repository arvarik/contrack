/**
 * Unit: the ICS Calendar adapter.
 *
 * Verifies recurring event expansion, cancellation handling, all-day event support,
 * large attendee cap skipping, and externalId stability across multiple runs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { icsAdapter } from "../../../../server/connectors/adapters/ics.ts";
import type {
  SyncContext,
  SyncEvent,
} from "../../../../server/connectors/types.ts";

// Helper to generate N attendee lines
const generateAttendees = (count: number): string =>
  Array.from(
    { length: count },
    (_, i) => `ATTENDEE:mailto:attendee${i}@example.com`,
  ).join("\r\n");

const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Contrack Tests//EN
CALSCALE:GREGORIAN

BEGIN:VEVENT
UID:weekly-sync@example.com
DTSTAMP:20260101T000000Z
DTSTART:20260105T100000Z
DTEND:20260105T110000Z
RRULE:FREQ=WEEKLY;COUNT=5;BYDAY=MO
SUMMARY:Weekly Engineering Sync
DESCRIPTION:Weekly discussion notes
ORGANIZER;CN=Alice:mailto:alice@example.com
ATTENDEE;CN=Bob:mailto:bob@example.com
END:VEVENT

BEGIN:VEVENT
UID:weekly-sync@example.com
RECURRENCE-ID:20260112T100000Z
DTSTAMP:20260101T000000Z
DTSTART:20260112T100000Z
DTEND:20260112T110000Z
STATUS:CANCELLED
SUMMARY:Weekly Engineering Sync
ORGANIZER;CN=Alice:mailto:alice@example.com
END:VEVENT

BEGIN:VEVENT
UID:all-day-retreat@example.com
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:20260120
DTEND;VALUE=DATE:20260121
SUMMARY:Company Offsite
ORGANIZER:mailto:founder@example.com
ATTENDEE:mailto:teammate@example.com
END:VEVENT

BEGIN:VEVENT
UID:company-all-hands@example.com
DTSTAMP:20260101T000000Z
DTSTART:20260122T170000Z
DTEND:20260122T180000Z
SUMMARY:Global All-Hands
ORGANIZER:mailto:ceo@example.com
${generateAttendees(40)}
END:VEVENT
END:VCALENDAR`;

describe("icsAdapter", () => {
  // The adapter sets its window from the clock, and the fixture's events are
  // in January and February 2026. A fixed date keeps them in the window.
  beforeEach(() => {
    vi.useFakeTimers({
      now: new Date("2026-03-01T00:00:00Z"),
      toFake: ["Date"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS;
  });

  function mockFetch(icsBody: string) {
    process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "true";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        return new Response(icsBody, {
          status: 200,
          headers: { "Content-Type": "text/calendar" },
        });
      }),
    );
  }

  it("tests connection successfully and reports event count", async () => {
    mockFetch(SAMPLE_ICS);

    const result = await icsAdapter.test(
      {
        url: "https://example.com/calendar.ics",
      },
      null,
    );

    expect(result.ok).toBe(true);
    // Four VEVENT blocks, but node-ical folds the canceled override into its
    // series, so the feed holds three events.
    expect(result.detail).toBe("Connected successfully (3 events found)");
  });

  it("expands recurrences, respects cancellations, and skips events exceeding attendee cap", async () => {
    mockFetch(SAMPLE_ICS);

    const events: SyncEvent[] = [];
    const ctx: SyncContext<
      {
        url: string;
        lookbackDays?: number;
        maxAttendees?: number;
        includeDescription?: boolean;
      },
      null
    > = {
      config: {
        url: "https://example.com/calendar.ics",
        lookbackDays: 365,
        maxAttendees: 25,
        includeDescription: true,
      },
      secret: null,
      cursor: null,
      since: "2026-01-01T00:00:00.000Z",
      selfAddresses: { emails: ["me@example.com"], phones: [] },
      signal: new AbortController().signal,
      log: () => {},
    };

    for await (const event of icsAdapter.sync(ctx)) {
      events.push(event);
    }

    // Filter out progress events
    const interactionEvents = events.filter(
      (e) => e.kind === "interaction" || e.kind === "upcoming",
    );

    // 1. Check that the 40-attendee all-hands was skipped
    const allHands = interactionEvents.find((e) =>
      "title" in e ? e.title === "Global All-Hands" : false,
    );
    expect(allHands).toBeUndefined();

    // 2. Check that the canceled instance (2026-01-12) was skipped
    const cancelledInstance = interactionEvents.find((e) =>
      "externalId" in e && typeof e.externalId === "string"
        ? e.externalId.includes("2026-01-12") ||
          e.externalId.includes("20260112")
        : false,
    );
    expect(cancelledInstance).toBeUndefined();

    // 3. Check that each recurring instance that was not canceled was produced
    const weekly = interactionEvents.flatMap((e) =>
      "externalId" in e && e.externalId.startsWith("weekly-sync@example.com")
        ? [e.externalId]
        : [],
    );
    expect(weekly).toEqual([
      "weekly-sync@example.com_2026-01-05T10:00:00.000Z",
      "weekly-sync@example.com_2026-01-19T10:00:00.000Z",
      "weekly-sync@example.com_2026-01-26T10:00:00.000Z",
      "weekly-sync@example.com_2026-02-02T10:00:00.000Z",
    ]);

    // 4. An all-day event is kept as its day, so no reader's zone moves it
    // to the evening before.
    const allDay = interactionEvents.find((e) =>
      "title" in e ? e.title === "Company Offsite" : false,
    );
    expect(allDay).toMatchObject({ date: "2026-01-20", endsAt: "2026-01-21" });
  });

  it("produces deterministic externalIds across multiple sync passes", async () => {
    mockFetch(SAMPLE_ICS);

    const ctx: SyncContext<
      { url: string; lookbackDays?: number; maxAttendees?: number },
      null
    > = {
      config: {
        url: "https://example.com/calendar.ics",
        lookbackDays: 365,
        maxAttendees: 25,
      },
      secret: null,
      cursor: null,
      since: "2026-01-01T00:00:00.000Z",
      selfAddresses: { emails: [], phones: [] },
      signal: new AbortController().signal,
      log: () => {},
    };

    const pass1: string[] = [];
    for await (const ev of icsAdapter.sync(ctx)) {
      if ("externalId" in ev && typeof ev.externalId === "string") {
        pass1.push(ev.externalId);
      }
    }

    const pass2: string[] = [];
    for await (const ev of icsAdapter.sync(ctx)) {
      if ("externalId" in ev && typeof ev.externalId === "string") {
        pass2.push(ev.externalId);
      }
    }

    expect(pass1.length).toBeGreaterThan(0);
    expect(pass1).toEqual(pass2);
  });

  it("skips rules that repeat within the hour, and never logs the feed's address", async () => {
    // Before, these gave about 9,500 and 19,000 writes. Every BYSECOND too
    // aborts the process inside the parser, so no test expands one.
    const hours = Array.from({ length: 24 }, (_, i) => i).join(",");
    const event = (uid: string, rule: string) =>
      `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20260101T000000Z\r\nDTSTART:20260201T100000Z\r\nDTEND:20260201T101000Z\r\nRRULE:${rule}\r\nSUMMARY:${uid}\r\nEND:VEVENT\r\n`;
    mockFetch(
      `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${event("hourly", "FREQ=HOURLY")}${event("half-hourly", `FREQ=DAILY;BYHOUR=${hours};BYMINUTE=0,30`)}END:VCALENDAR\r\n`,
    );
    const url =
      "https://calendar.example.com/ical/me%40example.com/private-5ecret/basic.ics";
    const logged: string[] = [];
    const written: SyncEvent[] = [];
    for await (const ev of icsAdapter.sync({
      config: { url, lookbackDays: 365 },
      secret: null,
      cursor: null,
      since: "2025-03-01T00:00:00.000Z",
      selfAddresses: { emails: [], phones: [] },
      signal: new AbortController().signal,
      log: (msg) => logged.push(msg),
    })) {
      if (ev.kind !== "progress") written.push(ev);
    }

    expect(written).toEqual([]);
    expect(logged.join("\n")).not.toMatch(/5ecret|example\.com/);
  });

  async function syncFeed(ics: string) {
    mockFetch(ics);
    const events: SyncEvent[] = [];
    for await (const ev of icsAdapter.sync({
      config: { url: "https://example.com/calendar.ics", lookbackDays: 90 },
      secret: null,
      cursor: null,
      since: "2026-01-01T00:00:00.000Z",
      selfAddresses: { emails: ["me@example.com"], phones: [] },
      signal: new AbortController().signal,
      log: () => {},
    })) {
      if (ev.kind !== "progress") events.push(ev);
    }
    return events as Array<
      Extract<SyncEvent, { kind: "interaction" | "upcoming" }>
    >;
  }

  const feed = (body: string) =>
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Contrack Tests//EN\r\n${body.replace(/\n/g, "\r\n")}\r\nEND:VCALENDAR`;

  it("keys an all-day recurring instance by its day, names the old instant id, and takes an override's own title", async () => {
    // node-ical builds an all-day instance at the server's local midnight, so
    // its instant depends on the server's zone and on DST: a move to a UTC
    // container changed every id and imported every past instance again.
    const events = await syncFeed(
      feed(`BEGIN:VEVENT
UID:allday-weekly
DTSTART;VALUE=DATE:20260216
DTEND;VALUE=DATE:20260217
RRULE:FREQ=WEEKLY;COUNT=2
SUMMARY:Standup day
ATTENDEE:mailto:bob@example.com
END:VEVENT
BEGIN:VEVENT
UID:weekly
DTSTART;TZID=America/New_York:20260209T100000
DTEND;TZID=America/New_York:20260209T110000
RRULE:FREQ=WEEKLY;COUNT=2
SUMMARY:Weekly
ATTENDEE:mailto:bob@example.com
END:VEVENT
BEGIN:VEVENT
UID:weekly
RECURRENCE-ID;TZID=America/New_York:20260216T100000
DTSTART;TZID=America/New_York:20260218T140000
DTEND;TZID=America/New_York:20260218T150000
SUMMARY:Weekly (moved)
ATTENDEE:mailto:bob@example.com
END:VEVENT`),
    );
    const localMidnight = (y: number, m: number, d: number) =>
      new Date(y, m - 1, d).toISOString();
    expect(
      events
        .filter((e) => e.externalId.startsWith("allday-weekly"))
        .map((e) => [
          e.externalId,
          (e as { legacyExternalIds?: string[] }).legacyExternalIds,
        ]),
    ).toEqual([
      [
        "allday-weekly_2026-02-16",
        [`allday-weekly_${localMidnight(2026, 2, 16)}`],
      ],
      [
        "allday-weekly_2026-02-23",
        [`allday-weekly_${localMidnight(2026, 2, 23)}`],
      ],
    ]);
    const moved = events.find(
      (e) => e.externalId === "weekly_2026-02-16T15:00:00.000Z",
    );
    expect(moved).toMatchObject({
      title: "Weekly (moved)",
      date: "2026-02-18T19:00:00.000Z",
    });
  });

  it("gives an event without a UID its own id, and drops rooms and attendees who declined", async () => {
    const events = await syncFeed(
      feed(`BEGIN:VEVENT
DTSTART:20260220T090000Z
DTEND:20260220T100000Z
SUMMARY:No UID one
ATTENDEE:mailto:bob@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART:20260221T090000Z
DTEND:20260221T100000Z
SUMMARY:No UID two
ATTENDEE:mailto:bob@example.com
END:VEVENT
BEGIN:VEVENT
UID:planning
DTSTART:20260222T090000Z
DTEND:20260222T100000Z
SUMMARY:Planning
ORGANIZER;CN=Alice:mailto:alice@example.com
ATTENDEE;PARTSTAT=ACCEPTED:mailto:bob@example.com
ATTENDEE;CUTYPE=RESOURCE;CN=Room 4:mailto:room4@example.com
ATTENDEE;CUTYPE=ROOM:mailto:room5@example.com
ATTENDEE;PARTSTAT=DECLINED:mailto:carol@example.com
END:VEVENT`),
    );
    const ids = events.map((e) => e.externalId);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain("undefined");
    expect(
      events.find((e) => e.externalId === "planning")?.participants,
    ).toEqual([
      { email: "alice@example.com", name: "Alice" },
      { email: "bob@example.com", name: undefined },
    ]);
  });

  it("refuses a feed address that is not http(s), even with private hosts allowed", async () => {
    mockFetch("BEGIN:VCALENDAR\r\nEND:VCALENDAR");
    await expect(
      icsAdapter.test({ url: "data:text/calendar,BEGIN%3AVCALENDAR" }, null),
    ).rejects.toThrow(/http/i);
  });

  it("leaves out an override's attendees who all declined, and reads PARTSTAT and CUTYPE in any case", async () => {
    // An override that lists only people who declined fell back to the
    // series' attendees. RFC 5545 parameter values are case-insensitive.
    const events = await syncFeed(
      feed(`BEGIN:VEVENT
UID:sync
DTSTART:20260209T150000Z
DTEND:20260209T160000Z
RRULE:FREQ=WEEKLY;COUNT=2
SUMMARY:Sync
ATTENDEE:mailto:bob@example.com
ATTENDEE;PARTSTAT=declined:mailto:dan@example.com
ATTENDEE;CUTYPE=room:mailto:room6@example.com
END:VEVENT
BEGIN:VEVENT
UID:sync
RECURRENCE-ID:20260216T150000Z
DTSTART:20260216T150000Z
DTEND:20260216T160000Z
SUMMARY:Sync
ATTENDEE;PARTSTAT=DECLINED:mailto:bob@example.com
END:VEVENT`),
    );
    const people = (id: string) =>
      events.find((e) => e.externalId === id)?.participants;
    expect(people("sync_2026-02-09T15:00:00.000Z")).toEqual([
      { email: "bob@example.com", name: undefined },
    ]);
    expect(people("sync_2026-02-16T15:00:00.000Z")).toEqual([]);
  });
});
