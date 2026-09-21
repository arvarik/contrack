// =============================================================================
// Integration Tests — tracking through the contact routes
// =============================================================================
// A flip to tracked answers with a fresh score, in one contact and in bulk.
// The breakdown route refuses an untracked contact. The slim list, the CSV
// export and the search facet all carry the flag.
// =============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { sqlite } from "../../server/db.ts";
import { makeTestApp } from "./helpers.ts";
import { asUser, createActor, type Actor } from "./tenancy/helpers.ts";

let app: ReturnType<typeof makeTestApp>;
let actor: Actor;

/** A score the formula never produces for these rows, so a write shows. */
const SENTINEL = 7;

beforeAll(async () => {
  process.env.AUTH_REQUIRED = "true";
  app = makeTestApp();
  actor = await createActor(app, {
    username: "trackuser",
    email: "trackuser@test.dev",
  });
});

afterAll(() => {
  delete process.env.AUTH_REQUIRED;
  app.close();
});

const auth = () => asUser(actor);

async function create(name: string): Promise<string> {
  const res = await auth()(request(app).post("/api/contacts").send({ name }));
  expect(res.status).toBe(201);
  return res.body.id as string;
}

function plant(id: string): void {
  sqlite
    .prepare(
      `UPDATE contacts SET relationshipScore = ?, scoreDirty = 0
        WHERE id = ? AND ownerId = ?`,
    )
    .run(SENTINEL, id, actor.user.id);
}

function stored(id: string) {
  return sqlite
    .prepare(
      `SELECT relationshipScore, scoreDirty, isTracked FROM contacts
        WHERE id = ? AND ownerId = ?`,
    )
    .get(id, actor.user.id) as {
    relationshipScore: number;
    scoreDirty: number;
    isTracked: number;
  };
}

describe("PATCH /api/contacts/:id with isTracked", () => {
  it("answers with a fresh score and a cleared mark", async () => {
    const id = await create("Track Me Now");
    await auth()(
      request(app)
        .post(`/api/contacts/${id}/interactions`)
        .send({ type: "note", title: "Hello" }),
    );
    plant(id);

    const res = await auth()(
      request(app).patch(`/api/contacts/${id}`).send({ isTracked: true }),
    );
    expect(res.status).toBe(200);
    expect(res.body.isTracked).toBe(true);
    expect(res.body.relationshipScore).not.toBe(SENTINEL);
    expect(stored(id)).toMatchObject({ isTracked: 1, scoreDirty: 0 });
  });

  it("leaves the score alone on a flip to false", async () => {
    const id = await create("Untrack Me");
    await auth()(
      request(app).patch(`/api/contacts/${id}`).send({ isTracked: true }),
    );
    plant(id);
    const res = await auth()(
      request(app).patch(`/api/contacts/${id}`).send({ isTracked: false }),
    );
    expect(res.status).toBe(200);
    expect(res.body.isTracked).toBe(false);
    expect(res.body.relationshipScore).toBe(SENTINEL);
  });
});

describe("PUT /api/contacts/bulk-update with isTracked", () => {
  it("tracks fifty and scores each before it answers", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) ids.push(await create(`Bulk Track ${i}`));
    for (const id of ids) plant(id);

    const res = await auth()(
      request(app)
        .put("/api/contacts/bulk-update")
        .send({ ids, data: { isTracked: true } }),
    );
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(50);

    const left = sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM contacts
          WHERE ownerId = ? AND id IN (${ids.map(() => "?").join(", ")})
            AND (isTracked != 1 OR scoreDirty != 0 OR relationshipScore = ?)`,
      )
      .get(actor.user.id, ...ids, SENTINEL) as { n: number };
    expect(left.n).toBe(0);
  });
});

describe("GET /api/contacts/:id/score", () => {
  it("is 404 NOT_TRACKED for an untracked contact, and 200 once tracked", async () => {
    const id = await create("Score Gate");
    const before = await auth()(request(app).get(`/api/contacts/${id}/score`));
    expect(before.status).toBe(404);
    expect(before.body.error.code).toBe("NOT_TRACKED");

    await auth()(
      request(app).patch(`/api/contacts/${id}`).send({ isTracked: true }),
    );
    const after = await auth()(request(app).get(`/api/contacts/${id}/score`));
    expect(after.status).toBe(200);
    expect(typeof after.body.score).toBe("number");
    expect(after.body.components).toHaveLength(5);
  });
});

describe("the flag on the way out", () => {
  it("is on every slim row, with the moment of tracking", async () => {
    const tracked = await create("Slim Tracked");
    const untracked = await create("Slim Untracked");
    await auth()(
      request(app).patch(`/api/contacts/${tracked}`).send({ isTracked: true }),
    );

    const res = await auth()(request(app).get("/api/contacts?view=slim"));
    expect(res.status).toBe(200);
    const rows = res.body as {
      id: string;
      isTracked: boolean;
      trackedAt: string | null;
    }[];
    const a = rows.find((r) => r.id === tracked);
    const b = rows.find((r) => r.id === untracked);
    expect(a).toMatchObject({ isTracked: true });
    expect(typeof a?.trackedAt).toBe("string");
    expect(b).toMatchObject({ isTracked: false, trackedAt: null });
  });

  it("is in the CSV export", async () => {
    const id = await create("CSV Tracked");
    await auth()(
      request(app)
        .patch(`/api/contacts/${id}`)
        .send({ isTracked: true, cadenceDays: 60 }),
    );
    const res = await auth()(request(app).get("/api/export/csv"));
    expect(res.status).toBe(200);
    const lines = (res.text as string).split("\r\n");
    expect(lines[0]).toContain("Archived,Tracked,Cadence Days,Tracked At");
    const line = lines.find((l) => l.startsWith("CSV Tracked,"));
    expect(line).toBeDefined();
    // Archived no, Tracked yes, Cadence 60, then the stamp.
    expect(line).toMatch(/,no,yes,60,\d{4}-\d{2}-\d{2}/);
  });

  it("narrows a search through the tracked: facet", async () => {
    const tracked = await create("Facet Zed Tracked");
    const untracked = await create("Facet Zed Untracked");
    await auth()(
      request(app).patch(`/api/contacts/${tracked}`).send({ isTracked: true }),
    );

    const yes = await auth()(
      request(app)
        .get("/api/search")
        .query({
          q: "Facet Zed",
          filters: JSON.stringify([{ field: "tracked", value: "yes" }]),
        }),
    );
    expect(yes.status).toBe(200);
    const yesIds = (yes.body as { id: string }[]).map((r) => r.id);
    expect(yesIds).toContain(tracked);
    expect(yesIds).not.toContain(untracked);

    const no = await auth()(
      request(app)
        .get("/api/search")
        .query({
          q: "Facet Zed",
          filters: JSON.stringify([{ field: "tracked", value: "no" }]),
        }),
    );
    expect(no.status).toBe(200);
    const noIds = (no.body as { id: string }[]).map((r) => r.id);
    expect(noIds).toContain(untracked);
    expect(noIds).not.toContain(tracked);
  });
});
