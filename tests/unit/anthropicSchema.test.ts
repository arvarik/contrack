// =============================================================================
// Anthropic adapter — structured output
// =============================================================================
// Two things the live API taught us:
//   1. `output_config.format` takes the schema DIRECTLY. OpenAI's nested
//      `json_schema: { name, schema }` wrapper is rejected with a 400, which
//      broke every JSON operation on Anthropic.
//   2. Claude refuses to compile a schema with more than 24 optional
//      parameters, or more than 16 union-typed ones. Contrack's research
//      schema has 32 optional fields, so the adapter drops to prompt-guided
//      JSON rather than failing the enrichment, and now counts first.
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

const effortOf = (call: Record<string, unknown>) =>
  (call.output_config as { effort?: string } | undefined)?.effort;

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

  it("sends a nullable field as a type union", async () => {
    responder = () => ok('{"company":null}');
    await adapter.generate({
      ...jsonRequest,
      jsonSchema: {
        type: "object",
        properties: { company: { type: "string", nullable: true } },
      },
    });

    // Nullability is expressed as a JSON Schema type union, not OpenAPI's
    // `nullable` keyword (which the Anthropic API does not accept).
    const schema = formatOf(calls[0])!.schema as {
      properties: { company: { type?: unknown } };
    };
    expect(schema.properties.company.type).toEqual(["string", "null"]);
  });

  it("sends no format for a text response", async () => {
    responder = () => ok("a prose summary");
    await adapter.generate({
      prompt: "Summarize",
      responseFormat: "text",
      model: "claude-haiku-4-5",
    });
    // Haiku takes no effort either, so there is nothing to configure.
    expect(calls[0].output_config).toBeUndefined();
  });
});

describe("schema-complexity fallback", () => {
  it("retries without the schema when Claude declines to compile it", async () => {
    responder = (params) =>
      formatOf(params) ? tooManyOptional() : ok('{"name":"Jane"}');

    const result = await adapter.generate(jsonRequest);
    expect(result.text).toBe('{"name":"Jane"}');
    expect(calls).toHaveLength(2);
    expect(formatOf(calls[0])).toBeDefined();
    expect(formatOf(calls[1])).toBeUndefined();
  });

  it("puts the shape in the system prompt when the schema is dropped", async () => {
    responder = (params) =>
      formatOf(params) ? tooManyOptional() : ok('{"name":"Jane"}');

    await adapter.generate(jsonRequest);
    const system = calls[1].system as string;
    expect(system).toContain("You extract contacts.");
    expect(system).toContain("valid JSON only");
    expect(system).toContain('"name"');
  });

  it("remembers the refusal so the next call skips the doomed attempt", async () => {
    responder = (params) =>
      formatOf(params) ? tooManyOptional() : ok('{"name":"Jane"}');

    await adapter.generate(jsonRequest);
    calls.length = 0;
    await adapter.generate(jsonRequest);

    expect(calls).toHaveLength(1);
    expect(formatOf(calls[0])).toBeUndefined();
  });

  it("goes straight to prompt-guided JSON for a schema over Claude's limits", async () => {
    responder = () => ok('{"field0":"ok"}');
    await adapter.generate({
      ...jsonRequest,
      jsonSchema: {
        type: "object",
        properties: Object.fromEntries(
          Array.from({ length: 30 }, (_, i) => [
            `field${i}`,
            { type: "string" as const },
          ]),
        ),
        required: ["field0"],
      },
    });
    // No doomed request first: 29 optional fields is over the 24 limit.
    expect(calls).toHaveLength(1);
    expect(formatOf(calls[0])).toBeUndefined();
    expect(calls[0].system as string).toContain("valid JSON only");
  });

  it("does not swallow unrelated failures", async () => {
    responder = () => {
      throw new Error("401 invalid x-api-key");
    };
    await expect(adapter.generate(jsonRequest)).rejects.toThrow();
    // No schema-dropping retry for an auth problem.
    expect(calls.every((c) => formatOf(c) !== undefined)).toBe(true);
  });
});

describe("the JSON callers get back", () => {
  it("parses as it stands, whatever the model wrapped it in", async () => {
    // Prompt-guided answers seen live: a sentence, then a fenced block.
    responder = () =>
      ok('I have enough to build the profile.```json\n{"name":"Jane"}\n```');
    const result = await adapter.generate(jsonRequest);
    expect(result.text).toBe('{"name":"Jane"}');
  });
});

