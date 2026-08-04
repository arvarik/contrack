// =============================================================================
// AI Layer — Legacy Default-Provider Accessors
// =============================================================================
// Historically this module owned THE single provider instance. With
// capability-based routing there is no longer one active provider — each
// capability resolves independently (see capabilities.ts / gateway.ts).
//
// What remains here is the legacy surface:
//   - `createProvider()` / `getApiKeyForProvider()` — pure factories, still
//     used by tests and by callers that want a specific adapter.
//   - `sharedProvider` — the AI_PROVIDER-implied default, delegated to the
//     provider registry so instance-scoped state (Gemini's SmartRouter,
//     QuotaTracker, circuit breakers) stays singleton per provider rather
//     than being duplicated between this module and the registry.
// =============================================================================

import type { AIProvider } from "./provider.ts";
import { GeminiAdapter } from "./adapters/gemini.ts";
import { OpenAIAdapter } from "./adapters/openai.ts";
import { AnthropicAdapter } from "./adapters/anthropic.ts";
import {
  getProvider,
  getProviderConfigs,
  defaultProviderId,
} from "./providerRegistry.ts";
import { log } from "../utils/logger.ts";

// ---------------------------------------------------------------------------
// Factories (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Create an AIProvider instance for the given provider name and API key.
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

/** Resolve the API key environment variable for a given provider. */
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
// Legacy default provider
// ---------------------------------------------------------------------------

/**
 * The provider implied by AI_PROVIDER, resolved lazily through the registry
 * so it is the *same instance* capability routing uses. Falls back to an
 * unconfigured Gemini adapter when nothing is configured — callers gate on
 * mock mode before using it.
 */
export function getDefaultProvider(): AIProvider {
  return (
    getProvider(defaultProviderId()) ?? createProvider("gemini", "dummy_key")
  );
}

/**
 * @deprecated Prefer `generateFor(capability, …)` from gateway.ts.
 * Proxied so every property access resolves through the registry at call
 * time — credentials can change at runtime via Settings → AI.
 */
export const sharedProvider: AIProvider = new Proxy({} as AIProvider, {
  get(_target, prop) {
    const provider = getDefaultProvider() as unknown as Record<
      string | symbol,
      unknown
    >;
    const value = provider[prop];
    return typeof value === "function" ? value.bind(provider) : value;
  },
});

/** True when at least one provider has usable credentials. */
export const isProviderConfigured = getProviderConfigs().length > 0;

if (!isProviderConfigured) {
  log.warn(
    "AIService",
    "No AI provider configured — AI functions will use mock responses",
  );
} else {
  log.info(
    "AIService",
    `Configured providers: ${getProviderConfigs()
      .map((c) => c.id)
      .join(", ")} (default: ${defaultProviderId()})`,
  );
}
