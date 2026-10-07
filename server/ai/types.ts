// Provider-agnostic types for the AI layer, so business code never depends on
// an LLM SDK.

/**
 * Options for an AIProvider's `generate`. `jsonSchema` uses plain JSON Schema
 * vocabulary, with no provider enums.
 */
export interface AIGenerateOptions {
  /** The full task prompt string to send to the model. */
  prompt: string;

  /**
   * A system instruction, kept apart from `prompt` because providers with a
   * system turn (OpenAI, Anthropic) do better with persona and task apart.
   * Adapters without one prepend it to `prompt`.
   */
  systemPrompt?: string;

  /**
   * The expected response shape as plain JSON Schema, which each adapter
   * translates (Gemini's `Type.*`, OpenAI's `response_format`). Set
   * `responseFormat: 'json'` with it.
   */
  jsonSchema?: JsonSchemaNode;

  /** Whether the model should return structured JSON or free-form text. */
  responseFormat: "json" | "text";

  /**
   * Turn on live web search grounding where the adapter supports it. Gemini
   * cannot ground and return `json` / `jsonSchema` in one call, so grounded
   * work runs two passes: grounded text, then a separate extraction.
   */
  enableSearchGrounding?: boolean;

  /**
   * How much the model may think, for models that take a level (Gemini 3).
   * Without it the adapter picks, and a grounded call runs at "low". Other
   * adapters ignore it. Thinking counts against `maxOutputTokens`, so a call
   * that asks for "high" needs room: several thousand tokens.
   */
  thinkingLevel?: "low" | "medium" | "high";

  /**
   * Use this model and skip routing, for a caller that picks a model per pass
   * (research grounds with one and extracts with a cheaper one).
   */
  model?: string;

  /**
   * Routing preferences for the SmartRouter, used only when `model` is unset.
   */
  routing?: RoutingPolicy;

  /**
   * Per-attempt timeout in milliseconds, `AI_DEFAULTS.perAttemptTimeoutMs` (60
   * s) by default. Reaching it aborts the SDK call and throws
   * `UpstreamTimeoutError`, which the retry layer treats as transient and may
   * retry on another model.
   */
  timeoutMs?: number;

  /** Maximum output tokens for this generation. */
  maxOutputTokens?: number;

  /**
   * Caller cancellation. When it aborts (the HTTP client disconnected, say) the
   * SDK call is canceled, nothing is retried, and the error is an `AppError`
   * with code `"CANCELLED"`.
   */
  signal?: AbortSignal;
}

// Routing policy

import type { ModelClass } from "./routing/registry.ts";

/** Caller preferences for model selection. Every field is optional. */
export interface RoutingPolicy {
  /**
   * Preferred model class. The SmartRouter tries this class first, newest
   * generation first (Gemini 3.8 before 3.5 before 2.5), and falls back to the
   * other classes when every model of it is paused. `prefer: "lite"` tries
   * gemini-3.5-flash-lite, then gemini-3.1-flash-lite, then any available
   * model.
   */
  prefer?: ModelClass;
}

/**
 * The result of any AIProvider's `generate`, with metadata normalized across
 * providers.
 */
export interface AIGenerateResult {
  /** Source links reported by the provider grounding metadata. */
  citations?: Array<{ title: string; uri: string }>;
  /** The web searches a grounded answer ran, when the provider reports them. */
  searchQueries?: string[];
  /**
   * Which pages back which passage of the answer, when the provider says so
   * (Gemini's groundingSupports): the passage and the source addresses.
   */
  supports?: Array<{ text: string; uris: string[] }>;
  /** Raw text content of the model's response. */
  text: string;

  /** The actual model string that served the request (useful for fallback chains). */
  model: string;

  /** Total token count (prompt + completion), if reported by the provider. */
  tokenCount?: number;

  /**
   * The tokens billed as input and as output, thinking included in output,
   * when the provider reports them. A price is per input or output token,
   * so the total alone cannot give a cost.
   */
  usage?: { inputTokens: number; outputTokens: number };

  /** Wall-clock latency of the generate call in milliseconds. */
  latencyMs: number;
}

// A subset of JSON Schema, enough for structured LLM output. Adapters map it to
// their native schema.

export interface JsonSchemaNode {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean";
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  required?: string[];
  nullable?: boolean;
  description?: string;
  /**
   * A fixed set of string values, such as `{ type: "string", enum: ["work",
   * "personal", "other"] }`.
   */
  enum?: string[];
}

