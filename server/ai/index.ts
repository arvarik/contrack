// =============================================================================
// AI Layer — Public Barrel Export
// =============================================================================
// Import everything AI-related from this one path.
// Usage:
//   import { ai, aiService } from "../ai/index.ts";
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
} from "./types.ts";

// Shared provider instance — the same resolved provider used everywhere.
// Use this for lower-level programmatic access (e.g. in AI Search strategies,
// deduplication service). Prefer the named function exports in aiService.ts
// when calling well-known business operations.
import { GeminiAdapter } from "./adapters/gemini.ts";

const _apiKey = process.env.GEMINI_API_KEY;
const _configured = !!(
  _apiKey &&
  _apiKey !== "dummy_key" &&
  (process.env.AI_PROVIDER ?? "gemini").toLowerCase() === "gemini"
);

/**
 * Shared AI provider instance.
 * - `ai.generate(options)` — raw generation call
 * - `ai.isConfigured` — true when a valid API key is present
 */
export const ai = Object.assign(new GeminiAdapter(_apiKey || "dummy_key"), {
  isConfigured: _configured,
});

// Re-export all named aiService functions for convenience
export {
  parseContactRecord,
  generateCatchMeUpBriefing,
  extractMentions,
  summarizeEmlEmail,
  semanticContactSearch,
  generateDailyInsight,
} from "./aiService.ts";
export type { DailyInsight } from "./aiService.ts";
