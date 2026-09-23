// @vitest-environment jsdom
/**
 * The Network list's bulk bar rests while nothing is selected. "0 selected"
 * acts on no one, and Delete was live there.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { BulkActionToolbar } from "../../src/views/contact-list/BulkActionToolbar";

vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ mode: "light", preferences: {} }),
}));

afterEach(() => cleanup());

const renderBar = (selectedCount: number) =>
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
});
