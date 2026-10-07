// Resolves and caches every configured AI provider. A provider is configured
// when it has an API key (from env or the settings store) or, for an
// OpenAI-compatible endpoint, a base URL. Instances are cached per provider id,
// so per-provider singletons (Gemini's SmartRouter, QuotaTracker and circuit
// breakers) stay single. A key saved in Settings is sealed with the instance
// secret (readStoredKey below).

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

/** "dummy_key" is Gemini's sentinel for "no key configured". */
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
 * A key as the settings store holds it, ready to send. Every saved key is
 * sealed, so a value that is not sealed reads as no key. So does a sealed key
 * that does not open, after the instance secret changed (CONTRACK_SECRET_KEY
 * set or changed, or DATA_DIR/secret.key lost): the provider shows as not
 * connected and the key can be entered again, instead of failing at the
 * provider with a message that points nowhere near the cause.
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
        `The saved key for ${owner} cannot be decrypted, because the instance secret changed. Enter the key again in Settings → Administration → AI.`,
      );
    }
    return undefined;
  }
}

/**
 * All configured providers. An env key takes precedence over a settings key for
 * the same provider.
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
 * The models discovered for a provider, as the settings service cached them
 * when the key or endpoint was saved, or empty. Here and not in
 * aiSettingsService because capability resolution needs it, and
 * aiSettingsService imports this module: the reverse would be a cycle.
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
 * Resolve and cache a provider by id. Null when it is not configured, and for
 * every provider while AI is off for the instance. Every outbound AI call gets
 * its provider here (generation, provider embedding, model discovery and the
 * model test before a pin), so the instance switch is checked once, here.
 * `getProviderConfigs` does not check it, so Settings still lists the stored
 * keys and endpoints while AI is off.
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

/** The provider id AI_PROVIDER names, Gemini by default. */
export function defaultProviderId(): string {
  return (process.env.AI_PROVIDER ?? "gemini").toLowerCase();
}
