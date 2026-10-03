// =============================================================================
// Research — evidence: what one source found, in one shape
// =============================================================================
// A technique searches the web its own way: with the research model's search
// tool, or with a web search whose pages a model reads. Each ends in fact
// lines with their pages, and the extraction reads the lines of all. This
// module holds what the techniques share:
//
//   createMeter       what a run spends, counted over every call
//   contextWindowFor  the window of the model a call goes to, when small
//   SourceOutcome     what one source came back with: facts, a no-match after
//                     a search, or the reason it has neither
//   mergeEvidence     the facts of several sources as one
//   foundResult       the result of a run that found facts
//   noMatchResult     the result of a run that searched and matched nobody
// =============================================================================

import type { AIGenerateResult } from "../../ai/gateway.ts";
import { resolveCapability } from "../../ai/capabilities.ts";
import { getCachedModels } from "../../ai/providerRegistry.ts";
import { mergeFindings } from "../aiSearch/promptTemplate.ts";
import type {
  ResearchFinding,
  ResearchUsage,
} from "../../../shared/researchRecord.ts";
import type { ResearchDepth } from "../../../shared/researchDepth.ts";
import type { ResearchResult } from "./types.ts";

/** Characters per token, counted low, so a prompt never runs past its count. */
export const CHARS_PER_TOKEN = 3;

/**
 * The context window, in tokens, of a custom endpoint's model that reports
 * none. Ollama gives a model 4,096 on a machine without a large GPU (Ollama
 * 0.35, 2026-10-02), and its OpenAI-compatible API cannot ask for more.
 */
export const UNREPORTED_WINDOW_TOKENS = 4_096;

/**
 * The context window, in tokens, of the model a capability resolves to:
 * what its endpoint reports, or UNREPORTED_WINDOW_TOKENS for a custom
 * endpoint that reports none. A hosted provider's model holds every research
 * prompt, so it has none here unless its catalog names one.
 */
export function contextWindowFor(
  capability: "quick" | "deep",
): number | undefined {
  const resolved = resolveCapability(capability);
  if (!resolved) return undefined;
  const reported = resolved.model
    ? getCachedModels(resolved.providerId).find(
        (model) => model.id === resolved.model,
      )?.contextWindow
    : undefined;
  if (reported) return reported;
  return resolved.providerId.startsWith("custom:")
    ? UNREPORTED_WINDOW_TOKENS
    : undefined;
}

/** What a run spends, over every call it makes. */
export interface Meter {
  readonly usage: ResearchUsage;
  /** The providers' token totals, over every call. */
  tokenCount: number;
  /** Count one call: the searches it reports and its tokens. */
  count(result: AIGenerateResult): void;
}

/**
 * A meter at zero. Every call is counted, the ones that found nothing too:
 * each is paid. A call that runs no search tool, such as reading SearXNG's
 * pages, counts its tokens and no search.
 */
export function createMeter(): Meter {
  const meter: Meter = {
    usage: { calls: 0, searches: 0, inputTokens: 0, outputTokens: 0 },
    tokenCount: 0,
    count(result) {
      meter.usage.calls += 1;
      meter.usage.searches += result.searchQueries?.length ?? 0;
      meter.usage.inputTokens += result.usage?.inputTokens ?? 0;
      meter.usage.outputTokens += result.usage?.outputTokens ?? 0;
      meter.tokenCount += result.tokenCount ?? 0;
    },
  };
  return meter;
}

/** Fact lines that one source found, with the pages behind them. */
export interface Evidence {
  kind: "facts";
  /** The fact lines, as the extraction reads them. */
  facts: string;
  /** Each fact, with the page or the site that states it. */
  findings: ResearchFinding[];
  /** The pages the source read, with real addresses. */
  citations: Array<{ title: string; uri: string }>;
  /** The searches that ran. */
  queries: string[];
  /** The models that wrote the lines, the one that searched first. */
  models: string[];
}

/** A source that searched, and matched no page to the person. */
export interface NoMatch {
  kind: "no-match";
  queries: string[];
  models: string[];
  /** The reply, as the model wrote it. */
  text: string;
}

/** A source that has neither facts nor a no-match: the error says why. */
export interface Failed {
  kind: "failed";
  error: unknown;
}

/** What one source came back with. */
export type SourceOutcome = Evidence | NoMatch | Failed;

/** Each page once, in the order the sources cited them. */
function eachPageOnce(
  citations: ReadonlyArray<{ title: string; uri: string }>,
): Array<{ title: string; uri: string }> {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    if (seen.has(citation.uri)) return false;
    seen.add(citation.uri);
    return true;
  });
}

/**
 * The facts of several sources as one: their lines in order, their pages
 * each once, their findings merged, and their searches.
 */
export function mergeEvidence(sources: readonly Evidence[]): Evidence {
  return {
    kind: "facts",
    facts: sources.map((source) => source.facts).join("\n"),
    findings: mergeFindings(sources.map((source) => source.findings)),
    citations: eachPageOnce(sources.flatMap((source) => source.citations)),
    queries: [...new Set(sources.flatMap((source) => source.queries))],
    models: sources.flatMap((source) => source.models),
  };
}

/** The no-matches of several sources as one. */
export function mergeNoMatches(noMatches: readonly NoMatch[]): NoMatch {
  return {
    kind: "no-match",
    queries: [...new Set(noMatches.flatMap((noMatch) => noMatch.queries))],
    models: noMatches.flatMap((noMatch) => noMatch.models),
    text: noMatches.map((noMatch) => noMatch.text).join("\n"),
  };
}

/** The result of a run that found facts, and the fields read from them. */
export function foundResult(
  evidence: Evidence,
  read: { data: Record<string, unknown>; model: string },
  meter: Meter,
  depth: ResearchDepth,
  startMs: number,
): ResearchResult {
  return {
    outcome: "found",
    data: read.data,
    findings: mergeFindings([evidence.findings]),
    citations: eachPageOnce(evidence.citations),
    queries: [...new Set(evidence.queries)],
    models: [...evidence.models, read.model].slice(0, 4),
    depth,
    usage: meter.usage,
    tokenCount: meter.tokenCount,
    latencyMs: Date.now() - startMs,
  };
}

/**
 * The result of a run that searched and matched no page to the person:
 * recorded on the contact as no public information, not failed.
 */
export function noMatchResult(
  noMatch: NoMatch,
  meter: Meter,
  depth: ResearchDepth,
  startMs: number,
): ResearchResult {
  return {
    outcome: "no-public-info",
    data: {},
    findings: [],
    citations: [],
    queries: [...new Set(noMatch.queries)],
    models: noMatch.models.slice(0, 4),
    depth,
    usage: meter.usage,
    tokenCount: meter.tokenCount,
    latencyMs: Date.now() - startMs,
  };
}
