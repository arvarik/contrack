// =============================================================================
// AI Search — Public Facade
// =============================================================================
// Single-entry-point for the AI Search subsystem. Routes import this module,
// not the internal components directly.
// =============================================================================

export { jobQueue } from "./jobQueue.ts";
export { getStrategy } from "./strategies/index.ts";
export { buildSearchPrompt } from "./promptTemplate.ts";
export { mergeSearchResult } from "./mergeEngine.ts";
export type {
  AISearchJob,
  AISearchBatch,
  AISearchJobStatus,
  AISearchErrorType,
  AISearchStrategy,
  AISearchResult,
} from "./types.ts";
