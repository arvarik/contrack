// Unit: a pinned model answers once before the pin is saved.
// A provider's model list can carry deprecated models that answer 404 and
// models Chat Completions refuses (OpenAI listed sixteen). The probe sends the
// model one tiny request, as its capability will call it, and refuses the pin
// when it does not answer.

import { describe, it, expect, vi, beforeEach } from "vitest";

const generate = vi.fn();
const config = vi.hoisted(() => ({
  current: null as null | { id: string; kind: string; label: string },
}));

vi.mock("../../../../server/ai/providerRegistry.ts", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../../../../server/ai/providerRegistry.ts")
    >();
  return {
    ...actual,
    getProviderConfig: () => config.current,
    getProvider: () => (config.current ? { name: "Test", generate } : null),
  };
});

const { probeGeneration } =
  await import("../../../../server/services/aiSettingsService.ts");

beforeEach(() => {
  generate.mockReset();
  config.current = { id: "openai", kind: "openai", label: "OpenAI" };
});

describe("probeGeneration", () => {
  it("lets a model that answers be saved", async () => {
    generate.mockResolvedValue({ text: "OK", model: "gpt-6-sol" });
    await expect(
      probeGeneration("deep", "openai", "gpt-6-sol"),
    ).resolves.toBeUndefined();
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-6-sol",
        enableSearchGrounding: false,
        routing: { prefer: "flash" },
      }),
    );
  });

  it("refuses a model that does not answer, and says why", async () => {
    generate.mockRejectedValue(
      new Error("404 The model `gpt-5.2-codex` has been deprecated"),
    );
    await expect(
      probeGeneration("quick", "openai", "gpt-5.2-codex"),
    ).rejects.toMatchObject({
      code: "MODEL_PROBE_FAILED",
      message: expect.stringContaining("deprecated"),
    });
  });

  it("tests a research pin with the web-search tool on", async () => {
    generate.mockResolvedValue({ text: "OK", model: "claude-sonnet-5" });
    config.current = { id: "anthropic", kind: "anthropic", label: "Anthropic" };
    await probeGeneration("research", "anthropic", "claude-sonnet-5");
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ enableSearchGrounding: true }),
    );
  });

  it("leaves a custom endpoint and an unconnected provider alone", async () => {
    config.current = {
      id: "custom:ollama",
      kind: "openai-compatible",
      label: "Ollama",
    };
    await probeGeneration("quick", "custom:ollama", "llama3.2");
    config.current = null;
    await probeGeneration("quick", "anthropic", "claude-haiku-4-5");
    expect(generate).not.toHaveBeenCalled();
  });
});
