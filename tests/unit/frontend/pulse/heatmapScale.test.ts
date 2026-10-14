import { describe, it, expect } from "vitest";
import {
  heatmapScale,
  getHeatmapAlpha,
} from "../../../../src/views/pulse/lib/heatmapScale";
import { clampTooltipX } from "../../../../src/views/pulse/cards/Heatmap";

describe("pulse.heatmapScale", () => {
  it("maps zero or negative count to step 0", () => {
    const scale = heatmapScale([1, 2, 3, 4, 5, 10]);
    expect(scale(0)).toBe(0);
    expect(scale(-1)).toBe(0);
    expect(getHeatmapAlpha(scale(0))).toBe(0);
  });

  it("handles empty counts array gracefully", () => {
    const scale = heatmapScale([]);
    expect(scale(0)).toBe(0);
    expect(scale(1)).toBe(1);
    expect(scale(10)).toBe(1);
  });

  it("handles all-equal sample by assigning step 1 to all positive counts", () => {
    const scale = heatmapScale([3, 3, 3, 3, 3, 3]);
    expect(scale(0)).toBe(0);
    expect(scale(3)).toBe(1);
    expect(scale(1)).toBe(1);
  });

  it("computes quantiles correctly over a skewed sample", () => {
    // 10 samples with a skewed tail
    const sample = [1, 1, 2, 2, 3, 4, 6, 9, 15, 50];
    const scale = heatmapScale(sample);

    expect(scale(0)).toBe(0);
    expect(scale(1)).toBe(1);
    expect(scale(2)).toBe(2);
    expect(scale(3)).toBe(3);
    expect(scale(6)).toBe(4);
    expect(scale(50)).toBe(5);
    expect(scale(100)).toBe(5);
  });

  it("distributes steps 1 to 5 proportionally when unique positive counts are small (<5)", () => {
    const scale = heatmapScale([1, 2, 3]);
    expect(scale(0)).toBe(0);
    expect(scale(1)).toBe(1);
    expect(scale(2)).toBe(3);
    expect(scale(3)).toBe(5);
  });

  it("clamps heatmap tooltip x inside the card bounds", () => {
    expect(clampTooltipX(12, 320, "Wed, Sep 17 · 10 interactions", 120)).toBe(
      64,
    );
    expect(clampTooltipX(310, 320, "Wed, Sep 17 · 10 interactions", 120)).toBe(
      256,
    );
    expect(clampTooltipX(160, 320, "Wed, Sep 17 · 10 interactions", 120)).toBe(
      160,
    );
    expect(clampTooltipX(40, 0, "Wed, Sep 17 · 10 interactions", 120)).toBe(40);
  });
});
