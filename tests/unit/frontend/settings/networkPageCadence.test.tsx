// @vitest-environment jsdom
// The Default cadence select offers the app's four cadences, one word each. An
// account with an older stored cadence (every 2 or 6 months) keeps it: the
// select shows it as a fifth option in its place in the order, rather than
// naming a default the account does not have.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  DEFAULT_PREFERENCES,
  type Preferences,
} from "../../../../src/api/preferences";

const prefs = vi.hoisted(() => ({
  value: {} as Partial<Preferences>,
  setPreference: vi.fn(),
}));
vi.mock("../../../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    preferences: prefs.value,
    stored: [],
    changed: [],
    setPreference: prefs.setPreference,
    resetPreference: vi.fn(),
  }),
}));

import { NetworkPage } from "../../../../src/views/settings/pages/NetworkPage";

function mount(defaultCadenceDays: number) {
  prefs.value = {
    ...DEFAULT_PREFERENCES,
    defaultCadenceDays,
  } as Preferences;
  render(
    <MemoryRouter>
      <NetworkPage />
    </MemoryRouter>,
  );
  return screen.getByRole("combobox", { name: "Default cadence" });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the Default cadence select", () => {
  it("offers the four cadences, one word each", () => {
    const select = mount(90);
    expect(select.textContent).toContain("Quarterly");
    fireEvent.click(select);
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Weekly", "Monthly", "Quarterly", "Yearly"]);
  });

  it("shows a default saved before 2.0 as a fifth option, in its place", () => {
    const select = mount(60);
    expect(select.textContent).toContain("Every 2 months");
    fireEvent.click(select);
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Weekly", "Monthly", "Every 2 months", "Quarterly", "Yearly"]);
  });

  it("saves the choice as days", () => {
    const select = mount(180);
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "Weekly" }));
    expect(prefs.setPreference).toHaveBeenCalledWith("defaultCadenceDays", 7);
  });
});
