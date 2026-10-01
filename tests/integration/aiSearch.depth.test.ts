// =============================================================================
// Integration: the two research depths, from the API to the research record
// =============================================================================
// Standard asks once, at thinking "medium". Deep asks the same, and beside
// it, at "high", for a complete profile, and keeps what both cite. Both keep
// what they spent.
// =============================================================================

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import request from "supertest";
vi.mock("../../server/ai/gateway.ts", () => ({
  generateFor: vi.fn(),
  isAnyProviderConfigured: vi.fn(() => true),
  providerIdFor: () => "gemini",
}));
vi.mock("../../server/ai/capabilities.ts", async (original) => ({
  ...(await original<typeof import("../../server/ai/capabilities.ts")>()),
  resolveCapability: vi.fn(() => ({
    providerId: "gemini",
    model: "mock-lite",
    modelClass: "lite",
    provider: {},
  })),
}));
import {
  generateFor,
  isAnyProviderConfigured,
} from "../../server/ai/gateway.ts";
import { sqlite } from "../../server/db.ts";
import { makeTestApp } from "./helpers.ts";
import { enrichmentContact } from "../../server/services/aiSearch/contactSnapshot.ts";
import { jobQueue } from "../../server/services/aiSearch/jobQueue.ts";
import { TwoPassStrategy } from "../../server/services/aiSearch/strategies/twoPass.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { localOwnerId } from "./tenancy/helpers.ts";
import { parseResearchRecord } from "../../shared/researchRecord.ts";
import { NO_MATCHING_PAGES } from "../../server/services/aiSearch/promptTemplate.ts";
import type {
  AIGenerateOptions,
  AIGenerateResult,
} from "../../server/ai/types.ts";

const app = makeTestApp();
const scope = () => scopeForOwnerId(localOwnerId());

/** A search answer that cites one page and ran the searches it names. */
const found = (
  text: string,
  uri = "https://example.com/profile",
  searchQueries = ['"Test Person" Test Company'],
): AIGenerateResult => ({
  text,
  model: "mock-flash",
  latencyMs: 1,
  tokenCount: 10,
  usage: { inputTokens: 100, outputTokens: 50 },
  citations: [{ title: "Test source", uri }],
  searchQueries,
});
const extraction = (json: string): AIGenerateResult => ({
  text: json,
  model: "mock-lite",
  latencyMs: 1,
  tokenCount: 5,
  usage: { inputTokens: 20, outputTokens: 10 },
});
const noPages = (text: string): AIGenerateResult => ({
  ...found(text),
  citations: [],
  searchQueries: [],
});
/** The no-match reply, after the searches it names, or after none. */
const noMatch = (searchQueries: string[] = []): AIGenerateResult => ({
  ...noPages(NO_MATCHING_PAGES),
  searchQueries,
});

/** What each call asked for, in order. */
const calls = () =>
  vi.mocked(generateFor).mock.calls.map(([capability, options]) => ({
    capability,
    ...(options as AIGenerateOptions),
  }));

let id: string;
beforeEach(async () => {
  jobQueue.__resetForTests();
  vi.mocked(generateFor).mockReset();
  vi.mocked(isAnyProviderConfigured).mockReturnValue(true);
  sqlite.prepare("DELETE FROM contacts").run();
  id = (
    await request(app)
      .post("/api/contacts")
      .send({ name: "Test Person", company: "Test Company" })
  ).body.id;
});
afterEach(() => jobQueue.__resetForTests());

describe("Standard", () => {
  it("searches once at thinking medium, extracts, and counts what it spent", async () => {
    vi.mocked(generateFor)
      .mockResolvedValueOnce(found("- Past role: Analyst, Acme [example.com]"))
      .mockResolvedValueOnce(extraction('{"location":"New York, NY"}'));
    const result = await new TwoPassStrategy().execute(
      enrichmentContact(scope(), id),
      "research prompt",
    );
    expect(
      calls().map((call) => [call.capability, call.thinkingLevel]),
    ).toEqual([
      ["research", "medium"],
      ["quick", undefined],
    ]);
    expect(result.depth).toBe("standard");
    expect(result.usage).toEqual({
      calls: 2,
      searches: 1,
      inputTokens: 120,
      outputTokens: 60,
    });
  });
});

