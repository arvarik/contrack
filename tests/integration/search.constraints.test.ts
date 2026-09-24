import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/ai/gateway.ts", () => ({
  generateFor: vi.fn(),
  isAnyProviderConfigured: () => true,
}));
vi.mock("../../server/ai/services/shared.ts", async (original) => ({
  ...(await original<typeof import("../../server/ai/services/shared.ts")>()),
  isMockMode: () => false,
}));
import { generateFor } from "../../server/ai/gateway.ts";
import { sqlite, ensureLocalOwner } from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { searchService } from "../../server/services/searchService.ts";
import { aiCache } from "../../server/utils/aiCache.ts";
import type { QueryPlan } from "../../server/ai/types.ts";

const scope = scopeForOwnerId(ensureLocalOwner());
const fixtures = [
  {
    query: "Investors at Sequoia Capital",
    roles: ["Investor", "Talent Scout"],
    locations: ["London", "London"],
    companies: ["Sequoia Capital", "Sequoia Capital"],
    headlines: [
      "Active venture investor",
      "Former investor, now recruits engineers",
    ],
    must: { roleMatchers: ["Investor"], companyMatchers: ["Sequoia Capital"] },
  },
  {
    query: "Software engineers in NYC",
    roles: ["Software Engineer", "Software Engineer"],
    locations: ["New York, NY", "Buffalo, New York"],
    must: {
      roleMatchers: ["Software Engineer"],
      locationMatchers: ["NYC", "New York"],
    },
  },
  {
    query: "Software engineers in Washington State",
    roles: ["Software Engineer", "Software Engineer"],
    locations: ["Seattle, Washington", "Washington, D.C., USA"],
    must: {
      roleMatchers: ["Software Engineer"],
      locationMatchers: ["Washington", "WA"],
    },
  },
  {
    query: "Software engineers in London",
    roles: ["Software Engineer", "Software Engineer"],
    locations: ["London, United Kingdom", "Cambridge, United Kingdom"],
    must: {
      roleMatchers: ["Software Engineer"],
      temporal: { type: "lastContact" as const, daysAgo: 180 },
    },
    traits: ["London"],
  },
  {
    query: "Researchers in Cambridge, Massachusetts",
    roles: ["Research Fellow", "Research Fellow"],
    locations: ["Cambridge, Massachusetts", "Cambridge, United Kingdom"],
    must: {
      roleMatchers: ["Researcher"],
      locationMatchers: ["Cambridge", "Massachusetts", "UK"],
    },
  },
  {
    query: "Investors at Sequoia",
    roles: ["Venture Scout", "Talent Scout"],
    locations: ["London", "London"],
    must: { roleMatchers: ["Investor"], companyMatchers: ["Sequoia"] },
  },
  {
    query: "Who lives in California?",
    roles: ["Engineer", "Engineer"],
    locations: ["San Francisco, California", "London, United Kingdom"],
    must: { locationMatchers: ["California", "CA"] },
    companies: ["Acme", "California Design"],
  },
  {
    query: "Software engineers at Stripe",
    roles: ["Software Engineer", "Software Engineer"],
    locations: ["London", "London"],
    must: { companyMatchers: ["Stripe"], roleMatchers: ["Software Engineer"] },
    companies: ["Stripe", "Meta"],
    headlines: ["Payments", "Former Stripe engineer"],
  },
  // A role word finds its other forms in a title: the person asks for
  // engineers, and the contact's role is Engineering.
  {
    query: "Engineers at Acme",
    roles: ["Engineering", "Sales"],
    locations: ["London", "London"],
    must: { roleMatchers: ["Engineer"], companyMatchers: ["Acme"] },
    companies: ["Acme", "Acme"],
  },
  {
    query: "Designers at Aperture",
    roles: ["Design", "Marketing"],
    locations: ["London", "London"],
    must: { roleMatchers: ["Designer"], companyMatchers: ["Aperture"] },
    companies: ["Aperture Science", "Aperture Science"],
  },
  {
    query: "Fintech leaders in London",
    roles: ["Staff Software Engineer", "Junior Software Engineer"],
    locations: ["London", "London"],
    must: {
      industryMatchers: ["Fintech"],
      roleMatchers: ["Leader"],
      locationMatchers: ["London"],
    },
  },
];

beforeEach(() => {
  sqlite.prepare("DELETE FROM contacts").run();
  aiCache.invalidateAll();
  vi.mocked(generateFor).mockReset();
});

describe("query constraints through real retrieval and evidence verification", () => {
  it.each(fixtures)(
    "preserves the matching contact and excludes its near-match: $query",
    async (fixture) => {
      const rows = fixture.roles.map((role, index) => ({
        id: `paired-${index}`,
        name: `Pair ${index}`,
        role,
        location: fixture.locations[index],
        company: fixture.companies?.[index] ?? "Sequoia",
        headline: fixture.headlines?.[index] ?? "",
        industry: "Fintech",
      }));
      for (const row of rows)
        sqlite
          .prepare(
            "INSERT INTO contacts(id,ownerId,name,role,location,company,headline,industry,lastContactedAt) VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
          )
          .run(
            row.id,
            scope.ownerId,
            row.name,
            row.role,
            row.location,
            row.company,
            row.headline,
            row.industry,
          );
      const plan: QueryPlan = {
        must: fixture.must,
        should: { traits: fixture.traits ?? [] },
        confidence: "high",
        rationale: "Test query interpretation",
      };
      vi.mocked(generateFor).mockImplementation(
        async (_capability, options) => ({
          text: JSON.stringify(
            options.systemPrompt?.includes("query planner")
              ? plan
              : rows.map((row) => ({
                  contact_id: row.id,
                  verified_field: "role",
                  verified_value: row.role,
                  reason: `${row.name} is a ${row.role}.`,
                })),
          ),
          model: "fixture",
          latencyMs: 1,
        }),
      );
      const result = await searchService.semanticSearch(
        scope,
        fixture.query,
        "paired-query",
      );
      expect(result.fallback).toBe(false);
      expect(result.matches.map((match) => match.id)).toEqual(["paired-0"]);
      const rerank = vi
        .mocked(generateFor)
        .mock.calls.find(([, options]) =>
          options.systemPrompt?.includes("data analyst"),
        );
      expect(rerank?.[1].prompt).toContain("paired-0");
      expect(rerank?.[1].prompt).not.toContain("paired-1");
    },
  );
});
