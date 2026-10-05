// =============================================================================
// Integration: the two research depths, from the API to the research record
// =============================================================================
// Standard asks the plain sentence once, at thinking "medium". Deep asks
// the long prompt beside it, at "medium" too, and keeps what both cite.
// Whether an ask searched comes from its search metadata: none searched is
// one more plain ask and then AI_NO_SEARCH, and a search with nothing about
// the person is no public information. Both depths keep what they spent.
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
import { makeTestApp, researchWith } from "./helpers.ts";
import { enrichmentContact } from "../../server/services/aiSearch/contactSnapshot.ts";
import { jobQueue } from "../../server/services/aiSearch/jobQueue.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { localOwnerId } from "./tenancy/helpers.ts";
import { parseResearchRecord } from "../../shared/researchRecord.ts";
import {
  buildQuickSearchPrompt,
  buildSearchPrompt,
  NO_MATCHING_PAGES,
} from "../../server/services/aiSearch/promptTemplate.ts";
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
/** A reply that finds nobody, after the searches it names, or after none. */
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
    const result = await researchWith("provider-search", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
    });
    expect(
      calls().map((call) => [call.capability, call.thinkingLevel]),
    ).toEqual([
      ["research", "medium"],
      ["quick", undefined],
    ]);
    expect(calls()[0].prompt).toBe(
      buildQuickSearchPrompt(enrichmentContact(scope(), id)),
    );
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
  it("asks the plain sentence and the long prompt at once, both at medium, and extracts both", async () => {
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
    const result = await researchWith("provider-search", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
      depth: "deep",
    });
    const [plain, long, read] = calls();
    const contact = enrichmentContact(scope(), id);
    expect(plain.prompt).toBe(buildQuickSearchPrompt(contact));
    expect(long.prompt).toBe(buildSearchPrompt(contact));
    expect(calls().map((call) => call.thinkingLevel)).toEqual([
      "medium",
      "medium",
      undefined,
    ]);
    // The extraction reads both answers.
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

  it("keeps the plain answer when the long one comes back empty", async () => {
    vi.mocked(generateFor)
      .mockResolvedValueOnce(found("- Past role: Analyst, Acme [example.com]"))
      .mockResolvedValueOnce(noPages(""))
      .mockResolvedValueOnce(extraction('{"location":"New York, NY"}'));
    const result = await researchWith("provider-search", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
      depth: "deep",
    });
    expect(result.outcome).toBe("found");
    expect(result.findings).toHaveLength(1);
    expect(calls().map((call) => call.capability)).toEqual([
      "research",
      "research",
      "quick",
    ]);
  });
});

describe("whether the model searched", () => {
  it("asks the plain sentence once more when no first ask searched, and uses that answer", async () => {
    vi.mocked(generateFor)
      .mockResolvedValueOnce(noPages(""))
      .mockResolvedValueOnce(noPages("From memory"))
      .mockResolvedValueOnce(found("- Past role: Analyst, Acme [example.com]"))
      .mockResolvedValueOnce(extraction('{"location":"New York, NY"}'));
    const result = await researchWith("provider-search", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
      depth: "deep",
    });
    expect(calls().map((call) => call.thinkingLevel)).toEqual([
      "medium",
      "medium",
      "medium",
      undefined,
    ]);
    expect(calls()[2].prompt).toBe(
      buildQuickSearchPrompt(enrichmentContact(scope(), id)),
    );
    expect(result.outcome).toBe("found");
    // The answers from memory cite nothing and reach no extraction.
    expect(calls()[3].prompt).not.toContain("From memory");
  });

  it("records no public information when an ask searched and cited nothing", async () => {
    vi.mocked(generateFor).mockResolvedValueOnce(
      noMatch(['"Test Person" Test Company']),
    );
    const response = await request(app).post(`/api/contacts/${id}/enrich`);
    expect(response.status).toBe(200);
    expect(response.body.outcome).toBe("no-public-info");
    // One ask and no extraction: it searched, and there is nothing to read.
    expect(calls().map((call) => call.capability)).toEqual(["research"]);
    const run = parseResearchRecord(enrichmentContact(scope(), id).aiResearch)!
      .runs[0];
    expect(run).toMatchObject({
      outcome: "no-public-info",
      queries: ['"Test Person" Test Company'],
    });
  });

  it("records nothing, and says the model did not search, when neither ask searched", async () => {
    // A reply can say it searched without having searched.
    vi.mocked(generateFor).mockResolvedValue(
      noPages("No matching pages were found in the search results."),
    );
    const response = await request(app).post(`/api/contacts/${id}/enrich`);
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("AI_NO_SEARCH");
    expect(response.body.error.message).toContain("did not run a web search");
    expect(generateFor).toHaveBeenCalledTimes(2);
    const after = enrichmentContact(scope(), id);
    expect(after.aiHydratedAt).toBeNull();
    expect(after.aiResearch).toBeNull();
  });

  it("fails a batch job with the reason, and leaves the contact unresearched", async () => {
    vi.mocked(generateFor).mockResolvedValue(noMatch());
    const batch = jobQueue.createBatch(scope(), [{ id, name: "Test Person" }], {
      technique: "provider-search",
    });
    await jobQueue.processBatch(batch.id);
    expect(batch.jobs[0]).toMatchObject({
      status: "error",
      errorType: "validation",
    });
    expect(batch.jobs[0].error).toContain("did not run a web search");
    expect(batch.jobs[0].outcome).toBeUndefined();
    expect(enrichmentContact(scope(), id).aiHydratedAt).toBeNull();
  });

  it("reports the provider's error when the second ask fails", async () => {
    vi.mocked(generateFor)
      .mockResolvedValueOnce(noMatch())
      .mockRejectedValue(new Error("Network 500"));
    await expect(
      researchWith("provider-search", {
        scope: scope(),
        contact: enrichmentContact(scope(), id),
      }),
    ).rejects.toThrow("Network 500");
  });
});

