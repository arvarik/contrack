// =============================================================================
// AI Search — SearXNG Strategy (self-hosted search)
// =============================================================================
// Replaces provider-native search grounding with a self-hosted SearXNG
// metasearch instance. It runs the searches itself, so research does not
// wait on a model's choice to search, and it works with a purely local
// stack (an Ollama or vLLM chat model with SearXNG).
//
// Pass 1 — Retrieval: query SearXNG's JSON API with the searches the provider
//          research would run, then fetch the result pages that name the
//          person and reduce them to text. No model involved.
//          Reading: the "deep" model reads the pages and the other results'
//          snippets into fact lines, with the search pass's rules and form
//          (`buildReadingPrompt`), so each fact keeps its page.
// Pass 2 — Extraction: the quick model, or the deep one on a stack without
//          one, reads the fact lines into the output schema.
//
// `searxngEvidence` runs pass 1, and the combined strategy runs it beside the
// research model's own search.
//
// Web pages are hostile input by construction: every fetch goes through the
// shared SSRF guards, responses are size-capped, and the text is fenced with
// wrapUntrusted() before it ever reaches a prompt.
// =============================================================================

import * as cheerio from "cheerio/slim";
import { generateFor } from "../../../ai/gateway.ts";
import { isResearchOff, resolveCapability } from "../../../ai/capabilities.ts";
import { toCitations } from "../../../ai/citations.ts";
import type { HydratedContact } from "../../../repositories/types.ts";
import type {
  AISearchStrategy,
  AISearchResult,
  ResearchOptions,
} from "../types.ts";
import {
  buildReadingPrompt,
  formalName,
  isNoMatch,
  otherNameForms,
  parseFindings,
  searchName,
  suggestedSearches,
} from "../promptTemplate.ts";
import { recordInvocation } from "../../aiStatsService.ts";
import { safeFetch, readBodyCapped } from "../../../utils/urlSafety.ts";
import { log } from "../../../utils/logger.ts";
import { getErrorMessage } from "../../../utils/helpers.ts";
import { AppError } from "../../../utils/AppError.ts";
import {
  DEFAULT_RESEARCH_DEPTH,
  type ResearchDepth,
} from "../../../../shared/researchDepth.ts";
import { sourceForSite } from "../../../../shared/researchRecord.ts";
import {
  createMeter,
  extractFacts,
  foundResult,
  noMatchResult,
  type Meter,
  type SourceOutcome,
} from "./evidence.ts";

/** Searches run, and result pages read in full, at each depth. */
const SEARXNG_LIMITS: Record<
  ResearchDepth,
  { queries: number; pages: number }
> = {
  standard: { queries: 3, pages: 5 },
  deep: { queries: 6, pages: 10 },
};
/** Characters of extracted text kept per page. */
const MAX_PAGE_CHARS = 6_000;
/** Results read by their snippet alone, beside the pages read in full. */
const MAX_SNIPPETS = 20;

interface SearxngResult {
  title?: string;
  url?: string;
  content?: string;
}

import { getSearxngUrl } from "../../integrationSettings.ts";
export { getSearxngUrl };

/** Query SearXNG's JSON API. */
async function searxngSearch(
  baseUrl: string,
  query: string,
  signal?: AbortSignal,
): Promise<SearxngResult[]> {
  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("safesearch", "0");

  // The SearXNG instance itself is operator-configured (often a private
  // address), so it deliberately bypasses the public-URL guard that applies
  // to the *result* pages below.
  const response = await fetch(url, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new AppError(
      `SearXNG returned ${response.status} ${response.statusText}`,
      502,
      { code: "SEARXNG_ERROR" },
    );
  }
  const body = JSON.parse(await readBodyCapped(response, signal)) as {
    results?: SearxngResult[];
  };
  return body.results ?? [];
}

/** Fetch a result page and reduce it to readable text. */
async function fetchPageText(
  pageUrl: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const { response } = await safeFetch(pageUrl, { timeoutMs: 8_000, signal });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
      return null;
    }
    return pageText(await readBodyCapped(response, signal));
  } catch (err) {
    log.debug("SearxngStrategy", `Skipped ${pageUrl}: ${getErrorMessage(err)}`);
    return null;
  }
}

