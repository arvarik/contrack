// @vitest-environment jsdom
import { usePullToRefresh } from "../../src/hooks/usePullToRefresh";
import React, { useState, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { Modal } from "../../src/components/ui/Modal";
import { EditableField } from "../../src/views/contact-detail/components/EditableField";
import { useLongPress } from "../../src/hooks/useLongPress";
import { useScrollRestoration } from "../../src/hooks/useScrollRestoration";
import { useClickOutside } from "../../src/hooks/useClickOutside";
import { MemoryRouter } from "react-router-dom";
import { useContactListFilters } from "../../src/views/contact-list/hooks/useContactListFilters";
import type { Contact } from "../../src/types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("dialog interaction", () => {
  function Nested() {
    const [outer, setOuter] = useState(false);
    const [inner, setInner] = useState(false);
    return (
      <>
        <button onClick={() => setOuter(true)}>Open parent</button>
        <Modal isOpen={outer} onClose={() => setOuter(false)} title="Parent">
          <button onClick={() => setInner(true)}>Open child</button>
          <Modal isOpen={inner} onClose={() => setInner(false)} title="Child">
            <input aria-label="Child input" />
          </Modal>
        </Modal>
      </>
    );
  }
  it("closes only the top dialog and restores focus without unlocking its parent", async () => {
    render(
      <StrictMode>
        <Nested />
      </StrictMode>,
    );
    screen.getByText("Open parent").focus();
    fireEvent.click(screen.getByText("Open parent"));
    screen.getByText("Open child").focus();
    fireEvent.click(screen.getByText("Open child"));
    expect(screen.getByRole("dialog").textContent).toContain("Child");
    expect(document.body.style.pointerEvents).toBe("none");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.getByRole("dialog").textContent).toContain("Parent"),
    );
    expect(document.body.style.pointerEvents).toBe("none");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByText("Open child")),
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.body.style.pointerEvents).toBe(""));
    expect(document.activeElement).toBe(screen.getByText("Open parent"));
  });
  it("contains Tab and Shift+Tab and gives headless dialogs a name", () => {
    render(
      <Modal isOpen onClose={() => {}} ariaLabel="Contact details">
        <input aria-label="Last input" />
      </Modal>,
    );
    expect(
      screen.getByRole("dialog", { name: "Contact details" }),
    ).toBeTruthy();
    const first = screen.getByRole("button", { name: "Close dialog" });
    const last = screen.getByLabelText("Last input");
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});

describe("inline edits", () => {
  it("does not save after Escape or during text composition", () => {
    const save = vi.fn();
    render(<EditableField value="Saved" onSave={save} placeholder="Name" />);
    fireEvent.click(screen.getByText("Saved"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Draft" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(save).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText("Saved")).toBeTruthy();
  });
  it("retains a failed draft and confirms only a completed save", async () => {
    let resolve!: (result: boolean) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce(true);
    render(<EditableField value="Saved" onSave={save} placeholder="Name" />);
    fireEvent.click(screen.getByText("Saved"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Draft" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    fireEvent.blur(screen.getByRole("textbox"));
    expect(save).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Saved")).toBeNull();
    await act(async () => resolve(false));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "Draft",
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(screen.getByLabelText("Saved")).toBeTruthy());
  });
});

describe("scroll and touch", () => {
  function Scroller({
    ready = true,
    id = "test",
  }: {
    ready?: boolean;
    id?: string;
  }) {
    const ref = useScrollRestoration(id, ready);
    return <div data-testid="scroller" ref={ref} />;
  }
  it("waits for data before restoring and separates scroll positions by view", () => {
    sessionStorage.setItem("contrack_scroll_test", "400");
    const { rerender } = render(<Scroller ready={false} />);
    const el = screen.getByTestId("scroller");
    expect(el.scrollTop).toBe(0);
    rerender(<Scroller />);
    expect(el.scrollTop).toBe(400);
    rerender(<Scroller id="filtered" />);
    expect(el.scrollTop).toBe(0);
    expect(sessionStorage.getItem("contrack_scroll_test")).toBe("400");
  });
  it("works when browser storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { unmount } = render(<Scroller />);
    fireEvent.scroll(screen.getByTestId("scroller"));
    expect(() => unmount()).not.toThrow();
  });
  it("suppresses the click after a long press but preserves normal taps", () => {
    vi.useFakeTimers();
    const press = vi.fn();
    const click = vi.fn();
    function Row() {
      const gesture = useLongPress(press);
      return (
        <div {...gesture}>
          <button onClick={click}>Row</button>
        </div>
      );
    }
    render(<Row />);
    const button = screen.getByText("Row");
    fireEvent.touchStart(button, { touches: [{ clientX: 1, clientY: 1 }] });
    act(() => vi.advanceTimersByTime(600));
    fireEvent.touchEnd(button);
    fireEvent.click(button);
    expect(press).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();
    fireEvent.touchStart(button, { touches: [{ clientX: 1, clientY: 1 }] });
    fireEvent.touchEnd(button);
    fireEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
  });
  it("cancels long presses during scrolling or multiple touches", () => {
    vi.useFakeTimers();
    const press = vi.fn();
    const { result } = renderHook(() => useLongPress(press));
    act(() => {
      result.current.onTouchStart({
        touches: [{ clientX: 0, clientY: 0 }],
      } as unknown as React.TouchEvent);
      result.current.onTouchMove({
        touches: [{ clientX: 0, clientY: 30 }],
      } as unknown as React.TouchEvent);
      vi.advanceTimersByTime(600);
    });
    expect(press).not.toHaveBeenCalled();
  });
  it("dismisses outside touch pointers", () => {
    const dismiss = vi.fn();
    function Menu() {
      const ref = React.useRef<HTMLDivElement>(null);
      useClickOutside(ref, dismiss);
      return <div ref={ref}>Menu</div>;
    }
    render(<Menu />);
    fireEvent.pointerDown(screen.getByText("Menu"));
    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    expect(dismiss).toHaveBeenCalledOnce();
  });
});

it("does not match empty phone values against every numeric query", () => {
  const contacts = [
    { id: "a", name: "Alice", phones: [{ phone: "" }] },
  ] as Contact[];
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={["/?q=555"]}>{children}</MemoryRouter>
  );
  const { result } = renderHook(() => useContactListFilters(contacts), {
    wrapper,
  });
  expect(result.current.filteredContacts).toEqual([]);
});

it("cancels a pull gesture and never overlaps refreshes", async () => {
  let resolve!: () => void;
  const refresh = vi.fn().mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  function Pull() {
    const { containerRef } = usePullToRefresh(refresh);
    return <div data-testid="pull" ref={containerRef} />;
  }
  render(<Pull />);
  const el = screen.getByTestId("pull");
  const pull = () => {
    fireEvent.touchStart(el, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(el, { touches: [{ clientY: 200 }] });
  };
  pull();
  fireEvent.touchCancel(el);
  fireEvent.touchEnd(el);
  await act(async () => {});
  expect(refresh).not.toHaveBeenCalled();
  pull();
  fireEvent.touchEnd(el);
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  pull();
  fireEvent.touchEnd(el);
  expect(refresh).toHaveBeenCalledOnce();
  await act(async () => resolve());
});
