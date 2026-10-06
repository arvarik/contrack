// =============================================================================
// Research — the provider-search technique
// =============================================================================
// The research model searches the web with its own search tool and reports
// what it found. It returns the answers, the pages they cite and the
// searches that ran. The extraction then reads the answers into fields
// (`extract.ts`): Gemini cannot search and fill a response schema in one
// request, and the split keeps the pages beside the facts.
//
// Every run asks one plain sentence first (`buildQuickSearchPrompt`). A deep
// run asks the long prompt beside it (`buildSearchPrompt`), and keeps what
// both cite. Both ask at thinking "medium". Measured on 36 contacts imported
// from LinkedIn, 20 of them checked by hand (2026-10-05):
//
//   - The plain ask searched for 19 of 20 on its first try. The long prompt
//     ended "If no page is about this person, reply with exactly: NO MATCHING
//     PAGES", and Gemini 3.8 Flash took that exit without a search for 10 of
//     16. Neither ask now has a reply for nobody found.
//   - Once it searches, the long prompt reads further, so the two together
//     found 268 right facts where the plain ask alone found 128.
//   - A third ask, for a complete profile at thinking "high", came back
//     empty for 13 of 64 contacts and wrote a namesake's facts into 3. It
//     is gone.
//
// Whether an ask searched is read from the search metadata (the searches it
// reports, or the pages it cites), never from its words: without a search, a reply still says "no matching pages were found
// in the search results". When no ask searched, or one searched and said
// nothing, the plain one is asked once more. When none searched then
// either, the run fails as AI_NO_SEARCH, or AI_NO_ANSWER when nothing was
// said, and records nothing. When an ask searched and its pages hold nothing about the
// person, the run records no public information.
//
// Before the extraction, pages that can only mislead are left out, with the
// passages of the answer they alone back: the pages of a run the person
// marked "Not this person", and job boards, whose posting describes a role,
// not the person in it.
// =============================================================================

import { NEEDS_FAST_MODEL, NEEDS_WEB_SEARCH_MODEL } from "../needs.ts";
import type { AIGenerateResult } from "../../../ai/gateway.ts";
import { resolveRedirects, toCitations } from "../../../ai/citations.ts";
import {
  attachSources,
  buildQuickSearchPrompt,
  buildSearchPrompt,
  mergeFindings,
  parseFindings,
} from "../../aiSearch/promptTemplate.ts";
import { recordInvocation } from "../../aiStatsService.ts";
import { log } from "../../../utils/logger.ts";
import { AppError } from "../../../utils/AppError.ts";
import type { SourceOutcome } from "../evidence.ts";
import type { ResearchRequest, Technique, TechniqueContext } from "../types.ts";

/** The pages an answer cited, in the one shape the pipeline uses. */
const sourcesOf = (result: AIGenerateResult) =>
  toCitations(
    (result.citations ?? []).map((c) => ({ url: c.uri, title: c.title })),
  );

/** One search ask: its words, and how much the model may think. */
interface Ask {
  text: () => string;
  thinkingLevel: "medium";
}

/** The longest one search ask may take: 15 to more than 80 s. */
const ASK_TIMEOUT_MS = 120_000;

/** Job boards: a posting there describes a role, not the person in it. */
const JOB_BOARDS = [
  "bebee.com",
  "careerbuilder.com",
  "glassdoor.com",
  "indeed.com",
  "jooble.org",
  "lensa.com",
  "mediabistro.com",
  "monster.com",
  "simplyhired.com",
  "talent.com",
  "tealhq.com",
  "theladders.com",
  "ziprecruiter.com",
];

/** True for a page on a job board, or a posting under /jobs/ anywhere. */
function isJobPosting(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.replace(/^www\./, "");
    return (
      JOB_BOARDS.some(
        (board) => host === board || host.endsWith(`.${board}`),
      ) || /^\/jobs?\//i.test(pathname)
    );
  } catch {
    return false;
  }
}

/** A passage this short could be words inside another passage. */
const MIN_PASSAGE_CHARS = 20;

/**
 * The answer without the passages that only left-out pages back. Each
 * passage is cut once, where it stands: the same words elsewhere, backed by
 * a page that counts, stay.
 */
function withoutPassages(
  text: string,
  supports: AIGenerateResult["supports"],
  leftOut: (uri: string) => boolean,
): string {
  let kept = text;
  for (const support of supports ?? [])
    if (support.text.length >= MIN_PASSAGE_CHARS && support.uris.every(leftOut))
      kept = kept.replace(support.text, "");
  return kept.trim();
}

/**
 * The research model's own web search, for one contact.
 *
 * It never throws for what the model answered. It says what came of it:
 * the answers of every ask that cited pages, a no-match from asks that
 * searched, or the error that explains why there is neither. Only a run
 * that stops throws.
 */
