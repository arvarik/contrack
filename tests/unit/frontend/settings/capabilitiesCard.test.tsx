// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AISettings } from "../../../../src/api/aiSettings";

vi.mock("../../../../src/api/aiSettings", () => ({
  useCapabilityModels: () => ({ data: undefined, isLoading: false }),
  useSetCapability: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { CapabilitiesCard } from "../../../../src/views/ai-settings/CapabilitiesCard";

const settings = {
  providers: [],
  availableProviders: [],
  customEndpoints: [],
  capabilities: {},
} as unknown as AISettings;

/** The card, with every "What uses this?" disclosure open. */
function renderOpen() {
  render(<CapabilitiesCard settings={settings} />);
  for (const button of screen.getAllByRole("button", {
    name: /What uses this/,
  })) {
    fireEvent.click(button);
  }
}

describe("the help under Quick tasks and Deep tasks", () => {
  afterEach(cleanup);

  it("names no task that the code no longer runs", () => {
    renderOpen();

    expect(document.body.textContent).not.toMatch(/search expansion/i);
    expect(document.body.textContent).not.toMatch(/Magic Paste/);
  });

  it("lists the work that runs on the quick model", () => {
    renderOpen();

    // Docs > configuration: Add from text, people named in notes, Ask
    // planning and checks, briefings, the daily insight, mail summaries, and
    // the extraction step of contact research.
    const quick = screen.getByText(/^Add from text/).textContent ?? "";
    expect(quick).toContain("people named in notes");
    expect(quick).toContain("mail summaries");
    expect(quick).toContain("extraction from research results");
  });

  it("says that Deep tasks extract research results only with SearXNG", () => {
    renderOpen();

    const deep = screen.getByText(/duplicate adjudication/).textContent ?? "";
    expect(deep).toContain("SearXNG");
  });
});
