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

/**
 * Shared AI provider instance.
 * - `ai.generate(options)` — raw generation call
 * - `ai.getQuotaSnapshot()` — diagnostics
 * - `ai.isConfigured` — true when a valid API key is present
 */
export const ai = Object.assign(sharedProvider, {
  isConfigured: isProviderConfigured,
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
} from "./aiService.ts";
export type { DailyInsight } from "./aiService.ts";
