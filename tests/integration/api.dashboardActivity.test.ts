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

/** Local midnight `n` days ago, as ISO, the way the streak reads its days. */
const daysAgo = (n: number): string => {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - n,
  ).toISOString();
};

describe("GET /api/dashboard/activity", () => {
  it("counts consecutive days of notes, and not imports or synced rows", async () => {
    const contactId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, ownerId) VALUES (?, 'Streak Contact', ?)`,
      )
      .run(contactId, actorA.user.id);
    const note = sqlite.prepare(
      `INSERT INTO interactions (id, contactId, ownerId, date, type, title, source)
       VALUES (?, ?, ?, ?, ?, 'Note', ?)`,
    );
    for (const n of [2, 1, 0]) {
      note.run(
        crypto.randomUUID(),
        contactId,
        actorA.user.id,
        daysAgo(n),
        "note",
        null,
      );
    }
    // The day before the streak has only an import and a synced note. If
    // either counted, the streak would be four days long.
    note.run(
      crypto.randomUUID(),
      contactId,
      actorA.user.id,
      daysAgo(3),
      "import",
      null,
    );
    note.run(
      crypto.randomUUID(),
      contactId,
      actorA.user.id,
      daysAgo(3),
      "note",
      "linkedin",
    );

    const res = await getActivity(actorA);
    expect(res.status).toBe(200);
    expect(res.body.streak.current).toBe(3);
    expect(res.body.streak.best).toBe(3);
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
    // A has notes and a completed task from the tests above, so B's zeros
    // are about the owner filter and not about an empty database.
    const resA = await getActivity(actorA);
    expect(resA.body.today.logged).toBeGreaterThan(0);
    expect(resA.body.today.completed).toBeGreaterThan(0);

    const resB = await getActivity(actorB);
    expect(resB.status).toBe(200);
    expect(resB.body.streak.current).toBe(0);
    expect(resB.body.today.logged).toBe(0);
    expect(resB.body.today.completed).toBe(0);
  });
});
