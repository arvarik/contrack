// Unit: the OpenAI-compatible adapter's structured-output negotiation.
// Self-hosted backends implement different parts of the OpenAI surface and
// can fail quietly, with a 200 whose body is not the JSON asked for, so the
// negotiation downgrades on an unparseable body as well as on a rejection.
//
// The reasoning-model cases come from a real llama.cpp server (gemma-4-12B on
// CUDA): it splits output into `reasoning_content` and `content`, so a tight
// token ceiling yields a 200 with an empty answer.

import { describe, it, expect, vi, beforeEach } from "vitest";

/** Captures each outbound request so we can assert what was negotiated. */
const calls: Record<string, unknown>[] = [];
let responder: (params: Record<string, unknown>) => unknown;
/** What the endpoint's `/v1/models` lists. */
let modelList: Record<string, unknown>[] = [];

vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: (params: Record<string, unknown>) => {
          calls.push(params);
          return Promise.resolve(responder(params));
        },
      },
    };
    models = { list: () => Promise.resolve(modelList) };
    embeddings = { create: () => Promise.resolve({ data: [] }) };
  },
}));

const { OpenAICompatibleAdapter } =
  await import("../../../../server/ai/adapters/openaiCompatible.ts");

/** Shape of a normal completion. */
const ok = (content: string) => ({
  choices: [{ finish_reason: "stop", message: { content } }],
  usage: { total_tokens: 42 },
});

const formatOf = (call: Record<string, unknown>) =>
  (call.response_format as { type?: string } | undefined)?.type ?? "none";

let adapter: InstanceType<typeof OpenAICompatibleAdapter>;

beforeEach(() => {
  calls.length = 0;
  adapter = new OpenAICompatibleAdapter({
    baseUrl: "http://alpha:8080/v1",
    label: "Homelab",
  });
});

const jsonRequest = {
  prompt: "Extract the contact",
  responseFormat: "json" as const,
  model: "gemma-4",
  jsonSchema: {
    type: "object" as const,
    properties: { name: { type: "string" as const } },
    required: ["name"],
  },
};

describe("structured-output negotiation", () => {
  it("uses strict json_schema when the backend honors it", async () => {
    responder = () => ok('{"name":"Jane"}');
    const result = await adapter.generate(jsonRequest);
    expect(result.text).toBe('{"name":"Jane"}');
    expect(calls).toHaveLength(1);
    expect(formatOf(calls[0])).toBe("json_schema");
  });

  it("downgrades when json_schema is ACCEPTED but the body is not JSON", async () => {
    // The quiet failure: HTTP 200, unusable payload.
    responder = (params) =>
      formatOf(params) === "json_schema"
        ? ok("Sure! Here is the contact: name = Jane")
        : ok('{"name":"Jane"}');

    const result = await adapter.generate(jsonRequest);
    expect(result.text).toBe('{"name":"Jane"}');
    expect(calls.map(formatOf)).toEqual(["json_schema", "json_object"]);
  });

  it("downgrades when the backend rejects json_schema outright", async () => {
    responder = (params) => {
      if (formatOf(params) === "json_schema")
        throw new Error("400 response_format json_schema is not supported");
      return ok('{"name":"Jane"}');
    };
    const result = await adapter.generate(jsonRequest);
    expect(result.text).toBe('{"name":"Jane"}');
    expect(calls.map(formatOf)).toEqual(["json_schema", "json_object"]);
  });

  it("falls all the way to prompt mode and inlines the schema", async () => {
    responder = (params) =>
      formatOf(params) === "none" ? ok('{"name":"Jane"}') : ok("not json");

    const result = await adapter.generate(jsonRequest);
    expect(result.text).toBe('{"name":"Jane"}');
    expect(calls.map(formatOf)).toEqual(["json_schema", "json_object", "none"]);
    const system = (
      calls[2].messages as Array<{ role: string; content: string }>
    ).find((m) => m.role === "system");
    expect(system?.content).toContain("valid JSON only");
    expect(system?.content).toContain('"name"');
  });

  it("remembers the working mode so later calls skip failed rungs", async () => {
    responder = (params) =>
      formatOf(params) === "json_schema" ? ok("broken{") : ok('{"name":"J"}');

    await adapter.generate(jsonRequest);
    calls.length = 0;
    await adapter.generate(jsonRequest);

    // Second call starts at json_object, not json_schema.
    expect(calls.map(formatOf)).toEqual(["json_object"]);
  });

  it("does not negotiate for non-JSON requests", async () => {
    responder = () => ok("plain prose");
    const result = await adapter.generate({
      prompt: "Summarize",
      model: "gemma-4",
      responseFormat: "text",
    });
    expect(result.text).toBe("plain prose");
    expect(calls.map(formatOf)).toEqual(["none"]);
  });
});

describe("reasoning models", () => {
  it("reports budget exhaustion and the token limit instead of an empty answer", async () => {
    responder = () => ({
      choices: [
        {
          finish_reason: "length",
          message: { content: "", reasoning_content: "Let me think about…" },
        },
      ],
    });
    await expect(
      adapter.generate({
        prompt: "Reply OK",
        model: "gemma-4",
        responseFormat: "text",
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "AI_NO_ANSWER",
      message: expect.stringMatching(/reasoning.*finish_reason=length/),
    });
  });

  it("accepts a reasoning model that does produce an answer", async () => {
    responder = () => ({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "OK", reasoning_content: "brief thought" },
        },
      ],
    });
    const result = await adapter.generate({
      prompt: "Reply OK",
      model: "gemma-4",
      responseFormat: "text",
    });
    expect(result.text).toBe("OK");
  });
});

describe("guard rails", () => {
  it("requires an explicit model, and says how to supply one", async () => {
    // Capability resolution names a model from the discovered catalog, so an
    // adapter reached with none means discovery never produced one. The error
    // has to name the fix — this is what a self-hosted user sees when their
    // endpoint was saved while unreachable.
    responder = () => ok("x");
    await expect(
      adapter.generate({ prompt: "hi", responseFormat: "text" }),
    ).rejects.toThrow(/refresh this server's model list/i);
  });
});

describe("the model list", () => {
  it("keeps the context window a server reports, under each name it uses", async () => {
    modelList = [
      { id: "vllm-model", object: "model", max_model_len: 32_768 },
      { id: "router-model", object: "model", context_length: 8_192 },
      { id: "other-model", object: "model", context_window: 16_384 },
      // Ollama lists no window.
      { id: "ollama-model", object: "model", owned_by: "library" },
      { id: "odd-model", object: "model", max_model_len: "large" },
    ];
    const models = await adapter.listModels();
    expect(models.map((model) => [model.id, model.contextWindow])).toEqual([
      ["vllm-model", 32_768],
      ["router-model", 8_192],
      ["other-model", 16_384],
      ["ollama-model", undefined],
      ["odd-model", undefined],
    ]);
    modelList = [];
  });
});
