import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "crypto";
import { sqlite } from "../../server/db.ts";
import { makeTestApp } from "./helpers.ts";
import { asUser, createActor, type Actor } from "./tenancy/helpers.ts";
import { isoWeekStart } from "../../shared/dates.ts";

let app: ReturnType<typeof makeTestApp>;
let actor: Actor;

beforeAll(async () => {
  process.env.AUTH_REQUIRED = "true";
  app = makeTestApp();
  actor = await createActor(app, {
    username: "dashuser",
    email: "dashuser@test.dev",
  });
});

afterAll(() => {
  delete process.env.AUTH_REQUIRED;
  app.close();
});

const getDashboard = () => asUser(actor)(request(app).get("/api/dashboard"));

describe("GET /api/dashboard", () => {
  it("returns the full payload with hygiene, meetings, and correspondents", async () => {
    const res = await getDashboard();
    expect(res.status).toBe(200);

    // Standard properties
    expect(res.body).toHaveProperty("overdue");
    expect(res.body).toHaveProperty("dueToday");
    expect(res.body).toHaveProperty("upcoming");
    expect(res.body).toHaveProperty("ghosts");
    expect(res.body).toHaveProperty("metrics");
    expect(res.body).toHaveProperty("catchUp");
    expect(res.body).toHaveProperty("tracking");
    expect(res.body).toHaveProperty("recentlyAdded");
    expect(res.body).toHaveProperty("industryComposition");
    expect(res.body).toHaveProperty("locationComposition");
    expect(res.body).toHaveProperty("roleComposition");
    expect(res.body).toHaveProperty("interactionBreakdown30d");
    expect(res.body).toHaveProperty("networkGrowthTimeline30d");

    // New pulse properties
    expect(res.body).toHaveProperty("hygiene");
    expect(res.body.hygiene).toMatchObject({
      missingCompany: expect.any(Number),
      missingLocation: expect.any(Number),
      missingEmail: expect.any(Number),
      stale: expect.any(Number),
    });
    expect(Array.isArray(res.body.meetings)).toBe(true);
    expect(typeof res.body.correspondents).toBe("number");
  });

  it("calculates hygiene counts accurately", async () => {
    const contactId = crypto.randomUUID();
    const staleDate = new Date(Date.now() - 200 * 86_400_000).toISOString();

    // Insert a contact with missing company, missing location, missing email, and stale
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, company, location, ownerId, addedAt, updatedAt, isGhost, isArchived)
         VALUES (?, 'Hygiene Test Contact', NULL, '', ?, ?, ?, 0, 0)`,
      )
      .run(contactId, actor.user.id, staleDate, staleDate);

    const res = await getDashboard();
    expect(res.status).toBe(200);
    expect(res.body.hygiene.missingCompany).toBeGreaterThanOrEqual(1);
    expect(res.body.hygiene.missingLocation).toBeGreaterThanOrEqual(1);
    expect(res.body.hygiene.missingEmail).toBeGreaterThanOrEqual(1);
    expect(res.body.hygiene.stale).toBeGreaterThanOrEqual(1);

    // Add an email to contact_emails and company/location to contacts
    sqlite
      .prepare(
        `INSERT INTO contact_emails (id, contactId, email, label, isPrimary)
         VALUES (?, ?, 'hygiene@example.com', 'work', 1)`,
      )
      .run(crypto.randomUUID(), contactId);

    sqlite
      .prepare(
        `UPDATE contacts SET company = 'Acme Inc', location = 'SF', updatedAt = datetime('now')
         WHERE id = ?`,
      )
      .run(contactId);

    const res2 = await getDashboard();
    expect(res2.status).toBe(200);
    expect(res2.body.hygiene.stale).toBe(0);
  });

  it("returns empty meetings array when upcoming_events table does not exist", async () => {
    // In our test database upcoming_events table is not created
    const res = await getDashboard();
    expect(res.status).toBe(200);
    expect(res.body.meetings).toEqual([]);
  });

  it("returns birthday on slim contacts list", async () => {
    const contactId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, ownerId, birthday) VALUES (?, 'Birthday Contact', ?, '1990-05-14')`,
      )
      .run(contactId, actor.user.id);

    const res = await asUser(actor)(
      request(app).get("/api/contacts?view=slim"),
    );
    expect(res.status).toBe(200);
    const found = res.body.find((c: { id: string }) => c.id === contactId);
    expect(found).toBeDefined();
    expect(found.birthday).toBe("1990-05-14");
  });
});

// =============================================================================
// Tracking on the payload: catchUp and tracking, in their own account so the
// other cases above cannot move the numbers.
// =============================================================================

/** A SQLite timestamp `days` ago, the way the triggers write `trackedAt`. */
function sqliteDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
}

