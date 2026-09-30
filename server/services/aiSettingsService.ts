import { aiCache } from "../utils/aiCache.ts";
// =============================================================================
// AI Settings Service — provider credentials, capability assignments, models
// =============================================================================
// Backing logic for the AI providers page. Owns:
//   - provider API keys entered through the UI (env keys stay read-only),
//     stored sealed with the instance secret
//   - custom OpenAI-compatible endpoints
//   - capability assignments (fast / smart / research / embeddings)
//   - the cached model catalog per provider
// =============================================================================

import { getSetting, setSetting, SETTING_KEYS } from "./settingsService.ts";
import {
  getProvider,
  getProviderConfig,
  getProviderConfigs,
  getCachedModels,
  invalidateProviderCache,
  isSealed,
  readStoredKey,
  type CustomEndpointConfig,
  type ProviderConfig,
  type ProviderKind,
} from "../ai/providerRegistry.ts";
import { resolveEmbeddings } from "../ai/embeddings.ts";
import {
  instanceAiState,
  isAiOffForInstance,
  type InstanceAiState,
} from "../ai/instanceSwitch.ts";
import {
  classForCapability,
  getCapabilityAssignments,
  type AICapability,
  type CapabilityAssignment,
  resolveCapability,
} from "../ai/capabilities.ts";
import type { ModelInfo } from "../ai/provider.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { AppError, ValidationError } from "../utils/AppError.ts";
import { applyCatalogGuardrails } from "../ai/modelFilter.ts";
import { seal } from "../utils/secretBox.ts";

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

/** Store an API key for a built-in provider, sealed. */
export function setProviderKey(providerId: string, apiKey: string): void {
  if (!["gemini", "openai", "anthropic"].includes(providerId)) {
    throw new ValidationError(`Unknown provider "${providerId}"`);
  }
  const key = apiKey.trim();
  if (!key) throw new ValidationError("API key is required");
  const keys =
    getSetting<Record<string, string>>(SETTING_KEYS.aiProviderKeys) ?? {};
  keys[providerId] = seal(key);
  setSetting(SETTING_KEYS.aiProviderKeys, keys);
  invalidateProviderCache();
  aiCache.invalidateAll();
}

/** Remove a stored API key (env-provided keys are unaffected). */
export function deleteProviderKey(providerId: string): void {
  const keys =
    getSetting<Record<string, string>>(SETTING_KEYS.aiProviderKeys) ?? {};
  delete keys[providerId];
  setSetting(SETTING_KEYS.aiProviderKeys, keys);
  releasePinsFor(providerId);
  invalidateProviderCache();
  aiCache.invalidateAll();
}

/**
 * Return any capability pinned to a departing provider to Auto.
 *
 * A pin outliving its provider fails differently per capability, and one of
 * those ways is silent: quick/deep/research fall back to auto with a warning,
 * but embeddings resolves straight to the dead provider and every embed call
 * throws — semantic search and duplicate detection stop working with nothing
 * in the UI to explain it, because the pin still *looks* valid.
 */
function releasePinsFor(providerId: string): void {
  const assignments = getCapabilityAssignments();
  let changed = false;
  for (const [capability, assignment] of Object.entries(assignments)) {
    if (assignment?.mode === "pinned" && assignment.providerId === providerId) {
      assignments[capability as AICapability] = { mode: "auto" };
      changed = true;
      log.info(
        "AISettings",
        `${capability} was pinned to removed provider "${providerId}" — reset to auto`,
      );
    }
  }
  if (changed) setSetting(SETTING_KEYS.aiCapabilities, assignments);
}

// ---------------------------------------------------------------------------
// Custom OpenAI-compatible endpoints
// ---------------------------------------------------------------------------

/** Custom endpoints as stored: each key is sealed (see readStoredKey). */
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
  const key = endpoint.apiKey?.trim();
  const stored = { ...endpoint, apiKey: key ? seal(key) : undefined };
  const endpoints = listCustomEndpoints();
  const index = endpoints.findIndex((e) => e.id === endpoint.id);
  if (index >= 0) endpoints[index] = stored;
  else endpoints.push(stored);
  setSetting(SETTING_KEYS.aiCustomEndpoints, endpoints);
  invalidateProviderCache();
  aiCache.invalidateAll();
}

export function deleteCustomEndpoint(id: string): void {
  setSetting(
    SETTING_KEYS.aiCustomEndpoints,
    listCustomEndpoints().filter((e) => e.id !== id),
  );
  releasePinsFor(`custom:${id}`);
  invalidateProviderCache();
  aiCache.invalidateAll();
}

/**
 * Seal every key the settings store still holds as plain text. Keys saved
 * before 2.0 were stored that way. Runs at boot, and returns how many keys
 * it sealed.
 *
 * A sealed key is left as it is, so the pass is safe on every boot and from
 * a second instance on the same data. The value is sealed exactly as stored,
 * so the key sent to the provider does not change.
 */
