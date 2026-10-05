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
import { resolveCapability } from "../../server/ai/capabilities.ts";
import { safeFetch } from "../../server/utils/urlSafety.ts";
import { sqlite } from "../../server/db.ts";
import { makeTestApp, researchWith } from "./helpers.ts";
import {
  deleteSetting,
  setSetting,
  SETTING_KEYS,
} from "../../server/services/settingsService.ts";
import { enrichmentContact } from "../../server/services/aiSearch/contactSnapshot.ts";
import { jobQueue } from "../../server/services/aiSearch/jobQueue.ts";
import { EXTRACTION_RESERVE_MS } from "../../server/services/research/techniques/combined.ts";
import {
  STRATEGY_CHOICE,
  strategyOf,
} from "../../server/services/research/index.ts";
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
/**
 * An extraction with one fact the records lack. A run whose extraction only
 * restates the records records no public information (`hasNewFacts`).
 */
const EXTRACTED = JSON.stringify({ location: "Austin, TX" });

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

/** Every capability answers as `byCapability` says, and `research` only when stopped. */
function researchHangs() {
  vi.mocked(generateFor).mockImplementation(async (capability, options) => {
    if (capability === "research")
      return new Promise<never>((_, reject) =>
        options.signal?.addEventListener(
          "abort",
          () => reject(options.signal?.reason),
          { once: true },
        ),
      );
    const answer = byCapability[capability];
    if (!answer || answer instanceof Error)
      throw answer ?? new Error(`no answer for ${capability}`);
    return answer;
  });
}

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
    const research = await researchWith("search-and-read", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
    });

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
    await researchWith("search-and-read", {
      scope: scope(),
      contact: enrichmentContact(scope(), contact.body.id),
      depth: "deep",
    });
    expect(queries()).toHaveLength(6);
    // Ten pages at Deep, and the second search's result among the first two.
    // None can be read, so the three after them are tried too.
    const fetched = vi.mocked(safeFetch).mock.calls.map(([url]) => url);
    expect(fetched).toHaveLength(13);
    expect(fetched.slice(0, 2)).toEqual([
      "https://a.example/0",
      "https://b.example/0",
    ]);
  });

  it("records no public information when SearXNG found pages and none is about the person", async () => {
    firmResults();
    byCapability.deep = reply(NO_MATCHING_PAGES, "mock-reader");
    const research = await researchWith("search-and-read", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
    });
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
    await researchWith("search-and-read", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
    });
    expect(safeFetch).not.toHaveBeenCalled();
    const reading = calls().find((call) => call.capability === "deep")!;
    expect(reading.prompt).toContain("SOURCE: https://other.example/1");
  });

  it("searches no further once an admin clears the SearXNG address", async () => {
    deleteSetting(SETTING_KEYS.aiSearxng);
    await expect(
      researchWith("search-and-read", {
        scope: scope(),
        contact: enrichmentContact(scope(), id),
      }),
    ).rejects.toMatchObject({ code: "SEARXNG_NOT_CONFIGURED" });
    expect(search).not.toHaveBeenCalled();
  });

  it("fails without a model call when SearXNG returns nothing", async () => {
    await expect(
      researchWith("search-and-read", {
        scope: scope(),
        contact: enrichmentContact(scope(), id),
      }),
    ).rejects.toMatchObject({ code: "SEARXNG_NO_RESULTS" });
    expect(generateFor).not.toHaveBeenCalled();
  });

  it("says SearXNG's own error when every search fails, without a model call", async () => {
    // A SearXNG whose settings.yml leaves json out of search.formats.
    search.mockImplementation(
      async () =>
        new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
    );
    await expect(
      researchWith("search-and-read", {
        scope: scope(),
        contact: enrichmentContact(scope(), id),
      }),
    ).rejects.toMatchObject({
      code: "SEARXNG_ERROR",
      message: "SearXNG returned 403 Forbidden",
    });
    // A SearXNG that is not running.
    search.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      researchWith("search-and-read", {
        scope: scope(),
        contact: enrichmentContact(scope(), id),
      }),
    ).rejects.toMatchObject({
      code: "SEARXNG_ERROR",
      message: "SearXNG did not answer: fetch failed",
    });
    expect(generateFor).not.toHaveBeenCalled();
  });

  it("puts the pages read in full before the snippets, so the reading's cap cuts a snippet first", async () => {
    answers['"Greg Whitlock" Northwind Partners'] = Array.from(
      { length: 6 },
      (_, index) =>
        result(
          `https://a.example/${index}`,
          `Greg Whitlock ${index}`,
          `Snippet ${index} about Greg Whitlock. Northwind Partners.`,
        ),
    );
    pages["https://a.example/0"] =
      "<html><body><p>The page of Greg Whitlock. Northwind Partners.</p></body></html>";
    byCapability.deep = reply(NO_MATCHING_PAGES, "mock-reader");
    await researchWith("search-and-read", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
    });
    const reading = calls().find((call) => call.capability === "deep")!.prompt;
    // Five pages at Standard, then the sixth result by its snippet.
    expect(reading.indexOf("The page of Greg Whitlock")).toBeLessThan(
      reading.indexOf("SOURCE: https://a.example/5"),
    );
    expect(reading.indexOf("SOURCE: https://a.example/4")).toBeLessThan(
      reading.indexOf("SOURCE: https://a.example/5"),
    );
  });

  it("links each fact to the page whose address the reading names, on a site with two pages", async () => {
    answers['"Greg Whitlock" Northwind Partners'] = [
      result(
        "https://profiles.example/in/greg-whitlock",
        "Greg Whitlock - Associate",
        "Greg Whitlock. Associate at Northwind Partners.",
      ),
      result(
        "https://profiles.example/posts/greg-whitlock-award",
        "Greg Whitlock wins the Example Award",
        "Greg Whitlock of Northwind Partners won the Example Award.",
      ),
    ];
    byCapability.deep = reply(
      [
        "- Current role: Associate, Northwind Partners [https://profiles.example/in/greg-whitlock]",
        "- Award: Example Award [https://www.profiles.example/posts/greg-whitlock-award/]",
        "- Location: Austin, TX [profiles.example]",
      ].join("\n"),
      "mock-reader",
    );
    byCapability.quick = reply(EXTRACTED, "mock-extractor");
    const research = await researchWith("search-and-read", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
    });
    const reading = calls().find((call) => call.capability === "deep")!;
    expect(reading.prompt).toContain("full SOURCE address of its page");
    // The award is on the second page of the site, and the card names the
    // site, not the address.
    expect(
      research.findings?.map((finding) => [finding.site, finding.url]),
    ).toEqual([
      ["profiles.example", "https://profiles.example/in/greg-whitlock"],
      [
        "profiles.example",
        "https://profiles.example/posts/greg-whitlock-award",
      ],
      // A site alone: the first page read on it.
      ["profiles.example", "https://profiles.example/in/greg-whitlock"],
    ]);
  });

  it("reads the next page that names the person when one cannot be read", async () => {
    answers['"Greg Whitlock" Northwind Partners'] = Array.from(
      { length: 8 },
      (_, index) =>
        result(
          `https://site${index}.example/greg`,
          `Greg Whitlock ${index}`,
          `Snippet ${index} about Greg Whitlock. Northwind Partners.`,
        ),
    );
    // The first four turn robots away, as LinkedIn does with its 999.
    for (let index = 4; index < 8; index++)
      pages[`https://site${index}.example/greg`] =
        `<html><body><p>Page ${index} of Greg Whitlock. Northwind Partners.</p></body></html>`;
    byCapability.deep = reply(NO_MATCHING_PAGES, "mock-reader");
    await researchWith("search-and-read", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
    });
    const reading = calls().find((call) => call.capability === "deep")!.prompt;
    for (let index = 4; index < 8; index++)
      expect(reading).toContain(`Page ${index} of Greg Whitlock.`);
    // The pages that could not be read keep their snippets.
    expect(reading).toContain("Snippet 0 about Greg Whitlock.");
    // Five, then the four still wanted.
    expect(safeFetch).toHaveBeenCalledTimes(8);
  });

  it("reads in parts that fit a local model's window, and keeps the facts of every part that answers", async () => {
    // A custom endpoint whose model reports no window: 4,096 tokens.
    const hosted = vi.mocked(resolveCapability).getMockImplementation()!;
    vi.mocked(resolveCapability).mockImplementation((capability) => ({
      capability,
      providerId: "custom:local",
      model: "small-model",
      modelClass: "flash",
      source: "pinned",
      provider: {} as never,
    }));
    try {
      answers['"Greg Whitlock" Northwind Partners'] = Array.from(
        { length: 5 },
        (_, index) =>
          result(
            `https://site${index}.example/greg`,
            `Greg Whitlock ${index}`,
            "Greg Whitlock",
          ),
      );
      for (let index = 0; index < 5; index++)
        pages[`https://site${index}.example/greg`] =
          `<html><body><p>Greg Whitlock of Northwind Partners. ${`Greg Whitlock worked at Firm ${index}. `.repeat(200)}</p></body></html>`;
      let part = 0;
      vi.mocked(generateFor).mockImplementation(async (capability) => {
        if (capability !== "deep") return reply(EXTRACTED, "small-model");
        part += 1;
        if (part === 2) throw new Error("The local model timed out");
        return reply(
          `- Past role: Firm, part ${part} [https://site0.example/greg]`,
          "small-model",
        );
      });
      const research = await researchWith("search-and-read", {
        scope: scope(),
        contact: enrichmentContact(scope(), id),
      });
      const readings = calls().filter((call) => call.capability === "deep");
      // Five pages of 6,000 characters: three parts, one page each.
      expect(readings).toHaveLength(3);
      for (const reading of readings) {
        expect(reading.maxOutputTokens).toBe(1_024);
        // The prompt and the answer fit 4,096 tokens, at 3 characters a token.
        expect(reading.prompt.length).toBeLessThanOrEqual((4_096 - 1_024) * 3);
      }
      // The part that failed costs its own facts only.
      expect(research.findings?.map((finding) => finding.text)).toEqual([
        "Firm, part 1",
        "Firm, part 3",
      ]);
      // The extraction leaves its prompt room in the window too.
      const extraction = calls().find((call) => call.capability === "quick")!;
      expect(extraction.maxOutputTokens).toBeLessThanOrEqual(
        4_096 - Math.ceil(extraction.prompt.length / 3),
      );
    } finally {
      vi.mocked(resolveCapability).mockImplementation(hosted);
    }
  });

  it("shortens the pages read in full on a small window, so the snippets are read too", async () => {
    const hosted = vi.mocked(resolveCapability).getMockImplementation()!;
    vi.mocked(resolveCapability).mockImplementation((capability) => ({
      capability,
      providerId: "custom:local",
      model: "small-model",
      modelClass: "flash",
      source: "pinned",
      provider: {} as never,
    }));
    try {
      // Three profiles that turn robots away, and three long pages that load.
      answers['"Greg Whitlock" Northwind Partners'] = [
        ...Array.from({ length: 3 }, (_, index) =>
          result(
            `https://profiles.example/in/greg-whitlock-${index}`,
            `Greg Whitlock ${index}`,
            `Profile snippet ${index}: Greg Whitlock, Associate at Northwind Partners.`,
          ),
        ),
        ...Array.from({ length: 3 }, (_, index) =>
          result(
            `https://site${index}.example/greg`,
            `Greg Whitlock page ${index}`,
            "Greg Whitlock",
          ),
        ),
      ];
      for (let index = 0; index < 3; index++)
        pages[`https://site${index}.example/greg`] =
          `<html><body><p>${`Greg Whitlock at Northwind Partners, page ${index}. `.repeat(200)}</p></body></html>`;
      byCapability.deep = reply(NO_MATCHING_PAGES, "small-model");
      await researchWith("search-and-read", {
        scope: scope(),
        contact: enrichmentContact(scope(), id),
      });
      const read = calls()
        .filter((call) => call.capability === "deep")
        .map((call) => call.prompt)
        .join("\n");
      for (let index = 0; index < 3; index++) {
        expect(read).toContain(`Profile snippet ${index}`);
        expect(read).toContain(
          `Greg Whitlock at Northwind Partners, page ${index}.`,
        );
      }
    } finally {
      vi.mocked(resolveCapability).mockImplementation(hosted);
    }
  });

  it("leaves out another person's LinkedIn profile when the records hold the contact's own", async () => {
    const withProfile = (
      await request(app)
        .post("/api/contacts")
        .send({
          name: "Rowan Vale",
          company: "Northwind Partners",
          socialLinks: [
            {
              platform: "linkedin",
              url: "https://www.linkedin.com/in/rowan-vale-1a2b",
            },
          ],
        })
    ).body.id;
    answers['"Rowan Vale" Northwind Partners'] = [
      result(
        "https://www.linkedin.com/in/rowan-vale-1a2b",
        "Rowan Vale - Northwind Partners",
        "Own profile: Rowan Vale, Associate at Northwind Partners.",
      ),
      result(
        "https://uk.linkedin.com/in/rowan-vale-9z9z",
        "Rowan Vale - Kestrel Logistics",
        "Other profile: Rowan Vale, Director at Kestrel Logistics.",
      ),
      result(
        "https://news.example/rowan-vale",
        "Rowan Vale joins Northwind",
        "News: Rowan Vale joins Northwind Partners.",
      ),
    ];
    byCapability.deep = reply(NO_MATCHING_PAGES, "mock-reader");
    await researchWith("search-and-read", {
      scope: scope(),
      contact: enrichmentContact(scope(), withProfile),
    });
    const reading = calls().find((call) => call.capability === "deep")!.prompt;
    expect(reading).toContain("Own profile: Rowan Vale");
    expect(reading).toContain("News: Rowan Vale joins");
    expect(reading).not.toContain("Other profile");
    expect(safeFetch).not.toHaveBeenCalledWith(
      "https://uk.linkedin.com/in/rowan-vale-9z9z",
      expect.anything(),
    );
  });

  it("reads only the pages and snippets that share a detail with the records", async () => {
    answers['"Greg Whitlock" Northwind Partners'] = [
      result(
        "https://kestrel.example/greg-whitlock",
        "Greg Whitlock | Kestrel Freight",
        "Greg Whitlock joined Kestrel Freight in Denver.",
      ),
      result(
        "https://homes.example/sale",
        "Home sold to Greg Whitlock",
        "Greg Whitlock bought a house on Elm Street.",
      ),
      result(
        "https://northwind.example/team",
        "Our team",
        "Greg Whitlock, Associate at Northwind Partners.",
      ),
    ];
    pages["https://kestrel.example/greg-whitlock"] =
      "<html><body><p>Greg Whitlock, partner at Kestrel Freight, Denver.</p></body></html>";
    byCapability.deep = reply(NO_MATCHING_PAGES, "mock-reader");
    await researchWith("search-and-read", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
    });
    const reading = calls().find((call) => call.capability === "deep")!.prompt;
    expect(reading).toContain("Associate at Northwind Partners");
    expect(reading).not.toContain("Kestrel Freight");
    expect(reading).not.toContain("Elm Street");
  });

  it("records no public information, with no model call, when no result shares a detail", async () => {
    answers['"Greg Whitlock" Northwind Partners'] = [
      result(
        "https://homes.example/sale",
        "Home sold to Greg Whitlock",
        "Greg Whitlock bought a house on Elm Street.",
      ),
    ];
    const research = await researchWith("search-and-read", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
    });
    expect(research).toMatchObject({
      outcome: "no-public-info",
      models: ["searxng"],
    });
    expect(generateFor).not.toHaveBeenCalled();
  });

  it("reads every result that names a person whose records hold the name alone", async () => {
    const nameOnly = (
      await request(app).post("/api/contacts").send({ name: "Rowan Vale" })
    ).body.id;
    answers['"Rowan Vale"'] = [
      result(
        "https://homes.example/sale",
        "Home sold to Rowan Vale",
        "Rowan Vale bought a house on Elm Street.",
      ),
    ];
    byCapability.deep = reply(NO_MATCHING_PAGES, "mock-reader");
    await researchWith("search-and-read", {
      scope: scope(),
      contact: enrichmentContact(scope(), nameOnly),
    });
    const reading = calls().find((call) => call.capability === "deep")!.prompt;
    expect(reading).toContain("Elm Street");
  });

  it("fails when the reading reports no facts and no no-match", async () => {
    firmResults();
    byCapability.deep = reply("I could not tell.", "mock-reader");
    await expect(
      researchWith("search-and-read", {
        scope: scope(),
        contact: enrichmentContact(scope(), id),
      }),
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
    byCapability.quick = reply(EXTRACTED, "mock-extractor");
    const research = await researchWith("combined", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
    });
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
    const research = await researchWith("combined", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
    });
    expect(research.outcome).toBe("found");
    expect(research.models).toEqual([
      "searxng",
      "mock-reader",
      "mock-extractor",
    ]);
    // The model was asked twice: the plain ask, and once more when it ran
    // no search.
    expect(
      calls().filter((call) => call.capability === "research"),
    ).toHaveLength(2);
  });

  it("stands on the research model when SearXNG finds nothing", async () => {
    byCapability.research = provider(
      "- Award: Fellow, Example Society [news.example]",
    );
    byCapability.quick = reply(EXTRACTED, "mock-extractor");
    const research = await researchWith("combined", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
    });
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
    const research = await researchWith("combined", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
    });
    expect(research).toMatchObject({
      outcome: "no-public-info",
      models: ["mock-flash", "searxng", "mock-reader"],
    });
    expect(calls().some((call) => call.capability === "quick")).toBe(false);
  });

  it("stops the research model's search at its own deadline, and stands on SearXNG", async () => {
    firmResults();
    byCapability.deep = reply(READ_LINES, "mock-reader");
    byCapability.quick = reply(EXTRACTED, "mock-extractor");
    researchHangs();
    const research = await researchWith("combined", {
      // Half a second for each search, after the extraction's time.
      scope: scope(),
      contact: enrichmentContact(scope(), id),
      timeoutMs: EXTRACTION_RESERVE_MS + 500,
    });
    expect(research).toMatchObject({
      outcome: "found",
      models: ["searxng", "mock-reader", "mock-extractor"],
    });
    expect(research.findings).toHaveLength(3);
  });

  it("says which search ran out of time when neither found facts", async () => {
    researchHangs();
    await expect(
      researchWith("combined", {
        scope: scope(),
        contact: enrichmentContact(scope(), id),
        timeoutMs: EXTRACTION_RESERVE_MS + 200,
      }),
    ).rejects.toMatchObject({
      code: "RESEARCH_NO_EVIDENCE",
      message: expect.stringMatching(
        /Web search model: The web search model's search took more than 0 s\./,
      ),
    });
  });

  it("still stops at once when the run is cancelled", async () => {
    firmResults();
    byCapability.deep = reply(READ_LINES, "mock-reader");
    researchHangs();
    const controller = new AbortController();
    const run = researchWith("combined", {
      scope: scope(),
      contact: enrichmentContact(scope(), id),
      signal: controller.signal,
      timeoutMs: 120_000,
    });
    setTimeout(() => controller.abort(new Error("Cancelled")), 20);
    await expect(run).rejects.toThrow("Cancelled");
  });

  it("fails with both reasons when neither search has facts or a no-match", async () => {
    byCapability.research = new Error("Network 500");
    await expect(
      researchWith("combined", {
        scope: scope(),
        contact: enrichmentContact(scope(), id),
      }),
    ).rejects.toMatchObject({
      code: "RESEARCH_NO_EVIDENCE",
      message: expect.stringMatching(
        /Web search model: Network 500 SearXNG: SearXNG returned no usable results/,
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
      STRATEGY_CHOICE["two-pass"],
    );
    const joined = jobQueue.appendToBatch(
      scope(),
      running.id,
      [{ id: "00000000-0000-0000-0000-000000000001", name: "Second" }],
      "standard",
      STRATEGY_CHOICE.combined,
    );
    expect(joined?.batch.jobs.map((job) => job.strategy)).toEqual([
      "two-pass",
      "combined",
    ]);
  });

  it("runs a batch's jobs with each one's strategy", async () => {
    firmResults();
    byCapability.deep = reply(READ_LINES, "mock-reader");
    byCapability.quick = reply(EXTRACTED, "mock-extractor");
    const batch = jobQueue.createBatch(
      scope(),
      [{ id, name: "Greg Whitlock" }],
      STRATEGY_CHOICE.searxng,
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

describe("the account's web search engine", () => {
  afterEach(async () => {
    await request(app)
      .patch("/api/auth/preferences")
      .send({ webSearchEngine: "default" });
    deleteSetting(SETTING_KEYS.aiWebSearch);
    vi.restoreAllMocks();
  });

  /** Start research for the contact, and hand back the strategy its batch got. */
  async function started(body: Record<string, unknown> = {}) {
    jobQueue.__resetForTests();
    const created = vi.spyOn(jobQueue, "createBatch");
    vi.spyOn(jobQueue, "processBatch").mockResolvedValue(undefined);
    const response = await request(app)
      .post("/api/ai-search")
      .send({ contactIds: [id], ...body });
    expect(response.status).toBe(200);
    const strategy = strategyOf(created.mock.calls[0][2]);
    created.mockRestore();
    return strategy;
  }

  it("is the strategy of a start that names none, and a start that names one keeps it", async () => {
    expect(await started()).toBe("two-pass");
    const saved = await request(app)
      .patch("/api/auth/preferences")
      .send({ webSearchEngine: "combined" });
    expect(saved.body.preferences.webSearchEngine).toBe("combined");
    expect(await started()).toBe("combined");
    expect(await started({ strategy: "searxng" })).toBe("searxng");
  });

  it("follows the instance's engine while the account keeps Instance default", async () => {
    const set = await request(app)
      .put("/api/settings/ai/web-search")
      .send({ engine: "searxng" });
    expect(set.status).toBe(200);
    expect(await started()).toBe("searxng");
    // An account's own choice wins over the instance's.
    await request(app)
      .patch("/api/auth/preferences")
      .send({ webSearchEngine: "provider" });
    expect(await started()).toBe("two-pass");
  });

  it("gives way to an engine that can run, and the start still runs", async () => {
    await request(app)
      .patch("/api/auth/preferences")
      .send({ webSearchEngine: "searxng" });
    deleteSetting(SETTING_KEYS.aiSearxng);
    expect(await started()).toBe("two-pass");
  });

  it("refuses every start while web search is off", async () => {
    await request(app)
      .put("/api/settings/ai/web-search")
      .send({ allowed: false });
    const response = await request(app)
      .post("/api/ai-search")
      .send({ contactIds: [id] });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("RESEARCH_OFF");
    expect(response.body.error.message).toMatch(/Web search is off/);
  });

  it("takes the three engines and Instance default, and nothing else", async () => {
    const refused = await request(app)
      .patch("/api/auth/preferences")
      .send({ webSearchEngine: "google" });
    expect(refused.status).toBe(400);
    const back = await request(app)
      .patch("/api/auth/preferences")
      .send({ webSearchEngine: "default" });
    expect(back.status).toBe(200);
  });
});

describe("the AI settings say whether SearXNG is set", () => {
  it("answers true for a saved address and false for none", async () => {
    const configured = async () =>
      (await request(app).get("/api/settings/ai")).body.webSearch.searxng
        .configured;
    expect(await configured()).toBe(true);
    deleteSetting(SETTING_KEYS.aiSearxng);
    expect(await configured()).toBe(false);
  });
});