/**
 * The readable text of a fetched page, without scripts, styles and page
 * chrome, cut to MAX_PAGE_CHARS.
 *
 * cheerio/slim parses with htmlparser2, which adds no <body> to a fragment
 * or a text/plain answer the way a browser's parser does. So the whole
 * document is read when it has no body element, with the head and title
 * removed first.
 */
export function pageText(html: string): string | null {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, noscript, svg, head, title").remove();
  const body = $("body");
  const raw = body.length > 0 ? body.text() : $.root().text();
  const text = raw.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, MAX_PAGE_CHARS) : null;
}

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
function namesPerson(result: SearxngResult, names: string[][]): boolean {
  const words = new Set(
    wordsOf(`${result.title ?? ""} ${result.content ?? ""}`),
  );
  return names.some((name) => name.every((word) => words.has(word)));
}

/** One page or snippet as the reading ask sees it. */
const block = (result: SearxngResult, text: string | null | undefined) =>
  `SOURCE: ${result.url}\nTITLE: ${result.title ?? ""}\n${(text ?? "").trim()}`;

/**
 * Pass 1 with SearXNG: search, read the pages, and write fact lines.
 *
 * It never throws for what it found. It says what came of it: fact lines
 * with their pages, a no-match after SearXNG returned results, or the error
 * that explains why there is neither. Only a cancelled job throws.
 *
 * - The searches are the provider research's own (`suggestedSearches`): 3 at
 *   Standard, 6 at Deep, all at once.
 * - Results are taken in turn from each search, so one search cannot fill
 *   every slot. Only the results whose title or snippet names the person are
 *   read: up to 5 pages in full at Standard and 10 at Deep, and up to 20
 *   more by their snippet. When none names the person, the reading sees the
 *   first snippets and says whether any is about them.
 * - SearXNG's searches are not billed, so the meter counts the reading's
 *   tokens and no search.
 */
