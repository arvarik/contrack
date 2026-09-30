// @vitest-environment jsdom
/**
 * The count pills in the Settings rail: what is waiting on a page.
 *
 * Duplicates and Import show a count. Contact enrichment shows none: the
 * contacts never enriched are a list on that page, not a task to finish.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SettingsRail } from "../../../../src/views/settings/SettingsRail";

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

afterEach(cleanup);

const mount = () =>
  render(
    <MemoryRouter initialEntries={["/settings/appearance"]}>
      <SettingsRail />
    </MemoryRouter>,
  );

describe("the Settings rail's count pills", () => {
  it("counts the possible duplicates on their page", () => {
    mount();
    expect(
      screen.getByRole("link", { name: /, 3 waiting$/ }).getAttribute("href"),
    ).toBe("/settings/duplicates");
  });

  it("shows no count on Contact enrichment, however many were never enriched", () => {
    mount();
    const link = screen.getByRole("link", { name: /Contact enrichment/ });
    expect(link.getAttribute("href")).toBe("/settings/enrichment");
    expect(link.getAttribute("aria-label")).not.toMatch(/waiting/);
    expect(link.textContent).not.toMatch(/\d/);
  });
});
