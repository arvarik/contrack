// =============================================================================
// Dedupe Engine — API Routes
// =============================================================================
// POST /api/dedupe/scan     — Start a new async scan
// GET  /api/dedupe/stream   — SSE stream for real-time progress
// GET  /api/dedupe/status   — Polling fallback
// POST /api/contacts/merge  — Merge two contacts (single)
// POST /api/contacts/merge-batch — Merge multiple pairs (bulk)
// POST /api/dev/seed-duplicates  — Dev-only seed utility
// =============================================================================

import { Router } from "express";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { log } from "../utils/logger.ts";
import { dedupeService } from "../services/dedupeService.ts";
import { dedupeQueue, type DedupeScanProgress } from "../services/dedupeJobQueue.ts";

const router = Router();

// =============================================================================
// POST /dedupe/scan — Start a new async scan
// =============================================================================

router.post("/dedupe/scan", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { mode = 'both' } = req.body;

  // Validate mode
  if (!['deterministic', 'ai', 'both'].includes(mode)) {
    throw new AppError("mode must be 'deterministic', 'ai', or 'both'", 400);
  }

  // Check if a scan is already running
  const check = dedupeQueue.canStartScan();
  if (!check.allowed) {
    return res.status(429).json({ error: check.reason });
  }

  // Create scan
  const scan = dedupeQueue.createScan(mode);
  log.info("API", `[${rid}] POST /api/dedupe/scan → scanId=${scan.scanId}, mode=${mode}`);

  // Fire-and-forget processing
  dedupeService.runScan(scan.scanId, mode, rid).catch(err => {
    log.error("API", `[${rid}] Scan ${scan.scanId} processing error: ${err.message}`);
  });

  // Return scan ID immediately
  res.json({ scanId: scan.scanId, mode });
}));

// =============================================================================
// GET /dedupe/stream — SSE stream for real-time scan progress
// =============================================================================

router.get("/dedupe/stream", (req, res) => {
  const scanId = req.query.scanId as string;
  if (!scanId) {
    return res.status(400).json({ error: "scanId query parameter is required." });
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Send current state immediately
  const scan = dedupeQueue.getScan(scanId);
  if (!scan) {
    res.write(`data: ${JSON.stringify({ error: "Scan not found" })}\n\n`);
    return res.end();
  }

  res.write(`data: ${JSON.stringify(scan)}\n\n`);

  // If already complete, close immediately
  if (scan.phase === "complete" || scan.phase === "error") {
    return res.end();
  }

  // Subscribe to live updates
  const handler = (updatedScan: DedupeScanProgress) => {
    res.write(`data: ${JSON.stringify(updatedScan)}\n\n`);
    if (updatedScan.phase === "complete" || updatedScan.phase === "error") {
      dedupeQueue.off(scanId, handler);
      res.end();
    }
  };

  dedupeQueue.on(scanId, handler);

  // Cleanup on client disconnect
  req.on("close", () => {
    dedupeQueue.off(scanId, handler);
  });
});

// =============================================================================
// GET /dedupe/status — Polling fallback
// =============================================================================

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

// =============================================================================
// POST /contacts/merge — Merge two contacts (single)
// =============================================================================

router.post("/contacts/merge", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { primaryId, duplicateId } = req.body;
  
  if (!primaryId || !duplicateId) {
    throw new AppError("primaryId and duplicateId are required", 400);
  }
  if (primaryId === duplicateId) {
    throw new AppError("Cannot merge a contact with itself", 400);
  }

  const merged = dedupeService.mergeContacts(primaryId, duplicateId, rid);
  log.info("API", `[${rid}] POST /api/contacts/merge → merged ${duplicateId} into ${primaryId}`);
  res.json({ success: true, contact: merged });
}));

// =============================================================================
// POST /contacts/merge-batch — Bulk merge from list view
// =============================================================================

router.post("/contacts/merge-batch", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { merges } = req.body;

  if (!Array.isArray(merges) || merges.length === 0) {
    throw new AppError("merges array is required and must not be empty", 400);
  }

  if (merges.length > 50) {
    throw new AppError("Maximum 50 merges per batch", 400);
  }

  const results: { primaryId: string; duplicateId: string; success: boolean; error?: string }[] = [];

  for (const { primaryId, duplicateId } of merges) {
    if (!primaryId || !duplicateId || primaryId === duplicateId) {
      results.push({ primaryId, duplicateId, success: false, error: "Invalid merge pair" });
      continue;
    }
    try {
      dedupeService.mergeContacts(primaryId, duplicateId, rid);
      results.push({ primaryId, duplicateId, success: true });
    } catch (err: any) {
      results.push({ primaryId, duplicateId, success: false, error: err.message });
    }
  }

  const succeeded = results.filter(r => r.success).length;
  log.info("API", `[${rid}] POST /api/contacts/merge-batch → ${succeeded}/${merges.length} merged`);
  res.json({ results, succeeded, total: merges.length });
}));

// =============================================================================
// DEV ONLY — Seed duplicates
// =============================================================================

if (process.env.NODE_ENV !== 'production') {
  router.post("/dev/seed-duplicates", asyncHandler(async (req, res) => {
    const rid = (req as any).requestId;
    dedupeService.seedDuplicates();
    log.info("API", `[${rid}] POST /api/dev/seed-duplicates → Seeded duplicate pair`);
    res.json({ success: true, message: "Seeded 1 duplicate pair" });
  }));
}

export const dedupeRouter = router;
