/**
 * Unit: the ICS Calendar adapter's niche cases. The sync itself is proven
 * against a served feed in tests/lab/ics.lab.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { icsAdapter } from "../../../../server/connectors/adapters/ics.ts";
import type { SyncEvent } from "../../../../server/connectors/types.ts";

type Item = Extract<SyncEvent, { kind: "interaction" | "upcoming" }>;

describe("icsAdapter", () => {
  // The adapter sets its window from the clock. A fixed date keeps the
  // events below in it.
  beforeEach(() => {
    process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "true";
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

  /** The meetings and upcoming events of a feed of these VEVENT lines. */
  async function syncFeed(
    body: string,
    url = "https://example.com/calendar.ics",
    log: (msg: string) => void = () => {},
  ): Promise<Item[]> {
    const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body.trim().replace(/\n/g, "\r\n")}\r\nEND:VCALENDAR`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(ics, { status: 200 })),
    );
    const events: Item[] = [];
    for await (const ev of icsAdapter.sync({
      config: { url, lookbackDays: 365 },
      secret: null,
      cursor: null,
      since: "2025-03-01T00:00:00.000Z",
      selfAddresses: { emails: ["me@example.com"], phones: [] },
      signal: new AbortController().signal,
      log,
    })) {
      if (ev.kind === "interaction" || ev.kind === "upcoming") events.push(ev);
    }
    return events;
  }

  it("skips rules that repeat within the hour, and never logs the feed's address", async () => {
    // Before, these gave about 9,500 and 19,000 writes. Every BYSECOND too
    // aborts the process inside the parser, so no test expands one.
    const hours = Array.from({ length: 24 }, (_, i) => i).join(",");
    const event = (uid: string, rule: string) => `BEGIN:VEVENT
UID:${uid}
DTSTART:20260201T100000Z
DTEND:20260201T101000Z
RRULE:${rule}
SUMMARY:${uid}
END:VEVENT`;
    const logged: string[] = [];
    const events = await syncFeed(
      `${event("hourly", "FREQ=HOURLY")}
${event("half-hourly", `FREQ=DAILY;BYHOUR=${hours};BYMINUTE=0,30`)}`,
      "https://calendar.example.com/ical/me%40example.com/private-5ecret/basic.ics",
      (msg) => logged.push(msg),
    );

    expect(events).toEqual([]);
    expect(logged.join("\n")).not.toMatch(/5ecret|example\.com/);
  });

  it("keys an all-day recurring instance by its day, and names the instant earlier versions used", async () => {
    // node-ical builds an all-day instance at the server's local midnight, so
    // its instant depends on the server's zone and on DST: a move to a UTC
    // container changed every id and imported every past instance again.
    const events = await syncFeed(`BEGIN:VEVENT
UID:allday-weekly
DTSTART;VALUE=DATE:20260216
DTEND;VALUE=DATE:20260217
RRULE:FREQ=WEEKLY;COUNT=2
SUMMARY:Standup day
ATTENDEE:mailto:bob@example.com
END:VEVENT`);
    const localMidnight = (d: number) => new Date(2026, 1, d).toISOString();
    expect(
      events.map((e) => [
        e.externalId,
        (e as { legacyExternalIds?: string[] }).legacyExternalIds,
      ]),
    ).toEqual([
      ["allday-weekly_2026-02-16", [`allday-weekly_${localMidnight(16)}`]],
      ["allday-weekly_2026-02-23", [`allday-weekly_${localMidnight(23)}`]],
    ]);
  });

  it("gives an event without a UID its own id, and drops rooms and attendees who declined, in any case and in an override", async () => {
    // An override that lists only people who declined fell back to the
    // series' attendees. RFC 5545 parameter values are case-insensitive.
    const events = await syncFeed(`BEGIN:VEVENT
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
UID:sync
DTSTART:20260209T150000Z
DTEND:20260209T160000Z
RRULE:FREQ=WEEKLY;COUNT=2
SUMMARY:Sync
ORGANIZER;CN=Alice:mailto:alice@example.com
ATTENDEE;PARTSTAT=ACCEPTED:mailto:bob@example.com
ATTENDEE;CUTYPE=RESOURCE;CN=Room 4:mailto:room4@example.com
ATTENDEE;CUTYPE=room:mailto:room5@example.com
ATTENDEE;PARTSTAT=declined:mailto:carol@example.com
END:VEVENT
BEGIN:VEVENT
UID:sync
RECURRENCE-ID:20260216T150000Z
DTSTART:20260216T150000Z
DTEND:20260216T160000Z
SUMMARY:Sync
ATTENDEE;PARTSTAT=DECLINED:mailto:bob@example.com
END:VEVENT`);
    const noUid = events.filter((e) => e.title.startsWith("No UID"));
    expect(new Set(noUid.map((e) => e.externalId)).size).toBe(2);
    expect(noUid.map((e) => e.externalId)).not.toContain("undefined");
    const people = (id: string) =>
      events.find((e) => e.externalId === id)?.participants;
    expect(people("sync_2026-02-09T15:00:00.000Z")).toEqual([
      { email: "alice@example.com", name: "Alice" },
      { email: "bob@example.com", name: undefined },
    ]);
    expect(people("sync_2026-02-16T15:00:00.000Z")).toEqual([]);
  });

  it("refuses a feed address that is not http(s), even with private hosts allowed", async () => {
    await expect(
      icsAdapter.test({ url: "data:text/calendar,BEGIN%3AVCALENDAR" }, null),
    ).rejects.toThrow(/http/i);
  });
});
