// =============================================================================
// Integration: facets in SQL, facets in Ask, and facets read from a question
// =============================================================================
// A facet runs inside each search statement, before its LIMIT, so a contact
// the facet keeps is found however far down the unfiltered ranking it sits.
// Every palette facet works on the server. Ask takes facets from the request
// and from the question, and a question that names a known place, company
// or industry is answered by the database with no model call. The traps of
// the plan (a company named after a city, "Paris, Texas", two places joined
// by "and") leave the question to the planner.
//
// The real pipeline and database run here. Only the provider is scripted, at
// the gateway, so a call the pipeline makes is a call these tests can count.
// =============================================================================

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

import crypto from "crypto";
import { generateFor } from "../../server/ai/gateway.ts";
import type { GatewayOptions } from "../../server/ai/gateway.ts";
import type { QueryPlan } from "../../server/ai/types.ts";
import { sqlite } from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { searchService } from "../../server/services/searchService.ts";
import { lexicalSearch } from "../../server/services/search/lexical.ts";
import { compileFacets } from "../../server/services/search/facetSql.ts";
import {
  findSearchNeighbors,
  upsertSearchEmbedding,
} from "../../server/services/search/localEmbeddings.ts";
import {
  findImplicitFacets,
  hasContentWords,
} from "../../server/services/search/implicitFacets.ts";
import { aiCache } from "../../server/utils/aiCache.ts";
import { makeTestApp } from "./helpers.ts";
import { localOwnerId } from "./tenancy/helpers.ts";

const app = makeTestApp();
const scope = () => scopeForOwnerId(localOwnerId());

/** Every call the gateway was asked to make, by what it was for. */
const calls = () =>
  vi
    .mocked(generateFor)
    .mock.calls.map(([, options]) =>
      options.systemPrompt?.includes("query planner") ? "planner" : "other",
    );

/** The planner returns `plan`. Any other call fails. */
function script(plan: QueryPlan | null) {
  vi.mocked(generateFor).mockImplementation(
    async (_capability, options: GatewayOptions) => {
      if (plan && options.systemPrompt?.includes("query planner"))
        return { text: JSON.stringify(plan), model: "fixture", latencyMs: 1 };
      throw new Error("Provider unavailable");
    },
  );
}

const ENGINEERS = 150;
const ids = new Map<string, string>();

interface Person {
  name: string;
  role?: string;
  company?: string;
  location?: string;
  industry?: string;
  about?: string;
  tags?: string[];
  emails?: string[];
}

const PEOPLE: Person[] = [
  // The contact the facets look for. "engineer" is only in her about
  // field, weight 1, so 150 engineers rank above her.
  {
    name: "Rhea Quill",
    role: "Consultant",
    about: "Trained as an engineer before consulting",
    tags: ["rare"],
    location: "Lisbon, Portugal",
  },
  {
    name: "Tomas Silva",
    role: "Product Manager",
    company: "Northwind Logistics",
    location: "Lisbon, Portugal",
    industry: "Fintech",
    tags: ["climber"],
    about: "Goes rock climbing every weekend",
    emails: ["tomas@example.com"],
  },
  {
    name: "Priya Raman",
    role: "Designer",
    company: "Northwind Logistics",
    location: "Paris, France",
    industry: "Design",
    emails: ["priya@example.com"],
  },
  {
    name: "Jean Dupont",
    role: "Rancher",
    company: "Lone Star Cattle",
    location: "Paris, Texas",
    industry: "Agriculture",
  },
  {
    name: "Mona Reyes",
    role: "Investor",
    company: "Porto Partners",
    location: "Berlin, Germany",
    industry: "Venture Capital",
  },
  {
    name: "Nils Berg",
    role: "Analyst",
    company: "Sequoia Capital",
    location: "Seattle, Washington",
    industry: "Fintech",
  },
  {
    name: "Dee Harper",
    role: "Producer",
    company: "Brandywine Studios",
    location: "Media, Pennsylvania",
    industry: "Media",
  },
];

beforeAll(async () => {
  const owner = localOwnerId();
  sqlite.prepare("DELETE FROM contacts WHERE ownerId = ?").run(owner);
  for (const person of PEOPLE) {
    const res = await request(app).post("/api/contacts").send(person);
    expect(res.status).toBe(201);
    ids.set(person.name, res.body.id);
  }
  // The rest of the address book: 150 engineers who outrank Rhea Quill.
  const { contactService } =
    await import("../../server/services/contactService.ts");
  const { createdIds } = await contactService.bulkCreateContacts(
    scope(),
    Array.from({ length: ENGINEERS }, (_, i) => ({
      name: `Engineer ${String(i).padStart(3, "0")}`,
      role: "Staff Engineer",
      company: "Engineering Guild",
      location: "Madrid, Spain",
    })),
  );
  createdIds.forEach((id, i) =>
    ids.set(`Engineer ${String(i).padStart(3, "0")}`, id),
  );

  // Coordinates for near:, a last contact for contacted:, a list for list:.
  const set = sqlite.prepare(
    "UPDATE contacts SET lat = ?, lng = ?, lastContactedAt = ? WHERE id = ? AND ownerId = ?",
  );
  const daysAgo = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString();
  set.run(38.72, -9.14, null, ids.get("Rhea Quill"), owner);
  set.run(38.71, -9.13, daysAgo(3), ids.get("Tomas Silva"), owner);
  set.run(48.86, 2.35, daysAgo(200), ids.get("Priya Raman"), owner);
  const listId = crypto.randomUUID();
  sqlite
    .prepare("INSERT INTO lists (id, name, ownerId) VALUES (?, ?, ?)")
    .run(listId, "Core Team", owner);
  for (const name of ["Rhea Quill", "Priya Raman"])
    sqlite
      .prepare("INSERT INTO list_members (listId, contactId) VALUES (?, ?)")
      .run(listId, ids.get(name));
}, 60_000);

