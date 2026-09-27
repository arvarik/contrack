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
//          searches it ran.
// Pass 2 — Extraction: the quick model reads those lines into the output
//          schema. No searching; the facts are already on the page. Gemini
//          3.8 Flash followed the job rules more closely, but on one
//          contact's facts it wrote dates with stray text in two runs of
//          three and left out every job in one; Flash-Lite was steady
//          (2026-09-26). The rules it misses are applied in code
//          (tidyExtraction).
//
// No source links, no field changes. A search pass that cites nothing, or
// returns nothing, is asked again in two other forms at once, because a model
// that chose not to search tends to choose the same when asked the same way,
// and because a second round's asks take a minute each at thinking "high":
// one after the other, three of them ran past the job's deadline
// (2026-09-26). The first of them that cites pages is used. If none does, the
// prompt's own reply for that case, NO MATCHING PAGES, is the plain outcome
// "no public information": recorded on the contact, not reported as a
// failure. Any other answer with nothing behind it came from the model's
// memory, and is refused.
// =============================================================================

import { generateFor, type AIGenerateResult } from "../../../ai/gateway.ts";
import { resolveRedirects, toCitations } from "../../../ai/citations.ts";
import type { HydratedContact } from "../../../repositories/types.ts";
import type { AISearchStrategy, AISearchResult } from "../types.ts";
import {
  attachSources,
  buildExtractionPrompt,
  buildShortSearchPrompt,
  extractionJsonSchema,
  NO_MATCHING_PAGES,
  parseExtraction,
  parseFindings,
  suggestedSearches,
  tidyExtraction,
} from "../promptTemplate.ts";
import { recordInvocation } from "../../../services/aiStatsService.ts";
import { log } from "../../../utils/logger.ts";
import { getErrorMessage } from "../../../utils/helpers.ts";

/** The pages a pass cited, in the one shape the pipeline uses. */
const sourcesOf = (result: AIGenerateResult) =>
  toCitations(
    (result.citations ?? []).map((c) => ({ url: c.uri, title: c.title })),
  );

export class TwoPassStrategy implements AISearchStrategy {
  readonly name = "two-pass";

