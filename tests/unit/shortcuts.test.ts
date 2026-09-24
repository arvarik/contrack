// @vitest-environment jsdom
// =============================================================================
// The shortcuts table in src/lib/shortcuts.ts
// =============================================================================
// Every plan registers its keys in one table, and the `?` dialog renders from
// it. These checks catch what a person would otherwise find by pressing a key:
// two actions on the same keys, a row with nothing to press, a switch that
// gates the wrong shortcuts, and a destination under an old name.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  COMMON_GROUPS,
  SHORTCUTS,
  SHORTCUT_GROUP_ORDER,
  groupedShortcuts,
  isCombination,
  isOnPage,
  pageShortcutGroups,
  type Shortcut,
} from "../../src/lib/shortcuts";
import { KeyboardShortcutsModal } from "../../src/components/KeyboardShortcutsModal";

const keys = vi.hoisted(() => ({ single: true }));
vi.mock("../../src/hooks/useSingleKeyShortcuts", () => ({
  useSingleKeyShortcuts: () => keys.single,
}));

afterEach(() => {
  cleanup();
  keys.single = true;
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

describe("the shortcuts for a page", () => {
  it("keeps the list on screen beside a contact, and the contact over the map", () => {
    expect(isOnPage("/", "/")).toBe(true);
    expect(isOnPage("/", "/contact/ada")).toBe(true);
    expect(isOnPage("/contact/:id", "/contact/ada")).toBe(true);
    expect(isOnPage("/contact/:id", "/map/contact/ada")).toBe(true);
    expect(isOnPage("/map", "/map/contact/ada")).toBe(true);
    expect(isOnPage("/pulse", "/pulse/duplicates")).toBe(false);
    expect(isOnPage("/", "/pulse")).toBe(false);
  });

  it("puts the open contact's group first", () => {
    const groups = (path: string) =>
      pageShortcutGroups(path).map(({ group }) => group);
    expect(groups("/contact/ada")).toEqual(["Contact", "Network"]);
    expect(groups("/map/contact/ada")).toEqual(["Contact", "Map"]);
    expect(groups("/pulse")).toEqual(["Pulse"]);
    expect(groups("/pulse/duplicates")).toEqual(["Possible duplicates"]);
    expect(groups("/settings/duplicates")).toEqual(["Duplicates"]);
    expect(groups("/settings/appearance")).toEqual([]);
  });

  it("gives every page shortcut a page it can be found on", () => {
    for (const entry of SHORTCUTS) {
      if (!entry.page) {
        expect(COMMON_GROUPS, entry.description).toContain(entry.group);
        continue;
      }
      const sample = entry.page.replace(":id", "ada");
      expect(isOnPage(entry.page, sample), entry.description).toBe(true);
    }
  });
});

describe("the shortcuts dialog", () => {
  const open = (path: string) =>
    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: [path] },
        React.createElement(KeyboardShortcutsModal, {
          isOpen: true,
          onClose: () => {},
        }),
      ),
    );
  const list = () =>
    within(screen.getByRole("dialog")).getByRole("region", {
      name: "Shortcut list",
    });

  it("shows the shortcuts that work everywhere, and the page's own", () => {
    open("/");
    for (const group of [...COMMON_GROUPS, "Network"]) {
      expect(within(list()).getByText(group)).toBeTruthy();
    }
    expect(
      within(list()).getByText("Move through the contact list"),
    ).toBeTruthy();
    // Another page's keys are not on this one.
    expect(within(list()).queryByText("Pulse")).toBeNull();
    expect(within(list()).queryByText("Fit all in view")).toBeNull();
  });

  it("changes its page column with the page", () => {
    open("/map");
    expect(within(list()).getByText("Fit all in view")).toBeTruthy();
    expect(within(list()).queryByText("New contact")).toBeNull();
  });

  it("says a page with no keys of its own has none", () => {
    open("/settings/appearance");
    expect(within(list()).getByText("No shortcuts of its own")).toBeTruthy();
    expect(within(list()).getByText("Go to Network")).toBeTruthy();
  });

  it("links to every shortcut in Settings, Keyboard", () => {
    open("/");
    expect(
      screen.getByRole("link", { name: "All shortcuts" }).getAttribute("href"),
    ).toBe("/settings/keyboard");
  });

  it("dims the single keys when the switch is off, and says how to turn them on", () => {
    keys.single = false;
    open("/");
    const row = within(list())
      .getByText(/^New contact/)
      .closest("div")!;
    expect(row.className).toContain("opacity-50");
    expect(row.textContent).toContain("off");
    expect(
      screen.getByRole("link", { name: "Turn them on" }).getAttribute("href"),
    ).toBe("/settings/keyboard#single-key-shortcuts");
  });
});
