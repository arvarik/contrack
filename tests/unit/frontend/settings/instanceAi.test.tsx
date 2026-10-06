// @vitest-environment jsdom
// The AI switches on the two settings pages that show them.
//
// Administration → AI carries "Use AI on this instance". AI_DISABLED on the
// server holds it off, and then it cannot be pressed and says why.
//
// Privacy and AI carries "Use AI for my account" while the instance has more
// than one account. While an admin has AI off for the instance, it shows off,
// cannot be pressed, and says why. With one account, the page shows one
// switch, "Use AI", which is the instance's: turning it on also turns the
// account's own back on.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as prefContext from "../../../../src/contexts/PreferencesContext";
import * as aiSettingsApi from "../../../../src/api/aiSettings";

vi.mock("../../../../src/contexts/PreferencesContext", () => ({
  usePreferences: vi.fn(),
}));
const viewer = vi.hoisted(() => ({ isAdmin: false }));
vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ isAdmin: viewer.isAdmin, authRequired: true }),
}));
vi.mock("../../../../src/api/searchHistory", () => ({
  useSearchHistoryList: () => ({ data: undefined }),
  useClearHistory: () => ({ mutate: vi.fn(), isPending: false }),
}));
// The page's other parts have tests of their own.
vi.mock("../../../../src/views/ai-settings/FeatureMap", () => ({
  FeatureMap: () => null,
}));
vi.mock("../../../../src/views/ai-settings/ProvidersSection", () => ({
  ProvidersSection: () => null,
}));
vi.mock("../../../../src/views/ai-settings/ModelsSection", () => ({
  ModelsSection: () => null,
}));
vi.mock("../../../../src/views/ai-settings/WebSearchSection", () => ({
  WebSearchSection: () => null,
}));

vi.mock("../../../../src/api/aiSettings", () => ({
  useInstanceAi: vi.fn(),
  useAISettings: vi.fn(),
  useSetInstanceAi: vi.fn(),
}));

import { PrivacyPage } from "../../../../src/views/settings/pages/PrivacyPage";
import { AISettingsView } from "../../../../src/views/ai-settings/AISettingsView";

const setPreference = vi.fn();
const setInstanceAi = vi.fn();

/** The account's own switch, as its preference stores it. */
let aiAssist = true;

beforeEach(() => {
  viewer.isAdmin = false;
  aiAssist = true;
  settings(false);
  vi.mocked(prefContext.usePreferences).mockImplementation(
    () =>
      ({
        preferences: { aiAssist },
        stored: [],
        changed: [],
        resetPreference: vi.fn(),
        setPreference,
      }) as unknown as ReturnType<typeof prefContext.usePreferences>,
  );
  vi.mocked(aiSettingsApi.useSetInstanceAi).mockReturnValue({
    mutate: setInstanceAi,
    isPending: false,
  } as unknown as ReturnType<typeof aiSettingsApi.useSetInstanceAi>);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** The instance switch as `GET /api/ai/instance` answers it. */
function instance(aiOff: boolean, lockedByEnv = false) {
  vi.mocked(aiSettingsApi.useInstanceAi).mockReturnValue({
    data: { aiOff, lockedByEnv },
  } as unknown as ReturnType<typeof aiSettingsApi.useInstanceAi>);
}

/** The AI settings view with no providers, this switch, and the accounts. */
function settings(
  aiOff: boolean,
  lockedByEnv = false,
  multipleAccounts = true,
) {
  vi.mocked(aiSettingsApi.useAISettings).mockReturnValue({
    data: {
      providers: [],
      availableProviders: [],
      customEndpoints: [],
      capabilities: {},
      multipleAccounts,
      instance: { aiOff, lockedByEnv },
    },
    isLoading: false,
  } as unknown as ReturnType<typeof aiSettingsApi.useAISettings>);
}

/** SettingRow reads the address for its hash link, so both need a router. */
const inRouter = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

const renderPrivacy = () => inRouter(<PrivacyPage />);

describe("the Privacy page", () => {
  it("lets the account switch AI while the instance allows it", () => {
    instance(false);
    renderPrivacy();

    const toggle = screen.getByRole("switch", {
      name: "Use AI for my account",
    }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText(/An admin turned AI off/)).toBeNull();

    fireEvent.click(toggle);
    expect(setPreference).toHaveBeenCalledWith("aiAssist", false);
  });

  it("shows the account switch off, and says why, while an admin has AI off", () => {
    instance(true);
    renderPrivacy();

    const toggle = screen.getByRole("switch", {
      name: "Use AI for my account",
    }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(
      screen.getByText("An admin turned AI off for everyone on this instance"),
    ).toBeTruthy();
  });

  it("gives an admin on an instance with more accounts their own switch too", () => {
    viewer.isAdmin = true;
    instance(false);
    renderPrivacy();
    expect(screen.getByRole("switch", { name: "Use AI for my account" }));
    expect(screen.queryByRole("switch", { name: "Use AI" })).toBeNull();
  });

  describe("with one account", () => {
    beforeEach(() => {
      viewer.isAdmin = true;
      settings(false, false, false);
    });

    it("shows one switch, the instance's, and turns AI off for the instance", () => {
      instance(false);
      renderPrivacy();
      expect(
        screen.queryByRole("switch", { name: "Use AI for my account" }),
      ).toBeNull();
      const toggle = screen.getByRole("switch", { name: "Use AI" });
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      fireEvent.click(toggle);
      expect(setInstanceAi).toHaveBeenCalledWith(true, expect.anything());
      expect(setPreference).not.toHaveBeenCalled();
    });

    it("turns the instance and the account's own switch back on", () => {
      // Off both ways: an admin switch, and an account switch left off.
      aiAssist = false;
      instance(true);
      renderPrivacy();
      const toggle = screen.getByRole("switch", { name: "Use AI" });
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      fireEvent.click(toggle);
      expect(setInstanceAi).toHaveBeenCalledWith(false, expect.anything());
      expect(setPreference).toHaveBeenCalledWith("aiAssist", true);
    });

    it("cannot turn AI on while AI_DISABLED holds it off, and says so", () => {
      instance(true, true);
      renderPrivacy();
      const toggle = screen.getByRole("switch", {
        name: "Use AI",
      }) as HTMLButtonElement;
      expect(toggle.disabled).toBe(true);
      expect(screen.getByText("AI_DISABLED")).toBeTruthy();
    });
  });
});

describe("Administration → AI", () => {
  it("turns AI off for the instance from its switch", () => {
    settings(false);
    inRouter(<AISettingsView />);

    const toggle = screen.getByRole("switch", {
      name: "Use AI on this instance",
    }) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByText(
        /Off sends nothing to any AI provider, for every account/,
      ),
    ).toBeTruthy();

    fireEvent.click(toggle);
    expect(setInstanceAi).toHaveBeenCalledWith(true, expect.anything());
  });

  it("cannot turn AI on while AI_DISABLED holds it off, and says so", () => {
    settings(true, true);
    inRouter(<AISettingsView />);

    const toggle = screen.getByRole("switch", {
      name: "Use AI on this instance",
    }) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.disabled).toBe(true);
    expect(screen.getByText("AI_DISABLED")).toBeTruthy();
    expect(screen.getByText(/Set by/)).toBeTruthy();
  });
});
