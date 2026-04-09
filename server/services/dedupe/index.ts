// =============================================================================
// Dedupe Engine — Public API
// =============================================================================

export { dedupeService } from "./engine.ts";
export { dedupeQueue } from "./jobQueue.ts";
export { backfillEmbeddings, getEmbeddingCount, isEmbeddingAvailable } from "./embeddings.ts";

export {
  storeSuggestion,
  storeSuggestions,
  getPendingSuggestions,
  getPendingCount,
  getSuggestionById,
  getSuggestionForContact,
  dismissSuggestion,
  markSuggestionMerged,
  recordMerge,
  getMergeLog,
  undoSoftMerge,
  clearStaleSuggestions,
  clearAllPendingSuggestions
} from "./suggestions.ts";

export * from "./types.ts";