describe("Deep", () => {
  it("asks for the main facts at medium and a complete profile at high, at once, and extracts both", async () => {
    vi.mocked(generateFor)
      .mockResolvedValueOnce(found("- Past role: Analyst, Acme [example.com]"))
      .mockResolvedValueOnce(
        found(
          "- Award: Fellow, Example School [fellows.example.org]",
          "https://fellows.example.org/people/test",
          ['"Test Person" fellow'],
        ),
      )
      .mockResolvedValueOnce(extraction('{"location":"New York, NY"}'));
    const result = await new TwoPassStrategy().execute(
      enrichmentContact(scope(), id),
      "research prompt",
      undefined,
      { depth: "deep" },
    );
    const [plain, complete, read] = calls();
    expect(plain.prompt).toBe("research prompt");
    expect(complete.prompt).toContain("Aim for a complete profile");
    expect(calls().map((call) => call.thinkingLevel)).toEqual([
      "medium",
      "high",
      undefined,
    ]);
    // The extraction reads both answers' lines.
    expect(read.prompt).toContain("Analyst, Acme");
    expect(read.prompt).toContain("Fellow, Example School");
    expect(result.citations?.map((citation) => citation.uri)).toEqual([
      "https://example.com/profile",
      "https://fellows.example.org/people/test",
    ]);
    expect(result.findings?.map((finding) => finding.topic)).toEqual([
      "Past role",
      "Award",
    ]);
    expect(result.searchQueries).toEqual([
      '"Test Person" Test Company',
      '"Test Person" fellow',
    ]);
    expect(result.usage?.calls).toBe(3);
  });

  it("keeps the medium answer when the high one comes back empty", async () => {
    vi.mocked(generateFor)
      .mockResolvedValueOnce(found("- Past role: Analyst, Acme [example.com]"))
      .mockResolvedValueOnce(noPages(""))
      .mockResolvedValueOnce(extraction('{"location":"New York, NY"}'));
    const result = await new TwoPassStrategy().execute(
      enrichmentContact(scope(), id),
      "research prompt",
      undefined,
      { depth: "deep" },
    );
    expect(result.outcome).toBe("found");
    expect(result.findings).toHaveLength(1);
    expect(calls().map((call) => call.capability)).toEqual([
      "research",
      "research",
      "quick",
    ]);
  });

  it("asks twice more, at medium, when neither first ask cites a page", async () => {
    vi.mocked(generateFor)
      .mockResolvedValueOnce(noPages(""))
      .mockResolvedValueOnce(noPages("From memory"))
      .mockResolvedValueOnce(found("- Past role: Analyst, Acme [example.com]"))
      .mockResolvedValueOnce(noPages("From memory again"))
      .mockResolvedValueOnce(extraction("{}"));
    await new TwoPassStrategy().execute(
      enrichmentContact(scope(), id),
      "research prompt",
      undefined,
      { depth: "deep" },
    );
    expect(calls().map((call) => call.thinkingLevel)).toEqual([
      "medium",
      "high",
      "medium",
      "medium",
      undefined,
    ]);
    expect(calls()[2].prompt).toMatch(
      /^Before anything else, run these Google searches/,
    );
    expect(calls()[3].prompt).toMatch(/^Run Google searches about one person/);
  });
});

describe("the no-match reply", () => {
  it("records no public information when the reply ran a search", async () => {
    vi.mocked(generateFor)
      .mockResolvedValueOnce(noMatch(['"Test Person" Test Company']))
      .mockResolvedValueOnce(noMatch())
      .mockResolvedValueOnce(noMatch());
    const response = await request(app).post(`/api/contacts/${id}/enrich`);
    expect(response.status).toBe(200);
    expect(response.body.outcome).toBe("no-public-info");
    // Three asks and no extraction: there is nothing to read.
    expect(calls().map((call) => call.capability)).toEqual([
      "research",
      "research",
      "research",
    ]);
    const run = parseResearchRecord(enrichmentContact(scope(), id).aiResearch)!
      .runs[0];
    expect(run).toMatchObject({
      outcome: "no-public-info",
      queries: ['"Test Person" Test Company'],
    });
  });

  it("records nothing, and says the model did not search, when no reply ran a search", async () => {
    vi.mocked(generateFor).mockResolvedValue(noMatch());
    const response = await request(app).post(`/api/contacts/${id}/enrich`);
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("AI_NO_SEARCH");
    expect(response.body.error.message).toContain(
      "did not report a web search",
    );
    expect(generateFor).toHaveBeenCalledTimes(3);
    const after = enrichmentContact(scope(), id);
    expect(after.aiHydratedAt).toBeNull();
    expect(after.aiResearch).toBeNull();
  });

  it("fails a batch job with the reason, and leaves the contact unresearched", async () => {
    vi.mocked(generateFor).mockResolvedValue(noMatch());
    const batch = jobQueue.createBatch(
      scope(),
      [{ id, name: "Test Person" }],
      "two-pass",
    );
    await jobQueue.processBatch(batch.id);
    expect(batch.jobs[0]).toMatchObject({
      status: "error",
      errorType: "validation",
    });
    expect(batch.jobs[0].error).toContain("did not report a web search");
    expect(batch.jobs[0].outcome).toBeUndefined();
    expect(enrichmentContact(scope(), id).aiHydratedAt).toBeNull();
  });

  it("reports the provider's error when the further asks fail after a no-match with no search", async () => {
    vi.mocked(generateFor)
      .mockResolvedValueOnce(noMatch())
      .mockRejectedValue(new Error("Network 500"));
    await expect(
      new TwoPassStrategy().execute(
        enrichmentContact(scope(), id),
        "research prompt",
      ),
    ).rejects.toThrow("Network 500");
  });

  it("keeps a no-match that ran a search when the further asks fail", async () => {
    vi.mocked(generateFor)
      .mockResolvedValueOnce(noMatch(['"Test Person" Test Company']))
      .mockRejectedValue(new Error("Network 500"));
    const result = await new TwoPassStrategy().execute(
      enrichmentContact(scope(), id),
      "research prompt",
    );
    expect(result.outcome).toBe("no-public-info");
    expect(result.searchQueries).toEqual(['"Test Person" Test Company']);
  });
});

