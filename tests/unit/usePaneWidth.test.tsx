// @vitest-environment jsdom
/**
 * usePaneWidth: the Network list's width, kept per device.
 *
 * The width is a custom property on the pane, drawn before the first paint.
 * It comes from `localStorage` when a usable value is there, held inside the
 * bounds, and falls back to the default when storage is empty, holds
 * nonsense, or throws. A narrow window holds the pane in so the content
 * beside it keeps its room, and a wider window gives the stored width back.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { usePaneWidth } from "../../src/hooks/usePaneWidth";
import { LIST_WIDTH } from "../../src/views/contact-list/listWidth";

const KEY = "test.listWidth";
const PROPERTY = "--list-width";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.innerHTML = "";
});

/** A pane in a row, the way App lays out the list beside the contact. */
function mount() {
  const row = document.createElement("div");
  const pane = document.createElement("section");
  row.appendChild(pane);
  document.body.appendChild(row);
  const paneRef = { current: pane };
  const hook = renderHook(() =>
    usePaneWidth({
      paneRef,
      property: PROPERTY,
      storageKey: KEY,
      ...LIST_WIDTH,
    }),
  );
  const drawn = () => pane.style.getPropertyValue(PROPERTY);
  return { row, pane, hook, drawn };
}

describe("usePaneWidth", () => {
  it("draws the default width on the pane before the first paint", () => {
    const { hook, drawn } = mount();
    expect(hook.result.current.width).toBe(350);
    expect(hook.result.current.limit).toBe(480);
    expect(drawn()).toBe("350px");
  });

  it("reads this device's width and holds it inside 300 to 480", () => {
    for (const [stored, width] of [
      ["420", 420],
      ["9999", 480],
      ["12", 300],
      ["361.6", 362],
    ] as const) {
      localStorage.setItem(KEY, stored);
      const { hook, drawn } = mount();
      expect(hook.result.current.width, stored).toBe(width);
      expect(drawn(), stored).toBe(`${width}px`);
      cleanup();
    }
  });

  it("falls back to 350 when the stored value is nonsense", () => {
    for (const stored of ["wide", "", "NaN", "Infinity"]) {
      localStorage.setItem(KEY, stored);
      const { hook } = mount();
      expect(hook.result.current.width, JSON.stringify(stored)).toBe(350);
      cleanup();
    }
  });

  it("falls back to 350 when storage throws on a read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    const { hook, drawn } = mount();
    expect(hook.result.current.width).toBe(350);
    expect(drawn()).toBe("350px");
  });

  it("keeps a committed width on this device, and only draws a preview", () => {
    const { hook, drawn } = mount();
    act(() => void hook.result.current.preview(400));
    expect(drawn()).toBe("400px");
    expect(hook.result.current.width).toBe(350);
    expect(localStorage.getItem(KEY)).toBeNull();

    act(() => void hook.result.current.commit(410));
    expect(drawn()).toBe("410px");
    expect(hook.result.current.width).toBe(410);
    expect(localStorage.getItem(KEY)).toBe("410");

    let drawnWidth = 0;
    act(() => {
      drawnWidth = hook.result.current.commit(9999);
    });
    expect(drawnWidth).toBe(480);
    expect(localStorage.getItem(KEY)).toBe("480");
  });

  it("keeps working when storage refuses a write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    const { hook, drawn } = mount();
    act(() => void hook.result.current.commit(420));
    expect(hook.result.current.width).toBe(420);
    expect(drawn()).toBe("420px");
  });

  it("leaves the contact 560 px, and gives the stored width back on a wider window", () => {
    // The row ends at the window's right edge, and the pane starts after
    // the 64 px sidebar.
    let windowWidth = 1024;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const box = (left: number, right: number) =>
          ({ left, right, width: right - left }) as DOMRect;
        return this.tagName === "SECTION"
          ? box(64, 64 + 350)
          : box(0, windowWidth);
      },
    );
    localStorage.setItem(KEY, "480");
    const { hook, drawn } = mount();
    // 1024 - 64 - 560 = 400.
    expect(hook.result.current.limit).toBe(400);
    expect(hook.result.current.width).toBe(400);
    expect(drawn()).toBe("400px");

    windowWidth = 1440;
    act(() => void window.dispatchEvent(new Event("resize")));
    expect(hook.result.current.limit).toBe(480);
    expect(hook.result.current.width).toBe(480);
    expect(drawn()).toBe("480px");
    // The window held the pane in; it never rewrote the choice.
    expect(localStorage.getItem(KEY)).toBe("480");
  });

  it("stops listening for window resizes on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { hook } = mount();
    hook.unmount();
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
