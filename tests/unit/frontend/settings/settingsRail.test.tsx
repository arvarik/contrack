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
import { SettingsRail } from "../../../../src/views/settings/SettingsRail";
import { LEFT_PANE } from "../../../../src/components/layout/paneWidth";

vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ isAdmin: true, authRequired: false }),
}));
vi.mock("../../../../src/api", () => ({
  useDedupeCount: () => ({ data: 3 }),
  useContacts: () => ({
    data: [
      { id: "c1", aiHydratedAt: null, isArchived: false, isGhost: false },
      { id: "c2", aiHydratedAt: null, isArchived: false, isGhost: false },
    ],
  }),
}));
vi.mock("../../../../src/api/imports", () => ({
  useImports: () => ({ data: [] }),
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
  it("has the Network list's edge to drag, with its bounds, and opens at the stored width", () => {
    localStorage.setItem(LEFT_PANE.storageKey, "420");
    const { container } = mount();
    const handle = screen.getByRole("separator", {
      name: "Resize the settings list",
    });
    expect(handle.getAttribute("aria-valuenow")).toBe("420");
    expect(handle.getAttribute("aria-valuemin")).toBe(String(LEFT_PANE.min));
    const rail = container.querySelector("aside")!;
    expect(rail.style.getPropertyValue(LEFT_PANE.property)).toBe("420px");
  });

  it("counts possible duplicates on Duplicates and shows no count on Contact enrichment", () => {
    mount();
    expect(
      screen.getByRole("link", { name: /, 3 waiting$/ }).getAttribute("href"),
    ).toBe("/settings/duplicates");
    const enrichLink = screen.getByRole("link", { name: /Contact enrichment/ });
    expect(enrichLink.getAttribute("href")).toBe("/settings/enrichment");
    expect(enrichLink.getAttribute("aria-label")).not.toMatch(/waiting/);
    expect(enrichLink.textContent).not.toMatch(/\d/);
  });
});
