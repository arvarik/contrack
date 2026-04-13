import { Router } from "express";
import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { log } from "../../utils/logger.ts";
import { dedupeService, dedupeQueue, type DedupeScanProgress } from "../../services/dedupe/index.ts";
import { getErrorMessage } from "../../utils/helpers.ts";

export function registerScanRoutes(router: Router) {
  router.post("/dedupe/scan", asyncHandler(async (req, res) => {
    const rid = (req as any).requestId;
    const { mode = 'deep', autoMergeThreshold } = req.body;

    const validModes = ['deterministic', 'ai', 'both', 'quick', 'deep', 'full'];
    if (!validModes.includes(mode)) {
      throw new AppError(`mode must be one of: ${validModes.join(', ')}`, 400);
    }

    // Validate and clamp auto-merge threshold
    let threshold = 0.93;
    if (autoMergeThreshold !== undefined) {
      threshold = Number(autoMergeThreshold);
      if (isNaN(threshold) || threshold < 0.85 || threshold > 0.99) {
        throw new AppError('autoMergeThreshold must be between 0.85 and 0.99', 400);
      }
    }

    const check = dedupeQueue.canStartScan();
    if (!check.allowed) {
      return res.status(429).json({ error: check.reason });
    }

    const scan = dedupeQueue.createScan(mode);
    log.info("API", `[${rid}] POST /api/dedupe/scan → scanId=${scan.scanId}, mode=${mode}, threshold=${threshold}`);

    dedupeService.runScan(scan.scanId, mode, rid, threshold).catch(err => {
      log.error("API", `[${rid}] Scan ${scan.scanId} processing error: ${getErrorMessage(err)}`);
    });

    res.json({ scanId: scan.scanId, mode });
  }));

  router.get("/dedupe/stream", (req, res) => {
    const scanId = req.query.scanId as string;
    if (!scanId) {
      return res.status(400).json({ error: "scanId query parameter is required." });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const scan = dedupeQueue.getScan(scanId);
    if (!scan) {
      res.write(`data: ${JSON.stringify({ error: "Scan not found" })}\n\n`);
      return res.end();
    }

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

  router.get("/dedupe/active", asyncHandler(async (_req, res) => {
    const activeScan = dedupeQueue.getActiveScan();
    if (!activeScan) {
      return res.json({ active: false });
    }
    res.json({ active: true, scan: activeScan });
  }));

  router.get("/dedupe/status", asyncHandler(async (req, res) => {
    const scanId = req.query.scanId as string;
    if (!scanId) {
      return res.status(400).json({ error: "scanId query parameter is required." });
    }

    const scan = dedupeQueue.getScan(scanId);
    if (!scan) {
      return res.status(404).json({ error: "Scan not found." });
    }

    res.json(scan);
  }));

  if (process.env.NODE_ENV !== 'production') {
    router.post("/dev/seed-duplicates", asyncHandler(async (req, res) => {
      const rid = (req as any).requestId;
      dedupeService.seedDuplicates();
      log.info("API", `[${rid}] POST /api/dev/seed-duplicates → Seeded duplicate pair`);
      res.json({ success: true, message: "Seeded 1 duplicate pair" });
    }));
  }
}
