// @vitest-environment jsdom
/**
 * ResizeHandle: the Network list's right edge.
 *
 * A focusable separator (the WAI-ARIA window splitter). The arrow keys move
 * it 16 px, Shift 64, Home and End go to the bounds, and a double click
 * restores 350. A drag writes one custom property per animation frame and
 * renders nothing else, so the list beside it never re-renders while the
 * pointer moves. The page keeps the resize cursor and selects no text until
 * the drag ends, and a press leaves focus where it was.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  DOUBLE_PRESS_MS,
  ResizeHandle,
  RESIZE_STEP,
  RESIZE_STEP_LARGE,
} from "../../src/components/layout/ResizeHandle";
import { LEFT_PANE_WIDTH as LIST_WIDTH } from "../../src/components/layout/paneWidth";

const KEY = "test.listWidth";
const PROPERTY = "--list-width";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** Renders of the list in the pane, and of the layout around it. */
let listRenders = 0;
const List = () => {
  listRenders += 1;
  return <p>Rows</p>;
};

/**
 * The handle inside the pane, on its edge, as the app places it: the width
 * must be drawn on the first commit, before the pane's own ref would exist.
 */
function Layout() {
  return (
    <div>
      <section data-testid="pane">
        <List />
        <ResizeHandle
          property={PROPERTY}
          storageKey={KEY}
          label="Resize the contact list"
          {...LIST_WIDTH}
        />
      </section>
      <input aria-label="Note" />
    </div>
  );
}

const separator = () =>
  screen.getByRole("separator", { name: "Resize the contact list" });
const drawn = () => screen.getByTestId("pane").style.getPropertyValue(PROPERTY);
const nextFrame = () =>
  act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
const holdStyle = () =>
  [...document.head.querySelectorAll("style")].find((style) =>
    style.textContent?.includes("col-resize"),
  );
const pointer = (clientX: number) => ({
  pointerId: 1,
  isPrimary: true,
  button: 0,
  clientX,
});

