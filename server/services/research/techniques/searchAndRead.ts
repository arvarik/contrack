// =============================================================================
// Research — the search-and-read technique
// =============================================================================
// A web search service, such as a self-hosted SearXNG, runs the searches,
// and a model reads the pages. Research then does not wait on a model's
// choice to search, and it works with a purely local stack (an Ollama or vLLM
// chat model with SearXNG).
//
// Retrieval: run the searches the provider research would run through the
//            request's web search (`WebSearch`), then read the result pages
//            that name the person (`pages.ts`). No model involved.
// Reading:   the "deep" model reads the pages and the other results'
//            snippets into fact lines, with the search pass's rules and form
//            (`buildReadingPrompt`), so each fact keeps its page.
//
// The extraction then reads the lines into fields (`extract.ts`). The
// combined technique runs this beside the research model's own search.
// =============================================================================

import { NEEDS_STRONG_MODEL } from "../needs.ts";
import { toCitations } from "../../../ai/citations.ts";
import type { HydratedContact } from "../../../repositories/types.ts";
import {
  buildReadingPrompt,
  formalName,
  READING_MAX_CHARS,
  isNoMatch,
  isPlaceholderEmployer,
  NO_MATCHING_PAGES,
  otherNameForms,
  parseFindings,
  searchName,
  suggestedSearches,
} from "../../aiSearch/promptTemplate.ts";
import { recordInvocation } from "../../aiStatsService.ts";
import { log } from "../../../utils/logger.ts";
import { getErrorMessage } from "../../../utils/helpers.ts";
import { AppError } from "../../../utils/AppError.ts";
import type { ResearchDepth } from "../../../../shared/researchDepth.ts";
import {
  siteOf,
  sourceForSite,
  type ResearchSource,
} from "../../../../shared/researchRecord.ts";
import {
  CHARS_PER_TOKEN,
  contextWindowFor,
  type SourceOutcome,
} from "../evidence.ts";
import { textOf } from "../pages.ts";
import { webSearchCode } from "../webSearch.ts";
import type {
  ResearchRequest,
  Technique,
  TechniqueContext,
  WebResult,
} from "../types.ts";

/** Searches run, and result pages read in full, at each depth. */
const READ_LIMITS: Record<ResearchDepth, { queries: number; pages: number }> = {
  standard: { queries: 3, pages: 5 },
  deep: { queries: 6, pages: 10 },
};
/** Results read by their snippet alone, beside the pages read in full. */
const MAX_SNIPPETS = 20;

/**
 * The most results one search asks for. SearXNG answers one page, of fewer
 * than this, so it never cuts one.
 */
const RESULTS_PER_SEARCH = 50;

/** The first result of each list, then the second of each, and so on. */
function interleave<T>(lists: readonly T[][]): T[] {
  const out: T[] = [];
  for (let index = 0; lists.some((list) => index < list.length); index++)
    for (const list of lists) if (index < list.length) out.push(list[index]);
  return out;
}

/** Lower-case words of two letters or more. */
const wordsOf = (text: string) =>
  (text.toLowerCase().match(/\p{L}{2,}/gu) ?? []) as string[];

/**
 * The person's names as sets of words, for telling a result about them from
 * one about somebody else: the clean name, each other form, and the formal
 * one. A form needs two words, so "Priya K." counts only through the
 * surname its handle spells.
 */
function personNames(contact: HydratedContact): string[][] {
  const clean = searchName(contact.name);
  const forms = [clean, ...otherNameForms(contact)];
  const formal = formalName(clean);
  if (formal) forms.push(formal);
  const sets = forms.map(wordsOf).filter((words) => words.length >= 2);
  return sets.length > 0 ? sets : [wordsOf(clean)].filter((w) => w.length);
}

/** True when a result's title or snippet has every word of one of the names. */
function namesPerson(result: WebResult, names: string[][]): boolean {
  const words = new Set(wordsOf(`${result.title} ${result.snippet}`));
  return names.some((name) => name.every((word) => words.has(word)));
}

/**
 * Results tried for each page read in full. A site that turns robots away,
 * such as LinkedIn with its status 999, gives its place to the next result
 * that names the person. On one contact, four of the first five such
 * results were LinkedIn pages, and one page of five was read (2026-10-02).
 */
