// @vitest-environment jsdom
/**
 * usePaneWidth: the Network list's width, kept per device.
 *
 * The width is a custom property on the pane, drawn before the first paint.
 * It comes from `localStorage` when a usable value is there, held inside the
 * bounds, and falls back to the default when storage is empty, holds
 * nonsense, or throws. A narrow window holds the pane in so the content
 * beside it keeps its room, and a wider window gives the stored width back.
 * The default width on an empty store is tested through ResizeHandle, the
 * hook's one caller, in resizeHandle.test.tsx.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { usePaneWidth } from "../../../../src/hooks/usePaneWidth";
import { LEFT_PANE_WIDTH as LIST_WIDTH } from "../../../../src/components/layout/paneWidth";

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

  it("stops listening for window resizes on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { hook } = mount();
    hook.unmount();
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
