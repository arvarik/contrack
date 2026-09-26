// =============================================================================
// Routes — AI Diagnostics
// =============================================================================
// What each kind of AI work runs on right now, and what this process has sent
// to Gemini: per-model usage, grounded requests today, and the models a
// circuit breaker has paused.
//
// Usage: GET /api/ai/diagnostics
// =============================================================================

import { Router } from "express";
import { getProvider } from "../ai/providerRegistry.ts";
import { capabilityTarget, resolveCapability } from "../ai/capabilities.ts";
import { GEMINI_REGISTRY } from "../ai/routing/registry.ts";
import type { DiagnosticsSnapshot } from "../ai/types.ts";
import { getSearxngUrl } from "../services/aiSearch/strategies/searxng.ts";
import { researchRunsLastDay } from "../services/aiStatsService.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { requireAdmin } from "../middleware/auth.ts";

const router = Router();

// Both routes report the instance's shared routing state: usage and circuit
// breakers that every account draws on. They describe the operator's provider
// account, not the caller's data, which is why the manifest classes them
// `admin` and Phase 3 guards them.

const EMPTY_SNAPSHOT: DiagnosticsSnapshot = {
  models: {},
  grounding: { rpd: 0 },
  circuitBreakers: [],
};

/** Gemini's usage meter, or an empty one when Gemini is not connected. */
function geminiSnapshot(): DiagnosticsSnapshot {
  return getProvider("gemini")?.getQuotaSnapshot?.() ?? EMPTY_SNAPSHOT;
}

/**
 * GET /api/ai/diagnostics
 *
 * - What quick, deep and research resolve to now
 * - Gemini's per-model usage (requests and tokens in the last minute,
 *   requests today), grounded requests today, and paused models
 * - Whether Google has answered this key with a free-tier quota
 */
router.get(
  "/diagnostics",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({
      ...geminiSnapshot(),
      capabilities: {
        quick: capabilityTarget("quick"),
        deep: capabilityTarget("deep"),
        research: capabilityTarget("research"),
      },
      registry: { models: GEMINI_REGISTRY.map((m) => m.id) },
      timestamp: new Date().toISOString(),
    });
  }),
);

/**
 * GET /api/ai/grounding-capacity
 *
 * Whether web research can run right now, for the command palette's enrich
 * action, and how many research calls the instance made in the last 24 hours,
 * for the Enrichment page. It used to answer from Gemini's local grounding
 * pool, and only when AI_PROVIDER was gemini, so it was wrong whenever
 * research ran elsewhere. Now: research resolves to a provider (or SearXNG is
 * set), and when that provider is Gemini, at least one of its search models
 * is not paused.
 */
router.get(
  "/grounding-capacity",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const research = resolveCapability("research");
    const researchRuns24h = researchRunsLastDay();
    if (!research) {
      const searxng = !!getSearxngUrl() && !!resolveCapability("deep");
      return res.json({
        hasCapacity: searxng,
        provider: searxng ? "searxng" : null,
        researchRuns24h,
      });
    }
    let hasCapacity = true;
    if (research.providerId === "gemini" && !research.model) {
      const paused = new Set(geminiSnapshot().circuitBreakers);
      hasCapacity = GEMINI_REGISTRY.some(
        (m) => m.supportsGrounding && !paused.has(m.id),
      );
    }
    res.json({ hasCapacity, provider: research.providerId, researchRuns24h });
  }),
);

export const aiRouter = router;
