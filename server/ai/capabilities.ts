// =============================================================================
// AI Layer — Capability-Based Routing
// =============================================================================
// Users configure *capabilities* ("what runs my search understanding?"), not
// providers. This module maps each capability to a concrete provider + model
// at call time, using (in priority order):
//
//   1. An explicit pin from the settings store (Settings → AI).
//   2. An env override (AI_QUICK_MODEL / AI_DEEP_MODEL / AI_RESEARCH_PROVIDER).
//   3. Auto: the legacy AI_PROVIDER first (so existing deployments behave
//      identically), then a documented preference order over whatever
//      providers have credentials.
//
// Capabilities:
//   fast       — Magic Paste, mentions, query planning/HyDE, verification,
//                daily insight, search expansion  (internal class: lite)
//   smart      — briefings, email summaries, dedupe adjudication, extraction
//                (internal class: flash)
//   research   — grounded web research for AI Search  (internal class: pro)
//   embeddings — semantic search + duplicate similarity  (see embeddings.ts)
// =============================================================================

import type { AIProvider } from "./provider.ts";
import type { ModelClass } from "./routing/registry.ts";
import {
  getProvider,
  getProviderConfigs,
  defaultProviderId,
} from "./providerRegistry.ts";
import { getSetting, SETTING_KEYS } from "../services/settingsService.ts";
import { log } from "../utils/logger.ts";

/** User-facing AI capabilities. */
export type AICapability = "quick" | "deep" | "research" | "embeddings";

/** How a capability is configured. */
export interface CapabilityAssignment {
  /**
   * - "auto":     resolve from available providers (default)
   * - "pinned":   use `providerId` + `model` exactly
   * - "disabled": capability turned off (research only)
   */
  mode: "auto" | "pinned" | "disabled";
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
}

/** Internal model class backing each generation capability. */
const CAPABILITY_CLASS: Record<
  Exclude<AICapability, "embeddings">,
  ModelClass
> = {
  quick: "lite",
  deep: "flash",
  research: "pro",
};

/**
 * Auto-mode preference order per capability, applied after the legacy
 * AI_PROVIDER. Ordering reflects price/quality fit as of August 2026 and is
 * data, not logic — see docs/recommendations for the rationale.
 */
const AUTO_ORDER: Record<Exclude<AICapability, "embeddings">, string[]> = {
  quick: ["gemini", "openai", "anthropic"],
  deep: ["gemini", "anthropic", "openai"],
  research: ["gemini", "anthropic", "openai"],
};

/** Env overrides, checked before auto-resolution. */
const ENV_OVERRIDE: Record<Exclude<AICapability, "embeddings">, string> = {
  quick: "AI_QUICK_MODEL",
  deep: "AI_DEEP_MODEL",
  research: "AI_RESEARCH_MODEL",
};

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
 * Resolve a generation capability to a concrete provider + model.
 * Returns null when nothing is configured (callers fall back to mock mode)
 * or when the capability is explicitly disabled.
 */
export function resolveCapability(
  capability: Exclude<AICapability, "embeddings">,
): ResolvedCapability | null {
  const modelClass = CAPABILITY_CLASS[capability];
  const assignment = getCapabilityAssignment(capability);

  if (assignment.mode === "disabled") return null;

  // 1. Explicit pin
  if (assignment.mode === "pinned" && assignment.providerId) {
    const provider = getProvider(assignment.providerId);
    if (provider) {
      return {
        capability,
        providerId: assignment.providerId,
        provider,
        model: assignment.model,
        modelClass,
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
        };
      }
    }
  }

  // 3. Auto — legacy AI_PROVIDER first so existing deployments are unchanged,
  //    then the documented preference order, then anything configured at all.
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
    return {
      capability,
      providerId: id,
      provider,
      model: undefined,
      modelClass,
    };
  }

  return null;
}

/**
 * Which providers could serve a capability right now — powers the settings UI
 * and the "no provider configured" empty states.
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
