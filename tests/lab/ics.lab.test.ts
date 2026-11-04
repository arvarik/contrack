/**
 * The Calendar (ICS) connector against a feed served over HTTP, changed
 * between syncs as a calendar changes.
 */

import { afterAll, describe, expect, it } from "vitest";
import { sqlite } from "../../server/db.ts";
import { icsAdapter } from "../../server/connectors/adapters/ics.ts";
import { createConnector, runNow } from "../../server/connectors/service.ts";
import { contactService } from "../../server/services/contactService.ts";
import type { Scope } from "../../server/tenancy/scope.ts";
import {
  calendar,
  DAY_MS,
  icsFeed,
  icsTime,
  labOwner,
  RADICALE,
  radicaleBook,
} from "./helpers.ts";

const feeds: Array<{ close(): Promise<void> }> = [];
afterAll(() => Promise.all(feeds.map((f) => f.close())));

/** 09:00 UTC, `days` from today. */
function at9(days: number): Date {
  const d = new Date(Date.now() + days * DAY_MS);
  d.setUTCHours(9, 0, 0, 0);
  return d;
}

const HOUR_MS = 3_600_000;

/** A VEVENT with the given property lines. */
const rawEvent = (uid: string, ...lines: string[]) =>
  [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsTime(new Date())}`,
    ...lines,
    "END:VEVENT",
  ].join("\r\n");

/** A one-hour VEVENT at `start` with the given property lines. */
const vevent = (uid: string, start: Date, ...lines: string[]) =>
  rawEvent(
    uid,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(new Date(start.getTime() + HOUR_MS))}`,
    ...lines,
  );

async function labFeed(body: string) {
  const feed = await icsFeed();
  feeds.push(feed);
  feed.set(body);
  return feed;
}

const column = (sql: string, ...params: unknown[]) =>
  sqlite
    .prepare(sql)
    .pluck()
    .all(...params);

const upcomingOf = (ownerId: string) =>
  column(
    "SELECT title FROM upcoming_events WHERE ownerId = ? ORDER BY startsAt",
    ownerId,
  );

const meetingTitles = (contactId: string) =>
  column(
    "SELECT title FROM interactions WHERE contactId = ? ORDER BY date",
    contactId,
  );

const calendarConnector = (
  scope: Scope,
  url: string,
  config: Record<string, unknown> = {},
) =>
  createConnector(scope, {
    kind: "ics",
    name: "Lab calendar",
    config: { url, ...config },
  });

const addAna = (scope: Scope) =>
  contactService.createContact(scope, {
    name: "Ana Lee",
    emails: [{ email: "ana@lee.example", label: "work" }],
  })!;

