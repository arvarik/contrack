// @vitest-environment jsdom
// =============================================================================
// ActionMenu: a kebab that behaves as a menu
// =============================================================================
// `role="menu"` promises keys: focus inside on open, the arrows and Home and
// End move, Escape goes back to the button. The contact page's menus carried
// the role without the keys. The header kebab, each detail row's kebab and
// each link's actions now share this one primitive, so its keys are checked
// here once.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../src/components/ui/ActionMenu";

afterEach(() => {
  cleanup();
});

function mount(items: ActionMenuItem[], onOpenChange = vi.fn()) {
  render(
    <MemoryRouter>
      <ActionMenu
        label="Contact actions"
        items={items}
        onOpenChange={onOpenChange}
      />
      <button type="button">After</button>
    </MemoryRouter>,
  );
  return {
    trigger: screen.getByRole("button", { name: "Contact actions" }),
    onOpenChange,
  };
}

const item = (label: string, extra: Partial<ActionMenuItem> = {}) => ({
  id: label.toLowerCase(),
  label,
  onSelect: vi.fn(),
  ...extra,
});

describe("the trigger", () => {
  it("is a menu button that opens with focus on the first item", () => {
    const { trigger, onOpenChange } = mount([item("Copy"), item("Archive")]);
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Contact actions" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Copy" }),
    );
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it("opens on the last item with ArrowUp and on the first with ArrowDown", () => {
    const { trigger } = mount([item("Copy"), item("Archive")]);
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("Archive");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Copy");
  });
});

describe("inside the menu", () => {
  it("moves with the arrows and wraps, jumps with Home and End, and skips disabled items", () => {
    const { trigger } = mount([
      item("Change colour"),
      item("Copy details", { disabled: true }),
      item("Archive"),
      item("Delete", { danger: true }),
    ]);
    fireEvent.click(trigger);
    const focused = () => document.activeElement?.textContent;

    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(focused()).toBe("Archive");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(focused()).toBe("Delete");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(focused()).toBe("Change colour");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(focused()).toBe("Delete");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(focused()).toBe("Change colour");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(focused()).toBe("Delete");
  });

  it("jumps to the next item that starts with a typed letter", () => {
    const { trigger } = mount([
      item("Change colour"),
      item("Change avatar"),
      item("Archive"),
    ]);
    fireEvent.click(trigger);
    fireEvent.keyDown(document.activeElement!, { key: "c" });
    expect(document.activeElement?.textContent).toBe("Change avatar");
    fireEvent.keyDown(document.activeElement!, { key: "a" });
    expect(document.activeElement?.textContent).toBe("Archive");
  });

  it("closes on Escape, marks the key handled, and returns focus to the trigger", () => {
    const { trigger } = mount([item("Copy")]);
    fireEvent.click(trigger);
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.activeElement!.dispatchEvent(escape);
    });
    expect(escape.defaultPrevented).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Tab", () => {
    const { trigger } = mount([item("Copy")]);
    fireEvent.click(trigger);
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on a press outside", () => {
    const { trigger } = mount([item("Copy")]);
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "After" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("choosing an item", () => {
  it("closes the menu and gives focus back before the action runs", () => {
    let focusedDuringAction: Element | null = null;
    const archive = item("Archive", {
      onSelect: vi.fn(() => {
        focusedDuringAction = document.activeElement;
      }),
    });
    const { trigger } = mount([archive]);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(archive.onSelect).toHaveBeenCalledTimes(1);
    // A dialog the action opens records this as the place to return to.
    expect(focusedDuringAction).toBe(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does nothing for a disabled item", () => {
    const disabled = item("Copy", { disabled: true });
    const { trigger } = mount([disabled]);
    fireEvent.click(trigger);
    const row = screen.getByRole("menuitem", { name: "Copy" });
    expect(row.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(row);
    expect(disabled.onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("renders an item with a route as a link", () => {
    const { trigger } = mount([
      { id: "map", label: "Show on map", to: "/map/contact/c-1" },
    ]);
    fireEvent.click(trigger);
    const link = screen.getByRole("menuitem", { name: "Show on map" });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/map/contact/c-1");
  });

  it("puts a destructive item last, whatever order it was given in", () => {
    const { trigger } = mount([
      item("Delete", { danger: true }),
      item("Copy"),
      item("Archive"),
    ]);
    fireEvent.click(trigger);
    expect(
      screen.getAllByRole("menuitem").map((row) => row.textContent),
    ).toEqual(["Copy", "Archive", "Delete"]);
  });

  it("draws a flat trigger with the hover layer by default", () => {
    const { trigger } = mount([item("Copy")]);
    expect(trigger.className).toContain("state-layer");
    expect(trigger.className).not.toContain("btn-primary");
  });

  it("draws the page's call to action as a small pressable primary button", () => {
    render(
      <MemoryRouter>
        <ActionMenu label="New" variant="primary" items={[item("Contact")]} />
      </MemoryRouter>,
    );
    const trigger = screen.getByRole("button", { name: "New" });
    expect(trigger.className).toContain("btn-primary");
    expect(trigger.className).toContain("btn-sm");
    expect(trigger.className).not.toContain("state-layer");
    fireEvent.click(trigger);
    // Open, the primary trigger keeps its face: no ghost fill on top of it.
    expect(trigger.className).not.toContain("bg-surface-container-high");
    expect(screen.getByRole("menuitem", { name: "Contact" })).toBeTruthy();
  });
});
