// =============================================================================
// Shared schema translator — the one source the three adapters dial into
// =============================================================================
// Three per-adapter copies drifted; the OpenAI/compat copy returned early on
// `nullable` and dropped a nullable object's properties. One translator, two
// documented dialect switches, and the trap is tested shut.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  translateSchemaNode,
  type TranslateOptions,
} from "../../server/ai/schemaTranslation.ts";
import type { JsonSchemaNode } from "../../server/ai/types.ts";

const ANYOF: TranslateOptions = {
  nullableStyle: "anyOf",
  sealObjects: "with-properties",
};
const TYPE_ARRAY: TranslateOptions = {
  nullableStyle: "type-array",
  sealObjects: "objects",
};

describe("nullable handling", () => {
  const nullableString: JsonSchemaNode = { type: "string", nullable: true };

  it("anyOf dialect wraps the node in a union with null", () => {
    expect(translateSchemaNode(nullableString, ANYOF)).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
  });

  it("type-array dialect writes the JSON-Schema type union", () => {
    expect(translateSchemaNode(nullableString, TYPE_ARRAY)).toEqual({
      type: ["string", "null"],
    });
  });

  it("a nullable OBJECT keeps its properties in the anyOf dialect", () => {
    // The bug the shared translator exists to keep fixed: the per-adapter
    // copy returned early on nullable and emitted anyOf branches with no
    // properties at all.
    const node: JsonSchemaNode = {
      type: "object",
      nullable: true,
      properties: { name: { type: "string" } },
      required: ["name"],
    };
    const result = translateSchemaNode(node, ANYOF) as {
      anyOf: Array<Record<string, unknown>>;
    };
    expect(result.anyOf[0].properties).toEqual({ name: { type: "string" } });
    expect(result.anyOf[0].required).toEqual(["name"]);
    expect(result.anyOf[1]).toEqual({ type: "null" });
  });
});

describe("object sealing", () => {
  it("with-properties seals only nodes that declare properties", () => {
    const bare: JsonSchemaNode = { type: "object" };
    expect(
      translateSchemaNode(bare, ANYOF).additionalProperties,
    ).toBeUndefined();

    const withProps: JsonSchemaNode = {
      type: "object",
      properties: { a: { type: "string" } },
    };
    expect(translateSchemaNode(withProps, ANYOF).additionalProperties).toBe(
      false,
    );
  });

  it("objects seals every object node, bare ones included", () => {
    const bare: JsonSchemaNode = { type: "object" };
    expect(translateSchemaNode(bare, TYPE_ARRAY).additionalProperties).toBe(
      false,
    );
  });
});

describe("recursion and passthrough", () => {
  it("translates nested items and properties with the same dialect", () => {
    const node: JsonSchemaNode = {
      type: "array",
      items: {
        type: "object",
        properties: {
          tag: { type: "string", enum: ["a", "b"], description: "a tag" },
          score: { type: "number", nullable: true },
        },
        required: ["tag"],
      },
    };
    const result = translateSchemaNode(node, ANYOF) as {
      items: {
        properties: Record<string, unknown>;
        additionalProperties: boolean;
        required: string[];
      };
    };
    expect(result.items.additionalProperties).toBe(false);
    expect(result.items.required).toEqual(["tag"]);
    expect(result.items.properties.tag).toEqual({
      type: "string",
      enum: ["a", "b"],
      description: "a tag",
    });
    expect(result.items.properties.score).toEqual({
      anyOf: [{ type: "number" }, { type: "null" }],
    });
  });
});
