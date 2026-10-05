// =============================================================================
// Research — the provider-search technique
// =============================================================================
// The research model searches the web with its own search tool and reports
// what the matching pages say, one fact per line with its site ("Past role:
// Associate, Harbor Point Partners, 2018 to 2020 [finra.org]"). It returns
// the lines, the pages it cited and the searches it ran. A deep run also
// asks, beside it, for a complete profile at thinking "high", and keeps the
// lines of both. The extraction then reads the lines into fields
// (`extract.ts`): Gemini cannot search and fill a response schema in one
// request, and the split keeps a source beside every fact.
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

import { NEEDS_FAST_MODEL, NEEDS_WEB_SEARCH_MODEL } from "../needs.ts";
import type { AIGenerateResult } from "../../../ai/gateway.ts";
import { resolveRedirects, toCitations } from "../../../ai/citations.ts";
import {
  attachSources,
  buildSearchPrompt,
  buildShortSearchPrompt,
  isNoMatch,
  mergeFindings,
  parseFindings,
  suggestedSearches,
} from "../../aiSearch/promptTemplate.ts";
import { recordInvocation } from "../../aiStatsService.ts";
import { log } from "../../../utils/logger.ts";
import { AppError } from "../../../utils/AppError.ts";
import type { SourceOutcome } from "../evidence.ts";
import type { ResearchRequest, Technique, TechniqueContext } from "../types.ts";

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

/**
 * The research model's own web search, for one contact.
 *
 * It never throws for what the model answered. It says what came of it:
 * the fact lines of every ask that cited pages, a no-match from an ask that
 * reports a web search, or the error that explains why there is neither.
 * Only a run that stops throws.
 */
async function searchWithProvider(
  request: ResearchRequest,
  ctx: TechniqueContext,
): Promise<SourceOutcome> {
  const { contact, depth, history, signal } = request;
  const prompt = buildSearchPrompt(contact, history);
  const failed = (error: unknown): SourceOutcome => ({
    kind: "failed",
    error,
  });
  // Every ask is a paid call, so every ask is counted in AI usage.
  // Thinking counts against the token budget, and a person with a long
  // record took 6,000 thinking tokens before 800 of answer, hence the
  // 16,384.
  const asked = async ({ text, thinkingLevel }: Ask) => {
    const result = await ctx.generate("research", {
      prompt: text(),
      responseFormat: "text",
      enableSearchGrounding: true,
      thinkingLevel,
      signal,
      timeoutMs: ASK_TIMEOUT_MS,
      maxOutputTokens: 16_384,
    });
    ctx.meter.count(result);
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
  /** The ask reported a web search, which a no-match reply needs to count. */
  const searched = (answer: AIGenerateResult) =>
    (answer.searchQueries?.length ?? 0) > 0;
  const cites = (answer: AIGenerateResult) => sourcesOf(answer).length > 0;

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
    text: () => buildSearchPrompt(contact, history, "complete"),
    thinkingLevel: "high",
  };
  const ask = (round: Ask[]) => Promise.allSettled(round.map(asked));
  const fulfilled = (settled: PromiseSettledResult<AIGenerateResult>[]) =>
    settled.flatMap((outcome) =>
      outcome.status === "fulfilled" ? [outcome.value] : [],
    );

  const firstRound = await ask(depth === "deep" ? [plain, complete] : [plain]);
  signal?.throwIfAborted();
  let answers = fulfilled(firstRound);
  // Every first ask failed at the provider: its error says why.
  if (answers.length === 0)
    return failed((firstRound[0] as PromiseRejectedResult).reason);
  // An answer that cites pages but says nothing is not asked again: the
  // search ran, and a second one would be paid for twice.
  if (!answers.some(cites)) {
    log.info(
      "ProviderSearch",
      `${answers[0].model} ${answers.some((answer) => answer.text.trim()) ? "cited no pages" : "returned no answer"} for ${contact.id}; asking twice more, at once`,
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
      return failed((laterRound[0] as PromiseRejectedResult).reason);
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
        "ProviderSearch",
        `No page matched ${contact.id}: nothing to extract`,
      );
      return {
        kind: "no-match",
        queries: noMatch.searchQueries ?? [],
        models: [noMatch.model],
        text: noMatch.text.trim(),
      };
    }
    // No pages and no words from any ask: Gemini sometimes spends a whole
    // call thinking and returns nothing, and a later try can succeed.
    if (!answers.some((answer) => answer.text.trim()))
      return failed(
        new AppError(
          "The web search model returned no answer. No contact fields changed. Try again.",
          502,
          { code: "AI_NO_ANSWER" },
        ),
      );
    if (noMatches.length > 0)
      return failed(
        new AppError(
          "The web search model did not report a web search for this contact. No contact fields changed. Try again, or choose another web search model in Settings → Administration → AI.",
          502,
          { code: "AI_NO_SEARCH" },
        ),
      );
    return failed(
      new AppError(
        "Research did not include source links. No contact fields changed. Try again, or choose another web search model in Settings → Administration → AI.",
        502,
        { code: "AI_GROUNDING_MISSING" },
      ),
    );
  }
  // Pages and no words: the search ran and had nothing to say.
  if (!cited.some((answer) => answer.text.trim()))
    return failed(
      new AppError("No public information found for this contact.", 422, {
        code: "AI_NO_RESEARCH",
      }),
    );

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
  const findings = mergeFindings(
    cited.map((answer) =>
      attachSources(parseFindings(answer.text), answer.supports, pages),
    ),
  );
  log.info(
    "ProviderSearch",
    `${contact.id} (${depth}): ${findings.length} facts from ${citations.length} pages via ${cited[0].model}; ${cited.length} of ${answers.length} asks cited pages`,
  );
  return {
    kind: "facts",
    facts: cited
      .map((answer) => answer.text.trim())
      .filter(Boolean)
      .join("\n"),
    findings,
    citations,
    queries: [
      ...new Set(cited.flatMap((answer) => answer.searchQueries ?? [])),
    ],
    models: [cited[0].model],
  };
}

export const providerSearch: Technique = {
  name: "provider-search",
  needs: () => [
    { what: "research", message: NEEDS_WEB_SEARCH_MODEL },
    { what: "quick", message: NEEDS_FAST_MODEL },
  ],
  run: searchWithProvider,
};
