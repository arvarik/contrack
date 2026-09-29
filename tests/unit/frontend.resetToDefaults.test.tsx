// @vitest-environment jsdom
/**
 * Reset to defaults: one button at the end of a settings page.
 *
 * The rows that hold a preference tell the page which keys they hold. While
 * any of them is off its default the page ends with the button, and it
 * resets them all, says how many with an Undo, and hands the keyboard to the
 * first row it reset. At the defaults it is not there.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SettingRow } from "../../src/views/settings/SettingRow";
import {
  ResetScopeProvider,
  ResetToDefaults,
  useResetScope,
} from "../../src/views/settings/ResetToDefaults";

const prefs = vi.hoisted(() => ({
  changed: [] as string[],
  resetPreference: vi.fn(),
  setPreferences: vi.fn(),
}));

vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    preferences: { theme: "dark", listDensity: "compact", textScale: "large" },
    changed: prefs.changed,
    resetPreference: prefs.resetPreference,
    setPreferences: prefs.setPreferences,
  }),
}));

const toast = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  prefs.changed = [];
});

/** A page with three rows, as the shell lays one out. */
function Page() {
  const { scope, entries } = useResetScope();
  return (
    <ResetScopeProvider value={scope}>
      <SettingRow id="theme" title="Theme" description="d" prefKey="theme">
        <span />
      </SettingRow>
      <SettingRow
        id="text-scale"
        title="Text size"
        description="d"
        prefKey="textScale"
      >
        <span />
      </SettingRow>
      <SettingRow
        id="list-density"
        title="List density"
        description="d"
        prefKey="listDensity"
      >
        <span />
      </SettingRow>
      <ResetToDefaults entries={entries} />
    </ResetScopeProvider>
  );
}

const mount = () =>
  render(
    <MemoryRouter>
      <Page />
    </MemoryRouter>,
  );

describe("Reset to defaults", () => {
  it("is not there while every value on the page is its default", () => {
    mount();
    expect(screen.queryByRole("button", { name: "Reset to defaults" })).toBe(
      null,
    );
  });

  it("ignores a changed value that no row on the page holds", () => {
    prefs.changed = ["accent"];
    mount();
    expect(screen.queryByRole("button", { name: "Reset to defaults" })).toBe(
      null,
    );
  });

  it.each([
    ["1 setting is back to its default", ["theme"], { theme: "dark" }],
    [
      "2 settings are back to their defaults",
      ["listDensity", "theme"],
      { theme: "dark", listDensity: "compact" },
    ],
  ])(
    "resets every changed value on the page, says how many, and offers Undo: %s",
    (message, changed, previous) => {
      prefs.changed = changed;
      mount();
      const button = screen.getByRole("button", { name: "Reset to defaults" });
      // The look of Pulse's Log note: the primary button.
      expect(button.className).toContain("btn-primary");
      fireEvent.click(button);
      expect(
        prefs.resetPreference.mock.calls.map(([key]) => key).sort(),
      ).toEqual(changed);
      expect(toast.success).toHaveBeenCalledWith(
        message,
        expect.objectContaining({
          action: expect.objectContaining({ label: "Undo" }),
        }),
      );
      // Undo puts back the values the reset took, in one write.
      toast.success.mock.calls[0][1].action.onClick();
      expect(prefs.setPreferences).toHaveBeenCalledWith(previous);
    },
  );

  it("hands the keyboard to the first row it reset, since the button goes", () => {
    prefs.changed = ["listDensity", "theme"];
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(document.activeElement?.id).toBe("theme");
  });
});
