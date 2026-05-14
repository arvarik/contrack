// =============================================================================
// AI Layer — Dynamic Smart Router
// =============================================================================
// The decision engine for the Predictive Smart Mesh. Given a request's
// estimated token count and the caller's routing preferences, it returns
// the optimal RouteDecision: which model to use and at what tier.
//
// Algorithm (3-Pass):
//   Pass 1: FILTER    — Remove models blocked by policy, circuit breakers,
//                        tier availability, or feature requirements
//   Pass 2: CAPACITY  — Scan remaining models (cheapest-first) for
//                        tier-specific capacity via the QuotaTracker
//   Pass 3: OVERFLOW  — If all capacity exhausted, use cheapest model
//                        with paid limits (if allowed by policy)
// =============================================================================

import { GEMINI_REGISTRY, getActiveLimits, type AITier } from "./registry.ts";
import type { QuotaTracker } from "./QuotaTracker.ts";
import type { RoutingPolicy } from "../types.ts";
import { log } from "../../utils/logger.ts";

// Re-export RoutingPolicy so routing-layer consumers don't need a separate import
export type { RoutingPolicy } from "../types.ts";

// ---------------------------------------------------------------------------
// Route Decision
// ---------------------------------------------------------------------------

export interface RouteDecision {
  /** The selected model identifier */
  modelId: string;
  /** Whether this route is using free-tier or paid-tier limits */
  tier: "free" | "paid";
}

// ---------------------------------------------------------------------------
// Smart Router
// ---------------------------------------------------------------------------

export class SmartRouter {
  constructor(
    private tracker: QuotaTracker,
    private aiTier: AITier,
  ) {}

  /**
   * Find the next available model for a request.
   *
   * @param estimatedTokens   - Estimated token count from QuotaTracker.estimateTokens()
   * @param policy            - Caller's routing preferences (allow/deny lists, spillover)
   * @param circuitBreakers   - Set of model IDs temporarily banned due to 429 errors
   * @param requiresGrounding - Whether the request needs Google Search grounding
   * @returns                 - The selected model and tier
   * @throws                  - If no model matches criteria or all limits exhausted
   */
  getNextAvailableRoute(
    estimatedTokens: number,
    policy: RoutingPolicy = {},
    circuitBreakers: Set<string>,
    requiresGrounding: boolean = false,
  ): RouteDecision {
    // ── Resolve effective defaults ────────────────────────────────────
    // Paid spillover: FREE defaults to NO, PAID defaults to YES.
    // Preview: auto-enable when a model preference is set, since
    // Gemini 3.x models (the newest generation) are all preview-stability.
    const effectiveAllowPaidSpillover =
      policy.allowPaidSpillover ?? this.aiTier === "PAID";
    const effectiveAllowPreview = policy.allowPreview ?? !!policy.prefer;

    // ── Pass 1: Filter ────────────────────────────────────────────────
    const candidates = GEMINI_REGISTRY.filter((m) => {
      // Circuit breaker: model is temporarily banned (recently hit 429)
      if (circuitBreakers.has(m.id)) return false;

      // Stability filter: exclude preview models unless opted in
      if (m.stability === "preview" && !effectiveAllowPreview) return false;

      // Tier availability: exclude models not available for this tier
      if (this.aiTier === "FREE" && !m.hasFreeTier) return false;

      // Explicit allow-list: only these models may be used
      if (policy.allowModels?.length && !policy.allowModels.includes(m.id)) {
        return false;
      }

      // Explicit deny-list: these models must not be used
      if (policy.denyModels?.includes(m.id)) return false;

      // Feature filter: grounding requires BOTH model capability AND RPD quota
      if (requiresGrounding) {
        if (!m.supportsGrounding) return false;
        if (!this.tracker.hasGroundingCapacity()) {
          log.warn(
            "SmartRouter",
            `Grounding requested but shared grounding RPD exhausted. ` +
              `Falling back to non-grounding-capable models.`,
          );
          return false;
        }
      }

      return true;
    });

    if (candidates.length === 0) {
      throw new Error(
        "SmartRouter: No models match routing criteria. " +
          `AI_TIER: ${this.aiTier}, ` +
          `Circuit breakers: [${[...circuitBreakers].join(", ")}], ` +
          `Policy: ${JSON.stringify(policy)}, ` +
          `Grounding required: ${requiresGrounding}`,
      );
    }

    // ── Candidate Sorting ─────────────────────────────────────────────
    // When a model class preference is set (e.g., "lite"), sort:
    //   1. Preferred class first (lite before flash/pro)
    //   2. Newer generation first (Gemini 3 before Gemini 2)
    //   3. Cheapest as tiebreaker
    // When no preference: cheapest-first (original behavior).
    if (policy.prefer) {
      candidates.sort((a, b) => {
        const aPref = a.modelClass === policy.prefer ? 0 : 1;
        const bPref = b.modelClass === policy.prefer ? 0 : 1;
        if (aPref !== bPref) return aPref - bPref;
        if (a.generation !== b.generation) return b.generation - a.generation;
        return a.costPerM - b.costPerM;
      });
    } else {
      candidates.sort((a, b) => a.costPerM - b.costPerM);
    }

    // ── Pass 2: Capacity Hunt ─────────────────────────────────────────
    for (const model of candidates) {
      const limits = getActiveLimits(model, this.aiTier);
      if (this.tracker.hasCapacity(model.id, estimatedTokens, limits)) {
        log.debug(
          "SmartRouter",
          `Routed to ${model.id} [${this.aiTier}]` +
            (policy.prefer ? ` (prefer: ${policy.prefer})` : "") +
            ` (est. ${estimatedTokens} tokens)`,
        );
        return {
          modelId: model.id,
          tier: this.aiTier === "PAID" ? "paid" : "free",
        };
      }
    }

    // ── Pass 3: Paid Overflow ─────────────────────────────────────────
    // Only applicable on FREE tier — allows falling through to paid limits
    // when free-tier capacity is exhausted.
    if (effectiveAllowPaidSpillover && this.aiTier === "FREE") {
      for (const model of candidates) {
        if (
          this.tracker.hasCapacity(model.id, estimatedTokens, model.paidLimits)
        ) {
          log.warn(
            "SmartRouter",
            `Free tier exhausted. Overflowing to PAID limits → ${model.id} ` +
              `($${model.costPerM}/1M tokens). May incur charges.`,
          );
          return { modelId: model.id, tier: "paid" };
        }
      }
    }

    throw new Error(
      `SmartRouter: All ${this.aiTier} tier limits exhausted` +
        (effectiveAllowPaidSpillover
          ? " and paid overflow capacity also exhausted."
          : " and paid spillover is disabled."),
    );
  }
}
