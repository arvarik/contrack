import { Router } from "express";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { log } from "../../utils/logger.ts";
import {
  getPendingSuggestions,
  getPendingCount,
  getPendingClusterCount,
  getSuggestionById,
  getSuggestionForContact,
  dismissSuggestion,
  markSuggestionMerged,
  getMergeLog,
  undoSoftMerge,
  dedupeService,
} from "../../services/dedupe/index.ts";

export function registerSuggestionRoutes(router: Router) {
  router.get(
    "/dedupe/suggestions",
    asyncHandler(async (req, res) => {
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const suggestions = getPendingSuggestions(limit);
      res.json({ suggestions, total: suggestions.length });
    }),
  );

  router.get(
    "/dedupe/suggestions/count",
    asyncHandler(async (_req, res) => {
      // `count` drives the sidebar badge, so it reports clusters: the number
      // of cards the review queue will actually show. `pairs` is the raw
      // pending row count, kept for anything that needs the finer number.
      res.json({ count: getPendingClusterCount(), pairs: getPendingCount() });
    }),
  );

  router.get(
    "/dedupe/suggestion-for/:contactId",
    asyncHandler(async (req, res) => {
      const { contactId } = req.params;
      const suggestion = getSuggestionForContact(String(contactId));
      res.json({ suggestion });
    }),
  );

  router.post(
    "/dedupe/suggestions/:id/dismiss",
    asyncHandler(async (req, res) => {
      const rid = req.requestId;
      const id = String(req.params.id);

      dismissSuggestion(id, rid);
      log.info("API", `[${rid}] POST /api/dedupe/suggestions/${id}/dismiss`);
      res.json({ success: true });
    }),
  );

  router.post(
    "/dedupe/suggestions/:id/merge",
    asyncHandler(async (req, res) => {
      const rid = req.requestId;
      const id = String(req.params.id);
      const { primaryId } = req.body;

      const suggestion = getSuggestionById(id);
      if (!suggestion) {
        throw new AppError("Suggestion not found", 404);
      }
      if (suggestion.status !== "pending") {
        throw new AppError(`Suggestion is already ${suggestion.status}`, 400);
      }

      // The primary must be one of the pair. The old ternary defaulted any
      // OTHER id to "contactIdA is the duplicate" — so a caller merging a
      // cluster pair-by-pair under the cluster's primary silently re-merged
      // the wrong contact, then failed on the tombstone. Guessing with a
      // merge is never acceptable; cluster merges have their own endpoint.
      if (
        primaryId !== suggestion.contactIdA &&
        primaryId !== suggestion.contactIdB
      ) {
        throw new AppError(
          "primaryId must be one of the suggestion's two contacts — for multi-contact merges use POST /api/contacts/merge-cluster",
          400,
        );
      }

      const duplicateId =
        primaryId === suggestion.contactIdA
          ? suggestion.contactIdB
          : suggestion.contactIdA;

      const merged = dedupeService.mergeContacts(primaryId, duplicateId, rid);

      markSuggestionMerged(id, "user:suggestion");

      log.info(
        "API",
        `[${rid}] POST /api/dedupe/suggestions/${id}/merge → merged ${duplicateId} into ${primaryId}`,
      );
      res.json({ success: true, contact: merged });
    }),
  );

  router.get(
    "/dedupe/merge-log",
    asyncHandler(async (req, res) => {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const entries = getMergeLog(limit);
      res.json({ entries, total: entries.length });
    }),
  );

  router.post(
    "/dedupe/merge-log/:id/undo",
    asyncHandler(async (req, res) => {
      const rid = req.requestId;
      const id = String(req.params.id);

      undoSoftMerge(id, rid);
      log.info("API", `[${rid}] POST /api/dedupe/merge-log/${id}/undo`);
      res.json({ success: true });
    }),
  );
}
