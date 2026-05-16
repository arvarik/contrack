// =============================================================================
// AI Layer — Provider-Agnostic Type Definitions
// =============================================================================
// These types are shared across the entire AI subsystem. They decouple
// business-domain shapes from any specific LLM SDK (Gemini, OpenAI, etc.).
// =============================================================================

/**
 * Union of supported AI provider identifiers.
 * Used by the singleton factory to resolve the correct adapter.
 */
export type AIProviderName = "gemini" | "openai" | "anthropic";

/**
 * Options passed to any AIProvider's `generate` method.
 * Contains the prompt, desired response format, and an optional JSON schema
 * expressed in standard JSON Schema vocabulary (no provider-specific enums).
 */
export interface AIGenerateOptions {
  /** The full task prompt string to send to the model. */
  prompt: string;

  /**
   * Optional system-level instruction that sets the model's persona or
   * behavioral constraints. Kept separate from the user-facing `prompt`
   * because providers that support distinct system turns (e.g. OpenAI, Anthropic)
   * respond better when persona and task are separated.
   * Adapters that don't support a native system turn prepend this to `prompt`.
   */
  systemPrompt?: string;

  /**
   * A plain JSON Schema object describing the expected response structure.
   * Adapters translate this into their provider-specific schema format
   * (e.g., Gemini's `Type.*` enums, OpenAI's `response_format`).
   *
   * When provided, `responseFormat` should be `'json'`.
   */
  jsonSchema?: JsonSchemaNode;

  /** Whether the model should return structured JSON or free-form text. */
  responseFormat: "json" | "text";

  /**
   * When true, instructs the adapter to enable live web search grounding
   * (where supported). Each adapter translates this to its native mechanism.
   *
   * ⚠️ Gemini API constraint: `enableSearchGrounding` is incompatible with
   * `responseFormat: 'json'` / `jsonSchema`. Use a two-pass strategy
   * (grounded text retrieval → separate structured extraction call).
   */
  enableSearchGrounding?: boolean;

  /**
   * Override the default model selection for this specific call.
   * Used by strategies that need to target specific models for each pass
   * (e.g., TwoPassStrategy uses grounding-capable models for Pass 1 and
   * cheaper models for Pass 2). When set, the adapter skips its routing
   * engine and uses this model directly.
   */
  model?: string;

  /**
   * Routing preferences that influence model selection in the SmartRouter.
   * Only used when `model` is not set (explicit model overrides bypass routing).
   * All fields are optional — omitting this gives default routing behavior.
   */
  routing?: RoutingPolicy;

  /**
   * Per-attempt timeout in milliseconds. Defaults to `AI_DEFAULTS.perAttemptTimeoutMs`
   * (60s). Long-running grounded research calls may need to raise this.
   *
   * Hitting this limit aborts the underlying SDK call (via AbortSignal) and
   * throws an `UpstreamTimeoutError`, which the retry layer treats as a
   * transient failure and may re-issue against another model.
   */
  timeoutMs?: number;

  /**
   * Caller cancellation signal. When the signal aborts (e.g. the HTTP client
   * disconnected) the active SDK call is cancelled and no further retries
   * are attempted. The thrown error is an `AppError` with code `"CANCELLED"`.
   */
  signal?: AbortSignal;
}

// =============================================================================
// Routing Policy
// =============================================================================
// Controls how the SmartRouter selects models for a given request.
// Passed via `AIGenerateOptions.routing`. All fields are optional.
// =============================================================================

import type { ModelClass } from "./routing/registry.ts";

/**
 * Caller-provided routing preferences that influence model selection.
 * All fields are optional — omitting them gives the default behavior.
 */
export interface RoutingPolicy {
  /**
   * Preferred model class for this request.
   *
   * When set, the SmartRouter prioritizes models of this class and prefers
   * newer generations (Gemini 3.x → 2.x). If the preferred class is
   * exhausted or circuit-broken, the router gracefully falls back to
   * other classes — same capacity/quota/retry logic applies.
   *
   * Preview models (Gemini 3.x) are automatically allowed when a
   * preference is set, since they are the primary Gemini 3 offerings.
   *
   * Example: `prefer: "lite"` → tries gemini-3.1-flash-lite first,
   * then gemini-2.5-flash-lite, then any available model.
   */
  prefer?: ModelClass;

