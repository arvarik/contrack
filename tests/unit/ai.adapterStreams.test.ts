// =============================================================================
// Adapter streams: `generateStream` on the four adapters
// =============================================================================
// The Ask brief grows word by word from these streams. Each adapter must:
//   - send the pieces in order, and return them joined, with the usage that
//     the provider reports at the end of the stream.
//   - run `generate` for a JSON or grounded call, and send its text as one
//     piece.
//   - fall back to `generate` when the stream fails before its first piece,
//     and reject when it fails after it. A piece cannot be taken back.
//   - stop when the caller cancels or the timeout fires, and send nothing
//     after that.
// The table proves these for each adapter. The blocks after it cover what
// one adapter does on its own.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AIGenerateOptions,
  AIGenerateResult,
} from "../../server/ai/types.ts";

/** The request a mocked Gemini call receives. */
interface GeminiParams {
  model: string;
  contents: string;
  config: Record<string, unknown> & { abortSignal?: AbortSignal };
}

/** The body a mocked OpenAI or Anthropic call receives. */
type Body = Record<string, unknown> & { stream?: boolean };

/** The request options a mocked OpenAI or Anthropic call receives. */
interface RequestOptions {
  signal?: AbortSignal;
}

const sdk = vi.hoisted(() => {
  /** What the mocked SDKs answer. A test points these at what it needs. */
  const replies = {
    /** The stream that a call which streams opens. */
    stream: (): Promise<AsyncIterable<unknown>> =>
      Promise.reject(new Error("the test set no stream")),
    /** The text that a call which does not stream answers with. */
    answer: "",
  };
  return {
    replies,
    geminiStream: vi.fn((_params: GeminiParams) => replies.stream()),
    geminiGenerate: vi.fn((_params: GeminiParams) =>
      Promise.resolve({ text: replies.answer }),
    ),
    openaiChat: vi.fn(
      (body: Body, _options?: RequestOptions): Promise<unknown> =>
        body.stream
          ? replies.stream()
          : Promise.resolve({
              choices: [{ message: { content: replies.answer } }],
              usage: { total_tokens: 3 },
            }),
    ),
    openaiResponses: vi.fn((_body: Body, _options?: RequestOptions) =>
      Promise.resolve({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: replies.answer }],
          },
        ],
        usage: { total_tokens: 3 },
      }),
    ),
    anthropic: vi.fn(
      (body: Body, _options?: RequestOptions): Promise<unknown> =>
        body.stream
          ? replies.stream()
          : Promise.resolve({
              content: [{ type: "text", text: replies.answer }],
              stop_reason: "end_turn",
              usage: { input_tokens: 2, output_tokens: 1 },
            }),
    ),
  };
});

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: sdk.geminiGenerate,
      generateContentStream: sdk.geminiStream,
    };
  },
  Type: {
    OBJECT: "OBJECT",
    ARRAY: "ARRAY",
    STRING: "STRING",
    NUMBER: "NUMBER",
    INTEGER: "INTEGER",
    BOOLEAN: "BOOLEAN",
  },
}));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: sdk.openaiChat } };
    responses = { create: sdk.openaiResponses };
  },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: sdk.anthropic };
  },
}));

import { GeminiAdapter } from "../../server/ai/adapters/gemini.ts";
import { OpenAIAdapter } from "../../server/ai/adapters/openai.ts";
import { AnthropicAdapter } from "../../server/ai/adapters/anthropic.ts";
import { OpenAICompatibleAdapter } from "../../server/ai/adapters/openaiCompatible.ts";

// ---------------------------------------------------------------------------
// Streams on the wire
// ---------------------------------------------------------------------------

/** A provider's stream: the chunks before the text, one per piece, and after. */
interface Wire {
  head: unknown[];
  piece: (text: string) => unknown;
  tail: unknown[];
}

/**
 * The stream an SDK hands back: the head, a chunk per piece, then the tail.
 * `failure` is thrown in place of the tail. `gate` holds the stream after its
 * first piece until the test opens it. The stream ignores the abort signal,
 * so a test proves that the adapter stops by itself.
 */
