// =============================================================================
// AI Layer — Gemini Model Registry
// =============================================================================
// The Gemini models the router may pick when a capability is on Auto, with
// what each is for. There is no free or paid profile here any more. Google
// decides a key's limits from its Cloud project's billing, publishes no
// free-tier numbers, and changes them without notice, so a table of guessed
// limits either throttled paid keys or let free keys run into 429s. The
// router now learns a limit from the 429 itself (see SmartRouter and the
// Gemini adapter's circuit breaker).
//
// MAINTENANCE: add a model when Google ships one. Models the key can see but
// this list lacks are added from discovery (getActiveGeminiRegistry), so a new
// generation is picked up without a release.
// Prices: https://ai.google.dev/gemini-api/docs/pricing (September 2026).
// =============================================================================

import {
  isChatModel,
  inferModelFamily,
  familyToModelClass,
  extractGeneration,
  isPreviewVariant,
  getDiscoveredModelsForProvider,
} from "../modelFilter.ts";

/**
 * Stability tier for a model.
 * - "stable": GA model
 * - "preview": may change behavior or be withdrawn; sorts after stable
 */
export type ModelStability = "stable" | "preview";

/**
 * Functional model class — describes what tier of capability the model offers.
 * Used by consumers to express a preference via `routing.prefer`.
 * - "lite":  Cheapest, fastest — good for simple extraction/classification
 * - "flash": Mid-tier — reasoning, summarization, structured output, research
 * - "pro":   Most capable, slowest and dearest
 */
export type ModelClass = "lite" | "flash" | "pro";

export interface ModelConfig {
  /** Model identifier as accepted by the Gemini API */
  id: string;

  /** Functional class — lite, flash, or pro */
  modelClass: ModelClass;

  /** Generation number (3.8 for Gemini 3.8, 2.5 for Gemini 2.5) */
  generation: number;

  /** Stability tier — preview models sort after stable ones */
  stability: ModelStability;

  /**
   * Paid price per 1M output tokens in USD. Breaks a tie between two models
   * of one class and generation, cheapest first.
   */
  costPerM: number;

  /** Whether this model supports Google Search grounding. */
  supportsGrounding: boolean;
}

// =============================================================================
// Model Registry
// =============================================================================
// No 2.5 models. Google serves them to existing projects only, and a new key
// gets 404 "This model models/gemini-2.5-flash is no longer available to new
// users" (tested 2026-09-26). As the router's last fallback they failed every
// time they were reached.
// =============================================================================

export const GEMINI_REGISTRY: ModelConfig[] = [
  {
    id: "gemini-3.8-flash",
    modelClass: "flash",
    generation: 3.8,
    stability: "stable",
    costPerM: 3.75,
    supportsGrounding: true,
  },
  {
    id: "gemini-3.7-flash",
    modelClass: "flash",
    generation: 3.7,
    stability: "stable",
    costPerM: 3.75,
    supportsGrounding: true,
  },
  {
    id: "gemini-3.6-flash",
    modelClass: "flash",
    generation: 3.6,
    stability: "stable",
    costPerM: 3.75,
    supportsGrounding: true,
  },
  {
    id: "gemini-3.5-flash",
    modelClass: "flash",
    generation: 3.5,
    stability: "stable",
    costPerM: 9.0,
    supportsGrounding: true,
  },
  {
    id: "gemini-3.5-flash-lite",
    modelClass: "lite",
    generation: 3.5,
    stability: "stable",
    costPerM: 2.5,
    supportsGrounding: true,
  },
  {
    id: "gemini-3.1-flash-lite",
    modelClass: "lite",
    generation: 3.1,
    stability: "stable",
    costPerM: 1.5,
    supportsGrounding: true,
  },
  {
    id: "gemini-3.1-pro-preview",
    modelClass: "pro",
    generation: 3.1,
    stability: "preview",
    costPerM: 12.0,
    supportsGrounding: true,
  },
];

/** A class's price when discovery finds a model this list does not know. */
const DISCOVERED_COST: Record<ModelClass, number> = {
  lite: 2.5,
  flash: 3.75,
  pro: 12.0,
};

// =============================================================================
// Registry Helpers
// =============================================================================

/**
 * Return the active Gemini registry, enriched with models discovery found
 * that the list above lacks, so a newer generation is available without a
 * code change.
 */
export function getActiveGeminiRegistry(): ModelConfig[] {
  const base = [...GEMINI_REGISTRY];
  try {
    const discovered = getDiscoveredModelsForProvider("gemini");
    if (!discovered || discovered.length === 0) return base;

    const knownIds = new Set(base.map((m) => m.id));
    for (const m of discovered) {
      if (!isChatModel(m.id) || knownIds.has(m.id)) continue;
      const family = inferModelFamily("gemini", m.id);
      const modelClass = familyToModelClass("gemini", family);
      if (!modelClass) continue;

      base.push({
        id: m.id,
        modelClass,
        generation: extractGeneration(m.id) ?? 3,
        stability: isPreviewVariant(m.id) ? "preview" : "stable",
        costPerM: DISCOVERED_COST[modelClass],
        supportsGrounding: m.capabilities.includes("grounding"),
      });
      knownIds.add(m.id);
    }
  } catch {
    // If settings service / DB isn't available, fall back to base
  }
  return base;
}

/** Lookup a model config by ID. Returns undefined if not registered. */
export function getModelConfig(modelId: string): ModelConfig | undefined {
  return getActiveGeminiRegistry().find((m) => m.id === modelId);
}

/**
 * The order the router tries models in for a class: the preferred class
 * first, then the newest generation, stable before preview, cheapest last.
 * One comparator, so the settings screen and the router cannot disagree.
 */
export function compareForClass(
  prefer: ModelClass | undefined,
): (a: ModelConfig, b: ModelConfig) => number {
  return (a, b) => {
    if (prefer) {
      const aPref = a.modelClass === prefer ? 0 : 1;
      const bPref = b.modelClass === prefer ? 0 : 1;
      if (aPref !== bPref) return aPref - bPref;
    }
    if (a.generation !== b.generation) return b.generation - a.generation;
    if (a.stability !== b.stability) return a.stability === "stable" ? -1 : 1;
    return a.costPerM - b.costPerM;
  };
}

/**
 * Which model the router would pick for a class with nothing paused — the
 * answer to "what does Auto actually run?".
 *
 * @returns the model id, or undefined if nothing in the registry qualifies
 */
export function previewModelForClass(
  prefer: ModelClass,
  requiresGrounding = false,
): string | undefined {
  return getActiveGeminiRegistry()
    .filter((m) => !requiresGrounding || m.supportsGrounding)
    .sort(compareForClass(prefer))[0]?.id;
}
