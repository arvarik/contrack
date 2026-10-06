// Unit: the OpenAI adapter's request shapes. Most cases are failures of the
// real API:
//   - GPT-6 and GPT-5.6 reason at "medium" when told nothing, so quick work
//     pays for hidden reasoning and query planning runs past its 4 s budget.
//   - Some models refuse some efforts (Astra refuses "none", GPT-5 nano wants
//     "minimal"), and a model from before reasoning refuses the parameter.
//   - A small `max_completion_tokens` leaves a reasoning model no room to
//     answer: finish_reason "length" and an empty string.
//   - An array at the schema's root is a 400.
//   - Grounded research must send the Responses API its own format.
// The others pin the model each class gets before discovery runs, and the
// schema dialect: no `strict`, which optional fields turn into a 400, and
// nullable fields as `anyOf`.

import { describe, it, expect, vi, beforeEach } from "vitest";

const chatCalls: Record<string, unknown>[] = [];
const responsesCalls: Record<string, unknown>[] = [];
let chatResponder: (params: Record<string, unknown>) => unknown;
let responsesResponder: (params: Record<string, unknown>) => unknown;

vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: (params: Record<string, unknown>) => {
          chatCalls.push(params);
          return Promise.resolve().then(() => chatResponder(params));
        },
      },
    };
    responses = {
      create: (params: Record<string, unknown>) => {
        responsesCalls.push(params);
        return Promise.resolve().then(() => responsesResponder(params));
      },
    };
    models = { list: () => Promise.resolve({ data: [] }) };
  },
}));

const { OpenAIAdapter } =
  await import("../../../../server/ai/adapters/openai.ts");

const answer = (content: string) => ({
  choices: [{ message: { content } }],
  usage: { total_tokens: 12 },
});

/** The 400s the live API returned, verbatim. */
const unsupportedValue = (values: string) =>
  Object.assign(
    new Error(
      `400 Unsupported value: 'reasoning_effort' does not support 'none' with this model. Supported values are: ${values}.`,
    ),
    { status: 400 },
  );
const unrecognized = () =>
  Object.assign(
    new Error("400 Unrecognized request argument supplied: reasoning_effort"),
    { status: 400 },
  );

let adapter: InstanceType<typeof OpenAIAdapter>;

beforeEach(() => {
  chatCalls.length = 0;
  responsesCalls.length = 0;
  chatResponder = () => answer("ok");
  responsesResponder = () => ({ output: [], usage: { total_tokens: 1 } });
  adapter = new OpenAIAdapter("test-key");
});

describe("reasoning effort", () => {
  it("asks for none on quick work and low on deep work", async () => {
    await adapter.generate({
      prompt: "x",
      responseFormat: "text",
      model: "gpt-6-luna",
      routing: { prefer: "lite" },
    });
    await adapter.generate({
      prompt: "x",
      responseFormat: "text",
      model: "gpt-6-sol",
      routing: { prefer: "flash" },
    });
    expect(chatCalls.map((c) => c.reasoning_effort)).toEqual(["none", "low"]);
  });

  it("steps up to the lowest effort a model accepts, once", async () => {
    chatResponder = (params) => {
      if (params.reasoning_effort === "none")
        throw unsupportedValue("'low', 'medium', 'high', and 'xhigh'");
      return answer("ok");
    };
    const request = {
      prompt: "x",
      responseFormat: "text" as const,
      model: "gpt-6-astra",
      routing: { prefer: "lite" as const },
    };
    await adapter.generate(request);
    await adapter.generate(request);
    expect(chatCalls.map((c) => c.reasoning_effort)).toEqual([
      "none",
      "low",
      "low",
    ]);
  });

  it("finds 'minimal' for a model that has no 'none'", async () => {
    chatResponder = (params) => {
      if (params.reasoning_effort === "none")
        throw unsupportedValue("'minimal', 'low', 'medium', and 'high'");
      return answer("ok");
    };
    await adapter.generate({
      prompt: "x",
      responseFormat: "text",
      model: "gpt-5-nano",
    });
    expect(chatCalls[1].reasoning_effort).toBe("minimal");
  });

  it("drops the parameter for a model from before reasoning", async () => {
    chatResponder = (params) => {
      if ("reasoning_effort" in params) throw unrecognized();
      return answer("ok");
    };
    await adapter.generate({
      prompt: "x",
      responseFormat: "text",
      model: "gpt-4.1",
      maxOutputTokens: 200,
    });
    expect(chatCalls).toHaveLength(2);
    expect("reasoning_effort" in chatCalls[1]).toBe(false);
    // A model that cannot reason keeps the caller's budget.
    expect(chatCalls[1].max_completion_tokens).toBe(200);
  });

  it("gives a reasoning call room to answer", async () => {
    await adapter.generate({
      prompt: "x",
      responseFormat: "text",
      model: "gpt-6-sol",
      routing: { prefer: "flash" },
      maxOutputTokens: 200,
    });
    await adapter.generate({
      prompt: "x",
      responseFormat: "text",
      model: "gpt-6-luna",
      routing: { prefer: "lite" },
      maxOutputTokens: 200,
    });
    // "low" reasons, so the budget covers the reasoning; "none" does not.
    expect(chatCalls.map((c) => c.max_completion_tokens)).toEqual([2048, 200]);
  });
});

