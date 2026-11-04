/**
 * The Calendar (ICS) connector against a feed served over HTTP, changed
 * between syncs as a calendar changes.
 */

import { afterAll, describe, expect, it } from "vitest";
import { sqlite } from "../../server/db.ts";
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
});
