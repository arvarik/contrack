import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { validateBody } from "../../utils/validators.ts";
import { contactRoutes } from "../../../shared/contracts/contacts.ts";
import type { z } from "zod";
import { log } from "../../utils/logger.ts";
import { dedupeService } from "../../services/dedupe/index.ts";
import { scopeOf } from "../../tenancy/scope.ts";
import { getErrorMessage } from "../../utils/helpers.ts";

export function registerMergeRoutes(router: Router) {
  router.post(
    "/contacts/merge",
    validateBody(contactRoutes.merge.body),
    asyncHandler(async (req, res) => {
      const scope = scopeOf(req);
      const rid = req.requestId;
      const { primaryId, duplicateId } = req.body as z.output<
        typeof contactRoutes.merge.body
      >;

      const { contact, mergeLogId } = dedupeService.mergeContacts(
        scope,
        primaryId,
        duplicateId,
        rid,
      );
      log.info(
        "API",
        `[${rid}] POST /api/contacts/merge → merged ${duplicateId} into ${primaryId}`,
      );
      res.json({ success: true, contact, mergeLogId });
    }),
  );

  router.post(
    "/contacts/merge-cluster",
    validateBody(contactRoutes.mergeCluster.body),
    asyncHandler(async (req, res) => {
      const scope = scopeOf(req);
      const rid = req.requestId;
      const { primaryId, duplicateIds } = req.body as z.output<
        typeof contactRoutes.mergeCluster.body
      >;

      let merged = 0;
      let failed = 0;
      let lastResult: ReturnType<typeof dedupeService.mergeContacts> | null =
        null;
      const mergeLogIds: string[] = [];

      for (const dupId of duplicateIds) {
        try {
          lastResult = dedupeService.mergeContacts(
            scope,
            primaryId,
            dupId,
            rid,
          );
          mergeLogIds.push(lastResult.mergeLogId);
          merged++;
        } catch (err: unknown) {
          log.warn(
            "API",
            `[${rid}] Cluster merge: skipping ${dupId}: ${getErrorMessage(err)}`,
          );
          failed++;
        }
      }

      // Each merge settled its own suggestions and cleared the pairs its
      // tombstone stranded (`settleSuggestionsAfterMergeUnsafe`).
      log.info(
        "API",
        `[${rid}] POST /api/contacts/merge-cluster → merged ${merged}/${duplicateIds.length} into ${primaryId}`,
      );
      res.json({
        success: merged > 0,
        merged,
        failed,
        contact: lastResult?.contact ?? null,
        mergeLogIds,
      });
    }),
  );

  router.post(
    "/contacts/merge-clusters",
    validateBody(contactRoutes.mergeClusters.body),
    asyncHandler(async (req, res) => {
      const scope = scopeOf(req);
      const rid = req.requestId;
      const { clusters } = req.body as z.output<
        typeof contactRoutes.mergeClusters.body
      >;

      const results: {
        primaryId: string;
        merged: number;
        failed: number;
        mergeLogIds: string[];
      }[] = [];
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
            mergeLogIds: [],
          });
          totalFailed += duplicateIds?.length ?? 0;
          continue;
        }

        let merged = 0;
        let failed = 0;
        const mergeLogIds: string[] = [];

        for (const dupId of duplicateIds) {
          try {
            mergeLogIds.push(
              dedupeService.mergeContacts(scope, primaryId, dupId, rid)
                .mergeLogId,
            );
            merged++;
          } catch (err: unknown) {
            log.warn(
              "API",
              `[${rid}] Bulk cluster merge: skipping ${dupId}: ${getErrorMessage(err)}`,
            );
            failed++;
          }
        }

        results.push({ primaryId, merged, failed, mergeLogIds });
        totalMerged += merged;
        totalFailed += failed;
      }

      log.info(
        "API",
        `[${rid}] POST /api/contacts/merge-clusters → ${totalMerged} merged, ${totalFailed} failed across ${clusters.length} clusters`,
      );
      res.json({ results, totalMerged, totalFailed });
    }),
  );
}
