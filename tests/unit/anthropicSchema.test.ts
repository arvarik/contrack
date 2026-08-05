// =============================================================================
// Anthropic adapter — structured output
// =============================================================================
// Two things the live API taught us:
//   1. `output_config.format` takes the schema DIRECTLY. OpenAI's nested
//      `json_schema: { name, schema }` wrapper is rejected with a 400, which
//      broke every JSON operation on Anthropic.
//   2. Claude refuses to compile a schema with more than 24 optional
//      parameters. Contrack's research schema has 32, so the adapter drops to
//      prompt-guided JSON rather than failing the enrichment.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: Record<string, unknown>[] = [];
let responder: (params: Record<string, unknown>) => unknown;

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: (params: Record<string, unknown>) => {
        calls.push(params);
        return Promise.resolve(responder(params));
      },
    };
    models = { list: () => Promise.resolve({ data: [] }) };
  },
}));

const { AnthropicAdapter } =
  await import("../../server/ai/adapters/anthropic.ts");

const ok = (text: string) => ({
  content: [{ type: "text", text }],
  usage: { input_tokens: 10, output_tokens: 5 },
});

/** The real 400 Claude returns for an over-wide schema. */
const tooManyOptional = () => {
  throw new Error(
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"Schemas contains too many optional parameters (32), which would make grammar compilation inefficient. Reduce the number of optional parameters in your tool schemas (limit: 24)."}}',
  );
};

let adapter: InstanceType<typeof AnthropicAdapter>;

beforeEach(() => {
  calls.length = 0;
  adapter = new AnthropicAdapter("test-key");
});

const jsonRequest = {
  prompt: "Extract the contact",
  systemPrompt: "You extract contacts.",
  responseFormat: "json" as const,
  model: "claude-sonnet-5",
  jsonSchema: {
    type: "object" as const,
    properties: { name: { type: "string" as const } },
    required: ["name"],
  },
};

const formatOf = (call: Record<string, unknown>) =>
  (call.output_config as { format?: Record<string, unknown> } | undefined)
    ?.format;

describe("output_config shape", () => {
  it("puts the schema directly under format — not in an OpenAI wrapper", async () => {
    responder = () => ok('{"name":"Jane"}');
    await adapter.generate(jsonRequest);

    const format = formatOf(calls[0])!;
    expect(format.type).toBe("json_schema");
    expect(format.schema).toBeDefined();
    // The wrapper that caused the 400 must not reappear.
    expect(format.json_schema).toBeUndefined();
  });

  it("sets additionalProperties:false, which Claude requires on objects", async () => {
    responder = () => ok('{"name":"Jane"}');
    await adapter.generate(jsonRequest);

    const schema = formatOf(calls[0])!.schema as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
  });

  it("omits output_config entirely for text responses", async () => {
    responder = () => ok("a prose summary");
    await adapter.generate({
      prompt: "Summarize",
      responseFormat: "text",
      model: "claude-sonnet-5",
    });
    expect(calls[0].output_config).toBeUndefined();
  });
});

describe("schema-complexity fallback", () => {
  it("retries without the schema when Claude declines to compile it", async () => {
    responder = (params) =>
      params.output_config ? tooManyOptional() : ok('{"name":"Jane"}');

    const result = await adapter.generate(jsonRequest);
    expect(result.text).toBe('{"name":"Jane"}');
    expect(calls).toHaveLength(2);
    expect(calls[0].output_config).toBeDefined();
    expect(calls[1].output_config).toBeUndefined();
  });

  it("puts the shape in the system prompt when the schema is dropped", async () => {
    responder = (params) =>
      params.output_config ? tooManyOptional() : ok('{"name":"Jane"}');

    await adapter.generate(jsonRequest);
    const system = calls[1].system as string;
    expect(system).toContain("You extract contacts.");
    expect(system).toContain("valid JSON only");
    expect(system).toContain('"name"');
  });

  it("remembers the refusal so the next call skips the doomed attempt", async () => {
    responder = (params) =>
      params.output_config ? tooManyOptional() : ok('{"name":"Jane"}');

    await adapter.generate(jsonRequest);
    calls.length = 0;
    await adapter.generate(jsonRequest);

    expect(calls).toHaveLength(1);
    expect(calls[0].output_config).toBeUndefined();
  });

  it("does not swallow unrelated failures", async () => {
    responder = () => {
      throw new Error("401 invalid x-api-key");
    };
    await expect(adapter.generate(jsonRequest)).rejects.toThrow();
    // No schema-dropping retry for an auth problem.
    expect(calls.every((c) => c.output_config !== undefined)).toBe(true);
  });
});
