// =============================================================================
// AI Search — Evidence: what one web search found, in one shape
// =============================================================================
// Research can search the web two ways: with the research model's own search
// tool (two-pass) and with a self-hosted SearXNG. Each source ends in fact
// lines with their pages, and the combined strategy reads the lines of both.
// This module holds what the strategies share:
//
//   createMeter    what a run spends, counted over every call
//   contextWindowFor  the window of the model a call goes to, when small
//   SourceOutcome  what one source came back with: facts, a no-match after
//                  a search, or the reason it has neither
//   extractFacts   the second pass: fact lines into the output schema
//   foundResult    the result of a run that found facts, from its sources
//   noMatchResult  the result of a run that searched and matched nobody
// =============================================================================

import { generateFor, type AIGenerateResult } from "../../../ai/gateway.ts";
import { resolveCapability } from "../../../ai/capabilities.ts";
import { getCachedModels } from "../../../ai/providerRegistry.ts";
import type { HydratedContact } from "../../../repositories/types.ts";
import type { AISearchResult } from "../types.ts";
import {
  buildExtractionPrompt,
  extractionJsonSchema,
  mergeFindings,
  parseExtraction,
  tidyExtraction,
} from "../promptTemplate.ts";
import { recordInvocation } from "../../aiStatsService.ts";
import { log } from "../../../utils/logger.ts";
import { getErrorMessage } from "../../../utils/helpers.ts";
import type {
  ResearchFinding,
  ResearchUsage,
} from "../../../../shared/researchRecord.ts";
import type { ResearchDepth } from "../../../../shared/researchDepth.ts";

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

/** The capability that reads fact lines into fields. */
type ReadingCapability = "quick" | "deep";

/**
 * Read fact lines into the output schema: the second pass of every
 * strategy. No searching: the facts are already on the page.
 *
 * Field by field: a value that fails its schema is left out, and the rest of
 * the answer is kept. The rules a model follows only some of the time are
 * applied in code (`tidyExtraction`).
 *
 * @param capability - "quick" for two-pass and combined research, whose
 *   quick model has read research since 2026-09-26. SearXNG research reads
 *   with "deep" when the instance has no quick model.
 * @param label - The strategy's name, for the log.
 */
export async function extractFacts(
  contact: HydratedContact,
  facts: string,
  signal: AbortSignal | undefined,
  meter: Meter,
  capability: ReadingCapability,
  label: string,
): Promise<{
  data: Record<string, unknown>;
  model: string;
  latencyMs: number;
}> {
  const startMs = Date.now();
  const prompt = buildExtractionPrompt(contact, facts);
  // A small window holds the prompt and what is left for the answer. A
  // server such as vLLM refuses a call whose prompt and answer exceed it.
  const window = contextWindowFor(capability);
  const result = await generateFor(capability, {
    prompt,
    responseFormat: "json",
    jsonSchema: extractionJsonSchema,
    signal,
    timeoutMs: 30_000,
    maxOutputTokens: window
      ? Math.max(
          512,
          Math.min(6_000, window - Math.ceil(prompt.length / CHARS_PER_TOKEN)),
        )
      : 6_000,
  });
  signal?.throwIfAborted();
  meter.count(result);
  recordInvocation({
    operation: "aiSearchExtraction",
    model: result.model,
    tokenCount: result.tokenCount,
    latencyMs: Date.now() - startMs,
    cached: false,
    description: `AI Search extraction: ${contact.name}`,
  });

  let raw: unknown;
  try {
    raw = JSON.parse(result.text || "{}");
  } catch (parseErr: unknown) {
    throw new Error(
      `JSON parse failed for extraction output: ${getErrorMessage(parseErr)}. `,
    );
  }
  const { data, dropped } = parseExtraction(raw);
  if (dropped.length > 0)
    log.warn(
      label,
      `${contact.name}: ${result.model} wrote values the schema refused; left out: ${dropped.join(", ")}`,
    );
  return {
    data: tidyExtraction(data, contact) as Record<string, unknown>,
    model: result.model,
    latencyMs: result.latencyMs,
  };
}

/**
 * The result of a run that found facts, from every source that gave some:
 * their pages each once, their findings merged, and their searches.
 */
export function foundResult(
  sources: readonly Evidence[],
  read: { data: Record<string, unknown>; model: string },
  meter: Meter,
  depth: ResearchDepth,
  startMs: number,
): AISearchResult {
  const seen = new Set<string>();
  const citations = sources
    .flatMap((source) => source.citations)
    .filter((citation) => {
      if (seen.has(citation.uri)) return false;
      seen.add(citation.uri);
      return true;
    });
  return {
    data: read.data,
    models: [...sources.flatMap((source) => source.models), read.model].slice(
      0,
      4,
    ),
    tokenCount: meter.tokenCount,
    latencyMs: Date.now() - startMs,
    citations,
    groundedText: sources.map((source) => source.facts).join("\n"),
    findings: mergeFindings(sources.map((source) => source.findings)),
    searchQueries: [...new Set(sources.flatMap((source) => source.queries))],
    outcome: "found",
    depth,
    usage: meter.usage,
  };
}

/**
 * The result of a run that searched and matched no page to the person:
 * recorded on the contact as no public information, not failed.
 */
export function noMatchResult(
  noMatches: readonly NoMatch[],
  meter: Meter,
  depth: ResearchDepth,
  startMs: number,
): AISearchResult {
  return {
    data: {},
    models: noMatches.flatMap((noMatch) => noMatch.models).slice(0, 4),
    tokenCount: meter.tokenCount,
    latencyMs: Date.now() - startMs,
    citations: [],
    groundedText: noMatches.map((noMatch) => noMatch.text).join("\n"),
    findings: [],
    searchQueries: [
      ...new Set(noMatches.flatMap((noMatch) => noMatch.queries)),
    ],
    outcome: "no-public-info",
    depth,
    usage: meter.usage,
  };
}
