// =============================================================================
// Integration: the research layer that runs every research request
// =============================================================================
// The one-contact route and the batch queue both call research(), with the
// technique and the web search the request chose. A start checks the choice
// before anything is spent, every technique's result has every field, and an
// AI switch turned off mid-run stops the next model call or web search.
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
import { resolveCapability } from "../../server/ai/capabilities.ts";
import { safeFetch } from "../../server/utils/urlSafety.ts";
import { setAiOffForInstance } from "../../server/ai/instanceSwitch.ts";
import { setPreferences } from "../../server/services/userPreferencesService.ts";
import { sqlite } from "../../server/db.ts";
import { makeTestApp } from "./helpers.ts";
import { enrichmentContact } from "../../server/services/aiSearch/contactSnapshot.ts";
import { jobQueue } from "../../server/services/aiSearch/jobQueue.ts";
import { NO_MATCHING_PAGES } from "../../server/services/aiSearch/promptTemplate.ts";
import {
  research,
  setTechnique,
  setWebSearch,
  type Technique,
  type WebSearch,
} from "../../server/services/research/index.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { localOwnerId } from "./tenancy/helpers.ts";
import type { AIGenerateResult } from "../../server/ai/types.ts";

const app = makeTestApp();
const scope = () => scopeForOwnerId(localOwnerId());
const hosted = vi.mocked(resolveCapability).getMockImplementation()!;
/** Every capability resolves but `missing`. */
const without = (missing: string) =>
  vi
    .mocked(resolveCapability)
    .mockImplementation((capability) =>
      capability === missing ? null : hosted(capability),
    );

/** A model answer: a cited fact line for research, fact lines for reading, JSON for extraction. */
const answer = (
  text: string,
  extra: Partial<AIGenerateResult> = {},
): AIGenerateResult => ({
  text,
  model: "mock-model",
  latencyMs: 1,
  tokenCount: 10,
  usage: { inputTokens: 100, outputTokens: 50 },
  ...extra,
});
const LINE = "- Current role: Associate, Northwind Partners [pages.example]";
const FOUND: Record<string, AIGenerateResult> = {
  research: answer(LINE, {
    citations: [{ title: "Pages", uri: "https://pages.example/rowan" }],
    searchQueries: ['"Rowan Vale" Northwind Partners'],
  }),
  deep: answer(LINE),
  quick: answer('{"location":"Austin, TX, USA"}'),
};
const NONE: Record<string, AIGenerateResult> = {
  research: answer(NO_MATCHING_PAGES, { searchQueries: ['"Rowan Vale"'] }),
  deep: answer(NO_MATCHING_PAGES),
  quick: answer("{}"),
};

/** A web search that sends each page's text with its result, so no page is fetched. */
const web = {
  id: "test-web",
  label: "Test Web",
  configured: vi.fn(() => true),
  search: vi.fn(async () => [
    {
      url: "https://pages.example/rowan",
      title: "Rowan Vale | Northwind Partners",
      snippet: "Rowan Vale, Associate at Northwind Partners.",
      content: "Rowan Vale is an Associate at Northwind Partners in Austin.",
    },
  ]),
} satisfies WebSearch;

/** A technique that searches once, asks the deep model once, and reports one fact. */
const probe = {
  name: "probe",
  needs: () => [{ what: "web-search" as const }],
  run: vi.fn<Technique["run"]>(async (_request, ctx) => {
    await ctx.webSearch!.search("Rowan Vale", { limit: 5 });
    await ctx.generate("deep", { prompt: "read", responseFormat: "text" });
    return {
      kind: "facts",
      facts: LINE,
      findings: [{ topic: "Current role", text: "Associate" }],
      citations: [{ title: "Pages", uri: "https://pages.example/rowan" }],
      queries: ["Rowan Vale"],
      models: ["probe-model"],
    };
  }),
} satisfies Technique;

let id: string;
beforeEach(async () => {
  jobQueue.__resetForTests();
  sqlite.prepare("DELETE FROM contacts").run();
  vi.clearAllMocks();
  vi.mocked(generateFor).mockImplementation(
    async (capability) => FOUND[capability],
  );
  setTechnique(probe);
  setWebSearch(web);
  id = (
    await request(app).post("/api/contacts").send({
      name: "Rowan Vale",
      company: "Northwind Partners",
      role: "Associate",
    })
  ).body.id;
});
afterEach(() => {
  vi.mocked(resolveCapability).mockImplementation(hosted);
  setTechnique(null);
  setWebSearch(null);
  setAiOffForInstance(false);
  setPreferences(localOwnerId(), { aiAssist: true });
  jobQueue.__resetForTests();
});

