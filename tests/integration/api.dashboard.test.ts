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

const getActivity = () =>
  asUser(actor)(request(app).get("/api/dashboard/activity"));

const getMomentum = () =>
  asUser(actor)(request(app).get("/api/dashboard/momentum"));

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
    expect(res.body).toHaveProperty("atRisk");
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
});

describe("GET /api/dashboard/activity", () => {
  it("returns 84 days, 12 weeks, streak and today counts", async () => {
    const res = await getActivity();
    expect(res.status).toBe(200);

    expect(res.body.days).toHaveLength(84);
    expect(res.body.weekTotals).toHaveLength(12);
    expect(res.body.prevWeekTotals).toHaveLength(12);
    expect(res.body.streak).toMatchObject({
      current: expect.any(Number),
      best: expect.any(Number),
    });
    expect(res.body.today).toMatchObject({
      logged: expect.any(Number),
      completed: expect.any(Number),
      due: expect.any(Number),
    });
    expect(res.body.thisWeek).toMatchObject({
      logged: expect.any(Number),
      byType: expect.any(Object),
    });
  });

  it("updates logged count and streak when an interaction is added today", async () => {
    const contactId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, ownerId) VALUES (?, 'Activity Contact', ?)`,
      )
      .run(contactId, actor.user.id);

    const todayIso = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO interactions (id, contactId, ownerId, date, type, title)
         VALUES (?, ?, ?, ?, 'call', 'Today Catchup')`,
      )
      .run(crypto.randomUUID(), contactId, actor.user.id, todayIso);

    const res = await getActivity();
    expect(res.status).toBe(200);
    expect(res.body.today.logged).toBeGreaterThanOrEqual(1);
    expect(res.body.streak.current).toBeGreaterThanOrEqual(1);
    expect(res.body.thisWeek.logged).toBeGreaterThanOrEqual(1);
    expect(res.body.thisWeek.byType.call).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /api/dashboard/momentum", () => {
  it("returns rising, cooling, and silent contacts", async () => {
    // 1. Silent contact: cadenceDays = 14, lastContactedAt = 30 days ago, score = 80 (not atRisk)
    const silentId = crypto.randomUUID();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, ownerId, cadenceDays, lastContactedAt, relationshipScore, isGhost, isArchived)
         VALUES (?, 'Silent Contact', ?, 14, ?, 80, 0, 0)`,
      )
      .run(silentId, actor.user.id, thirtyDaysAgo);

    // Initial momentum response before 4 snapshot weeks
    const resInit = await getMomentum();
    expect(resInit.status).toBe(200);
    expect(
      resInit.body.silent.some((c: { id: string }) => c.id === silentId),
    ).toBe(true);

    // 2. Rising and cooling contacts: seed 4 weeks of snapshots
    const contactRisingId = crypto.randomUUID();
    const contactCoolingId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, ownerId, relationshipScore, isGhost, isArchived)
         VALUES (?, 'Rising Contact', ?, 85, 0, 0)`,
      )
      .run(contactRisingId, actor.user.id);
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, ownerId, relationshipScore, isGhost, isArchived)
         VALUES (?, 'Cooling Contact', ?, 45, 0, 0)`,
      )
      .run(contactCoolingId, actor.user.id);

    const now = new Date();
    const weeks = [0, 1, 2, 4].map((w) =>
      isoWeekStart(new Date(now.getTime() - w * 7 * 86_400_000)),
    );

    // Insert snapshots for rising contact: baseline (week 4) = 50, current (week 0) = 85 (delta +35)
    sqlite
      .prepare(
        `INSERT INTO score_snapshots (ownerId, contactId, weekStart, score) VALUES (?, ?, ?, ?)`,
      )
      .run(actor.user.id, contactRisingId, weeks[3], 50);
    sqlite
      .prepare(
        `INSERT INTO score_snapshots (ownerId, contactId, weekStart, score) VALUES (?, ?, ?, ?)`,
      )
      .run(actor.user.id, contactRisingId, weeks[2], 60);
    sqlite
      .prepare(
        `INSERT INTO score_snapshots (ownerId, contactId, weekStart, score) VALUES (?, ?, ?, ?)`,
      )
      .run(actor.user.id, contactRisingId, weeks[1], 70);
    sqlite
      .prepare(
        `INSERT INTO score_snapshots (ownerId, contactId, weekStart, score) VALUES (?, ?, ?, ?)`,
      )
      .run(actor.user.id, contactRisingId, weeks[0], 85);

    // Insert snapshots for cooling contact: baseline (week 4) = 80, current (week 0) = 45 (delta -35)
    sqlite
      .prepare(
        `INSERT INTO score_snapshots (ownerId, contactId, weekStart, score) VALUES (?, ?, ?, ?)`,
      )
      .run(actor.user.id, contactCoolingId, weeks[3], 80);
    sqlite
      .prepare(
        `INSERT INTO score_snapshots (ownerId, contactId, weekStart, score) VALUES (?, ?, ?, ?)`,
      )
      .run(actor.user.id, contactCoolingId, weeks[2], 70);
    sqlite
      .prepare(
        `INSERT INTO score_snapshots (ownerId, contactId, weekStart, score) VALUES (?, ?, ?, ?)`,
      )
      .run(actor.user.id, contactCoolingId, weeks[1], 60);
    sqlite
      .prepare(
        `INSERT INTO score_snapshots (ownerId, contactId, weekStart, score) VALUES (?, ?, ?, ?)`,
      )
      .run(actor.user.id, contactCoolingId, weeks[0], 45);

    const res = await getMomentum();
    expect(res.status).toBe(200);
    expect(res.body.snapshotWeeks).toBeGreaterThanOrEqual(4);

    const risingMatch = res.body.rising.find(
      (c: { id: string }) => c.id === contactRisingId,
    );
    expect(risingMatch).toBeDefined();
    expect(risingMatch.delta).toBe(35);

    const coolingMatch = res.body.cooling.find(
      (c: { id: string }) => c.id === contactCoolingId,
    );
    expect(coolingMatch).toBeDefined();
    expect(coolingMatch.delta).toBe(-35);
  });
});
