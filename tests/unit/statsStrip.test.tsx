// @vitest-environment jsdom
/**
 * The map's bottom line: who is in view, the overdue among them as a filter
 * to press, "Fit all" for an empty map, and the heat's legend.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StatsStrip } from "../../src/views/map/StatsStrip";
import { heatStops } from "../../src/views/map/heat";

afterEach(() => cleanup());

const line = () => screen.getByRole("region", { name: "In view" });

describe("StatsStrip", () => {
  it("says how many are in view, and of how many when some are off screen", () => {
    const { rerender } = render(
      <StatsStrip
        stats={{ inView: 30, matching: 30, overdue: 0 }}
        overdueOnly={false}
        onOverdueOnlyChange={vi.fn()}
      />,
    );
    expect(line().textContent).toContain("30 in view");
    rerender(
      <StatsStrip
        stats={{ inView: 12, matching: 30, overdue: 0 }}
        overdueOnly={false}
        onOverdueOnlyChange={vi.fn()}
      />,
    );
    expect(line().textContent).toContain("12 of 30 in view");
    // Nothing to press when nobody in view is overdue.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("presses overdue into a filter, in the overdue tone, and back out", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StatsStrip
        stats={{ inView: 12, matching: 30, overdue: 3 }}
        overdueOnly={false}
        onOverdueOnlyChange={onChange}
      />,
    );
    const button = screen.getByRole("button", { name: "3 overdue" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.className).toContain("text-error");
    fireEvent.click(button);
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(
      <StatsStrip
        stats={{ inView: 3, matching: 3, overdue: 3 }}
        overdueOnly
        onOverdueOnlyChange={onChange}
      />,
    );
    const pressed = screen.getByRole("button", { name: "3 overdue" });
    expect(pressed.getAttribute("aria-pressed")).toBe("true");
    expect(pressed.className).toContain("bg-error/10");
    fireEvent.click(pressed);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps a pressed filter to turn off when nobody overdue is left in view", () => {
    render(
      <StatsStrip
        stats={{ inView: 0, matching: 2, overdue: 0 }}
        overdueOnly
        onOverdueOnlyChange={vi.fn()}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "0 overdue" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("offers Fit all when nobody is in view", () => {
    const onFitAll = vi.fn();
    render(
      <StatsStrip
        stats={{ inView: 0, matching: 30, overdue: 0 }}
        overdueOnly={false}
        onOverdueOnlyChange={vi.fn()}
        onFitAll={onFitAll}
      />,
    );
    expect(line().textContent).toContain("No one in view");
    fireEvent.click(screen.getByRole("button", { name: "Fit all" }));
    expect(onFitAll).toHaveBeenCalledTimes(1);
  });

  it("shows the heat's ramp as its legend, or a way back out to the heat", () => {
    const stops = heatStops("#006a91", "light")!;
    const onZoomToHeat = vi.fn();
    const { rerender } = render(
      <StatsStrip
        stats={{ inView: 30, matching: 30, overdue: 0 }}
        overdueOnly={false}
        onOverdueOnlyChange={vi.fn()}
        heat={stops}
        onZoomToHeat={onZoomToHeat}
      />,
    );
    expect(line().textContent).toContain("Heat legend:FewerMore");
    const ramp = screen.getByText("Fewer").nextElementSibling as HTMLElement;
    expect(ramp.getAttribute("aria-hidden")).toBe("true");
    expect(ramp.style.backgroundImage).toContain("linear-gradient");

    rerender(
      <StatsStrip
        stats={{ inView: 4, matching: 30, overdue: 0 }}
        overdueOnly={false}
        onOverdueOnlyChange={vi.fn()}
        heat={stops}
        heatFaded
        onZoomToHeat={onZoomToHeat}
      />,
    );
    expect(screen.queryByText("Fewer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out for heat" }));
    expect(onZoomToHeat).toHaveBeenCalledTimes(1);
  });

  it("draws no legend while the pins are on", () => {
    render(
      <StatsStrip
        stats={{ inView: 30, matching: 30, overdue: 0 }}
        overdueOnly={false}
        onOverdueOnlyChange={vi.fn()}
        heat={null}
      />,
    );
    expect(screen.queryByText("Fewer")).toBeNull();
  });
});
