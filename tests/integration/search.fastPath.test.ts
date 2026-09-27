// =============================================================================
// Integration: the Ask Contrack fast path
// =============================================================================
// Names, emails and phone numbers are answered locally with no model call.
// Every other question streams the local hybrid list first. A plan the
// database can prove (confident hard filters, or recency alone) is answered
// without the reranker. AI off, or a provider failure, leaves the local list
// as the answer, marked unverified, never the old keyword-only fallback.
//
// The real pipeline and database run here. Only the provider is scripted, at
// the gateway, so a call the pipeline makes is a call these tests can count.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../../server/ai/gateway.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/ai/gateway.ts")>()),
  generateFor: vi.fn(),
  isAnyProviderConfigured: () => true,
}));
vi.mock("../../server/ai/services/shared.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../server/ai/services/shared.ts")
  >()),
  isMockMode: () => false,
}));

import { generateFor } from "../../server/ai/gateway.ts";
import type { GatewayOptions } from "../../server/ai/gateway.ts";
import type { QueryPlan } from "../../server/ai/types.ts";
import { sqlite } from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import {
  databaseProof,
  searchService,
} from "../../server/services/searchService.ts";
import { aiCache } from "../../server/utils/aiCache.ts";
import { makeTestApp } from "./helpers.ts";
import { localOwnerId } from "./tenancy/helpers.ts";

const app = makeTestApp();
const scope = () => scopeForOwnerId(localOwnerId());

const PEOPLE = [
  {
    name: "Jonathan Smith",
    role: "Designer",
    company: "Acme",
    location: "Porto, Portugal",
    emails: ["jonathan.smith@example.com"],
    phones: ["+1 (415) 555-1234"],
  },
  {
    name: "Priya Raman",
    role: "Product Manager",
    company: "Northwind Logistics",
    location: "Lisbon, Portugal",
  },
  {
    name: "Tomas Silva",
    role: "Product Manager",
    company: "Contoso",
    location: "Lisbon, Portugal",
    about: "Keeps bees on a rooftop and sells the honey",
    interests: ["beekeeping"],
  },
  {
    name: "Ines Costa",
    role: "Engineer",
    company: "Northwind Logistics",
    location: "Berlin, Germany",
  },
];
const ids = new Map<string, string>();

/** Every call the gateway was asked to make, by what it was for. */
const calls = () =>
  vi
    .mocked(generateFor)
    .mock.calls.map(([, options]) =>
      options.systemPrompt?.includes("query planner")
        ? "planner"
        : options.systemPrompt?.includes("data analyst")
          ? "reranker"
          : "other",
    );

/** The planner returns `plan`. The reranker returns `rerank` or fails. */
function script(plan: QueryPlan | null, rerank?: unknown[]) {
  vi.mocked(generateFor).mockImplementation(
    async (_capability, options: GatewayOptions) => {
      if (options.systemPrompt?.includes("query planner")) {
        if (!plan) throw new Error("Provider unavailable");
        return { text: JSON.stringify(plan), model: "fixture", latencyMs: 1 };
      }
      if (!rerank) throw new Error("Provider unavailable");
      return { text: JSON.stringify(rerank), model: "fixture", latencyMs: 1 };
    },
  );
}

beforeEach(async () => {
  sqlite.prepare("DELETE FROM contacts WHERE ownerId = ?").run(localOwnerId());
  aiCache.invalidateAll();
  vi.mocked(generateFor).mockReset();
  ids.clear();
  for (const person of PEOPLE) {
    const res = await request(app).post("/api/contacts").send(person);
    expect(res.status).toBe(201);
    ids.set(person.name, res.body.id);
  }
});

const names = (matches: { name: string }[]) => matches.map((m) => m.name);

describe("local kinds call no model", () => {
  it("answers a misspelled name with the approximate match, verified", async () => {
    const result = await searchService.semanticSearch(
      scope(),
      "Jonathon Smyth",
      "fast-typo",
    );
    expect(names(result.matches)).toEqual(["Jonathan Smith"]);
    expect(result.matches[0]).toMatchObject({
      approximate: true,
      verified: true,
    });
    expect(result.fallback).toBe(false);
    expect(generateFor).not.toHaveBeenCalled();
  });

  it.each([
    ["an email", "jonathan.smith@example.com"],
    ["a phone number", "+1 (415) 555-1234"],
    ["a name", "Priya Raman"],
  ])("answers %s locally", async (_kind, query) => {
    const result = await searchService.semanticSearch(scope(), query, "fast");
    expect(names(result.matches)[0]).toBe(
      query === "Priya Raman" ? "Priya Raman" : "Jonathan Smith",
    );
    expect(result.matches.every((m) => m.verified === true)).toBe(true);
    expect(generateFor).not.toHaveBeenCalled();
  });
});

describe("questions show the local list first", () => {
  it("streams the local hybrid list, unverified, before the final answer", async () => {
    script(null, []);
    const response = await request(app)
      .post("/api/search/semantic")
      .set("Accept", "application/x-ndjson")
      .send({ query: "who keeps bees" });
    const chunks = response.text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(chunks.map((chunk) => chunk.phase)).toEqual(["instant", "complete"]);
    expect(chunks[0].fallback).toBe(true);
    expect(names(chunks[0].matches)).toContain("Tomas Silva");
    expect(
      chunks[0].matches.every(
        (match: { verified: boolean }) => match.verified === false,
      ),
    ).toBe(true);
  });

  it("answers with AI off from the local list, and calls no model", async () => {
    const result = await searchService.semanticSearch(
      scope(),
      "someone who knows about beekeeping",
      "fast-off",
      undefined,
      { aiAllowed: false },
    );
    expect(result.fallback).toBe(true);
    expect(names(result.matches)).toContain("Tomas Silva");
    expect(result.matches.every((m) => m.verified === false)).toBe(true);
    expect(generateFor).not.toHaveBeenCalled();
  });

  it("falls back to the local hybrid list, not the keyword list, when the provider fails", async () => {
    script(null);
    // Every word must match for the old keyword fallback, and "knows" is in
    // nobody's profile, so it found nobody. The local list keeps the answer.
    expect(
      searchService.searchFts(scope(), "someone who knows about beekeeping"),
    ).toEqual([]);
    const result = await searchService.semanticSearch(
      scope(),
      "someone who knows about beekeeping",
      "fast-fail",
    );
    expect(calls()).toEqual(["planner", "reranker"]);
    expect(result.fallback).toBe(true);
    expect(names(result.matches)).toContain("Tomas Silva");
    expect(result.matches.every((m) => m.verified === false)).toBe(true);
  });
});

