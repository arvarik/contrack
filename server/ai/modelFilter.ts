// =============================================================================
// AI Layer — Model Catalog Guardrails and Family Heuristics
// =============================================================================
// Pure functions that filter raw provider model listings down to the set of
// models suitable for interactive CRM tasks and determine the latest generation
// per model family/class.
//
// Heuristics:
//   1. Modality filter  — drop embeddings, audio/tts, image/video generation,
//                         moderation, and specialized robotics/research agents.
//   2. Recency filter   — drop models released over 1 year ago (when dated).
//   3. Alias dedupe     — collapse pinned snapshots (gpt-4o-2024-08-06) into
//                         their floating alias (gpt-4o).
//   4. Generation       — extract generation numbers (gemini-3.8-flash → 3.8)
//                         to prefer the latest generation within each family.
// =============================================================================

import type { ModelClass } from "./routing/registry.ts";
import type { ModelInfo } from "./provider.ts";
import { getSetting, SETTING_KEYS } from "../services/settingsService.ts";

/** The recency window: 1 year in milliseconds. */
export const RECENCY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Identifier substrings that mark a model as non-conversational.
 * Matching is case-insensitive against the raw model ID.
 */
const NON_CHAT_PATTERNS = [
  // Embeddings
  /embed/i,
  // Audio: transcription, speech synthesis, realtime voice
  /whisper/i,
  /\btts\b|-tts/i,
  /transcribe/i,
  /-audio/i,
  /realtime/i,
  /speech/i,
  // Image / video generation
  /dall-?e/i,
  /imagen/i,
  /veo/i,
  /-image/i,
  /image-generation/i,
  /banana/i, // Google's "Nano Banana" image-generation line
  // Moderation & safety classifiers
  /moderation/i,
  /guard/i,
  // Specialized non-chat systems (music, robotics, agentic research,
  // computer-use automation, IDE-specific endpoints)
  /lyria/i,
  /robotics/i,
  /computer-use/i,
  /deep-research/i,
  /antigravity/i,
  // Legacy completion-only engines
  /babbage/i,
  /davinci/i,
  /-instruct/i,
  // Search / retrieval helper models
  /search-preview/i,
  // Gemini attributed question answering (not a chat model)
  /\baqa\b/i,
];

/**
 * Check if a model ID looks like an interactive chat/reasoning model.
 */
export function isChatModel(modelId: string | undefined | null): boolean {
  if (!modelId) return false;
  return !NON_CHAT_PATTERNS.some((re) => re.test(modelId));
}

/**
 * Check if a release timestamp falls inside the recency window.
 * Models without a timestamp pass the check.
 */
export function isWithinRecencyWindow(
  releasedAtMs: number | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (releasedAtMs === null || releasedAtMs === undefined) return true;
  return nowMs - releasedAtMs <= RECENCY_WINDOW_MS;
}

/** Matches pinned snapshot suffixes: -2024-08-06, -20250219, -0125, @001 */
const SNAPSHOT_SUFFIX_RE = /[-@](\d{4}-\d{2}-\d{2}|\d{8}|\d{3,4})$/;

/**
 * Strip a pinned snapshot suffix from a model ID.
 */
export function baseAliasOf(modelId: string): string {
  return modelId.replace(SNAPSHOT_SUFFIX_RE, "");
}

/**
 * Collapse alias duplicates in a model list.
 */
export function dedupeAliases<T extends { id: string }>(models: T[]): T[] {
  const ids = new Set(models.map((m) => m.id));
  const seen = new Set<string>();
  const result: T[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    const base = baseAliasOf(model.id);
    if (base !== model.id && ids.has(base)) continue;
    result.push(model);
  }
  return result;
}

/**
 * Run catalog guardrails over a raw model list.
 * Preserves models that declare "embeddings" capability if present on the object,
 * otherwise requires isChatModel.
 */
export function applyCatalogGuardrails<
  T extends { id: string; capabilities?: string[]; releasedAt?: number | null },
>(models: T[], nowMs: number = Date.now()): T[] {
  const filtered = models.filter((m) => {
    const isEmbedding = m.capabilities?.includes("embeddings");
    const isChat = isChatModel(m.id);
    if (!isEmbedding && !isChat) return false;
    return isWithinRecencyWindow(m.releasedAt, nowMs);
  });
  return dedupeAliases(filtered);
}

/**
 * Infer the marketing family of a model from its ID.
 */
export function inferModelFamily(
  providerId: string,
  modelId: string,
): string | null {
  const id = (modelId || "").toLowerCase();
  const provider = (providerId || "").toLowerCase();
  if (provider === "gemini") {
    if (id.startsWith("gemma")) return "Gemma";
    if (!id.startsWith("gemini")) return null;
    if (id.includes("flash-lite")) return "Flash-Lite";
    if (id.includes("flash")) return "Flash";
    if (id.includes("pro")) return "Pro";
    return null;
  }
  if (provider === "claude" || provider === "anthropic") {
    if (id.includes("fable")) return "Fable";
    if (id.includes("opus")) return "Opus";
    if (id.includes("sonnet")) return "Sonnet";
    if (id.includes("haiku")) return "Haiku";
    return null;
  }
  if (provider === "openai") {
    if (id.includes("-sol")) return "Flagship";
    if (id.includes("-terra")) return "Balanced";
    if (id.includes("-luna")) return "Fast";
    if (id.includes("nano")) return "Nano";
    if (id.includes("mini")) return "Mini";
    if (/^o\d/.test(id)) return "Reasoning";
    if (id.includes("codex")) return "Codex";
    if (id.startsWith("chatgpt")) return "Chat";
    if (id.startsWith("gpt")) return "Flagship";
    return null;
  }
  return null;
}