async function searchWithProvider(
  request: ResearchRequest,
  ctx: TechniqueContext,
): Promise<SourceOutcome> {
  const { contact, depth, history, signal } = request;
  const failed = (error: unknown): SourceOutcome => ({
    kind: "failed",
    error,
  });
  /**
   * The ask ran a web search: it reports its searches or cites a page. A
   * provider that does not list its searches still cites what it read.
   */
  const searched = (answer: AIGenerateResult) =>
    (answer.searchQueries?.length ?? 0) > 0 || sourcesOf(answer).length > 0;
  /** The ask searched and said something: an answer to read. */
  const answered = (answer: AIGenerateResult) =>
    searched(answer) && !!answer.text.trim();
  // Every ask is a paid call, so every ask is counted in AI usage, and one
  // that ran no search is counted apart, so the usage page shows it.
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
      operation: searched(result) ? "aiSearchGrounding" : "aiSearchNoSearch",
      model: result.model,
      tokenCount: result.tokenCount,
      latencyMs: result.latencyMs,
      cached: false,
      description: `AI Search grounding: ${contact.name}`,
    });
    return result;
  };
  const plain: Ask = {
    text: () => buildQuickSearchPrompt(contact, history),
    thinkingLevel: "medium",
  };
  const long: Ask = {
    text: () => buildSearchPrompt(contact, history),
    thinkingLevel: "medium",
  };
  const ask = (round: Ask[]) => Promise.allSettled(round.map(asked));
  const fulfilled = (settled: PromiseSettledResult<AIGenerateResult>[]) =>
    settled.flatMap((outcome) =>
      outcome.status === "fulfilled" ? [outcome.value] : [],
    );

  const firstRound = await ask(depth === "deep" ? [plain, long] : [plain]);
  signal?.throwIfAborted();
  let answers = fulfilled(firstRound);
  // Every first ask failed at the provider: its error says why.
  if (answers.length === 0)
    return failed((firstRound[0] as PromiseRejectedResult).reason);
  // No search, or a search and no words: Gemini sometimes spends a whole
  // call thinking and returns nothing, and a later try can succeed.
  if (!answers.some(answered)) {
    log.info(
      "ProviderSearch",
      `${answers[0].model} ${answers.some(searched) ? "returned no answer" : "ran no search"} for ${contact.id}; asking once more`,
    );
    const again = await ask([plain]);
    signal?.throwIfAborted();
    const retried = fulfilled(again);
    // The retry failed at the provider: its error says why.
    if (retried.length === 0)
      return failed((again[0] as PromiseRejectedResult).reason);
    answers = [...answers, ...retried];
  }
  if (!answers.some(answered))
    return failed(
      !answers.some(searched) && answers.some((answer) => answer.text.trim())
        ? new AppError(
            "The web search model did not run a web search for this contact. No contact fields changed. Try again, or choose another web search model in Settings → AI.",
            502,
            { code: "AI_NO_SEARCH" },
          )
        : new AppError(
            "The web search model returned no answer. No contact fields changed. Try again.",
            502,
            { code: "AI_NO_ANSWER" },
          ),
    );

  // Real addresses for Gemini's redirect links, before anything is stored,
  // and each fact's own page from the passages the provider matched.
  const searchedAnswers = answers.filter(answered);
  const queries = [
    ...new Set(searchedAnswers.flatMap((answer) => answer.searchQueries ?? [])),
  ];
  const pages = await resolveRedirects(
    searchedAnswers.flatMap((answer) => [
      ...sourcesOf(answer).map((citation) => citation.uri),
      ...(answer.supports ?? []).flatMap((support) => support.uris),
    ]),
    { signal },
  );
  const pageOf = (uri: string) => pages.get(uri) ?? uri;
  const rejected = new Set(history?.rejectedSources ?? []);
  const leftOut = (uri: string) =>
    rejected.has(pageOf(uri)) || isJobPosting(pageOf(uri));

  const usable = searchedAnswers.flatMap((answer) => {
    const citations = sourcesOf(answer).filter(
      (citation) => !leftOut(citation.uri),
    );
    const text = withoutPassages(answer.text, answer.supports, leftOut);
    return citations.length > 0 && text ? [{ answer, citations, text }] : [];
  });
  // The asks searched, and no page they cited, or none left, says anything
  // about the person.
  if (usable.length === 0) {
    log.info(
      "ProviderSearch",
      `No page about ${contact.id}: ${queries.length} searches, nothing to extract`,
    );
    return {
      kind: "no-match",
      queries,
      models: [searchedAnswers[0].model],
      text: "",
    };
  }

  const citations = toCitations(
    usable.flatMap(({ citations: cited }) =>
      cited.map((citation) => ({
        url: pageOf(citation.uri),
        title: citation.title,
      })),
    ),
  );
  const findings = mergeFindings(
    usable.map(({ answer, text }) =>
      attachSources(parseFindings(text), answer.supports, pages).filter(
        (finding) => !finding.url || !leftOut(finding.url),
      ),
    ),
  );
  log.info(
    "ProviderSearch",
    `${contact.id} (${depth}): ${findings.length} fact lines from ${citations.length} pages via ${usable[0].answer.model}; ${usable.length} of ${answers.length} asks cited pages`,
  );
  return {
    kind: "facts",
    facts: usable.map(({ text }) => text).join("\n\n"),
    findings,
    citations,
    queries,
    models: [usable[0].answer.model],
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