export function sealStoredAiKeys(): number {
  const plain = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0 && !isSealed(value);

  const keys = getSetting<Record<string, string>>(SETTING_KEYS.aiProviderKeys);
  const plainKeys = Object.entries(keys ?? {}).filter(([, v]) => plain(v));
  if (plainKeys.length > 0) {
    const next = { ...keys };
    for (const [id, value] of plainKeys) next[id] = seal(value);
    setSetting(SETTING_KEYS.aiProviderKeys, next);
  }

  const endpoints = listCustomEndpoints();
  const plainEndpoints = endpoints.filter((e) => plain(e.apiKey)).length;
  if (plainEndpoints > 0) {
    setSetting(
      SETTING_KEYS.aiCustomEndpoints,
      endpoints.map((e) =>
        plain(e.apiKey) ? { ...e, apiKey: seal(e.apiKey) } : e,
      ),
    );
  }

  const sealed = plainKeys.length + plainEndpoints;
  if (sealed > 0) {
    log.info(
      "AISettings",
      `Encrypted ${sealed} saved AI key(s) that were stored as plain text`,
    );
  }
  return sealed;
}

// ---------------------------------------------------------------------------
// The instance switch
// ---------------------------------------------------------------------------

/**
 * Refuse work that has to reach a provider while AI is off for the instance.
 *
 * getProvider answers null while it is off, so without this a model refresh
 * or a model test would report "not configured" about a provider that is
 * configured, and send the admin looking for a key problem.
 */
export function assertAiOnForInstance(): void {
  if (!isAiOffForInstance()) return;
  throw new AppError(
    "AI is off for this instance, so Contrack sent nothing to the provider. Turn AI on to do this.",
    409,
    { code: "AI_OFF_FOR_INSTANCE" },
  );
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
  aiCache.invalidateAll();
}

/**
 * Send a pinned model one tiny request, the way its capability will call it,
 * before the pin is saved.
 *
 * The catalog shows what a provider lists, and a provider lists models that
 * cannot answer: on 2026-09-26 OpenAI listed nine deprecated models that
 * answer 404 and seven that Chat Completions refuses. The catalog now leaves
 * those out, and this catches the next one. A research pin is sent with the
 * web-search tool on, because a model can chat and still refuse the tool
 * (Haiku 4.5 refuses the newer search tool). The prompt needs no search, so
 * no search is billed.
 *
 * Only the three built-in providers are tested. A custom endpoint is the
 * operator's own server, which may be down for a reason, and a provider with
 * no key yet has nothing to test.
 */
export async function probeGeneration(
  capability: Exclude<AICapability, "embeddings">,
  providerId: string,
  model?: string,
): Promise<void> {
  assertAiOnForInstance();
  const config = getProviderConfig(providerId);
  if (!config || config.kind === "openai-compatible") return;
  const provider = getProvider(providerId);
  if (!provider) return;
  try {
    await provider.generate({
      prompt: "Reply with the single word OK.",
      responseFormat: "text",
      model,
      maxOutputTokens: 16,
      timeoutMs: capability === "research" ? 45_000 : 20_000,
      enableSearchGrounding: capability === "research",
      routing: { prefer: classForCapability(capability) },
    });
  } catch (err) {
    throw new AppError(
      `${model ?? config.label} did not answer a test request, so the choice was not saved: ${getErrorMessage(err).slice(0, 200)}`,
      502,
      { code: "MODEL_PROBE_FAILED" },
    );
  }
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

/**
 * Fetch and cache a provider's model list. Throws when discovery fails so the
 * caller (key validation) can surface an actionable error; the previous list
 * is retained with an `error` marker.
 */
export async function refreshModels(
  providerId: string,
): Promise<CachedModelList> {
  assertAiOnForInstance();
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
    const rawModels = await provider.listModels();
    const models = applyCatalogGuardrails(rawModels);
    const entry: CachedModelList = {
      models,
      fetchedAt: new Date().toISOString(),
    };
    cache[providerId] = entry;
    writeModelCache(cache);
    log.info(
      "AISettings",
      `Discovered ${models.length} models for ${providerId} (${rawModels.length} raw)`,
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

/**
 * Refresh any provider whose cache is missing or older than the TTL.
 *
 * The server runs this at boot and once a day. While AI is off for the
 * instance it does nothing: a model list request is a provider call too.
 */
export async function refreshStaleModelCaches(): Promise<void> {
  if (isAiOffForInstance()) return;
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
    /**
     * Google answered this Gemini key with a free-tier quota error. Google
     * uses free-tier prompts and responses to improve its products, and
     * every Contrack prompt carries a contact's details.
     */
    freeTier?: boolean;
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
        /** Display name of the provider that will serve this capability. */
        providerLabel: string;
        /**
         * The concrete model that will run. Populated even in Auto mode —
         * "chosen automatically" told the user nothing about what would
         * execute or what it would cost. Undefined only when the provider
         * genuinely cannot say in advance (a custom endpoint).
         */
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
  /** The instance switch: whether any provider call may leave this server. */
  instance: InstanceAiState;
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
              providerLabel: "Built-in",
              model: e.model,
              label: `Built-in local model · ${e.dimension}-dim`,
            }
          : {
              providerId: e.providerId!,
              providerLabel: labelFor(e.providerId!, configs),
              model: e.model,
            },
    };
  }

  const r = resolveCapability(capability);
  if (r) {
    return {
      assignment,
      resolved: {
        providerId: r.providerId,
        providerLabel: labelFor(r.providerId, configs),
        // In Auto mode `resolveCapability` leaves the model to the adapter's
        // own router, so ask the adapter what it would pick. Adapters that
        // cannot answer (custom endpoints) leave this undefined and the UI
        // falls back to naming the provider alone.
        model:
          r.model ??
          r.provider.defaultModelFor?.(r.modelClass, {
            grounding: capability === "research",
          }),
      },
    };
  }

  return {
    assignment,
    resolved: null,
    unavailableReason: reasonFor(capability, configs),
  };
}