describe("structured output", () => {
  it("wraps an array root and hands the caller the array", async () => {
    chatResponder = () => answer('{"items":["one","two"]}');
    const result = await adapter.generate({
      prompt: "x",
      responseFormat: "json",
      model: "gpt-6-luna",
      jsonSchema: { type: "array", items: { type: "string" } },
    });
    const format = chatCalls[0].response_format as {
      json_schema: { schema: { type: string } };
    };
    expect(format.json_schema.schema.type).toBe("object");
    expect(JSON.parse(result.text)).toEqual(["one", "two"]);
  });

  it("returns JSON that parses as it stands", async () => {
    chatResponder = () => answer('```json\n{"name":"Jane"}\n```');
    const result = await adapter.generate({
      prompt: "x",
      responseFormat: "json",
      model: "gpt-6-luna",
      jsonSchema: {
        type: "object",
        properties: { name: { type: "string" } },
      },
    });
    expect(result.text).toBe('{"name":"Jane"}');
  });

  it("sends the schema in a json_schema format, without strict", async () => {
    chatResponder = () => answer('{"name":"Jane"}');
    await adapter.generate({
      prompt: "x",
      responseFormat: "json",
      model: "gpt-6-luna",
      jsonSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
        },
        required: ["name"],
      },
    });

    // `strict: true` must NOT be sent. Strict mode requires `required` to
    // list every key in `properties`, and this schema — like every real one
    // in Contrack — has optional fields. Asserting strict here is what let
    // the 400 ship: the unit test was green while every OpenAI JSON call
    // failed against the real API.
    const format = chatCalls[0].response_format as {
      json_schema: Record<string, unknown>;
    };
    expect(format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "response",
        schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "integer" },
          },
          required: ["name"],
          additionalProperties: false,
        },
      },
    });
    expect("strict" in format.json_schema).toBe(false);
  });

  it("sends a nullable field as anyOf", async () => {
    chatResponder = () => answer('{"company":null}');
    await adapter.generate({
      prompt: "x",
      responseFormat: "json",
      model: "gpt-6-luna",
      jsonSchema: {
        type: "object",
        properties: { company: { type: "string", nullable: true } },
      },
    });

    const format = chatCalls[0].response_format as {
      json_schema: {
        schema: { properties: { company: { anyOf?: unknown[] } } };
      };
    };
    const company = format.json_schema.schema.properties.company;
    // OpenAI doesn't support nullable — must use anyOf pattern
    expect(company).toHaveProperty("anyOf");
    expect(company.anyOf).toContainEqual({ type: "string" });
    expect(company.anyOf).toContainEqual({ type: "null" });
  });
});

describe("web research", () => {
  it("sends the Responses API its own format and returns the sources", async () => {
    responsesResponder = () => ({
      output: [
        {
          type: "web_search_call",
          action: {
            sources: [
              { type: "url", url: "https://www.linkedin.com/in/satyanadella" },
              { type: "url", url: "https://www.linkedin.com/in/satyanadella" },
              { type: "url", url: "ftp://example.com/file" },
            ],
          },
        },
        {
          type: "message",
          content: [{ type: "output_text", text: '{"name":"Satya Nadella"}' }],
        },
      ],
      usage: { total_tokens: 8904 },
    });
    const result = await adapter.generate({
      prompt: "Research Satya Nadella",
      responseFormat: "json",
      model: "gpt-6-sol",
      routing: { prefer: "flash" },
      enableSearchGrounding: true,
      jsonSchema: {
        type: "object",
        properties: { name: { type: "string" } },
      },
    });

    const call = responsesCalls[0];
    expect(call.store).toBe(false);
    expect(call.include).toEqual(["web_search_call.action.sources"]);
    expect(call.reasoning).toEqual({ effort: "low" });
    expect(call.text).toMatchObject({
      format: { type: "json_schema", name: "response", strict: false },
    });
    expect(result.text).toBe('{"name":"Satya Nadella"}');
    expect(result.citations).toEqual([
      {
        title: "linkedin.com",
        uri: "https://www.linkedin.com/in/satyanadella",
      },
    ]);
  });

  it("researches at no less than low effort, even for a quick pin", async () => {
    await adapter.generate({
      prompt: "x",
      responseFormat: "text",
      model: "gpt-6-luna",
      routing: { prefer: "lite" },
      enableSearchGrounding: true,
    });
    expect(responsesCalls[0].reasoning).toEqual({ effort: "low" });
  });
});

describe("model class mapping", () => {
  // With no discovered models. GPT-6 renamed the tiers: Astra is the
  // flagship, Sol the middle and Luna the cheap one.
  it.each([
    ["lite", "gpt-6-luna", { prefer: "lite" }],
    ["flash", "gpt-6-sol", { prefer: "flash" }],
    ["pro", "gpt-6-astra", { prefer: "pro" }],
    ["no preference", "gpt-6-luna", undefined],
  ] as const)("maps %s to %s", async (_label, model, routing) => {
    await adapter.generate({ prompt: "x", responseFormat: "text", routing });
    expect(chatCalls[0].model).toBe(model);
  });
});
