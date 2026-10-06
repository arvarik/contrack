// AI diagnostics: what each kind of AI work runs on now, and what this process
// sent to Gemini (per-model usage, grounded requests today, models a circuit
// breaker paused). Also whether an admin turned AI off for the instance, which
// every account may read. GET /api/ai/diagnostics, GET /api/ai/instance.

import { Router } from "express";
import { getProvider } from "../ai/providerRegistry.ts";
import {
  capabilityTarget,
  isResearchOff,
  resolveCapability,
} from "../ai/capabilities.ts";
import { GEMINI_REGISTRY } from "../ai/routing/registry.ts";
import type { DiagnosticsSnapshot } from "../ai/types.ts";
import { getSearxngUrl } from "../services/integrationSettings.ts";
import { researchRunsLastDay } from "../services/aiStatsService.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { requireAdmin } from "../middleware/auth.ts";
import { instanceAiState } from "../ai/instanceSwitch.ts";

const router = Router();

// The first two routes report the instance's shared routing state (usage and
// circuit breakers every account draws on), which describes the operator's
// provider account, not the caller's data, so they are admin routes.

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
 * Whether web research can run now, for the palette's enrich action, and how
 * many research calls the instance made in the last 24 hours, for the
 * Enrichment page. It can when research resolves to a provider (or SearXNG is
 * set and research is not "Off"), and, when that provider is Gemini, at least
 * one of its search models is not paused.
 */
router.get(
  "/grounding-capacity",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const research = resolveCapability("research");
    const researchRuns24h = researchRunsLastDay();
    if (!research) {
      const searxng =
        !!getSearxngUrl() && !!resolveCapability("deep") && !isResearchOff();
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

/**
 * GET /api/ai/instance
 *
 * `{ aiOff, lockedByEnv }`: whether an admin turned AI off for every account,
 * and whether AI_DISABLED holds it off. Any signed-in caller may read it,
 * because the Privacy page has to say why the account's own switch cannot
 * turn AI on. It names no provider, key or model.
 */
router.get(
  "/instance",
  asyncHandler(async (_req, res) => {
    res.json(instanceAiState());
  }),
);

export const aiRouter = router;
