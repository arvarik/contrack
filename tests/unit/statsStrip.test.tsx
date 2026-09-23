// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatsStrip } from "../../src/views/map/StatsStrip";
import type { MapStats } from "../../src/views/map/mapStats";

describe("StatsStrip", () => {
  const mockStats: MapStats = {
    inView: 42,
    matching: 42,
    total: 100,
    atRisk: 7,
    overdue: 3,
    neverContacted: 5,
    avgScore: 61,
    topIndustries: [{ name: "Fintech", count: 12 }],
    topCompanies: [{ name: "Stripe", count: 8 }],
    topTags: [{ name: "Investor", count: 15 }],
    timeZones: [
      { offset: "GMT+1", label: "GMT+1", count: 20, offsetMinutes: 60 },
      { offset: "GMT-4", label: "GMT-4", count: 15, offsetMinutes: -240 },
      { offset: "GMT+9", label: "GMT+9", count: 7, offsetMinutes: 540 },
    ],
  };

  it("renders aggregate chips and live status announcement", () => {
    render(<StatsStrip stats={mockStats} onApplyFacet={vi.fn()} />);

    expect(screen.getByText("42 in view")).toBeDefined();
    expect(screen.getByText("7 at risk")).toBeDefined();
    expect(screen.getByText("3 overdue")).toBeDefined();
    expect(screen.getByText("61 avg score")).toBeDefined();
    expect(screen.getByText("3 time zones")).toBeDefined();

    const status = screen.getByRole("status");
    expect(status.textContent).toBe("42 people in view, 7 at risk");
  });

  it("calls onApplyFacet when clicking the at risk button", () => {
    const onApplyFacet = vi.fn();
    render(<StatsStrip stats={mockStats} onApplyFacet={onApplyFacet} />);

    const atRiskButton = screen.getByRole("button", {
      name: "7 at risk, filter contacts",
    });
    fireEvent.click(atRiskButton);
    expect(onApplyFacet).toHaveBeenCalledWith("score:<40");
  });

  it("says overdue as a fact in the overdue ink, not as a second button", () => {
    // It wore the at risk button's wash with no hover, and no facet filters
    // by follow-up.
    render(<StatsStrip stats={mockStats} onApplyFacet={vi.fn()} />);
    const overdue = screen.getByText("3 overdue");
    expect(overdue.tagName).toBe("SPAN");
    expect(overdue.closest("button")).toBeNull();
    expect(overdue.className).toContain("text-error");
    expect(overdue.className).not.toContain("bg-error");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("renders empty state with Fit all button when no one is in view", () => {
    const emptyStats: MapStats = {
      ...mockStats,
      inView: 0,
      atRisk: 0,
      overdue: 0,
      avgScore: null,
      timeZones: [],
    };
    const onFitAll = vi.fn();

    render(
      <StatsStrip
        stats={emptyStats}
        onApplyFacet={vi.fn()}
        onFitAll={onFitAll}
      />,
    );

    expect(
      screen.getByText("No one in view. Zoom out or clear filters."),
    ).toBeDefined();

    const fitAllBtn = screen.getByRole("button", { name: "Fit all" });
    fireEvent.click(fitAllBtn);
    expect(onFitAll).toHaveBeenCalledTimes(1);
  });
});
