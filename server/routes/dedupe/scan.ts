import { Router } from "express";
import { AppError, RateLimitedError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
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

/**
 * Start one scan, now or when the run lock frees up.
 *
 * The scope is captured here and carried into the run rather than read from
 * the async context inside it. A queued scan starts from the finishing scan's
 * callback, where the context belongs to the other account, and even the
 * immediate path outlives the response it was started from.
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

      const validModes = [
        "deterministic",
        "ai",
        "both",
        "quick",
        "deep",
        "full",
      ];
      if (!validModes.includes(mode)) {
        throw new AppError(
          `mode must be one of: ${validModes.join(", ")}`,
          400,
        );
      }

      // Validate and clamp auto-merge threshold
      let threshold = 0.93;
      if (autoMergeThreshold !== undefined) {
        threshold = Number(autoMergeThreshold);
        if (isNaN(threshold) || threshold < 0.85 || threshold > 0.99) {
          throw new AppError(
            "autoMergeThreshold must be between 0.85 and 0.99",
            400,
          );
        }
      }

      const check = dedupeQueue.canStartScan(scope);
      if (!check.allowed) {
        // This used to be a bare `res.status(429).json({ error: string })`,
        // the one answer in the API that skipped the error envelope, so it
        // carried no code and no request id. `details.yours` says whether the
        // caller is already scanning or somebody else holds the lock, and
        // `details.queued` says whether a turn was booked.
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
        `[${rid}] POST /api/dedupe/scan → scanId=${scan.scanId}, mode=${mode}, threshold=${threshold}`,
      );

      startScan(scope, scan.scanId, mode, rid, threshold);

      res.json({ scanId: scan.scanId, mode });
    }),
  );

  router.get("/dedupe/stream", (req, res) => {
    // Read the owner before a byte of the stream is written. The listener
    // below runs in the async context of whoever calls emit(), which is the
    // scan, so the owner has to be settled in this closure while the request
    // context is still the request's.
    const scope = scopeOf(req);
    const scanId = req.query.scanId as string;
    if (!scanId) {
      throw new AppError("scanId query parameter is required.", 400);
    }

    const scan = dedupeQueue.getScan(scope, scanId);
    if (!scan) throw new AppError("Scan not found.", 404);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

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
      const activeScan = dedupeQueue.getActiveScan(scopeOf(req));
      if (!activeScan) {
        return res.json({ active: false });
      }
      res.json({ active: true, scan: activeScan });
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

  if (process.env.NODE_ENV !== "production") {
    router.post(
      "/dev/seed-duplicates",
      asyncHandler(async (req, res) => {
        const rid = req.requestId;
        dedupeService.seedDuplicates(scopeOf(req));
        log.info(
          "API",
          `[${rid}] POST /api/dev/seed-duplicates → Seeded duplicate pair`,
        );
        res.json({ success: true, message: "Seeded 1 duplicate pair" });
      }),
    );
  }
}
