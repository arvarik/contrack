// @vitest-environment jsdom
// Unit: the parts of Administration → AI that read the feature table
//
// "What each feature uses" says whether each feature works and what it runs
// on. On the AI page each part links to its control and each reason to its
// fix; on Privacy and AI it is read-only and follows the account's own
// switch. A model row names the features it serves, and says how its model
// was chosen only when the select does not already say it.

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AISettings } from "../../../../src/api/aiSettings";

const view = vi.hoisted(() => ({ data: undefined as unknown }));
const prefs = vi.hoisted(() => ({ aiAssist: true }));
vi.mock("../../../../src/api/aiSettings", () => ({
  useAISettings: () => ({ data: view.data, isLoading: false }),
  useCapabilityModels: () => ({
    data: [
      {
        providerId: "gemini",
        providerLabel: "Google Gemini",
        models: [
          {
            id: "gemini-3.5-flash-lite",
            label: "Gemini 3.5 Flash-Lite",
            capabilityConfidence: "declared",
          },
        ],
      },
    ],
    isLoading: false,
  }),
  useSetCapability: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../../../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    preferences: { aiAssist: prefs.aiAssist, webSearchEngine: "default" },
  }),
}));

import { FeatureMap } from "../../../../src/views/ai-settings/FeatureMap";
import { ModelRow } from "../../../../src/views/ai-settings/ModelRow";

const served = { providerId: "gemini", providerLabel: "Google Gemini" };

function settings(overrides: Partial<AISettings> = {}): AISettings {
  const ready = { available: true, missing: [] };
  return {
    providers: [{ id: "gemini" }],
    capabilities: {
      quick: { resolved: served },
      deep: { resolved: null },
      research: { resolved: served },
      embeddings: {
        resolved: { providerId: "builtin", providerLabel: "Built-in" },
      },
    },
    webSearch: {
      allowed: true,
      engine: "provider",
      engines: {
        provider: ready,
        searxng: { available: false, missing: ["web-search", "deep"] },
        combined: { available: false, missing: ["web-search", "deep"] },
      },
      searxng: { configured: false, source: "none" },
    },
    reranker: { model: "Xenova/ms-marco-TinyBERT-L-2-v2", source: "default" },
    multipleAccounts: false,
    instance: { aiOff: false, lockedByEnv: false },
    ...overrides,
  } as unknown as AISettings;
}

const inRouter = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);
const row = (name: string) =>
  screen.getByText(name).closest("li") as HTMLElement;

beforeEach(() => {
  view.data = settings();
  prefs.aiAssist = true;
});
afterEach(cleanup);

describe("What each feature uses, on the AI page", () => {
  it("links each part to its control, and a reason to its fix", () => {
    inRouter(<FeatureMap scope="instance" />);
    const ask = row("Ask Contrack");
    expect(within(ask).getByText("Ready")).toBeTruthy();
    expect(
      within(ask)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/#embedding-model", "/#reranker", "/#fast-model"]);

    // No Strong model: the AI scans need one.
    const duplicates = row("Duplicates");
    expect(within(duplicates).getByText("Limited")).toBeTruthy();
    expect(duplicates.textContent).toContain("AI scans need a Strong model");
    expect(
      within(duplicates)
        .getByRole("link", { name: "Choose a Strong model" })
        .getAttribute("href"),
    ).toBe("/#strong-model");
  });

  it("is the page's empty state when no provider is connected", () => {
    view.data = settings({ providers: [] });
    inRouter(<FeatureMap scope="instance" />);
    expect(
      screen.getByText(
        /No AI provider is connected, so only the local features work/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Add a key" }).getAttribute("href"),
    ).toBe("/#providers");
  });
});

describe("What each feature uses, on Privacy and AI", () => {
  it("has no links, and follows the account's own switch", () => {
    prefs.aiAssist = false;
    inRouter(<FeatureMap scope="account" />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(row("Briefings and insights").textContent).toContain(
      "AI is off for your account",
    );
    expect(row("Ask Contrack").textContent).toContain("Local search only");
  });
});

describe("a model row", () => {
  const quick = (state: object) =>
    inRouter(
      <ModelRow
        id="fast-model"
        capability="quick"
        title="Fast model"
        summary="Quick, frequent work"
        usedBy={["Ask Contrack", "Contact research"]}
        state={state as AISettings["capabilities"][string]}
        noModels="None"
      />,
    );

  it("names the features it serves, and leaves Automatic to the select", () => {
    quick({
      assignment: { mode: "auto" },
      resolved: { ...served, model: "gemini-3.5-flash-lite", source: "auto" },
    });
    expect(
      screen.getByText("Used by Ask Contrack, Contact research"),
    ).toBeTruthy();
    // Once, in the select: the line under it does not say it again.
    expect(screen.getAllByText("Automatic")).toHaveLength(1);
    expect(screen.getByRole("combobox", { name: "Fast model" })).toBeTruthy();
  });

  it("puts the variable in Automatic's place while AI_QUICK_MODEL is set", () => {
    quick({
      assignment: { mode: "auto" },
      envDefault: "AI_QUICK_MODEL",
      resolved: { ...served, model: "some-model", source: "env" },
    });
    expect(screen.getByText("From AI_QUICK_MODEL")).toBeTruthy();
    expect(screen.queryByText(/cannot run now/)).toBeNull();
  });

  it("says when a pinned model cannot run, and what runs in its place", () => {
    quick({
      assignment: { mode: "pinned", providerId: "openai", model: "gone" },
      resolved: { ...served, model: "gemini-3.5-flash-lite", source: "auto" },
    });
    expect(
      screen.getByText(
        /The pinned model cannot run now, so Automatic chose this one/,
      ),
    ).toBeTruthy();
  });
});
