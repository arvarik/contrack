// =============================================================================
// Research — one run for one contact
// =============================================================================
// `research()` runs every research request: the batch queue's jobs, the
// one-contact route, and auto-enrichment through the queue. No other code
// calls a technique.
//
//   1. The request's technique finds facts (`Technique.run`), with the web
//      search the request chose.
//   2. The one extraction reads the facts into fields (`extractFacts`).
//   3. The result has the same fields for every technique.
//
// Every model call and every web search asks the AI switches first: the
// instance switch, the account's own switch, and research that an admin
// turned off. A model call asks again when it gets its slot in the AI work
// queue. A refusal stops the whole run for this contact, the calls in flight
// too, so nothing more of the contact reaches a model or a search service
// once a switch says no. The batch queue then stops the account's batch
// (`isRefusal`).
// =============================================================================

import { generateFor } from "../../ai/gateway.ts";
import { isResearchOff } from "../../ai/capabilities.ts";
import {
  aiAllowedForUser,
  isAiOffForInstance,
} from "../../ai/instanceSwitch.ts";
import { withTimeout } from "../../ai/resilience.ts";
import { AppError } from "../../utils/AppError.ts";
import { log } from "../../utils/logger.ts";
import { getPreferences } from "../userPreferencesService.ts";
import type { ResearchDepth } from "../../../shared/researchDepth.ts";
import { createMeter, foundResult, noMatchResult } from "./evidence.ts";
import { extractFacts } from "./extract.ts";
import { chooseResearch } from "./choice.ts";
import { searchesWeb, techniqueNamed } from "./techniques.ts";
import { DEFAULT_WEB_SEARCH, webSearchNamed } from "./webSearch.ts";
import type {
  ResearchRequest,
  ResearchResult,
  TechniqueContext,
  WebSearch,
} from "./types.ts";

/**
 * Time allowed for one contact, by depth: the first asks, the two that
 * follow them at once when none cites a page, and the extraction. A search
 * ask took from 15 s to more than 80 s, and one that returned nothing took
 * as long (2026-09-26). Three asks one after the other ran past 240 s; two
 * rounds stay inside it. A deep run's ask at thinking "high" can take the
 * whole 120 s an ask has, hence its minute more.
 */
export const RESEARCH_TIMEOUT_MS: Record<ResearchDepth, number> = {
  standard: 240_000,
  deep: 300_000,
};

/** The codes a run refuses with when an AI switch says no. */
const REFUSALS = new Set([
  "AI_OFF_FOR_INSTANCE",
  "AI_OFF_FOR_ACCOUNT",
  "RESEARCH_OFF",
]);

/**
 * True when `err` is a switch's refusal. It holds for every contact of the
 * account until somebody turns the switch back on.
 */
export function isRefusal(err: unknown): boolean {
  return REFUSALS.has((err as { code?: unknown } | null)?.code as string);
}

/**
 * Why research may not call a model or a web search for this account now,
 * or null when it may. The instance comes first: the account switch cannot
 * turn AI back on.
 */
function refusalFor(ownerId: string): AppError | null {
  if (isAiOffForInstance())
    return new AppError("An admin turned AI off for this instance", 503, {
      code: "AI_OFF_FOR_INSTANCE",
    });
  if (!aiAllowedForUser(ownerId))
    return new AppError("AI is off for this account", 403, {
      code: "AI_OFF_FOR_ACCOUNT",
    });
  if (isResearchOff())
    return new AppError("Contact research is off", 503, {
      code: "RESEARCH_OFF",
    });
  return null;
}

/**
 * Research one contact.
 *
 * @param request - The contact, how to research it, and who owns it. A
 *   technique or web search it leaves out is the account's default
 *   (`chooseResearch`).
 * @returns What the run found, with every field, for every technique.
 * @throws AppError 400 for an unknown technique or web search, the
 *   refusal of an AI switch, the timeout, the cancellation, or the error
 *   of a technique that found neither facts nor a no-match.
 */
export async function research(
  request: ResearchRequest,
): Promise<ResearchResult> {
  request.signal?.throwIfAborted();
  const { scope, depth } = request;
  const choice = request.technique
    ? { technique: request.technique, webSearch: request.webSearch }
    : chooseResearch(
        { webSearch: request.webSearch },
        getPreferences(scope.ownerId).webSearchEngine,
      );
  const technique = techniqueNamed(choice.technique);
  const web = searchesWeb(technique)
    ? webSearchNamed(choice.webSearch ?? DEFAULT_WEB_SEARCH)
    : null;
  const timeoutMs = request.timeoutMs ?? RESEARCH_TIMEOUT_MS[depth];
  const startMs = Date.now();
  const meter = createMeter();

  // Aborted with the refusal, so the calls in flight stop with it, and a
  // technique that keeps a failed call's error rethrows it instead.
  const refused = new AbortController();
  const ask = () => {
    const refusal = refusalFor(scope.ownerId);
    if (refusal) {
      refused.abort(refusal);
      throw refusal;
    }
  };

  return withTimeout(
    async (deadline) => {
      const signal = AbortSignal.any([deadline, refused.signal]);
      // Every call stops with the run, whatever signal the technique passes:
      // a narrower one of its own, as combined does, or none.
      const bounded = (own?: AbortSignal) =>
        own ? AbortSignal.any([own, signal]) : signal;
      // A model call is asked twice: before it joins the AI work queue, and
      // again when it gets its slot there, which can be minutes later.
      const ctx: TechniqueContext = {
        meter,
        generate: async (capability, options) => {
          ask();
          return generateFor(capability, {
            ...options,
            signal: bounded(options.signal),
            beforeSend: ask,
          });
        },
        webSearch: web && guarded(web, ask, bounded),
      };
      const run: ResearchRequest = { ...request, signal, timeoutMs };
      const outcome = await technique.run(run, ctx);
      signal.throwIfAborted();
      if (outcome.kind === "failed") throw outcome.error;
      if (outcome.kind === "no-match")
        return noMatchResult(outcome, meter, depth, startMs);
      const read = await extractFacts(run, outcome.facts, ctx, technique.name);
      log.info(
        "Research",
        `${request.contact.id} (${technique.name}, ${depth}): read by ${read.model} in ${read.latencyMs}ms; ${meter.usage.calls} calls, ${meter.usage.searches} searches`,
      );
      return foundResult(outcome, read, meter, depth, startMs);
    },
    timeoutMs,
    request.signal,
  );
}

/** `web`, asking `ask` before every search, and stopping with the run. */
function guarded(
  web: WebSearch,
  ask: () => void,
  bounded: (own?: AbortSignal) => AbortSignal,
): WebSearch {
  return {
    id: web.id,
    label: web.label,
    configured: () => web.configured(),
    search: async (query, options) => {
      ask();
      return web.search(query, { ...options, signal: bounded(options.signal) });
    },
  };
}