const TRIES_PER_PAGE = 3;

/**
 * Read up to `want` of the candidates in full, in their order, a round at a
 * time: each round tries as many as are still wanted, all at once. A page
 * counts as read when its text `counts`; one that does not is unread.
 *
 * @returns The pages read with their text, the candidates tried that could
 *   not be read, and how many candidates were tried.
 */
async function readInFull(
  candidates: readonly WebResult[],
  want: number,
  signal: AbortSignal | undefined,
  counts: (result: WebResult, text: string) => boolean,
): Promise<{
  read: Array<{ result: WebResult; text: string }>;
  unread: WebResult[];
  tried: number;
}> {
  const read: Array<{ result: WebResult; text: string }> = [];
  const unread: WebResult[] = [];
  const limit = Math.min(candidates.length, want * TRIES_PER_PAGE);
  let tried = 0;
  while (read.length < want && tried < limit) {
    const round = candidates.slice(
      tried,
      Math.min(tried + want - read.length, limit),
    );
    tried += round.length;
    const texts = await Promise.all(
      round.map((result) => textOf(result, signal)),
    );
    signal?.throwIfAborted();
    round.forEach((result, index) => {
      const text = texts[index];
      if (text && counts(result, text)) read.push({ result, text });
      else unread.push(result);
    });
  }
  return { read, unread, tried };
}

/** The longest answer one reading call may write, in tokens. */
const READING_OUTPUT_TOKENS = 8_192;
/** The most calls one reading makes, when the pages do not fit in one. */
const MAX_READING_PARTS = 3;
/** The least page text a part holds, however small the window. */
const MIN_PART_CHARS = 2_000;
/** What joins two pages in one reading. */
const PAGE_SEPARATOR = "\n\n---\n\n";

/** How much page text one reading call holds, and how long its answer may be. */
export interface ReadingSize {
  /** Characters of pages in one call. */
  partChars: number;
  /** Tokens the answer may take. */
  outputTokens: number;
  /** Calls the reading may make. */
  maxParts: number;
}

/**
 * The size of one reading call for a deep model with this window. A window
 * that holds the whole reading gets one call, as before. A smaller one gets
 * a quarter of it for the answer, the instructions, and the rest for pages,
 * in up to MAX_READING_PARTS calls.
 *
 * @param window - The model's context window in tokens, or undefined for a
 *   hosted model.
 */
export function readingSize(
  contact: HydratedContact,
  window: number | undefined,
): ReadingSize {
  const whole = {
    partChars: READING_MAX_CHARS,
    outputTokens: READING_OUTPUT_TOKENS,
    maxParts: 1,
  };
  if (!window) return whole;
  const outputTokens = Math.min(READING_OUTPUT_TOKENS, Math.floor(window / 4));
  const instructions = buildReadingPrompt(contact, "").length;
  const room = (window - outputTokens) * CHARS_PER_TOKEN - instructions;
  if (room >= READING_MAX_CHARS) return whole;
  return {
    partChars: Math.max(room, MIN_PART_CHARS),
    outputTokens,
    maxParts: MAX_READING_PARTS,
  };
}

/**
 * The pages in parts of at most `size.partChars` each, in order, and at most
 * `size.maxParts` of them. A page longer than the room left in a part is cut
 * to fill it, when MIN_PAGE_SHARE or more is left, and else starts the next
 * part. What does not fit is left out, from the end.
 */
