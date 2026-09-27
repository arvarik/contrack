import { beforeEach, describe, it, expect, vi } from "vitest";
const sdk = vi.hoisted(() => ({
  generate: vi.fn(),
  configs: [] as Record<string, unknown>[],
}));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    constructor(config: Record<string, unknown>) {
      sdk.configs.push(config);
    }
    models = { generateContent: sdk.generate };
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
import {
  GeminiAdapter,
  isFreeTierError,
  pauseForError,
} from "../../server/ai/adapters/gemini.ts";
beforeEach(() => {
  sdk.generate.mockReset();
  sdk.configs.length = 0;
});
describe("Gemini call budget", () => {
  it("disables nested SDK retries and counts explicit-model grounding calls", async () => {
    sdk.generate.mockResolvedValue({
      text: "Research",
      usageMetadata: { totalTokenCount: 12 },
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [
              { web: { title: "Source", uri: "https://example.com/source" } },
            ],
          },
        },
      ],
    });
    const adapter = new GeminiAdapter("test-only-key");
    const result = await adapter.generate({
      prompt: "test",
      model: "test-model",
      responseFormat: "text",
      enableSearchGrounding: true,
      maxOutputTokens: 100,
    });
    expect(sdk.configs[0]).toMatchObject({
      httpOptions: { retryOptions: { attempts: 1 } },
    });
    expect(sdk.generate.mock.calls[0][0].config).toMatchObject({
      maxOutputTokens: 100,
      abortSignal: expect.any(AbortSignal),
    });
    expect(result.citations).toEqual([
      { title: "Source", uri: "https://example.com/source" },
    ]);
    expect(adapter.getQuotaSnapshot().grounding.rpd).toBe(1);
    expect(adapter.getQuotaSnapshot().models["test-model"].tpm).toBe(12);
  });
  it("does not repeat an accepted generation that returns malformed JSON", async () => {
    sdk.generate.mockResolvedValue({ text: "bad output" });
    await expect(
      new GeminiAdapter("test-only-key").generate({
        prompt: "test",
        model: "test-model",
        responseFormat: "json",
      }),
    ).rejects.toMatchObject({ code: "AI_INVALID_JSON" });
    expect(sdk.generate).toHaveBeenCalledTimes(1);
  });
  it("does not start or reserve work for an already cancelled caller", async () => {
    const adapter = new GeminiAdapter("test-only-key");
    const controller = new AbortController();
    controller.abort();
    await expect(
      adapter.generate({
        prompt: "test",
        model: "test-model",
        responseFormat: "text",
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(sdk.generate).not.toHaveBeenCalled();
    expect(adapter.getQuotaSnapshot().models).toEqual({});
  });
});

/** A 429 as the Gemini SDK throws it, RetryInfo and QuotaFailure included. */
function quotaError(retryDelay: string, metric = "generate_content_requests") {
  return Object.assign(
    new Error(
      JSON.stringify({
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [
                { quotaMetric: `generativelanguage.googleapis.com/${metric}` },
              ],
            },
            {
              "@type": "type.googleapis.com/google.rpc.RetryInfo",
              retryDelay,
            },
          ],
        },
      }),
    ),
    { status: 429 },
  );
}

