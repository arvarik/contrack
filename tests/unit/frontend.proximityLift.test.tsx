// @vitest-environment jsdom
/**
 * The Network list's proximity lift: the row under a mouse rises, and the
 * neighbour on the pointer's side rises as the pointer nears it. The lift is
 * written to `--p` on at most two rows, a frame after the move, and nothing
 * renders.
 */
import React, { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  liftAt,
  PROXIMITY_ROW_ATTR,
  useProximityLift,
} from "../../src/hooks/useProximityLift";

describe("liftAt", () => {
  it("is 1 at a row's centre, half on the line between rows and 0 a row away", () => {
    expect(liftAt(0)).toBe(1);
    expect(liftAt(0.5)).toBeCloseTo(0.5);
    expect(liftAt(1)).toBe(0);
    expect(liftAt(1.7)).toBe(0);
  });

  it("hands the lift from one row to the next without losing any", () => {
    // The two rows' lifts always add up to one whole lift, so the rise
    // moves between rows rather than dipping or doubling on the way.
    for (const d of [0, 0.1, 0.25, 0.5, 0.8, 1]) {
      expect(liftAt(d) + liftAt(1 - d)).toBeCloseTo(1);
    }
  });
});

/** Three 56 px rows, 8 px apart, from y 0. */
const ROW = 56;
const GAP = 8;

let renders = 0;
const List = () => {
  renders += 1;
  const ref = useRef<HTMLDivElement>(null);
  useProximityLift(ref);
  return (
    <div ref={ref} data-testid="list">
      {[0, 1, 2].map((i) => (
        <a key={i} href="#" {...{ [PROXIMITY_ROW_ATTR]: "" }}>
          Row {i}
        </a>
      ))}
    </div>
  );
};

const rows = () => screen.getAllByRole("link");
const lifts = () => rows().map((row) => row.style.getPropertyValue("--p"));

function pointer(type: string, clientY: number, pointerType = "mouse") {
  const event = new MouseEvent(type, { clientX: 10, clientY, bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
}

const nextFrame = () =>
  act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );

beforeEach(() => {
  renders = 0;
  render(<List />);
  rows().forEach((row, i) => {
    const top = i * (ROW + GAP);
    row.getBoundingClientRect = () =>
      ({ top, bottom: top + ROW, height: ROW, left: 0, right: 300 }) as DOMRect;
  });
  // The hit test: the row whose box holds the point, or the list in a gap.
  document.elementFromPoint = (_x: number, y: number) =>
    rows().find((row, i) => {
      const top = i * (ROW + GAP);
      return y >= top && y < top + ROW;
    }) ?? screen.getByTestId("list");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useProximityLift", () => {
  it("lifts the row under the mouse and none beside it at its centre", async () => {
    screen.getByTestId("list").dispatchEvent(pointer("pointermove", 28));
    // Nothing happens until the frame.
    expect(lifts()).toEqual(["", "", ""]);
    await nextFrame();
    expect(lifts()).toEqual(["1.000", "0.000", ""]);
  });

  it("starts to lift the row below in the lower half, and the row above in the upper half", async () => {
    const list = screen.getByTestId("list");
    list.dispatchEvent(pointer("pointermove", 64 + 50));
    await nextFrame();
    const [, middleLow, belowLow] = lifts().map(Number);
    expect(middleLow).toBeGreaterThan(0.5);
    expect(belowLow).toBeGreaterThan(0);
    expect(lifts()[0]).toBe("");

    list.dispatchEvent(pointer("pointermove", 64 + 6));
    await nextFrame();
    const [aboveHigh, middleHigh] = lifts().map(Number);
    expect(aboveHigh).toBeGreaterThan(0);
    expect(middleHigh).toBeGreaterThan(0.5);
    expect(lifts()[2]).toBe("");
  });

  it("shares the lift evenly across the gap between two rows", async () => {
    // The gap between row 0 and row 1 is y 56 to 64, and its middle is the
    // midpoint between their centres.
    screen.getByTestId("list").dispatchEvent(pointer("pointermove", 28));
    await nextFrame();
    screen.getByTestId("list").dispatchEvent(pointer("pointermove", 60));
    await nextFrame();
    const [first, second] = lifts().map(Number);
    expect(first).toBeCloseTo(0.5, 1);
    expect(second).toBeCloseTo(0.5, 1);
  });

  it("lays the rows down when the pointer leaves or a key is pressed", async () => {
    const list = screen.getByTestId("list");
    list.dispatchEvent(pointer("pointermove", 28));
    await nextFrame();
    list.dispatchEvent(pointer("pointerleave", 28));
    await nextFrame();
    expect(lifts()).toEqual(["", "", ""]);

    list.dispatchEvent(pointer("pointermove", 28));
    await nextFrame();
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(lifts()).toEqual(["", "", ""]);
  });

  it("ignores a touch, and never renders the list again", async () => {
    const list = screen.getByTestId("list");
    const before = renders;
    list.dispatchEvent(pointer("pointermove", 28, "touch"));
    await nextFrame();
    expect(lifts()).toEqual(["", "", ""]);
    list.dispatchEvent(pointer("pointermove", 28));
    await nextFrame();
    list.dispatchEvent(pointer("pointermove", 90));
    await nextFrame();
    expect(renders).toBe(before);
  });
});
