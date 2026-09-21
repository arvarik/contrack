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
    username: "momuser",
    email: "momuser@test.dev",
  });
});

afterAll(() => {
  delete process.env.AUTH_REQUIRED;
  app.close();
});

const getMomentum = (act: Actor) =>
  asUser(act)(request(app).get("/api/dashboard/momentum"));

describe("GET /api/dashboard/momentum", () => {
  it("returns silent contacts by overshoot and excludes at-risk contacts", async () => {
    // 1. Silent contact: cadenceDays = 10, lastContactedAt = 25 days ago, relationshipScore = 75 (not at risk)
    const silentId = crypto.randomUUID();
    const twentyFiveDaysAgo = new Date(
      Date.now() - 25 * 86_400_000,
    ).toISOString();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, ownerId, cadenceDays, lastContactedAt, relationshipScore, isGhost, isArchived, isTracked)
         VALUES (?, 'Silent Person', ?, 10, ?, 75, 0, 0, 1)`,
      )
      .run(silentId, actor.user.id, twentyFiveDaysAgo);

    // 2. Overdue but at-risk contact: cadenceDays = 10, lastContactedAt = 25 days ago, relationshipScore = 20 (< 40 at risk)
    const atRiskId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, ownerId, cadenceDays, lastContactedAt, relationshipScore, isGhost, isArchived, isTracked)
         VALUES (?, 'At Risk Person', ?, 10, ?, 20, 0, 0, 1)`,
      )
      .run(atRiskId, actor.user.id, twentyFiveDaysAgo);

    const res = await getMomentum(actor);
    expect(res.status).toBe(200);

    const silentFound = res.body.silent.find(
      (c: { id: string }) => c.id === silentId,
    );
    expect(silentFound).toBeDefined();
    expect(silentFound.overshootDays).toBe(15);

    const atRiskFound = res.body.silent.find(
      (c: { id: string }) => c.id === atRiskId,
    );
    expect(atRiskFound).toBeUndefined();
  });

  it("calculates rising and cooling contacts capped at five when snapshotWeeks >= 4", async () => {
    const now = new Date();
    const week0 = isoWeekStart(now);
    const week1 = isoWeekStart(new Date(now.getTime() - 7 * 86_400_000));
    const week2 = isoWeekStart(new Date(now.getTime() - 14 * 86_400_000));
    const week3 = isoWeekStart(new Date(now.getTime() - 21 * 86_400_000));
    const week4 = isoWeekStart(new Date(now.getTime() - 28 * 86_400_000));

    // Create 6 rising contacts (to test cap at 5)
    const risingIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = crypto.randomUUID();
      risingIds.push(id);
      sqlite
        .prepare(
          // Tracked since before the baseline week, or the baseline would not
          // count: a contact tracked after it is neither rising nor cooling.
          `INSERT INTO contacts (id, name, ownerId, relationshipScore, isGhost, isArchived, isTracked, trackedAt)
           VALUES (?, ?, ?, 80, 0, 0, 1, '2020-01-01 00:00:00')`,
        )
        .run(id, `Rising ${i}`, actor.user.id);

      // Baseline (week 4) = 40, Current (week 0) = 40 + (i + 4) * 2 (delta >= 8)
      const currentScore = 40 + (i + 4) * 2;
      for (const w of [week1, week2, week3]) {
        sqlite
          .prepare(
            `INSERT INTO score_snapshots (ownerId, contactId, weekStart, score) VALUES (?, ?, ?, 40)`,
          )
          .run(actor.user.id, id, w);
      }
      sqlite
        .prepare(
          `INSERT INTO score_snapshots (ownerId, contactId, weekStart, score) VALUES (?, ?, ?, 40)`,
        )
        .run(actor.user.id, id, week4);
      sqlite
        .prepare(
          `INSERT INTO score_snapshots (ownerId, contactId, weekStart, score) VALUES (?, ?, ?, ?)`,
        )
        .run(actor.user.id, id, week0, currentScore);
    }

    // Create cooling contact: baseline = 80, current = 50 (delta -30)
    const coolingId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, ownerId, relationshipScore, isGhost, isArchived, isTracked, trackedAt)
         VALUES (?, 'Cooling Person', ?, 50, 0, 0, 1, '2020-01-01 00:00:00')`,
      )
      .run(coolingId, actor.user.id);

    for (const w of [week1, week2, week3, week4]) {
      sqlite
        .prepare(
          `INSERT INTO score_snapshots (ownerId, contactId, weekStart, score) VALUES (?, ?, ?, 80)`,
        )
        .run(actor.user.id, coolingId, w);
    }
    sqlite
      .prepare(
        `INSERT INTO score_snapshots (ownerId, contactId, weekStart, score) VALUES (?, ?, ?, 50)`,
      )
      .run(actor.user.id, coolingId, week0);

    const res = await getMomentum(actor);
    expect(res.status).toBe(200);
    expect(res.body.snapshotWeeks).toBeGreaterThanOrEqual(4);

    // Capped at 5
    expect(res.body.rising).toHaveLength(5);
    // Ordered descending by delta
    for (let i = 0; i < res.body.rising.length - 1; i++) {
      expect(res.body.rising[i].delta).toBeGreaterThanOrEqual(
        res.body.rising[i + 1].delta,
      );
    }

    const coolingFound = res.body.cooling.find(
      (c: { id: string }) => c.id === coolingId,
    );
    expect(coolingFound).toBeDefined();
    expect(coolingFound.delta).toBe(-30);
  });
});
