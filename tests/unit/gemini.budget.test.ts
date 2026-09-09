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
import { GeminiAdapter } from "../../server/ai/adapters/gemini.ts";
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
