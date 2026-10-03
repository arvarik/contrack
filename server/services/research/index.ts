// =============================================================================
// Research — the layer that runs contact research
// =============================================================================
// Contact research (Enrich) searches the web for one contact and fills empty
// fields with sourced facts. Every research request comes here: the batch
// queue (`aiSearch/jobQueue.ts`), the one-contact route
// (`POST /api/contacts/:id/enrich`), and auto-enrichment through the queue.
//
//   research()         one run: a technique's evidence, then one extraction
//   chooseResearch()   the technique and web search a start runs with
//   researchChoiceSchema  the two choices, as a route body holds them
//   toAISearchResult() the result as the merge and the research record read it
//
// Two ports, each a registry with a set* seam for tests, as the embedder and
// the reranker have (`server/ai/embedder.ts`, `server/ai/reranker.ts`):
//
//   Technique  how a run finds facts (`techniques.ts`, `setTechnique`)
//   WebSearch  a search service (`webSearch.ts`, `setWebSearch`)
// =============================================================================

import type { AISearchResult } from "../aiSearch/types.ts";
import type { ResearchResult } from "./types.ts";

export { isRefusal, research, RESEARCH_TIMEOUT_MS } from "./research.ts";
export {
  chooseResearch,
  researchChoiceSchema,
  STRATEGY_CHOICE,
  strategyOf,
} from "./choice.ts";
export { setTechnique } from "./techniques.ts";
export { setWebSearch } from "./webSearch.ts";
export type {
  ResearchChoice,
  ResearchRequest,
  ResearchResult,
  Technique,
  TechniqueContext,
  WebResult,
  WebSearch,
} from "./types.ts";

/** A run's result as the merge and the research record read it. */
export function toAISearchResult(result: ResearchResult): AISearchResult {
  return {
    data: result.data,
    models: result.models,
    tokenCount: result.tokenCount,
    latencyMs: result.latencyMs,
    citations: result.citations,
    findings: result.findings,
    searchQueries: result.queries,
    outcome: result.outcome,
    depth: result.depth,
    usage: result.usage,
  };
}
