// =============================================================================
// AI Layer — Shared Provider Singleton
// =============================================================================
// Single source of truth for the resolved AI provider instance.
//
// WHY THIS EXISTS:
// Both `index.ts` (barrel) and `aiService.ts` (business functions) need
// the same adapter instance. Without this module, each would create
// its own — causing duplicate QuotaTrackers, independent circuit breakers,
// and blind spots in quota tracking.
//
// This module breaks the circular dependency between index.ts and aiService.ts
// by being imported by both without importing from either.
//
// v2.0: Multi-provider support — resolves the active AIProvider based on
// AI_PROVIDER env var. Supports "gemini" (default), "openai", "anthropic".
// =============================================================================

import type { AIProvider } from "./provider.ts";
import type { AIProviderName } from "./types.ts";
import { GeminiAdapter } from "./adapters/gemini.ts";
import { OpenAIAdapter } from "./adapters/openai.ts";
import { AnthropicAdapter } from "./adapters/anthropic.ts";
import { log } from "../utils/logger.ts";

// ---------------------------------------------------------------------------
// Provider Factory (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Create an AIProvider instance for the given provider name and API key.
 * This factory is the single decision point for adapter selection.
 *
 * Falls back to Gemini for unknown provider names with a warning.
 */
export function createProvider(
  providerName: string,
  apiKey: string,
): AIProvider {
  switch (providerName.toLowerCase()) {
    case "gemini":
      return new GeminiAdapter(apiKey);
    case "openai":
      return new OpenAIAdapter(apiKey);
    case "anthropic":
      return new AnthropicAdapter(apiKey);
    default:
      log.warn(
        "AIService",
        `Unknown AI_PROVIDER "${providerName}", falling back to Gemini`,
      );
      return new GeminiAdapter(apiKey);
  }
}

/**
 * Resolve the correct API key environment variable for a given provider.
 */
export function getApiKeyForProvider(providerName: string): string | undefined {
  switch (providerName.toLowerCase()) {
    case "gemini":
      return process.env.GEMINI_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    default:
      return process.env.GEMINI_API_KEY;
  }
}

// ---------------------------------------------------------------------------
// Provider Resolution
// ---------------------------------------------------------------------------

const _providerName = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();
const _apiKey = getApiKeyForProvider(_providerName);

/**
 * Determine if the active provider is properly configured with a valid API key.
 */
function _isConfigured(
  providerName: string,
  apiKey: string | undefined,
): boolean {
  if (!apiKey) return false;
  // Gemini has a special "dummy_key" sentinel value
  if (providerName === "gemini" && apiKey === "dummy_key") return false;
  return true;
}

const _configured = _isConfigured(_providerName, _apiKey);

if (!_configured) {
  const keyVarName =
    _providerName === "openai"
      ? "OPENAI_API_KEY"
      : _providerName === "anthropic"
        ? "ANTHROPIC_API_KEY"
        : "GEMINI_API_KEY";
  log.warn(
    "AIService",
    `${keyVarName} not configured — AI functions will use mock responses`,
  );
}

// ---------------------------------------------------------------------------
// Shared Instance
// ---------------------------------------------------------------------------

/**
 * The single shared AIProvider instance for the entire application.
 *
 * All AI calls — whether from aiService.ts business functions, the ai barrel
 * export, dedupe, or aiSearch routes — go through this one adapter. This
 * ensures a single QuotaTracker, single SmartRouter, and single set of
 * circuit breakers for accurate quota management.
 */
export const sharedProvider = createProvider(
  _providerName,
  _apiKey || "dummy_key",
);

/** Whether the provider is properly configured with a valid API key. */
export const isProviderConfigured = _configured;

log.info(
  "AIService",
  `Initialized with provider: ${sharedProvider.name} (AI_PROVIDER=${_providerName})`,
);
