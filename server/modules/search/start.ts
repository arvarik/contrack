// The search module's start-up work, run once by its onStart after the server
// listens, when background jobs are on.

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
  // Every account's "Try asking" pool, built one account per turn of the event
  // loop, so Ask opens on a ready pool after a deploy. A request that comes
  // first builds its own.
  warmStarterQuestions().catch((err) =>
    log.warn("Server", `Starter questions failed: ${getErrorMessage(err)}`),
  );

  // Initialize search index queue to recover any ungracefully interrupted jobs
  initSearchIndexQueue();

  // Load the local embedding model, then backfill search embeddings. Nothing
  // waits on it: the server is usable meanwhile.
  initBuiltinEmbedder()
    .then(() => {
      // The cross-encoder loads on the same worker, once, so no first question
      // pays for it. Its job takes its turn beside the backfill's, and a
      // failure only logs: search keeps its fused order without it.
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
      // Dedupe shares the embeddings capability, so it runs once a backend is
      // ready: reconcile the store (rebuilding if the model changed), then fill
      // any gaps, so a partial index repairs itself.
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