// What GeminiAdapter.getQuotaSnapshot() reports this process has sent, for
// /api/ai/diagnostics and the admin Health page.

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
  /** Grounded requests sent today (Pacific day, as Google counts it) */
  grounding: { rpd: number };
  /** Model IDs paused after a 429, a 5xx or a timeout */
  circuitBreakers: string[];
  /**
   * True once Google answered this key with a free-tier quota error. On the
   * free tier Google uses prompts and responses to improve its products, and
   * people may read them, so Settings warns about it.
   */
  freeTier?: boolean;
}

// Inputs and outputs of the AI functions

/** Contact fields `parseContactRecord` extracts from free text. */
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

/** A person `extractMentions` found in a timeline note. */
export interface MentionEntity {
  name: string;
  company?: string | null;
  context: string;
}

/** The slim contact sent to the reranker. The caller strips nulls. */
export interface CompressedContact {
  id: string;
  headline?: string;
  name: string;
  role?: string;
  company?: string;
  location?: string;
  about?: string;
  industry?: string;
  preferences?: string;
  interests?: string;
  /** Every address the contact has, joined by " | ". */
  addresses?: string;
  passages?: { id: string; field: string; context: string; text: string }[];
}

/** A candidate field the reranker may cite as proof of a match. */
export type EvidenceField =
  | "name"
  | "role"
  | "headline"
  | "company"
  | "location"
  | "about"
  | "industry"
  | "preferences"
  | "interests"
  | "addresses"
  | "passage";

/**
 * A match the reranker verified: the field it cited and a literal substring
 * of that field, which the server has checked. The model writes no reason.
 * The server builds one from this evidence (`buildReason`).
 */
export interface SemanticMatchResult {
  contact_id: string;
  verified_field: EvidenceField;
  verified_value: string;
  passage_id?: string;
}

/** A grounded place. Fields within a constraint use AND. Separate constraints use OR. */
export interface QueryLocationConstraint {
  city?: string;
  region?: string;
  country?: string;
  literal?: string;
  sourcePhrase: string;
}

/**
 * The query plan `parseSearchQuery` produces, in two buckets:
 *
 * - `must`: hard constraints. Each populated `must.*Matchers` list becomes a
 *   word-boundary regex applied to its field before FTS5 and vector search, and
 *   a contact that fails any of them is never considered. That is what keeps
 *   "Sydney" out of "Who lives in America?".
 * - `should`: soft signals, used as extra RRF channels. Matching
 *   `should.traits` ranks a contact higher without being required.
 *
 * `confidence` is the model's own rating. Low confidence skips the hard filter,
 * so a vague question ("interesting people") is not over-filtered.
 *
 * Matcher lists are synonym sets. For "America" the planner writes country
 * names ("United States", "USA"), states ("California", ...), state
 * abbreviations matched at word boundaries ("CA", ...), and major cities. A
 * contact passes when its field contains any matcher, ignoring case. An empty
 * plan (must={}, should={}) means "no structured intent: run plain hybrid
 * search".
 */
export interface QueryPlan {
  evidence?: Partial<
    Record<"location" | "company" | "role" | "industry" | "temporal", string>
  >;
  /**
   * Hard filters. Within a list any matcher passes; across lists every
   * populated dimension must pass.
   */
  must: {
    /**
     * Display and matching values. Structured `locations` take precedence when
     * present, so city and country parts do not become OR alternatives.
     */
    locationMatchers?: string[];
    /** Explicit city, region, and country constraints from the query. */
    locations?: QueryLocationConstraint[];
    /** Word-boundary substrings to match against `contact.company`. */
    companyMatchers?: string[];
    /** Word-boundary phrases for the current role, or headline only if role is empty. */
    roleMatchers?: string[];
    /** Word-boundary substrings to match against `contact.industry` and tags/interests. */
    industryMatchers?: string[];
    /** Hard temporal constraint on contact recency. */
    temporal?: {
      type: "lastContact" | "neverContacted";
      daysAgo?: number;
    };
  };

  /** Soft signals: RRF channels that raise a contact without gating it. */
  should: {
    /**
     * Free-form descriptors that fit no `must` list: interests, hobbies,
     * credentials, soft traits. Matched against `about`, `preferences`,
     * `headline`, `searchExpansion`, tags and interests.
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
