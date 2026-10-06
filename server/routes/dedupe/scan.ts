import { Router } from "express";
import { AppError, RateLimitedError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { startStream } from "../../utils/stream.ts";
import { log } from "../../utils/logger.ts";
import {
  dedupeService,
  dedupeQueue,
  type DedupeScanMode,
  type DedupeScanProgress,
} from "../../services/dedupe/index.ts";
import { scopeOf, type Scope } from "../../tenancy/scope.ts";
import { runWithContext } from "../../tenancy/requestContext.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import { autoMergeThresholdFor } from "../../services/dedupe/policy.ts";

/**
 * Start one scan, now or when the run lock frees. The scope is captured here
 * and carried into the run, not read from the async context inside it: a queued
 * scan starts from the finishing scan's callback, in the other account's
 * context, and even an immediate run outlives its response.
 */
function startScan(
  scope: Scope,
  scanId: string,
  mode: DedupeScanMode,
  rid: string,
  threshold: number,
): void {
  runWithContext(
    {
      requestId: `job-dedupe-scan-${scanId.slice(0, 8)}`,
      principal: null,
      scope,
    },
    () => dedupeService.runScan(scope, scanId, mode, rid, threshold),
  ).catch((err) => {
    log.error(
      "API",
      `[${rid}] Scan ${scanId} processing error: ${getErrorMessage(err)}`,
    );
  });
}

export function registerScanRoutes(router: Router) {
  router.post(
    "/dedupe/scan",
    asyncHandler(async (req, res, next) => {
      const scope = scopeOf(req);
      const rid = req.requestId;
      const { mode = "deep", autoMergeThreshold } = req.body;

      const validModes = ["quick", "deep", "full"];
      if (!validModes.includes(mode)) {
        throw new AppError(
          `mode must be one of: ${validModes.join(", ")}`,
          400,
        );
      }

      // The account's preset, unless the request names a number for one scan.
      let threshold = autoMergeThresholdFor(scope);
      let thresholdSource = "account preset";
      if (autoMergeThreshold !== undefined) {
        threshold = Number(autoMergeThreshold);
        // From the eager preset up. At 0.85, the ceiling for a contradicted
        // pair, a request could merge two people the policy stopped for review,
        // such as a household on one phone line.
        if (isNaN(threshold) || threshold < 0.88 || threshold > 0.99) {
          throw new AppError(
            "autoMergeThreshold must be between 0.88 and 0.99",
            400,
          );
        }
        thresholdSource = "request";
      }

      const check = dedupeQueue.canStartScan(scope);
      if (!check.allowed) {
        // The standard error envelope: `details.yours` says whether the caller
        // is already scanning or somebody else holds the lock, and
        // `details.queued` whether a turn was booked.
        let queued = false;
        if (!check.yours) {
          const scan = dedupeQueue.createScan(scope, mode);
          queued = dedupeQueue.enqueue(scope, scan.scanId, () =>
            startScan(scope, scan.scanId, mode, rid, threshold),
          );
        }
        return next(
          new RateLimitedError(check.reason ?? "Please try again shortly.", {
            yours: check.yours,
            queued,
          }),
        );
      }

      const scan = dedupeQueue.createScan(scope, mode);
      log.info(
        "API",
        `[${rid}] POST /api/dedupe/scan → scanId=${scan.scanId}, mode=${mode}, threshold=${threshold} (${thresholdSource})`,
      );

      startScan(scope, scan.scanId, mode, rid, threshold);

      res.json({ scanId: scan.scanId, mode });
    }),
  );

  router.get("/dedupe/stream", (req, res) => {
    // Read the owner before the stream starts. The listener below runs in the
    // async context of whoever calls emit(), which is the scan, so the owner is
    // settled in this closure while the context is still the request's.
    const scope = scopeOf(req);
    const scanId = req.query.scanId as string;
    if (!scanId) {
      throw new AppError("scanId query parameter is required.", 400);
    }

    const scan = dedupeQueue.getScan(scope, scanId);
    if (!scan) throw new AppError("Scan not found.", 404);

    startStream(res, "text/event-stream");

    res.write(`data: ${JSON.stringify(scan)}\n\n`);

    if (scan.phase === "complete" || scan.phase === "error") {
      return res.end();
    }

    const handler = (updatedScan: DedupeScanProgress) => {
      res.write(`data: ${JSON.stringify(updatedScan)}\n\n`);
      if (updatedScan.phase === "complete" || updatedScan.phase === "error") {
        dedupeQueue.off(scanId, handler);
        res.end();
      }
    };

    dedupeQueue.on(scanId, handler);

    req.on("close", () => {
      dedupeQueue.off(scanId, handler);
    });
  });

  router.get(
    "/dedupe/active",
    asyncHandler(async (req, res) => {
      const scope = scopeOf(req);
      const activeScan = dedupeQueue.getActiveScan(scope);
      if (!activeScan) {
        return res.json({ active: false, queued: false });
      }
      // `queued` says the scan exists but has not started, because another
      // account holds the run lock. Without it the client shows a progress
      // card frozen at "Initializing scan…" for however long that takes.
      res.json({
        active: true,
        queued: dedupeQueue.isQueued(scope),
        scan: activeScan,
      });
    }),
  );

  router.get(
    "/dedupe/status",
    asyncHandler(async (req, res) => {
      const scope = scopeOf(req);
      const scanId = req.query.scanId as string;
      if (!scanId) {
        throw new AppError("scanId query parameter is required.", 400);
      }

      const scan = dedupeQueue.getScan(scope, scanId);
      if (!scan) throw new AppError("Scan not found.", 404);

      res.json(scan);
    }),
  );
}
