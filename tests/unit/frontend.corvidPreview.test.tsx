// @vitest-environment jsdom
/**
 * The bird beside the "Corvid motion" row.
 *
 * It is the setting, shown: a button named "Try the corvid" that asks for
 * the chosen level's flight from its own ring, and nothing at "off". The
 * drawing inside stays out of the accessibility tree like every mark.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { CorvidPreview } from "../../src/components/brand/CorvidPreview";
import { CORVID_FLY_EVENT } from "../../src/lib/corvid";
import type { MascotMotion, MotionPreference } from "../../src/api/preferences";

const preferences = {
  mascotMotion: "full" as MascotMotion,
  motion: "system" as MotionPreference,
};

vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ preferences }),
}));

const asked: { kind: string; perch?: Element | null }[] = [];
const listen = (e: Event) => asked.push((e as CustomEvent).detail);

beforeEach(() => {
  vi.useFakeTimers();
  asked.length = 0;
  preferences.mascotMotion = "full";
  preferences.motion = "system";
  window.addEventListener(CORVID_FLY_EVENT, listen);
});

afterEach(() => {
  window.removeEventListener(CORVID_FLY_EVENT, listen);
  cleanup();
  vi.useRealTimers();
});

describe("CorvidPreview", () => {
  it("is a named button whose drawing says nothing", () => {
    render(<CorvidPreview />);
    const button = screen.getByRole("button", { name: "Try the corvid" });
    expect(button.getAttribute("title")).toBe("Press to see what it does");
    expect(button.querySelector("svg")!.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("asks for a flight from its own ring", () => {
    render(<CorvidPreview />);
    const button = screen.getByRole("button", { name: "Try the corvid" });
    act(() => button.click());
    expect(asked).toHaveLength(1);
    expect(asked[0]!.kind).toBe("loop");
    expect(asked[0]!.perch).toBe(button.querySelector("span"));
  });

  it("is a still picture, not a button, at level off", () => {
    preferences.mascotMotion = "off";
    const { container } = render(<CorvidPreview />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is a still picture under reduced motion too", () => {
    preferences.motion = "reduced";
    render(<CorvidPreview />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lives faster than the sidebar's bird, so the row shows what it does", () => {
    render(<CorvidPreview />);
    const eye = () =>
      Number(document.querySelector('[data-part="eye"]')!.getAttribute("ry"));
    let blinked = false;
    // At three times the pace, a blink comes within two and a half seconds.
    for (let t = 0; t < 2_500 && !blinked; t += 16) {
      act(() => {
        vi.advanceTimersByTime(16);
      });
      blinked = eye() < 1;
    }
    expect(blinked).toBe(true);
  });
});
