// @vitest-environment jsdom
/**
 * The bird's other homes:
 *
 * 1. The sign-in card's bird shakes its head at a wrong password, once per
 *    message and at nothing else, not on every re-render while an error is
 *    up. The ring it sits in never moves.
 * 2. The "All reviewed" mark hops when it arrives, and holds still for an
 *    account that asked for no motion.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  AuthError,
  AuthShell,
  WRONG_CREDENTIALS,
} from "../../../../src/components/auth/AuthShell";
import { CorvidMark } from "../../../../src/components/brand/CorvidMark";
import { CORVID_PATHS } from "../../../../src/assets/corvidPaths";
import type {
  MascotMotion,
  MotionPreference,
} from "../../../../src/api/preferences";

const preferences = {
  mascotMotion: "full" as MascotMotion,
  motion: "system" as MotionPreference,
};

vi.mock("../../../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ preferences }),
}));
vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ instanceName: null }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  preferences.mascotMotion = "full";
  preferences.motion = "system";
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The sign-in card

/** The shell with an error that the test can change from outside. */
const Card = ({ error }: { error: string | null }) => (
  <AuthShell title="Sign in" subtitle="Welcome back" onSubmit={() => {}}>
    {error && <AuthError>{error}</AuthError>}
  </AuthShell>
);

const mark = () => screen.getByTestId("auth-corvid");
const partOf = (root: Element, part: string) =>
  root.querySelector(`[data-part="${part}"]`)!.getAttribute("d");
/** Whether the head is somewhere other than the logo's head right now. */
const headMoved = () => partOf(mark(), "head") !== CORVID_PATHS.head;

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe("the sign-in card", () => {
  it("shakes its head when the password was wrong, and only its head", () => {
    const { rerender } = render(<Card error={null} />);
    advance(50);
    expect(headMoved()).toBe(false);

    rerender(<Card error={WRONG_CREDENTIALS} />);
    advance(90);
    expect(headMoved()).toBe(true);
    expect(partOf(mark(), "ring")).toBe(CORVID_PATHS.ring);

    advance(400);
    expect(headMoved()).toBe(false);
  });

  it("shakes once per message, not once per render", () => {
    const { rerender } = render(<Card error={WRONG_CREDENTIALS} />);
    advance(500);
    expect(headMoved()).toBe(false);

    // Same sentence, another render: the bird must hold still.
    rerender(<Card error={WRONG_CREDENTIALS} />);
    advance(90);
    expect(headMoved()).toBe(false);
  });

  it("holds still for an error that is not about the credential", () => {
    // A network failure and a rate limit arrive through the same component.
    // "No, that is not it" is untrue of both, so the bird says nothing.
    const { rerender } = render(<Card error={null} />);
    rerender(<Card error="Could not reach the server." />);
    advance(90);
    expect(headMoved()).toBe(false);
  });

  it("holds still at level off", () => {
    preferences.mascotMotion = "off";
    const { rerender } = render(<Card error={null} />);
    rerender(<Card error={WRONG_CREDENTIALS} />);
    advance(90);
    expect(headMoved()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer behind and the logo drawn when the card unmounts mid-shake", () => {
    const { rerender, unmount } = render(<Card error={null} />);
    rerender(<Card error={WRONG_CREDENTIALS} />);
    advance(90);
    const head = mark().querySelector('[data-part="head"]')!;
    unmount();
    expect(head.getAttribute("d")).toBe(CORVID_PATHS.head);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// The mark that hops when it arrives

describe("a mark that hops on mount", () => {
  const chest = (container: HTMLElement) => partOf(container, "chest");

  it("hops once, leaving its ring where it is, and then holds still", () => {
    const { container } = render(<CorvidMark size={96} hop />);
    advance(200);
    expect(chest(container)).not.toBe(CORVID_PATHS.chest);
    expect(partOf(container, "ring")).toBe(CORVID_PATHS.ring);
    advance(600);
    expect(chest(container)).toBe(CORVID_PATHS.chest);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not hop at level off", () => {
    preferences.mascotMotion = "off";
    const { container } = render(<CorvidMark size={96} hop />);
    advance(200);
    expect(chest(container)).toBe(CORVID_PATHS.chest);
  });

  it("does not hop when the Motion row asks for reduced motion", () => {
    preferences.motion = "reduced";
    const { container } = render(<CorvidMark size={96} hop />);
    advance(200);
    expect(chest(container)).toBe(CORVID_PATHS.chest);
  });

  it("does not hop unless it is asked to", () => {
    const { container } = render(<CorvidMark size={96} />);
    advance(200);
    expect(chest(container)).toBe(CORVID_PATHS.chest);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer behind when it unmounts mid-hop", () => {
    const { container, unmount } = render(<CorvidMark size={96} hop />);
    advance(150);
    const el = container.querySelector('[data-part="chest"]')!;
    unmount();
    expect(el.getAttribute("d")).toBe(CORVID_PATHS.chest);
    expect(vi.getTimerCount()).toBe(0);
  });
});