async function* wire(
  shape: Wire,
  pieces: string[],
  { failure, gate }: { failure?: Error; gate?: Promise<void> } = {},
): AsyncGenerator<unknown> {
  yield* shape.head;
  for (const [index, text] of pieces.entries()) {
    yield shape.piece(text);
    if (index === 0 && gate) await gate;
  }
  if (failure) throw failure;
  yield* shape.tail;
}

/** Make the next stream that the SDK opens send `pieces`. */
function streams(
  shape: Wire,
  pieces: string[],
  options?: { failure?: Error; gate?: Promise<void> },
): void {
  sdk.replies.stream = () => Promise.resolve(wire(shape, pieces, options));
}

/** The pieces a stream sends, and the callback that collects them. */
function collect(): { pieces: string[]; onDelta: (text: string) => void } {
  const pieces: string[] = [];
  return {
    pieces,
    onDelta: (text) => {
      pieces.push(text);
    },
  };
}

/** A promise that the test resolves by hand. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = () => resolve();
  });
  return { promise, open };
}

/** Let an abandoned stream run whatever it still would. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A 503 as the SDKs throw it. */
const overloaded = () =>
  Object.assign(new Error("503 The model is overloaded"), { status: 503 });

// ---------------------------------------------------------------------------
// The four adapters
// ---------------------------------------------------------------------------

/** What the table calls on each adapter. */
interface Streamer {
  generateStream(
    options: AIGenerateOptions,
    onDelta: (text: string) => void,
  ): Promise<AIGenerateResult>;
}

/** One adapter, as the table drives it. */
interface Case extends Wire {
  name: string;
  create: () => Streamer;
  /** The model each call names. A compat endpoint needs one. */
  model: string;
  /** How many SDK calls streamed, and how many did not. */
  streamCalls: () => number;
  plainCalls: () => number;
  /** The abort signal on the last call that streamed. */
  lastSignal: () => AbortSignal | undefined;
}

/** The chat calls that asked for a stream, from OpenAI or a compat server. */
const chatStreams = () =>
  sdk.openaiChat.mock.calls.filter(([body]) => body.stream);

/** The message calls that asked for a stream. */
const anthropicStreams = () =>
  sdk.anthropic.mock.calls.filter(([body]) => body.stream);

/** OpenAI's stream, which a compat server copies. */
const CHAT: Omit<Case, "name" | "create" | "model"> = {
  head: [
    { choices: [{ index: 0, delta: { role: "assistant", content: "" } }] },
  ],
  piece: (content) => ({ choices: [{ index: 0, delta: { content } }] }),
  tail: [
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    // The usage comes last, in a chunk with no choices.
    {
      choices: [],
      usage: { prompt_tokens: 11, completion_tokens: 9, total_tokens: 20 },
    },
  ],
  streamCalls: () => chatStreams().length,
  plainCalls: () =>
    sdk.openaiChat.mock.calls.length -
    chatStreams().length +
    sdk.openaiResponses.mock.calls.length,
  lastSignal: () => chatStreams().at(-1)?.[1]?.signal,
};

const GEMINI: Case = {
  name: "Gemini",
  create: () => new GeminiAdapter("test-only-key"),
  model: "gemini-3.8-flash",
  head: [],
  piece: (text) => ({ text }),
  // The last chunk carries the usage of the whole call, and no text.
  tail: [
    {
      usageMetadata: {
        promptTokenCount: 11,
        candidatesTokenCount: 7,
        thoughtsTokenCount: 2,
        totalTokenCount: 20,
      },
    },
  ],
  streamCalls: () => sdk.geminiStream.mock.calls.length,
  plainCalls: () => sdk.geminiGenerate.mock.calls.length,
  lastSignal: () => sdk.geminiStream.mock.lastCall?.[0].config.abortSignal,
};

const OPENAI: Case = {
  name: "OpenAI",
  create: () => new OpenAIAdapter("test-key"),
  model: "gpt-6-luna",
  ...CHAT,
};

