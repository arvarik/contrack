// =============================================================================
// AI Layer — Shared JSON-schema translation
// =============================================================================
// One translator for the internal JsonSchemaNode shape, replacing the three
// per-adapter copies that had already drifted apart. The dialects differ in
// exactly two documented ways; everything else identical in all three copies.
//
// The drift mattered once already: the OpenAI/compat copy returned early on
// `nullable`, so a nullable OBJECT dropped its properties silently. No live
// schema hits that today (nullables are all leaf strings), but three copies
// meant a fix in one kept the bug alive in two.
// =============================================================================

import type { JsonSchemaNode } from "./types.ts";

/**
 * How a dialect writes "this value may be null".
 *
 * - "type-array": `type: ["string", "null"]` — Anthropic's grammar compiler
 *   accepts the JSON-Schema union form directly.
 * - "anyOf": `anyOf: [<node>, {type:"null"}]` — OpenAI's structured-output
 *   validator rejects type arrays; the branch carries the FULL node, so a
 *   nullable object keeps its properties.
 */
export type NullableStyle = "type-array" | "anyOf";

export interface TranslateOptions {
  nullableStyle: NullableStyle;
  /**
   * When to stamp `additionalProperties: false`:
   * - "objects":         every `type: "object"` node (Anthropic — its grammar
   *                      wants the constraint even on bare object nodes)
   * - "with-properties": only nodes that declare properties (OpenAI/compat —
   *                      the historical behavior, preserved exactly)
   */
  sealObjects: "objects" | "with-properties";
}

export function translateSchemaNode(
  node: JsonSchemaNode,
  options: TranslateOptions,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (node.nullable && options.nullableStyle === "type-array") {
    result.type = [node.type, "null"];
  } else {
    result.type = node.type;
  }

  if (node.enum) result.enum = node.enum;
  if (node.description) result.description = node.description;

  if (node.properties) {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.properties)) {
      properties[key] = translateSchemaNode(value, options);
    }
    result.properties = properties;
    if (options.sealObjects === "with-properties") {
      result.additionalProperties = false;
    }
  }
  if (options.sealObjects === "objects" && node.type === "object") {
    result.additionalProperties = false;
  }

  if (node.items) result.items = translateSchemaNode(node.items, options);
  if (node.required) result.required = node.required;

  if (node.nullable && options.nullableStyle === "anyOf") {
    // The whole translated node rides inside the union — an early return
    // here is how the per-adapter copy lost nullable objects' children.
    return { anyOf: [result, { type: "null" }] };
  }

  return result;
}

// =============================================================================
// Root shape — OpenAI's structured output takes an object at the root
// =============================================================================

/** The property a non-object root travels under while it is wrapped. */
const WRAPPED_KEY = "items";

/**
 * Give a schema an object root, and say how to unwrap the answer.
 *
 * OpenAI's `json_schema` (Chat Completions and Responses alike) answers a
 * `type: "array"` root with a 400, "schema must be a JSON Schema of 'type:
 * "object"'". @mention extraction and the Catch-Me-Up briefing both ask for an
 * array, so both failed on OpenAI while working on Gemini.
 */
export function withObjectRoot(node: JsonSchemaNode): {
  schema: JsonSchemaNode;
  unwrap: (value: unknown) => unknown;
} {
  if (node.type === "object") return { schema: node, unwrap: (v) => v };
  return {
    schema: {
      type: "object",
      properties: { [WRAPPED_KEY]: node },
      required: [WRAPPED_KEY],
    },
    unwrap: (value) =>
      value && typeof value === "object" && WRAPPED_KEY in value
        ? (value as Record<string, unknown>)[WRAPPED_KEY]
        : value,
  };
}

// =============================================================================
// Anthropic's grammar limits
// =============================================================================

/** Claude compiles a schema with at most this many optional parameters. */
export const ANTHROPIC_MAX_OPTIONAL = 24;
/** ...and at most this many parameters whose type is a union. */
export const ANTHROPIC_MAX_UNIONS = 16;

/**
 * Whether Claude will refuse to compile `node` as an output schema.
 *
 * Contrack's contact-parsing schema has 33 optional fields and the research
 * schema 32. Claude answers either with a 400, and the adapter used to learn
 * that by sending it, once per schema per process. Counting here goes
 * straight to prompt-guided JSON. Making the optional fields required and
 * nullable does not help: that trips the union limit instead.
 */
export function exceedsAnthropicSchemaLimits(node: JsonSchemaNode): boolean {
  let optional = 0;
  let unions = 0;
  const walk = (n: JsonSchemaNode) => {
    if (n.nullable) unions++;
    if (n.properties) {
      const required = new Set(n.required ?? []);
      for (const [key, child] of Object.entries(n.properties)) {
        if (!required.has(key)) optional++;
        walk(child);
      }
    }
    if (n.items) walk(n.items);
  };
  walk(node);
  return optional > ANTHROPIC_MAX_OPTIONAL || unions > ANTHROPIC_MAX_UNIONS;
}
