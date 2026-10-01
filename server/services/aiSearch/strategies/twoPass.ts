import { AppError } from "../../../utils/AppError.ts";
// =============================================================================
// AI Search — Two-Pass Strategy
// =============================================================================
// The canonical strategy for AI Search, and the one every provider runs. Two
// sequential calls, because Gemini cannot search and fill a response schema
// in one request, and because the split keeps a source beside every fact:
//
// Pass 1 — Search: the research model searches the web and reports what the
//          matching pages say, one fact per line with its site
//          ("Past role: Associate, Harbor Point Partners, 2018 to 2020
//          [finra.org]"). Returns the text, the pages it cited and the
//          searches it ran. A deep run also asks, beside it, for a complete
//          profile at thinking "high", and keeps the lines of both.
// Pass 2 — Extraction: the quick model reads those lines into the output
//          schema. No searching; the facts are already on the page. Gemini
//          3.8 Flash followed the job rules more closely, but on one
//          contact's facts it wrote dates with stray text in two runs of
//          three and left out every job in one; Flash-Lite was steady
//          (2026-09-26). The rules it misses are applied in code
//          (tidyExtraction).
//
// No source links, no field changes. When no first ask cites a page, two
// other forms are asked at once, because a model that chose not to search
// tends to choose the same when asked the same way, and because asks take up
// to a minute each: one after the other, three of them ran past the job's
// deadline (2026-09-26). Every answer that cites pages is used. If none
// does, the prompt's own reply for that case, NO MATCHING PAGES, is the plain
// outcome "no public information": recorded on the contact, not reported as
// a failure. That reply counts only when its ask reports a web search. A
// no-match with no search behind it says nothing about the web, and it is
// refused as AI_NO_SEARCH. Any other answer with nothing behind it came from
// the model's memory, and is refused too.
// =============================================================================

import { generateFor, type AIGenerateResult } from "../../../ai/gateway.ts";
import { resolveRedirects, toCitations } from "../../../ai/citations.ts";
import type { HydratedContact } from "../../../repositories/types.ts";
import type {
  AISearchStrategy,
  AISearchResult,
  ResearchOptions,
} from "../types.ts";
import {
  attachSources,
  buildExtractionPrompt,
  buildSearchPrompt,
  buildShortSearchPrompt,
  extractionJsonSchema,
  mergeFindings,
  NO_MATCHING_PAGES,
  parseExtraction,
  parseFindings,
  suggestedSearches,
  tidyExtraction,
} from "../promptTemplate.ts";
import { recordInvocation } from "../../../services/aiStatsService.ts";
import { log } from "../../../utils/logger.ts";
import { getErrorMessage } from "../../../utils/helpers.ts";
import { DEFAULT_RESEARCH_DEPTH } from "../../../../shared/researchDepth.ts";
import type { ResearchUsage } from "../../../../shared/researchRecord.ts";

/** The pages a pass cited, in the one shape the pipeline uses. */
const sourcesOf = (result: AIGenerateResult) =>
  toCitations(
    (result.citations ?? []).map((c) => ({ url: c.uri, title: c.title })),
  );

/** One search ask: its words, and how much the model may think. */
interface Ask {
  text: () => string;
  thinkingLevel: "medium" | "high";
}

/** The longest one search ask may take: 15 to more than 80 s. */
const ASK_TIMEOUT_MS = 120_000;

export class TwoPassStrategy implements AISearchStrategy {
  readonly name = "two-pass";

