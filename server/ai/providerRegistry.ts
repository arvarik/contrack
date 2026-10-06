// =============================================================================
// AI Layer — Provider Registry
// =============================================================================
// Resolves and caches every *configured* AI provider, not just one "active"
// provider. A provider is configured when it has an API key (from env or the
// settings store) or, for OpenAI-compatible endpoints, a base URL.
//
// Instances are cached per provider id so provider-internal state that must
// be a singleton — Gemini's SmartRouter, QuotaTracker, and circuit breakers —
// stays singleton per provider.
//
// A key saved in Settings is stored sealed with the instance secret, the way
// SMTP passwords and connector feeds already were (readStoredKey below).
// =============================================================================

import type { AIProvider, ModelInfo } from "./provider.ts";
import { GeminiAdapter } from "./adapters/gemini.ts";
import { OpenAIAdapter } from "./adapters/openai.ts";
import { AnthropicAdapter } from "./adapters/anthropic.ts";
import { OpenAICompatibleAdapter } from "./adapters/openaiCompatible.ts";
import { getSetting, SETTING_KEYS } from "../services/settingsService.ts";
import { log } from "../utils/logger.ts";
import { open } from "../utils/secretBox.ts";
import { isAiOffForInstance } from "./instanceSwitch.ts";

export type ProviderKind =
  "gemini" | "openai" | "anthropic" | "openai-compatible";

export interface ProviderConfig {
  /** Stable identifier: "gemini" | "openai" | "anthropic" | "custom:<slug>". */
  id: string;
  kind: ProviderKind;
  /** Human-readable name for the settings UI. */
  label: string;
  apiKey?: string;
  /** Only for openai-compatible providers. */
  baseUrl?: string;
  /** Env-sourced keys are read-only in the UI; settings-sourced are editable. */
  source: "env" | "settings";
}

/** A user-defined OpenAI-compatible endpoint (Ollama, vLLM, xAI, …). */
export interface CustomEndpointConfig {
  /** Slug, unique among custom endpoints. */
  id: string;
  label: string;
  baseUrl: string;
  /** Sealed as the settings store holds it (see readStoredKey). */
  apiKey?: string;
}

/** Built-in providers, in the order they appear in the settings UI. */
const BUILT_IN: {
  id: string;
  kind: ProviderKind;
  label: string;
  envVar: string;
}[] = [
  {
    id: "gemini",
    kind: "gemini",
    label: "Google Gemini",
    envVar: "GEMINI_API_KEY",
  },
  { id: "openai", kind: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY" },
  {
    id: "anthropic",
    kind: "anthropic",
    label: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
  },
];

/**
 * The environment variable that holds a built-in provider's key, such as
 * GEMINI_API_KEY, or undefined for a custom endpoint.
 */
export function providerEnvVariable(providerId: string): string | undefined {
  return BUILT_IN.find((builtIn) => builtIn.id === providerId)?.envVar;
}

/** Instance cache, keyed by a config fingerprint so key edits take effect. */
const instances = new Map<
  string,
  { fingerprint: string; provider: AIProvider }
>();

function fingerprint(config: ProviderConfig): string {
  return `${config.kind}|${config.baseUrl ?? ""}|${config.apiKey ?? ""}`;
}

/** Gemini's historical sentinel for "no key configured". */
function isUsableKey(key: string | undefined): key is string {
  return !!key && key.trim().length > 0 && key !== "dummy_key";
}

/** A sealed value from secretBox.seal. */
export function isSealed(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("v1:");
}

/** Sealed values that would not open, so each is reported once. */
const unreadable = new Set<string>();

/**
 * A key as the settings store holds it, ready to send.
 *
 * Every saved key is sealed. A value that is not sealed reads as no key.
 *
 * A sealed key that does not open reads as no key too. This happens when the
 * instance secret changed: CONTRACK_SECRET_KEY was set or changed, or
 * DATA_DIR/secret.key was lost. The provider then shows as not connected,
 * and the key can be entered again. Sending the sealed text as a key would
 * fail at the provider with a message that points nowhere near the cause.
 */
export function readStoredKey(
  value: unknown,
  owner: string,
): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (!isSealed(value)) return undefined;
  try {
    return open(value);
  } catch {
    if (!unreadable.has(value)) {
      unreadable.add(value);
      log.warn(
        "AIRegistry",
        `The saved key for ${owner} cannot be decrypted, because the instance secret changed. Enter the key again in Settings → AI.`,
      );
    }
    return undefined;
  }
}

