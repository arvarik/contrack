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
  // stop at their own rows. The sweep runs one account at a time in that
  // account's context, so provider spend is attributed correctly. Admin only.
  router.post(
    "/dedupe/backfill-embeddings",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const rid = req.requestId;

      if (!isEmbeddingAvailable()) {
        throw new AppError(
          "No embedding model is ready — cannot generate embeddings",
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
      // Coverage the caller can act on: their own contacts and vectors. An
      // instance-wide percentage could say 98% while none of the caller's
      // contacts were embedded.
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
