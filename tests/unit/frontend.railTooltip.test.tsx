// @vitest-environment jsdom
/**
 * The label beside a rail icon: it waits 250 ms on hover, so a pointer
 * that crosses the rail shows nothing, and it opens away from the rail's
 * edge.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { RailTooltip } from "../../src/components/ui/RailTooltip";

// The label fades on motion's animation clock. Instant, the exit is done
// by the next frame.
beforeEach(() => {
  vi.useFakeTimers();
  MotionGlobalConfig.skipAnimations = true;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  MotionGlobalConfig.skipAnimations = false;
});

const renderTip = (side?: "left" | "right") =>
  render(
    <RailTooltip label="History" shortcut="H" side={side}>
      <button type="button" aria-label="History" />
    </RailTooltip>,
  );

describe("RailTooltip", () => {
  it("shows the label and its key after a 250 ms hover, and hides on leave", async () => {
    renderTip();
    const anchor = screen.getByRole("button", {
      name: "History",
    }).parentElement!;
    fireEvent.mouseEnter(anchor);
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText("H")).toBeNull();
    act(() => vi.advanceTimersByTime(60));
    expect(screen.getByText("H")).toBeTruthy();
    // To the right of the left nav.
    expect(screen.getByText("H").closest(".left-full")).toBeTruthy();

    vi.useRealTimers();
    fireEvent.mouseLeave(anchor);
    await waitFor(() => expect(screen.queryByText("H")).toBeNull());
  });

  it("opens to the left of a right-hand rail", () => {
    renderTip("left");
    const anchor = screen.getByRole("button", {
      name: "History",
    }).parentElement!;
    fireEvent.mouseEnter(anchor);
    act(() => vi.advanceTimersByTime(260));
    expect(screen.getByText("H").closest(".right-full")).toBeTruthy();
  });

  it("drops a pending label when it unmounts mid-hover", () => {
    const { unmount } = renderTip();
    const anchor = screen.getByRole("button", {
      name: "History",
    }).parentElement!;
    fireEvent.mouseEnter(anchor);
    unmount();
    // No state update on an unmounted component, and nothing left to run.
    expect(() => act(() => vi.advanceTimersByTime(300))).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows nothing while disabled, as over an open side panel", () => {
    render(
      <RailTooltip label="History" shortcut="H" side="left" disabled>
        <button type="button" aria-label="History" />
      </RailTooltip>,
    );
    const anchor = screen.getByRole("button", {
      name: "History",
    }).parentElement!;
    fireEvent.mouseEnter(anchor);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByText("H")).toBeNull();
  });
});
