// =============================================================================
// Routes — AI Diagnostics
// =============================================================================
// Lightweight endpoint for debugging the Smart Mesh routing layer.
// Exposes current quota usage, circuit breaker state, and tier configuration.
//
// Usage: GET /api/ai/diagnostics
// =============================================================================

import { Router } from "express";
import { ai } from "../ai/index.ts";
import { getAvailableModels, getAITier, GEMINI_REGISTRY } from "../ai/routing/registry.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { log } from "../utils/logger.ts";

const router = Router();

/**
 * GET /api/ai/diagnostics
 *
 * Returns the Smart Mesh routing state:
 * - Per-model quota usage (RPM, TPM, RPD within the sliding window)
 * - Grounding RPD usage and remaining capacity
 * - Active circuit breakers (models temporarily banned)
 * - AI tier configuration and registry metadata
 *
 * Since the provider consolidation (singleton.ts), there is only ONE
 * QuotaTracker and SmartRouter — no merging needed.
 */
router.get("/diagnostics", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;

  const snapshot = ai.getQuotaSnapshot();

  const tier = getAITier();
  const available = getAvailableModels(tier);

  log.debug("API", `[${rid}] GET /api/ai/diagnostics`);

  res.json({
    ...snapshot,
    registry: {
      totalModels: GEMINI_REGISTRY.length,
      availableModels: available.length,
      availableModelIds: available.map((m) => m.id),
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/ai/grounding-capacity
 *
 * Lightweight endpoint for the frontend to check whether single-contact
 * enrichment (grounding) is available. Returns remaining daily capacity.
 */
router.get("/grounding-capacity", asyncHandler(async (_req, res) => {
  const snapshot = ai.getQuotaSnapshot();
  const { grounding } = snapshot;

  res.json({
    hasCapacity: grounding.remaining > 0,
    remaining: grounding.remaining,
    limit: grounding.limit,
  });
}));

export const aiRouter = router;
