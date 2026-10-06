/**
 * Unit: connector email summaries.
 *
 * A summary sends an email body to an AI provider, so it runs only when a
 * provider is configured and both AI switches allow it for the connector's
 * owner: the instance switch and the owner's own "Use AI for this account".
 * `aiAllowedForUser` reads both, and is stubbed here because the unit
 * project's database is a mock.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gateway from "../../../../server/ai/gateway.ts";
import * as instanceSwitch from "../../../../server/ai/instanceSwitch.ts";
import * as aiStats from "../../../../server/services/aiStatsService.ts";
import {
  summarizeEmail,
  summariesAllowed,
} from "../../../../server/connectors/summaries.ts";

/** The connector owner, as SyncContext.accountId names them. */
const OWNER = "owner-1";

let allowedSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  allowedSpy = vi
    .spyOn(instanceSwitch, "aiAllowedForUser")
    .mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("summarizeEmail", () => {
  it("returns null if no AI provider is configured", async () => {
    vi.spyOn(gateway, "isAnyProviderConfigured").mockReturnValue(false);
    const generateSpy = vi.spyOn(gateway, "generateFor");

    const res = await summarizeEmail("Subject", "Body content", {
      accountId: OWNER,
    });
    expect(res).toBeNull();
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("returns null if body is empty or whitespace", async () => {
    vi.spyOn(gateway, "isAnyProviderConfigured").mockReturnValue(true);
    const generateSpy = vi.spyOn(gateway, "generateFor");

    const res = await summarizeEmail("Subject", "   ", { accountId: OWNER });
    expect(res).toBeNull();
    expect(generateSpy).not.toHaveBeenCalled();
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
      { accountId: OWNER },
    );
    expect(res).toBe("This is a summary of the email.");
    expect(allowedSpy).toHaveBeenCalledWith(OWNER);
    expect(generateSpy).toHaveBeenCalledWith(
      "quick",
      expect.objectContaining({
        priority: "background",
        responseFormat: "text",
        accountId: OWNER,
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

    const res = await summarizeEmail("Subject", "Body", { accountId: OWNER });
    expect(res).toBeNull();
  });

  it("sends nothing when AI is off for the owner or for the instance", async () => {
    vi.spyOn(gateway, "isAnyProviderConfigured").mockReturnValue(true);
    const generateSpy = vi.spyOn(gateway, "generateFor");
    allowedSpy.mockReturnValue(false);

    const res = await summarizeEmail("Subject", "A private email body", {
      accountId: OWNER,
    });
    expect(res).toBeNull();
    expect(allowedSpy).toHaveBeenCalledWith(OWNER);
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("sends nothing when no owner is named, since there is no choice to check", async () => {
    vi.spyOn(gateway, "isAnyProviderConfigured").mockReturnValue(true);
    const generateSpy = vi.spyOn(gateway, "generateFor");

    const res = await summarizeEmail("Subject", "A private email body");
    expect(res).toBeNull();
    expect(generateSpy).not.toHaveBeenCalled();
  });
});

describe("summariesAllowed", () => {
  it("needs a provider, an owner, and AI on for that owner", () => {
    const configured = vi
      .spyOn(gateway, "isAnyProviderConfigured")
      .mockReturnValue(true);
    expect(summariesAllowed(OWNER)).toBe(true);
    expect(summariesAllowed(undefined)).toBe(false);
    expect(summariesAllowed("")).toBe(false);

    allowedSpy.mockReturnValue(false);
    expect(summariesAllowed(OWNER)).toBe(false);

    allowedSpy.mockReturnValue(true);
    configured.mockReturnValue(false);
    expect(summariesAllowed(OWNER)).toBe(false);
  });
});