beforeEach(() => {
  aiCache.invalidateAll();
  vi.mocked(generateFor).mockReset();
});

const names = (matches: { name: string }[]) => matches.map((m) => m.name);
const rare = [{ field: "tag" as const, value: "rare" }];

describe("facets run before the limit", () => {
  it("keeps a filtered contact that ranks about 150th unfiltered", () => {
    const unfiltered = lexicalSearch(scope(), "engineer", 200, null, true);
    const at = unfiltered.findIndex(
      (m) => m.contactId === ids.get("Rhea Quill"),
    );
    expect(at).toBeGreaterThanOrEqual(ENGINEERS);

    const facets = compileFacets(scope(), rare);
    expect(
      lexicalSearch(scope(), "engineer", 20, null, true, facets).map(
        (m) => m.contactId,
      ),
    ).toEqual([ids.get("Rhea Quill")]);
    expect(names(searchService.searchFts(scope(), "engineer", rare))).toEqual([
      "Rhea Quill",
    ]);
  });

  it("keeps a filtered contact the nearest neighbours would crowd out", () => {
    // Every engineer sits on the query vector. Rhea Quill points the other way.
    const unit = (sign: number) => {
      const v = new Float32Array(384);
      v[0] = sign;
      return v;
    };
    for (let i = 0; i < ENGINEERS; i++)
      upsertSearchEmbedding(
        ids.get(`Engineer ${String(i).padStart(3, "0")}`)!,
        unit(1),
      );
    upsertSearchEmbedding(ids.get("Rhea Quill")!, unit(-1));

    const plain = findSearchNeighbors(scope(), unit(1), 20);
    expect(plain.map((n) => n.contactId)).not.toContain(ids.get("Rhea Quill"));
    const filtered = findSearchNeighbors(
      scope(),
      unit(1),
      20,
      undefined,
      compileFacets(scope(), rare),
    );
    expect(filtered.map((n) => n.contactId)).toEqual([ids.get("Rhea Quill")]);
  });
});

describe("GET /api/search takes every palette facet", () => {
  const search = (q: string, filters: unknown) =>
    request(app)
      .get("/api/search")
      .query({ q, filters: JSON.stringify(filters) });

  it.each([
    ["list:", [{ field: "list", value: "core-team" }], ["Rhea Quill"]],
    ["missing:", [{ field: "missing", value: "email" }], ["Rhea Quill"]],
    [
      "near: with a point",
      [
        {
          field: "near",
          value: "Lisbon",
          km: 25,
          point: { lat: 38.72, lng: -9.14, km: 25 },
          resolving: false,
        },
      ],
      ["Rhea Quill"],
    ],
    ["contacted:", [{ field: "contacted", value: "90d", operator: "<" }], []],
  ])("answers %s", async (_facet, filters, expected) => {
    const res = await search("consultant", filters);
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(expected);
  });

  it("finds a recent contact with contacted:<30d", async () => {
    const res = await search("product manager", [
      { field: "contacted", value: "30d", operator: "<" },
    ]);
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(["Tomas Silva"]);
  });

  it("refuses an unknown facet field", async () => {
    const res = await search("consultant", [{ field: "mood", value: "happy" }]);
    expect(res.status).toBe(400);
  });
});

describe("Ask takes facets from the request and the question", () => {
  it("answers a question that is only facets from the database, with no model", async () => {
    script(null);
    const result = await searchService.semanticSearch(
      scope(),
      "tag:rare",
      "filters-only",
    );
    expect(calls()).toEqual([]);
    expect(result.fallback).toBe(false);
    expect(result.matches.map((m) => [m.name, m.verified, m.aiReason])).toEqual(
      [["Rhea Quill", true, "Tagged rare."]],
    );
    expect(result.total).toBe(1);
    // A facet that holds 150 people shows the first 30 and counts them all.
    const guild = await searchService.semanticSearch(
      scope(),
      'company:"Engineering Guild"',
      "filters-total",
    );
    expect(guild.matches).toHaveLength(30);
    expect(guild.total).toBe(ENGINEERS);
  });

  it("combines the request's facets with the typed ones, over HTTP", async () => {
    script(null);
    const res = await request(app)
      .post("/api/search/semantic")
      .send({
        query: "missing:email",
        filters: [{ field: "list", value: "core-team" }],
      });
    expect(res.status).toBe(200);
    expect(names(res.body.matches)).toEqual(["Rhea Quill"]);
    expect(calls()).toEqual([]);
  });

  it("keeps answers with different facets apart in the cache", async () => {
    script(null);
    // A name is answered from the keyword index, and the answer is kept.
    const ask = async (filters: unknown) =>
      names(
        (
          await request(app)
            .post("/api/search/semantic")
            .send({ query: "Priya Raman", filters })
        ).body.matches,
      );
    expect(await ask([])).toEqual(["Priya Raman"]);
    expect(await ask(rare)).toEqual([]);
  });

  it("refuses facets it cannot read", async () => {
    const res = await request(app)
      .post("/api/search/semantic")
      .send({ query: "people", filters: [{ field: "tag" }] });
    expect(res.status).toBe(400);
  });
});

