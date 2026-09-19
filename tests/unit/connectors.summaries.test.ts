/**
 * tests/unit/connectors.summaries.test.ts — Unit tests for connector email summaries.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import * as gateway from "../../server/ai/gateway.ts";
import * as aiStats from "../../server/services/aiStatsService.ts";
import { summarizeEmail } from "../../server/connectors/summaries.ts";

describe("summarizeEmail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null if no AI provider is configured", async () => {
    vi.spyOn(gateway, "isAnyProviderConfigured").mockReturnValue(false);

    const res = await summarizeEmail("Subject", "Body content");
    expect(res).toBeNull();
  });

  it("returns null if body is empty or whitespace", async () => {
    vi.spyOn(gateway, "isAnyProviderConfigured").mockReturnValue(true);

    const res = await summarizeEmail("Subject", "   ");
    expect(res).toBeNull();
  });

  it("calls generateFor and records invocation when provider is configured", async () => {
    vi.spyOn(gateway, "isAnyProviderConfigured").mockReturnValue(true);
    const generateSpy = vi.spyOn(gateway, "generateFor").mockResolvedValue({
      text: "This is a summary of the email.",
      model: "test-model",
      tokenCount: 42,
      latencyMs: 120,
    } as gateway.AIGenerateResult);
    const recordSpy = vi
      .spyOn(aiStats, "recordInvocation")
      .mockReturnValue(undefined as unknown as void);

    const res = await summarizeEmail(
      "Important meeting",
      "Let's meet tomorrow at 10am to discuss project X.",
    );
    expect(res).toBe("This is a summary of the email.");
    expect(generateSpy).toHaveBeenCalledWith(
      "quick",
      expect.objectContaining({
        priority: "background",
        responseFormat: "text",
      }),
    );
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "connectorSummary",
        model: "test-model",
        tokenCount: 42,
      }),
    );
  });

  it("returns null gracefully if generateFor throws", async () => {
    vi.spyOn(gateway, "isAnyProviderConfigured").mockReturnValue(true);
    vi.spyOn(gateway, "generateFor").mockRejectedValue(
      new Error("AI service down"),
    );

    const res = await summarizeEmail("Subject", "Body");
    expect(res).toBeNull();
  });
});
