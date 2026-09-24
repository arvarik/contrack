// @vitest-environment jsdom
/**
 * A living mark, in a page.
 *
 * `corvid.brain.test.ts` measures what the bird decides. This measures the
 * wiring round it, which is where a mascot turns into a nuisance or a leak:
 *
 * - Only the app's own bird, `primary`, answers the whole app. Any other
 *   living mark answers only what is addressed to it or to its controls.
 * - A mark too small to live still answers, and then holds still with no
 *   timer left.
 * - While its bird is away flying, a perch does nothing at all, and it lives
 *   again when the bird is home.
 * - The app's own bird watches the pointer, falls asleep when nobody is
 *   there, and does something of its own when the app stirs it.
 * - It never repaints the ring, and every act ends in the logo.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { CorvidMark } from "../../src/components/brand/CorvidMark";
import {
  useCorvidControls,
  type CorvidControls,
} from "../../src/hooks/useCorvidLife";
import {
  CORVID_AWAY_EVENT,
  CORVID_HOME_EVENT,
  CORVID_STIR_EVENT,
  corvidReact,
  resetCorvidActivity,
} from "../../src/lib/corvid";
import { DOZE_AFTER } from "../../src/lib/corvidBrain";
import { CORVID_PATHS } from "../../src/assets/corvidPaths";
import type { MascotMotion, MotionPreference } from "../../src/api/preferences";

const preferences = {
  mascotMotion: "full" as MascotMotion,
  motion: "system" as MotionPreference,
};

vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ preferences }),
}));

const advance = (ms: number, step = 16) => {
  for (let t = 0; t < ms; t += step) {
    act(() => {
      vi.advanceTimersByTime(Math.min(step, ms - t));
    });
  }
};

const d = (root: Element | null, part: string) =>
  root!.querySelector(`[data-part="${part}"]`)!.getAttribute("d");
const moved = (root: Element | null) =>
  d(root, "head") !== CORVID_PATHS.head ||
  d(root, "chest") !== CORVID_PATHS.chest;
const eyeRy = (root: Element | null) =>
  Number(root!.querySelector('[data-part="eye"]')!.getAttribute("ry"));

beforeEach(() => {
  vi.useFakeTimers();
  preferences.mascotMotion = "full";
  preferences.motion = "system";
  resetCorvidActivity();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("who answers", () => {
  it("is the app's own bird for a reaction nobody addressed", () => {
    render(
      <>
        <span data-testid="own">
          <CorvidMark size={40} alive primary />
        </span>
        <span data-testid="other">
          <CorvidMark size={40} alive />
        </span>
      </>,
    );
    act(() => corvidReact("hop"));
    advance(150);
    expect(moved(screen.getByTestId("own"))).toBe(true);
    expect(moved(screen.getByTestId("other"))).toBe(false);
  });

  it("is only the perch a reaction was addressed to", () => {
    render(
      <>
        <span data-testid="own">
          <CorvidMark size={40} alive primary />
        </span>
        <span data-testid="other">
          <CorvidMark size={40} alive />
        </span>
      </>,
    );
    act(() => corvidReact("hop", screen.getByTestId("other")));
    advance(150);
    expect(moved(screen.getByTestId("other"))).toBe(true);
    expect(moved(screen.getByTestId("own"))).toBe(false);
  });

  it("is the mark its controls belong to", () => {
    let controls: CorvidControls | null = null;
    const Owner = () => {
      controls = useCorvidControls();
      return (
        <span data-testid="owned">
          <CorvidMark size={40} alive controls={controls} />
        </span>
      );
    };
    render(<Owner />);
    act(() => controls!.react("caw"));
    advance(120);
    expect(moved(screen.getByTestId("owned"))).toBe(true);
  });
});

describe("a mark too small to live", () => {
  it("answers a reaction addressed to it, then holds still with nothing running", () => {
    render(
      <span data-testid="phone">
        <CorvidMark size={20} alive />
      </span>,
    );
    expect(vi.getTimerCount()).toBe(0);
    act(() => corvidReact("flutter", screen.getByTestId("phone")));
    advance(250);
    expect(moved(screen.getByTestId("phone"))).toBe(true);
    advance(2_000);
    expect(moved(screen.getByTestId("phone"))).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("away and home", () => {
  it("does nothing while its bird is away, and lives again when it is back", () => {
    render(
      <span data-testid="perch">
        <CorvidMark size={40} alive primary />
      </span>,
    );
    const perch = screen.getByTestId("perch");
    advance(100);
    act(() => {
      window.dispatchEvent(
        new CustomEvent(CORVID_AWAY_EVENT, { detail: { perch } }),
      );
    });
    expect(vi.getTimerCount()).toBe(0);
    act(() => corvidReact("hop"));
    advance(150);
    expect(moved(perch)).toBe(false);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(CORVID_HOME_EVENT, { detail: { perch } }),
      );
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it("ignores another perch's comings and goings", () => {
    render(
      <span data-testid="perch">
        <CorvidMark size={40} alive primary />
      </span>,
    );
    const elsewhere = document.createElement("span");
    act(() => {
      window.dispatchEvent(
        new CustomEvent(CORVID_AWAY_EVENT, { detail: { perch: elsewhere } }),
      );
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });
});

describe("the app's own bird", () => {
  it("turns its head to a pointer that comes near", () => {
    render(
      <span data-testid="perch">
        <CorvidMark size={40} alive primary />
      </span>,
    );
    const svg = screen.getByTestId("perch").querySelector("svg")!;
    svg.getBoundingClientRect = () =>
      ({
        left: 16,
        top: 12,
        width: 40,
        height: 40,
        right: 56,
        bottom: 52,
        x: 16,
        y: 12,
      }) as DOMRect;
    advance(600);
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 160, clientY: -60 }),
      );
    });
    advance(200);
    expect(d(screen.getByTestId("perch"), "head")).not.toBe(CORVID_PATHS.head);
  });

  it("falls asleep when nobody is there, and wakes when somebody is", () => {
    render(
      <span data-testid="perch">
        <CorvidMark size={40} alive primary />
      </span>,
    );
    // A big act that was due first plays out before the bird nods off.
    advance(DOZE_AFTER + 8_000, 250);
    expect(eyeRy(screen.getByTestId("perch"))).toBeLessThan(0.5);
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerdown"));
    });
    advance(1_200);
    expect(eyeRy(screen.getByTestId("perch"))).toBeGreaterThan(2);
  });

  it("does something of its own when the app stirs it", () => {
    render(
      <span data-testid="perch">
        <CorvidMark size={40} alive primary />
      </span>,
    );
    advance(500);
    act(() => {
      window.dispatchEvent(new CustomEvent(CORVID_STIR_EVENT));
    });
    advance(200);
    expect(moved(screen.getByTestId("perch"))).toBe(true);
  });

  it("never repaints the ring, and ends every act in the logo", () => {
    render(
      <span data-testid="perch">
        <CorvidMark size={40} alive primary />
      </span>,
    );
    const perch = screen.getByTestId("perch");
    for (const reaction of [
      "preen",
      "ruffle",
      "stretch",
      "caw",
      "lookBack",
    ] as const) {
      act(() => corvidReact(reaction));
      advance(100);
      expect(moved(perch)).toBe(true);
      // Back to the logo's own paths, not the rig's copy of them, soon after.
      let home = false;
      for (let t = 0; t < 20_000 && !home; t += 32) {
        advance(32, 32);
        expect(d(perch, "ring")).toBe(CORVID_PATHS.ring);
        home = !moved(perch);
      }
      expect(home, reaction).toBe(true);
    }
  });
});

describe("motion off", () => {
  it("starts nothing and answers nothing", () => {
    preferences.mascotMotion = "off";
    render(
      <span data-testid="perch">
        <CorvidMark size={40} alive primary />
      </span>,
    );
    expect(vi.getTimerCount()).toBe(0);
    act(() => corvidReact("hop"));
    advance(150);
    expect(moved(screen.getByTestId("perch"))).toBe(false);
  });

  it("stops a living bird the moment reduced motion is asked for", () => {
    const { rerender } = render(
      <span data-testid="perch">
        <CorvidMark size={40} alive primary />
      </span>,
    );
    act(() => corvidReact("preen"));
    advance(200);
    preferences.motion = "reduced";
    rerender(
      <span data-testid="perch">
        <CorvidMark size={40} alive primary />
      </span>,
    );
    expect(moved(screen.getByTestId("perch"))).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
