import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";

vi.mock("../../server/ai/aiService.ts", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../server/ai/aiService.ts")>();
  return {
    ...original,
    parseSearchQuery: vi.fn(),
    rerankCandidates: vi.fn(),
    generateDailyInsight: vi.fn(),
  };
});

import {
  parseSearchQuery,
  rerankCandidates,
  generateDailyInsight,
} from "../../server/ai/aiService.ts";
import { makeTestApp } from "./helpers.ts";
import {
  createActor,
  asUser,
  resetAccounts,
  type Actor,
} from "./tenancy/helpers.ts";
import { sqlite } from "../../server/db.ts";
import { aiCache } from "../../server/utils/aiCache.ts";
import {
  searchService,
  searchRevision,
  searchCoalescer,
} from "../../server/services/searchService.ts";
import {
  dashboardService,
  insightCoalescer,
} from "../../server/services/dashboardService.ts";

describe("Account cache isolation and shared pending requests", () => {
  let app: ReturnType<typeof makeTestApp>;
  let actorA: Actor;
  let actorB: Actor;

  beforeAll(async () => {
    resetAccounts();
    process.env.AUTH_REQUIRED = "true";
    app = makeTestApp();
    actorA = await createActor(app, {
      username: "user_a",
      email: "user_a@example.com",
    });
    actorB = await createActor(app, {
      username: "user_b",
      email: "user_b@example.com",
    });
  });

  afterAll(() => {
    process.env.AUTH_REQUIRED = "";
    resetAccounts();
  });

  beforeEach(() => {
    sqlite.prepare("DELETE FROM contacts").run();
    sqlite.prepare("DELETE FROM search_revision").run();
    aiCache.invalidateAll();
    searchCoalescer.clear();
    insightCoalescer.clear();

    vi.mocked(parseSearchQuery).mockReset().mockResolvedValue(null);
    vi.mocked(rerankCandidates).mockReset().mockResolvedValue([]);
    vi.mocked(generateDailyInsight).mockReset().mockResolvedValue({
      text: "Solid network with active relationships.",
      category: "overview",
      generatedAt: "2026-09-14T00:00:00.000Z",
    });
  });

  describe("account-specific revision counters", () => {
    it("isolates revision increments to the mutated account", async () => {
      expect(searchRevision(actorA.scope)).toBe(0);
      expect(searchRevision(actorB.scope)).toBe(0);

      // Actor A adds a contact
      const resA = await asUser(actorA)(
        request(app)
          .post("/api/contacts")
          .send({ name: "Alice", role: "Engineer" }),
      );
      expect(resA.status).toBe(201);
      const contactAId = resA.body.id;

      expect(searchRevision(actorA.scope)).toBe(1);
      expect(searchRevision(actorB.scope)).toBe(0);

      // Actor B adds a contact
      const resB = await asUser(actorB)(
        request(app)
          .post("/api/contacts")
          .send({ name: "Bob", role: "Designer" }),
      );
      expect(resB.status).toBe(201);

      expect(searchRevision(actorA.scope)).toBe(1);
      expect(searchRevision(actorB.scope)).toBe(1);

      // Actor A updates a contact
      await asUser(actorA)(
        request(app)
          .patch(`/api/contacts/${contactAId}`)
          .send({ role: "Lead Engineer" }),
      );

      expect(searchRevision(actorA.scope)).toBe(2);
      expect(searchRevision(actorB.scope)).toBe(1);

      // Updating a non-search column (e.g. scoreDirty or relationshipScore) does not bump revision
      sqlite
        .prepare("UPDATE contacts SET scoreDirty = 0 WHERE id = ?")
        .run(contactAId);
      expect(searchRevision(actorA.scope)).toBe(2);

      // Actor B performs a bulk import
      const bulkRes = await asUser(actorB)(
        request(app)
          .post("/api/contacts/bulk")
          .send([
            { name: "Charlie", company: "Acme" },
            { name: "Dave", company: "Beta" },
            { name: "Eve", company: "Gamma" },
          ]),
      );
      expect([200, 201]).toContain(bulkRes.status);

      // Actor B's revision increased by the number of imported contacts, Actor A is untouched!
      expect(searchRevision(actorB.scope)).toBeGreaterThanOrEqual(4);
      expect(searchRevision(actorA.scope)).toBe(2);

      // Actor A deletes a contact
      await asUser(actorA)(request(app).delete(`/api/contacts/${contactAId}`));

      expect(searchRevision(actorA.scope)).toBe(3);
    });
  });

  describe("search cache invalidation isolation", () => {
    it("prevents another account's import from invalidating cached search", async () => {
      // Seed Actor A with a contact
      await asUser(actorA)(
        request(app)
          .post("/api/contacts")
          .send({
            name: "Alice Johnson",
            role: "Software Engineer",
            about: "Builds distributed database systems",
          }),
      );

      vi.mocked(rerankCandidates).mockResolvedValueOnce([
        { contact_id: "ignored", reason: "Matches distributed systems" },
      ]);

      // First search by Actor A (populates cache)
      const res1 = await asUser(actorA)(
        request(app)
          .post("/api/search/semantic")
          .send({ query: "distributed systems" }),
      );
      expect(res1.body.cached).toBeFalsy();

      // Second search by Actor A hits cache
      const res2 = await asUser(actorA)(
        request(app)
          .post("/api/search/semantic")
          .send({ query: "distributed systems" }),
      );
      expect(res2.body.cached).toBe(true);

      // Actor B imports contacts
      await asUser(actorB)(
        request(app)
          .post("/api/contacts/bulk")
          .send([
            { name: "Bob", company: "Corp" },
            { name: "Charlie", company: "Corp" },
            { name: "Dave", company: "Corp" },
          ]),
      );

      // Actor A searches again: STILL CACHE HIT!
      const res3 = await asUser(actorA)(
        request(app)
          .post("/api/search/semantic")
          .send({ query: "distributed systems" }),
      );
      expect(res3.body.cached).toBe(true);
    });

    it("does not discard Actor A's in-progress semantic search when Actor B imports", async () => {
      const resA = await asUser(actorA)(
        request(app)
          .post("/api/contacts")
          .send({
            name: "Alice Johnson",
            role: "Software Engineer",
            about: "Specializes in cloud infrastructure",
          }),
      );
      const contactAId = resA.body.id;

      vi.mocked(rerankCandidates).mockImplementation(async () => {
        // While Actor A is waiting for the reranker, Actor B does an import!
        await asUser(actorB)(
          request(app)
            .post("/api/contacts/bulk")
            .send([
              { name: "User1", company: "Inc" },
              { name: "User2", company: "Inc" },
              { name: "User3", company: "Inc" },
            ]),
        );

        return [{ contact_id: contactAId, reason: "Matches query" }];
      });

      const response = await asUser(actorA)(
        request(app)
          .post("/api/search/semantic")
          .send({ query: "cloud infrastructure" }),
      );

      // Actor A's result is NOT discarded to keyword fallback!
      expect(response.body.fallback).toBe(false);
      expect(response.body.matches[0].id).toBe(contactAId);
    });
  });

  describe("daily insight cache invalidation isolation", () => {
    it("preserves Actor A's cached daily insight when Actor B mutates contacts", async () => {
      // Seed Actor A with contacts
      await asUser(actorA)(
        request(app)
          .post("/api/contacts")
          .send({ name: "Alice", role: "Engineer" }),
      );

      // First insight fetch generates and caches
      const res1 = await asUser(actorA)(
        request(app).get("/api/dashboard/insight"),
      );
      expect(res1.status).toBe(200);
      expect(res1.body).toMatchObject({
        text: "Solid network with active relationships.",
      });
      expect(generateDailyInsight).toHaveBeenCalledTimes(1);

      // Second insight fetch is a cache hit
      await asUser(actorA)(request(app).get("/api/dashboard/insight"));
      expect(generateDailyInsight).toHaveBeenCalledTimes(1);

      // Actor B mutates contacts
      await asUser(actorB)(
        request(app)
          .post("/api/contacts")
          .send({ name: "Bob", role: "Designer" }),
      );

      // Actor B also imports bulk contacts
      await asUser(actorB)(
        request(app)
          .post("/api/contacts/bulk")
          .send([
            { name: "Frank", company: "Test" },
            { name: "Grace", company: "Test" },
          ]),
      );

      // Actor A's insight is still served from cache!
      const res3 = await asUser(actorA)(
        request(app).get("/api/dashboard/insight"),
      );
      expect(res3.status).toBe(200);
      expect(res3.body).toMatchObject({
        text: "Solid network with active relationships.",
      });
      // No new AI generation was triggered!
      expect(generateDailyInsight).toHaveBeenCalledTimes(1);
    });

    it("does not discard in-progress daily insight when Actor B edits a contact", async () => {
      await asUser(actorA)(
        request(app)
          .post("/api/contacts")
          .send({ name: "Alice", role: "Engineer" }),
      );

      vi.mocked(generateDailyInsight).mockImplementation(async () => {
        // Actor B edits a contact mid-generation
        await asUser(actorB)(
          request(app)
            .post("/api/contacts")
            .send({ name: "Bob", role: "Designer" }),
        );
        return {
          text: "Generated insight",
          category: "growth",
          generatedAt: "2026-09-14T00:00:00.000Z",
        };
      });

      const res = await asUser(actorA)(
        request(app).get("/api/dashboard/insight"),
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        text: "Generated insight",
        category: "growth",
        generatedAt: "2026-09-14T00:00:00.000Z",
      });
    });
  });

  describe("shared pending requests (single-flight)", () => {
    it("coalesces concurrent identical search requests within the account", async () => {
      const resA = await asUser(actorA)(
        request(app)
          .post("/api/contacts")
          .send({
            name: "Alice Williams",
            role: "Systems Specialist",
            about: "Deep systems specialist",
          }),
      );
      const contactAId = resA.body.id;

      let rerankCalls = 0;
      vi.mocked(rerankCandidates).mockImplementation(async () => {
        rerankCalls++;
        await new Promise((resolve) => setTimeout(resolve, 60));
        return [{ contact_id: contactAId, reason: "Best match" }];
      });

      // Fire two identical searches concurrently for Actor A
      const p1 = asUser(actorA)(
        request(app)
          .post("/api/search/semantic")
          .send({ query: "systems specialist" }),
      );
      const p2 = asUser(actorA)(
        request(app)
          .post("/api/search/semantic")
          .send({ query: "systems specialist" }),
      );

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(rerankCalls).toBe(1);
      expect(r1.body.matches[0].id).toBe(contactAId);
      expect(r2.body.matches[0].id).toBe(contactAId);
    });

    it("preserves cancellation: if caller 1 aborts, caller 2 receives search result", async () => {
      const resA = await asUser(actorA)(
        request(app)
          .post("/api/contacts")
          .send({
            name: "Alice Williams",
            role: "Systems Specialist",
            about: "Deep systems specialist",
          }),
      );
      const contactAId = resA.body.id;

      vi.mocked(rerankCandidates).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return [{ contact_id: contactAId, reason: "Match" }];
      });

      const ac1 = new AbortController();
      const ac2 = new AbortController();

      const p1 = searchService.semanticSearch(
        actorA.scope,
        "systems specialist",
        "req-1",
        ac1.signal,
      );
      const p2 = searchService.semanticSearch(
        actorA.scope,
        "systems specialist",
        "req-2",
        ac2.signal,
      );

      // Caller 1 aborts early
      ac1.abort();

      await expect(p1).rejects.toThrow();

      // Caller 2 receives the full semantic result!
      const result2 = await p2;
      expect(result2.fallback).toBe(false);
      expect(result2.matches[0].id).toBe(contactAId);
    });

    it("coalesces concurrent daily insight requests within the account", async () => {
      await asUser(actorA)(
        request(app)
          .post("/api/contacts")
          .send({ name: "Alice", role: "Engineer" }),
      );

      let insightGenerations = 0;
      vi.mocked(generateDailyInsight).mockImplementation(async () => {
        insightGenerations++;
        await new Promise((resolve) => setTimeout(resolve, 60));
        return {
          text: "Single flight insight",
          category: "network",
          generatedAt: "2026-09-14T00:00:00.000Z",
        };
      });

      const p1 = asUser(actorA)(request(app).get("/api/dashboard/insight"));
      const p2 = asUser(actorA)(request(app).get("/api/dashboard/insight"));

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(insightGenerations).toBe(1);
      expect(r1.body).toEqual({
        text: "Single flight insight",
        category: "network",
        generatedAt: "2026-09-14T00:00:00.000Z",
      });
      expect(r2.body).toEqual({
        text: "Single flight insight",
        category: "network",
        generatedAt: "2026-09-14T00:00:00.000Z",
      });
    });

    it("preserves cancellation: if caller 1 aborts, caller 2 receives insight", async () => {
      await asUser(actorA)(
        request(app)
          .post("/api/contacts")
          .send({ name: "Alice", role: "Engineer" }),
      );

      vi.mocked(generateDailyInsight).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          text: "Insight for surviving caller",
          category: "overview",
          generatedAt: "2026-09-14T00:00:00.000Z",
        };
      });

      const ac1 = new AbortController();
      const ac2 = new AbortController();

      const p1 = dashboardService.getInsight(actorA.scope, ac1.signal);
      const p2 = dashboardService.getInsight(actorA.scope, ac2.signal);

      // Caller 1 aborts early
      ac1.abort();

      await expect(p1).rejects.toThrow();

      // Caller 2 receives the generated insight
      const result2 = await p2;
      expect(result2).toEqual({
        text: "Insight for surviving caller",
        category: "overview",
        generatedAt: "2026-09-14T00:00:00.000Z",
      });
    });

    it("does not share in-flight requests across different accounts", async () => {
      await asUser(actorA)(
        request(app)
          .post("/api/contacts")
          .send({
            name: "Alice Jones",
            role: "Staff Engineer",
            about: "Staff engineer at Acme",
          }),
      );
      await asUser(actorB)(
        request(app)
          .post("/api/contacts")
          .send({
            name: "Bob Smith",
            role: "Staff Engineer",
            about: "Staff engineer at Beta",
          }),
      );

      let rerankInvocations = 0;
      vi.mocked(rerankCandidates).mockImplementation(async () => {
        rerankInvocations++;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return [];
      });

      // Actor A and Actor B search for the same text at the same time
      const p1 = asUser(actorA)(
        request(app)
          .post("/api/search/semantic")
          .send({ query: "staff engineer" }),
      );
      const p2 = asUser(actorB)(
        request(app)
          .post("/api/search/semantic")
          .send({ query: "staff engineer" }),
      );

      await Promise.all([p1, p2]);

      // Both ran independently because accounts are isolated!
      expect(rerankInvocations).toBe(2);
    });
  });
});
