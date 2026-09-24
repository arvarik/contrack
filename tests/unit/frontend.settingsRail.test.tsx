// @vitest-environment jsdom
/**
 * The Settings rail: the left pane, the way the Network list is.
 *
 * The same edge to drag, the same bounds and one stored width for both
 * panes (`LEFT_PANE`), and the rows' scroll bar on the left edge, as the
 * Network list keeps it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SettingsRail } from "../../src/views/settings/SettingsRail";
import { LEFT_PANE } from "../../src/components/layout/paneWidth";

vi.mock("../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ isAdmin: false, authRequired: false }),
}));
vi.mock("../../src/views/settings/NeedsAttention", () => ({
  useAttentionCounts: () => ({
    duplicates: 0,
    neverEnriched: 0,
    failedImports: 0,
  }),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const mount = () =>
  render(
    <MemoryRouter initialEntries={["/settings/appearance"]}>
      <div>
        <SettingsRail />
      </div>
    </MemoryRouter>,
  );

describe("SettingsRail", () => {
  it("has the Network list's edge to drag, with its bounds", () => {
    mount();
    const handle = screen.getByRole("separator", {
      name: "Resize the settings list",
    });
    expect(handle.getAttribute("aria-valuenow")).toBe(
      String(LEFT_PANE.initial),
    );
    expect(handle.getAttribute("aria-valuemin")).toBe(String(LEFT_PANE.min));
  });

  it("opens at the width the Network list was left at on this device", () => {
    localStorage.setItem(LEFT_PANE.storageKey, "420");
    const { container } = mount();
    const rail = container.querySelector("aside")!;
    expect(rail.className).toContain("w-(--pane-width)");
    expect(rail.style.getPropertyValue(LEFT_PANE.property)).toBe("420px");
  });

  it("keeps the rows' scroll bar on the left edge", () => {
    mount();
    const nav = screen.getByRole("navigation", { name: "Settings" });
    expect(nav.getAttribute("dir")).toBe("rtl");
    expect(nav.firstElementChild?.getAttribute("dir")).toBe("ltr");
  });

  it("marks the page it is on", () => {
    mount();
    expect(
      screen
        .getByRole("link", { name: "Appearance" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});
