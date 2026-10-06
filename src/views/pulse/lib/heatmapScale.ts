/**
 * Maps interaction counts to alpha steps by quintiles over the positive
 * counts. Step 0 is an empty cell.
 */
export const HEATMAP_ALPHA_STEPS = [0, 0.12, 0.3, 0.55, 0.8, 1] as const;

type HeatmapStep = 0 | 1 | 2 | 3 | 4 | 5;

export function heatmapScale(counts: number[]): (count: number) => HeatmapStep {
  const positive = counts.filter((c) => c > 0).sort((a, b) => a - b);
  const unique = Array.from(new Set(positive));

  // No positive counts, or all equal ([1, 1, 1] or [5, 5]).
  if (unique.length <= 1) {
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

export function getHeatmapAlpha(step: HeatmapStep): number {
  return HEATMAP_ALPHA_STEPS[step];
}