/** Display name for a provider id, falling back to the id itself. */
function labelFor(providerId: string, configs: ProviderConfig[]): string {
  return (
    configs.find((c) => c.id === providerId)?.label ??
    BUILT_IN_LABELS[providerId] ??
    providerId
  );
}

/** Explain an unavailable capability in terms of what the user can do next. */
function reasonFor(
  capability: AICapability,
  configs: ProviderConfig[],
): string {
  if (isAiOffForInstance()) return "AI is off for this instance.";
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
  // The common self-hosted case: the only provider is a custom endpoint whose
  // model list was never discovered, so there is no model to call. "No provider
  // can serve this" would send the user looking for a second provider when the
  // one they have needs a refresh.
  const compatWithoutModels = configs.filter(
    (config) =>
      config.kind === "openai-compatible" &&
      !getCachedModels(config.id).some((m) => m.capabilities.includes("chat")),
  );
  if (compatWithoutModels.length === configs.length) {
    const names = compatWithoutModels.map((c) => c.label).join(", ");
    return `No chat models discovered on ${names}. Refresh its model list above — if it stays empty, the endpoint is unreachable or serves no chat models.`;
  }
  return "No connected provider can serve this capability.";
}

/**
 * What each adapter kind can do, for the view while AI is off for the
 * instance. getProvider answers null then, so there is no adapter to ask,
 * and a provider row that lost its "web search" mark or its refresh button
 * would look like a different provider. Every adapter lists its models, and
 * only an OpenAI-compatible endpoint cannot search the web.
 */
const KIND_FEATURES: Record<
  ProviderKind,
  { discovery: boolean; grounding: boolean }
> = {
  gemini: { discovery: true, grounding: true },
  openai: { discovery: true, grounding: true },
  anthropic: { discovery: true, grounding: true },
  "openai-compatible": { discovery: true, grounding: false },
};

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
      supportsDiscovery: provider
        ? !!provider.listModels
        : KIND_FEATURES[config.kind].discovery,
      supportsGrounding: provider
        ? provider.supportsSearchGrounding !== false
        : KIND_FEATURES[config.kind].grounding,
      freeTier: provider?.getQuotaSnapshot?.().freeTier || undefined,
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
      keyPreview: redact(readStoredKey(e.apiKey, e.label || e.id)),
    })),
    capabilities,
    searxngUrl: getSetting<{ url: string }>(SETTING_KEYS.aiSearxng)?.url,
    instance: instanceAiState(),
  };
}

/**
 * Models eligible for a capability, grouped for the UI dropdowns.
 *
 * Research is filtered on "grounding", not "chat". Every chat model used to
 * be offered here, so the web-research picker listed dozens of models that
 * cannot search the web at all — and picking one saved without complaint,
 * then failed on the first enrichment run. Adapters now mark which of their
 * models actually support search grounding (see ModelCapability), and
 * providers that cannot ground at all — every custom OpenAI-compatible
 * endpoint — contribute nothing to this list.
 */
export function getModelsForCapability(
  capability: AICapability,
): { providerId: string; providerLabel: string; models: ModelInfo[] }[] {
  const wanted =
    capability === "embeddings"
      ? "embeddings"
      : capability === "research"
        ? "grounding"
        : "chat";
  const cache = readModelCache();
  return getProviderConfigs()
    .filter((config) => {
      if (capability !== "research") return true;
      return getProvider(config.id)?.supportsSearchGrounding !== false;
    })
    .map((config) => ({
      providerId: config.id,
      providerLabel: config.label,
      models: (cache[config.id]?.models ?? []).filter((m) =>
        m.capabilities.includes(wanted),
      ),
    }))
    .filter((group) => group.models.length > 0);
}
