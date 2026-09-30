// =============================================================================
// AI Layer — Public Barrel Export
// =============================================================================
// Import everything AI-related from this one path.
// Usage:
//   import { ai } from "../ai/index.ts";
//   import type { AIGenerateOptions } from "../ai/index.ts";
// =============================================================================

// ---------------------------------------------------------------------------
// Shared Provider Instance
// ---------------------------------------------------------------------------
// The single resolved provider used everywhere. Backed by singleton.ts
// to ensure one QuotaTracker, one SmartRouter, and one set of circuit
// breakers across the entire application.
// ---------------------------------------------------------------------------

import { sharedProvider } from "./singleton.ts";
import { isAnyProviderConfigured } from "./gateway.ts";
import { AppError } from "../utils/AppError.ts";
import type {
  DiagnosticsSnapshot,
  AIGenerateOptions,
  AIGenerateResult,
} from "./types.ts";

/** Empty diagnostics snapshot for providers without quota tracking. */
const EMPTY_SNAPSHOT: DiagnosticsSnapshot = {
  models: {},
  grounding: { rpd: 0 },
  circuitBreakers: [],
};

/**
 * The default provider name (lowercase) implied by AI_PROVIDER.
 *
 * @deprecated Provider is now per-capability. Use `providerIdFor(capability)`
 * from gateway.ts when you need to know what actually serves a given task.
 */
export const activeProviderName = (
  process.env.AI_PROVIDER ?? "gemini"
).toLowerCase();

/**
 * Shared AI provider instance.
 * - `ai.generate(options)` — raw generation call
 * - `ai.getQuotaSnapshot()` — diagnostics (safe for all providers)
 * - `ai.isConfigured` — true when a valid API key is present
 * - `ai.providerName` — active provider identifier
 */
export const ai = {
  /** Human-readable name of the default provider. */
  get name(): string {
    return sharedProvider.name;
  },
  /** True when at least one provider has usable credentials. */
  get isConfigured(): boolean {
    return isAnyProviderConfigured();
  },
  /** @deprecated Use `providerIdFor(capability)`. */
  providerName: activeProviderName,

  /**
   * Raw generation against the default provider (legacy path).
   *
   * Refused when no provider is available, which includes AI switched off
   * for the instance: the default provider then falls back to a Gemini
   * adapter with a placeholder key, and the request would still go to Google.
   */
  generate(options: AIGenerateOptions): Promise<AIGenerateResult> {
    if (!isAnyProviderConfigured()) {
      return Promise.reject(
        new AppError("No AI provider is available", 503, {
          code: "AI_CAPABILITY_UNAVAILABLE",
        }),
      );
    }
    return sharedProvider.generate(options);
  },

  /**
   * Safe quota snapshot accessor. Returns the default provider's snapshot when
   * available (Gemini), or an empty snapshot for providers without quota
   * tracking.
   */
  getQuotaSnapshot(): DiagnosticsSnapshot {
    return sharedProvider.getQuotaSnapshot?.() ?? EMPTY_SNAPSHOT;
  },
};

// ---------------------------------------------------------------------------
// Business Function Re-exports
// ---------------------------------------------------------------------------

export { synthesizeSearchResults, parseSearchQuery } from "./aiService.ts";
// ---------------------------------------------------------------------------
// Capability Routing
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The instance switch (AI off for every account)
// ---------------------------------------------------------------------------
