// Capability-based routing. People configure capabilities ("what runs my search
// understanding?"), not providers. This maps each capability to a provider and
// model at call time, in priority order:
//
//   1. A pin saved in Settings → Administration → AI.
//   2. An env override (AI_QUICK_MODEL / AI_DEEP_MODEL / AI_RESEARCH_MODEL).
//   3. Auto: AI_PROVIDER first, then a fixed preference order over the
//      providers that have credentials.
//
// Capabilities:
//   quick      Magic Paste, mentions, query planning, verification,
//              daily insight  (internal class: lite)
//   deep       briefings, email summaries, dedupe adjudication, extraction
//              (internal class: flash)
//   research   grounded web research for AI Search  (internal class: flash)
//   embeddings semantic search and duplicate similarity  (see embeddings.ts)
//
// Research runs on the middle class, not the top one: reading a few pages about
// a person and filling a form is what Sonnet 5, GPT-6 Sol and Gemini 3.8 Flash
// do well. The top class cost twice as much on Anthropic (Opus 5.5: 44 s, about
// $0.30 a contact, against Sonnet 5's 36 s and $0.15) and five times as much on
// OpenAI (Astra). Somebody who wants the flagship pins it.

import type { AIProvider } from "./provider.ts";
import type { ModelClass } from "./routing/registry.ts";
import {
  getProvider,
  getProviderConfig,
  getProviderConfigs,
  getCachedModels,
  defaultProviderId,
  type ProviderConfig,
} from "./providerRegistry.ts";
import { getSetting, SETTING_KEYS } from "../services/settingsService.ts";
import { log } from "../utils/logger.ts";
import { isAiOffForInstance } from "./instanceSwitch.ts";
import { getWebSearchPolicy } from "./webSearchPolicy.ts";

/** User-facing AI capabilities. */
export type AICapability = "quick" | "deep" | "research" | "embeddings";

/** How a capability is configured. */
export interface CapabilityAssignment {
  /**
   * - "auto":   resolve from available providers (default)
   * - "pinned": use `providerId` + `model` exactly
   */
  mode: "auto" | "pinned";
  providerId?: string;
  model?: string;
}

export interface ResolvedCapability {
  capability: AICapability;
  providerId: string;
  provider: AIProvider;
  /** Explicit model id when pinned; undefined lets the adapter's router pick. */
  model?: string;
  /** Internal routing class passed to native adapters. */
  modelClass: ModelClass;
  /**
   * Which step chose it: a pin saved in the app, the `AI_*_MODEL` variable,
   * or Automatic. The settings page names it, so a model the environment
   * chose is not shown as Automatic.
   */
  source: CapabilitySource;
}

/** Which step of `resolveCapability` chose the model. */
export type CapabilitySource = "pinned" | "env" | "auto";

/** Internal model class backing each generation capability. */
const CAPABILITY_CLASS: Record<
  Exclude<AICapability, "embeddings">,
  ModelClass
> = {
  quick: "lite",
  deep: "flash",
  research: "flash",
};

/**
 * Auto-mode preference order per capability, after AI_PROVIDER. The order
 * reflects price and quality fit, and is data, not logic.
 */
const AUTO_ORDER: Record<Exclude<AICapability, "embeddings">, string[]> = {
  quick: ["gemini", "openai", "anthropic"],
  deep: ["gemini", "anthropic", "openai"],
  research: ["gemini", "anthropic", "openai"],
};

/** Env overrides, checked before auto-resolution. */
const ENV_OVERRIDE: Record<AICapability, string> = {
  quick: "AI_QUICK_MODEL",
  deep: "AI_DEEP_MODEL",
  research: "AI_RESEARCH_MODEL",
  embeddings: "AI_EMBEDDINGS_MODEL",
};

/** The variable that pins a capability's model from the environment. */
export function envOverrideVariable(capability: AICapability): string {
  return ENV_OVERRIDE[capability];
}

/** The internal model class a generation capability runs on. */
export function classForCapability(
  capability: Exclude<AICapability, "embeddings">,
): ModelClass {
  return CAPABILITY_CLASS[capability];
}

/** Read all capability assignments (settings store). */
export function getCapabilityAssignments(): Partial<
  Record<AICapability, CapabilityAssignment>
> {
  return (
    getSetting<Partial<Record<AICapability, CapabilityAssignment>>>(
      SETTING_KEYS.aiCapabilities,
    ) ?? {}
  );
}

/** Read one capability's assignment, defaulting to auto. */
export function getCapabilityAssignment(
  capability: AICapability,
): CapabilityAssignment {
  const assignments = getCapabilityAssignments();
  return (
    assignments[capability] ?? {
      mode: "auto",
    }
  );
}

/**
 * True when an admin turned "Allow web search" off (webSearchPolicy.ts).
 * Research through SearXNG resolves no provider, so `resolveCapability` alone
 * cannot stop it, and every research path asks this too.
 */
export function isResearchOff(): boolean {
  return getWebSearchPolicy().off;
}

/**
 * Parse an env override of the form "provider:model" or bare "model"
 * (bare uses the default provider).
 */
export function parseEnvOverride(
  value: string,
): { providerId: string; model: string } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf(":");
  // Guard against URLs / colons inside model names: only treat the prefix as a
  // provider when it matches a configured provider id.
  if (idx > 0) {
    const maybeProvider = trimmed.slice(0, idx);
    const known = getProviderConfigs().some((c) => c.id === maybeProvider);
    if (known) {
      return { providerId: maybeProvider, model: trimmed.slice(idx + 1) };
    }
  }
  return { providerId: defaultProviderId(), model: trimmed };
}

