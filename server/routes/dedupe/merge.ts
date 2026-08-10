import { Router } from "express";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { log } from "../../utils/logger.ts";
import {
  dedupeService,
  clearStaleSuggestions,
} from "../../services/dedupe/index.ts";
import { getErrorMessage } from "../../utils/helpers.ts";

export function registerMergeRoutes(router: Router) {
  router.post(
    "/contacts/merge",
    asyncHandler(async (req, res) => {
      const rid = req.requestId;
      const { primaryId, duplicateId } = req.body;

      if (!primaryId || !duplicateId) {
        throw new AppError("primaryId and duplicateId are required", 400);
      }
      if (primaryId === duplicateId) {
        throw new AppError("Cannot merge a contact with itself", 400);
      }

      const merged = dedupeService.mergeContacts(primaryId, duplicateId, rid);
      log.info(
        "API",
        `[${rid}] POST /api/contacts/merge → merged ${duplicateId} into ${primaryId}`,
      );
      res.json({ success: true, contact: merged });
    }),
  );

  router.post(
    "/contacts/merge-batch",
    asyncHandler(async (req, res) => {
      const rid = req.requestId;
      const { merges } = req.body;

      if (!Array.isArray(merges) || merges.length === 0) {
        throw new AppError(
          "merges array is required and must not be empty",
          400,
        );
      }

      if (merges.length > 250) {
        throw new AppError("Maximum 250 merges per batch", 400);
      }

      const results: {
        primaryId: string;
        duplicateId: string;
        success: boolean;
        error?: string;
      }[] = [];

      for (const { primaryId, duplicateId } of merges) {
        if (!primaryId || !duplicateId || primaryId === duplicateId) {
          results.push({
            primaryId,
            duplicateId,
            success: false,
            error: "Invalid merge pair",
          });
          continue;
        }
        try {
          dedupeService.mergeContacts(primaryId, duplicateId, rid);
          results.push({ primaryId, duplicateId, success: true });
        } catch (err: unknown) {
          results.push({
            primaryId,
            duplicateId,
            success: false,
            error: getErrorMessage(err),
          });
        }
      }

      const succeeded = results.filter((r) => r.success).length;
      // Merging tombstones contacts, which can strand OTHER pending
      // suggestions that reference them. Clear them now, exactly as a scan
      // does, so the review queue never shows a pair that can no longer merge.
      if (succeeded > 0) clearStaleSuggestions();
      log.info(
        "API",
        `[${rid}] POST /api/contacts/merge-batch → ${succeeded}/${merges.length} merged`,
      );
      res.json({ results, succeeded, total: merges.length });
    }),
  );

  router.post(
    "/contacts/merge-cluster",
    asyncHandler(async (req, res) => {
      const rid = req.requestId;
      const { primaryId, duplicateIds } = req.body;

      if (
        !primaryId ||
        !Array.isArray(duplicateIds) ||
        duplicateIds.length === 0
      ) {
        throw new AppError("primaryId and duplicateIds[] are required", 400);
      }
      if (duplicateIds.includes(primaryId)) {
        throw new AppError("primaryId cannot appear in duplicateIds", 400);
      }
      if (duplicateIds.length > 10) {
        throw new AppError("Maximum 10 duplicates per cluster merge", 400);
      }

      let merged = 0;
      let failed = 0;
      let lastResult: ReturnType<typeof dedupeService.mergeContacts> | null =
        null;

      for (const dupId of duplicateIds) {
        try {
          lastResult = dedupeService.mergeContacts(primaryId, dupId, rid);
          merged++;
        } catch (err: unknown) {
          log.warn(
            "API",
            `[${rid}] Cluster merge: skipping ${dupId}: ${getErrorMessage(err)}`,
          );
          failed++;
        }
      }

      // Resolve the pending suggestions this merge just satisfied (and any
      // others stranded by the tombstones) — otherwise the review queue keeps
      // offering pairs whose contacts no longer exist as separate rows.
      if (merged > 0) clearStaleSuggestions();
      log.info(
        "API",
        `[${rid}] POST /api/contacts/merge-cluster → merged ${merged}/${duplicateIds.length} into ${primaryId}`,
      );
      res.json({ success: merged > 0, merged, failed, contact: lastResult });
    }),
  );

  router.post(
    "/contacts/merge-clusters",
    asyncHandler(async (req, res) => {
      const rid = req.requestId;
      const { clusters } = req.body;

      if (!Array.isArray(clusters) || clusters.length === 0) {
        throw new AppError(
          "clusters array is required and must not be empty",
          400,
        );
      }

      const totalOps = clusters.reduce(
        (sum: number, c: { duplicateIds?: unknown[] }) =>
          sum + (c.duplicateIds?.length ?? 0),
        0,
      );
      if (totalOps > 250) {
        throw new AppError("Maximum 250 total merge operations per batch", 400);
      }

      const results: { primaryId: string; merged: number; failed: number }[] =
        [];
      let totalMerged = 0;
      let totalFailed = 0;

      for (const { primaryId, duplicateIds } of clusters) {
        if (
          !primaryId ||
          !Array.isArray(duplicateIds) ||
          duplicateIds.length === 0
        ) {
          results.push({
            primaryId: primaryId ?? "unknown",
            merged: 0,
            failed: duplicateIds?.length ?? 0,
          });
          totalFailed += duplicateIds?.length ?? 0;
          continue;
        }

        let merged = 0;
        let failed = 0;

        for (const dupId of duplicateIds) {
          try {
            dedupeService.mergeContacts(primaryId, dupId, rid);
            merged++;
          } catch (err: unknown) {
            log.warn(
              "API",
              `[${rid}] Bulk cluster merge: skipping ${dupId}: ${getErrorMessage(err)}`,
            );
            failed++;
          }
        }

        results.push({ primaryId, merged, failed });
        totalMerged += merged;
        totalFailed += failed;
      }

      // Same stale-suggestion cleanup as the single-cluster route.
      if (totalMerged > 0) clearStaleSuggestions();
      log.info(
        "API",
        `[${rid}] POST /api/contacts/merge-clusters → ${totalMerged} merged, ${totalFailed} failed across ${clusters.length} clusters`,
      );
      res.json({ results, totalMerged, totalFailed });
    }),
  );
}
