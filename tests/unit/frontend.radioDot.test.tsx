// @vitest-environment jsdom
/**
 * The mark beside a radio option, and the empty state's tone.
 *
 * A selected option wears the tint, and the tint alone says "chosen" by hue.
 * `RadioDot` is the second cue, drawn for the eye only: the option itself
 * carries the state for a screen reader. `EmptyState` takes a tone for its
 * icon tile, so a page that failed to load is not drawn as an empty one.
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Users } from "lucide-react";
import { RadioDot } from "../../src/components/ui/RadioDot";
import { EmptyState } from "../../src/components/ui/EmptyState";
import { TONE_WASH } from "../../src/lib/styles";

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

  it("sits beside the label of an option that carries the state", () => {
    render(
      <button type="button" role="radio" aria-checked="true">
        <RadioDot checked />7 days
      </button>,
    );
    expect(screen.getByRole("radio", { name: "7 days" })).toBeTruthy();
  });
});

describe("EmptyState tone", () => {
  it("draws the icon tile in the primary tone by default", () => {
    render(<EmptyState icon={Users} title="Nobody yet" body="Add someone." />);
    expect(screen.getByTestId("empty-state-icon").className).toContain(
      TONE_WASH.primary,
    );
  });

  it("draws a failed load in the error tone", () => {
    render(
      <EmptyState
        icon={Users}
        tone="error"
        title="System disconnected"
        body="Failed to load."
      />,
    );
    expect(screen.getByTestId("empty-state-icon").className).toContain(
      TONE_WASH.error,
    );
  });
});
