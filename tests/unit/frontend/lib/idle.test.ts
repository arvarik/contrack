/**
 * A task for an idle moment.
 *
 * The browser's idle callback when there is one, a timer when there is not,
 * nothing at all when the browser saves data, and a cancel that works on
 * either path. A task waits while an API request is on its way. And whether
 * the line is fast enough to warm pages on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  noteRequest,
  onFastConnection,
  whenIdle,
} from "../../../../src/lib/idle";

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

    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 10_000,
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

  it("waits while an API request is on its way, for 10 s at most", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal("navigator", {});
    let finish = () => {};
    const request = noteRequest(new Promise<void>((r) => (finish = r)));
    const task = vi.fn();

    whenIdle(task);
    vi.advanceTimersByTime(5_000);
    expect(task).not.toHaveBeenCalled();
    finish();
    await request;
    await vi.advanceTimersByTimeAsync(250);
    expect(task).toHaveBeenCalledOnce();

    // A request that does not end holds a task 10 s, then the task runs.
    let end = () => {};
    const stream = noteRequest(new Promise<void>((r) => (end = r)));
    const late = vi.fn();
    whenIdle(late);
    vi.advanceTimersByTime(9_000);
    expect(late).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4_000);
    expect(late).toHaveBeenCalledOnce();
    end();
    await stream;
  });

  it("does nothing for a browser told to save data", () => {
    const requestIdleCallback = vi.fn();
    vi.stubGlobal("window", { requestIdleCallback });
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    const task = vi.fn();

    whenIdle(task)();
    expect(requestIdleCallback).not.toHaveBeenCalled();
    expect(task).not.toHaveBeenCalled();
  });
});

describe("onFastConnection", () => {
  // The idle warm-up of the lazy pages runs only on a fast line.
  it.each([
    ["4g", { effectiveType: "4g" }, true],
    ["3g", { effectiveType: "3g" }, false],
    ["4g that saves data", { effectiveType: "4g", saveData: true }, false],
  ])("answers %s", (_name, connection, fast) => {
    vi.stubGlobal("navigator", { connection });
    expect(onFastConnection()).toBe(fast);
  });

  it.each([
    ["a desktop", true],
    ["a phone", false],
  ])("answers %s that cannot say by its pointer", (_name, mouse) => {
    vi.stubGlobal("navigator", { connection: undefined });
    vi.stubGlobal("matchMedia", () => ({ matches: mouse }));
    expect(onFastConnection()).toBe(mouse);
  });
});
