// @vitest-environment jsdom
/**
 * Android's Back closes an open sheet or menu (`useCloseRequest`).
 *
 * A browser test cannot press Android's Back, so this drives a stand-in
 * `CloseWatcher` by hand: one is made while the overlay is open on a touch
 * screen, its close request calls `onClose`, and it goes when the overlay
 * closes. A mouse-and-keyboard screen makes none, because Escape already
 * closes every overlay there.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCloseRequest } from "../../../../src/hooks/useCloseRequest";

const watchers: { onclose: (() => void) | null; destroy: () => void }[] = [];

function stubPlatform(coarse: boolean) {
  vi.stubGlobal(
    "CloseWatcher",
    class {
      onclose: (() => void) | null = null;
      destroy = vi.fn();
      constructor() {
        watchers.push(this);
      }
    },
  );
  vi.stubGlobal("matchMedia", () => ({ matches: coarse }));
}

afterEach(() => {
  watchers.length = 0;
  vi.unstubAllGlobals();
});

describe("useCloseRequest", () => {
  it("closes on Back while open on a touch screen, and lets go when closed", () => {
    stubPlatform(true);
    const onClose = vi.fn();
    const { rerender } = renderHook(
      ({ open }) => useCloseRequest(open, onClose),
      { initialProps: { open: true } },
    );
    expect(watchers).toHaveLength(1);
    act(() => watchers[0].onclose?.());
    expect(onClose).toHaveBeenCalledOnce();
    // Still open (a dialog that is saving refused): a new watcher, so the
    // next Back closes it too and does not leave the page.
    expect(watchers).toHaveLength(2);
    rerender({ open: false });
    expect(watchers[1].destroy).toHaveBeenCalled();
  });

  it("makes no watcher with a mouse, where Escape already closes", () => {
    stubPlatform(false);
    renderHook(() => useCloseRequest(true, vi.fn()));
    expect(watchers).toHaveLength(0);
  });
});