const ANTHROPIC: Case = {
  name: "Anthropic",
  create: () => new AnthropicAdapter("test-key"),
  model: "claude-sonnet-5",
  head: [
    {
      type: "message_start",
      message: { usage: { input_tokens: 11, output_tokens: 1 } },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
  ],
  piece: (text) => ({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  }),
  // The output count is cumulative, and the last message_delta has the total.
  tail: [
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 9 },
    },
    { type: "message_stop" },
  ],
  streamCalls: () => anthropicStreams().length,
  plainCalls: () => sdk.anthropic.mock.calls.length - anthropicStreams().length,
  lastSignal: () => anthropicStreams().at(-1)?.[1]?.signal,
};

const COMPAT: Case = {
  name: "OpenAI-compatible",
  create: () =>
    new OpenAICompatibleAdapter({
      baseUrl: "http://alpha:8080/v1",
      label: "Homelab",
    }),
  model: "gemma-4",
  ...CHAT,
};

beforeEach(() => {
  sdk.geminiStream.mockReset();
  sdk.geminiGenerate.mockReset();
  sdk.openaiChat.mockReset();
  sdk.openaiResponses.mockReset();
  sdk.anthropic.mockReset();
  sdk.replies.stream = () =>
    Promise.reject(new Error("the test set no stream"));
  sdk.replies.answer = "";
});

// ---------------------------------------------------------------------------
// The contract, on every adapter
// ---------------------------------------------------------------------------

describe.each([GEMINI, OPENAI, ANTHROPIC, COMPAT])(
  "$name generateStream",
  (c) => {
    const request = (
      extra: Partial<AIGenerateOptions> = {},
    ): AIGenerateOptions => ({
      prompt: "Who is Ada?",
      responseFormat: "text",
      model: c.model,
      ...extra,
    });

    it("sends the pieces in order and returns them joined, with the usage", async () => {
      streams(c, ["Ada ", "is ", "an engineer."]);
      const { pieces, onDelta } = collect();
      const result = await c.create().generateStream(request(), onDelta);
      expect(pieces).toEqual(["Ada ", "is ", "an engineer."]);
      expect(result).toMatchObject({
        text: "Ada is an engineer.",
        model: c.model,
        tokenCount: 20,
        usage: { inputTokens: 11, outputTokens: 9 },
      });
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect([c.streamCalls(), c.plainCalls()]).toEqual([1, 0]);
      expect(c.lastSignal()).toBeInstanceOf(AbortSignal);
    });

    const notStreamed: Array<[string, Partial<AIGenerateOptions>]> = [
      ["a JSON request", { responseFormat: "json" }],
      ["a grounded request", { enableSearchGrounding: true }],
    ];
    it.each(notStreamed)(
      "runs generate for %s and sends its text as one piece",
      async (_label, extra) => {
        sdk.replies.answer = '{"name":"Ada"}';
        const { pieces, onDelta } = collect();
        const result = await c.create().generateStream(request(extra), onDelta);
        expect(pieces).toEqual(['{"name":"Ada"}']);
        expect(result.text).toBe('{"name":"Ada"}');
        expect([c.streamCalls(), c.plainCalls()]).toEqual([0, 1]);
      },
    );

    const early: Array<[string, () => void]> = [
      [
        "is refused",
        () => {
          sdk.replies.stream = () => Promise.reject(overloaded());
        },
      ],
      [
        "breaks before any text",
        () => streams(c, [], { failure: new Error("socket hang up") }),
      ],
    ];
    it.each(early)(
      "falls back to generate when the stream %s",
      async (_label, fail) => {
        fail();
        sdk.replies.answer = "Ada is an engineer.";
        const { pieces, onDelta } = collect();
        const result = await c.create().generateStream(request(), onDelta);
        expect(pieces).toEqual(["Ada is an engineer."]);
        expect(result.text).toBe("Ada is an engineer.");
        expect([c.streamCalls(), c.plainCalls()]).toEqual([1, 1]);
      },
    );

    it("rejects when the stream breaks after its first piece, and runs nothing more", async () => {
      streams(c, ["Ada "], { failure: new Error("socket hang up") });
      const { pieces, onDelta } = collect();
      await expect(
        c.create().generateStream(request(), onDelta),
      ).rejects.toThrow("socket hang up");
      expect(pieces).toEqual(["Ada "]);
      expect([c.streamCalls(), c.plainCalls()]).toEqual([1, 0]);
    });

    it("stops when the caller cancels, and sends nothing more", async () => {
      streams(c, ["Ada ", "is ", "an engineer."]);
      const controller = new AbortController();
      const pieces: string[] = [];
      const run = c
        .create()
        .generateStream(request({ signal: controller.signal }), (text) => {
          pieces.push(text);
          controller.abort();
        });
      await expect(run).rejects.toMatchObject({ code: "CANCELLED" });
      await settle();
      expect(pieces).toEqual(["Ada "]);
      // The SDK call is cancelled too, and nothing falls back to generate.
      expect(c.lastSignal()?.aborted).toBe(true);
      expect(c.plainCalls()).toBe(0);
    });

    it("starts nothing for a caller that has already cancelled", async () => {
      const controller = new AbortController();
      controller.abort();
      const { pieces, onDelta } = collect();
      await expect(
        c
          .create()
          .generateStream(request({ signal: controller.signal }), onDelta),
      ).rejects.toMatchObject({ code: "CANCELLED" });
      expect(pieces).toEqual([]);
      expect([c.streamCalls(), c.plainCalls()]).toEqual([0, 0]);
    });

    it("rejects at the timeout, and never sends a piece that arrives after it", async () => {
      const late = gate();
      streams(c, ["Ada ", "is late."], { gate: late.promise });
      const { pieces, onDelta } = collect();
      await expect(
        c.create().generateStream(request({ timeoutMs: 20 }), onDelta),
      ).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT" });
      late.open();
      await settle();
      expect(pieces).toEqual(["Ada "]);
      expect(c.lastSignal()?.aborted).toBe(true);
    });
  },
);

