// =============================================================================
// AI Layer — Provider-Agnostic Type Definitions
// =============================================================================
// These types are shared across the entire AI subsystem. They decouple
// business-domain shapes from any specific LLM SDK (Gemini, OpenAI, etc.).
// =============================================================================

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
   * cheaper models for Pass 2). When set, the adapter skips its fallback
   * chain and uses this model directly (with retryable-error fallback to
   * the next model the strategy provides on retry).
   */
  model?: string;
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