describe("ICS against a served feed", () => {
  it("logs past meetings once, lists upcoming ones, and follows a changed feed", async () => {
    const { ownerId, scope, email: me } = labOwner();
    const ana = addAna(scope);
    const people = [
      `ORGANIZER;CN=Me:mailto:${me}`,
      "ATTENDEE;CN=Ana Lee;PARTSTAT=ACCEPTED:mailto:ana@lee.example",
    ];
    const event = (uid: string, start: Date, ...lines: string[]) =>
      vevent(uid, start, ...people, ...lines);

    // A weekly series from 20 days ago: one date taken out, one moved by two
    // hours and renamed, its fourth meeting tomorrow, and its fifth cancelled.
    const series = at9(-20);
    const week = (n: number) => new Date(series.getTime() + n * 7 * DAY_MS);
    const standup = [
      event(
        "standup@lab",
        series,
        "SUMMARY:Standup",
        "RRULE:FREQ=WEEKLY;COUNT=5",
        `EXDATE:${icsTime(week(1))}`,
      ),
      event(
        "standup@lab",
        new Date(week(2).getTime() + 2 * HOUR_MS),
        "SUMMARY:Moved standup",
        `RECURRENCE-ID:${icsTime(week(2))}`,
      ),
      event(
        "standup@lab",
        week(4),
        "SUMMARY:Standup",
        `RECURRENCE-ID:${icsTime(week(4))}`,
        "STATUS:CANCELLED",
      ),
    ];
    // 15:00 in Kolkata (UTC+5:30, no daylight saving) is 09:30 UTC.
    const kolkataLocal = icsTime(at9(-2)).slice(0, 8) + "T150000";
    const kolkata = rawEvent(
      "kolkata@lab",
      `DTSTART;TZID=Asia/Kolkata:${kolkataLocal}`,
      `DTEND;TZID=Asia/Kolkata:${kolkataLocal.slice(0, 9)}160000`,
      "SUMMARY:Call with Mumbai",
      ...people,
    );
    // An all-day event is kept as its day.
    const offsiteDay = icsTime(at9(-4)).slice(0, 8);
    const offsite = rawEvent(
      "offsite@lab",
      `DTSTART;VALUE=DATE:${offsiteDay}`,
      "SUMMARY:Offsite",
      ...people,
    );
    const kickoff = event(
      "kickoff@lab",
      at9(-3),
      "SUMMARY:Kickoff",
      "DESCRIPTION:Agenda: the roadmap",
    );
    // More attendees than the connector's cap of 25.
    const allHands = event(
      "all-hands@lab",
      at9(-1),
      "SUMMARY:All-hands",
      ...Array.from({ length: 30 }, (_, i) => `ATTENDEE:mailto:p${i}@ext.test`),
    );
    const review = (...lines: string[]) =>
      event("review@lab", at9(5), "SUMMARY:Review", ...lines);
    const feed = await labFeed(
      calendar(kickoff, ...standup, kolkata, offsite, allHands, review()),
    );
    const connector = await calendarConnector(scope, feed.url, {
      includeDescription: true,
    });

    const first = await runNow(scope, connector.id);
    expect(first.status).toBe("ok");
    expect(first.stats.errors ?? 0).toBe(0);
    const meetings = () =>
      sqlite
        .prepare(
          `SELECT title, date, content FROM interactions
            WHERE contactId = ? ORDER BY date`,
        )
        .all(ana.id) as { title: string; date: string; content: string }[];
    expect(meetings().map((m) => [m.title, m.date.slice(11, 16)])).toEqual([
      ["Standup", "09:00"],
      ["Moved standup", "11:00"],
      ["Offsite", ""],
      ["Kickoff", "09:00"],
      ["Call with Mumbai", "09:30"],
    ]);
    expect(meetings()[2].date).toBe(
      `${offsiteDay.slice(0, 4)}-${offsiteDay.slice(4, 6)}-${offsiteDay.slice(6)}`,
    );
    expect(meetings()[3].content).toContain("Agenda: the roadmap");
    // The contact was last in touch at the last meeting, not at the sync.
    expect(
      sqlite
        .prepare("SELECT lastContactedAt FROM contacts WHERE id = ?")
        .pluck()
        .get(ana.id),
    ).toBe(meetings()[4].date);
    expect(upcomingOf(ownerId)).toEqual(["Standup", "Review"]);

    // The review is cancelled: it leaves Coming up, and nothing is logged
    // twice.
    feed.set(
      calendar(
        kickoff,
        ...standup,
        kolkata,
        offsite,
        allHands,
        review("STATUS:CANCELLED"),
      ),
    );
    expect((await runNow(scope, connector.id)).status).toBe("ok");
    expect(meetings()).toHaveLength(5);
    expect(upcomingOf(ownerId)).toEqual(["Standup"]);
  });

  it("counts a stranger once per meeting, by address, and never the owner's calendar address or a shared calendar", async () => {
    const { scope } = labOwner();
    // The calendar's address is not the owner's login address.
    const cal = `cal-${scope.ownerId}@cal.test`;
    const feed = await labFeed(
      calendar(
        vevent(
          "old@lab",
          at9(-60),
          "SUMMARY:Old meeting",
          `ORGANIZER:mailto:${cal}`,
          "ATTENDEE;PARTSTAT=ACCEPTED:mailto:x@ext.test",
          // Outlook's attendee with no address, and a CalDAV one by urn.
          "ATTENDEE;CN=Hidden Person:invalid:nomail",
          "ATTENDEE;CN=Uma;EMAIL=uma@ext.test:urn:uuid:5d1f0c3a",
        ),
        vevent(
          "team@lab",
          at9(-30),
          "SUMMARY:Team meeting",
          "ORGANIZER;CN=Team:mailto:c_abc123@group.calendar.google.com",
          `ATTENDEE:mailto:${cal}`,
          "ATTENDEE:mailto:y@ext.test",
        ),
      ),
    );
    const connector = await calendarConnector(scope, feed.url, {
      aliases: [cal],
      ghostThreshold: 10,
    });
    for (let i = 0; i < 3; i++) {
      expect((await runNow(scope, connector.id)).status).toBe("ok");
    }

    expect(
      sqlite
        .prepare(
          `SELECT externalId, seenCount FROM connector_links
            WHERE connectorId = ? AND kind = 'correspondent' ORDER BY externalId`,
        )
        .all(connector.id),
    ).toEqual([
      { externalId: "Hidden Person", seenCount: 1 },
      { externalId: "uma@ext.test", seenCount: 1 },
      { externalId: "x@ext.test", seenCount: 1 },
      { externalId: "y@ext.test", seenCount: 1 },
    ]);
  });

  it("leaves out what the owner declined and events with no one else, and keeps single invited instances of a series", async () => {
    const { ownerId, scope, email: me } = labOwner();
    const ana = addAna(scope);
    const withAna = [
      "ORGANIZER;CN=Ana Lee:mailto:ana@lee.example",
      `ATTENDEE;PARTSTAT=ACCEPTED:mailto:${me}`,
    ];
    const declined = [
      "ORGANIZER;CN=Ana Lee:mailto:ana@lee.example",
      `ATTENDEE;PARTSTAT=DECLINED:mailto:${me}`,
    ];
    const others = [
      vevent(
        "declined-past@lab",
        at9(-2),
        "SUMMARY:Declined past",
        ...declined,
      ),
      vevent("declined-next@lab", at9(3), "SUMMARY:Declined next", ...declined),
      vevent("focus@lab", at9(2), "SUMMARY:Focus", `ORGANIZER:mailto:${me}`),
      vevent("reminder@lab", at9(2), "SUMMARY:Reminder"),
      vevent("review@lab", at9(5), "SUMMARY:Review", ...withAna),
    ];
    // Two instances of Ana's weekly planning, without the series itself.
    const instance = (week: number) =>
      vevent(
        "planning@lab",
        at9(-21 + 7 * week),
        `SUMMARY:Planning ${week}`,
        `RECURRENCE-ID:${icsTime(at9(-21 + 7 * week))}`,
        ...withAna,
      );
    const feed = await labFeed(calendar(instance(1), instance(2), ...others));
    const connector = await calendarConnector(scope, feed.url);

    expect((await runNow(scope, connector.id)).status).toBe("ok");
    expect(meetingTitles(ana.id)).toEqual(["Planning 1", "Planning 2"]);
    expect(upcomingOf(ownerId)).toEqual(["Review"]);

    // The owner is invited to the whole series: only its first is new.
    const series = vevent(
      "planning@lab",
      at9(-21),
      "SUMMARY:Planning",
      "RRULE:FREQ=WEEKLY;COUNT=3",
      ...withAna,
    );
    feed.set(calendar(series, instance(1), instance(2), ...others));
    expect((await runNow(scope, connector.id)).status).toBe("ok");
    expect(meetingTitles(ana.id)).toEqual([
      "Planning",
      "Planning 1",
      "Planning 2",
    ]);
  });

  it("counts a stranger once across two calendars, logs a meeting a robot-looking contact organized, and takes no CardDAV username for the owner", async () => {
    const { ownerId, scope, email: me } = labOwner();
    const sam = contactService.createContact(scope, {
      name: "Sam Lee",
      emails: [{ email: "sam@family.example", label: "personal" }],
    })!;
    const firm = contactService.createContact(scope, {
      name: "Acme Law",
      emails: [{ email: "info@acmelaw.example", label: "work" }],
    })!;
    // A family address book that signs in as Sam (a +tag keeps the lab user
    // new each run, and is the same mailbox): Sam stays a contact.
    const samLogin = `sam+${ownerId.slice(0, 8)}@family.example`;
    await radicaleBook(samLogin);
    await createConnector(scope, {
      kind: "carddav",
      name: "Family book",
      config: {
        url: `${RADICALE}/`,
        username: samLogin,
        syncDirection: "pull_only",
      },
      secret: { password: "lab" },
    });
    const body = calendar(
      vevent(
        "dinner@lab",
        at9(-3),
        "SUMMARY:Dinner",
        `ORGANIZER:mailto:${me}`,
        "ATTENDEE:mailto:sam@family.example",
      ),
      vevent(
        "closing@lab",
        at9(-2),
        "SUMMARY:Closing",
        "ORGANIZER;CN=Acme Law:mailto:info@acmelaw.example",
        `ATTENDEE:mailto:${me}`,
      ),
      vevent(
        "intro@lab",
        at9(-1),
        "SUMMARY:Intro",
        `ORGANIZER:mailto:${me}`,
        "ATTENDEE:mailto:zed@ext.test",
      ),
    );
    // Two calendars with the same meetings, as two shared feeds can have.
    for (const feed of [await labFeed(body), await labFeed(body)]) {
      const { id } = await calendarConnector(scope, feed.url);
      expect((await runNow(scope, id)).status).toBe("ok");
    }

    expect(meetingTitles(sam.id)).toEqual(["Dinner"]);
    expect(meetingTitles(firm.id)).toEqual(["Closing"]);
    expect(
      sqlite
        .prepare(
          `SELECT SUM(seenCount) AS n FROM connector_links
            WHERE ownerId = ? AND kind = 'correspondent' AND externalId = 'zed@ext.test'`,
        )
        .get(ownerId),
    ).toEqual({ n: 1 });
  });

  it("fails a run, and the test, when the address returns a page that is not a calendar", async () => {
    const { ownerId, scope } = labOwner();
    const review = vevent(
      "review@lab",
      at9(5),
      "SUMMARY:Review",
      "ATTENDEE:mailto:ana@lee.example",
    );
    const feed = await labFeed(calendar(review));
    const connector = await calendarConnector(scope, feed.url);
    expect((await runNow(scope, connector.id)).status).toBe("ok");
    expect(upcomingOf(ownerId)).toEqual(["Review"]);

    feed.set("<!doctype html><html><body>Sign in</body></html>");
    expect((await runNow(scope, connector.id)).status).toBe("error");
    expect(upcomingOf(ownerId)).toEqual(["Review"]);
    await expect(icsAdapter.test({ url: feed.url }, null)).rejects.toThrow(
      /not a calendar/,
    );
  });
});