// ---------------------------------------------------------------------------
// What each adapter does on its own
// ---------------------------------------------------------------------------

describe("Gemini stream", () => {
  const request = {
    prompt: "Who is Ada?",
    responseFormat: "text" as const,
    model: "gemini-3.8-flash",
  };

  it("sends the config that a text call gets, with the abort signal", async () => {
    streams(GEMINI, ["Ada"]);
    await new GeminiAdapter("test-only-key").generateStream(
      { ...request, systemPrompt: "Be brief.", maxOutputTokens: 500 },
      () => {},
    );
    const params = sdk.geminiStream.mock.calls[0][0];
    expect(params.model).toBe("gemini-3.8-flash");
    expect(params.contents).toBe("Who is Ada?");
    expect(params.config).toEqual({
      maxOutputTokens: 500,
      thinkingConfig: { thinkingLevel: "low" },
      responseMimeType: "text/plain",
      systemInstruction: "Be brief.",
      abortSignal: expect.any(AbortSignal),
    });
  });

  it("pauses a routed model whose stream is refused, and generate answers on the next", async () => {
    sdk.replies.stream = () => Promise.reject(overloaded());
    sdk.replies.answer = "Ada is an engineer.";
    const adapter = new GeminiAdapter("test-only-key");
    const { pieces, onDelta } = collect();
    const result = await adapter.generateStream(
      {
        prompt: "Who is Ada?",
        responseFormat: "text",
        routing: { prefer: "flash" },
      },
      onDelta,
    );
    expect(sdk.geminiStream.mock.calls[0][0].model).toBe("gemini-3.8-flash");
    expect(sdk.geminiGenerate.mock.calls[0][0].model).toBe("gemini-3.7-flash");
    expect(result.model).toBe("gemini-3.7-flash");
    expect(pieces).toEqual(["Ada is an engineer."]);
    expect(adapter.getQuotaSnapshot().circuitBreakers).toEqual([
      "gemini-3.8-flash",
    ]);
  });

  it("counts a streamed call, and takes back one that Google refused", async () => {
    const adapter = new GeminiAdapter("test-only-key");
    streams(GEMINI, ["Ada"]);
    await adapter.generateStream(request, () => {});
    expect(adapter.getQuotaSnapshot().models["gemini-3.8-flash"]).toMatchObject(
      { rpd: 1, tpm: 20 },
    );

    // The refused stream is taken back, and the generate after it counts.
    sdk.replies.stream = () =>
      Promise.reject(
        Object.assign(new Error("429 Resource exhausted"), { status: 429 }),
      );
    sdk.replies.answer = "Ada";
    await adapter.generateStream(request, () => {});
    expect(adapter.getQuotaSnapshot().models["gemini-3.8-flash"].rpd).toBe(2);
  });

  it("drops a thinking level that the model refuses, and still streams", async () => {
    sdk.geminiStream.mockImplementationOnce(() =>
      Promise.reject(
        Object.assign(
          new Error("400 Thinking level is not supported for this model."),
          { status: 400 },
        ),
      ),
    );
    streams(GEMINI, ["Ada"]);
    const adapter = new GeminiAdapter("test-only-key");
    const { pieces, onDelta } = collect();
    await adapter.generateStream(request, onDelta);
    expect(pieces).toEqual(["Ada"]);
    expect(
      sdk.geminiStream.mock.calls.map(
        ([params]) => params.config.thinkingConfig,
      ),
    ).toEqual([{ thinkingLevel: "low" }, undefined]);
    expect(sdk.geminiGenerate).not.toHaveBeenCalled();

    // Remembered: a later call that does not stream sends none either.
    sdk.replies.answer = "ok";
    await adapter.generate(request);
    expect(
      sdk.geminiGenerate.mock.calls[0][0].config.thinkingConfig,
    ).toBeUndefined();
  });
});