/** Display/sort order of families per provider (unknown families sort last). */
const FAMILY_ORDER: Record<string, string[]> = {
  gemini: ["Pro", "Flash", "Flash-Lite", "Gemma"],
  claude: ["Fable", "Opus", "Sonnet", "Haiku"],
  anthropic: ["Fable", "Opus", "Sonnet", "Haiku"],
  openai: [
    "Flagship",
    "Balanced",
    "Fast",
    "Mini",
    "Nano",
    "Reasoning",
    "Codex",
    "Chat",
  ],
};

/**
 * Extract a comparable generation number from a model ID.
 * 'gemini-3.8-flash' → 3.8, 'claude-opus-4-8' → 4.8, 'gpt-5.6-sol' → 5.6
 */
export function extractGeneration(modelId: string): number | null {
  if (!modelId) return null;
  const base = baseAliasOf(modelId).replace(/(\d)-(\d)/g, "$1.$2");
  const match = base.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = parseFloat(match[0]);
  return Number.isNaN(value) ? null : value;
}

/** Matches preview/experimental/floating-alias variants. */
const PREVIEW_VARIANT_RE = /preview|exp\b|experimental|-latest\b|latest$/i;

export function isPreviewVariant(modelId: string): boolean {
  return PREVIEW_VARIANT_RE.test(modelId || "");
}

/**
 * Map a provider model family to Contrack's internal ModelClass.
 */
export function familyToModelClass(
  providerId: string,
  family: string | null,
): ModelClass | null {
  if (!family) return null;
  const provider = providerId.toLowerCase();
  if (provider === "gemini") {
    if (family === "Flash-Lite") return "lite";
    if (family === "Flash") return "flash";
    if (family === "Pro") return "pro";
  }
  if (provider === "anthropic" || provider === "claude") {
    if (family === "Haiku") return "lite";
    if (family === "Sonnet") return "flash";
    if (family === "Opus") return "pro";
  }
  if (provider === "openai") {
    if (family === "Nano" || family === "Fast") return "lite";
    if (family === "Mini" || family === "Balanced") return "flash";
    if (family === "Flagship" || family === "Reasoning") return "pro";
  }
  return null;
}

/**
 * Reduce a model list to the latest generation of each family.
 */
export function keepLatestPerFamily<T extends { id: string }>(
  providerId: string,
  models: T[],
): T[] {
  const groups = new Map<string, T[]>();
  for (const model of models) {
    const family = inferModelFamily(providerId, model.id);
    const key = family ?? "__other__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(model);
  }

  const order = FAMILY_ORDER[providerId.toLowerCase()] || [];
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    const ia =
      a === "__other__"
        ? Infinity
        : order.indexOf(a) === -1
          ? order.length
          : order.indexOf(a);
    const ib =
      b === "__other__"
        ? Infinity
        : order.indexOf(b) === -1
          ? order.length
          : order.indexOf(b);
    return ia - ib;
  });

  const result: T[] = [];
  for (const key of sortedKeys) {
    const group = groups.get(key)!;
    if (key === "__other__") {
      result.push(...group);
      continue;
    }
    const versioned = group.filter((m) => extractGeneration(m.id) !== null);
    let kept: T[];
    if (versioned.length > 0) {
      const maxGen = Math.max(
        ...versioned.map((m) => extractGeneration(m.id)!),
      );
      kept = versioned.filter((m) => extractGeneration(m.id) === maxGen);
      const stable = kept.filter((m) => !isPreviewVariant(m.id));
      if (stable.length > 0) kept = stable;
    } else {
      kept = group;
    }
    kept = kept.filter(
      (m) =>
        !kept.some((other) => other !== m && m.id.startsWith(`${other.id}-`)),
    );
    result.push(...kept);
  }
  return result;
}

/**
 * Find the latest model for a target model class from a list of discovered models.
 */
export function getLatestModelForClass(
  providerId: string,
  modelClass: ModelClass,
  models: { id: string }[],
): string | undefined {
  const chatModels = models.filter((m) => isChatModel(m.id));
  const latest = keepLatestPerFamily(providerId, chatModels);
  for (const m of latest) {
    const family = inferModelFamily(providerId, m.id);
    if (familyToModelClass(providerId, family) === modelClass) {
      return m.id;
    }
  }
  // Fallbacks: if no dedicated lite model exists, Flash/Mini serves lite
  if (modelClass === "lite") {
    for (const m of latest) {
      const family = inferModelFamily(providerId, m.id);
      if (family === "Flash" || family === "Mini") return m.id;
    }
  }
  return undefined;
}

/**
 * Read discovered models from the settings cache for a provider.
 */
export function getDiscoveredModelsForProvider(
  providerId: string,
): ModelInfo[] {
  const cache = getSetting<Record<string, { models?: ModelInfo[] }>>(
    SETTING_KEYS.aiModelCache,
  );
  return cache?.[providerId]?.models ?? [];
}

/**
 * Retrieve the latest model for a provider + class using cached discovered models.
 */
export function getLatestDiscoveredModel(
  providerId: string,
  modelClass: ModelClass,
): string | undefined {
  const models = getDiscoveredModelsForProvider(providerId);
  if (!models || models.length === 0) return undefined;
  return getLatestModelForClass(providerId, modelClass, models);
}

/**
 * Build a human-readable display name from a raw model ID.
 */
export function prettyModelName(modelId: string): string {
  if (!modelId) return "";
  const cleaned = modelId.replace(/^models\//, "");
  return cleaned
    .split(/[-_:/]/)
    .filter(Boolean)
    .map((part) => {
      if (/^gpt/i.test(part)) return part.toUpperCase();
      if (/^\d/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}
