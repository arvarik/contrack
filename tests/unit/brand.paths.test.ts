/**
 * The corvid's geometry.
 *
 * The paths are hand-traced numbers, so the checks are the ones a number can
 * fail: every string parses as the two commands the parser accepts, every
 * optical size is a subset of the mark's parts and gets heavier as it gets
 * smaller, the ink keeps its padding inside the box, every master lands
 * inside the tile with its inset clear, the ring is the one part that is
 * not the bird, and the thinking head still turns about the rig's neck.
 *
 * The brand's colours are literals, because a favicon cannot read a token.
 * So the last checks hold each literal to the token it copies, and measure
 * the contrast every ground and ink pair needs.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BIRD_PART_ORDER,
  BRAND,
  CORVID_BOX,
  CORVID_EYE,
  CORVID_OPTICAL,
  CORVID_PART_ORDER,
  CORVID_PATHS,
  CORVID_RING,
  MARK_STROKE,
  TILE,
  fitMark,
  masterBounds,
  opticalSize,
  parsePath,
  pathBounds,
  type OpticalSize,
} from "../../src/assets/corvidPaths";
import { NECK } from "../../src/assets/corvidRig";
import { DARK, LIGHT } from "../../src/lib/theme";
import { contrast, hexToRgb } from "../../src/lib/color";

const SIZES: OpticalSize[] = ["tiny", "small", "medium", "large"];
const ratio = (a: string, b: string) => contrast(hexToRgb(a), hexToRgb(b));

const ALL_PATHS = CORVID_PART_ORDER.map((part) => CORVID_PATHS[part]);

describe("the corvid's paths", () => {
  it("parse as absolute M and C commands and nothing else", () => {
    for (const part of CORVID_PART_ORDER) {
      const d = CORVID_PATHS[part];
      expect(d.startsWith("M"), part).toBe(true);
      for (const token of d.split(" ")) {
        expect(token, `${part}: ${token}`).toMatch(/^[MC]?-?\d+(\.\d+)?$/);
      }
      const commands = parsePath(d);
      expect(commands[0]!.cmd).toBe("M");
      for (const command of commands) {
        expect(command.points).toHaveLength(command.cmd === "M" ? 1 : 3);
      }
      // A part is a curve, not a dot.
      expect(commands.filter((c) => c.cmd === "C").length).toBeGreaterThan(3);
    }
  });

  it("rejects a relative or unknown command", () => {
    expect(() => parsePath("M1 1 c1 1 2 2 3 3")).toThrow(/Unsupported/);
    expect(() => parsePath("M1 1 L2 2")).toThrow(/Unsupported/);
    expect(() => parsePath("M1 1 C1 1 2 2")).toThrow(/Short/);
    expect(() => parsePath("M1 1 C1 1 2 2 3 x")).toThrow(/Bad number/);
  });

  it("lists every part once, in a drawing order that ends with the head", () => {
    expect([...CORVID_PART_ORDER].sort()).toEqual(
      Object.keys(CORVID_PATHS).sort(),
    );
    expect(new Set(CORVID_PART_ORDER).size).toBe(CORVID_PART_ORDER.length);
    expect(CORVID_PART_ORDER[CORVID_PART_ORDER.length - 1]).toBe("head");
  });

  it("has one part that is not the bird: the ring, drawn first", () => {
    expect(CORVID_RING).toBe("ring");
    expect(CORVID_PART_ORDER[0]).toBe(CORVID_RING);
    expect(BIRD_PART_ORDER).toEqual(CORVID_PART_ORDER.slice(1));
    expect(BIRD_PART_ORDER).not.toContain(CORVID_RING);
  });

  it("keeps every optical size a subset of the mark, in drawing order", () => {
    for (const size of SIZES) {
      const { parts } = CORVID_OPTICAL[size];
      expect(parts, size).toEqual(
        CORVID_PART_ORDER.filter((part) => parts.includes(part)),
      );
    }
    // At 16 px the silhouette only: the C, the wing, the outer tail and the
    // head. The chest and the inner feather merge with their neighbours.
    expect(CORVID_OPTICAL.tiny.parts).toEqual([
      "ring",
      "wing",
      "tail1",
      "head",
    ]);
    expect(CORVID_OPTICAL.tiny.eye).toBe(0);
    for (const size of ["small", "medium", "large"] as const) {
      expect(CORVID_OPTICAL[size].parts, size).toEqual(CORVID_PART_ORDER);
    }
  });

  it("draws a smaller size heavier, down to the logo's own weight", () => {
    const strokes = SIZES.map((size) => CORVID_OPTICAL[size].stroke);
    expect([...strokes].sort((a, b) => b - a)).toEqual(strokes);
    expect(new Set(strokes).size).toBe(strokes.length);
    expect(CORVID_OPTICAL.large.stroke).toBe(MARK_STROKE);
    expect(CORVID_OPTICAL.large.eye).toBe(CORVID_EYE.r);
    expect(CORVID_OPTICAL.small.eye).toBeGreaterThan(CORVID_OPTICAL.medium.eye);
    expect(CORVID_OPTICAL.medium.eye).toBeGreaterThan(CORVID_EYE.r);
  });

  it("picks a size by what a person sees, not by the file's pixels", () => {
    // A 16 px tab: tiny on a 1x screen, small with two pixels a point.
    expect(opticalSize(16, 1)).toBe("tiny");
    expect(opticalSize(16, 2)).toBe("small");
    expect(opticalSize(23, 1)).toBe("tiny");
    expect(opticalSize(24, 1)).toBe("small");
    expect(opticalSize(47)).toBe("small");
    // A launcher or home screen icon, at 48 to 60 points.
    expect(opticalSize(48)).toBe("medium");
    expect(opticalSize(60, 3)).toBe("medium");
    expect(opticalSize(95)).toBe("medium");
    expect(opticalSize(96)).toBe("large");
    expect(opticalSize(144)).toBe("large");
  });

  it("keeps the ink inside the box, 8 units from the sides", () => {
    const ink = pathBounds(ALL_PATHS, MARK_STROKE);
    expect(ink.minX).toBeGreaterThanOrEqual(0);
    expect(ink.minY).toBeGreaterThanOrEqual(0);
    expect(ink.maxX).toBeLessThanOrEqual(CORVID_BOX);
    expect(ink.maxY).toBeLessThanOrEqual(CORVID_BOX);
    // The bird is wider than tall, so the sides carry the padding exactly
    // and the top and bottom carry more.
    expect(ink.minX).toBeGreaterThanOrEqual(7.7);
    expect(ink.minX).toBeLessThanOrEqual(8.3);
    expect(ink.maxX).toBeGreaterThanOrEqual(91.7);
    expect(ink.maxX).toBeLessThanOrEqual(92.3);
    expect(ink.minY).toBeGreaterThanOrEqual(8);
    expect(ink.maxY).toBeLessThanOrEqual(92);
    // Centred top to bottom.
    expect(ink.minY + ink.maxY).toBeCloseTo(CORVID_BOX, 0);
  });

  it("puts the eye in the head, between the crown and the head line", () => {
    const eye = pathBounds([CORVID_PATHS.head]);
    // The head line starts at x 27 and runs right of the eye's centre.
    expect(CORVID_EYE.cx).toBeGreaterThan(eye.minX);
    expect(CORVID_EYE.cx).toBeLessThan(eye.maxX);
    // Below the crown's top, above the beak's lower edge.
    const ring = pathBounds([CORVID_PATHS.ring]);
    expect(CORVID_EYE.cy - CORVID_EYE.r).toBeGreaterThan(ring.minY);
    expect(CORVID_EYE.cy + CORVID_EYE.r).toBeLessThan(eye.maxY);
  });

  it("places every master inside the tile with its inset clear on every side", () => {
    for (const size of SIZES) {
      const master = CORVID_OPTICAL[size];
      const inset = master.tileInset;
      const { scale, tx, ty } = fitMark(master, TILE.box, inset);
      const ink = masterBounds(master);
      const left = ink.minX * scale + tx;
      const right = ink.maxX * scale + tx;
      const top = ink.minY * scale + ty;
      const bottom = ink.maxY * scale + ty;
      // The placement rounds to three decimals, so allow a tenth of a unit.
      expect(left, size).toBeGreaterThanOrEqual(inset - 0.1);
      expect(right, size).toBeLessThanOrEqual(TILE.box - inset + 0.1);
      expect(top, size).toBeGreaterThanOrEqual(inset - 0.1);
      expect(bottom, size).toBeLessThanOrEqual(TILE.box - inset + 0.1);
      // The wider axis fills the room, and the bird is centred on the other.
      expect(right - left, size).toBeCloseTo(TILE.box - 2 * inset, 1);
      expect(top + bottom, size).toBeCloseTo(TILE.box, 1);
    }
    // More room round a larger icon, as the platforms' icon grids ask.
    const insets = SIZES.map((size) => CORVID_OPTICAL[size].tileInset);
    expect([...insets].sort((a, b) => a - b)).toEqual(insets);
  });

  it("turns the thinking head about the rig's neck", () => {
    // `transform-box: view-box` reads the origin in the mark's own box, so
    // the number in the stylesheet is a point of the drawing. Moving the
    // rig's neck without the keyframe would make the thinking bird nod
    // about some other point than the one every other head turn uses.
    const css = readFileSync("src/index.css", "utf8");
    const rule = css.match(
      /\.corvid-thinking \[data-part="head"\],\s*\.corvid-thinking \[data-part="eye"\]\s*\{[^}]*transform-box:\s*view-box;[^}]*transform-origin:\s*([\d.]+)px ([\d.]+)px/,
    );
    expect(rule, "no transform-origin on the thinking rule").toBeTruthy();
    expect(Number(rule![1])).toBe(NECK[0]);
    expect(Number(rule![2])).toBe(NECK[1]);
  });

  it("keeps the thinking keyframe off the ring", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).not.toMatch(/\.corvid-thinking\s*\{/);
    expect(css).not.toMatch(/data-part="ring"\][^{]*\{[^}]*animation/);
  });
});

describe("the brand's colours", () => {
  it("copies each literal from the token it names", () => {
    // `theme.contrast.test.ts` holds LIGHT and DARK to the stylesheet.
    expect(BRAND.mark).toBe(LIGHT.primary);
    expect(BRAND.markDark).toBe(DARK.primary);
    expect(BRAND.primaryDim).toBe(LIGHT["primary-dim"]);
    expect(BRAND.primaryContainer).toBe(LIGHT["primary-container"]);
    expect(BRAND.surface).toBe(LIGHT.surface);
    expect(BRAND.surfaceDark).toBe(DARK.surface);
    expect(BRAND.onSurface).toBe(LIGHT["on-surface"]);
    expect(BRAND.onSurfaceDark).toBe(DARK["on-surface"]);
    expect(BRAND.onSurfaceVariant).toBe(LIGHT["on-surface-variant"]);
    expect(BRAND.onSurfaceVariantDark).toBe(DARK["on-surface-variant"]);
    // The eye is not in the palettes: read it from the stylesheet, where it
    // is set once for light and twice for dark.
    const css = readFileSync("src/index.css", "utf8");
    const eyes = [...css.matchAll(/--color-corvid-eye:\s*(#[0-9a-f]{6})/g)].map(
      (m) => m[1],
    );
    expect(eyes).toEqual([BRAND.eyeLight, BRAND.eyeDark, BRAND.eyeDark]);
  });

  it("runs the tile from primary-dim to 55 percent of the branding gradient", () => {
    expect(TILE.gradientFrom).toBe(BRAND.primaryDim);
    const from = hexToRgb(BRAND.primaryDim);
    const to = hexToRgb(BRAND.primaryContainer);
    const at = hexToRgb(TILE.gradientTo);
    for (const channel of ["r", "g", "b"] as const) {
      expect(at[channel]).toBe(
        Math.round(from[channel] + (to[channel] - from[channel]) * 0.55),
      );
    }
    expect(TILE.eye).toBe(BRAND.eyeLight);
    expect(TILE.ink).toBe("#ffffff");
  });

  it("keeps the white bird at 3:1 or better on every part of the tile", () => {
    // Every channel rises from one stop to the other, so the lightest point
    // of the tile is its end, and 3:1 there is 3:1 everywhere. WCAG 1.4.11
    // asks 3:1 of a graphic a person has to make out.
    expect(ratio(TILE.ink, TILE.gradientTo)).toBeGreaterThanOrEqual(3.3);
    expect(ratio(TILE.ink, TILE.gradientFrom)).toBeGreaterThanOrEqual(6);
    // The branding gradient's own end is why the tile stops short of it.
    expect(ratio(TILE.ink, BRAND.primaryContainer)).toBeLessThan(3);
  });

  it("keeps every version of the mark and the name readable on its ground", () => {
    expect(ratio(BRAND.mark, BRAND.surface)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(BRAND.markDark, BRAND.surfaceDark)).toBeGreaterThanOrEqual(
      4.5,
    );
    // GitHub's dark page, where the README shows the dark lockup.
    expect(ratio(BRAND.markDark, "#0d1117")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(BRAND.onSurface, BRAND.surface)).toBeGreaterThanOrEqual(7);
    expect(
      ratio(BRAND.onSurfaceDark, BRAND.surfaceDark),
    ).toBeGreaterThanOrEqual(7);
    expect(ratio(BRAND.onSurfaceVariant, BRAND.surface)).toBeGreaterThanOrEqual(
      4.5,
    );
    // The reversed mark, white on the primary.
    expect(ratio("#ffffff", BRAND.mark)).toBeGreaterThanOrEqual(4.5);
  });
});
