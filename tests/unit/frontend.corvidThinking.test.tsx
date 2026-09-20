// @vitest-environment jsdom
/**
 * The thinking bird.
 *
 * It replaced three different spinners, so what matters is that it says the
 * same thing they did and no more: a name where the surface has no words of
 * its own, silence where it does, and a still picture for an account that
 * asked for no motion. The waiting itself is never conveyed by the animation
 * alone, which is why `decorative` exists.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  CorvidThinking,
  THINKING_CLASS,
} from "../../src/components/brand/CorvidThinking";
import { GLYPH_PARTS } from "../../src/assets/corvidPaths";
import type { MascotMotion, MotionPreference } from "../../src/api/preferences";

const preferences = {
  mascotMotion: "full" as MascotMotion,
  motion: "system" as MotionPreference,
};

vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ preferences }),
}));

afterEach(() => {
  cleanup();
  preferences.mascotMotion = "full";
  preferences.motion = "system";
});

const svgOf = (container: HTMLElement) => container.querySelector("svg")!;

describe("CorvidThinking", () => {
  it("names itself Thinking, so a silent spinner became a word", () => {
    render(<CorvidThinking />);
    expect(screen.getByRole("img", { name: "Thinking" })).toBeTruthy();
  });

  it("is the glyph at 20 px, which is what fits those slots", () => {
    const { container } = render(<CorvidThinking />);
    const svg = svgOf(container);
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("height")).toBe("20");
    expect(svg.getAttribute("data-variant")).toBe("glyph");
    expect(svg.querySelectorAll("path")).toHaveLength(GLYPH_PARTS.length);
  });

  it("runs the head-tilt loop", () => {
    const { container } = render(<CorvidThinking />);
    expect(svgOf(container).classList.contains(THINKING_CLASS)).toBe(true);
  });

  it("says nothing where the surface already says it in text", () => {
    const { container } = render(<CorvidThinking decorative />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(svgOf(container).getAttribute("aria-hidden")).toBe("true");
  });

  it("is a still picture at level off, and still named", () => {
    preferences.mascotMotion = "off";
    const { container } = render(<CorvidThinking />);
    expect(svgOf(container).classList.contains(THINKING_CLASS)).toBe(false);
    expect(screen.getByRole("img", { name: "Thinking" })).toBeTruthy();
  });

  it("is a still picture when the Motion row asks for reduced motion", () => {
    preferences.motion = "reduced";
    const { container } = render(<CorvidThinking />);
    expect(svgOf(container).classList.contains(THINKING_CLASS)).toBe(false);
  });

  it("keeps the tilt at the subtle level, which keeps head tilts", () => {
    preferences.mascotMotion = "subtle";
    const { container } = render(<CorvidThinking />);
    expect(svgOf(container).classList.contains(THINKING_CLASS)).toBe(true);
  });

  it("takes a size, for the slots that are smaller than 20 px", () => {
    const { container } = render(<CorvidThinking size={16} decorative />);
    expect(svgOf(container).getAttribute("width")).toBe("16");
  });
});
