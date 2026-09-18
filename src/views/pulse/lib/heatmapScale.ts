/**
 * Heatmap Quantile Scale.
 *
 * Maps activity interaction counts to 5 discrete alpha steps
 * according to quantiles over positive counts.
 *
 * Steps:
 * 0: count <= 0 (transparent / empty cell)
 * 1: 0.12 (lowest 20% quantile)
 * 2: 0.30 (20% - 40% quantile)
 * 3: 0.55 (40% - 60% quantile)
 * 4: 0.80 (60% - 80% quantile)
 * 5: 1.00 (highest 20% quantile)
 */

export const HEATMAP_ALPHA_STEPS = [0, 0.12, 0.3, 0.55, 0.8, 1] as const;

export type HeatmapStep = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Returns a quantile scaling function for a given array of interaction counts.
 */
export function heatmapScale(counts: number[]): (count: number) => HeatmapStep {
  const positive = counts.filter((c) => c > 0).sort((a, b) => a - b);

  if (positive.length === 0) {
    return (count: number): HeatmapStep => (count <= 0 ? 0 : 1);
  }

  const unique = Array.from(new Set(positive));

  // All equal positive counts (e.g. [1, 1, 1] or [5, 5])
  if (unique.length === 1) {
    return (count: number): HeatmapStep => (count <= 0 ? 0 : 1);
  }

  // Small positive sets: distribute proportionally across steps 1 to 5
  if (unique.length < 5) {
    return (count: number): HeatmapStep => {
      if (count <= 0) return 0;
      const min = unique[0];
      const max = unique[unique.length - 1];
      if (count <= min) return 1;
      if (count >= max) return 5;
      const step = Math.round(1 + ((count - min) / (max - min)) * 4);
      return Math.min(5, Math.max(1, step)) as HeatmapStep;
    };
  }

  // Compute 4 quantile threshold percentiles (20%, 40%, 60%, 80%)
  const q = (p: number) => {
    const idx = Math.max(
      0,
      Math.min(positive.length - 1, Math.ceil(positive.length * p) - 1),
    );
    return positive[idx];
  };

  const t1 = q(0.2);
  const t2 = Math.max(t1, q(0.4));
  const t3 = Math.max(t2, q(0.6));
  let t4 = Math.max(t3, q(0.8));
  const maxVal = positive[positive.length - 1];
  if (t4 >= maxVal && maxVal > t3) {
    t4 = maxVal - 0.001;
  }

  return (count: number): HeatmapStep => {
    if (count <= 0) return 0;
    if (count <= t1) return 1;
    if (count <= t2) return 2;
    if (count <= t3) return 3;
    if (count <= t4) return 4;
    return 5;
  };
}

/**
 * Helper to convert a step (0-5) to its corresponding alpha value.
 */
export function getHeatmapAlpha(step: HeatmapStep): number {
  return HEATMAP_ALPHA_STEPS[step];
}
