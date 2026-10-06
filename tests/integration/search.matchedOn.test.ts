// Integration: every Ask answer says which fields answer the question
// "Who is interested in machine learning?" finds people through different
// fields: an interest, a role, an about text, a tag. Each result carries the
// fields that matched, with no model call, on every path an answer takes:
// the local list (AI off, or AI failed), a facet the database proves, and a
// list the AI check verified. The field a filter or the AI check proved is
// first, and says what proved it.
//
// The real pipeline and database run here. Only the provider is scripted, at
// the gateway, so the AI check's citations are known.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { searchService } from "../../server/services/searchService.ts";
import { aiCache } from "../../server/utils/aiCache.ts";
import type { MatchedOn } from "../../shared/matchedOn.ts";
import { makeTestApp } from "./helpers.ts";
import { localOwnerId } from "./tenancy/helpers.ts";

const app = makeTestApp();
const scope = () => scopeForOwnerId(localOwnerId());
const ids = new Map<string, string>();

const PEOPLE = [
  {
    name: "Ana Fonseca",
    role: "Designer",
    company: "Contoso",
    location: "Lisbon, Portugal",
    interests: ["Machine Learning", "Jazz"],
  },
  {
    name: "Ben Okafor",
    role: "Machine Learning Engineer",
    company: "Globex",
    location: "Lisbon, Portugal",
  },
  {
    name: "Cara Lind",
    role: "Analyst",
    company: "Initech",
    about: "Applies machine learning to fraud detection at a bank",
  },
  {
    name: "Dev Patel",
    role: "Chef",
    company: "Globex",
    tags: ["ml"],
  },
];

const QUESTION = "Who is interested in machine learning?";

/** The first matched field of each result, by name. */
function firstFields(matches: { name: string; matchedOn?: MatchedOn[] }[]) {
  return Object.fromEntries(
    matches.map((m) => [m.name, m.matchedOn?.[0]]),
  ) as Record<string, MatchedOn | undefined>;
}

const marked = (entry: MatchedOn | undefined) =>
  entry?.marks.map(([a, b]) => entry.text.slice(a, b));

beforeAll(async () => {
  sqlite.prepare("DELETE FROM contacts WHERE ownerId = ?").run(localOwnerId());
  for (const person of PEOPLE) {
    const res = await request(app).post("/api/contacts").send(person);
    expect(res.status).toBe(201);
    ids.set(person.name, res.body.id);
  }
});

beforeEach(() => {
  aiCache.invalidateAll();
  vi.mocked(generateFor).mockReset();
});

describe("the local list", () => {
  it("names the field each person matched on, with AI off", async () => {
    const result = await searchService.semanticSearch(
      scope(),
      QUESTION,
      "matched-local",
      undefined,
      { aiAllowed: false },
    );
    expect(result.fallback).toBe(true);
    expect(generateFor).not.toHaveBeenCalled();
    const first = firstFields(result.matches);
    expect(first["Ana Fonseca"]).toMatchObject({
      field: "interest",
      text: "Machine Learning",
      how: "words",
    });
    expect(first["Ben Okafor"]).toMatchObject({
      field: "role",
      text: "Machine Learning Engineer",
      how: "words",
    });
    expect(first["Cara Lind"]).toMatchObject({ field: "about", how: "words" });
    expect(marked(first["Cara Lind"])).toEqual(["machine learning"]);

    // A tag answers a question that names it.
    const tagged = await searchService.semanticSearch(
      scope(),
      "Who is tagged ml?",
      "matched-tag",
      undefined,
      { aiAllowed: false },
    );
    expect(firstFields(tagged.matches)["Dev Patel"]).toEqual({
      field: "tag",
      text: "ml",
      marks: [[0, 2]],
      how: "words",
    });
  });

  it("does the same when AI fails, and streams it in both chunks", async () => {
    vi.mocked(generateFor).mockRejectedValue(new Error("Provider down"));
    const res = await request(app)
      .post("/api/search/semantic")
      .set("Accept", "application/x-ndjson")
      .send({ query: QUESTION });
    expect(res.status).toBe(200);
    const chunks = res.text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(chunks.map((c) => c.phase)).toEqual(["instant", "complete"]);
    for (const chunk of chunks) {
      expect(chunk.fallback).toBe(true);
      const first = firstFields(chunk.matches);
      expect(first["Ana Fonseca"]?.field, chunk.phase).toBe("interest");
      expect(first["Ben Okafor"]?.field, chunk.phase).toBe("role");
    }
  });
});

describe("a facet the database proves", () => {
  it("names the field the filter checked, marked as a filter", async () => {
    const result = await searchService.semanticSearch(
      scope(),
      "Who works at Globex?",
      "matched-facet",
    );
    expect(generateFor).not.toHaveBeenCalled();
    expect(result.matches.map((m) => m.name).sort()).toEqual([
      "Ben Okafor",
      "Dev Patel",
    ]);
    for (const match of result.matches)
      expect(match.matchedOn?.[0]).toEqual({
        field: "company",
        text: "Globex",
        marks: [[0, 6]],
        how: "filter",
      });
  });
});

describe("a list the AI check verified", () => {
  it("puts the field the AI check cited first, marked as AI", async () => {
    const plan: QueryPlan = {
      must: {},
      should: { traits: ["machine learning"] },
      confidence: "high",
      rationale: "A trait",
    };
    vi.mocked(generateFor).mockImplementation(
      async (_capability, options: GatewayOptions) => {
        if (options.systemPrompt?.includes("query planner"))
          return { text: JSON.stringify(plan), model: "fixture", latencyMs: 1 };
        return {
          text: JSON.stringify([
            {
              contact_id: ids.get("Ana Fonseca"),
              verified_field: "interests",
              verified_value: "Machine Learning",
            },
            {
              contact_id: ids.get("Ben Okafor"),
              verified_field: "role",
              verified_value: "Machine Learning Engineer",
            },
          ]),
          model: "fixture",
          latencyMs: 1,
        };
      },
    );
    const result = await searchService.semanticSearch(
      scope(),
      QUESTION,
      "matched-ai",
    );
    expect(result.fallback).toBe(false);
    const first = firstFields(result.matches);
    expect(Object.keys(first).sort()).toEqual(["Ana Fonseca", "Ben Okafor"]);
    expect(first["Ana Fonseca"]).toEqual({
      field: "interest",
      text: "Machine Learning",
      marks: [[0, 16]],
      how: "ai",
    });
    expect(first["Ben Okafor"]).toEqual({
      field: "role",
      text: "Machine Learning Engineer",
      marks: [[0, 16]],
      how: "ai",
    });
  });
});