describe("OpenAI stream", () => {
  it("asks for the usage, and keeps the effort and budget rules", async () => {
    streams(OPENAI, ["Ada"]);
    await new OpenAIAdapter("test-key").generateStream(
      {
        prompt: "Who is Ada?",
        systemPrompt: "Be brief.",
        responseFormat: "text",
        model: "gpt-6-sol",
        routing: { prefer: "flash" },
        maxOutputTokens: 200,
      },
      () => {},
    );
    const [body, options] = sdk.openaiChat.mock.calls[0];
    expect(body).toEqual({
      model: "gpt-6-sol",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Who is Ada?" },
      ],
      stream: true,
      stream_options: { include_usage: true },
      // "low" reasons, so the budget has room for the reasoning.
      max_completion_tokens: 2048,
      reasoning_effort: "low",
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("corrects an effort that the model refuses, and still streams", async () => {
    // The refusal is a 400 to the request, before any chunk.
    sdk.openaiChat.mockImplementationOnce(() =>
      Promise.reject(
        Object.assign(
          new Error(
            "400 Unsupported value: 'reasoning_effort' does not support 'none' with this model. Supported values are: 'low', 'medium', 'high', and 'xhigh'.",
          ),
          { status: 400 },
        ),
      ),
    );
    streams(OPENAI, ["Ada"]);
    const { pieces, onDelta } = collect();
    await new OpenAIAdapter("test-key").generateStream(
      {
        prompt: "Who is Ada?",
        responseFormat: "text",
        model: "gpt-6-astra",
        routing: { prefer: "lite" },
      },
      onDelta,
    );
    expect(pieces).toEqual(["Ada"]);
    expect(chatStreams().map(([body]) => body.reasoning_effort)).toEqual([
      "none",
      "low",
    ]);
    expect(OPENAI.plainCalls()).toBe(0);
  });
});

describe("Anthropic stream", () => {
  const effortOf = (body: Body) =>
    (body.output_config as { effort?: string } | undefined)?.effort;

  it("sends a plain text request with the effort, and never sends the thinking", async () => {
    // A model that thinks first: a thinking block, then the text block.
    const thinking: Wire = {
      head: [
        ANTHROPIC.head[0],
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "They ask about Ada." },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "sig" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "text", text: "" },
        },
      ],
      piece: (text) => ({
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text },
      }),
      tail: ANTHROPIC.tail,
    };
    streams(thinking, ["Ada ", "is an engineer."]);
    const { pieces, onDelta } = collect();
    const result = await new AnthropicAdapter("test-key").generateStream(
      {
        prompt: "Who is Ada?",
        systemPrompt: "  Be brief.  ",
        responseFormat: "text",
        model: "claude-sonnet-5",
        routing: { prefer: "flash" },
      },
      onDelta,
    );
    expect(pieces).toEqual(["Ada ", "is an engineer."]);
    expect(result.text).toBe("Ada is an engineer.");
    const [body, options] = sdk.anthropic.mock.calls[0];
    expect(body).toEqual({
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "Who is Ada?" }],
      max_tokens: 4096,
      stream: true,
      system: "Be brief.",
      output_config: { effort: "low" },
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("drops an effort that the model refuses, and still streams", async () => {
    sdk.anthropic.mockImplementationOnce(() =>
      Promise.reject(
        new Error(
          '400 {"type":"error","error":{"type":"invalid_request_error","message":"This model does not support the effort parameter."}}',
        ),
      ),
    );
    streams(ANTHROPIC, ["Ada"]);
    const { pieces, onDelta } = collect();
    await new AnthropicAdapter("test-key").generateStream(
      {
        prompt: "Who is Ada?",
        responseFormat: "text",
        model: "claude-new-model",
      },
      onDelta,
    );
    expect(pieces).toEqual(["Ada"]);
    expect(anthropicStreams().map(([body]) => effortOf(body))).toEqual([
      "low",
      undefined,
    ]);
    expect(ANTHROPIC.plainCalls()).toBe(0);
  });
});

describe("OpenAI-compatible stream", () => {
  const adapter = () =>
    new OpenAICompatibleAdapter({
      baseUrl: "http://alpha:8080/v1",
      label: "Homelab",
    });

  /** A local reasoning model: its thinking arrives before the answer. */
  const reasoning: Wire = {
    head: [
      {
        choices: [
          { delta: { role: "assistant", reasoning_content: "They ask " } },
        ],
      },
      { choices: [{ delta: { reasoning_content: "about Ada." } }] },
    ],
    piece: (content) => ({ choices: [{ delta: { content } }] }),
    tail: [{ choices: [{ delta: {}, finish_reason: "stop" }] }],
  };

  it("sends the answer and never the reasoning", async () => {
    streams(reasoning, ["Ada ", "is an engineer."]);
    const { pieces, onDelta } = collect();
    const result = await adapter().generateStream(
      {
        prompt: "Who is Ada?",
        systemPrompt: " Be brief. ",
        responseFormat: "text",
        model: "gemma-4",
        maxOutputTokens: 300,
      },
      onDelta,
    );
    expect(pieces).toEqual(["Ada ", "is an engineer."]);
    expect(result.text).toBe("Ada is an engineer.");
    // This server reports no usage, so the result claims none.
    expect(result.tokenCount).toBeUndefined();
    expect(result.usage).toBeUndefined();
    expect(sdk.openaiChat.mock.calls[0][0]).toEqual({
      model: "gemma-4",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Who is Ada?" },
      ],
      stream: true,
      max_tokens: 300,
    });
  });

  it("reports a model that only reasoned as AI_NO_ANSWER, and does not ask again", async () => {
    streams(
      {
        ...reasoning,
        tail: [{ choices: [{ delta: {}, finish_reason: "length" }] }],
      },
      [],
    );
    const { pieces, onDelta } = collect();
    const error = await adapter()
      .generateStream(
        { prompt: "Reply OK", responseFormat: "text", model: "gemma-4" },
        onDelta,
      )
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      statusCode: 422,
      code: "AI_NO_ANSWER",
      message: expect.stringMatching(/finish_reason=length/),
    });
    expect(pieces).toEqual([]);
    // A second call would spend the same budget on the same reasoning.
    expect([COMPAT.streamCalls(), COMPAT.plainCalls()]).toEqual([1, 0]);
  });

  it("names the fix when no model is chosen, and sends nothing", async () => {
    const { pieces, onDelta } = collect();
    await expect(
      adapter().generateStream(
        { prompt: "hi", responseFormat: "text" },
        onDelta,
      ),
    ).rejects.toMatchObject({ statusCode: 503, code: "AI_NO_MODEL_SELECTED" });
    expect(pieces).toEqual([]);
    expect(sdk.openaiChat).not.toHaveBeenCalled();
  });
});
