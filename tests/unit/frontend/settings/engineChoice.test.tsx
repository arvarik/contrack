// @vitest-environment jsdom
// =============================================================================
// Unit: the web search engine, where it is set and where it is used
// =============================================================================
// Administration → AI sets the instance's engine. Contact enrichment sets the
// account's: its own choice when the instance has more than one account,
// with "Instance default" first, and the instance's own value when there is
// one account, so the same choice never lives in two places. An engine that
// cannot run stays, disabled, and says what it lacks.
// =============================================================================

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Engine = "provider" | "searxng" | "combined";
const state = vi.hoisted(() => ({
  isAdmin: true,
  multipleAccounts: false,
  allowed: true,
  engine: "provider" as Engine,
  missing: {} as Partial<Record<Engine, string[]>>,
  choice: "default" as "default" | Engine,
}));
const setWebSearch = vi.hoisted(() => vi.fn());
const setPreference = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ isAdmin: state.isAdmin }),
}));
vi.mock("../../../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    preferences: { webSearchEngine: state.choice, aiAssist: true },
    setPreference,
  }),
}));
vi.mock("../../../../src/api/aiSettings", () => ({
  useSetWebSearch: () => ({ mutate: setWebSearch, isPending: false }),
  useAISettings: () => {
    const engineState = (engine: Engine) => {
      const missing = [
        ...(state.allowed ? [] : ["off"]),
        ...(state.missing[engine] ?? []),
      ];
      return { available: missing.length === 0, missing };
    };
    return {
      data: {
        providers: [{ id: "gemini" }],
        capabilities: {
          quick: { resolved: { providerLabel: "Google Gemini" } },
          deep: { resolved: { providerLabel: "Google Gemini" } },
          research: { resolved: { providerLabel: "Google Gemini" } },
        },
        webSearch: {
          allowed: state.allowed,
          engine: state.engine,
          engines: {
            provider: engineState("provider"),
            searxng: engineState("searxng"),
            combined: engineState("combined"),
          },
          searxng: { configured: !state.missing.searxng },
        },
        multipleAccounts: state.multipleAccounts,
        instance: { aiOff: false, lockedByEnv: false },
      },
    };
  },
}));

import { EngineChoice } from "../../../../src/views/settings/EngineChoice";

const tiles = () =>
  within(
    screen.getByRole("radiogroup", { name: "Web search engine" }),
  ).getAllByRole("radio");
const tile = (name: RegExp) => screen.getByRole("radio", { name });
const show = (scope: "instance" | "account") =>
  render(
    <MemoryRouter>
      <EngineChoice scope={scope} />
    </MemoryRouter>,
  );

beforeEach(() => {
  Object.assign(state, {
    isAdmin: true,
    multipleAccounts: false,
    allowed: true,
    engine: "provider",
    missing: {},
    choice: "default",
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("on Administration → AI", () => {
  it("offers the three engines, names both, and sets the instance's", () => {
    show("instance");
    expect(tiles().map((each) => each.textContent)).toEqual([
      expect.stringMatching(/^Google Gemini.*provider bills each search/),
      expect.stringMatching(/^SearXNG.*Strong model reads the pages/),
      expect.stringMatching(/^Google Gemini and SearXNG.*costs both/),
    ]);
    fireEvent.click(tile(/^SearXNG/));
    expect(setWebSearch).toHaveBeenCalledWith(
      { engine: "searxng" },
      expect.anything(),
    );
  });

  it("keeps an engine that cannot run, disabled, saying what it lacks", () => {
    state.missing = { searxng: ["web-search"], combined: ["web-search"] };
    show("instance");
    const searxng = tile(/^SearXNG/);
    expect(searxng.getAttribute("aria-disabled")).toBe("true");
    expect(searxng.textContent).toContain("Needs a SearXNG address");
    fireEvent.click(searxng);
    expect(setWebSearch).not.toHaveBeenCalled();
    // The AI page is the setup, so it needs no link to it.
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("on Contact enrichment, with one account", () => {
  it("sets the instance's engine, the same value as the AI page", () => {
    state.engine = "combined";
    show("account");
    expect(tiles()).toHaveLength(3);
    expect(
      screen.queryByRole("radio", { name: /Instance default/ }),
    ).toBeNull();
    expect(tile(/and SearXNG/).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(tile(/^Google Gemini$|^Google GeminiIts/));
    expect(setWebSearch).toHaveBeenCalledWith(
      { engine: "provider" },
      expect.anything(),
    );
    expect(setPreference).not.toHaveBeenCalled();
  });

  it("lets an engine the account chose before give way to the one value", () => {
    state.choice = "searxng";
    show("account");
    expect(tile(/^SearXNG/).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(tile(/and SearXNG/));
    const [, callbacks] = setWebSearch.mock.lastCall!;
    callbacks.onSuccess();
    expect(setPreference).toHaveBeenCalledWith("webSearchEngine", "default");
  });

  it("says when the chosen engine cannot run, and links the admin to its fix", () => {
    state.engine = "searxng";
    state.missing = { searxng: ["deep"], combined: ["deep"] };
    show("account");
    expect(
      screen.getByText(
        /SearXNG needs a Strong model, so research searches with Google Gemini/,
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Set up web search" })
        .getAttribute("href"),
    ).toBe("/settings/admin/ai#strong-model");
  });
});

describe("on Contact enrichment, with more accounts", () => {
  beforeEach(() => {
    state.multipleAccounts = true;
    state.isAdmin = false;
    state.engine = "searxng";
  });

  it("puts Instance default first, naming the instance's engine, and saves the account's own", () => {
    show("account");
    expect(tiles()[0].textContent).toMatch(/^Instance default \(SearXNG\)/);
    expect(tiles()[0].getAttribute("aria-checked")).toBe("true");
    fireEvent.click(tile(/^Google Gemini and SearXNG/));
    expect(setPreference).toHaveBeenCalledWith("webSearchEngine", "combined");
    expect(setWebSearch).not.toHaveBeenCalled();
  });

  it("asks a member to ask the admin, and says an admin turned web search off", () => {
    state.choice = "combined";
    state.missing = { combined: ["web-search"], searxng: ["web-search"] };
    show("account");
    expect(screen.getByText(/Ask your admin to set it up/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    cleanup();
    state.allowed = false;
    show("account");
    expect(screen.getByText("An admin turned web search off")).toBeTruthy();
    // "Off" is said once, under the tiles, not on every tile.
    expect(tile(/^Google Gemini and/).textContent).not.toContain("off");
  });
});
