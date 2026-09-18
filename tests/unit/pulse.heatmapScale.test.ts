import { describe, it, expect } from "vitest";
import {
  heatmapScale,
  getHeatmapAlpha,
  HEATMAP_ALPHA_STEPS,
} from "../../src/views/pulse/lib/heatmapScale";

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

  it("returns correct alpha values from HEATMAP_ALPHA_STEPS", () => {
    expect(HEATMAP_ALPHA_STEPS).toEqual([0, 0.12, 0.3, 0.55, 0.8, 1]);
    expect(getHeatmapAlpha(0)).toBe(0);
    expect(getHeatmapAlpha(1)).toBe(0.12);
    expect(getHeatmapAlpha(2)).toBe(0.3);
    expect(getHeatmapAlpha(3)).toBe(0.55);
    expect(getHeatmapAlpha(4)).toBe(0.8);
    expect(getHeatmapAlpha(5)).toBe(1);
  });
});
