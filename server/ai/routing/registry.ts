// =============================================================================
// AI Layer — Tier-Aware Model Registry
// =============================================================================
// Single source of truth for Gemini model capabilities, rate limits, and costs.
// Each model carries BOTH free-tier and paid-tier limit profiles. The active
// profile is selected at startup via the AI_TIER environment variable.
//
// MAINTENANCE: When Google releases new models or changes limits, update this
// file. Check your project's AI Studio dashboard at https://aistudio.google.com/
// for current rate limit values.
// =============================================================================

/**
 * Stability tier for a model.
 * - "stable": GA model, safe for production use
 * - "preview": May change behavior or be removed; opt-in only
 */
export type ModelStability = "stable" | "preview";

/**
 * Functional model class — describes what tier of capability the model offers.
 * Used by consumers to express a preference via `routing.prefer`.
 * - "lite":  Cheapest, fastest — good for simple extraction/classification
 * - "flash": Mid-tier — good for reasoning, summarization, structured output
 * - "pro":   Most capable — best for complex reasoning, search grounding
 */
export type ModelClass = "lite" | "flash" | "pro";

/**
 * Billing tier — controls which limit set the registry uses.
 * Read from the AI_TIER environment variable at startup.
 */
export type AITier = "FREE" | "PAID";

/**
 * Rate limit set for a single billing tier.
 * All three dimensions are checked by the QuotaTracker.
 */
export interface TierLimits {
  /** Requests per minute (project-level) */
  rpm: number;
  /** Tokens per minute — input + output combined (project-level) */
  tpm: number;
  /** Requests per day. Use Infinity for "Unlimited" */
  rpd: number;
}

/**
 * Full model configuration with per-tier rate limits.
 *
 * Free-tier limits derived from the user's AI Studio dashboard using:
 *   free_limit ≈ paid_limit − |negative_remaining_shown|
 *
 * Paid-tier limits are the dashboard's primary display values (Tier 2).
 *
 * Values sourced from the user's Google AI Studio dashboard (April 2026)
 * and official pricing at https://ai.google.dev/gemini-api/docs/pricing
 */
export interface ModelConfig {
  /** Model identifier as accepted by the Gemini API */
  id: string;

  /** Functional class — lite, flash, or pro */
  modelClass: ModelClass;

  /** Major generation number (2 for Gemini 2.5, 3 for Gemini 3.x, etc.) */
  generation: number;

  /** Stability tier — preview models are opt-in only */
  stability: ModelStability;

  /** Whether this model has ANY free generation availability (even if very limited) */
  hasFreeTier: boolean;

  /** Free-tier rate limits (conservative — ~10 RPM for flash-lite) */
  freeLimits: TierLimits;

  /** Paid-tier rate limits (generous — 10K RPM for flash-lite) */
  paidLimits: TierLimits;

  /** Paid-tier cost per 1M output tokens in USD (for overflow cost sorting) */
  costPerM: number;

  /**
   * Whether this model supports Google Search grounding.
   * Note: Grounding has its OWN separate RPD limit (see GROUNDING_LIMITS).
   */
  supportsGrounding: boolean;
}

// =============================================================================
// Grounding Limits
// =============================================================================
// These are SEPARATE from each model's generation RPD.
// All current Gemini models (2.5 and 3.x) support search grounding.
// Grounding RPD is a shared pool across all models.
// =============================================================================

export const GROUNDING_LIMITS = {
  /** Free-tier: 500 RPD shared between flash + flash-lite */
  free: { rpd: 500 },
  /** Paid-tier: much higher grounding allowance */
  paid: { rpd: 5_000 },
} as const;

// =============================================================================
// Model Registry
// =============================================================================
// Ordered cheapest-first — this is the default routing preference.
// The SmartRouter re-sorts by costPerM but preserving insertion order
// as a tiebreaker keeps behavior deterministic.
// =============================================================================