  async execute(
    contact: HydratedContact,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<AISearchResult> {
    signal?.throwIfAborted();
    const startMs = Date.now();
    // The model decides for itself whether to search, and Gemini has no
    // setting that forces it (the old dynamic threshold is refused by 3.x).
    // How much it may think decides it: on the same research prompt, Gemini
    // 3.8 Flash searched 0 of 3 times at thinking "low", 1 of 3 at its
    // default and 5 of 5 at "high" (2026-09-26). Thinking counts against the
    // token budget, and a person with a long record took 6,000 thinking
    // tokens before 800 of answer, hence the 16,384.
    const search = (text: string) =>
      generateFor("research", {
        prompt: text,
        responseFormat: "text",
        enableSearchGrounding: true,
        thinkingLevel: "high",
        signal,
        // 20 to more than 75 s at "high", with ten or more searches.
        timeoutMs: 120_000,
        maxOutputTokens: 16_384,
      });

    // ── Pass 1: Search ────────────────────────────────────────────────
    // The second ask leads with the searches, so the first thing the model
    // reads is to run them. The third is the short form.
    const first = suggestedSearches(contact)
      .slice(0, 5)
      .map((query) => `- ${query}`)
      .join("\n");
    const asks = [
      () => prompt,
      () =>
        `Before anything else, run these Google searches, one after another:\n${first}\nThen do the task below, using only what the searches return.\n\n${prompt}\n\nRun Google Search now, before you answer. Base every fact on what the search returns, even facts you already know.`,
      () => buildShortSearchPrompt(contact),
    ];
    const isNoMatch = (text: string) =>
      text.toUpperCase().includes(NO_MATCHING_PAGES);
    // Every ask is a paid call, so every ask is counted in AI usage.
    const asked = async (text: string) => {
      const result = await search(text);
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
    let pass1 = await asked(asks[0]());
    let citations = sourcesOf(pass1);
    // An answer that cites pages but says nothing is not asked again: the
    // search ran, and a second one would be paid for twice.
    if (citations.length === 0) {
      signal?.throwIfAborted();
      log.info(
        "TwoPassStrategy",
        `${pass1.model} ${pass1.text.trim() ? "cited no pages" : "returned no answer"} for ${contact.name}; asking twice more, at once`,
      );
      const settled = await Promise.allSettled(
        asks.slice(1).map((ask) => asked(ask())),
      );
      signal?.throwIfAborted();
      const answers = settled.flatMap((outcome) =>
        outcome.status === "fulfilled" ? [outcome.value] : [],
      );
      const cited = answers.find((answer) => sourcesOf(answer).length > 0);
      const noMatchReply = [pass1, ...answers].find((answer) =>
        isNoMatch(answer.text),
      );
      // Both asks failed at the provider: its error says why, and the first
      // answer's missing sources do not.
      if (!cited && !noMatchReply && answers.length === 0)
        throw (settled[0] as PromiseRejectedResult).reason;
      pass1 =
        cited ??
        noMatchReply ??
        [pass1, ...answers].find((answer) => answer.text.trim()) ??
        pass1;
      citations = sourcesOf(pass1);
    }

    if (!pass1.text.trim()) {
      // Pages and no words: the search ran and had nothing to say. No pages
      // and no words from any ask: Gemini sometimes spends a whole call
      // thinking and returns nothing, and a later try can succeed.
      if (citations.length > 0)
        throw new AppError(
          "No public information found for this contact.",
          422,
          { code: "AI_NO_RESEARCH" },
        );
      throw new AppError(
        "The research model returned no answer. No contact fields changed. Try again.",
        502,
        { code: "AI_NO_ANSWER" },
      );
    }

    const findings = parseFindings(pass1.text);
    if (citations.length === 0) {
      // Anything but the no-match reply, with no page behind it, came from
      // the model's memory, which is what the source rule exists to keep out.
      const noMatch = findings.length === 0 && isNoMatch(pass1.text);
      if (!noMatch)
        throw new AppError(
          "Research did not include source links. No contact fields changed. Choose another research model in AI settings.",
          502,
          { code: "AI_GROUNDING_MISSING" },
        );
      log.info(
        "TwoPassStrategy",
        `No page matched ${contact.name}: nothing to extract`,
      );
      return {
        data: {},
        models: [pass1.model],
        tokenCount: pass1.tokenCount,
        latencyMs: Date.now() - startMs,
        citations: [],
        groundedText: pass1.text.trim(),
        findings: [],
        searchQueries: pass1.searchQueries ?? [],
        outcome: "no-public-info",
      };
    }
    // Real addresses for Gemini's redirect links, before anything is stored,
    // and each fact's own page from the passages the provider matched.
    const pages = await resolveRedirects(
      [
        ...citations.map((citation) => citation.uri),
        ...(pass1.supports ?? []).flatMap((support) => support.uris),
      ],
      { signal },
    );
    citations = toCitations(
      citations.map((citation) => ({
        url: pages.get(citation.uri) ?? citation.uri,
        title: citation.title,
      })),
    );
    const sourced = attachSources(findings, pass1.supports, pages);

    // ── Pass 2: Extraction (fact lines → structured JSON) ─────────────
    const pass2Start = Date.now();
    const pass2 = await generateFor("quick", {
      prompt: buildExtractionPrompt(contact, pass1.text),
      responseFormat: "json",
      jsonSchema: extractionJsonSchema,
      signal,
      timeoutMs: 30_000,
      maxOutputTokens: 6_000,
    });
    signal?.throwIfAborted();
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
      `${contact.name}: ${findings.length} facts from ${citations.length} pages via ${pass1.model}, read by ${pass2.model} in ${pass2.latencyMs}ms`,
    );

    return {
      data: data as Record<string, unknown>,
      models: [pass1.model, pass2.model],
      tokenCount:
        pass1.tokenCount === undefined || pass2.tokenCount === undefined
          ? undefined
          : pass1.tokenCount + pass2.tokenCount,
      latencyMs: Date.now() - startMs,
      citations,
      groundedText: pass1.text.trim(),
      findings: sourced,
      searchQueries: pass1.searchQueries ?? [],
      outcome: "found",
    };
  }
}