describe("the database proves a plan without the reranker", () => {
  const plan = (
    must: QueryPlan["must"],
    confidence: QueryPlan["confidence"] = "high",
    traits?: string[],
  ): QueryPlan => ({
    must,
    should: traits ? { traits } : {},
    confidence,
    rationale: "",
  });

  it.each([
    ["confident hard filters", plan({ roleMatchers: ["Investor"] }), "filters"],
    [
      "confident filters and recency",
      plan({
        locationMatchers: ["Berlin"],
        temporal: { type: "lastContact", daysAgo: 90 },
      }),
      "filters",
    ],
    [
      "recency alone, medium confidence",
      plan({ temporal: { type: "neverContacted" } }, "medium"),
      "temporal",
    ],
    [
      "recency alone, low confidence",
      plan({ temporal: { type: "neverContacted" } }, "low"),
      null,
    ],
    [
      "filters at medium confidence",
      plan({ companyMatchers: ["Acme"] }, "medium"),
      null,
    ],
    [
      "filters with a soft trait",
      plan({ locationMatchers: ["Lisbon"] }, "high", ["climbing"]),
      null,
    ],
    ["no hard filter", plan({}), null],
  ] as const)("%s → %s", (_label, candidate, proof) => {
    expect(databaseProof(candidate)).toBe(proof);
  });

  it("answers a confident, filter-complete plan from the filter", async () => {
    script({
      must: {
        roleMatchers: ["Product Manager"],
        companyMatchers: ["Northwind Logistics"],
      },
      should: {},
      confidence: "high",
      rationale: "Role and employer",
    });
    const result = await searchService.semanticSearch(
      scope(),
      "product manager at Northwind Logistics",
      "fast-sql",
    );
    expect(calls()).toEqual(["planner"]);
    expect(result.fallback).toBe(false);
    expect(result.matches).toEqual([
      expect.objectContaining({
        name: "Priya Raman",
        verified: true,
        aiReason: "Product Manager at Northwind Logistics.",
      }),
    ]);
  });

  it("lists every contact the filter found", async () => {
    // The filter holds the whole question, so its contacts are the answer,
    // ranked ones first, then the rest by name. There is no preposition in
    // front of the place, so implicit facets leave the question to the
    // planner.
    script({
      must: { locationMatchers: ["Lisbon"] },
      should: {},
      confidence: "high",
      rationale: "Place",
    });
    const result = await searchService.semanticSearch(
      scope(),
      "Lisbon folks",
      "fast-complete",
    );
    expect(calls()).toEqual(["planner"]);
    expect(names(result.matches).sort()).toEqual([
      "Priya Raman",
      "Tomas Silva",
    ]);
    expect(result.matches[0].aiReason).toBe("Based in Lisbon, Portugal.");
  });

  it("orders a recency question by last contact, never contacted first", async () => {
    const at = (days: number) =>
      new Date(Date.now() - days * 86_400_000).toISOString();
    const setLast = (name: string, value: string | null) =>
      sqlite
        .prepare(
          "UPDATE contacts SET lastContactedAt = ? WHERE id = ? AND ownerId = ?",
        )
        .run(value, ids.get(name), localOwnerId());
    setLast("Jonathan Smith", at(200));
    setLast("Priya Raman", at(10));
    setLast("Tomas Silva", at(100));
    setLast("Ines Costa", null);
    script({
      must: { temporal: { type: "lastContact", daysAgo: 90 } },
      should: {},
      confidence: "medium",
      rationale: "Recency",
    });
    const result = await searchService.semanticSearch(
      scope(),
      "people I haven't talked to in 3 months",
      "fast-temporal",
    );
    expect(calls()).toEqual(["planner"]);
    expect(names(result.matches)).toEqual([
      "Ines Costa",
      "Jonathan Smith",
      "Tomas Silva",
    ]);
    expect(result.matches.map((m) => m.aiReason)).toEqual([
      "No contact logged.",
      "Last contact 6 months ago.",
      "Last contact 3 months ago.",
    ]);
    expect(result.matches.every((m) => m.verified === true)).toBe(true);
  });

  it("still reranks a plan with a soft trait", async () => {
    script(
      {
        must: { locationMatchers: ["Lisbon"] },
        should: { traits: ["beekeeping"] },
        confidence: "high",
        rationale: "Place and hobby",
      },
      [
        {
          contact_id: ids.get("Tomas Silva"),
          verified_field: "interests",
          verified_value: "beekeeping",
        },
      ],
    );
    const result = await searchService.semanticSearch(
      scope(),
      "who in Lisbon keeps bees",
      "fast-trait",
    );
    expect(calls()).toEqual(["planner", "reranker"]);
    expect(result.matches).toEqual([
      expect.objectContaining({
        name: "Tomas Silva",
        verified: true,
        aiReason: "Interested in beekeeping, based in Lisbon, Portugal.",
      }),
    ]);
  });
});
