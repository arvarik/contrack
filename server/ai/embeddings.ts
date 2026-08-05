// =============================================================================
// AI Layer — Embeddings Capability
// =============================================================================
// Resolves the embeddings capability to a concrete backend and owns the
// vector-dimension lifecycle.
//
// Two backends:
//   - "builtin"  → local Transformers.js model (Xenova/all-MiniLM-L6-v2,
//                  384-dim). Zero config, offline, the default.
//   - "provider" → any discovered embedding model on a configured provider
//                  (Gemini Embedding 2, OpenAI text-embedding-*, or an
//                  OpenAI-compatible endpoint such as Ollama's
//                  nomic-embed-text).
//
// Because `vec0` virtual tables have a FIXED dimension, switching models is a
// migration: the table is recreated at the new dimension and every contact is
// re-embedded. The dimension of an arbitrary model isn't knowable up front, so
// it is *probed* once (embed a short string, measure the vector) and cached.
// =============================================================================

import { getProvider } from "./providerRegistry.ts";
import { getCapabilityAssignment, parseEnvOverride } from "./capabilities.ts";
import {
  getSetting,
  setSetting,
  SETTING_KEYS,
} from "../services/settingsService.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { AppError } from "../utils/AppError.ts";

/** Dimension of the bundled local model. */
export const BUILTIN_DIMENSION = 384;
export const BUILTIN_MODEL_ID = "Xenova/all-MiniLM-L6-v2";

export interface ResolvedEmbeddings {
  kind: "builtin" | "provider";
  providerId?: string;
  model?: string;
  /** Vector dimension; null when a provider model hasn't been probed yet. */
  dimension: number | null;
  /** Stable identity used to detect configuration changes. */
  signature: string;
}

/** Persisted state describing what the vec0 tables were built with. */
interface EmbeddingsState {
  signature: string;
  dimension: number;
}

/** Probed dimensions, keyed by "<providerId>/<model>". */
type DimensionCache = Record<string, number>;

const DIMENSION_CACHE_KEY = "ai.embeddingDimensions";

function readDimensionCache(): DimensionCache {
  return getSetting<DimensionCache>(DIMENSION_CACHE_KEY) ?? {};
}

/** Resolve the configured embeddings backend. */
export function resolveEmbeddings(): ResolvedEmbeddings {
  const assignment = getCapabilityAssignment("embeddings");

  // 1. Explicit pin from Settings.
  if (
    assignment.mode === "pinned" &&
    assignment.providerId &&
    assignment.model
  ) {
    return providerEmbeddings(assignment.providerId, assignment.model);
  }

  // 2. Env override — parity with the generation capabilities, for deployments
  //    that configure declaratively and never open Settings. A Settings pin
  //    wins, matching the precedence used everywhere else.
  const envValue = process.env.AI_EMBEDDINGS_MODEL;
  if (assignment.mode !== "pinned" && envValue) {
    const parsed = parseEnvOverride(envValue);
    if (parsed) return providerEmbeddings(parsed.providerId, parsed.model);
  }

  // 3. Auto — the built-in local model. No key, no network, no cost.
  return {
    kind: "builtin",
    model: BUILTIN_MODEL_ID,
    dimension: BUILTIN_DIMENSION,
    signature: `builtin/${BUILTIN_MODEL_ID}`,
  };
}

/** Shape a provider-backed embeddings resolution, with its cached dimension. */
function providerEmbeddings(
  providerId: string,
  model: string,
): ResolvedEmbeddings {
  const signature = `${providerId}/${model}`;
  return {
    kind: "provider",
    providerId,
    model,
    dimension: readDimensionCache()[signature] ?? null,
    signature,
  };
}

/**
 * Embed texts with a provider-backed model.
 * @throws AppError when the provider is missing or can't embed.
 */
export async function embedWithProvider(
  providerId: string,
  model: string,
  texts: string[],
): Promise<number[][]> {
  const provider = getProvider(providerId);
  if (!provider) {
    throw new AppError(`Provider "${providerId}" is not configured`, 503, {
      code: "PROVIDER_NOT_CONFIGURED",
    });
  }
  if (!provider.embed) {
    throw new AppError(
      `Provider "${providerId}" does not support embeddings`,
      400,
      { code: "EMBEDDINGS_UNSUPPORTED" },
    );
  }
  const vectors = await provider.embed(texts, model);
  // A provider that returns fewer vectors than inputs would otherwise be
  // absorbed by callers as "some contacts just didn't embed", leaving the
  // index quietly incomplete. Make it a hard error.
  if (vectors.length !== texts.length) {
    throw new AppError(
      `Provider "${providerId}" returned ${vectors.length} embeddings for ${texts.length} inputs`,
      502,
      { code: "EMBEDDINGS_INCOMPLETE" },
    );
  }
  return vectors;
}

/**
 * Determine a model's vector dimension, probing the provider once and caching
 * the answer. Returns null when the probe fails (caller keeps the old config).
 */
export async function probeDimension(
  providerId: string,
  model: string,
): Promise<number | null> {
  const signature = `${providerId}/${model}`;
  const cache = readDimensionCache();
  if (cache[signature]) return cache[signature];

  try {
    const [vector] = await embedWithProvider(providerId, model, [
      "dimension probe",
    ]);
    if (!vector?.length) return null;
    cache[signature] = vector.length;
    setSetting(DIMENSION_CACHE_KEY, cache);
    log.info("Embeddings", `Probed ${signature} → ${vector.length} dimensions`);
    return vector.length;
  } catch (err) {
    log.warn(
      "Embeddings",
      `Dimension probe failed for ${signature}: ${getErrorMessage(err)}`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Migration state
// ---------------------------------------------------------------------------

/** What the search_embeddings table was last built with. */
/**
 * Which vector store a build record belongs to. Search and dedupe share a
 * model but are rebuilt independently, so each records its own state — a
 * single record would make one store's rebuild look like the other's.
 */
export type EmbeddingStore = "search" | "dedupe";

function stateKey(store: EmbeddingStore): string {
  return store === "search"
    ? SETTING_KEYS.embeddingsState
    : `${SETTING_KEYS.embeddingsState}.dedupe`;
}

export function getEmbeddingsState(
  store: EmbeddingStore = "search",
): EmbeddingsState | null {
  return getSetting<EmbeddingsState>(stateKey(store));
}

export function setEmbeddingsState(
  state: EmbeddingsState,
  store: EmbeddingStore = "search",
): void {
  setSetting(stateKey(store), state);
}

/**
 * Does the vector store need rebuilding for the current configuration?
 * True when the configured model differs from what the table holds.
 */
export function needsReindex(resolved: ResolvedEmbeddings): boolean {
  const state = getEmbeddingsState();
  if (!state) return false; // first boot — db.ts creates at the default dimension
  if (state.signature !== resolved.signature) return true;
  if (resolved.dimension !== null && state.dimension !== resolved.dimension)
    return true;
  return false;
}
