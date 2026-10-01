// =============================================================================
// Integration: research through SearXNG, alone and beside the research model
// =============================================================================
// SearXNG research runs the provider research's own searches, reads the
// result pages that name the person, and turns them into fact lines with
// their pages before the extraction reads them. The combined strategy runs
// it beside the research model's own search, keeps the facts of both, and
// stands on either one when the other finds nothing.
// =============================================================================

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
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
    model: "mock-model",
    modelClass: "flash",
    provider: {},
  })),
}));
vi.mock("../../server/utils/urlSafety.ts", async (original) => ({
  ...(await original<typeof import("../../server/utils/urlSafety.ts")>()),
  safeFetch: vi.fn(),
}));
import { generateFor } from "../../server/ai/gateway.ts";
import { safeFetch } from "../../server/utils/urlSafety.ts";
import { sqlite } from "../../server/db.ts";
import { makeTestApp } from "./helpers.ts";
import {
  deleteSetting,
  setSetting,
  SETTING_KEYS,
} from "../../server/services/settingsService.ts";
import { enrichmentContact } from "../../server/services/aiSearch/contactSnapshot.ts";
import { jobQueue } from "../../server/services/aiSearch/jobQueue.ts";
import { SearxngStrategy } from "../../server/services/aiSearch/strategies/searxng.ts";
import { CombinedStrategy } from "../../server/services/aiSearch/strategies/combined.ts";
import { NO_MATCHING_PAGES } from "../../server/services/aiSearch/promptTemplate.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { localOwnerId } from "./tenancy/helpers.ts";
import type {
  AIGenerateOptions,
  AIGenerateResult,
} from "../../server/ai/types.ts";

const app = makeTestApp();
const scope = () => scopeForOwnerId(localOwnerId());

/** A SearXNG result. */
const result = (url: string, title: string, content = "") => ({
  url,
  title,
  content,
});

/** What SearXNG answers for each query, and the queries it was sent. */
let answers: Record<string, ReturnType<typeof result>[]>;
let search: ReturnType<typeof vi.fn>;
const queries = () =>
  search.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("q"));

/** The pages a fetch can read. Any other address fails, as at a block. */
let pages: Record<string, string>;

/** A model answer. */
const reply = (
  text: string,
  model: string,
  extra: Partial<AIGenerateResult> = {},
): AIGenerateResult => ({
  text,
  model,
  latencyMs: 1,
  tokenCount: 10,
  usage: { inputTokens: 100, outputTokens: 50 },
  ...extra,
});

/** Each capability's answer, so asks that run at once can come in any order. */
let byCapability: Record<string, AIGenerateResult | Error>;
const calls = () =>
  vi.mocked(generateFor).mock.calls.map(([capability, options]) => ({
    capability,
    ...(options as AIGenerateOptions),
  }));

