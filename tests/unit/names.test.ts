// @vitest-environment jsdom
// =============================================================================
// One name per destination
// =============================================================================
// The same page used to carry a different name on each surface: "Ask AI" in
// the tab bar, "AI Search" in the sidebar, "Ask Contrack" on the page. Every
// surface now reads its name from `lib/names`. These tests hold the surfaces
// to that module, so a label typed in by hand shows up here and not in a
// support thread.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NAMES } from "../../src/lib/names";
import { NAV_SHORTCUTS } from "../../src/hooks/useGlobalNavShortcuts";
import { NAV_ITEMS } from "../../src/components/command-palette/ZeroStateView";
import { Sidebar } from "../../src/components/layout/Sidebar";

// The sidebar reads two counts off the `api` barrel, and the barrel pulls in
// every API module in the app. Coverage instruments what is imported, so the
// hooks are stubbed here. The counts are fixed, so the badge wording in the
// Pulse link's name is under test too.
vi.mock("../../src/api", () => ({
  useUrgentActionItemCount: () => ({ data: { count: 2 } }),
  useDedupeCount: () => ({ data: { count: 1 } }),
}));
vi.mock("../../src/contexts/SessionContext", () => ({
  useRecent: () => ({ lastContactId: null }),
}));
vi.mock("../../src/components/auth/AccountIdentity", () => ({
  SidebarIdentity: () => null,
}));

afterEach(() => {
  cleanup();
});

/** Names the app used before 2.0. None of them may come back. */
const OLD_NAMES = [
  "Relationship Pulse",
  "AI Search",
  "Ask AI",
  "Network Dedupe Engine",
  "Contact Enrichment",
];

/** The five top-level destinations, by path. */
const DESTINATIONS = [
  ["/", NAMES.network.label],
  ["/pulse", NAMES.pulse.label],
  ["/map", NAMES.map.label],
  ["/search", NAMES.ask.label],
  ["/settings", NAMES.settings.label],
] as const;

describe("NAMES", () => {
  it.each(Object.entries(NAMES))(
    "%s has a label, a title and a description",
    (_key, name) => {
      expect(name.label.trim()).not.toBe("");
      expect(name.title.trim()).not.toBe("");
      expect(name.description.trim()).not.toBe("");
    },
  );

  it("uses none of the old names", () => {
    const text = Object.values(NAMES)
      .flatMap((name) => [name.label, name.title, name.description])
      .join("\n");
    for (const old of OLD_NAMES) {
      expect(text).not.toContain(old);
    }
  });
});

describe("every surface uses the same name", () => {
  it.each(DESTINATIONS)("the shortcut for %s says %s", (path, label) => {
    expect(NAV_SHORTCUTS[path]?.label).toBe(label);
  });

  it.each(DESTINATIONS)("the palette item for %s says %s", (path, label) => {
    expect(NAV_ITEMS.find((item) => item.path === path)?.label).toBe(label);
  });

  it("the sidebar links carry the same names", () => {
    render(createElement(MemoryRouter, null, createElement(Sidebar)));

    // Exact names. The Pulse link adds its counts after a comma, because the
    // badges are hidden from assistive tech and the name has to say them.
    for (const name of [
      NAMES.network.label,
      `${NAMES.pulse.label}, 2 urgent follow-ups, 1 possible duplicate`,
      NAMES.map.label,
      NAMES.ask.label,
      NAMES.settings.label,
    ]) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }

    // The wordmark is decoration and is hidden, so it names nothing.
    expect(document.querySelector("[title]")).toBeNull();

    const text = document.body.innerHTML;
    for (const old of OLD_NAMES) {
      expect(text).not.toContain(old);
    }
  });
});
