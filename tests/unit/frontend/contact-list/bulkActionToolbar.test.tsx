// @vitest-environment jsdom
/**
 * The Network list's bulk bar rests while nothing is selected. "0 selected"
 * acts on no one, and Delete was live there.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { BulkActionToolbar } from "../../../../src/views/contact-list/BulkActionToolbar";

vi.mock("../../../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ mode: "light", preferences: {} }),
}));

afterEach(() => cleanup());

const renderBar = (selectedCount?: number) =>
  render(
    <BulkActionToolbar
      selectedCount={selectedCount}
      isPending={false}
      onTrack={() => {}}
      selectionTracked="none"
      onArchive={() => {}}
      onAddToList={() => {}}
      onEditField={() => {}}
      onColorChange={() => {}}
      onExportCSV={() => {}}
      onDelete={() => {}}
    />,
  );

const actions = () =>
  within(screen.getByRole("toolbar", { name: "Bulk actions" })).getAllByRole(
    "button",
  );

describe("BulkActionToolbar", () => {
  it("rests every action at 0 selected", () => {
    renderBar(0);
    expect(actions().length).toBeGreaterThanOrEqual(7);
    for (const button of actions()) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
  });

  it("wakes them once a row is picked", () => {
    renderBar(2);
    for (const button of actions()) {
      expect(button.hasAttribute("disabled")).toBe(false);
    }
    expect(screen.getByText("selected")).toBeTruthy();
  });

  // Select mode kept "Network" as the page's title. The count moved to the
  // start of the bar, and is read out as it changes.
  it("leads with the count, in a polite live region", () => {
    renderBar(3);
    const toolbar = screen.getByRole("toolbar", { name: "Bulk actions" });
    const count = within(toolbar).getByText(
      (_, el) => el?.textContent === "3 selected" && el.tagName === "SPAN",
    );
    expect(count.getAttribute("aria-live")).toBe("polite");
    // Atomic, so NVDA says "3 selected" and not the changed "3" alone.
    expect(count.getAttribute("role")).toBe("status");
    expect(count.getAttribute("aria-atomic")).toBe("true");
    expect(toolbar.firstElementChild).toBe(count);
    // Track is still the first button.
    expect(within(toolbar).getAllByRole("button")[0]).toBe(
      within(toolbar).getByRole("button", { name: "Track" }),
    );
  });

  it("says no count where the page gives none, as the map does", () => {
    renderBar();
    expect(screen.queryByText(/selected/)).toBeNull();
  });
});