export function partsOf(
  documents: readonly string[],
  size: ReadingSize,
): string[] {
  const parts: string[] = [];
  let current = "";
  for (const document of documents) {
    for (;;) {
      const joiner = current ? PAGE_SEPARATOR : "";
      const room = size.partChars - current.length - joiner.length;
      if (document.length <= room) {
        current += joiner + document;
        break;
      }
      if (room >= MIN_PAGE_SHARE) {
        current += joiner + document.slice(0, room);
        break;
      }
      parts.push(current);
      if (parts.length === size.maxParts) return parts;
      current = "";
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** The least text a page read in full keeps when the reading is short of room. */
const MIN_PAGE_SHARE = 1_500;

/**
 * The pages read in full and the snippets, in the order the reading sees
 * them, within what it holds.
 *
 * A snippet is often all that a site that turns robots away gives, and on
 * one contact the only facts were in a LinkedIn profile's snippet. Read in
 * three parts of 5,664 characters on a local model, three pages read in
 * full, each about somebody else of the same name, filled every part, and
 * the snippets were left out (2026-10-02). So:
 *
 * - In parts, the snippets come first. They are short, and a page fills a
 *   part by itself, so after the pages no part had room for them. The pages
 *   fill the room that is left (`partsOf`).
 * - In one call, the pages come first. When the two do not fit, each page
 *   is shortened alike, to no less than MIN_PAGE_SHARE, so the snippets fit
 *   too, and what still does not fit is cut from the end.
 */
function documentsFor(
  read: ReadonlyArray<{ result: WebResult; text: string }>,
  snippets: readonly WebResult[],
  size: ReadingSize,
): string[] {
  const pages = read.map((page) => block(page.result, page.text));
  const shown = snippets.map((result) => block(result, result.snippet));
  if (size.maxParts > 1) return [...shown, ...pages];
  const length = (texts: string[]) =>
    texts.reduce((sum, text) => sum + text.length + PAGE_SEPARATOR.length, 0);
  if (pages.length === 0 || length(pages) + length(shown) <= size.partChars)
    return [...pages, ...shown];
  const share = Math.max(
    MIN_PAGE_SHARE,
    Math.floor((size.partChars - length(shown)) / pages.length) -
      PAGE_SEPARATOR.length,
  );
  return [...pages.map((page) => page.slice(0, share)), ...shown];
}

/** An address as the reading may echo it: no scheme, www, case or end slash. */
const addressKey = (address: string) =>
  address
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/[/?#]+$/, "");

/**
 * The page a fact names: the page at the address the reading wrote, or, when
 * it wrote a site or an address it changed, the first page on that site.
 */
export function pageFor(
  named: string | undefined,
  pages: readonly ResearchSource[],
): ResearchSource | null {
  if (!named) return null;
  const key = addressKey(named);
  return (
    pages.find((page) => addressKey(page.url) === key) ??
    sourceForSite(named, pages)
  );
}

/**
 * A LinkedIn profile's handle, lower-cased: "rowan-vale-1a2b" in
 * linkedin.com/in/rowan-vale-1a2b, on any regional host.
 */
function linkedInHandle(url: string): string | null {
  const match =
    /^https?:\/\/(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/in\/([^/?#]+)/i.exec(
      url,
    );
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return match[1].toLowerCase();
  }
}

/**
 * The results that are not another person's LinkedIn profile. A person has
 * one, so while the records hold the contact's own, a profile with another
 * handle is somebody else of the same name. On one contact, a local model
 * read two such profiles as the contact's, and the extraction added a job
 * from one (2026-10-02). Without a profile in the records, all are kept.
 */
function withoutOtherProfiles(
  results: WebResult[],
  contact: HydratedContact,
): WebResult[] {
  const own = new Set(
    (contact.socialLinks ?? []).flatMap(
      (link) => linkedInHandle(link.url) ?? [],
    ),
  );
  if (own.size === 0) return results;
  return results.filter((result) => {
    const handle = linkedInHandle(result.url);
    return !handle || own.has(handle);
  });
}

/** A company's legal ending, which a page often leaves out: "Inc.", "LLC". */
const LEGAL_ENDING =
  /[,.]?\s+(?:inc|llc|ltd|limited|corp|corporation|gmbh|co|plc|ag|sa|bv)\.?$/i;

/**
 * The details of the records that a page about this person can share,
 * lower-cased: the employers, the schools, the city, a role of two words or
 * more, and the LinkedIn handle. A placeholder employer such as
 * "Self-employed" and a one-word role such as "Associate" tell nobody apart,
 * so they are none.
 */
export function recordDetails(contact: HydratedContact): string[] {
  const employers = [
    contact.company,
    ...(contact.experience ?? []).map((job) => job.company),
  ].filter(
    (company): company is string =>
      !!company && !isPlaceholderEmployer(company),
  );
  const role =
    contact.role && contact.role.trim().split(/\s+/).length >= 2
      ? contact.role
      : null;
  const details = [
    ...employers.map((company) => company.trim().replace(LEGAL_ENDING, "")),
    ...(contact.education ?? []).map((school) => school.school),
    contact.location?.split(",")[0],
    role,
    ...(contact.socialLinks ?? []).flatMap(
      (link) => linkedInHandle(link.url) ?? [],
    ),
  ];
  return [
    ...new Set(
      details
        .map((detail) => detail?.trim().toLowerCase() ?? "")
        .filter((detail) => detail.length >= 3),
    ),
  ];
}

/**
 * True when a result shares a detail with the records, in its address, its
 * title, its snippet or the page's text, or when the records have none.
 *
 * The rule of the reading's prompt, applied in code: a page counts only when
 * it is about this person, the same name and at least one detail of the
 * records. A local 7B model read pages about others of the same name as the
 * contact's, and the extraction saved a city and a job from them; Gemini,
 * reading the same results, did not (2026-10-02).
 */
function sharesDetail(
  result: WebResult,
  details: readonly string[],
  text = "",
): boolean {
  if (details.length === 0) return true;
  const said =
    `${result.url} ${result.title} ${result.snippet} ${text}`.toLowerCase();
  return details.some((detail) => said.includes(detail));
}

/** One page or snippet as the reading ask sees it. */
const block = (result: WebResult, text: string) =>
  `SOURCE: ${result.url}\nTITLE: ${result.title}\n${text.trim()}`;

/**
 * Search with the request's web search, read the pages, and write fact lines.
 *
 * It never throws for what it found. It says what came of it: fact lines
 * with their pages, a no-match after the search returned results, or the
 * error that explains why there is neither. Only a run that stops throws.
 *
 * - The searches are the provider research's own (`suggestedSearches`): 3 at
 *   Standard, 6 at Deep, all at once.
 * - Results are taken in turn from each search, so one search cannot fill
 *   every slot. Only the results whose title or snippet names the person are
 *   read: up to 5 pages in full at Standard and 10 at Deep, and up to 20
 *   more by their snippet. When none names the person, the reading sees the
 *   first snippets and says whether any is about them.
 * - The web search's searches are not the model's, so the meter counts the
 *   reading's tokens and no search. SearXNG's are not billed.
 */
async function searchAndReadPages(
  request: ResearchRequest,
  ctx: TechniqueContext,
): Promise<SourceOutcome> {
  const { contact, signal } = request;
  const failed = (error: unknown): SourceOutcome => ({
    kind: "failed",
    error,
  });
  try {
    const web = ctx.webSearch;
    if (!web) return failed(new AppError("No web search was chosen", 503));
    const startMs = Date.now();
    const limits = READ_LIMITS[request.depth];

    // ── Retrieval (no model) ────────────────────────────────────────────
    const queries = suggestedSearches(contact).slice(0, limits.queries);
    const errors: unknown[] = [];
    const lists = await Promise.all(
      queries.map(async (query) => {
        try {
          return await web.search(query, {
            limit: RESULTS_PER_SEARCH,
            signal,
          });
        } catch (err) {
          signal?.throwIfAborted();
          errors.push(err);
          log.warn(
            "SearchAndRead",
            `Search failed for "${query}": ${getErrorMessage(err)}`,
          );
          return [];
        }
      }),
    );
    const seen = new Set<string>();
    const found = interleave(lists).filter((result) => {
      if (!/^https?:\/\//i.test(result.url)) return false;
      if (seen.has(result.url)) return false;
      seen.add(result.url);
      return true;
    });
    const results = withoutOtherProfiles(found, contact);
    // Every search failed: the service's own answer says why.
    if (errors.length > 0 && errors.length === queries.length)
      return failed(errors[0]);
    if (results.length === 0)
      return failed(
        new AppError(
          `${web.label} returned no usable results for this contact`,
          502,
          { code: webSearchCode(web, "NO_RESULTS") },
        ),
      );
    const names = personNames(contact);
    const naming = results.filter((result) => namesPerson(result, names));
    const details = recordDetails(contact);
    // The pages that name the person, read in full, in turn. A page that
    // cannot be read, or shares no detail with the records, gives its place
    // to the next, and keeps its snippet when the snippet shares one.
    const { read, unread, tried } = await readInFull(
      naming,
      limits.pages,
      signal,
      (result, text) => sharesDetail(result, details, text),
    );
    const snippets = (
      naming.length > 0 ? [...unread, ...naming.slice(tried)] : results
    )
      .filter(
        (result) => result.snippet.trim() && sharesDetail(result, details),
      )
      .slice(0, MAX_SNIPPETS);
    if (read.length === 0 && snippets.length === 0) {
      log.info(
        "SearchAndRead",
        `${contact.name}: ${results.length} results from ${queries.length} searches, none shares a detail with the records`,
      );
      return {
        kind: "no-match",
        queries,
        models: [web.id],
        text: `${NO_MATCHING_PAGES}: no result shares a detail with the records.`,
      };
    }
    log.info(
      "SearchAndRead",
      `${contact.name}: ${results.length} results from ${queries.length} searches, ${found.length - results.length} other people's LinkedIn profiles left out, ${naming.length} name the person; read ${read.length} of ${tried} pages tried in ${Date.now() - startMs}ms`,
    );

    // ── Reading (pages → fact lines) ────────────────────────────────────
    // In parts when the deep model's window cannot hold the pages at once.
    const size = readingSize(contact, contextWindowFor("deep"));
    const parts = partsOf(documentsFor(read, snippets, size), size);
    const answers: string[] = [];
    const readErrors: unknown[] = [];
    let readModel = "";
    for (const part of parts) {
      const readStart = Date.now();
      try {
        const answer = await ctx.generate("deep", {
          prompt: buildReadingPrompt(contact, part),
          responseFormat: "text",
          signal,
          timeoutMs: 90_000,
          maxOutputTokens: size.outputTokens,
        });
        signal?.throwIfAborted();
        ctx.meter.count(answer);
        recordInvocation({
          operation: "aiSearchReading",
          model: answer.model,
          tokenCount: answer.tokenCount,
          latencyMs: Date.now() - readStart,
          cached: false,
          description: `${web.label} reading: ${contact.name}`,
        });
        answers.push(answer.text.trim());
        readModel = answer.model;
      } catch (err) {
        // A part that fails costs its own facts, not the other parts'.
        if (signal?.aborted) throw err;
        readErrors.push(err);
      }
    }
    if (answers.length === 0) return failed(readErrors[0]);
    if (parts.length > 1)
      log.info(
        "SearchAndRead",
        `${contact.name}: read in ${parts.length} parts of up to ${size.partChars} characters; ${readErrors.length} failed`,
      );
    const text = answers.join("\n");
    const models = [web.id, readModel];
    const lines = parseFindings(text);
    if (lines.length === 0) {
      if (answers.some(isNoMatch))
        return { kind: "no-match", queries, models, text };
      return failed(
        new AppError(
          `Research read ${web.label}'s results and reported no facts. No contact fields changed. Try again.`,
          502,
          { code: webSearchCode(web, "NO_FACTS") },
        ),
      );
    }

    // Each fact's page: the address the reading names, or the first page on
    // its site.
    const readPages = [...read.map((page) => page.result), ...snippets].map(
      (result) => ({
        url: result.url,
        title: result.title.trim() || result.url,
        firstSeenAt: "",
      }),
    );
    const findings = lines.map((finding) => {
      const page = pageFor(finding.site, readPages);
      const site = siteOf(page?.url ?? finding.site ?? "") ?? finding.site;
      return {
        ...finding,
        ...(site && { site }),
        ...(page && { url: page.url }),
      };
    });
    // The pages a fact names, or, when no fact names one, the pages read
    // in full.
    const named = new Set(findings.flatMap((finding) => finding.url ?? []));
    const cited = named.size
      ? readPages.filter((page) => named.has(page.url))
      : readPages.slice(0, read.length);
    return {
      kind: "facts",
      facts: text,
      findings,
      citations: toCitations(
        cited.map((page) => ({ url: page.url, title: page.title })),
      ),
      queries,
      models,
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    return failed(err);
  }
}

export const searchAndRead: Technique = {
  name: "search-and-read",
  needs: () => [
    { what: "web-search" },
    { what: "deep", message: NEEDS_STRONG_MODEL },
  ],
  run: searchAndReadPages,
};
