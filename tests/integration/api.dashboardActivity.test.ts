import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "crypto";
import { sqlite } from "../../server/db.ts";
import { makeTestApp } from "./helpers.ts";
import { asUser, createActor, type Actor } from "./tenancy/helpers.ts";

let app: ReturnType<typeof makeTestApp>;
let actorA: Actor;
let actorB: Actor;

beforeAll(async () => {
  process.env.AUTH_REQUIRED = "true";
  app = makeTestApp();
  actorA = await createActor(app, {
    username: "actuser_a",
    email: "actuser_a@test.dev",
  });
  actorB = await createActor(app, {
    username: "actuser_b",
    email: "actuser_b@test.dev",
  });
});

afterAll(() => {
  delete process.env.AUTH_REQUIRED;
  app.close();
});

const getActivity = (actor: Actor) =>
  asUser(actor)(request(app).get("/api/dashboard/activity"));

describe("GET /api/dashboard/activity", () => {
  it("returns 84 days and byType breakdown", async () => {
    const res = await getActivity(actorA);
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(84);
    expect(res.body.weekTotals).toHaveLength(12);
    expect(res.body.prevWeekTotals).toHaveLength(12);
    expect(res.body.thisWeek).toHaveProperty("byType");
  });

  it("calculates streak with seeded rows across consecutive days", async () => {
    const contactId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, ownerId) VALUES (?, 'Streak Contact', ?)`,
      )
      .run(contactId, actorA.user.id);

    const now = new Date();
    const todayIso = now.toISOString();
    const yesterday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
    );
    const yesterdayIso = yesterday.toISOString();
    const twoDaysAgo = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 2,
    );
    const twoDaysAgoIso = twoDaysAgo.toISOString();

    // Insert 3 consecutive days for Actor A
    for (const [idx, d] of [twoDaysAgoIso, yesterdayIso, todayIso].entries()) {
      sqlite
        .prepare(
          `INSERT INTO interactions (id, contactId, ownerId, date, type, title)
           VALUES (?, ?, ?, ?, 'note', ?)`,
        )
        .run(crypto.randomUUID(), contactId, actorA.user.id, d, `Note ${idx}`);
    }

    const res = await getActivity(actorA);
    expect(res.status).toBe(200);
    expect(res.body.streak.current).toBe(3);
    expect(res.body.streak.best).toBeGreaterThanOrEqual(3);
  });

  it("excludes imports and sourced rows from the streak", async () => {
    const contactId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, ownerId) VALUES (?, 'Import Contact', ?)`,
      )
      .run(contactId, actorA.user.id);

    // Add import type interaction and a sourced interaction
    sqlite
      .prepare(
        `INSERT INTO interactions (id, contactId, ownerId, date, type, title, source)
         VALUES (?, ?, ?, datetime('now'), 'import', 'Imported Note', NULL)`,
      )
      .run(crypto.randomUUID(), contactId, actorA.user.id);

    sqlite
      .prepare(
        `INSERT INTO interactions (id, contactId, ownerId, date, type, title, source)
         VALUES (?, ?, ?, datetime('now'), 'note', 'LinkedIn synced', 'linkedin')`,
      )
      .run(crypto.randomUUID(), contactId, actorA.user.id);

    const res = await getActivity(actorA);
    expect(res.status).toBe(200);
    // Streak only counts manual, non-import interactions
    expect(res.body.streak.current).toBe(3);
  });

  it("counts today.completed for items completed today", async () => {
    const contactId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, ownerId) VALUES (?, 'Task Contact', ?)`,
      )
      .run(contactId, actorA.user.id);

    sqlite
      .prepare(
        `INSERT INTO action_items (id, contactId, ownerId, title, dueAt, completedAt)
         VALUES (?, ?, ?, 'Completed Task', datetime('now'), datetime('now'))`,
      )
      .run(crypto.randomUUID(), contactId, actorA.user.id);

    const res = await getActivity(actorA);
    expect(res.status).toBe(200);
    expect(res.body.today.completed).toBeGreaterThanOrEqual(1);
  });

  it("keeps other owner's rows invisible", async () => {
    // Actor B has not logged interactions or tasks in this suite
    const resB = await getActivity(actorB);
    expect(resB.status).toBe(200);
    expect(resB.body.streak.current).toBe(0);
    expect(resB.body.today.logged).toBe(0);
    expect(resB.body.today.completed).toBe(0);
  });
});