export const GEMINI_REGISTRY: ModelConfig[] = [
  // ── Stable Models (enabled by default) ─────────────────────────────
  {
    id: "gemini-2.5-flash-lite",
    modelClass: "lite",
    generation: 2,
    stability: "stable",
    hasFreeTier: true,
    freeLimits: { rpm: 10, tpm: 250_000, rpd: 500 },
    paidLimits: { rpm: 10_000, tpm: 10_000_000, rpd: Infinity },
    costPerM: 0.40,
    supportsGrounding: true,
  },
  {
    id: "gemini-2.5-flash",
    modelClass: "flash",
    generation: 2,
    stability: "stable",
    hasFreeTier: true,
    freeLimits: { rpm: 2, tpm: 250_000, rpd: 20 },
    paidLimits: { rpm: 2_000, tpm: 3_000_000, rpd: 100_000 },
    costPerM: 2.50,
    supportsGrounding: true,
  },
  {
    id: "gemini-2.5-pro",
    modelClass: "pro",
    generation: 2,
    stability: "stable",
    hasFreeTier: true,
    freeLimits: { rpm: 2, tpm: 4_000, rpd: 2 },
    paidLimits: { rpm: 1_000, tpm: 5_000_000, rpd: 50_000 },
    costPerM: 10.00,
    supportsGrounding: true,
  },

  // ── Preview Models (opt-in only — typically paid-tier only) ────────
  {
    id: "gemini-3.1-flash-lite-preview",
    modelClass: "lite",
    generation: 3,
    stability: "preview",
    hasFreeTier: false,
    freeLimits: { rpm: 0, tpm: 0, rpd: 0 },
    paidLimits: { rpm: 10_000, tpm: 10_000_000, rpd: 350_000 },
    costPerM: 1.50,
    supportsGrounding: true,
  },
  {
    id: "gemini-3-flash-preview",
    modelClass: "flash",
    generation: 3,
    stability: "preview",
    hasFreeTier: false,
    freeLimits: { rpm: 0, tpm: 0, rpd: 0 },
    paidLimits: { rpm: 2_000, tpm: 3_000_000, rpd: 100_000 },
    costPerM: 3.00,
    supportsGrounding: true,
  },
  {
    id: "gemini-3.1-pro-preview",
    modelClass: "pro",
    generation: 3,
    stability: "preview",
    hasFreeTier: false,
    freeLimits: { rpm: 0, tpm: 0, rpd: 0 },
    paidLimits: { rpm: 1_000, tpm: 5_000_000, rpd: 50_000 },
    costPerM: 12.00,
    supportsGrounding: true,
  },
];

// =============================================================================
// Registry Helpers
// =============================================================================

/**
 * Read the AI_TIER from environment.
 * Defaults to "FREE" if not set — conservative by default to avoid
 * unexpected charges for users who haven't explicitly opted in.
 */
export function getAITier(): AITier {
  const tier = process.env.AI_TIER?.toUpperCase();
  if (tier === "PAID") return "PAID";
  return "FREE";
}

/** Get the active limits for a model based on the current AI_TIER. */
export function getActiveLimits(model: ModelConfig, tier: AITier): TierLimits {
  return tier === "PAID" ? model.paidLimits : model.freeLimits;
}

/** Get the active grounding RPD limit based on the current AI_TIER. */
export function getGroundingRPDLimit(tier: AITier): number {
  return tier === "PAID" ? GROUNDING_LIMITS.paid.rpd : GROUNDING_LIMITS.free.rpd;
}

/** Lookup a model config by ID. Returns undefined if not registered. */
export function getModelConfig(modelId: string): ModelConfig | undefined {
  return GEMINI_REGISTRY.find((m) => m.id === modelId);
}

/** Get only stable models (default for production routing). */
export function getStableModels(): ModelConfig[] {
  return GEMINI_REGISTRY.filter((m) => m.stability === "stable");
}

/**
 * Get models available for routing on a given tier.
 * - FREE: only models with hasFreeTier === true
 * - PAID: all models (paid-only models become available)
 */
export function getAvailableModels(tier: AITier): ModelConfig[] {
  if (tier === "PAID") return GEMINI_REGISTRY;
  return GEMINI_REGISTRY.filter((m) => m.hasFreeTier);
}