let id: string;
beforeEach(async () => {
  jobQueue.__resetForTests();
  sqlite.prepare("DELETE FROM contacts").run();
  setSetting(SETTING_KEYS.aiSearxng, { url: "http://searxng.test" });
  answers = {};
  pages = {};
  byCapability = {};
  search = vi.fn(async (url: string | URL) => {
    const q = new URL(String(url)).searchParams.get("q") ?? "";
    return new Response(JSON.stringify({ results: answers[q] ?? [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", search);
  vi.mocked(safeFetch).mockReset();
  vi.mocked(safeFetch).mockImplementation(async (url: string) => {
    if (!(url in pages)) throw new Error("blocked");
    return {
      response: new Response(pages[url], {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
      finalUrl: url,
    };
  });
  vi.mocked(generateFor).mockReset();
  vi.mocked(generateFor).mockImplementation(async (capability) => {
    const answer = byCapability[capability];
    if (!answer) throw new Error(`no answer for ${capability}`);
    if (answer instanceof Error) throw answer;
    return answer;
  });
  id = (
    await request(app).post("/api/contacts").send({
      name: "Greg Whitlock, CPA",
      company: "Northwind Partners",
      role: "Associate",
    })
  ).body.id;
});
afterEach(() => {
  vi.unstubAllGlobals();
  jobQueue.__resetForTests();
});

/** SearXNG results for the first search: the firm's page, a profile, and a namesake. */
function firmResults() {
  answers['"Greg Whitlock" Northwind Partners'] = [
    result(
      "https://northwind.example/people/greg-whitlock",
      "Greg Whitlock | Northwind Partners",
    ),
    result(
      "https://profiles.example/in/greg-whitlock",
      "Greg Whitlock - Associate - Northwind Partners",
      "Greg Whitlock. Associate at Northwind Partners. Studied at the University of Example.",
    ),
    result(
      "https://other.example/greg-smith",
      "Greg Smith | Harbor Point",
      "Greg Smith joined Harbor Point.",
    ),
  ];
  pages["https://northwind.example/people/greg-whitlock"] =
    "<html><body><h1>Greg Whitlock</h1><p>Associate. Joined Northwind Partners in 2021. BA Economics, University of Example.</p></body></html>";
}

const READ_LINES = [
  "- Current role: Associate, Northwind Partners [northwind.example]",
  "- Education: BA Economics, University of Example [northwind.example]",
  "- Profile: https://profiles.example/in/greg-whitlock [profiles.example]",
].join("\n");

describe("SearXNG research", () => {
  it("runs the provider research's searches, reads the pages that name the person, and keeps each fact's page", async () => {
    firmResults();
    byCapability.deep = reply(READ_LINES, "mock-reader");
    byCapability.quick = reply(
      JSON.stringify({
        website: "javascript:alert(1)",
        location: "Austin, TX, USA",
        experience: [{ company: "Kestrel", role: "Analyst", isCurrent: true }],
      }),
      "mock-extractor",
    );
    const research = await new SearxngStrategy().execute(
      enrichmentContact(scope(), id),
      "research prompt",
    );

    // Three searches at Standard, the clean name first, the formal one next.
    expect(queries()).toEqual([
      '"Greg Whitlock" Northwind Partners',
      '"Gregory Whitlock" Northwind Partners',
      '"Greg Whitlock" Associate',
    ]);
    // The page that names the person is read in full; the namesake is not
    // read at all; the profile that cannot be fetched keeps its snippet.
    const fetched = vi.mocked(safeFetch).mock.calls.map(([url]) => url);
    expect(fetched).toEqual([
      "https://northwind.example/people/greg-whitlock",
      "https://profiles.example/in/greg-whitlock",
    ]);
    const reading = calls().find((call) => call.capability === "deep")!;
    expect(reading.prompt).toContain("Joined Northwind Partners in 2021");
    expect(reading.prompt).toContain("Studied at the University of Example");
    expect(reading.prompt).not.toContain("Greg Smith");
    expect(reading.enableSearchGrounding).toBeUndefined();
    // The extraction reads the fact lines, field by field, with the job rules.
    const extraction = calls().find((call) => call.capability === "quick")!;
    expect(extraction.prompt).toContain("Associate, Northwind Partners");
    expect(research.data).toMatchObject({ location: "Austin, TX, USA" });
    expect(research.data).not.toHaveProperty("website");
    expect(research.data.experience).toEqual([
      { company: "Kestrel", role: "Analyst", isCurrent: false },
    ]);
    // Each fact links its page, and the pages a fact names are the sources.
    expect(research.findings?.map((finding) => finding.url)).toEqual([
      "https://northwind.example/people/greg-whitlock",
      "https://northwind.example/people/greg-whitlock",
      "https://profiles.example/in/greg-whitlock",
    ]);
    expect(research.citations?.map((citation) => citation.uri)).toEqual([
      "https://northwind.example/people/greg-whitlock",
      "https://profiles.example/in/greg-whitlock",
    ]);
    expect(research).toMatchObject({
      outcome: "found",
      models: ["searxng", "mock-reader", "mock-extractor"],
      // SearXNG's searches are not billed: two calls, no search.
      usage: { calls: 2, searches: 0 },
    });
  });

  it("runs six searches at Deep, and takes results from each in turn", async () => {
    const contact = await request(app)
      .post("/api/contacts")
      .send({
        name: "Rowan Vale",
        company: "Northwind Partners",
        role: "Associate",
        location: "Austin, TX",
        education: [{ school: "University of Example" }],
        experience: [
          { company: "Harbor Point Partners", role: "Analyst" },
          { company: "Kestrel", role: "Intern" },
        ],
      });
    answers['"Rowan Vale" Northwind Partners'] = Array.from(
      { length: 12 },
      (_, index) =>
        result(
          `https://a.example/${index}`,
          `Rowan Vale ${index}`,
          "Rowan Vale",
        ),
    );
    answers['"Rowan Vale" Associate'] = [
      result("https://b.example/0", "Rowan Vale at Northwind", "Rowan Vale"),
    ];
    byCapability.deep = reply(NO_MATCHING_PAGES, "mock-reader");
    await new SearxngStrategy().execute(
      enrichmentContact(scope(), contact.body.id),
      "research prompt",
      undefined,
      { depth: "deep" },
    );
    expect(queries()).toHaveLength(6);
    // Ten pages at Deep, and the second search's result among the first two.
    const fetched = vi.mocked(safeFetch).mock.calls.map(([url]) => url);
    expect(fetched).toHaveLength(10);
    expect(fetched.slice(0, 2)).toEqual([
      "https://a.example/0",
      "https://b.example/0",
    ]);
  });

  it("records no public information when SearXNG found pages and none is about the person", async () => {
    firmResults();
    byCapability.deep = reply(NO_MATCHING_PAGES, "mock-reader");
    const research = await new SearxngStrategy().execute(
      enrichmentContact(scope(), id),
      "research prompt",
    );
    expect(research).toMatchObject({
      outcome: "no-public-info",
      data: {},
      models: ["searxng", "mock-reader"],
    });
    expect(research.searchQueries).toHaveLength(3);
    expect(calls().map((call) => call.capability)).toEqual(["deep"]);
  });

  it("reads the first snippets when no result names the person", async () => {
    answers['"Greg Whitlock" Northwind Partners'] = [
      result("https://other.example/1", "Northwind Partners team", "Our team."),
    ];
    byCapability.deep = reply(NO_MATCHING_PAGES, "mock-reader");
    await new SearxngStrategy().execute(
      enrichmentContact(scope(), id),
      "research prompt",
    );
    expect(safeFetch).not.toHaveBeenCalled();
    const reading = calls().find((call) => call.capability === "deep")!;
    expect(reading.prompt).toContain("SOURCE: https://other.example/1");
  });

  it("fails without a model call when SearXNG returns nothing", async () => {
    await expect(
      new SearxngStrategy().execute(
        enrichmentContact(scope(), id),
        "research prompt",
      ),
    ).rejects.toMatchObject({ code: "SEARXNG_NO_RESULTS" });
    expect(generateFor).not.toHaveBeenCalled();
  });

  it("fails when the reading reports no facts and no no-match", async () => {
    firmResults();
    byCapability.deep = reply("I could not tell.", "mock-reader");
    await expect(
      new SearxngStrategy().execute(
        enrichmentContact(scope(), id),
        "research prompt",
      ),
    ).rejects.toMatchObject({ code: "SEARXNG_NO_FACTS" });
  });
});

describe("research with both searches", () => {
  /** The research model's answer: one fact, from a page its search cited. */
  const provider = (text: string, extra: Partial<AIGenerateResult> = {}) =>
    reply(text, "mock-flash", {
      citations: [{ title: "Example News", uri: "https://news.example/greg" }],
      searchQueries: ['"Greg Whitlock" Northwind Partners'],
      ...extra,
    });

  it("keeps the facts and pages of both, and extracts them in one call", async () => {
    firmResults();
    byCapability.research = provider(
      "- Award: Fellow, Example Society [news.example]",
    );
    byCapability.deep = reply(READ_LINES, "mock-reader");
    byCapability.quick = reply("{}", "mock-extractor");
    const research = await new CombinedStrategy().execute(
      enrichmentContact(scope(), id),
      "research prompt",
    );
    const extractions = calls().filter((call) => call.capability === "quick");
    expect(extractions).toHaveLength(1);
    expect(extractions[0].prompt).toContain("Fellow, Example Society");
    expect(extractions[0].prompt).toContain(
      "BA Economics, University of Example",
    );
    expect(research.findings?.map((finding) => finding.topic)).toEqual([
      "Award",
      "Current role",
      "Education",
      "Profile",
    ]);
    expect(research.citations?.map((citation) => citation.uri)).toEqual([
      "https://news.example/greg",
      "https://northwind.example/people/greg-whitlock",
      "https://profiles.example/in/greg-whitlock",
    ]);
    expect(research).toMatchObject({
      outcome: "found",
      models: ["mock-flash", "searxng", "mock-reader", "mock-extractor"],
      // The research model's one search is billed. SearXNG's are not.
      usage: { calls: 3, searches: 1 },
    });
  });

  it("stands on SearXNG when the research model does not search", async () => {
    firmResults();
    byCapability.research = reply(NO_MATCHING_PAGES, "mock-flash");
    byCapability.deep = reply(READ_LINES, "mock-reader");
    byCapability.quick = reply(
      '{"location":"Austin, TX, USA"}',
      "mock-extractor",
    );
    const research = await new CombinedStrategy().execute(
      enrichmentContact(scope(), id),
      "research prompt",
    );
    expect(research.outcome).toBe("found");
    expect(research.models).toEqual([
      "searxng",
      "mock-reader",
      "mock-extractor",
    ]);
    // The model was asked three times, in its three forms.
    expect(
      calls().filter((call) => call.capability === "research"),
    ).toHaveLength(3);
  });

  it("stands on the research model when SearXNG finds nothing", async () => {
    byCapability.research = provider(
      "- Award: Fellow, Example Society [news.example]",
    );
    byCapability.quick = reply("{}", "mock-extractor");
    const research = await new CombinedStrategy().execute(
      enrichmentContact(scope(), id),
      "research prompt",
    );
    expect(research).toMatchObject({
      outcome: "found",
      models: ["mock-flash", "mock-extractor"],
    });
    expect(research.findings).toHaveLength(1);
  });

  it("records no public information when a search ran and nothing matched", async () => {
    firmResults();
    byCapability.research = reply(NO_MATCHING_PAGES, "mock-flash", {
      searchQueries: ['"Greg Whitlock" Northwind Partners'],
    });
    byCapability.deep = reply(NO_MATCHING_PAGES, "mock-reader");
    const research = await new CombinedStrategy().execute(
      enrichmentContact(scope(), id),
      "research prompt",
    );
    expect(research).toMatchObject({
      outcome: "no-public-info",
      models: ["mock-flash", "searxng", "mock-reader"],
    });
    expect(calls().some((call) => call.capability === "quick")).toBe(false);
  });

  it("fails with both reasons when neither search has facts or a no-match", async () => {
    byCapability.research = new Error("Network 500");
    await expect(
      new CombinedStrategy().execute(
        enrichmentContact(scope(), id),
        "research prompt",
      ),
    ).rejects.toMatchObject({
      code: "RESEARCH_NO_EVIDENCE",
      message: expect.stringMatching(
        /Research model: Network 500 SearXNG: SearXNG returned no usable results/,
      ),
    });
  });
});

describe("choosing how to search, through the API", () => {
  it("refuses both searches without a SearXNG address, before anything is spent", async () => {
    deleteSetting(SETTING_KEYS.aiSearxng);
    const response = await request(app)
      .post("/api/ai-search")
      .send({ contactIds: [id], strategy: "combined" });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("SEARXNG_NOT_CONFIGURED");
    expect(generateFor).not.toHaveBeenCalled();
  });

  it("gives each job its own strategy, also when it joins a running batch", () => {
    const running = jobQueue.createBatch(
      scope(),
      [{ id, name: "Greg Whitlock" }],
      "two-pass",
    );
    const joined = jobQueue.appendToBatch(
      scope(),
      running.id,
      [{ id: "00000000-0000-0000-0000-000000000001", name: "Second" }],
      "standard",
      "combined",
    );
    expect(joined?.batch.jobs.map((job) => job.strategy)).toEqual([
      "two-pass",
      "combined",
    ]);
  });

  it("runs a batch's jobs with each one's strategy", async () => {
    firmResults();
    byCapability.deep = reply(READ_LINES, "mock-reader");
    byCapability.quick = reply("{}", "mock-extractor");
    const batch = jobQueue.createBatch(
      scope(),
      [{ id, name: "Greg Whitlock" }],
      "searxng",
    );
    await jobQueue.processBatch(batch.id);
    expect(batch.jobs[0]).toMatchObject({
      status: "success",
      strategy: "searxng",
      models: ["searxng", "mock-reader", "mock-extractor"],
    });
    // The research model's search never ran.
    expect(calls().some((call) => call.capability === "research")).toBe(false);
  });
});

describe("the AI settings say whether SearXNG is set", () => {
  it("answers true for a saved address and false for none", async () => {
    expect((await request(app).get("/api/settings/ai")).body.searxng).toBe(
      true,
    );
    deleteSetting(SETTING_KEYS.aiSearxng);
    expect((await request(app).get("/api/settings/ai")).body.searxng).toBe(
      false,
    );
  });
});
