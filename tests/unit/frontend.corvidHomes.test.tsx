// @vitest-environment jsdom
/**
 * The bird's other homes.
 *
 * Three behaviours that only exist because a surface asked for them, and
 * that a person would only notice if they broke:
 *
 * 1. The sign-in card shakes its head at a wrong password, once per message,
 *    and at nothing else. A card that twitches on every re-render while an
 *    error is up is worse than a card that never moves.
 * 2. The "All reviewed" mark hops when it arrives, and holds still for an
 *    account that asked for no motion.
 * 3. The flight leaves from the perch that is actually on screen. There are
 *    two in the DOM below `md`, and picking the wrong one sends the bird
 *    from the corner of the window.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  AuthError,
  AuthShell,
  SHAKE_CLASS,
  SHAKE_MS,
  WRONG_CREDENTIALS,
} from "../../src/components/auth/AuthShell";
import {
  findPerch,
  PERCH_ATTRIBUTE,
} from "../../src/components/brand/CorvidFlight";
import { CorvidMark } from "../../src/components/brand/CorvidMark";
import { HOP_CLASS, HOP_MS } from "../../src/hooks/useCorvidIdle";
import type { MascotMotion, MotionPreference } from "../../src/api/preferences";

const preferences = {
  mascotMotion: "full" as MascotMotion,
  motion: "system" as MotionPreference,
};

vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ preferences }),
}));
vi.mock("../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ instanceName: null }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  preferences.mascotMotion = "full";
  preferences.motion = "system";
});

afterEach(() => {
  cleanup();
  document.querySelectorAll(`[${PERCH_ATTRIBUTE}]`).forEach((n) => n.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The sign-in card
// ---------------------------------------------------------------------------

/** The shell with an error that the test can change from outside. */
const Card = ({ error }: { error: string | null }) => (
  <AuthShell title="Sign in" subtitle="Welcome back" onSubmit={() => {}}>
    {error && <AuthError>{error}</AuthError>}
  </AuthShell>
);

const mark = () => screen.getByTestId("auth-corvid");

describe("the sign-in card", () => {
  it("shakes its head when the password was wrong", () => {
    const { rerender } = render(<Card error={null} />);
    expect(mark().classList.contains(SHAKE_CLASS)).toBe(false);

    rerender(<Card error={WRONG_CREDENTIALS} />);
    expect(mark().classList.contains(SHAKE_CLASS)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(SHAKE_MS);
    });
    expect(mark().classList.contains(SHAKE_CLASS)).toBe(false);
  });

  it("shakes once per message, not once per render", () => {
    const { rerender } = render(<Card error={WRONG_CREDENTIALS} />);
    act(() => {
      vi.advanceTimersByTime(SHAKE_MS);
    });
    expect(mark().classList.contains(SHAKE_CLASS)).toBe(false);

    // Same sentence, another render: the card must hold still.
    rerender(<Card error={WRONG_CREDENTIALS} />);
    expect(mark().classList.contains(SHAKE_CLASS)).toBe(false);
  });

  it("holds still for an error that is not about the credential", () => {
    // A network failure and a rate limit arrive through the same component.
    // "No, that is not it" is untrue of both, so the bird says nothing.
    const { rerender } = render(<Card error={null} />);
    rerender(<Card error="Could not reach the server." />);
    expect(mark().classList.contains(SHAKE_CLASS)).toBe(false);
  });

  it("holds still at level off", () => {
    preferences.mascotMotion = "off";
    const { rerender } = render(<Card error={null} />);
    rerender(<Card error={WRONG_CREDENTIALS} />);
    expect(mark().classList.contains(SHAKE_CLASS)).toBe(false);
  });

  it("still announces the error, whatever the bird does", () => {
    render(<Card error={WRONG_CREDENTIALS} />);
    expect(screen.getByRole("alert").textContent).toBe(WRONG_CREDENTIALS);
  });

  it("leaves no timer behind when the card unmounts mid-shake", () => {
    const { rerender, unmount } = render(<Card error={null} />);
    rerender(<Card error={WRONG_CREDENTIALS} />);
    const element = mark();
    unmount();
    expect(element.classList.contains(SHAKE_CLASS)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The mark that hops when it arrives
// ---------------------------------------------------------------------------

describe("a mark that hops on mount", () => {
  it("hops once and then holds still", () => {
    const { container } = render(<CorvidMark size={96} hop />);
    const svg = container.querySelector("svg")!;
    expect(svg.classList.contains(HOP_CLASS)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(HOP_MS);
    });
    expect(svg.classList.contains(HOP_CLASS)).toBe(false);
  });

  it("does not hop at level off", () => {
    preferences.mascotMotion = "off";
    const { container } = render(<CorvidMark size={96} hop />);
    expect(container.querySelector("svg")!.classList.contains(HOP_CLASS)).toBe(
      false,
    );
  });

  it("does not hop when the operating system asks for reduced motion", () => {
    preferences.motion = "reduced";
    const { container } = render(<CorvidMark size={96} hop />);
    expect(container.querySelector("svg")!.classList.contains(HOP_CLASS)).toBe(
      false,
    );
  });

  it("does not hop unless it is asked to", () => {
    const { container } = render(<CorvidMark size={96} />);
    expect(container.querySelector("svg")!.classList.contains(HOP_CLASS)).toBe(
      false,
    );
  });

  it("leaves no timer behind when it unmounts mid-hop", () => {
    const { container, unmount } = render(<CorvidMark size={96} hop />);
    const svg = container.querySelector("svg")!;
    unmount();
    expect(svg.classList.contains(HOP_CLASS)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Which perch the bird leaves from
// ---------------------------------------------------------------------------

/** A perch with the rectangle a browser would give it. */
function addPerch(id: string, width: number): HTMLElement {
  const perch = document.createElement("span");
  perch.id = id;
  perch.setAttribute(PERCH_ATTRIBUTE, "");
  perch.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width, height: width }) as DOMRect;
  document.body.append(perch);
  return perch;
}

describe("findPerch", () => {
  it("finds nothing when no perch is in the page", () => {
    expect(findPerch()).toBeNull();
  });

  it("takes the only perch there is", () => {
    const only = addPerch("sidebar", 32);
    expect(findPerch()).toBe(only);
  });

  it("skips the sidebar's perch on a phone, where CSS hides it", () => {
    // The sidebar is `hidden md:flex`, so below the breakpoint it is still
    // in the DOM with no layout box. Its rectangle is all zeros, and a bird
    // that left from it would leave from the corner of the window.
    addPerch("sidebar", 0);
    const footer = addPerch("settings-footer", 20);
    expect(findPerch()).toBe(footer);
  });

  it("falls back to the first perch when none has a box", () => {
    const first = addPerch("sidebar", 0);
    addPerch("settings-footer", 0);
    expect(findPerch()).toBe(first);
  });
});
