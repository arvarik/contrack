// @vitest-environment jsdom
/**
 * The one right-hand panel: a rail icon that discloses a panel over the
 * page, a heading row with Hide, and the keyboard handed back on close.
 */
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { History } from "lucide-react";
import { SidePanel } from "../../src/components/layout/SidePanel";

afterEach(() => cleanup());

const Harness = ({
  initial = false,
  onChange,
}: {
  initial?: boolean;
  onChange?: (open: boolean) => void;
}) => {
  const [open, setOpen] = useState(initial);
  return (
    <SidePanel
      id="test-panel"
      title="History"
      icon={History}
      open={open}
      onOpenChange={(next) => {
        onChange?.(next);
        setOpen(next);
      }}
      shortcut="H"
      count={3}
      actions={<button type="button">Clear</button>}
    >
      <button type="button">An entry</button>
    </SidePanel>
  );
};

const panel = () => document.getElementById("test-panel") as HTMLElement;

describe("SidePanel", () => {
  it("names its rail icon for the panel and discloses the panel it controls", () => {
    render(<Harness />);
    const icon = screen.getByRole("button", { name: "History" });
    expect(icon.getAttribute("aria-expanded")).toBe("false");
    expect(icon.getAttribute("aria-controls")).toBe("test-panel");
    // Closed: nothing inside takes focus, is read or takes a pointer.
    expect(panel().hasAttribute("inert")).toBe(true);
    expect(panel().className).toContain("pointer-events-none");
  });

  it("opens from the rail icon, with the heading, the count and the actions", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(panel().hasAttribute("inert")).toBe(false);
    expect(panel().getAttribute("aria-label")).toBe("History");
    expect(
      screen.getByRole("heading", { level: 2, name: "History" }),
    ).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "History" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("hides from its own button and hands focus to the rail icon", () => {
    render(<Harness initial />);
    const hide = screen.getByRole("button", { name: "Hide history" });
    expect(hide.getAttribute("title")).toBe("Hide history (H)");
    hide.focus();
    fireEvent.click(hide);
    expect(panel().hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "History" }),
    );
  });

  it("closes on Escape inside the panel, before the page hears the key", () => {
    const pageEscape = vi.fn();
    window.addEventListener("keydown", pageEscape);
    try {
      render(<Harness initial />);
      const entry = screen.getByRole("button", { name: "An entry" });
      entry.focus();
      fireEvent.keyDown(entry, { key: "Escape" });
      expect(panel().hasAttribute("inert")).toBe(true);
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "History" }),
      );
      expect(pageEscape).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", pageEscape);
    }
  });

  // A page's own shortcut (H on Ask Contrack) closes the panel through the
  // `open` prop, not through Hide.
  const Controlled = ({ open }: { open: boolean }) => (
    <>
      <input aria-label="Search" />
      <SidePanel
        id="test-panel"
        title="History"
        icon={History}
        open={open}
        onOpenChange={() => {}}
      >
        <button type="button">An entry</button>
      </SidePanel>
    </>
  );

  it("hands focus to the rail icon when the page closes it with focus inside", () => {
    const { rerender } = render(<Controlled open />);
    screen.getByRole("button", { name: "An entry" }).focus();
    rerender(<Controlled open={false} />);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "History" }),
    );
  });

  it("leaves focus where it is when the page closes it from outside", () => {
    const { rerender } = render(<Controlled open />);
    const search = screen.getByRole("textbox", { name: "Search" });
    search.focus();
    rerender(<Controlled open={false} />);
    expect(document.activeElement).toBe(search);
  });
});