describe("what the pages said", () => {
  it("leaves out the pages of a run marked Not this person, and what only they back", async () => {
    const namesake = "https://athletics.example/roster/test-person";
    sqlite.prepare("UPDATE contacts SET aiResearch = ? WHERE id = ?").run(
      JSON.stringify({
        version: 1,
        runs: [
          {
            at: "2026-10-04T10:00:00.000Z",
            models: ["mock-flash"],
            outcome: "added",
            added: [],
            sourceCount: 1,
            queries: [],
            findings: [],
            rejected: true,
          },
        ],
        sources: [],
        rejectedSources: [namesake],
      }),
      id,
    );
    vi.mocked(generateFor)
      .mockResolvedValueOnce({
        ...found(
          "- Past role: Analyst, Acme [example.com]\n- Award: Conference champion, 800 m [athletics.example]",
        ),
        citations: [
          { title: "example.com", uri: "https://example.com/profile" },
          { title: "athletics.example", uri: namesake },
        ],
        supports: [
          {
            text: "- Award: Conference champion, 800 m [athletics.example]",
            uris: [namesake],
          },
        ],
      })
      .mockResolvedValueOnce(extraction('{"location":"New York, NY"}'));
    const result = await researchWith("provider-search", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
      history: parseResearchRecord(enrichmentContact(scope(), id).aiResearch),
    });
    expect(result.citations?.map((citation) => citation.uri)).toEqual([
      "https://example.com/profile",
    ]);
    expect(calls()[1].prompt).not.toContain("Conference champion");
    expect(result.findings?.map((finding) => finding.topic)).toEqual([
      "Past role",
    ]);
  });

  it("records no public information, with no fields and no pages, when the facts only restate the records", async () => {
    vi.mocked(generateFor)
      .mockResolvedValueOnce(found("- Current role: Analyst, Test Company"))
      .mockResolvedValueOnce(
        extraction(
          JSON.stringify({
            headline: "Analyst at Test Company",
            industry: "Software",
            tags: [{ tag: "analytics" }],
            experience: [{ company: "Test Company", isCurrent: true }],
          }),
        ),
      );
    const response = await request(app).post(`/api/contacts/${id}/enrich`);
    expect(response.body.outcome).toBe("no-public-info");
    const after = enrichmentContact(scope(), id);
    expect(after.headline).toBeNull();
    expect(after.experience).toEqual([]);
    const record = parseResearchRecord(after.aiResearch)!;
    expect(record.sources).toEqual([]);
    expect(record.runs[0].added).toEqual([]);
  });

  it("leaves out job postings and the passages only they back", async () => {
    vi.mocked(generateFor)
      .mockResolvedValueOnce({
        ...found(
          "- Past role: Analyst, Acme [example.com]\n- Duty: Builds dashboards for the sales team [indeed.com]",
        ),
        citations: [
          { title: "example.com", uri: "https://example.com/profile" },
          { title: "indeed.com", uri: "https://www.indeed.com/viewjob?jk=1" },
        ],
        supports: [
          {
            text: "- Duty: Builds dashboards for the sales team [indeed.com]",
            uris: ["https://www.indeed.com/viewjob?jk=1"],
          },
        ],
      })
      .mockResolvedValueOnce(extraction('{"location":"New York, NY"}'));
    const result = await researchWith("provider-search", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
    });
    expect(result.citations?.map((citation) => citation.uri)).toEqual([
      "https://example.com/profile",
    ]);
    expect(calls()[1].prompt).toContain("Analyst, Acme");
    expect(calls()[1].prompt).not.toContain("Builds dashboards");
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
      .mockResolvedValueOnce(extraction('{"location":"New York, NY"}'));
    const result = await researchWith("provider-search", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
      depth: "deep",
    });
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
      { technique: "provider-search" },
      "deep",
    );
    expect(deep.jobs[0].depth).toBe("deep");
    jobQueue.__resetForTests();
    const standard = jobQueue.createBatch(
      scope(),
      [{ id, name: "Test Person" }],
      { technique: "provider-search" },
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
    // The long prompt, beside the plain one.
    expect(calls()[1].prompt).toContain("Run four to six searches.");
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
