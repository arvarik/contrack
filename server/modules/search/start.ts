// =============================================================================
// Search: start-up work
// =============================================================================
// Moved from server.ts as it was. The search module's onStart runs it once,
// after the server listens, when background jobs are on.
// =============================================================================

import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import { warmStarterQuestions } from "../../services/search/starterQuestions.ts";
import { initSearchIndexQueue } from "../../services/search/indexQueue.ts";
import { initBuiltinEmbedder } from "../../ai/embedder.ts";
import { initCrossEncoder } from "../../ai/reranker.ts";
import {
  backfillSearchEmbeddings,
  ensureEmbeddingStore,
} from "../../services/search/vectorIndex.ts";
import {
  backfillEmbeddings,
  ensureDedupeEmbeddingStore,
} from "../../services/dedupe/embeddings.ts";

/** The starter questions, the index queue, the local model and the backfills. */
export function startSearch(): void {
  // ── Ask Contrack starter questions ───────────────────────────────────────
  // Every account's pool of "Try asking" questions, built one account per
  // turn of the event loop, so the first open of Ask after a deploy reads
  // a pool that is ready. A request that comes first builds its own.
  warmStarterQuestions().catch((err) =>
    log.warn("Server", `Starter questions failed: ${getErrorMessage(err)}`),
  );

  // Initialize search index queue to recover any ungracefully interrupted jobs
  initSearchIndexQueue();

  // ── Local embedding model for Ask Contrack v3 ───────────────────────────
  // Load the Transformers.js model, then backfill search embeddings.
  // Non-blocking — the server is fully usable while this runs.
  initBuiltinEmbedder()
    .then(() => {
      // The search cross-encoder loads on the same worker, once, so no
      // person's first question pays for it. Its job takes its turn beside
      // the backfill's, and a failure only logs: search keeps its fused
      // order without it.
      void initCrossEncoder();
      log.info(
        "Server",
        "Local embedding model ready — starting search embedding backfill...",
      );
      // Reconcile the vector store with the configured embeddings capability
      // (rebuilds + re-embeds when the model changed), then fill any gaps.
      return ensureEmbeddingStore().then(() => backfillSearchEmbeddings());
    })
    .then((count) => {
      if (count > 0)
        log.info(
          "Server",
          `Search embedding backfill complete: ${count} contacts embedded locally`,
        );
      initSearchIndexQueue();
      // Dedupe shares the embeddings capability, so it can only run once a
      // backend is ready. Reconcile it (rebuilding if the model changed) and
      // fill any gaps — previously this only ran when the store was entirely
      // empty, so a partial index could never repair itself.
      return ensureDedupeEmbeddingStore().then(() => backfillEmbeddings());
    })
    .then((count) => {
      if (count > 0)
        log.info(
          "Server",
          `Dedupe embedding backfill complete: ${count} contacts embedded`,
        );
    })
    .catch((err) => {
      log.warn("Server", `Embedding init/backfill failed: ${err.message}`);
      // The backfill persists unfinished jobs before it calls the embedding model.
      initSearchIndexQueue();
    });
}