  /**
   * If set, ONLY these models may be used for this request.
   * Useful for targeting specific model capabilities.
   */
  allowModels?: string[];

  /**
   * These models must NOT be used for this request.
   * Useful for background tasks that should avoid expensive models.
   */
  denyModels?: string[];

  /**
   * Whether to fall through to paid-limit overflow if tier capacity exhausted.
   *
   * **Only meaningful on `AI_TIER=FREE`**:
   * - On FREE: defaults to `false` (avoid surprise charges). When `true`,
   *   the router will fall through to paid-tier limits if free capacity
   *   is exhausted.
   * - On PAID: this field has **no effect** because Pass 2 already uses
   *   paid limits — there is nothing to "spill over" to.
   *
   * Can be explicitly overridden per-request.
   */
  allowPaidSpillover?: boolean;

  /**
   * Whether to include preview-stability models (Gemini 3.x) in routing.
   * Defaults to false — only stable models are used.
   * Automatically set to true when `prefer` is specified.
   * On AI_TIER=FREE, preview models are excluded regardless (they have no free tier).
   */
  allowPreview?: boolean;
}

/**
 * The result returned from any AIProvider's `generate` method.
 * Normalizes response metadata across providers.
 */
export interface AIGenerateResult {
  /** Raw text content of the model's response. */
  text: string;

  /** The actual model string that served the request (useful for fallback chains). */
  model: string;

  /** Total token count (prompt + completion), if reported by the provider. */
  tokenCount?: number;

  /** Wall-clock latency of the generate call in milliseconds. */
  latencyMs: number;
}

// =============================================================================
// Generic JSON Schema Node
// =============================================================================
// A recursive type representing a subset of JSON Schema sufficient for
// structured LLM output. Adapters map this to their native schema format.
// =============================================================================

export interface JsonSchemaNode {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean";
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  required?: string[];
  nullable?: boolean;
  description?: string;
  /**
   * Constrains the value to a fixed set of string constants.
   * Translates to Gemini's `enum` field, OpenAI's `enum`, etc.
   * Example: `{ type: "string", enum: ["work", "personal", "other"] }`
   */
  enum?: string[];
}

// =============================================================================
// Diagnostics Snapshot
// =============================================================================
// Typed return value for GeminiAdapter.getQuotaSnapshot().
// Used by the /api/ai/diagnostics endpoint.
// =============================================================================

/** Per-model usage counters within the current tracking window. */
export interface ModelUsageSnapshot {
  /** Requests in the last 60 seconds */
  rpm: number;
  /** Tokens in the last 60 seconds (input + output) */
  tpm: number;
  /** Requests today (resets at UTC midnight) */
  rpd: number;
}

/** Full diagnostics snapshot from the routing layer. */
export interface DiagnosticsSnapshot {
  /** Per-model usage counters */
  models: Record<string, ModelUsageSnapshot>;
  /** Shared grounding RPD pool state */
  grounding: { rpd: number; limit: number; remaining: number };
  /** Active billing tier */
  aiTier: string;
  /** Model IDs currently banned by circuit breakers */
  circuitBreakers: string[];
}

// =============================================================================
// Business-Domain Types (AI Function Inputs & Outputs)
// =============================================================================

/**
 * Structured contact data extracted from unstructured text by `parseContactRecord`.
 */
export interface ParsedContact {
  name: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  company?: string;
  role?: string;
  location?: string;
  about?: string;
  pronouns?: string;
  industry?: string;
  website?: string;
  emails?: Array<{ email: string; label?: string }>;
  phones?: Array<{ phone: string; label?: string }>;
  socialLinks?: Array<{ platform: string; url: string }>;
  education?: Array<{
    school: string;
    degree?: string;
    fieldOfStudy?: string;
    startDate?: string;
    endDate?: string;
  }>;
  experience?: Array<{
    company: string;
    role?: string;
    startDate?: string;
    endDate?: string;
    isCurrent?: boolean;
    description?: string;
    location?: string;
  }>;
}

/**
 * A single person entity extracted from a timeline note by `extractMentions`.
 */
export interface MentionEntity {
  name: string;
  company?: string | null;
  context: string;
}

