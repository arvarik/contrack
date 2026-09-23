// @vitest-environment jsdom
/**
 * The one right-hand panel: a button in the page's top-right corner that
 * discloses a panel over the page, the same button that closes it, and the
 * keyboard handed back to it on close.
 */
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BarChart3, History } from "lucide-react";
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
const toggle = () => screen.getByRole("button", { name: "History" });

describe("SidePanel", () => {
  it("names its button for the panel and discloses the panel it controls", () => {
    render(<Harness />);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().getAttribute("aria-controls")).toBe("test-panel");
    // Closed: nothing inside takes focus, is read or takes a pointer.
    expect(panel().hasAttribute("inert")).toBe(true);
    expect(panel().className).toContain("pointer-events-none");
  });

  it("comes before the panel, so Tab goes from the button into it", () => {
    render(<Harness initial />);
    const order = toggle().compareDocumentPosition(panel());
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens from the button, with the heading, the count and the actions", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(toggle());
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(panel().hasAttribute("inert")).toBe(false);
    expect(panel().getAttribute("aria-label")).toBe("History");
    expect(
      screen.getByRole("heading", { level: 2, name: "History" }),
    ).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    // The button latches: `.btn-latch` presses it in while it is expanded.
    expect(toggle().className).toContain("btn-latch");
  });

  it("closes from the same button, and has no second close button", () => {
    const onChange = vi.fn();
    render(<Harness initial onChange={onChange} />);
    expect(screen.queryByRole("button", { name: /hide/i })).toBeNull();
    // The heading row keeps the button's box free with a drawing of its
    // face, which is no second button.
    expect(screen.getAllByRole("button", { name: "History" })).toHaveLength(1);
    fireEvent.click(toggle());
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(panel().hasAttribute("inert")).toBe(true);
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
      expect(document.activeElement).toBe(toggle());
      expect(pageEscape).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", pageEscape);
    }
  });

  // A page's own shortcut (H on Ask Contrack) closes the panel through the
  // `open` prop, not through the button.
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

  it("hands focus to the button when the page closes it with focus inside", () => {
    const { rerender } = render(<Controlled open />);
    screen.getByRole("button", { name: "An entry" }).focus();
    rerender(<Controlled open={false} />);
    expect(document.activeElement).toBe(toggle());
  });

  it("leaves focus where it is when the page closes it from outside", () => {
    const { rerender } = render(<Controlled open />);
    const search = screen.getByRole("textbox", { name: "Search" });
    search.focus();
    rerender(<Controlled open={false} />);
    expect(document.activeElement).toBe(search);
  });

  it("shows a word beside the glyph, and can hand its heading row to a switch", () => {
    render(
      <SidePanel
        id="test-panel"
        title="Map insights"
        icon={BarChart3}
        label="Insights"
        inset="overlay"
        open
        onOpenChange={() => {}}
        titleHidden
        lead={<button type="button">Summary</button>}
      >
        <p>Body</p>
      </SidePanel>,
    );
    const button = screen.getByRole("button", { name: "Map insights" });
    expect(button.textContent).toBe("Insights");
    // The heading is still the panel's name for a screen reader.
    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Map insights",
    });
    expect(heading.className).toContain("sr-only");
    expect(screen.getByRole("button", { name: "Summary" })).toBeTruthy();
  });
});
