// =============================================================================
// AI Layer — Shared Provider Singleton
// =============================================================================
// Single source of truth for the resolved AI provider instance.
//
// WHY THIS EXISTS:
// Both `index.ts` (barrel) and `aiService.ts` (business functions) need
// the same GeminiAdapter instance. Without this module, each would create
// its own — causing duplicate QuotaTrackers, independent circuit breakers,
// and blind spots in quota tracking.
//
// This module breaks the circular dependency between index.ts and aiService.ts
// by being imported by both without importing from either.
// =============================================================================

import { GeminiAdapter } from "./adapters/gemini.ts";
import { log } from "../utils/logger.ts";

// ---------------------------------------------------------------------------
// Provider Resolution
// ---------------------------------------------------------------------------

const _providerName = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();
const _apiKey = process.env.GEMINI_API_KEY;

const _configured = !!(
  _apiKey &&
  _apiKey !== "dummy_key" &&
  _providerName === "gemini"
);

if (!_configured) {
  log.warn(
    "AIService",
    _providerName !== "gemini"
      ? `Unknown AI_PROVIDER "${_providerName}", falling back to Gemini (unconfigured)`
      : "GEMINI_API_KEY not configured — AI functions will use mock responses",
  );
}

// ---------------------------------------------------------------------------
// Shared Instance
// ---------------------------------------------------------------------------

/**
 * The single shared GeminiAdapter instance for the entire application.
 *
 * All AI calls — whether from aiService.ts business functions, the ai barrel
 * export, dedupe, or aiSearch routes — go through this one adapter. This
 * ensures a single QuotaTracker, single SmartRouter, and single set of
 * circuit breakers for accurate quota management.
 */
export const sharedProvider = new GeminiAdapter(_apiKey || "dummy_key");

/** Whether the provider is properly configured with a valid API key. */
export const isProviderConfigured = _configured;

log.info("AIService", `Initialized with provider: ${sharedProvider.name}`);
