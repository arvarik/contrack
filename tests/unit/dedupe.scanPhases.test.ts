// =============================================================================
// The dedupe scan's progress card: its mode names and its pipeline rows
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  MODE_NAME,
  runsAiPass,
  stepStatus,
} from "../../src/views/dedupe/utils/scanPhases";

describe("runsAiPass", () => {
  it("is true for every mode but Quick, as the server resolves them", () => {
    expect(runsAiPass("quick")).toBe(false);
    expect(runsAiPass("deterministic")).toBe(false);
    for (const mode of ["deep", "full", "ai", "both"] as const) {
      expect(runsAiPass(mode)).toBe(true);
    }
  });
});

describe("stepStatus", () => {
  it("keeps the exact-match row pending until its phase, and done after", () => {
    const row = (phase: Parameters<typeof stepStatus>[0]) =>
      stepStatus(phase, "deterministic", "deterministic");
    expect(row("starting")).toBe("pending");
    // Normalizing runs first: the row is not done before it has run.
    expect(row("normalizing")).toBe("pending");
    expect(row("deterministic")).toBe("active");
    expect(row("blocking")).toBe("done");
    expect(row("complete")).toBe("done");
  });

  it("holds the AI row active through blocking, scoring and the AI pass", () => {
    const row = (phase: Parameters<typeof stepStatus>[0]) =>
      stepStatus(phase, "blocking", "ai");
    expect(row("deterministic")).toBe("pending");
    expect(row("blocking")).toBe("active");
    expect(row("scoring")).toBe("active");
    expect(row("ai")).toBe("active");
    expect(row("clustering")).toBe("done");
  });

  it("marks clustering done once the results persist", () => {
    const row = (phase: Parameters<typeof stepStatus>[0]) =>
      stepStatus(phase, "clustering", "clustering");
    expect(row("ai")).toBe("pending");
    expect(row("clustering")).toBe("active");
    expect(row("persisting")).toBe("done");
  });

  it("leaves every row pending on an error", () => {
    expect(stepStatus("error", "deterministic", "deterministic")).toBe(
      "pending",
    );
  });
});

describe("MODE_NAME", () => {
  it("names the picker's modes in its own words, in sentence case", () => {
    expect(MODE_NAME.quick).toBe("Quick");
    expect(MODE_NAME.deep).toBe("Smart");
    expect(MODE_NAME.full).toBe("Full");
    expect(MODE_NAME.ai).toBe("AI");
  });
});