/**
 * The model auto mode uses on a provider with no router of its own.
 *
 * The three native adapters map a model class to a model themselves, so auto
 * mode passes them none. An OpenAI-compatible endpoint has no such map (its
 * models are whatever the operator pulled), so auto mode must name one, or
 * every request on a correctly connected endpoint fails.
 *
 * The source is the catalog discovered when the endpoint was saved, in the
 * endpoint's own order, so every call picks the same model. Quick and deep land
 * on the same model: nothing in the catalog says which is cheaper, and a
 * ranking guessed from names would be invisible to the user. Pin the
 * capabilities in Settings → Administration → AI to split them.
 *
 * Undefined for native providers, and when no chat model is cached, which
 * `resolveCapability` treats as "this provider cannot serve it".
 */
function autoModelFor(config: ProviderConfig): string | undefined {
  if (config.kind !== "openai-compatible") return undefined;
  return getCachedModels(config.id).find((model) =>
    model.capabilities.includes("chat"),
  )?.id;
}

/**
 * Resolve a generation capability to a provider and model. Null when nothing is
 * configured (callers fall back to mock mode), when the capability is disabled,
 * or while AI is off for the instance.
 */
export function resolveCapability(
  capability: Exclude<AICapability, "embeddings">,
): ResolvedCapability | null {
  // getProvider would answer null for every candidate anyway. Stopping here
  // keeps a pinned capability from logging "pinned to unavailable provider"
  // on every call while an admin has AI off.
  if (isAiOffForInstance()) return null;

  const modelClass = CAPABILITY_CLASS[capability];
  const assignment = getCapabilityAssignment(capability);

  // 1. Explicit pin
  if (assignment.mode === "pinned" && assignment.providerId) {
    const provider = getProvider(assignment.providerId);
    if (provider) {
      const config = getProviderConfig(assignment.providerId);
      return {
        capability,
        providerId: assignment.providerId,
        provider,
        // A pin may name a provider and leave the model out — the API accepts
        // that, and it means "use this endpoint, you choose". Native adapters
        // choose for themselves; a compat endpoint needs one named here.
        model: assignment.model ?? (config ? autoModelFor(config) : undefined),
        modelClass,
        source: "pinned",
      };
    }
    log.warn(
      "AICapabilities",
      `${capability} is pinned to unavailable provider "${assignment.providerId}" — falling back to auto`,
    );
  }

  // 2. Env override
  const envValue = process.env[ENV_OVERRIDE[capability]];
  if (envValue) {
    const parsed = parseEnvOverride(envValue);
    if (parsed) {
      const provider = getProvider(parsed.providerId);
      if (provider) {
        return {
          capability,
          providerId: parsed.providerId,
          provider,
          model: parsed.model,
          modelClass,
          source: "env",
        };
      }
    }
  }

  // 3. Auto: AI_PROVIDER first, then the preference order, then anything
  //    configured.
  const configured = getProviderConfigs();
  const candidates = [
    defaultProviderId(),
    ...AUTO_ORDER[capability],
    ...configured.map((c) => c.id),
  ];

  for (const id of candidates) {
    const config = configured.find((c) => c.id === id);
    if (!config) continue;
    // Research needs grounding; custom compat endpoints can't do it natively.
    if (capability === "research" && config.kind === "openai-compatible") {
      continue;
    }
    const provider = getProvider(id);
    if (!provider) continue;
    if (
      capability === "research" &&
      provider.supportsSearchGrounding === false
    ) {
      continue;
    }
    // A compat endpoint with no discovered chat model cannot be called at all.
    // Skipping it here surfaces the actionable "no provider can serve this"
    // message instead of an adapter error about a missing model id.
    const model = autoModelFor(config);
    if (config.kind === "openai-compatible" && !model) {
      log.warn(
        "AICapabilities",
        `Skipping "${id}" for ${capability}: no chat model discovered — refresh its model list in Settings → Administration → AI`,
      );
      continue;
    }
    return {
      capability,
      providerId: id,
      provider,
      model,
      modelClass,
      source: "auto",
    };
  }

  return null;
}

/**
 * Which providers could serve each capability now, for Settings and the "no
 * provider configured" empty states.
 */
export function capabilityAvailability(): Record<
  Exclude<AICapability, "embeddings">,
  boolean
> {
  return {
    quick: resolveCapability("quick") !== null,
    deep: resolveCapability("deep") !== null,
    research: resolveCapability("research") !== null,
  };
}

/**
 * The provider and model a capability runs on now, for the screens that name
 * it: Settings, the admin Health page and /api/ai/diagnostics. The model is
 * the pin when there is one, else what the adapter would pick, which a
 * custom endpoint cannot say in advance (null).
 */
export function capabilityTarget(
  capability: Exclude<AICapability, "embeddings">,
): { providerId: string; model: string | null } | null {
  const resolved = resolveCapability(capability);
  if (!resolved) return null;
  return {
    providerId: resolved.providerId,
    model:
      resolved.model ??
      resolved.provider.defaultModelFor?.(resolved.modelClass, {
        grounding: capability === "research",
      }) ??
      null,
  };
}
