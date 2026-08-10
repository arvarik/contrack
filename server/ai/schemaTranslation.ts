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
   *                      the historical behaviour, preserved exactly)
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
