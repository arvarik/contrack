// @vitest-environment jsdom
/**
 * The mark beside a radio option.
 *
 * A selected option wears the tint, and the tint alone says "chosen" by hue.
 * `RadioDot` is the second cue, drawn for the eye only: the option itself
 * carries the state for a screen reader.
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { RadioDot } from "../../../../src/components/ui/RadioDot";

afterEach(() => {
  cleanup();
});

describe("RadioDot", () => {
  it("stays out of the accessibility tree", () => {
    const { container } = render(<RadioDot checked />);
    const dot = container.firstElementChild as HTMLElement;
    expect(dot.getAttribute("aria-hidden")).toBe("true");
  });

  it("fills with the primary and shows its centre dot when checked", () => {
    const { container } = render(<RadioDot checked />);
    const dot = container.firstElementChild as HTMLElement;
    expect(dot.className).toContain("bg-primary");
    expect((dot.firstElementChild as HTMLElement).className).toContain(
      "scale-100",
    );
  });

  it("is an empty ring when not checked", () => {
    const { container } = render(<RadioDot checked={false} />);
    const dot = container.firstElementChild as HTMLElement;
    expect(dot.className).not.toContain("bg-primary");
    expect(dot.className).toContain("ring-2");
    expect((dot.firstElementChild as HTMLElement).className).toContain(
      "scale-0",
    );
  });
});
