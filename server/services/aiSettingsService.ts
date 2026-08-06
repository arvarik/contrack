// =============================================================================
// AI Settings Service — provider credentials, capability assignments, models
// =============================================================================
// Backing logic for Settings → AI. Owns:
//   - provider API keys entered through the UI (env keys stay read-only)
//   - custom OpenAI-compatible endpoints
//   - capability assignments (fast / smart / research / embeddings)
//   - the cached model catalog per provider
// =============================================================================

import { getSetting, setSetting, SETTING_KEYS } from "./settingsService.ts";
import {
  getProvider,
  getProviderConfigs,
  invalidateProviderCache,
  type CustomEndpointConfig,
  type ProviderConfig,
} from "../ai/providerRegistry.ts";
import { resolveEmbeddings } from "../ai/embeddings.ts";
import {
  getCapabilityAssignments,
  type AICapability,
  type CapabilityAssignment,
  resolveCapability,
} from "../ai/capabilities.ts";
import type { ModelInfo } from "../ai/provider.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { AppError, ValidationError } from "../utils/AppError.ts";

/** Model list cached per provider. */
export interface CachedModelList {
  models: ModelInfo[];
  fetchedAt: string;
  /** Present when the last refresh failed; the stale list is still served. */
  error?: string;
}

/** How long a cached model list is considered fresh. */
const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Provider credentials
// ---------------------------------------------------------------------------

/** Mask a secret for display: last 4 characters only. */
function redact(key: string | undefined): string | undefined {
  if (!key) return undefined;
  return key.length <= 4 ? "••••" : `••••${key.slice(-4)}`;
}

/** Store an API key for a built-in provider. */
export function setProviderKey(providerId: string, apiKey: string): void {
  if (!["gemini", "openai", "anthropic"].includes(providerId)) {
    throw new ValidationError(`Unknown provider "${providerId}"`);
  }
  const keys =
    getSetting<Record<string, string>>(SETTING_KEYS.aiProviderKeys) ?? {};
  keys[providerId] = apiKey.trim();
  setSetting(SETTING_KEYS.aiProviderKeys, keys);
  invalidateProviderCache();
}

/** Remove a stored API key (env-provided keys are unaffected). */
export function deleteProviderKey(providerId: string): void {
  const keys =
    getSetting<Record<string, string>>(SETTING_KEYS.aiProviderKeys) ?? {};
  delete keys[providerId];
  setSetting(SETTING_KEYS.aiProviderKeys, keys);
  invalidateProviderCache();
}

// ---------------------------------------------------------------------------
// Custom OpenAI-compatible endpoints
// ---------------------------------------------------------------------------

export function listCustomEndpoints(): CustomEndpointConfig[] {
  return (
    getSetting<CustomEndpointConfig[]>(SETTING_KEYS.aiCustomEndpoints) ?? []
  );
}

export function upsertCustomEndpoint(endpoint: CustomEndpointConfig): void {
  if (!endpoint.id?.trim())
    throw new ValidationError("Endpoint id is required");
  if (!/^https?:\/\//i.test(endpoint.baseUrl ?? "")) {
    throw new ValidationError("Endpoint baseUrl must be an http(s) URL");
  }
  const endpoints = listCustomEndpoints();
  const index = endpoints.findIndex((e) => e.id === endpoint.id);
  if (index >= 0) endpoints[index] = endpoint;
  else endpoints.push(endpoint);
  setSetting(SETTING_KEYS.aiCustomEndpoints, endpoints);
  invalidateProviderCache();
}

export function deleteCustomEndpoint(id: string): void {
  setSetting(
    SETTING_KEYS.aiCustomEndpoints,
    listCustomEndpoints().filter((e) => e.id !== id),
  );
  invalidateProviderCache();
}

// ---------------------------------------------------------------------------
// Capability assignments
// ---------------------------------------------------------------------------

const VALID_CAPABILITIES: AICapability[] = [
  "quick",
  "deep",
  "research",
  "embeddings",
];