describe("the facts of several asks", () => {
  it("keeps each fact once, with the copy that names its site", async () => {
    vi.mocked(generateFor)
      .mockResolvedValueOnce(
        found(
          [
            "- Current role: Co-Founder & CEO at Test Company",
            "- Past role: Analyst, Acme [example.com]",
          ].join("\n"),
        ),
      )
      .mockResolvedValueOnce(
        found(
          [
            "- Current role: Co-Founder and CEO of Test Company [testcompany.example]",
            "- Past role: Analyst, Acme",
            "- Award: Fellow, Example School [fellows.example.org]",
          ].join("\n"),
          "https://fellows.example.org/people/test",
        ),
      )
      .mockResolvedValueOnce(extraction("{}"));
    const result = await new TwoPassStrategy().execute(
      enrichmentContact(scope(), id),
      "research prompt",
      undefined,
      { depth: "deep" },
    );
    expect(result.findings).toEqual([
      {
        topic: "Current role",
        text: "Co-Founder and CEO of Test Company",
        site: "testcompany.example",
      },
      { topic: "Past role", text: "Analyst, Acme", site: "example.com" },
      {
        topic: "Award",
        text: "Fellow, Example School",
        site: "fellows.example.org",
      },
    ]);
  });
});

describe("the depth through the API", () => {
  it("refuses a depth that does not exist", async () => {
    const batch = await request(app)
      .post("/api/ai-search")
      .send({ contactIds: [id], depth: "extreme" });
    expect(batch.status).toBe(400);
    const single = await request(app)
      .post(`/api/contacts/${id}/enrich`)
      .send({ depth: "extreme" });
    expect(single.status).toBe(400);
    expect(generateFor).not.toHaveBeenCalled();
  });

  it("gives each job of a batch its depth, Standard when none is named", () => {
    const deep = jobQueue.createBatch(
      scope(),
      [{ id, name: "Test Person" }],
      "two-pass",
      "deep",
    );
    expect(deep.jobs[0].depth).toBe("deep");
    jobQueue.__resetForTests();
    const standard = jobQueue.createBatch(
      scope(),
      [{ id, name: "Test Person" }],
      "two-pass",
    );
    expect(standard.jobs[0].depth).toBe("standard");
  });

  it("researches one contact at the depth its request names, and records it", async () => {
    vi.mocked(generateFor)
      .mockResolvedValueOnce(found("- Past role: Analyst, Acme [example.com]"))
      .mockResolvedValueOnce(noPages("From memory"))
      .mockResolvedValueOnce(extraction('{"location":"New York, NY"}'));
    const response = await request(app)
      .post(`/api/contacts/${id}/enrich`)
      .send({ depth: "deep" });
    expect(response.status).toBe(200);
    expect(calls()[1].thinkingLevel).toBe("high");
    const run = parseResearchRecord(enrichmentContact(scope(), id).aiResearch)!
      .runs[0];
    expect(run.depth).toBe("deep");
    // Three calls, each counted: the two first asks and the extraction. The
    // ask that cited nothing ran no search.
    expect(run.usage).toEqual({
      calls: 3,
      searches: 1,
      inputTokens: 220,
      outputTokens: 110,
    });
  });

  it("researches at Standard when the request has no body", async () => {
    vi.mocked(generateFor)
      .mockResolvedValueOnce(found("- Past role: Analyst, Acme [example.com]"))
      .mockResolvedValueOnce(extraction('{"location":"New York, NY"}'));
    const response = await request(app).post(`/api/contacts/${id}/enrich`);
    expect(response.status).toBe(200);
    expect(calls().map((call) => call.capability)).toEqual([
      "research",
      "quick",
    ]);
  });
});
