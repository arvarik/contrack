// @vitest-environment jsdom
import React from "react";
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
import { useClickOutside } from "../../../../src/hooks/useClickOutside";
import { useLongPress } from "../../../../src/hooks/useLongPress";
import { usePullToRefresh } from "../../../../src/hooks/usePullToRefresh";
import { useScrollRestoration } from "../../../../src/hooks/useScrollRestoration";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
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
  type Touches = { clientX: number; clientY: number }[];
  it.each<[string, Touches, Touches[]]>([
    [
      "during scrolling",
      [{ clientX: 0, clientY: 0 }],
      [[{ clientX: 0, clientY: 30 }]],
    ],
    [
      "that starts with two fingers",
      [
        { clientX: 0, clientY: 0 },
        { clientX: 40, clientY: 0 },
      ],
      [],
    ],
    [
      "when a second finger lands",
      [{ clientX: 0, clientY: 0 }],
      // The first finger stays still, so only the count can cancel it.
      [
        [
          { clientX: 0, clientY: 0 },
          { clientX: 40, clientY: 0 },
        ],
      ],
    ],
  ])("cancels a long press %s", (_case, start, moves) => {
    vi.useFakeTimers();
    const press = vi.fn();
    const { result } = renderHook(() => useLongPress(press));
    act(() => {
      result.current.onTouchStart({
        touches: start,
      } as unknown as React.TouchEvent);
      for (const touches of moves) {
        result.current.onTouchMove({
          touches,
        } as unknown as React.TouchEvent);
      }
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
});
