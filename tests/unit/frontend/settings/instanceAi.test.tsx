// @vitest-environment jsdom
// =============================================================================
// Unit: the instance AI switch on the two settings pages that show it
// =============================================================================
// Settings → AI (admin) carries "Use AI on this instance". AI_DISABLED on the
// server holds it off, so then it cannot be pressed and says why. The Privacy
// page's "Use AI for this account" cannot turn AI on while an admin has it
// off for the instance, so it shows off, cannot be pressed, and says why.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as prefContext from "../../../../src/contexts/PreferencesContext";
import * as aiSettingsApi from "../../../../src/api/aiSettings";

vi.mock("../../../../src/contexts/PreferencesContext", () => ({
  usePreferences: vi.fn(),
}));
vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ isAdmin: false, authRequired: true }),
}));
vi.mock("../../../../src/api/searchHistory", () => ({
  useSearchHistoryList: () => ({ data: undefined }),
  useClearHistory: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../../../src/views/settings/AiCapabilitiesCard", () => ({
  AiCapabilitiesList: () => null,
}));
vi.mock("../../../../src/views/ai-settings/CapabilitiesCard", () => ({
  CapabilitiesCard: () => null,
}));
vi.mock("../../../../src/views/search", () => ({
  SearchCoverageBar: () => null,
}));

/** A mutation hook's answer, idle. */
const idle = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
});
vi.mock("../../../../src/api/aiSettings", () => ({
  useInstanceAi: vi.fn(),
  useAISettings: vi.fn(),
  useSetInstanceAi: vi.fn(),
  useSetProviderKey: () => idle(),
  useDeleteProviderKey: () => idle(),
  useRefreshModels: () => idle(),
  useSaveEndpoint: () => idle(),
  useDeleteEndpoint: () => idle(),
}));

import { PrivacyPage } from "../../../../src/views/settings/pages/PrivacyPage";
import { AISettingsView } from "../../../../src/views/ai-settings/AISettingsView";

const setPreference = vi.fn();
const setInstanceAi = vi.fn();

beforeEach(() => {
  vi.mocked(prefContext.usePreferences).mockReturnValue({
    preferences: { aiAssist: true },
    stored: [],
    changed: [],
    resetPreference: vi.fn(),
    setPreference,
  } as unknown as ReturnType<typeof prefContext.usePreferences>);
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

/** Settings → AI with no providers and this instance switch. */
function settings(aiOff: boolean, lockedByEnv = false) {
  vi.mocked(aiSettingsApi.useAISettings).mockReturnValue({
    data: {
      providers: [],
      availableProviders: [],
      customEndpoints: [],
      capabilities: {},
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
      name: "Use AI for this account",
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
      name: "Use AI for this account",
    }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(
      screen.getByText("An admin turned AI off for everyone on this instance"),
    ).toBeTruthy();
  });
});

describe("Settings → AI", () => {
  it("turns AI off for the instance from its switch", () => {
    settings(false);
    inRouter(<AISettingsView />);

    const toggle = screen.getByRole("switch", {
      name: "Use AI on this instance",
    }) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByText(/Contrack sends nothing to any AI provider/),
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
    expect(screen.getByText(/on the\s+server/)).toBeTruthy();
  });
});