/**
 * All configured providers. Env keys take precedence over settings keys for
 * the same provider so existing deployments keep working exactly as before.
 */
export function getProviderConfigs(): ProviderConfig[] {
  const settingsKeys =
    getSetting<Record<string, string>>(SETTING_KEYS.aiProviderKeys) ?? {};
  const configs: ProviderConfig[] = [];

  for (const builtIn of BUILT_IN) {
    const envKey = process.env[builtIn.envVar];
    const settingsKey = isUsableKey(envKey)
      ? undefined
      : readStoredKey(settingsKeys[builtIn.id], builtIn.label);
    const apiKey = isUsableKey(envKey)
      ? envKey
      : isUsableKey(settingsKey)
        ? settingsKey
        : undefined;
    if (!apiKey) continue;
    configs.push({
      id: builtIn.id,
      kind: builtIn.kind,
      label: builtIn.label,
      apiKey,
      source: isUsableKey(envKey) ? "env" : "settings",
    });
  }

  const custom =
    getSetting<CustomEndpointConfig[]>(SETTING_KEYS.aiCustomEndpoints) ?? [];
  for (const endpoint of custom) {
    if (!endpoint.baseUrl) continue;
    configs.push({
      id: `custom:${endpoint.id}`,
      kind: "openai-compatible",
      label: endpoint.label || endpoint.id,
      apiKey: readStoredKey(endpoint.apiKey, endpoint.label || endpoint.id),
      baseUrl: endpoint.baseUrl,
      source: "settings",
    });
  }

  return configs;
}

/** Look up one provider's config by id. */
export function getProviderConfig(id: string): ProviderConfig | null {
  return getProviderConfigs().find((c) => c.id === id) ?? null;
}

/**
 * Models discovered for a provider, as cached by the settings service when the
 * key or endpoint was saved. Returns an empty list when discovery never ran.
 *
 * This lives here rather than in aiSettingsService because capability
 * resolution needs it, and aiSettingsService already imports this module —
 * the reverse direction would be a cycle.
 */
export function getCachedModels(providerId: string): ModelInfo[] {
  const cache = getSetting<Record<string, { models?: ModelInfo[] }>>(
    SETTING_KEYS.aiModelCache,
  );
  return cache?.[providerId]?.models ?? [];
}

function instantiate(config: ProviderConfig): AIProvider {
  switch (config.kind) {
    case "gemini":
      return new GeminiAdapter(config.apiKey ?? "dummy_key");
    case "openai":
      return new OpenAIAdapter(config.apiKey ?? "");
    case "anthropic":
      return new AnthropicAdapter(config.apiKey ?? "");
    case "openai-compatible":
      return new OpenAICompatibleAdapter({
        baseUrl: config.baseUrl ?? "",
        apiKey: config.apiKey,
        label: config.label,
      });
  }
}

/**
 * Resolve (and cache) a provider instance by id.
 * Returns null when the provider isn't configured, and for every provider
 * while AI is off for the instance.
 *
 * This is the one place every outbound AI call gets its provider: each
 * generation (through resolveCapability), each provider embedding
 * (embedWithProvider), model discovery and the model test before a pin. So
 * the instance switch is checked here, and nothing else has to remember it.
 * `getProviderConfigs` does not check it, so Settings → Administration → AI still
 * lists the stored keys and endpoints while AI is off.
 */
export function getProvider(id: string): AIProvider | null {
  if (isAiOffForInstance()) return null;
  const config = getProviderConfig(id);
  if (!config) return null;

  const fp = fingerprint(config);
  const cached = instances.get(id);
  if (cached && cached.fingerprint === fp) return cached.provider;

  const provider = instantiate(config);
  instances.set(id, { fingerprint: fp, provider });
  log.info(
    "AIRegistry",
    `Initialized provider "${config.id}" (${config.label})`,
  );
  return provider;
}

/** Drop cached instances — call after credentials or endpoints change. */
export function invalidateProviderCache(): void {
  instances.clear();
}

/** The provider id implied by the legacy AI_PROVIDER env var. */
export function defaultProviderId(): string {
  return (process.env.AI_PROVIDER ?? "gemini").toLowerCase();
}
