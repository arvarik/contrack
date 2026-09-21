// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SaveViewModal } from "../../src/views/map/SaveViewModal";
import { RenameViewModal } from "../../src/views/map/RenameViewModal";
import { HealthLegend } from "../../src/views/map/HealthLegend";
import { ViewsMenu } from "../../src/views/map/ViewsMenu";
import type { MapView } from "../../src/api/mapViews";

describe("HealthLegend", () => {
  it("renders Strong, Fading, and At risk labels with role group", () => {
    render(<HealthLegend />);
    const group = screen.getByRole("group", { name: "Health legend" });
    expect(group).toBeTruthy();
    expect(screen.getByText("Strong")).toBeTruthy();
    expect(screen.getByText("Fading")).toBeTruthy();
    expect(screen.getByText("At risk")).toBeTruthy();
  });
});

describe("SaveViewModal", () => {
  it("disables save button when name is empty and validates length", async () => {
    const handleSave = vi.fn();
    const handleClose = vi.fn();

    render(
      <SaveViewModal
        isOpen={true}
        onClose={handleClose}
        onSave={handleSave}
        currentQuery="company:Navy"
        currentLayer="health"
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Save current view" }),
    ).toBeTruthy();
    expect(screen.getByText("company:Navy")).toBeTruthy();
    expect(screen.getByText("Health")).toBeTruthy();

    const saveButton = screen.getByRole("button", {
      name: "Save view",
    }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    const input = screen.getByRole("textbox", { name: "View name" });
    fireEvent.change(input, { target: { value: "A".repeat(61) } });
    expect(saveButton.disabled).toBe(false);
    fireEvent.click(saveButton);

    expect(screen.getByRole("alert").textContent).toContain(
      "60 characters or less",
    );
    expect(handleSave).not.toHaveBeenCalled();
  });

  it("submits valid name and closes on success", async () => {
    const handleSave = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();

    render(
      <SaveViewModal
        isOpen={true}
        onClose={handleClose}
        onSave={handleSave}
        currentLayer="pins"
      />,
    );

    const input = screen.getByRole("textbox", { name: "View name" });
    fireEvent.change(input, { target: { value: "My London View" } });

    const saveButton = screen.getByRole("button", { name: "Save view" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalledWith("My London View");
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it("displays server rejection error message", async () => {
    const handleSave = vi
      .fn()
      .mockRejectedValue(new Error("Maximum 100 saved views reached"));
    const handleClose = vi.fn();

    render(
      <SaveViewModal
        isOpen={true}
        onClose={handleClose}
        onSave={handleSave}
        currentLayer="heat"
      />,
    );

    const input = screen.getByRole("textbox", { name: "View name" });
    fireEvent.change(input, { target: { value: "Too Many" } });

    const saveButton = screen.getByRole("button", { name: "Save view" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Maximum 100 saved views reached",
      );
    });
  });
});

describe("RenameViewModal", () => {
  const mockView: MapView = {
    id: "view-123",
    name: "Old Name",
    query: "",
    layer: "pins",
    bounds: [-180, -90, 180, 90],
    sortOrder: 0,
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
  };

  it("populates initial name and disables submit when empty", async () => {
    const handleRename = vi.fn();
    const handleClose = vi.fn();

    render(
      <RenameViewModal
        view={mockView}
        isOpen={true}
        onClose={handleClose}
        onRename={handleRename}
      />,
    );

    const input = screen.getByRole("textbox", {
      name: "View name",
    }) as HTMLInputElement;
    expect(input.value).toBe("Old Name");

    const saveButton = screen.getByRole("button", {
      name: "Save",
    }) as HTMLButtonElement;
    // Disabled initially because name is unchanged (clean)
    expect(saveButton.disabled).toBe(true);

    // Enabled when changed
    fireEvent.change(input, { target: { value: "Changed Name" } });
    expect(saveButton.disabled).toBe(false);

    // Disabled when blank
    fireEvent.change(input, { target: { value: "   " } });
    expect(saveButton.disabled).toBe(true);
  });

  it("submits updated name and calls onRename", async () => {
    const handleRename = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();

    render(
      <RenameViewModal
        view={mockView}
        isOpen={true}
        onClose={handleClose}
        onRename={handleRename}
      />,
    );

    const input = screen.getByRole("textbox", { name: "View name" });
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(handleRename).toHaveBeenCalledWith("view-123", "New Name");
      expect(handleClose).toHaveBeenCalled();
    });
  });
});

describe("ViewsMenu actions", () => {
  const mockViews: MapView[] = [
    {
      id: "view-1",
      name: "Alpha View",
      query: "company:Apple",
      layer: "pins",
      bounds: [-10, 50, 10, 60],
      sortOrder: 0,
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    },
  ];

  it("handles rename, delete, and save actions", () => {
    const handleSelectView = vi.fn();
    const handleOpenSave = vi.fn();
    const handleStartRename = vi.fn();
    const handleDeleteView = vi.fn();

    render(
      <ViewsMenu
        views={mockViews}
        activeViewId="view-1"
        onSelectView={handleSelectView}
        onOpenSaveModal={handleOpenSave}
        onStartRename={handleStartRename}
        onDeleteView={handleDeleteView}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Saved views" });
    fireEvent.click(trigger);

    // Click Rename button
    const renameBtn = screen.getByRole("menuitem", {
      name: "Rename Alpha View",
    });
    fireEvent.click(renameBtn);
    expect(handleStartRename).toHaveBeenCalledWith(mockViews[0]);

    // Reopen menu
    fireEvent.click(trigger);

    // Click Delete button
    const deleteBtn = screen.getByRole("menuitem", {
      name: "Delete Alpha View",
    });
    fireEvent.click(deleteBtn);
    expect(handleDeleteView).toHaveBeenCalledWith(mockViews[0]);

    // Reopen menu and click Save current view
    fireEvent.click(trigger);
    const saveMenuItem = screen.getByRole("menuitem", {
      name: /Save current view/,
    });
    fireEvent.click(saveMenuItem);
    expect(handleOpenSave).toHaveBeenCalled();
  });

  // `role="menu"` promises the arrows. They move between the items, wrap at
  // the ends, and Escape goes back to the button.
  it("moves between the items with the arrows and wraps at the ends", () => {
    render(
      <ViewsMenu
        views={mockViews}
        activeViewId={null}
        onSelectView={vi.fn()}
        onOpenSaveModal={vi.fn()}
        onStartRename={vi.fn()}
        onDeleteView={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Saved views" });
    trigger.focus();
    fireEvent.click(trigger);
    const alpha = screen.getByRole("menuitem", { name: "Alpha View" });
    const rename = screen.getByRole("menuitem", { name: "Rename Alpha View" });
    const remove = screen.getByRole("menuitem", { name: "Delete Alpha View" });
    const save = screen.getByRole("menuitem", { name: "Save current view…" });

    // From the trigger, ArrowDown starts at the first item.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(document.activeElement).toBe(alpha);

    // A view's Rename and Delete are items too, so the arrows reach them.
    fireEvent.keyDown(alpha, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rename);
    fireEvent.keyDown(rename, { key: "ArrowDown" });
    expect(document.activeElement).toBe(remove);
    fireEvent.keyDown(remove, { key: "ArrowDown" });
    expect(document.activeElement).toBe(save);

    // Past the last item, ArrowDown wraps to the first.
    fireEvent.keyDown(save, { key: "ArrowDown" });
    expect(document.activeElement).toBe(alpha);

    // Before the first item, ArrowUp wraps to the last.
    fireEvent.keyDown(alpha, { key: "ArrowUp" });
    expect(document.activeElement).toBe(save);

    fireEvent.keyDown(save, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