export function setCapabilityAssignment(
  capability: AICapability,
  assignment: CapabilityAssignment,
): void {
  if (!VALID_CAPABILITIES.includes(capability)) {
    throw new ValidationError(`Unknown capability "${capability}"`);
  }
  if (!["auto", "pinned", "disabled"].includes(assignment.mode)) {
    throw new ValidationError(`Unknown mode "${assignment.mode}"`);
  }
  if (assignment.mode === "pinned" && !assignment.providerId) {
    throw new ValidationError("A pinned capability requires a providerId");
  }
  const assignments = getCapabilityAssignments();
  assignments[capability] = assignment;
  setSetting(SETTING_KEYS.aiCapabilities, assignments);
}

// ---------------------------------------------------------------------------
// Model discovery + cache
// ---------------------------------------------------------------------------

function readModelCache(): Record<string, CachedModelList> {
  return (
    getSetting<Record<string, CachedModelList>>(SETTING_KEYS.aiModelCache) ?? {}
  );
}

function writeModelCache(cache: Record<string, CachedModelList>): void {
  setSetting(SETTING_KEYS.aiModelCache, cache);
}

/** Cached models for a provider (may be stale; never triggers a fetch). */
export function getCachedModels(providerId: string): CachedModelList | null {
  return readModelCache()[providerId] ?? null;
}

/**
 * Fetch and cache a provider's model list. Throws when discovery fails so the
 * caller (key validation) can surface an actionable error; the previous list
 * is retained with an `error` marker.
 */
export async function refreshModels(
  providerId: string,
): Promise<CachedModelList> {
  const provider = getProvider(providerId);
  if (!provider) {
    throw new AppError(`Provider "${providerId}" is not configured`, 400, {
      code: "PROVIDER_NOT_CONFIGURED",
    });
  }
  if (!provider.listModels) {
    throw new AppError(
      `Provider "${providerId}" does not support model discovery`,
      400,
      { code: "DISCOVERY_UNSUPPORTED" },
    );
  }

  const cache = readModelCache();
  try {
    const models = await provider.listModels();
    const entry: CachedModelList = {
      models,
      fetchedAt: new Date().toISOString(),
    };
    cache[providerId] = entry;
    writeModelCache(cache);
    log.info(
      "AISettings",
      `Discovered ${models.length} models for ${providerId}`,
    );
    return entry;
  } catch (err) {
    const message = getErrorMessage(err);
    const previous = cache[providerId];
    cache[providerId] = {
      models: previous?.models ?? [],
      fetchedAt: previous?.fetchedAt ?? new Date().toISOString(),
      error: message,
    };
    writeModelCache(cache);
    throw new AppError(`Model discovery failed: ${message}`, 502, {
      code: "DISCOVERY_FAILED",
    });
  }
}

