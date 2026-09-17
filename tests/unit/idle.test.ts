/**
 * A task for an idle moment.
 *
 * The browser's idle callback when there is one, a timer when there is not,
 * nothing at all when the browser saves data, and a cancel that works on
 * either path.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDLE_TIMEOUT_MS, savesData, whenIdle } from "../../src/lib/idle";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("whenIdle", () => {
  it("asks the browser for an idle moment, with a deadline", () => {
    const requestIdleCallback = vi.fn(() => 7);
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("window", { requestIdleCallback, cancelIdleCallback });
    vi.stubGlobal("navigator", {});
    const task = vi.fn();

    const cancel = whenIdle(task);

    expect(requestIdleCallback).toHaveBeenCalledWith(task, {
      timeout: IDLE_TIMEOUT_MS,
    });
    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it("falls back to a timer where there is no idle callback", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal("navigator", {});
    const task = vi.fn();

    whenIdle(task);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(task).toHaveBeenCalledOnce();

    const later = vi.fn();
    const cancel = whenIdle(later);
    cancel();
    vi.advanceTimersByTime(5_000);
    expect(later).not.toHaveBeenCalled();
  });

  it("does nothing for a browser told to save data", () => {
    const requestIdleCallback = vi.fn();
    vi.stubGlobal("window", { requestIdleCallback });
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    const task = vi.fn();

    expect(savesData()).toBe(true);
    whenIdle(task)();
    expect(requestIdleCallback).not.toHaveBeenCalled();
    expect(task).not.toHaveBeenCalled();
  });
});