describe("ResizeHandle", () => {
  it("is a vertical separator with its width and bounds", () => {
    render(<Layout />);
    const edge = separator();
    expect(edge.getAttribute("aria-orientation")).toBe("vertical");
    expect(edge.getAttribute("aria-valuenow")).toBe("350");
    expect(edge.getAttribute("aria-valuemin")).toBe("300");
    expect(edge.getAttribute("aria-valuemax")).toBe("480");
    expect(edge.tabIndex).toBe(0);
    expect(drawn()).toBe("350px");
  });

  it("moves 16 px with an arrow, 64 with Shift, and to the bounds with Home and End", () => {
    render(<Layout />);
    const edge = separator();
    const press = (key: string, shiftKey = false) => {
      fireEvent.keyDown(edge, { key, shiftKey });
      return Number(edge.getAttribute("aria-valuenow"));
    };
    expect(press("ArrowRight")).toBe(350 + RESIZE_STEP);
    expect(press("ArrowLeft")).toBe(350);
    expect(press("ArrowRight", true)).toBe(350 + RESIZE_STEP_LARGE);
    expect(press("ArrowRight", true)).toBe(478);
    expect(press("ArrowRight")).toBe(480);
    expect(press("Home")).toBe(300);
    expect(press("ArrowLeft")).toBe(300);
    expect(press("End")).toBe(480);
    expect(drawn()).toBe("480px");
    expect(localStorage.getItem(KEY)).toBe("480");
  });

  it("claims only its own keys", () => {
    render(<Layout />);
    // Up and Down are the page's: they move through the contacts.
    expect(fireEvent.keyDown(separator(), { key: "ArrowDown" })).toBe(true);
    expect(fireEvent.keyDown(separator(), { key: "ArrowRight" })).toBe(false);
    // A shortcut with a modifier is not a resize.
    expect(
      fireEvent.keyDown(separator(), { key: "ArrowRight", metaKey: true }),
    ).toBe(true);
    expect(separator().getAttribute("aria-valuenow")).toBe("366");
  });

  it("restores the default width on a double click", () => {
    localStorage.setItem(KEY, "440");
    render(<Layout />);
    expect(drawn()).toBe("440px");
    fireEvent.doubleClick(separator());
    expect(drawn()).toBe("350px");
    expect(separator().getAttribute("aria-valuenow")).toBe("350");
    expect(localStorage.getItem(KEY)).toBe("350");
  });

  it("follows a drag with one write per frame, and renders nothing beside it", async () => {
    render(<Layout />);
    const edge = separator();
    const pane = screen.getByTestId("pane");
    const writes = vi.spyOn(pane.style, "setProperty");
    const rendersBefore = listRenders;

    // The press prevents its default: no text selection, no focus move.
    expect(fireEvent.pointerDown(edge, pointer(400))).toBe(false);
    fireEvent.pointerMove(edge, pointer(410));
    fireEvent.pointerMove(edge, pointer(420));
    fireEvent.pointerMove(edge, pointer(430));
    // Three moves in one frame: nothing drawn until the frame.
    expect(writes).not.toHaveBeenCalled();
    await nextFrame();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(drawn()).toBe("380px");
    expect(edge.getAttribute("aria-valuenow")).toBe("380");

    fireEvent.pointerMove(edge, pointer(470));
    await nextFrame();
    expect(writes).toHaveBeenCalledTimes(2);
    expect(drawn()).toBe("420px");
    // Nothing is kept until the drag ends.
    expect(localStorage.getItem(KEY)).toBeNull();

    fireEvent.pointerUp(edge, pointer(470));
    expect(drawn()).toBe("420px");
    expect(edge.getAttribute("aria-valuenow")).toBe("420");
    expect(localStorage.getItem(KEY)).toBe("420");
    // The list and the layout around it never rendered again.
    expect(listRenders).toBe(rendersBefore);
  });

  it("holds the drag inside the bounds", async () => {
    render(<Layout />);
    const edge = separator();
    fireEvent.pointerDown(edge, pointer(400));
    fireEvent.pointerMove(edge, pointer(900));
    await nextFrame();
    expect(drawn()).toBe("480px");
    fireEvent.pointerMove(edge, pointer(0));
    await nextFrame();
    expect(drawn()).toBe("300px");
    fireEvent.pointerUp(edge, pointer(0));
    expect(localStorage.getItem(KEY)).toBe("300");
  });

  it("swaps the default for the widest width on a press that does not move, and back", () => {
    // The way to resize with one pointer and no drag (WCAG 2.5.7). The swap
    // waits for a second press, which would make it a double click.
    vi.useFakeTimers();
    try {
      render(<Layout />);
      const edge = separator();
      fireEvent.pointerDown(edge, pointer(400));
      fireEvent.pointerUp(edge, pointer(400));
      expect(drawn()).toBe("350px");
      act(() => vi.advanceTimersByTime(DOUBLE_PRESS_MS));
      expect(drawn()).toBe(`${LIST_WIDTH.max}px`);
      expect(localStorage.getItem(KEY)).toBe(String(LIST_WIDTH.max));

      fireEvent.pointerDown(edge, pointer(400));
      fireEvent.pointerUp(edge, pointer(400));
      act(() => vi.advanceTimersByTime(DOUBLE_PRESS_MS));
      expect(drawn()).toBe("350px");
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores the default on a double click, with no swap after it", () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(KEY, "440");
      render(<Layout />);
      const edge = separator();
      fireEvent.pointerDown(edge, pointer(400));
      fireEvent.pointerUp(edge, pointer(400));
      fireEvent.pointerDown(edge, pointer(400));
      fireEvent.pointerUp(edge, pointer(400));
      fireEvent.doubleClick(edge);
      expect(drawn()).toBe("350px");
      act(() => vi.advanceTimersByTime(DOUBLE_PRESS_MS * 2));
      expect(drawn()).toBe("350px");
    } finally {
      vi.useRealTimers();
    }
  });

  it("changes nothing for a press the browser cancels", () => {
    render(<Layout />);
    const edge = separator();
    fireEvent.pointerDown(edge, pointer(400));
    fireEvent.pointerCancel(edge, pointer(400));
    expect(drawn()).toBe("350px");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("holds the resize cursor and stops text selection only while it drags", () => {
    const { unmount } = render(<Layout />);
    const edge = separator();
    expect(holdStyle()).toBeUndefined();
    fireEvent.pointerDown(edge, pointer(400));
    expect(holdStyle()?.textContent).toContain("user-select:none");
    expect(edge.hasAttribute("data-dragging")).toBe(true);
    fireEvent.pointerUp(edge, pointer(400));
    expect(holdStyle()).toBeUndefined();
    expect(edge.hasAttribute("data-dragging")).toBe(false);

    // A drag cut short by an unmount lets go of the page too.
    fireEvent.pointerDown(edge, pointer(400));
    expect(holdStyle()).toBeDefined();
    unmount();
    expect(holdStyle()).toBeUndefined();
  });

  it("ends the drag when the pointer is cancelled or the capture is lost", () => {
    render(<Layout />);
    const edge = separator();
    fireEvent.pointerDown(edge, pointer(400));
    fireEvent.pointerCancel(edge, pointer(400));
    expect(holdStyle()).toBeUndefined();
    fireEvent.pointerDown(edge, pointer(400));
    fireEvent.lostPointerCapture(edge, pointer(400));
    expect(holdStyle()).toBeUndefined();
    expect(edge.hasAttribute("data-dragging")).toBe(false);
  });

  it("leaves focus where it was", () => {
    render(<Layout />);
    const note = screen.getByRole("textbox", { name: "Note" });
    note.focus();
    fireEvent.pointerDown(separator(), pointer(400));
    fireEvent.pointerUp(separator(), pointer(420));
    expect(document.activeElement).toBe(note);
  });
});
