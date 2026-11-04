/**
 * The Calendar (ICS) connector against a feed served over HTTP, changed
 * between syncs as a calendar changes.
 */

import { afterAll, describe, expect, it } from "vitest";
import { sqlite } from "../../server/db.ts";
import { icsAdapter } from "../../server/connectors/adapters/ics.ts";
import { createConnector, runNow } from "../../server/connectors/service.ts";
import { contactService } from "../../server/services/contactService.ts";
import { calendar, DAY_MS, icsFeed, icsTime, labOwner } from "./helpers.ts";

const feeds: Array<{ close(): Promise<void> }> = [];
afterAll(() => Promise.all(feeds.map((f) => f.close())));

/** 09:00 UTC, `days` from today. */
function at9(days: number): Date {
  const d = new Date(Date.now() + days * DAY_MS);
  d.setUTCHours(9, 0, 0, 0);
  return d;
}

const HOUR_MS = 3_600_000;

/** A one-hour VEVENT at `start` with the given property lines. */
function vevent(uid: string, start: Date, ...lines: string[]): string {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsTime(new Date())}`,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(new Date(start.getTime() + HOUR_MS))}`,
    ...lines,
    "END:VEVENT",
  ].join("\r\n");
}

async function labFeed(body: string) {
  const feed = await icsFeed();
  feeds.push(feed);
  feed.set(body);
  return feed;
}

const upcomingOf = (ownerId: string) =>
  (
    sqlite
      .prepare(
        "SELECT title FROM upcoming_events WHERE ownerId = ? ORDER BY startsAt",
      )
      .all(ownerId) as { title: string }[]
  ).map((r) => r.title);

const meetingTitles = (contactId: string) =>
  (
    sqlite
      .prepare(
        "SELECT title FROM interactions WHERE contactId = ? ORDER BY date",
      )
      .all(contactId) as { title: string }[]
  ).map((r) => r.title);

describe("ICS against a served feed", () => {
  it("logs past meetings once, lists upcoming ones, and follows a changed feed", async () => {
    const { ownerId, scope, email: me } = labOwner();
    const ana = contactService.createContact(scope, {
      name: "Ana Lee",
      emails: [{ email: "ana@lee.example", label: "work" }],
    })!;
    const people = [
      `ORGANIZER;CN=Me:mailto:${me}`,
      "ATTENDEE;CN=Ana Lee;PARTSTAT=ACCEPTED:mailto:ana@lee.example",
    ];
    const event = (uid: string, start: Date, lines: string[] = []) =>
      [
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${icsTime(new Date())}`,
        `DTSTART:${icsTime(start)}`,
        `DTEND:${icsTime(new Date(start.getTime() + HOUR_MS))}`,
        ...people,
        ...lines,
        "END:VEVENT",
      ].join("\r\n");

    // A weekly series from 20 days ago: one date taken out, one moved by two
    // hours and renamed, and its fourth meeting tomorrow.
    const series = at9(-20);
    const week = (n: number) => new Date(series.getTime() + n * 7 * DAY_MS);
    const standup = [
      event("standup@lab", series, [
        "SUMMARY:Standup",
        "RRULE:FREQ=WEEKLY;COUNT=4",
        `EXDATE:${icsTime(week(1))}`,
      ]),
      event("standup@lab", new Date(week(2).getTime() + 2 * HOUR_MS), [
        "SUMMARY:Moved standup",
        `RECURRENCE-ID:${icsTime(week(2))}`,
      ]),
    ];
    // 15:00 in Kolkata (UTC+5:30, no daylight saving) is 09:30 UTC.
    const kolkataDay = at9(-2);
    const kolkataLocal = icsTime(kolkataDay).slice(0, 8) + "T150000";
    const kolkata = [
      "BEGIN:VEVENT",
      "UID:kolkata@lab",
      `DTSTAMP:${icsTime(new Date())}`,
      `DTSTART;TZID=Asia/Kolkata:${kolkataLocal}`,
      `DTEND;TZID=Asia/Kolkata:${kolkataLocal.slice(0, 9)}160000`,
      "SUMMARY:Call with Mumbai",
      ...people,
      "END:VEVENT",
    ].join("\r\n");
    const kickoff = event("kickoff@lab", at9(-3), ["SUMMARY:Kickoff"]);
    const review = (cancelled: boolean) =>
      event("review@lab", at9(5), [
        "SUMMARY:Review",
        ...(cancelled ? ["STATUS:CANCELLED"] : []),
      ]);

    const feed = await icsFeed();
    feeds.push(feed);
    feed.set(calendar(kickoff, ...standup, kolkata, review(false)));
    const connector = await createConnector(scope, {
      kind: "ics",
      name: "Lab calendar",
      config: { url: feed.url },
    });

    const first = await runNow(scope, connector.id);
    expect(first.status).toBe("ok");
    expect(first.stats.errors ?? 0).toBe(0);
    const meetings = () =>
      sqlite
        .prepare(
          `SELECT title, date FROM interactions
            WHERE contactId = ? ORDER BY date`,
        )
        .all(ana.id) as { title: string; date: string }[];
    expect(meetings().map((m) => m.title)).toEqual([
      "Standup",
      "Moved standup",
      "Kickoff",
      "Call with Mumbai",
    ]);
    expect(meetings()[1].date.slice(11, 16)).toBe("11:00");
    expect(meetings()[3].date.slice(11, 16)).toBe("09:30");
    const upcoming = () =>
      (
        sqlite
          .prepare(
            "SELECT title FROM upcoming_events WHERE ownerId = ? ORDER BY startsAt",
          )
          .all(ownerId) as { title: string }[]
      ).map((r) => r.title);
    expect(upcoming()).toEqual(["Standup", "Review"]);

    // The review is cancelled: it leaves Coming up, and nothing is logged
    // twice.
    feed.set(calendar(kickoff, ...standup, kolkata, review(true)));
    const second = await runNow(scope, connector.id);
    expect(second.status).toBe("ok");
    expect(meetings()).toHaveLength(4);
    expect(upcoming()).toEqual(["Standup"]);
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
    const connector = await createConnector(scope, {
      kind: "ics",
      name: "Lab calendar",
      config: { url: feed.url, aliases: [cal], ghostThreshold: 10 },
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
    const ana = contactService.createContact(scope, {
      name: "Ana Lee",
      emails: [{ email: "ana@lee.example", label: "work" }],
    })!;
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
    const connector = await createConnector(scope, {
      kind: "ics",
      name: "Lab calendar",
      config: { url: feed.url },
    });

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

  it("fails a run, and the test, when the address returns a page that is not a calendar", async () => {
    const { ownerId, scope } = labOwner();
    const review = vevent(
      "review@lab",
      at9(5),
      "SUMMARY:Review",
      "ATTENDEE:mailto:ana@lee.example",
    );
    const feed = await labFeed(calendar(review));
    const connector = await createConnector(scope, {
      kind: "ics",
      name: "Lab calendar",
      config: { url: feed.url },
    });
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
