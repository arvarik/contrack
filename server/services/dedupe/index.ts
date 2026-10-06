// The dedupe engine's public API.

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
  restoreSuggestion,
  markSuggestionMerged,
  getMergeLog,
  getMergedInto,
  undoSoftMerge,
  clearStaleSuggestions,
} from "./suggestions.ts";

export * from "./types.ts";