describe("GET /api/dashboard tracking", () => {
  let tracker: Actor;
  const get = () => asUser(tracker)(request(app).get("/api/dashboard"));

  interface Person {
    name: string;
    isTracked?: boolean;
    trackedAt?: string | null;
    cadenceDays?: number;
    lastContactedAt?: string | null;
    relationshipScore?: number | null;
  }
  const insert = (person: Person): string => {
    const id = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, ownerId, isTracked, trackedAt, cadenceDays, lastContactedAt, relationshipScore, isGhost, isArchived)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      )
      .run(
        id,
        person.name,
        tracker.user.id,
        person.isTracked === false ? 0 : 1,
        person.trackedAt ?? sqliteDaysAgo(400),
        person.cadenceDays ?? 90,
        person.lastContactedAt ?? null,
        person.relationshipScore ?? null,
      );
    return id;
  };

  beforeAll(async () => {
    tracker = await createActor(app, {
      username: "trackuser",
      email: "trackuser@test.dev",
    });
  });

  it("leaves out the fields tracking replaced", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.atRisk).toBeUndefined();
    expect(res.body.metrics.atRiskCount).toBeUndefined();
    expect(res.body.metrics.avgDaysSinceInteraction).toBeUndefined();
    expect(res.body.metrics.totalInteractions30d).toBeUndefined();
    expect(Object.keys(res.body.metrics).sort()).toEqual([
      "newContacts30d",
      "totalActive",
    ]);
  });

  it("uses trackedAt as the clock for a contact with no interaction", async () => {
    // Tracked 40 days ago at every month, nothing logged: 10 days past due.
    const quiet = insert({
      name: "Quiet Tracked",
      trackedAt: sqliteDaysAgo(40),
      cadenceDays: 30,
    });
    // Tracked 10 days ago at every month: not due for another 20 days.
    const fresh = insert({
      name: "Fresh Tracked",
      trackedAt: sqliteDaysAgo(10),
      cadenceDays: 30,
    });
    // Not tracked at all, however quiet.
    const untracked = insert({
      name: "Untracked Quiet",
      isTracked: false,
      lastContactedAt: sqliteDaysAgo(400),
      cadenceDays: 30,
    });

    const res = await get();
    const ids = (res.body.catchUp as { id: string }[]).map((c) => c.id);
    expect(ids).toContain(quiet);
    expect(ids).not.toContain(fresh);
    expect(ids).not.toContain(untracked);

    const card = (
      res.body.catchUp as {
        id: string;
        daysSince: number;
        overshootDays: number;
        cadenceDays: number;
      }[]
    ).find((c) => c.id === quiet)!;
    expect(card.cadenceDays).toBe(30);
    expect(card.daysSince).toBe(40);
    expect(card.overshootDays).toBe(10);
  });

  it("lists ten at most, the furthest past due first, and counts past the limit", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      ids.push(
        insert({
          name: `Overdue ${String(i).padStart(2, "0")}`,
          cadenceDays: 10,
          // 25 to 47 days quiet: 15 to 37 past due.
          lastContactedAt: sqliteDaysAgo(25 + i * 2),
          relationshipScore: 75,
        }),
      );
    }

    const res = await get();
    const list = res.body.catchUp as { id: string; overshootDays: number }[];
    expect(list).toHaveLength(10);
    for (let i = 0; i < list.length - 1; i++) {
      expect(list[i].overshootDays).toBeGreaterThanOrEqual(
        list[i + 1].overshootDays,
      );
    }
    // The one furthest past due is the last inserted, 47 days quiet.
    expect(list[0].id).toBe(ids[11]);
    expect(list[0].overshootDays).toBe(37);
    // Twelve here and Quiet Tracked from the case above.
    expect(res.body.tracking.catchUpCount).toBe(13);
  });

  it("counts the bands with the ring's cuts, and they sum to the count", async () => {
    insert({
      name: "Strong One",
      lastContactedAt: sqliteDaysAgo(3),
      relationshipScore: 80,
    });
    insert({
      name: "Fading One",
      lastContactedAt: sqliteDaysAgo(20),
      relationshipScore: 55,
    });
    insert({
      name: "Risk One",
      lastContactedAt: sqliteDaysAgo(60),
      relationshipScore: 20,
    });
    // Tracked with no interaction, and a score column that still holds the
    // placeholder: unscored, whatever the number says.
    insert({ name: "Unscored One", relationshipScore: 50 });

    const res = await get();
    const { count, bands } = res.body.tracking as {
      count: number;
      bands: Record<string, number>;
    };
    expect(bands.strong).toBeGreaterThanOrEqual(1);
    expect(bands.fading).toBeGreaterThanOrEqual(1);
    expect(bands.atRisk).toBeGreaterThanOrEqual(1);
    expect(bands.unscored).toBeGreaterThanOrEqual(1);
    expect(bands.strong + bands.fading + bands.atRisk + bands.unscored).toBe(
      count,
    );
    // Every tracked, active contact of this account is in the count.
    const tracked = sqlite
      .prepare(
        `SELECT COUNT(*) as n FROM contacts WHERE ownerId = ? AND isTracked = 1 AND deletedAt IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)`,
      )
      .get(tracker.user.id) as { n: number };
    expect(count).toBe(tracked.n);
  });

  it("counts the contacts tracked in the last 30 days", async () => {
    const before = ((await get()).body.tracking as { startedLast30d: number })
      .startedLast30d;
    insert({ name: "New Track A", trackedAt: sqliteDaysAgo(2) });
    insert({ name: "New Track B", trackedAt: sqliteDaysAgo(29) });
    insert({ name: "Old Track", trackedAt: sqliteDaysAgo(31) });
    const after = ((await get()).body.tracking as { startedLast30d: number })
      .startedLast30d;
    expect(after - before).toBe(2);
  });

  it("feeds the palette's zero state from the same rule: the two furthest past due", async () => {
    const res = await asUser(tracker)(
      request(app).get("/api/command-palette/zero-state"),
    );
    expect(res.status).toBe(200);
    const signals = (
      res.body.insights as {
        type: string;
        label: string;
        contact?: { name: string };
        overshootDays?: number;
      }[]
    ).filter((i) => i.type === "catch_up");
    expect(signals).toHaveLength(2);
    // The two furthest past due of the cases above: Unscored One, tracked
    // 400 days ago with nothing logged (310 past every 3 months), then
    // Overdue 11 at 37 days.
    expect(signals.map((i) => i.overshootDays)).toEqual([310, 37]);
    expect(signals.map((i) => i.contact?.name)).toEqual([
      "Unscored One",
      "Overdue 11",
    ]);
    expect(signals[0].label).toBe("Unscored One, 10 months past due");
    expect(signals[1].label).toBe("Overdue 11, 5 weeks past due");
    expect(
      res.body.insights.some((i: { type: string }) => i.type === "at_risk"),
    ).toBe(false);
  });

  it("gives rising and cooling three each way once four snapshot weeks exist", async () => {
    const now = new Date();
    const weeks = [0, 1, 2, 3, 4].map((n) =>
      isoWeekStart(new Date(now.getTime() - n * 7 * 86_400_000)),
    );
    const snapshot = (id: string, week: string, score: number) =>
      sqlite
        .prepare(
          `INSERT INTO score_snapshots (ownerId, contactId, weekStart, score) VALUES (?, ?, ?, ?)`,
        )
        .run(tracker.user.id, id, week, score);

    // Six rising contacts, tracked before the baseline week, deltas 8 to 18.
    const rising: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = insert({
        name: `Rising ${i}`,
        trackedAt: "2020-01-01 00:00:00",
        lastContactedAt: sqliteDaysAgo(5),
        relationshipScore: 80,
      });
      rising.push(id);
      for (const w of weeks.slice(1)) snapshot(id, w, 40);
      snapshot(id, weeks[0], 40 + (i + 4) * 2);
    }
    // One cooling contact: 80 to 50.
    const cooling = insert({
      name: "Cooling Person",
      trackedAt: "2020-01-01 00:00:00",
      lastContactedAt: sqliteDaysAgo(5),
      relationshipScore: 50,
    });
    for (const w of weeks.slice(1)) snapshot(cooling, w, 80);
    snapshot(cooling, weeks[0], 50);
    // Tracked after the baseline week: neither rising nor cooling, however
    // far the snapshots moved.
    const late = insert({
      name: "Late Tracker",
      trackedAt: sqliteDaysAgo(2),
      lastContactedAt: sqliteDaysAgo(5),
      relationshipScore: 90,
    });
    for (const w of weeks.slice(1)) snapshot(late, w, 40);
    snapshot(late, weeks[0], 90);

    const res = await get();
    const tracking = res.body.tracking as {
      snapshotWeeks: number;
      rising: { id: string; delta: number }[];
      cooling: { id: string; delta: number }[];
    };
    expect(tracking.snapshotWeeks).toBeGreaterThanOrEqual(4);
    expect(tracking.rising).toHaveLength(3);
    for (let i = 0; i < tracking.rising.length - 1; i++) {
      expect(tracking.rising[i].delta).toBeGreaterThanOrEqual(
        tracking.rising[i + 1].delta,
      );
    }
    expect(tracking.rising[0].id).toBe(rising[5]);
    expect(tracking.rising.map((r) => r.id)).not.toContain(late);
    expect(tracking.cooling).toHaveLength(1);
    expect(tracking.cooling[0]).toMatchObject({ id: cooling, delta: -30 });
  });
});
