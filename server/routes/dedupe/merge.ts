import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { validateBody } from "../../utils/validators.ts";
import { contactRoutes } from "../../../shared/contracts/contacts.ts";
import type { z } from "zod";
import { log } from "../../utils/logger.ts";
import {
  dedupeService,
  clearStaleSuggestions,
} from "../../services/dedupe/index.ts";
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

      const merged = dedupeService.mergeContacts(
        scope,
        primaryId,
        duplicateId,
        rid,
      );
      log.info(
        "API",
        `[${rid}] POST /api/contacts/merge → merged ${duplicateId} into ${primaryId}`,
      );
      res.json({ success: true, contact: merged });
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

      for (const dupId of duplicateIds) {
        try {
          lastResult = dedupeService.mergeContacts(
            scope,
            primaryId,
            dupId,
            rid,
          );
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
      if (merged > 0) clearStaleSuggestions(scope);
      log.info(
        "API",
        `[${rid}] POST /api/contacts/merge-cluster → merged ${merged}/${duplicateIds.length} into ${primaryId}`,
      );
      res.json({ success: merged > 0, merged, failed, contact: lastResult });
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
            dedupeService.mergeContacts(scope, primaryId, dupId, rid);
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
      if (totalMerged > 0) clearStaleSuggestions(scope);
      log.info(
        "API",
        `[${rid}] POST /api/contacts/merge-clusters → ${totalMerged} merged, ${totalFailed} failed across ${clusters.length} clusters`,
      );
      res.json({ results, totalMerged, totalFailed });
    }),
  );
}
