import { Router } from "express";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { log } from "../../utils/logger.ts";
import {
  backfillEmbeddings,
  getEmbeddingCount,
  isEmbeddingAvailable,
} from "../../services/dedupe/index.ts";
import { scopeOf } from "../../tenancy/scope.ts";
import { requireAdmin } from "../../middleware/auth.ts";
import { sqlite } from "../../db.ts";
import { getErrorMessage } from "../../utils/helpers.ts";

export function registerEmbeddingRoutes(router: Router) {
  // Instance-wide on purpose: an operator repairing the dedupe index must not
  // stop at their own rows. Sub-phase 2h made the sweep behind it run one
  // account at a time inside that account's context, so it still covers the
  // instance and the provider spend is attributed as well. Phase 3 put the
  // admin gate in front of it, which is what the manifest class has meant
  // since Phase 2.
  router.post(
    "/dedupe/backfill-embeddings",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const rid = req.requestId;

      if (!isEmbeddingAvailable()) {
        throw new AppError(
          "Gemini API key not configured — cannot generate embeddings",
          503,
        );
      }

      log.info(
        "API",
        `[${rid}] POST /api/dedupe/backfill-embeddings → Starting backfill`,
      );

      backfillEmbeddings((done, total, phase) => {
        log.debug(
          "API",
          `[${rid}] Embedding backfill: ${phase} (${done}/${total})`,
        );
      }).catch((err) => {
        log.error(
          "API",
          `[${rid}] Embedding backfill failed: ${getErrorMessage(err)}`,
        );
      });

      res.json({ started: true });
    }),
  );

  router.get(
    "/dedupe/embedding-status",
    asyncHandler(async (req, res) => {
      // Coverage the caller can act on: their own contacts and their own
      // vectors. An instance-wide percentage told a new account its index was
      // 98% complete while none of its own contacts were embedded at all.
      const scope = scopeOf(req);
      const embedded = getEmbeddingCount(scope);
      const total = (
        sqlite
          .prepare(
            `SELECT COUNT(*) AS cnt FROM contacts
              WHERE ownerId = ? AND isGhost = 0
                AND (isArchived = 0 OR isArchived IS NULL) AND canonicalId IS NULL`,
          )
          .get(scope.ownerId) as { cnt: number }
      ).cnt;

      res.json({
        embedded,
        total,
        missing: total - embedded,
        coverage: total > 0 ? Math.round((embedded / total) * 100) : 0,
      });
    }),
  );
}
