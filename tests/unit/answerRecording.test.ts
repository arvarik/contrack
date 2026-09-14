import { describe, expect, it, vi } from "vitest";
import {
  identifyAnswerCall,
  installAnswerRecorder,
} from "../../scripts/answer-eval/recording.ts";
import type { AIProvider } from "../../server/ai/provider.ts";
import { buildSearchEmbeddingInput } from "../../server/services/search/hybridRetrieval.ts";
import type { QueryPlan } from "../../server/ai/types.ts";
import { wrapUntrusted } from "../../server/ai/promptSafety.ts";

const options = {
  responseFormat: "json" as const,
  systemPrompt: "You are a query planner",
  prompt: 'Query: "Find founders"\n\nReturn JSON.',
};

function provider(
  generate = vi.fn().mockResolvedValue({
    text: '{"must":{}}',
    model: "live-model",
    latencyMs: 1,
  }),
): AIProvider {
  return { name: "test", generate };
}

describe("answer evaluation recorder", () => {
  it("preserves embedded quotes and multiline queries", () => {
    expect(
      identifyAnswerCall({
        ...options,
        prompt: 'Query: "Find "CEO"\nin France"\n\nReturn JSON.',
      }),
    ).toEqual({ operation: "queryParse", queryKey: 'find "ceo"\nin france' });
  });

  it("extracts fenced synthesis queries", () => {
    expect(
      identifyAnswerCall({
        systemPrompt: "Write an executive brief",
        prompt: `${wrapUntrusted("query", 'Find "CEO"')}\n\nMATCHING CONTACTS (1)`,
      }),
    ).toEqual({ operation: "synthesis", queryKey: 'find "ceo"' });
  });

  it("does not classify an unrelated expansion as query planning", () => {
    expect(
      identifyAnswerCall({
        ...options,
        systemPrompt: "Generate search expansion keywords",
      }),
    ).toBeNull();
  });

  it("always calls the live provider and restores its original method", async () => {
    const live = provider();
    const original = live.generate;
    const recorder = installAnswerRecorder(live);
    await live.generate(options);
    await live.generate(options);
    expect(original).toHaveBeenCalledTimes(2);
    expect(recorder.responses.queryParse["find founders"]).toBe('{"must":{}}');
    expect([...recorder.models]).toEqual(["live-model"]);
    expect(() => recorder.assertComplete()).not.toThrow();
    recorder.restore();
    expect(live.generate).toBe(original);
  });

  it("fails audit after production catches a provider error", async () => {
    const live = provider(
      vi.fn().mockRejectedValue(new Error("429 quota exhausted")),
    );
    const recorder = installAnswerRecorder(live);
    await expect(live.generate(options)).rejects.toThrow("429");
    expect(live.generate).not.toBeUndefined();
    expect(() => recorder.assertComplete()).toThrow("provider failures (1)");
    expect(recorder.responses.queryParse).toEqual({});
  });

  it("rejects empty responses and unknown operations", async () => {
    const live = provider(
      vi.fn().mockResolvedValue({ text: " ", model: "test", latencyMs: 1 }),
    );
    const recorder = installAnswerRecorder(live);
    await expect(live.generate(options)).rejects.toThrow("Empty");
    await expect(
      live.generate({ prompt: "unknown", responseFormat: "text" }),
    ).rejects.toThrow("Unrecognized");
    expect(() => recorder.assertComplete()).toThrow("provider failures (2)");
  });

  it("does not record a provider response after cancellation", async () => {
    const controller = new AbortController();
    const live = provider(
      vi.fn().mockImplementation(async () => {
        controller.abort();
        return { text: "{}", model: "test", latencyMs: 1 };
      }),
    );
    const recorder = installAnswerRecorder(live);
    await expect(
      live.generate({ ...options, signal: controller.signal }),
    ).rejects.toThrow();
    expect(recorder.responses.queryParse).toEqual({});
    expect(() => recorder.assertComplete()).toThrow("provider failures");
  });

  it("rejects unfinished calls when a provider ignores cancellation", async () => {
    const controller = new AbortController();
    let finish!: (value: {
      text: string;
      model: string;
      latencyMs: number;
    }) => void;
    const live = provider(
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const recorder = installAnswerRecorder(live);
    const request = live.generate({ ...options, signal: controller.signal });
    const rejection = expect(request).rejects.toThrow();
    controller.abort();
    expect(() => recorder.assertComplete()).toThrow(
      "unfinished provider calls",
    );
    finish({ text: "{}", model: "test", latencyMs: 1 });
    await rejection;
    expect(recorder.responses.queryParse).toEqual({});
    expect(() => recorder.assertComplete()).toThrow("provider failures");
  });

  it("rejects conflicting outputs that a query-only fixture cannot replay", async () => {
    const live = provider(
      vi
        .fn()
        .mockResolvedValueOnce({ text: "one", model: "test", latencyMs: 1 })
        .mockResolvedValueOnce({ text: "two", model: "test", latencyMs: 1 }),
    );
    const recorder = installAnswerRecorder(live);
    await live.generate(options);
    await expect(live.generate(options)).rejects.toThrow("Conflicting");
    expect(() => recorder.assertComplete()).toThrow("provider failures");
  });
});

describe("answer evaluation embedding inputs", () => {
  it("uses the raw query when planning supplies no traits", () => {
    expect(buildSearchEmbeddingInput("Find founders", null)).toBe(
      "Find founders",
    );
  });

  it("uses the exact retrieval expansion for recorded query vectors", () => {
    const plan: QueryPlan = {
      must: {},
      should: { traits: ["climate", "founder"] },
      confidence: "high",
      rationale: "Find founders",
    };
    expect(buildSearchEmbeddingInput("Find founders", plan)).toBe(
      "Find founders. climate. founder",
    );
  });
});
