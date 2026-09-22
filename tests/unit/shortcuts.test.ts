// @vitest-environment jsdom
// =============================================================================
// The shortcuts table in src/lib/shortcuts.ts
// =============================================================================
// Every plan registers its keys in one table, and the `?` dialog renders from
// it. These checks catch what a person would otherwise find by pressing a key:
// two actions on the same keys, a row with nothing to press, a switch that
// gates the wrong shortcuts, and a destination under an old name.
// =============================================================================
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  SHORTCUTS,
  SHORTCUT_GROUP_ORDER,
  groupedShortcuts,
  isCombination,
  type Shortcut,
} from "../../src/lib/shortcuts";
import { KeyboardShortcutsModal } from "../../src/components/KeyboardShortcutsModal";

afterEach(() => {
  cleanup();
});

const MODIFIERS = ["⌘", "⇧", "⌥", "⌃", "ctrl", "alt"];
const ARROWS = ["↑", "↓", "←", "→"];

/** One key that types a character: a letter, a digit, a symbol, or the A-Z range. */
function isPrintable(key: string): boolean {
  if (key === "A-Z" || key === "A–Z") return true;
  return [...key].length === 1 && !ARROWS.includes(key);
}

/** The rule `bareLetter` must follow, worked out from the keys alone. */
function expectedBareLetter(entry: Shortcut): boolean {
  const hasModifier = entry.keys.some((key) =>
    MODIFIERS.includes(key.toLowerCase()),
  );
  // Keys with no modifier are alternatives, so one printable key among them
  // is enough for a stray keystroke to fire the shortcut.
  return !hasModifier && entry.keys.some(isPrintable);
}

describe("the shortcuts table", () => {
  it("has no two shortcuts on the same keys in one group", () => {
    const seen = new Map<string, string>();
    for (const entry of SHORTCUTS) {
      const combination = `${entry.group}::${entry.keys.join("+").toLowerCase()}`;
      expect(
        seen.get(combination),
        `"${entry.description}" and "${seen.get(combination)}" share ${entry.keys.join("+")}`,
      ).toBeUndefined();
      seen.set(combination, entry.description);
    }
  });

  it("gives every shortcut a description and at least one key", () => {
    for (const entry of SHORTCUTS) {
      expect(entry.description.trim()).not.toBe("");
      expect(entry.keys.length).toBeGreaterThan(0);
      for (const key of entry.keys) expect(key.trim()).not.toBe("");
    }
  });

  it("marks a shortcut as a bare letter exactly when a printable key fires it with no modifier", () => {
    for (const entry of SHORTCUTS) {
      expect(entry.bareLetter, entry.description).toBe(
        expectedBareLetter(entry),
      );
    }
  });

  it("gates the single keys the settings switch is for, and nothing with a modifier", () => {
    const bare = (keys: string[]) =>
      SHORTCUTS.find((entry) => entry.keys.join("+") === keys.join("+"))
        ?.bareLetter;
    expect(bare(["/"])).toBe(true);
    expect(bare(["N"])).toBe(true);
    expect(bare(["↓", "J"])).toBe(true);
    expect(bare(["↑", "↓"])).toBe(false);
    expect(bare(["Esc"])).toBe(false);
    expect(bare(["⌘", "K"])).toBe(false);
  });

  it("gives the contact page a bare T that tracks the contact", () => {
    const track = SHORTCUTS.find((entry) => entry.keys.join("+") === "T");
    expect(track?.group).toBe("Contact");
    expect(track?.bareLetter).toBe(true);
    expect(track?.page).toBe("/contact/:id");
    expect(track?.description).toBe("Track or untrack this contact");
  });

  it("marks alwaysOn only on bare-letter entries", () => {
    for (const entry of SHORTCUTS) {
      if (entry.alwaysOn) {
        expect(
          entry.bareLetter,
          `"${entry.description}" in ${entry.group} has alwaysOn but bareLetter is false`,
        ).toBe(true);
      }
    }
    const alwaysOn = SHORTCUTS.filter((e) => e.alwaysOn);
    expect(alwaysOn.map((e) => e.keys.join("+"))).toEqual(["?", "A–Z"]);
  });

  it("lists every group in the order, and orders no group that has no shortcut", () => {
    const groups = new Set(SHORTCUTS.map((entry) => entry.group));
    for (const group of groups) expect(SHORTCUT_GROUP_ORDER).toContain(group);
    for (const group of SHORTCUT_GROUP_ORDER) expect(groups).toContain(group);
    expect(new Set(SHORTCUT_GROUP_ORDER).size).toBe(
      SHORTCUT_GROUP_ORDER.length,
    );
  });

  it("names destinations by their current names", () => {
    for (const entry of SHORTCUTS) {
      expect(entry.description).not.toMatch(/AI Search/);
      expect(entry.description).not.toMatch(/Relationship Pulse/);
      expect(`${entry.group} ${entry.description}`).not.toMatch(/—/);
    }
  });

  it("groups the shortcuts in order without losing one", () => {
    const grouped = groupedShortcuts();
    expect(grouped.map(({ group }) => group)).toEqual([
      ...SHORTCUT_GROUP_ORDER,
    ]);
    expect(grouped.flatMap(({ shortcuts }) => shortcuts)).toHaveLength(
      SHORTCUTS.length,
    );
  });

  it("tells a combination from a set of alternatives", () => {
    expect(isCombination(["⌘", "⇧", "H"])).toBe(true);
    expect(isCombination(["→", "L"])).toBe(false);
  });
});

describe("the shortcuts dialog", () => {
  it("shows every group heading from the table when open", () => {
    render(
      React.createElement(KeyboardShortcutsModal, {
        isOpen: true,
        onClose: () => {},
      }),
    );
    const list = within(screen.getByRole("dialog")).getByRole("region", {
      name: "Shortcut list",
    });
    for (const group of SHORTCUT_GROUP_ORDER) {
      expect(within(list).getByText(group)).toBeTruthy();
    }
    expect(
      within(list).getByText("Move through the contact list"),
    ).toBeTruthy();
  });
});