describe("implicit facets", () => {
  it.each([
    [
      "people in Lisbon",
      [{ field: "location", value: "Lisbon" }],
      ["Rhea Quill", "Tomas Silva"],
    ],
    [
      "who works at Northwind Logistics",
      [{ field: "company", value: "Northwind Logistics" }],
      ["Priya Raman", "Tomas Silva"],
    ],
    [
      "who works in fintech",
      [{ field: "industry", value: "Fintech" }],
      ["Nils Berg", "Tomas Silva"],
    ],
    [
      "Who lives in Paris, France?",
      [{ field: "location", value: "Paris, France" }],
      ["Priya Raman"],
    ],
  ])(
    "answers %j from the database with no model",
    async (question, facets, expected) => {
      expect(findImplicitFacets(scope(), question).filters).toEqual(facets);
      script(null);
      const result = await searchService.semanticSearch(
        scope(),
        question,
        "implicit",
      );
      expect(calls()).toEqual([]);
      expect(result.fallback).toBe(false);
      expect(names(result.matches)).toEqual(expected);
      expect(result.matches.every((m) => m.verified)).toBe(true);
    },
  );

  it("builds the reason from the facet", async () => {
    script(null);
    const result = await searchService.semanticSearch(
      scope(),
      "people in Lisbon",
      "implicit-reason",
    );
    expect(result.matches[0].aiReason).toBe("Based in Lisbon, Portugal.");
  });

  it("joins the planner when the question asks for more", async () => {
    script({
      must: {},
      should: { traits: ["rock climbing"] },
      confidence: "medium",
      rationale: "A place and a pastime",
    });
    const result = await searchService.semanticSearch(
      scope(),
      "who in Lisbon goes rock climbing",
      "implicit-planner",
    );
    expect(calls()).toContain("planner");
    // The reranker fails here, so the local list is the answer, and the
    // Lisbon facet kept it to Lisbon.
    expect(result.fallback).toBe(true);
    expect(names(result.matches).sort()).toEqual(["Rhea Quill", "Tomas Silva"]);
  });

  it.each([
    // A company named after a city is not a place: nobody lives in Porto.
    ["people in Porto", []],
    // ...but it is a company.
    [
      "people at Porto Partners",
      [{ field: "company", value: "Porto Partners" }],
    ],
    // A place with a qualifier after the comma is the planner's call.
    [
      "Who lives in Paris, Texas?",
      [{ field: "location", value: "Paris, Texas" }],
    ],
    ["Who lives in Paris, Maine?", []],
    // Two places joined by "and" are either place, and facets are "and".
    ["fintech leaders in Berlin and Lisbon", []],
    // "State" makes the place a different one.
    ["Who lives in Washington State?", []],
    // Both a place and an industry here.
    ["producers in Media", []],
    // Not the whole name of a known company.
    ["Who is an investor at Sequoia?", []],
    // A comma that ends a clause is not a qualifier.
    ["In Lisbon, who climbs?", [{ field: "location", value: "Lisbon" }]],
    // No preposition.
    ["Lisbon climbers", []],
  ])("reads %j as %j", (question, facets) => {
    expect(findImplicitFacets(scope(), question).filters).toEqual(facets);
  });

  it("leaves the question to the planner when a trap blocks the facet", async () => {
    script({
      must: { locationMatchers: ["Paris"] },
      should: {},
      confidence: "high",
      rationale: "Place",
    });
    await searchService.semanticSearch(
      scope(),
      "Who lives in Paris, Maine?",
      "implicit-trap",
    );
    expect(calls()).toEqual(["planner"]);
  });

  it("tells filler words from content words", () => {
    expect(hasContentWords("who works")).toBe(false);
    expect(hasContentWords("Who's there")).toBe(false);
    expect(hasContentWords("who goes rock climbing")).toBe(true);
    expect(hasContentWords("Researchers")).toBe(true);
  });

  it("reads the owner's data again after an edit", async () => {
    expect(findImplicitFacets(scope(), "people in Oslo").filters).toEqual([]);
    const res = await request(app)
      .post("/api/contacts")
      .send({ name: "Ola Nordmann", location: "Oslo, Norway" });
    expect(res.status).toBe(201);
    expect(findImplicitFacets(scope(), "people in Oslo").filters).toEqual([
      { field: "location", value: "Oslo" },
    ]);
  });
});