describe("a research request", () => {
  it("runs the technique and the web search it names, from the one-contact route and from the queue", async () => {
    const choice = { technique: "probe", webSearch: "test-web" };
    const single = await request(app)
      .post(`/api/contacts/${id}/enrich`)
      .send(choice);
    expect(single.status).toBe(200);
    expect(single.body.models).toEqual(["probe-model", "mock-model"]);

    const started = await request(app)
      .post("/api/ai-search")
      .send({ contactIds: [id], ...choice });
    expect(started.status).toBe(200);
    const batch = jobQueue.getBatch(scope(), started.body.batchId)!;
    await vi.waitFor(() => expect(batch.status).toBe("complete"));
    expect(batch.jobs[0]).toMatchObject({
      ...choice,
      strategy: "probe",
      status: "success",
    });

    // Both ran through research(): the technique got the contact, and the
    // web search it called was the one the request named.
    expect(probe.run.mock.calls.map(([run]) => run.contact.id)).toEqual([
      id,
      id,
    ]);
    expect(web.search).toHaveBeenCalledTimes(2);
  });

  it("answers 400 for a name nothing has, and 503 for a choice that is not set up, before anything is spent", async () => {
    const enrich = (body: object) =>
      request(app).post(`/api/contacts/${id}/enrich`).send(body);
    const start = (body: object) =>
      request(app)
        .post("/api/ai-search")
        .send({ contactIds: [id], ...body });
    for (const refused of [
      await enrich({ technique: "nope" }),
      await enrich({ webSearch: "nope" }),
      await start({ technique: "nope" }),
      await start({ strategy: "searxng", technique: "search-and-read" }),
    ]) {
      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe("VALIDATION_ERROR");
    }

    web.configured.mockReturnValue(false);
    const noWebSearch = await enrich({
      technique: "probe",
      webSearch: "test-web",
    });
    expect(noWebSearch.status).toBe(503);
    expect(noWebSearch.body.error.code).toBe("TEST_WEB_NOT_CONFIGURED");
    web.configured.mockReturnValue(true);
    for (const [technique, missing, says] of [
      ["provider-search", "quick", "quick AI model"],
      ["search-and-read", "deep", "deep AI model"],
      ["combined", "research", "not configured for contact research"],
    ]) {
      without(missing);
      const refused = await enrich({ technique, webSearch: "test-web" });
      expect(refused.status, technique).toBe(503);
      expect(refused.body.error.message, technique).toContain(says);
    }

    expect(probe.run).not.toHaveBeenCalled();
    expect(generateFor).not.toHaveBeenCalled();
    expect(jobQueue.getActiveBatches(scope())).toEqual([]);
  });

  it("gives every field from every technique, found or not", async () => {
    // No technique named: the account's Search with choice, the research
    // model's own search.
    for (const answers of [FOUND, NONE])
      for (const technique of [
        "provider-search",
        "search-and-read",
        "combined",
        "probe",
        undefined,
      ]) {
        vi.mocked(generateFor).mockImplementation(
          async (capability) => answers[capability],
        );
        const result = await research({
          scope: scope(),
          contact: enrichmentContact(scope(), id),
          depth: "standard",
          history: null,
          technique,
          webSearch: "test-web",
        });
        expect(Object.keys(result).sort(), String(technique)).toEqual([
          "citations",
          "data",
          "depth",
          "findings",
          "latencyMs",
          "models",
          "outcome",
          "queries",
          "tokenCount",
          "usage",
        ]);
        expect(Object.values(result), String(technique)).not.toContain(
          undefined,
        );
        if (technique !== "probe")
          expect(result.outcome, String(technique)).toBe(
            answers === FOUND ? "found" : "no-public-info",
          );
      }
    // The web search sent each page's text, so no page was fetched.
    expect(safeFetch).not.toHaveBeenCalled();
  });
});

describe("the extraction", () => {
  it("reads with the deep model when no quick model is set", async () => {
    without("quick");
    // The reading's fact lines, then the extraction's JSON.
    vi.mocked(generateFor)
      .mockResolvedValueOnce(FOUND.deep)
      .mockResolvedValueOnce(FOUND.quick);
    await research({
      scope: scope(),
      contact: enrichmentContact(scope(), id),
      depth: "standard",
      history: null,
      technique: "probe",
      webSearch: "test-web",
    });
    expect(
      vi.mocked(generateFor).mock.calls.map(([capability]) => capability),
    ).toEqual(["deep", "deep"]);
  });
});

describe("an AI switch turned off mid-run", () => {
  it("refuses the next web search when the instance switch goes off, and ends the run", async () => {
    // Off after the first search. Both searches run at once, so the
    // research model's reply cites nothing: it would be asked again.
    web.search.mockImplementationOnce(async () => {
      setAiOffForInstance(true);
      return [];
    });
    vi.mocked(generateFor).mockResolvedValue(answer("From memory"));
    await expect(
      research({
        scope: scope(),
        contact: enrichmentContact(scope(), id),
        depth: "standard",
        history: null,
        technique: "combined",
        webSearch: "test-web",
      }),
    ).rejects.toMatchObject({ code: "AI_OFF_FOR_INSTANCE" });
    expect(web.search).toHaveBeenCalledTimes(1);
    expect(generateFor).toHaveBeenCalledTimes(1);
  });

  it("refuses the next model call when the account switch goes off, and changes nothing", async () => {
    vi.mocked(generateFor).mockImplementationOnce(async () => {
      setPreferences(localOwnerId(), { aiAssist: false });
      return answer("From memory");
    });
    const response = await request(app)
      .post(`/api/contacts/${id}/enrich`)
      .send({ technique: "provider-search" });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("AI_OFF_FOR_ACCOUNT");
    expect(generateFor).toHaveBeenCalledTimes(1);
    expect(enrichmentContact(scope(), id).aiResearch).toBeNull();
  });
});
