// =============================================================================
// OpenAI-compatible adapter — structured-output negotiation
// =============================================================================
// Self-hosted backends vary wildly in how much of the OpenAI surface they
// really implement, and they can fail *quietly* — a 200 whose body is not the
// JSON that was asked for. The negotiation therefore downgrades on an
// unparseable body as well as on an outright rejection.
//
// The reasoning-model cases come from a real llama.cpp server (gemma-4-12B on
// CUDA): it splits output into `reasoning_content` and `content`, so a tight
// token ceiling yields a 200 with an empty answer.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

/** Captures each outbound request so we can assert what was negotiated. */
const calls: Record<string, unknown>[] = [];
let responder: (params: Record<string, unknown>) => unknown;

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
    models = { list: () => Promise.resolve([]) };
    embeddings = { create: () => Promise.resolve({ data: [] }) };
  },
}));

const { OpenAICompatibleAdapter } =
  await import("../../server/ai/adapters/openaiCompatible.ts");

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
  it("reports budget exhaustion instead of returning an empty answer", async () => {
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
    ).rejects.toThrow(/reasoning/i);
  });

  it("mentions the token limit when the model was truncated", async () => {
    responder = () => ({
      choices: [
        {
          finish_reason: "length",
          message: { content: "", reasoning_content: "thinking…" },
        },
      ],
    });
    await expect(
      adapter.generate({
        prompt: "Reply OK",
        model: "gemma-4",
        responseFormat: "text",
      }),
    ).rejects.toThrow(/finish_reason=length/);
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
  it("requires an explicit model — compat endpoints have no default", async () => {
    responder = () => ok("x");
    await expect(
      adapter.generate({ prompt: "hi", responseFormat: "text" }),
    ).rejects.toThrow(/model must be selected/i);
  });

  it("never claims search grounding", () => {
    expect(adapter.supportsSearchGrounding).toBe(false);
  });
});
