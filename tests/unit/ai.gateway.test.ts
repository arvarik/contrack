import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/ai/capabilities.ts", () => ({
  resolveCapability: vi.fn(),
}));
import { resolveCapability } from "../../server/ai/capabilities.ts";
import { generateFor } from "../../server/ai/gateway.ts";
import type { AIProvider } from "../../server/ai/provider.ts";

const generate = vi.fn();
beforeEach(() => {
  generate
    .mockReset()
    .mockResolvedValue({ text: "done", model: "mock", latencyMs: 1 });
  vi.mocked(resolveCapability).mockReturnValue({
    capability: "quick",
    providerId: "mock",
    modelClass: "lite",
    provider: { generate } as unknown as AIProvider,
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("gateway timeout limits", () => {
  it.each([
    ["90000", 90000],
    ["900000", 90000],
    ["Infinity", 8000],
    ["-1", 8000],
    ["NaN", 8000],
    ["0", 8000],
    ["", 8000],
  ])("validates override %s", async (override, expected) => {
    vi.stubEnv("AI_GATEWAY_TIMEOUT_OVERRIDE", override);
    await generateFor("quick", {
      prompt: "test",
      responseFormat: "text",
      timeoutMs: 8000,
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: expected }),
    );
  });
});