export async function searxngEvidence(
  contact: HydratedContact,
  signal: AbortSignal | undefined,
  options: ResearchOptions,
  meter: Meter,
): Promise<SourceOutcome> {
  const failed = (error: unknown): SourceOutcome => ({
    kind: "failed",
    error,
  });
  try {
    // Read at each contact, so a batch that started before an admin turned
    // research off searches no further.
    if (isResearchOff())
      return failed(
        new AppError("Contact research is off", 503, { code: "RESEARCH_OFF" }),
      );
    const baseUrl = getSearxngUrl();
    if (!baseUrl)
      return failed(
        new AppError("No SearXNG instance is configured", 503, {
          code: "SEARXNG_NOT_CONFIGURED",
        }),
      );
    const startMs = Date.now();
    const limits = SEARXNG_LIMITS[options.depth ?? DEFAULT_RESEARCH_DEPTH];

    // ── Retrieval (no model) ────────────────────────────────────────────
    const queries = suggestedSearches(contact).slice(0, limits.queries);
    const errors: unknown[] = [];
    const lists = await Promise.all(
      queries.map(async (query) => {
        try {
          return await searxngSearch(baseUrl, query, signal);
        } catch (err) {
          signal?.throwIfAborted();
          errors.push(err);
          log.warn(
            "SearxngStrategy",
            `Search failed for "${query}": ${getErrorMessage(err)}`,
          );
          return [];
        }
      }),
    );
    const seen = new Set<string>();
    const results = interleave(lists).filter((result) => {
      if (!result.url || !/^https?:\/\//i.test(result.url)) return false;
      if (seen.has(result.url)) return false;
      seen.add(result.url);
      return true;
    });
    // Every search failed: SearXNG's own answer says why, such as the 403 of
    // an instance whose settings.yml leaves json out of search.formats.
    if (errors.length > 0 && errors.length === queries.length)
      return failed(
        errors[0] instanceof AppError
          ? errors[0]
          : new AppError(
              `SearXNG did not answer: ${getErrorMessage(errors[0])}`,
              502,
              { code: "SEARXNG_ERROR" },
            ),
      );
    if (results.length === 0)
      return failed(
        new AppError(
          "SearXNG returned no usable results for this contact",
          502,
          { code: "SEARXNG_NO_RESULTS" },
        ),
      );
    const names = personNames(contact);
    const naming = results.filter((result) => namesPerson(result, names));
    const pages = naming.slice(0, limits.pages);
    const snippets = (naming.length > 0 ? naming.slice(limits.pages) : results)
      .filter((result) => result.content?.trim())
      .slice(0, MAX_SNIPPETS);
    // Every page at once. A page that cannot be read keeps its snippet.
    const texts = await Promise.all(
      pages.map((result) => fetchPageText(result.url!, signal)),
    );
    signal?.throwIfAborted();
    // The pages read in full come first. Ten pages at Deep can fill the
    // reading's cap alone, and the cap cuts from the end, so it cuts
    // snippets before a page.
    const documents = [
      ...pages.map((result, index) =>
        block(result, texts[index] ?? result.content),
      ),
      ...snippets.map((result) => block(result, result.content)),
    ];
    log.info(
      "SearxngStrategy",
      `${contact.name}: ${results.length} results from ${queries.length} searches, ${naming.length} name the person; read ${texts.filter(Boolean).length} of ${pages.length} pages in ${Date.now() - startMs}ms`,
    );

    // ── Reading (pages → fact lines) ────────────────────────────────────
    const readStart = Date.now();
    const read = await generateFor("deep", {
      prompt: buildReadingPrompt(contact, documents.join("\n\n---\n\n")),
      responseFormat: "text",
      signal,
      timeoutMs: 90_000,
      maxOutputTokens: 8_192,
    });
    signal?.throwIfAborted();
    meter.count(read);
    recordInvocation({
      operation: "aiSearchReading",
      model: read.model,
      tokenCount: read.tokenCount,
      latencyMs: Date.now() - readStart,
      cached: false,
      description: `SearXNG reading: ${contact.name}`,
    });
    const models = ["searxng", read.model];
    const lines = parseFindings(read.text);
    if (lines.length === 0) {
      if (isNoMatch(read.text))
        return { kind: "no-match", queries, models, text: read.text.trim() };
      return failed(
        new AppError(
          "Research read SearXNG's results and reported no facts. No contact fields changed. Try again.",
          502,
          { code: "SEARXNG_NO_FACTS" },
        ),
      );
    }

    // Each fact's page: the one its site names.
    const readPages = [...pages, ...snippets].map((result) => ({
      url: result.url!,
      title: result.title?.trim() || result.url!,
      firstSeenAt: "",
    }));
    const findings = lines.map((finding) => {
      const page = sourceForSite(finding.site, readPages);
      return page ? { ...finding, url: page.url } : finding;
    });
    // The pages a fact names, or, when no fact names one, the pages read
    // in full.
    const named = new Set(findings.flatMap((finding) => finding.url ?? []));
    const cited = named.size
      ? readPages.filter((page) => named.has(page.url))
      : readPages.slice(0, pages.length);
    return {
      kind: "facts",
      facts: read.text.trim(),
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

export class SearxngStrategy implements AISearchStrategy {
  readonly name = "searxng";

  async execute(
    contact: HydratedContact,
    _prompt: string,
    signal?: AbortSignal,
    options: ResearchOptions = {},
  ): Promise<AISearchResult> {
    signal?.throwIfAborted();
    const startMs = Date.now();
    const depth = options.depth ?? DEFAULT_RESEARCH_DEPTH;
    const meter = createMeter();
    const found = await searxngEvidence(
      contact,
      signal,
      { ...options, depth },
      meter,
    );
    if (found.kind === "failed") throw found.error;
    if (found.kind === "no-match")
      return noMatchResult([found], meter, depth, startMs);
    // A stack with SearXNG and one local model may have no quick model.
    const read = await extractFacts(
      contact,
      found.facts,
      signal,
      meter,
      resolveCapability("quick") ? "quick" : "deep",
      "SearxngStrategy",
    );
    return foundResult([found], read, meter, depth, startMs);
  }
}
