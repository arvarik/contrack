// =============================================================================
// AI Layer — Public Barrel Export
// =============================================================================
// Import everything AI-related from this one path.
// Usage:
//   import { ai } from "../ai/index.ts";
//   import type { AIGenerateOptions } from "../ai/index.ts";
// =============================================================================

export type { AIProvider } from "./provider.ts";
export type {
  AIGenerateOptions,
  AIGenerateResult,
  JsonSchemaNode,
  ParsedContact,
  MentionEntity,
  CompressedContact,
  SemanticMatchResult,
  RoutingPolicy,
  DiagnosticsSnapshot,
  ModelUsageSnapshot,
} from "./types.ts";

// Routing utilities available to consumers
export { ParallelQueue } from "./routing/ParallelQueue.ts";

// ---------------------------------------------------------------------------
// Shared Provider Instance
// ---------------------------------------------------------------------------
// The single resolved provider used everywhere. Backed by singleton.ts
// to ensure one QuotaTracker, one SmartRouter, and one set of circuit
// breakers across the entire application.
// ---------------------------------------------------------------------------

import { sharedProvider, isProviderConfigured } from "./singleton.ts";
import type { DiagnosticsSnapshot } from "./types.ts";

/** Empty diagnostics snapshot for providers without quota tracking. */
const EMPTY_SNAPSHOT: DiagnosticsSnapshot = {
  models: {},
  grounding: { rpd: 0, limit: 0, remaining: 0 },
  aiTier: "N/A",
  circuitBreakers: [],
};

/**
 * The active provider name (lowercase), e.g. "gemini", "openai", "anthropic".
 * Routes use this to branch provider-specific logic (grounding checks, strategy selection).
 */
export const activeProviderName = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();

/**
 * Shared AI provider instance.
 * - `ai.generate(options)` — raw generation call
 * - `ai.getQuotaSnapshot()` — diagnostics (safe for all providers)
 * - `ai.isConfigured` — true when a valid API key is present
 * - `ai.providerName` — active provider identifier
 */
export const ai = Object.assign(sharedProvider, {
  isConfigured: isProviderConfigured,
  providerName: activeProviderName,
  /**
   * Safe quota snapshot accessor. Returns the adapter's snapshot when available
   * (Gemini), or an empty snapshot for providers without quota tracking.
   */
  getQuotaSnapshot(): DiagnosticsSnapshot {
    return sharedProvider.getQuotaSnapshot?.() ?? EMPTY_SNAPSHOT;
  },
});

// ---------------------------------------------------------------------------
// Business Function Re-exports
// ---------------------------------------------------------------------------

export {
  parseContactRecord,
  generateCatchMeUpBriefing,
  extractMentions,
  summarizeEmlEmail,
  semanticContactSearch,
  generateDailyInsight,
  bulkParseContacts,
  synthesizeSearchResults,
} from "./aiService.ts";
export type { DailyInsight } from "./aiService.ts";
