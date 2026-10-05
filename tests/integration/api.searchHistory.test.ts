import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import request from "supertest";
import { sqlite } from "../../server/db.ts";
import { makeTestApp } from "./helpers.ts";
import { asUser, createActor, type Actor } from "./tenancy/helpers.ts";

let app: ReturnType<typeof makeTestApp>;
let userA: Actor;

beforeAll(async () => {
  process.env.AUTH_REQUIRED = "true";
  app = makeTestApp();
  userA = await createActor(app, {
    username: "histuser_a",
    email: "histuser_a@test.dev",
  });
});

afterAll(() => {
  delete process.env.AUTH_REQUIRED;
  app.close();
});

beforeEach(async () => {
  if (userA) await asUser(userA)(request(app).delete("/api/search/history"));
});

afterEach(async () => {
  if (userA) await asUser(userA)(request(app).delete("/api/search/history"));
});

describe("API search history (/api/search/history)", () => {
  it("POST records a People entry, GET lists it with total 1", async () => {
    const postRes = await asUser(userA)(
      request(app)
        .post("/api/search/history")
        .send({
          query: "who likes coffee",
          mode: "people",
          resultCount: 5,
          resultIds: ["contact-1", "contact-2"],
          fallback: false,
        }),
    );

    expect(postRes.status).toBe(200);
    const entry = postRes.body.entry;
    expect(entry).toMatchObject({
      ownerId: userA.user.id,
      mode: "people",
      query: "who likes coffee",
      normalizedQuery: "who likes coffee",
      resultCount: 5,
      resultIds: ["contact-1", "contact-2"],
      fallback: false,
      pinned: false,
      runCount: 1,
    });
    expect(entry.id).toBeDefined();
    expect(entry.createdAt).toBeDefined();
    expect(entry.lastRunAt).toBeDefined();

    const getRes = await asUser(userA)(request(app).get("/api/search/history"));

    expect(getRes.status).toBe(200);
    expect(getRes.body.total).toBe(1);
    expect(getRes.body.nextCursor).toBeNull();
    expect(getRes.body.entries).toHaveLength(1);
    expect(getRes.body.entries[0].id).toBe(entry.id);

    // Clean up
    await asUser(userA)(request(app).delete("/api/search/history"));
  });

  it("POST the same question with different case and spacing: one row, runCount 2, snapshot replaced, lastRunAt moved", async () => {
    const res1 = await asUser(userA)(
      request(app)
        .post("/api/search/history")
        .send({
          query: "who likes coffee",
          mode: "people",
          resultCount: 5,
          resultIds: ["c1"],
          fallback: false,
        }),
    );
    expect(res1.status).toBe(200);
    const entry1 = res1.body.entry;
    expect(entry1.runCount).toBe(1);

    // Small delay to ensure timestamp resolution difference
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const res2 = await asUser(userA)(
      request(app)
        .post("/api/search/history")
        .send({
          query: "   Who   Likes   Coffee   ",
          mode: "people",
          resultCount: 12,
          resultIds: ["c2", "c3"],
          fallback: true,
        }),
    );
    expect(res2.status).toBe(200);
    const entry2 = res2.body.entry;

    expect(entry2.id).toBe(entry1.id);
    expect(entry2.runCount).toBe(2);
    expect(entry2.query).toBe("Who   Likes   Coffee"); // typed, trimmed
    expect(entry2.normalizedQuery).toBe("who likes coffee");
    expect(entry2.resultCount).toBe(12);
    expect(entry2.resultIds).toEqual(["c2", "c3"]);
    expect(entry2.fallback).toBe(true);
    expect(entry2.createdAt).toBe(entry1.createdAt);
    expect(new Date(entry2.lastRunAt).getTime()).toBeGreaterThan(
      new Date(entry1.lastRunAt).getTime(),
    );

    const listRes = await asUser(userA)(
      request(app).get("/api/search/history"),
    );
    expect(listRes.body.total).toBe(1);
    expect(listRes.body.entries).toHaveLength(1);

    // Clean up
    await asUser(userA)(request(app).delete("/api/search/history"));
  });

  it("GET with mode=notes, pinned=1 and q, and a cursor walk over 120 rows with limit 50", async () => {
    const walker = await createActor(app, {
      username: "walker",
      email: "walker@test.dev",
    });

    const insert = sqlite.prepare(
      `INSERT INTO search_history (
         id, ownerId, mode, query, normalizedQuery,
         resultCount, resultIds, fallback, pinned, runCount,
         createdAt, lastRunAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const baseTime = Date.now();
    sqlite.transaction(() => {
      for (let i = 0; i < 120; i++) {
        const id = `walk-${String(i).padStart(3, "0")}`;
        const time = new Date(baseTime - i * 1000).toISOString();
        insert.run(
          id,
          walker.user.id,
          "notes",
          `note question ${i}`,
          `note question ${i}`,
          i,
          JSON.stringify([`contact-${i}`]),
          0,
          1, // pinned = 1
          1,
          time,
          time,
        );
      }
      // Rows the filters must leave out: the same words in another mode, and
      // notes that are not pinned. Without them every filter matches all.
      for (let i = 0; i < 10; i++) {
        const time = new Date(baseTime - i * 1000).toISOString();
        for (const [mode, text, pinned] of [
          ["people", `note question ${i}`, 1],
          ["notes", `note question unpinned ${i}`, 0],
        ] as const) {
          insert.run(
            `decoy-${mode}-${pinned}-${i}`,
            walker.user.id,
            mode,
            text,
            text,
            0,
            "[]",
            0,
            pinned,
            1,
            time,
            time,
          );
        }
      }
    })();

    // Page 1
    const page1 = await asUser(walker)(
      request(app)
        .get("/api/search/history")
        .query({ mode: "notes", q: "", pinned: 1, limit: 50 }),
    );
    expect(page1.status).toBe(200);
    expect(page1.body.total).toBe(120);
    expect(page1.body.entries).toHaveLength(50);
    expect(page1.body.nextCursor).toBeTruthy();

    // Page 2
    const page2 = await asUser(walker)(
      request(app).get("/api/search/history").query({
        mode: "notes",
        q: "",
        pinned: 1,
        limit: 50,
        cursor: page1.body.nextCursor,
      }),
    );
    expect(page2.status).toBe(200);
    expect(page2.body.total).toBe(120);
    expect(page2.body.entries).toHaveLength(50);
    expect(page2.body.nextCursor).toBeTruthy();

    // Page 3
    const page3 = await asUser(walker)(
      request(app).get("/api/search/history").query({
        mode: "notes",
        q: "",
        pinned: 1,
        limit: 50,
        cursor: page2.body.nextCursor,
      }),
    );
    expect(page3.status).toBe(200);
    expect(page3.body.total).toBe(120);
    expect(page3.body.entries).toHaveLength(20);
    expect(page3.body.nextCursor).toBeNull();

    // Verify all 120 entries were collected without duplicates
    const allIds = [
      ...page1.body.entries.map((e: { id: string }) => e.id),
      ...page2.body.entries.map((e: { id: string }) => e.id),
      ...page3.body.entries.map((e: { id: string }) => e.id),
    ];
    expect(allIds).toHaveLength(120);
    expect(new Set(allIds).size).toBe(120);

    // The text filter: "note question 11" and "note question 110" to "119".
    const byText = await asUser(walker)(
      request(app)
        .get("/api/search/history")
        .query({ mode: "notes", q: "question 11", pinned: 1, limit: 50 }),
    );
    expect(byText.body.total).toBe(11);

    // Clean up
    await asUser(walker)(request(app).delete("/api/search/history"));
  });

  it("PATCH pinned true then false, DELETE one, DELETE all with and without mode", async () => {
    // 1. Create two entries in "people" mode and two in "notes" mode
    const p1 = await asUser(userA)(
      request(app)
        .post("/api/search/history")
        .send({ query: "person one", mode: "people" }),
    );
    const p2 = await asUser(userA)(
      request(app)
        .post("/api/search/history")
        .send({ query: "person two", mode: "people" }),
    );
    const n1 = await asUser(userA)(
      request(app)
        .post("/api/search/history")
        .send({ query: "note one", mode: "notes" }),
    );
    const n2 = await asUser(userA)(
      request(app)
        .post("/api/search/history")
        .send({ query: "note two", mode: "notes" }),
    );

    const p1Id = p1.body.entry.id;
    const p2Id = p2.body.entry.id;
    const n1Id = n1.body.entry.id;
    const n2Id = n2.body.entry.id;

    // PATCH pinned true
    const patchRes1 = await asUser(userA)(
      request(app).patch(`/api/search/history/${p1Id}`).send({ pinned: true }),
    );
    expect(patchRes1.status).toBe(200);
    expect(patchRes1.body.entry.pinned).toBe(true);

    // Verify pinned filter
    const pinnedList = await asUser(userA)(
      request(app).get("/api/search/history").query({ pinned: 1 }),
    );
    expect(pinnedList.body.entries).toHaveLength(1);
    expect(pinnedList.body.entries[0].id).toBe(p1Id);

    // PATCH pinned false
    const patchRes2 = await asUser(userA)(
      request(app).patch(`/api/search/history/${p1Id}`).send({ pinned: false }),
    );
    expect(patchRes2.status).toBe(200);
    expect(patchRes2.body.entry.pinned).toBe(false);

    // DELETE one entry (p1)
    const delOneRes = await asUser(userA)(
      request(app).delete(`/api/search/history/${p1Id}`),
    );
    expect(delOneRes.status).toBe(200);
    expect(delOneRes.body).toEqual({ success: true });

    // Verify p1 is deleted
    const checkAfterOne = await asUser(userA)(
      request(app).get("/api/search/history"),
    );
    const idsAfterOne = checkAfterOne.body.entries.map(
      (e: { id: string }) => e.id,
    );
    expect(idsAfterOne).not.toContain(p1Id);
    expect(idsAfterOne).toContain(p2Id);
    expect(idsAfterOne).toContain(n1Id);
    expect(idsAfterOne).toContain(n2Id);

    // DELETE all with mode=people
    const delPeopleRes = await asUser(userA)(
      request(app).delete("/api/search/history").query({ mode: "people" }),
    );
    expect(delPeopleRes.status).toBe(200);
    expect(delPeopleRes.body.deleted).toBe(1); // p2 was the only people row left

    const checkAfterPeople = await asUser(userA)(
      request(app).get("/api/search/history"),
    );
    const remainingIds = checkAfterPeople.body.entries.map(
      (e: { id: string }) => e.id,
    );
    expect(remainingIds).toHaveLength(2);
    expect(remainingIds).toContain(n1Id);
    expect(remainingIds).toContain(n2Id);

    // DELETE all without mode
    const delAllRes = await asUser(userA)(
      request(app).delete("/api/search/history"),
    );
    expect(delAllRes.status).toBe(200);
    expect(delAllRes.body.deleted).toBe(2);

    const checkAfterAll = await asUser(userA)(
      request(app).get("/api/search/history"),
    );
    expect(checkAfterAll.body.total).toBe(0);
    expect(checkAfterAll.body.entries).toEqual([]);
  });

  it("validates inputs: empty query 400, 501 chars 400, unknown mode 400, resultIds > 30 trimmed", async () => {
    // Empty query
    const resEmpty = await asUser(userA)(
      request(app)
        .post("/api/search/history")
        .send({ query: "", mode: "people" }),
    );
    expect(resEmpty.status).toBe(400);

    const resWhitespace = await asUser(userA)(
      request(app)
        .post("/api/search/history")
        .send({ query: "    ", mode: "people" }),
    );
    expect(resWhitespace.status).toBe(400);

    // 501 characters
    const res501 = await asUser(userA)(
      request(app)
        .post("/api/search/history")
        .send({ query: "x".repeat(501), mode: "people" }),
    );
    expect(res501.status).toBe(400);

    // 500 characters passes
    const res500 = await asUser(userA)(
      request(app)
        .post("/api/search/history")
        .send({ query: "x".repeat(500), mode: "people" }),
    );
    expect(res500.status).toBe(200);
    await asUser(userA)(request(app).delete("/api/search/history"));

    // Unknown mode
    const resMode = await asUser(userA)(
      request(app)
        .post("/api/search/history")
        .send({ query: "valid query", mode: "invalid_mode" }),
    );
    expect(resMode.status).toBe(400);

    // resultIds longer than 30 is trimmed, not rejected
    const fortyIds = Array.from({ length: 40 }, (_, i) => `contact-${i}`);
    const resTrimmed = await asUser(userA)(
      request(app).post("/api/search/history").send({
        query: "search with many ids",
        mode: "people",
        resultIds: fortyIds,
      }),
    );
    expect(resTrimmed.status).toBe(200);
    expect(resTrimmed.body.entry.resultIds).toHaveLength(30);
    expect(resTrimmed.body.entry.resultIds[0]).toBe("contact-0");
    expect(resTrimmed.body.entry.resultIds[29]).toBe("contact-29");

    // Clean up
    await asUser(userA)(request(app).delete("/api/search/history"));
  });
});