  async execute(
    contact: HydratedContact,
    prompt: string,
    signal?: AbortSignal,
    options: ResearchOptions = {},
  ): Promise<AISearchResult> {
    signal?.throwIfAborted();
    const startMs = Date.now();
    const depth = options.depth ?? DEFAULT_RESEARCH_DEPTH;
    // Every call is counted, the ones that found nothing too: each is paid.
    const usage: ResearchUsage = {
      calls: 0,
      searches: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    let tokenCount = 0;
    const count = (result: AIGenerateResult) => {
      usage.calls += 1;
      usage.searches += result.searchQueries?.length ?? 0;
      usage.inputTokens += result.usage?.inputTokens ?? 0;
      usage.outputTokens += result.usage?.outputTokens ?? 0;
      tokenCount += result.tokenCount ?? 0;
    };
    // Every ask is a paid call, so every ask is counted in AI usage.
    // Thinking counts against the token budget, and a person with a long
    // record took 6,000 thinking tokens before 800 of answer, hence the
    // 16,384.
    const asked = async ({ text, thinkingLevel }: Ask) => {
      const result = await generateFor("research", {
        prompt: text(),
        responseFormat: "text",
        enableSearchGrounding: true,
        thinkingLevel,
        signal,
        timeoutMs: ASK_TIMEOUT_MS,
        maxOutputTokens: 16_384,
      });
      count(result);
      recordInvocation({
        operation: "aiSearchGrounding",
        model: result.model,
        tokenCount: result.tokenCount,
        latencyMs: result.latencyMs,
        cached: false,
        description: `AI Search grounding: ${contact.name}`,
      });
      return result;
    };
    const isNoMatch = (text: string) =>
      text.toUpperCase().includes(NO_MATCHING_PAGES);
    /** The ask reported a web search, which a no-match reply needs to count. */
    const searched = (answer: AIGenerateResult) =>
      (answer.searchQueries?.length ?? 0) > 0;
    const cites = (answer: AIGenerateResult) => sourcesOf(answer).length > 0;

    // ── Pass 1: Search ────────────────────────────────────────────────
    // The model decides for itself whether to search, and Gemini has no
    // setting that forces it (the old dynamic threshold is refused by 3.x).
    // How much it may think decides it: on one research prompt, Gemini 3.8
    // Flash searched 0 of 3 times at thinking "low", 1 of 3 at its default
    // and 5 of 5 at "high". "Medium" searched for every contact a page was
    // about, in 15 to 79 s. "High", told to find a complete profile, found
    // more when it answered, 32 details for one contact where "medium"
    // found 20, but it came back empty for the same two contacts of five on
    // every try (2026-09-26). So every depth asks at "medium", and a deep
    // run asks at "high" beside it: an empty answer there costs its tokens,
    // and the "medium" one still stands.
    const plain: Ask = { text: () => prompt, thinkingLevel: "medium" };
    // The second form leads with the searches, so the first thing the model
    // reads is to run them. The third is the short form.
    const first = suggestedSearches(contact)
      .slice(0, 5)
      .map((query) => `- ${query}`)
      .join("\n");
    const led: Ask = {
      text: () =>
        `Before anything else, run these Google searches, one after another:\n${first}\nThen do the task below, using only what the searches return.\n\n${prompt}\n\nRun Google Search now, before you answer. Base every fact on what the search returns, even facts you already know.`,
      thinkingLevel: "medium",
    };
    const short: Ask = {
      text: () => buildShortSearchPrompt(contact),
      thinkingLevel: "medium",
    };
    const complete: Ask = {
      text: () => buildSearchPrompt(contact, options.history, "complete"),
      thinkingLevel: "high",
    };
    const ask = (round: Ask[]) => Promise.allSettled(round.map(asked));
    const fulfilled = (settled: PromiseSettledResult<AIGenerateResult>[]) =>
      settled.flatMap((outcome) =>
        outcome.status === "fulfilled" ? [outcome.value] : [],
      );

    const firstRound = await ask(
      depth === "deep" ? [plain, complete] : [plain],
    );
    signal?.throwIfAborted();
    let answers = fulfilled(firstRound);
    // Every first ask failed at the provider: its error says why.
    if (answers.length === 0)
      throw (firstRound[0] as PromiseRejectedResult).reason;
    // An answer that cites pages but says nothing is not asked again: the
    // search ran, and a second one would be paid for twice.
    if (!answers.some(cites)) {
      log.info(
        "TwoPassStrategy",
        `${answers[0].model} ${answers.some((answer) => answer.text.trim()) ? "cited no pages" : "returned no answer"} for ${contact.name}; asking twice more, at once`,
      );
      const laterRound = await ask([led, short]);
      signal?.throwIfAborted();
      const later = fulfilled(laterRound);
      // Both asks failed at the provider: its error says why, and the first
      // answer's missing sources do not.
      if (
        later.length === 0 &&
        !answers.some((answer) => isNoMatch(answer.text) && searched(answer))
      )
        throw (laterRound[0] as PromiseRejectedResult).reason;
      answers = [...answers, ...later];
    }
    const cited = answers.filter(cites);

    if (cited.length === 0) {
      // Anything but the no-match reply, with no page behind it, came from
      // the model's memory, which is what the source rule exists to keep out.
      // The no-match reply counts only from an ask that reports a web search.
      // On 15 contacts imported from LinkedIn, Gemini 3.8 Flash gave it with
      // no search for 8 at Standard and 9 at Deep, and other settings of the
      // same asks found pages for 3 of them (2026-10-01). Recorded as no
      // public information, it told the person that no page exists and
      // offered to add a city or an email.
      const noMatches = answers.filter(
        (answer) =>
          isNoMatch(answer.text) && parseFindings(answer.text).length === 0,
      );
      const noMatch = noMatches.find(searched);
      if (noMatch) {
        log.info(
          "TwoPassStrategy",
          `No page matched ${contact.name}: nothing to extract`,
        );
        return {
          data: {},
          models: [noMatch.model],
          tokenCount,
          latencyMs: Date.now() - startMs,
          citations: [],
          groundedText: noMatch.text.trim(),
          findings: [],
          searchQueries: noMatch.searchQueries ?? [],
          outcome: "no-public-info",
          depth,
          usage,
        };
      }
      // No pages and no words from any ask: Gemini sometimes spends a whole
      // call thinking and returns nothing, and a later try can succeed.
      if (!answers.some((answer) => answer.text.trim()))
        throw new AppError(
          "The research model returned no answer. No contact fields changed. Try again.",
          502,
          { code: "AI_NO_ANSWER" },
        );
      if (noMatches.length > 0)
        throw new AppError(
          "The research model did not report a web search for this contact. No contact fields changed. Try again, or choose another research model in AI settings.",
          502,
          { code: "AI_NO_SEARCH" },
        );
      throw new AppError(
        "Research did not include source links. No contact fields changed. Try again, or choose another research model in AI settings.",
        502,
        { code: "AI_GROUNDING_MISSING" },
      );
    }
    // Pages and no words: the search ran and had nothing to say.
    if (!cited.some((answer) => answer.text.trim()))
      throw new AppError("No public information found for this contact.", 422, {
        code: "AI_NO_RESEARCH",
      });

    // Real addresses for Gemini's redirect links, before anything is stored,
    // and each fact's own page from the passages the provider matched.
    const pages = await resolveRedirects(
      cited.flatMap((answer) => [
        ...sourcesOf(answer).map((citation) => citation.uri),
        ...(answer.supports ?? []).flatMap((support) => support.uris),
      ]),
      { signal },
    );
    const citations = toCitations(
      cited.flatMap((answer) =>
        sourcesOf(answer).map((citation) => ({
          url: pages.get(citation.uri) ?? citation.uri,
          title: citation.title,
        })),
      ),
    );
    const sourced = mergeFindings(
      cited.map((answer) =>
        attachSources(parseFindings(answer.text), answer.supports, pages),
      ),
    );
    const facts = cited
      .map((answer) => answer.text.trim())
      .filter(Boolean)
      .join("\n");
    const searchQueries = [
      ...new Set(cited.flatMap((answer) => answer.searchQueries ?? [])),
    ];

    // ── Pass 2: Extraction (fact lines → structured JSON) ─────────────
    const pass2Start = Date.now();
    const pass2 = await generateFor("quick", {
      prompt: buildExtractionPrompt(contact, facts),
      responseFormat: "json",
      jsonSchema: extractionJsonSchema,
      signal,
      timeoutMs: 30_000,
      maxOutputTokens: 6_000,
    });
    signal?.throwIfAborted();
    count(pass2);
    recordInvocation({
      operation: "aiSearchExtraction",
      model: pass2.model,
      tokenCount: pass2.tokenCount,
      latencyMs: Date.now() - pass2Start,
      cached: false,
      description: `AI Search extraction: ${contact.name}`,
    });

    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(pass2.text || "{}");
    } catch (parseErr: unknown) {
      throw new Error(
        `JSON parse failed for extraction output: ${getErrorMessage(parseErr)}. `,
      );
    }
    // Field by field: a value that fails its schema is left out, and the
    // rest of the answer is kept.
    const { data: parsed, dropped } = parseExtraction(rawParsed);
    const data = tidyExtraction(parsed, contact);
    if (dropped.length > 0)
      log.warn(
        "TwoPassStrategy",
        `${contact.name}: ${pass2.model} wrote values the schema refused; left out: ${dropped.join(", ")}`,
      );
    log.info(
      "TwoPassStrategy",
      `${contact.name} (${depth}): ${sourced.length} facts from ${citations.length} pages via ${cited[0].model}, read by ${pass2.model} in ${pass2.latencyMs}ms; ${usage.calls} calls, ${usage.searches} searches, ${cited.length} of ${answers.length} asks cited pages`,
    );

    return {
      data: data as Record<string, unknown>,
      models: [cited[0].model, pass2.model],
      tokenCount,
      latencyMs: Date.now() - startMs,
      citations,
      groundedText: facts,
      findings: sourced,
      searchQueries,
      outcome: "found",
      depth,
      usage,
    };
  }
}
