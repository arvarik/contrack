/**
 * tests/unit/ics.adapter.test.ts — Unit tests for the ICS Calendar adapter.
 *
 * Verifies recurring event expansion, cancellation handling, all-day event support,
 * large attendee cap skipping, and externalId stability across multiple runs.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { icsAdapter } from "../../server/connectors/adapters/ics.ts";
import type { SyncContext, SyncEvent } from "../../server/connectors/types.ts";

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
  afterEach(() => {
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
    expect(result.detail).toMatch(/Connected successfully/);
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

    // 2. Check that the cancelled instance (2026-01-12) was skipped
    const cancelledInstance = interactionEvents.find((e) =>
      "externalId" in e && typeof e.externalId === "string"
        ? e.externalId.includes("2026-01-12") ||
          e.externalId.includes("20260112")
        : false,
    );
    expect(cancelledInstance).toBeUndefined();

    // 3. Check that non-cancelled recurring instances were produced
    const baseInstance = interactionEvents.find((e) =>
      "externalId" in e && typeof e.externalId === "string"
        ? e.externalId.includes("weekly-sync@example.com")
        : false,
    );
    expect(baseInstance).toBeDefined();

    // 4. Check all-day event
    const allDay = interactionEvents.find((e) =>
      "title" in e ? e.title === "Company Offsite" : false,
    );
    expect(allDay).toBeDefined();
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
});
