import { describe, it, expect } from "vitest";
import { PALETTES } from "../../src/lib/theme";
import { contrast, hexToRgb, over } from "../../src/lib/color";
import { HEATMAP_ALPHA_STEPS } from "../../src/views/pulse/lib/heatmapScale";
import { COMPOSITION_RAMP } from "../../src/views/pulse/lib/pulseStyles";

/**
 * Non-text contrast ratio floor per WCAG 2.1 SC 1.4.11 (3:1).
 */
const NON_TEXT_RATIO = 3.0;

describe("pulse.contrast", () => {
  it("ensures the two trend tones meet non-text contrast (3:1) against the card surface in both palettes", () => {
    // Rising is the success tone and cooling the error tone, on the Keeping
    // up card's delta chips.
    const tones = ["success", "error"] as const;

    for (const [mode, palette] of Object.entries(PALETTES)) {
      const surface = hexToRgb(palette["surface-container-lowest"]);

      for (const tone of tones) {
        const fg = hexToRgb(palette[tone]);
        const ratio = contrast(fg, surface);

        expect(
          ratio,
          `Trend tone "${tone}" on surface-container-lowest in ${mode} mode must be >= ${NON_TEXT_RATIO}:1`,
        ).toBeGreaterThanOrEqual(NON_TEXT_RATIO);
      }
    }
  });

  it("ensures the four segments of the Keeping up bar read against the card surface in both palettes", () => {
    // The three band segments are colour and meet the non-text floor. The
    // fourth, "no interactions yet", is the neutral track tone: it has to be
    // a different colour from the card, and darker or lighter than every
    // band segment beside it, so the bar never reads as three segments.
    const bands = ["success", "warning", "error"] as const;

    for (const [mode, palette] of Object.entries(PALETTES)) {
      const surface = hexToRgb(palette["surface-container-lowest"]);
      const track = hexToRgb(palette["surface-container-highest"]);

      for (const band of bands) {
        expect(
          contrast(hexToRgb(palette[band]), surface),
          `Bar segment "${band}" in ${mode} mode`,
        ).toBeGreaterThanOrEqual(NON_TEXT_RATIO);
      }
      expect(
        contrast(track, surface),
        `The unscored segment in ${mode} mode must differ from the card`,
      ).toBeGreaterThan(1.1);
      for (const band of bands) {
        expect(
          contrast(hexToRgb(palette[band]), track),
          `The unscored segment beside "${band}" in ${mode} mode`,
        ).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("ensures heatmap cell boundary strokes meet non-text contrast (3:1) against the card surface in both palettes", () => {
    for (const [mode, palette] of Object.entries(PALETTES)) {
      const surface = hexToRgb(palette["surface-container-lowest"]);
      const stroke = hexToRgb(palette.primary);
      const ratio = contrast(stroke, surface);

      expect(
        ratio,
        `Heatmap cell stroke in ${mode} mode must meet >= ${NON_TEXT_RATIO}:1 against card surface`,
      ).toBeGreaterThanOrEqual(NON_TEXT_RATIO);
    }
  });

  it("evaluates heatmap step fill contrast and verifies highest steps achieve >= 3:1", () => {
    // Quantile steps 1 to 5: [0.12, 0.3, 0.55, 0.8, 1.0]
    for (const [mode, palette] of Object.entries(PALETTES)) {
      const surface = hexToRgb(palette["surface-container-lowest"]);
      const primary = hexToRgb(palette.primary);

      const ratios = HEATMAP_ALPHA_STEPS.slice(1).map((alpha) => {
        const composite = over(primary, alpha, surface);
        return contrast(composite, surface);
      });

      // Steps 4 and 5 achieve non-text contrast on fill alone
      expect(ratios[3], `Step 4 fill in ${mode} mode`).toBeGreaterThanOrEqual(
        NON_TEXT_RATIO,
      );
      expect(ratios[4], `Step 5 fill in ${mode} mode`).toBeGreaterThanOrEqual(
        NON_TEXT_RATIO,
      );

      // Steps 1 to 3 provide progressive data density visual stepping,
      // bounded by the accessible cell stroke (>= 3:1) and title / sr-only text
      expect(ratios[0]).toBeGreaterThan(1.0);
      expect(ratios[1]).toBeGreaterThan(ratios[0]);
      expect(ratios[2]).toBeGreaterThan(ratios[1]);
      expect(ratios[3]).toBeGreaterThan(ratios[2]);
      expect(ratios[4]).toBeGreaterThan(ratios[3]);
    }
  });

  it("draws the composition donut in one hue, with no AI colour, and keeps its steps apart", () => {
    // The ramp is the primary at six steps of opacity, largest slice
    // darkest. The AI colour marks AI-derived data and a count of people by
    // industry is not that, so it is not in the chart.
    expect(COMPOSITION_RAMP.color).toBe("var(--color-primary)");
    expect(COMPOSITION_RAMP.other).not.toContain("--color-ai");
    expect(JSON.stringify(COMPOSITION_RAMP)).not.toContain("--color-ai");
    expect(COMPOSITION_RAMP.opacities).toHaveLength(6);
    for (let i = 1; i < COMPOSITION_RAMP.opacities.length; i++) {
      expect(COMPOSITION_RAMP.opacities[i]).toBeLessThan(
        COMPOSITION_RAMP.opacities[i - 1],
      );
    }

    for (const [mode, palette] of Object.entries(PALETTES)) {
      const surface = hexToRgb(palette["surface-container-lowest"]);
      const primary = hexToRgb(palette.primary);
      const track = hexToRgb(palette["surface-container-highest"]);

      // The two largest slices meet the non-text floor on their own.
      for (const alpha of COMPOSITION_RAMP.opacities.slice(0, 2)) {
        expect(
          contrast(over(primary, alpha, surface), surface),
          `Donut step ${alpha} in ${mode} mode`,
        ).toBeGreaterThanOrEqual(NON_TEXT_RATIO);
      }
      // Each step is visibly lighter than the one before it.
      const ratios = COMPOSITION_RAMP.opacities.map((alpha) =>
        contrast(over(primary, alpha, surface), surface),
      );
      for (let i = 1; i < ratios.length; i++) {
        expect(ratios[i], `Step ${i} in ${mode} mode`).toBeLessThan(
          ratios[i - 1],
        );
      }
      // Other is the neutral track, and it differs from the card.
      expect(
        contrast(track, surface),
        `The Other slice in ${mode} mode must differ from the card`,
      ).toBeGreaterThan(1.1);
    }
  });
});