describe("Gemini 429s", () => {
  it("pauses a routed model for Google's delay and retries on the next", async () => {
    sdk.generate
      .mockRejectedValueOnce(quotaError("40s"))
      .mockResolvedValueOnce({
        text: "ok",
        usageMetadata: { totalTokenCount: 3 },
      });
    const adapter = new GeminiAdapter("test-only-key");
    const result = await adapter.generate({
      prompt: "test",
      responseFormat: "text",
      routing: { prefer: "flash" },
    });

    const first = sdk.generate.mock.calls[0][0].model;
    const second = sdk.generate.mock.calls[1][0].model;
    expect(first).toBe("gemini-3.8-flash");
    expect(second).toBe("gemini-3.7-flash");
    expect(result.model).toBe("gemini-3.7-flash");
    expect(adapter.getQuotaSnapshot().circuitBreakers).toEqual([
      "gemini-3.8-flash",
    ]);
    // The refused request is not counted as sent.
    expect(adapter.getQuotaSnapshot().models["gemini-3.8-flash"].rpd).toBe(0);
    expect(adapter.getQuotaSnapshot().freeTier).toBe(false);
  });

  it("never pauses a model the caller pinned", async () => {
    sdk.generate.mockRejectedValue(quotaError("40s"));
    const adapter = new GeminiAdapter("test-only-key");
    await expect(
      adapter.generate({
        prompt: "test",
        responseFormat: "text",
        model: "gemini-3.8-flash",
      }),
    ).rejects.toThrow();
    expect(adapter.getQuotaSnapshot().circuitBreakers).toEqual([]);
  });

  it("flags a key Google answers with a free-tier quota", async () => {
    sdk.generate.mockRejectedValue(
      quotaError("10s", "generate_content_free_tier_requests"),
    );
    const adapter = new GeminiAdapter("test-only-key");
    await expect(
      adapter.generate({
        prompt: "test",
        responseFormat: "text",
        model: "gemini-3.8-flash",
      }),
    ).rejects.toThrow();
    expect(adapter.getQuotaSnapshot().freeTier).toBe(true);
  });

  it("reads the pause from RetryInfo, within bounds", () => {
    expect(pauseForError(quotaError("37s"))).toBe(37_000);
    expect(pauseForError(quotaError("2.5s"))).toBe(5_000);
    expect(pauseForError(quotaError("86400s"))).toBe(15 * 60_000);
    expect(pauseForError(new Error("503 overloaded"))).toBe(30_000);
  });

  it("tells a free-tier quota from a paid one", () => {
    expect(
      isFreeTierError(quotaError("1s", "generate_content_free_tier_requests")),
    ).toBe(true);
    expect(isFreeTierError(quotaError("1s"))).toBe(false);
  });
});

describe("Gemini research calls", () => {
  it("thinks at the level the caller asks for, and reports the searches it ran", async () => {
    // Contact research asks for "high": at the adapter's "low", Gemini 3.8
    // Flash answered research prompts without searching.
    sdk.generate.mockResolvedValue({
      text: "- Past role: Associate, Example Co, 2020 to 2022 [example.com]",
      candidates: [
        {
          groundingMetadata: {
            webSearchQueries: [
              '"Ada Lovelace" Example Co',
              '"Ada Lovelace" Example Co',
            ],
            groundingChunks: [
              { web: { title: "example.com", uri: "https://example.com/ada" } },
            ],
          },
        },
      ],
    });
    const result = await new GeminiAdapter("test-only-key").generate({
      prompt: "test",
      model: "gemini-3.8-flash",
      responseFormat: "text",
      enableSearchGrounding: true,
      thinkingLevel: "high",
      maxOutputTokens: 16_384,
    });
    expect(sdk.generate.mock.calls[0][0].config.thinkingConfig).toEqual({
      thinkingLevel: "high",
    });
    expect(result.searchQueries).toEqual(['"Ada Lovelace" Example Co']);
  });

  it("says which page backs which passage of the answer", async () => {
    sdk.generate.mockResolvedValue({
      text: "- Past role: Associate [example.com]\n- Award: Fellow",
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [
              { web: { title: "example.com", uri: "https://example.com/ada" } },
              { web: { title: "other.org", uri: "https://other.org/fellows" } },
            ],
            groundingSupports: [
              {
                segment: { text: "- Past role: Associate [example.com]" },
                groundingChunkIndices: [0],
              },
              {
                segment: { text: "- Award: Fellow" },
                groundingChunkIndices: [1, 7],
              },
              { segment: { text: "" }, groundingChunkIndices: [0] },
            ],
          },
        },
      ],
    });
    const result = await new GeminiAdapter("test-only-key").generate({
      prompt: "test",
      model: "gemini-3.8-flash",
      responseFormat: "text",
      enableSearchGrounding: true,
      thinkingLevel: "high",
      maxOutputTokens: 16_384,
    });
    expect(result.supports).toEqual([
      {
        text: "- Past role: Associate [example.com]",
        uris: ["https://example.com/ada"],
      },
      { text: "- Award: Fellow", uris: ["https://other.org/fellows"] },
    ]);
  });

  it("keeps a grounded call at low when the caller names no level", async () => {
    // The research model's save-time test sends 16 tokens with the search
    // tool on; thinking "high" would spend them all before the answer.
    sdk.generate.mockResolvedValue({ text: "OK" });
    const result = await new GeminiAdapter("test-only-key").generate({
      prompt: "test",
      model: "gemini-3.8-flash",
      responseFormat: "text",
      enableSearchGrounding: true,
      maxOutputTokens: 16,
    });
    expect(sdk.generate.mock.calls[0][0].config.thinkingConfig).toEqual({
      thinkingLevel: "low",
    });
    expect(result.searchQueries).toBeUndefined();
  });
});
