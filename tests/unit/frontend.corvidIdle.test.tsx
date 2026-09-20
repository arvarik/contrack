// @vitest-environment jsdom
/**
 * The corvid's idle.
 *
 * Fake timers, because the whole behaviour is timing: how long the bird waits
 * between beats, how long a beat lasts, and the three cases where it must not
 * schedule a beat at all. `Math.random` is stubbed so "one in five is a tilt"
 * is a decision this test makes rather than a coin it flips.
 */
import React, { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import {
  BLINK_CLASS,
  BLINK_MS,
  IDLE_MAX_MS,
  IDLE_MIN_MS,
  IDLE_MIN_SIZE,
  TILT_CLASS,
  TILT_MS,
  playCorvidBeat,
  useCorvidIdle,
} from "../../src/hooks/useCorvidIdle";

/** A bare host for the hook: one svg, whatever options the test passes. */
const Idler = ({ enabled, size }: { enabled: boolean; size: number }) => {
  const ref = useRef<SVGSVGElement>(null);
  useCorvidIdle(ref, { enabled, size });
  return <svg ref={ref} data-testid="mark" />;
};

const mark = () => document.querySelector("[data-testid='mark']")!;

/**
 * The wait the hook picks for a given `Math.random`, and a way to sit through
 * exactly one of them. Advancing by the longest possible wait would run the
 * beat and its end timer in the same call, so the class would be on and off
 * again before the assertion looked.
 */
const waitFor = (random: number) =>
  IDLE_MIN_MS + random * (IDLE_MAX_MS - IDLE_MIN_MS);

const throughWait = (random = 0.5) => {
  act(() => {
    vi.advanceTimersByTime(waitFor(random));
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  // The midpoint of the wait, and never a tilt, unless a test says otherwise.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useCorvidIdle", () => {
  it("blinks once the wait is up, and stops blinking when it ends", () => {
    render(<Idler enabled size={32} />);
    expect(mark().classList.contains(BLINK_CLASS)).toBe(false);

    throughWait();
    expect(mark().classList.contains(BLINK_CLASS)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(BLINK_MS);
    });
    expect(mark().classList.contains(BLINK_CLASS)).toBe(false);
  });

  it("waits at least four seconds before the first blink", () => {
    render(<Idler enabled size={32} />);
    act(() => {
      vi.advanceTimersByTime(IDLE_MIN_MS - 1);
    });
    expect(mark().classList.contains(BLINK_CLASS)).toBe(false);
  });

  it("blinks again after the next wait", () => {
    render(<Idler enabled size={32} />);
    throughWait();
    act(() => {
      vi.advanceTimersByTime(BLINK_MS);
    });
    expect(mark().classList.contains(BLINK_CLASS)).toBe(false);

    throughWait();
    expect(mark().classList.contains(BLINK_CLASS)).toBe(true);
  });

  it("tilts its head instead, about one beat in five", () => {
    // Below the one-in-five threshold, so this beat is the tilt.
    vi.spyOn(Math, "random").mockReturnValue(0.05);
    render(<Idler enabled size={32} />);

    throughWait(0.05);
    expect(mark().classList.contains(TILT_CLASS)).toBe(true);
    expect(mark().classList.contains(BLINK_CLASS)).toBe(false);

    act(() => {
      vi.advanceTimersByTime(TILT_MS);
    });
    expect(mark().classList.contains(TILT_CLASS)).toBe(false);
  });

  it("holds still while the tab is in the background", () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    render(<Idler enabled size={32} />);

    throughWait();
    expect(mark().classList.contains(BLINK_CLASS)).toBe(false);

    // The timer kept going round, so the bird blinks on the first beat after
    // the person comes back rather than waiting for a remount.
    hidden.mockReturnValue(false);
    throughWait();
    expect(mark().classList.contains(BLINK_CLASS)).toBe(true);
  });

  it("never schedules a beat for a mark under 24 px", () => {
    render(<Idler enabled size={IDLE_MIN_SIZE - 1} />);
    expect(vi.getTimerCount()).toBe(0);
    throughWait();
    expect(mark().classList.contains(BLINK_CLASS)).toBe(false);
  });

  it("never schedules a beat when it is switched off", () => {
    render(<Idler enabled={false} size={64} />);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer behind when the mark unmounts", () => {
    const { unmount } = render(<Idler enabled size={32} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("takes the class off a mark that unmounts mid-blink", () => {
    const { unmount } = render(<Idler enabled size={32} />);
    throughWait();
    const element = mark();
    expect(element.classList.contains(BLINK_CLASS)).toBe(true);
    unmount();
    expect(element.classList.contains(BLINK_CLASS)).toBe(false);
  });
});

describe("playCorvidBeat", () => {
  it("adds the class and takes it off when the beat is over", () => {
    const element = document.createElement("span");
    playCorvidBeat(element, "corvid-hop", 120);
    expect(element.classList.contains("corvid-hop")).toBe(true);
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(element.classList.contains("corvid-hop")).toBe(false);
  });

  it("can be cancelled, and does nothing without an element", () => {
    const element = document.createElement("span");
    const cancel = playCorvidBeat(element, "corvid-hop", 120);
    cancel();
    expect(element.classList.contains("corvid-hop")).toBe(false);
    expect(() => playCorvidBeat(null, "corvid-hop", 120)()).not.toThrow();
  });
});
