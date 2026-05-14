// =============================================================================
// Routes — AI Diagnostics
// =============================================================================
// Lightweight endpoint for debugging the Smart Mesh routing layer.
// Exposes current quota usage, circuit breaker state, and tier configuration.
//
// Usage: GET /api/ai/diagnostics
// =============================================================================

import { Router } from "express";
import { ai, activeProviderName } from "../ai/index.ts";
import {
  getAvailableModels,
  getAITier,
  GEMINI_REGISTRY,
} from "../ai/routing/registry.ts";
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
 * For non-Gemini providers, returns a simplified response indicating
 * that detailed quota tracking is not available.
 */
router.get(
  "/diagnostics",
  asyncHandler(async (req, res) => {
    const rid = (req as any).requestId;

    const snapshot = ai.getQuotaSnapshot();

    log.debug(
      "API",
      `[${rid}] GET /api/ai/diagnostics (provider: ${activeProviderName})`,
    );

    // Non-Gemini providers: return provider info without Gemini-specific registry data
    if (activeProviderName !== "gemini") {
      return res.json({
        ...snapshot,
        provider: activeProviderName,
        registry: {
          totalModels: 0,
          availableModels: 0,
          availableModelIds: [],
          note: `Detailed quota tracking is not available for ${activeProviderName}. Quota is managed by the provider.`,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Gemini: full registry + quota data
    const tier = getAITier();
    const available = getAvailableModels(tier);

    res.json({
      ...snapshot,
      provider: activeProviderName,
      registry: {
        totalModels: GEMINI_REGISTRY.length,
        availableModels: available.length,
        availableModelIds: available.map((m) => m.id),
      },
      timestamp: new Date().toISOString(),
    });
  }),
);

/**
 * GET /api/ai/grounding-capacity
 *
 * Lightweight endpoint for the frontend to check whether single-contact
 * enrichment (grounding) is available. Returns remaining daily capacity.
 *
 * For non-Gemini providers, always returns hasCapacity: true since they
 * don't have a shared grounding RPD pool.
 */
router.get(
  "/grounding-capacity",
  asyncHandler(async (_req, res) => {
    // Non-Gemini providers don't have grounding RPD limits
    if (activeProviderName !== "gemini") {
      return res.json({
        hasCapacity: true,
        remaining: null,
        limit: null,
        provider: activeProviderName,
        note: "Grounding capacity limits are Gemini-specific. This provider has no shared grounding pool.",
      });
    }

    const snapshot = ai.getQuotaSnapshot();
    const { grounding } = snapshot;

    res.json({
      hasCapacity: grounding.remaining > 0,
      remaining: grounding.remaining,
      limit: grounding.limit,
    });
  }),
);

export const aiRouter = router;