describe("effort", () => {
  it("asks a model that thinks by default to think less for routine work", async () => {
    responder = () => ok("summary");
    await adapter.generate({
      prompt: "Summarize",
      responseFormat: "text",
      model: "claude-sonnet-5",
      routing: { prefer: "flash" },
    });
    expect(effortOf(calls[0])).toBe("low");
  });

  it("sends none to a model that takes none", async () => {
    responder = () => ok("summary");
    for (const model of ["claude-haiku-4-5", "claude-sonnet-4-5-20250929"]) {
      await adapter.generate({ prompt: "x", responseFormat: "text", model });
    }
    expect(calls.map(effortOf)).toEqual([undefined, undefined]);
  });

  it("drops the effort, and remembers, when a model refuses it", async () => {
    let refused = 0;
    responder = (params) => {
      if (effortOf(params)) {
        refused++;
        throw new Error(
          '400 {"type":"error","error":{"type":"invalid_request_error","message":"This model does not support the effort parameter."}}',
        );
      }
      return ok("summary");
    };
    const request = {
      prompt: "x",
      responseFormat: "text" as const,
      model: "claude-new-model",
    };
    await adapter.generate(request);
    await adapter.generate(request);
    expect(refused).toBe(1);
    expect(calls.map(effortOf)).toEqual(["low", undefined, undefined]);
  });
});

describe("web research", () => {
  it("resumes a turn the server paused", async () => {
    let turn = 0;
    responder = () =>
      ++turn === 1
        ? {
            content: [
              { type: "server_tool_use", id: "s1", name: "web_search" },
            ],
            stop_reason: "pause_turn",
            usage: { input_tokens: 100, output_tokens: 10 },
          }
        : {
            content: [{ type: "text", text: "Satya Nadella is the CEO." }],
            stop_reason: "end_turn",
            usage: { input_tokens: 200, output_tokens: 20 },
          };
    const result = await adapter.generate({
      prompt: "Research Satya Nadella",
      responseFormat: "text",
      model: "claude-sonnet-5",
      enableSearchGrounding: true,
    });
    expect(result.text).toBe("Satya Nadella is the CEO.");
    expect(result.tokenCount).toBe(330);
    expect(calls).toHaveLength(2);
    const resumed = calls[1].messages as Array<{ role: string }>;
    expect(resumed.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("returns the pages the answer read", async () => {
    responder = () => ({
      content: [
        {
          type: "web_search_tool_result",
          content: [
            {
              type: "web_search_result",
              url: "https://news.microsoft.com/exec/satya-nadella/",
              title: "Satya Nadella",
            },
            { type: "web_search_result", url: "javascript:alert(1)" },
          ],
        },
        {
          type: "text",
          text: "He is the CEO.",
          citations: [
            {
              url: "https://en.wikipedia.org/wiki/Satya_Nadella",
              title: "Satya Nadella - Wikipedia",
            },
          ],
        },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const result = await adapter.generate({
      prompt: "Research",
      responseFormat: "text",
      model: "claude-sonnet-5",
      enableSearchGrounding: true,
    });
    expect(result.citations).toEqual([
      {
        title: "Satya Nadella - Wikipedia",
        uri: "https://en.wikipedia.org/wiki/Satya_Nadella",
      },
      {
        title: "Satya Nadella",
        uri: "https://news.microsoft.com/exec/satya-nadella/",
      },
    ]);
    // The basic tool: the dynamic-filtering one was five times slower on
    // the research prompt.
    expect(calls[0].tools).toEqual([
      { type: "web_search_20250305", name: "web_search", max_uses: 5 },
    ]);
    expect(calls[0].max_tokens).toBe(8192);
  });
});

describe("model class mapping", () => {
  // With no discovered models. API model IDs use dashes, not dots: dotted
  // IDs 404 on the live API.
  it.each([
    ["lite", "claude-haiku-4-5", { prefer: "lite" }],
    ["flash", "claude-sonnet-5", { prefer: "flash" }],
    ["pro", "claude-opus-5", { prefer: "pro" }],
    ["no preference", "claude-haiku-4-5", undefined],
  ] as const)("maps %s to %s", async (_label, model, routing) => {
    responder = () => ok("summary");
    await adapter.generate({ prompt: "x", responseFormat: "text", routing });
    expect(calls[0].model).toBe(model);
  });
});
