// =============================================================================
// Dedupe Engine — Public API
// =============================================================================

export { dedupeService } from "./engine.ts";
export { dedupeQueue } from "./jobQueue.ts";
export {
  backfillEmbeddings,
  clearOwnerEmbeddings,
  getEmbeddingCount,
  isEmbeddingAvailable,
} from "./embeddings.ts";

export {
  getPendingSuggestions,
  getPendingCount,
  getPendingClusterCount,
  getSuggestionById,
  getSuggestionForContact,
  dismissSuggestion,
  markSuggestionMerged,
  getMergeLog,
  undoSoftMerge,
  clearStaleSuggestions,
} from "./suggestions.ts";

export * from "./types.ts";