/** Refresh any provider whose cache is missing or older than the TTL. */
export async function refreshStaleModelCaches(): Promise<void> {
  const cache = readModelCache();
  const now = Date.now();
  for (const config of getProviderConfigs()) {
    const entry = cache[config.id];
    const isFresh =
      entry &&
      !entry.error &&
      now - new Date(entry.fetchedAt).getTime() < MODEL_CACHE_TTL_MS;
    if (isFresh) continue;
    try {
      await refreshModels(config.id);
    } catch (err) {
      log.warn(
        "AISettings",
        `Background model refresh failed for ${config.id}: ${getErrorMessage(err)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Aggregate view for the settings UI
// ---------------------------------------------------------------------------

export interface AISettingsView {
  providers: {
    id: string;
    label: string;
    kind: string;
    source: "env" | "settings";
    keyPreview?: string;
    /** Null when never discovered. */
    modelCount: number | null;
    modelsFetchedAt?: string;
    modelsError?: string;
    supportsDiscovery: boolean;
    supportsGrounding: boolean;
  }[];
  /** Built-in providers with no credentials yet — shown as "Add key". */
  availableProviders: { id: string; label: string }[];
  customEndpoints: (CustomEndpointConfig & { keyPreview?: string })[];
  capabilities: Record<
    string,
    {
      assignment: CapabilityAssignment;
      /** What this capability currently resolves to (null when unavailable). */
      resolved: {
        providerId: string;
        model?: string;
        /** Human-readable target — the built-in model has no provider entry. */
        label?: string;
      } | null;
      /**
       * Why `resolved` is null, phrased for the user. Absent when the
       * capability is working, or when it was deliberately disabled.
       */
      unavailableReason?: string;
    }
  >;
  searxngUrl?: string;
}

const BUILT_IN_LABELS: Record<string, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

/**
 * Resolve one capability into what the settings UI should display.
 *
 * Embeddings needs its own path: it resolves through resolveEmbeddings()
 * rather than resolveCapability(), and its Auto target is the built-in local
 * model — which has no provider entry, so it needs an explicit label. Leaving
 * it out made the UI report "nothing available" for a capability that was
 * working perfectly offline.
 */
function resolveForView(
  capability: AICapability,
  assignment: CapabilityAssignment,
  configs: ProviderConfig[],
): AISettingsView["capabilities"][string] {
  if (assignment.mode === "disabled") {
    // Deliberate, so not a problem to explain away.
    return { assignment, resolved: null };
  }

  if (capability === "embeddings") {
    const e = resolveEmbeddings();
    return {
      assignment,
      resolved:
        e.kind === "builtin"
          ? {
              providerId: "builtin",
              model: e.model,
              label: `Built-in local model · ${e.dimension}-dim`,
            }
          : { providerId: e.providerId!, model: e.model },
    };
  }

  const r = resolveCapability(capability);
  if (r) {
    return {
      assignment,
      resolved: { providerId: r.providerId, model: r.model },
    };
  }

  return {
    assignment,
    resolved: null,
    unavailableReason: reasonFor(capability, configs),
  };
}

/** Explain an unavailable capability in terms of what the user can do next. */
function reasonFor(
  capability: AICapability,
  configs: ProviderConfig[],
): string {
  if (configs.length === 0) {
    return "No providers connected. Add an API key above, or a custom endpoint.";
  }
  if (capability === "research") {
    // Research is the one capability a self-hosted stack cannot serve through
    // a model alone — but SearXNG covers it, and when configured the feature
    // genuinely works despite resolving to no provider.
    if (getSetting<{ url: string }>(SETTING_KEYS.aiSearxng)?.url) {
      return "No connected provider offers web search, so research runs through your SearXNG instance.";
    }
    return "No connected provider offers web search. Connect Gemini, OpenAI, or Anthropic, or set a SearXNG URL below.";
  }
  return "No connected provider can serve this capability.";
}

export function getSettingsView(): AISettingsView {
  const configs = getProviderConfigs();
  const cache = readModelCache();

  const providers = configs.map((config) => {
    const provider = getProvider(config.id);
    const entry = cache[config.id];
    return {
      id: config.id,
      label: config.label,
      kind: config.kind,
      source: config.source,
      keyPreview: redact(config.apiKey),
      modelCount: entry ? entry.models.length : null,
      modelsFetchedAt: entry?.fetchedAt,
      modelsError: entry?.error,
      supportsDiscovery: !!provider?.listModels,
      supportsGrounding: provider?.supportsSearchGrounding !== false,
    };
  });

  const configuredIds = new Set(configs.map((c) => c.id));
  const availableProviders = Object.entries(BUILT_IN_LABELS)
    .filter(([id]) => !configuredIds.has(id))
    .map(([id, label]) => ({ id, label }));

  const assignments = getCapabilityAssignments();
  const capabilities: AISettingsView["capabilities"] = {};
  for (const capability of VALID_CAPABILITIES) {
    const assignment = assignments[capability] ?? {
      mode: "auto" as const,
    };
    capabilities[capability] = resolveForView(capability, assignment, configs);
  }

  return {
    providers,
    availableProviders,
    customEndpoints: listCustomEndpoints().map((e) => ({
      ...e,
      apiKey: undefined,
      keyPreview: redact(e.apiKey),
    })),
    capabilities,
    searxngUrl: getSetting<{ url: string }>(SETTING_KEYS.aiSearxng)?.url,
  };
}

/** Models eligible for a capability, grouped for the UI dropdowns. */
export function getModelsForCapability(
  capability: AICapability,
): { providerId: string; providerLabel: string; models: ModelInfo[] }[] {
  const wanted = capability === "embeddings" ? "embeddings" : "chat";
  const cache = readModelCache();
  return getProviderConfigs()
    .map((config) => ({
      providerId: config.id,
      providerLabel: config.label,
      models: (cache[config.id]?.models ?? []).filter((m) =>
        m.capabilities.includes(wanted),
      ),
    }))
    .filter((group) => group.models.length > 0);
}
