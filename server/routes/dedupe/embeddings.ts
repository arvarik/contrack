import { Router } from "express";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { log } from "../../utils/logger.ts";
import { backfillEmbeddings, getEmbeddingCount, isEmbeddingAvailable } from "../../services/dedupe/index.ts";
import { sqlite } from "../../db.ts";
import { getErrorMessage } from "../../utils/helpers.ts";

export function registerEmbeddingRoutes(router: Router) {
  router.post("/dedupe/backfill-embeddings", asyncHandler(async (req, res) => {
    const rid = (req as any).requestId;

    if (!isEmbeddingAvailable()) {
      throw new AppError("Gemini API key not configured — cannot generate embeddings", 503);
    }

    log.info("API", `[${rid}] POST /api/dedupe/backfill-embeddings → Starting backfill`);

    backfillEmbeddings((done, total, phase) => {
      log.debug("API", `[${rid}] Embedding backfill: ${phase} (${done}/${total})`);
    }).catch(err => {
      log.error("API", `[${rid}] Embedding backfill failed: ${getErrorMessage(err)}`);
    });

    res.json({ started: true });
  }));

  router.get("/dedupe/embedding-status", asyncHandler(async (_req, res) => {
    const embedded = getEmbeddingCount();
    const total = (sqlite.prepare(
      "SELECT COUNT(*) AS cnt FROM contacts WHERE isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL) AND canonicalId IS NULL"
    ).get() as any).cnt;

    res.json({
      embedded,
      total,
      missing: total - embedded,
      coverage: total > 0 ? Math.round((embedded / total) * 100) : 0,
    });
  }));
}
