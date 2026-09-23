// @vitest-environment jsdom
// =============================================================================
// The slides of the Pulse grid
// =============================================================================
// `createFlip` measures the cards before a change and slides each one that
// moved from its old place to its new one, on the Web Animations API, with
// `transform` alone. jsdom lays nothing out and animates nothing, so the
// boxes and `animate` are stand-ins here.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EASE_CSS,
  createFlip,
  prefersReducedMotion,
} from "../../src/views/pulse/lib/flip";
import { DURATION, EASE } from "../../src/lib/motion";

/** A root with one element per id, each with a box that the test moves. */
function grid(ids: string[]) {
  const root = document.createElement("div");
  const boxes = new Map<string, { left: number; top: number }>();
  const animate = vi.fn(() => ({ id: "" }) as unknown as Animation);
  const running = new Map<string, { id: string; cancel: () => void }[]>();
  for (const id of ids) {
    const node = document.createElement("div");
    node.setAttribute("data-flip-id", id);
    boxes.set(id, { left: 0, top: 0 });
    node.getBoundingClientRect = () => {
      const { left, top } = boxes.get(id)!;
      return { left, top, width: 100, height: 50 } as DOMRect;
    };
    node.animate = animate as unknown as Element["animate"];
    node.getAnimations = () =>
      (running.get(id) ?? []) as unknown as Animation[];
    root.appendChild(node);
  }
  return { root, boxes, animate, running };
}

afterEach(() => {
  delete document.documentElement.dataset.motion;
  vi.unstubAllGlobals();
});

describe("createFlip", () => {
  it("slides a card that moved from its old place, and leaves a card that did not", () => {
    const { root, boxes, animate } = grid(["a", "b"]);
    const flip = createFlip(() => root);
    boxes.set("a", { left: 0, top: 0 });
    boxes.set("b", { left: 0, top: 100 });
    flip.capture();
    // The change: b rises by 88 px, a stays.
    boxes.set("b", { left: 0, top: 12 });
    flip.play();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith(
      [{ transform: "translate(0px, 88px)" }, { transform: "none" }],
      { duration: DURATION.slow * 1000, easing: EASE_CSS },
    );
  });

  it("does nothing without a capture before the change", () => {
    const { root, boxes, animate } = grid(["a"]);
    const flip = createFlip(() => root);
    boxes.set("a", { left: 40, top: 40 });
    flip.play();
    expect(animate).not.toHaveBeenCalled();
  });

  it("stops a slide still running before it measures the new place", () => {
    const { root, boxes, running } = grid(["a"]);
    const cancel = vi.fn();
    const other = vi.fn();
    running.set("a", [
      { id: "pulse-flip", cancel },
      { id: "not-ours", cancel: other },
    ]);
    const flip = createFlip(() => root);
    flip.capture();
    boxes.set("a", { left: 0, top: 30 });
    flip.play();
    expect(cancel).toHaveBeenCalledTimes(1);
    // An animation the grid did not start is left alone.
    expect(other).not.toHaveBeenCalled();
  });

  it("slides nothing under reduced motion", () => {
    document.documentElement.dataset.motion = "reduced";
    const { root, boxes, animate } = grid(["a"]);
    const flip = createFlip(() => root);
    flip.capture();
    boxes.set("a", { left: 0, top: 200 });
    flip.play();
    expect(animate).not.toHaveBeenCalled();
  });
});

describe("prefersReducedMotion", () => {
  it("reads the Motion row in Settings and the operating system", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
    }));
    expect(prefersReducedMotion()).toBe(false);
    document.documentElement.dataset.motion = "reduced";
    expect(prefersReducedMotion()).toBe(true);
    delete document.documentElement.dataset.motion;
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
    }));
    expect(prefersReducedMotion()).toBe(true);
  });

  it("spells the app's curve for CSS", () => {
    expect(EASE_CSS).toBe(`cubic-bezier(${EASE.join(", ")})`);
  });
});