/**
 * Lightweight contact projection passed to the semantic search engine.
 * Nulls are stripped by the caller before passing here.
 */
export interface CompressedContact {
  id: string;
  name: string;
  role?: string;
  company?: string;
  location?: string;
  about?: string;
  industry?: string;
  preferences?: string;
  interests?: string;
}

/**
 * A single match returned by the semantic search engine.
 */
export interface SemanticMatchResult {
  contact_id: string;
  reason: string;
}

/**
 * Structured query plan produced by `parseSearchQuery` (Plan-Filter-Rank-Verify
 * architecture, v5).
 *
 * The plan is split into TWO buckets that drive different retrieval behavior:
 *
 *  - `must`  — HARD constraints. Every populated `must.*Matchers` list is
 *              converted to a JS-side word-boundary regex and applied as a
 *              pre-filter against the relevant contact field BEFORE FTS5
 *              and vector search run. A contact that fails any active must
 *              dimension is never considered. This is what stops "Sydney"
 *              from leaking into "Who lives in America?" — the location
 *              filter is enforced, not merely boosted.
 *
 *  - `should` — SOFT signals. Used as additional RRF boost channels.
 *               Contacts matching `should.traits` rank higher but are not
 *               required to match. Used for descriptive intent the LLM
 *               can't confidently structurize.
 *
 * `confidence` is the LLM's self-rated quality of the parse — low confidence
 * skips the hard pre-filter to avoid over-zealous filtering on ambiguous
 * queries ("show me my network", "interesting people").
 *
 * Matcher arrays are inclusive synonym sets — the LLM expands a single
 * concept into all its plausible string representations. For "America" the
 * planner emits country names ("United States", "USA"), state names
 * ("California", "New York", ...), state abbreviations matched at word
 * boundary ("CA", "NY", ...), and major city names. The retrieval layer
 * then does case-insensitive word-boundary substring matching — a contact
 * passes if its field contains ANY matcher.
 *
 * All fields are optional. An empty plan (must={}, should={}) is valid and
 * means "no structured intent extracted — run pure hybrid search."
 */
export interface QueryPlan {
  /**
   * HARD filters — a contact MUST satisfy every populated *Matchers list.
   * Each list is OR-internally (any matcher hit passes that dimension);
   * across dimensions it is AND (all populated dimensions must pass).
   */
  must: {
    /**
     * Word-boundary substrings to match against `contact.location`.
     * Includes synonyms, regions, states, abbreviations, and major cities.
     * Example for "America": ["United States","USA","America","U.S.",
     *   "California","CA","New York","NY",...,"San Francisco",...]
     */
    locationMatchers?: string[];
    /** Word-boundary substrings to match against `contact.company`. */
    companyMatchers?: string[];
    /** Word-boundary substrings to match against `contact.role` or `contact.headline`. */
    roleMatchers?: string[];
    /** Word-boundary substrings to match against `contact.industry` and tags/interests. */
    industryMatchers?: string[];
    /** Hard temporal constraint on contact recency. */
    temporal?: {
      type: "lastContact" | "neverContacted";
      daysAgo?: number;
    };
  };

  /**
   * SOFT signals — RRF boost channels. Contacts matching these rank higher
   * but are not gated on them.
   */
  should: {
    /**
     * Free-form descriptors that don't fit must.* — interests, hobbies,
     * credentials, soft traits. Matched against `about`, `preferences`,
     * `headline`, `searchExpansion`, tags, interests.
     */
    traits?: string[];
  };

  /**
   * LLM self-rated confidence in the parse.
   * - `high`   → trust the must.* filters strictly
   * - `medium` → trust must.* but be permissive on weak matchers
   * - `low`    → skip must.* filtering, treat everything as soft boost
   *              (used for vague exploratory queries like "interesting people")
   */
  confidence: "high" | "medium" | "low";

  /** Short, human-readable description of the parse. Used in logs and debug UI. */
  rationale: string;
}

/**
 * @deprecated Replaced by `QueryPlan`. Kept transiently to ease migration —
 * new code should consume `QueryPlan` directly.
 */
export interface ParsedSearchQuery {
  location?: string;
  company?: string;
  industry?: string;
  role?: string;
  traits?: string[];
  temporal?: {
    type: "lastContact" | "neverContacted";
    daysAgo?: number;
  };
}
