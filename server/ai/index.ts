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
  ParsedSearchQuery,
  QueryPlan,
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

import { sharedProvider } from "./singleton.ts";
import { isAnyProviderConfigured } from "./gateway.ts";
import type {
  DiagnosticsSnapshot,
  AIGenerateOptions,
  AIGenerateResult,
} from "./types.ts";

/** Empty diagnostics snapshot for providers without quota tracking. */
const EMPTY_SNAPSHOT: DiagnosticsSnapshot = {
  models: {},
  grounding: { rpd: 0, limit: 0, remaining: 0 },
  aiTier: "N/A",
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

  /** Raw generation against the default provider (legacy path). */
  generate(options: AIGenerateOptions): Promise<AIGenerateResult> {
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

export {
  parseContactRecord,
  generateCatchMeUpBriefing,
  extractMentions,
  summarizeEmlEmail,
  generateDailyInsight,
  bulkParseContacts,
  synthesizeSearchResults,
  parseSearchQuery,
  expandQueryForEmbedding,
} from "./aiService.ts";
export type { DailyInsight } from "./aiService.ts";

// ---------------------------------------------------------------------------
// Capability Routing
// ---------------------------------------------------------------------------

export {
  generateFor,
  providerIdFor,
  isAnyProviderConfigured,
} from "./gateway.ts";
export {
  resolveCapability,
  getCapabilityAssignment,
  getCapabilityAssignments,
  capabilityAvailability,
} from "./capabilities.ts";
export type { AICapability, CapabilityAssignment } from "./capabilities.ts";
export {
  getProviderConfigs,
  getProvider,
  isProviderAvailable,
  invalidateProviderCache,
} from "./providerRegistry.ts";
export type {
  ProviderConfig,
  CustomEndpointConfig,
} from "./providerRegistry.ts";
