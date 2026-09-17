/**
 * The corvid: Contrack's mark, as geometry.
 *
 * One drawing, in parts, in a 100 by 100 box. The React components stroke
 * these paths with `currentColor`, and `scripts/brand/build-icons.ts`
 * rasterises the same paths into the favicon, the PWA icons and the README
 * picture. Because both read this file, the bird in the tab strip and the
 * bird in the sidebar cannot drift apart. After an edit here, run
 * `npm run brand:icons` and commit what it writes: a unit test compares the
 * committed favicon with what the script renders.
 *
 * Where the numbers come from. The reference is `docs/brand/corvid-source.jpg`,
 * a 1024 px mono-line raven facing right. Each part's centreline was measured
 * from that image (the midpoint of the dark run on every 16th column and row),
 * joined with a Catmull-Rom spline, checked against the source at 60 percent
 * opacity, then thinned while the curve stayed within one source pixel of the
 * dense trace. The box maps source pixels x 300.5 to 750 and y 305 to 694 at
 * 0.17887 units per pixel, so the ink, stroke included, keeps 8 units clear of
 * the left and right edges and sits centred top to bottom.
 *
 * The parts, as the pen draws them:
 *
 *   body   the crown, from the tip above the beak over the head, down the
 *          back and round the belly to the knot under the tail
 *   beak   the head line from the crown across the eye, the wedge of the
 *          beak, and the throat down to the wing's shoulder
 *   chest  the inner line from under the throat down to the same knot
 *   wing   one stroke: over the top of the wing to where it crosses the tail,
 *          then back round the shoulder and along the underside to the tip
 *   tail1  from that crossing down to the hairpin at the tail's end and back
 *          along the lower feather to the knot
 *   tail2  the short inner feather from the knot
 *
 * The glyph is the body, the beak and the wing at a heavier stroke, for the
 * tile and anything at 16 or 32 px. It is a subset of the same paths, not a
 * second drawing.
 */

export const CORVID_VIEWBOX = "0 0 100 100";
export const CORVID_BOX = 100;

export type CorvidPart = "body" | "beak" | "chest" | "wing" | "tail1" | "tail2";

/** Every part, in drawing order. The beak draws last, over the crown. */
export const CORVID_PART_ORDER: readonly CorvidPart[] = [
  "body",
  "chest",
  "wing",
  "tail1",
  "tail2",
  "beak",
];

/** Path data for each part: absolute `M` and `C` commands only. */
export const CORVID_PATHS: Readonly<Record<CorvidPart, string>> = {
  body: "M65.5 22.9 C65 22.5 64.4 21.8 62.7 20.8 C60.9 19.7 57.5 17.7 54.8 16.8 C52 15.9 49.1 15.4 46.2 15.2 C43.3 15.1 40.4 15.3 37.6 15.9 C34.9 16.5 31.4 18 29.7 18.8 C28.1 19.6 28.9 19.7 27.6 20.6 C26.3 21.5 23.8 22.6 21.9 24.3 C20 26 17.6 28.8 16.1 30.7 C14.7 32.6 14.2 33.6 13.3 35.8 C12.3 37.9 11.1 41.4 10.5 43.7 C9.9 45.9 9.9 47.5 9.8 49.4 C9.7 51.3 9.8 53.2 10 55.1 C10.2 57 10.5 58.9 11.1 60.8 C11.6 62.7 12.2 64.6 13.1 66.5 C14 68.5 15.1 70.4 16.6 72.3 C18.1 74.2 20.4 76.6 22.1 78 C23.7 79.4 24.9 80 26.3 80.9 C27.7 81.7 29 82.3 30.5 82.8 C31.9 83.4 33.3 83.8 34.8 84.1 C36.2 84.3 37.6 84.5 39 84.3 C40.4 84 42.5 83.1 43.2 82.8",
  beak: "M27.1 21.1 C28.1 21.1 31.4 20.7 33.3 20.8 C35.2 21 37 21.5 38.3 22.2 C39.6 22.9 40.3 24.6 41.2 25.2 C42.1 25.9 42.6 25.7 43.7 25.9 C44.8 26.2 46.1 26.1 47.6 26.8 C49.1 27.6 51.6 29.6 52.6 30.6 C53.7 31.5 53.7 32.2 53.9 32.6 M53.9 32.6 C52.8 32.4 49.6 31.6 47.6 31.6 C45.6 31.5 43.2 32 41.9 32.3 C40.6 32.5 40.5 32.6 39.8 33.1 C39 33.6 38.3 34.3 37.6 35.1 C36.9 35.9 36.1 37 35.6 37.9 C35.2 38.9 34.9 39.4 34.7 40.8 C34.4 42.2 34.2 44.7 34.3 46.5 C34.4 48.4 34.9 50.6 35.3 51.9 C35.7 53.2 36.3 53.8 36.5 54.2",
  chest:
    "M26.7 38.3 C26.5 38.7 25.8 39.4 25.3 40.8 C24.7 42.2 23.7 45.1 23.4 46.5 C23.1 47.9 23.1 47.9 23.3 49.4 C23.5 50.8 23.8 53.2 24.6 55.1 C25.3 57 26.4 58.9 28 60.8 C29.7 62.7 31.7 64.6 34.4 66.5 C37.1 68.5 42.2 70.8 44.1 72.3 C46.1 73.7 45.9 74.2 46.3 75.1 C46.7 76.1 46.6 77 46.5 78 C46.3 78.9 46 80 45.5 80.9 C44.9 81.7 43.5 82.5 43.2 82.8",
  wing: "M75.9 72.3 C74 70 67.6 61.8 64.8 58.4 C62 55 61 53.9 59.1 51.9 C57.2 49.9 55.3 48 53.4 46.5 C51.4 45 49.2 43.7 47.6 42.9 C46 42.2 44.8 42.2 43.7 42 C42.6 41.9 41.8 41.9 40.8 42.2 C39.9 42.5 38.7 43.1 38 43.8 C37.2 44.6 36.6 45.5 36.4 46.9 C36.1 48.2 36.2 50.7 36.3 51.9 C36.3 53.1 36.2 53.4 36.5 54.2 C36.9 55 37.3 55.4 38.3 56.5 C39.3 57.6 41.1 59.6 42.5 60.8 C43.9 62 44.3 62.4 46.8 63.7 C49.3 65 54.2 67.3 57.6 68.5 C61.1 69.7 64.1 70.5 67.7 71.1 C71.2 71.7 76.2 72.3 79.1 72.4 C82 72.4 83.3 71.9 84.8 71.5 C86.4 71.1 87.8 70.2 88.4 69.9",
  tail1:
    "M75.9 72.3 C76.4 72.8 77.6 74.2 79.1 75.6 C80.6 76.9 83.1 79.2 84.8 80.4 C86.5 81.6 88.4 82.4 89.3 82.9 C90.2 83.4 90.2 83.3 90.2 83.5 C90.2 83.8 89.8 84.1 89.3 84.3 C88.8 84.4 88.6 84.5 87.3 84.6 C86.1 84.7 83.8 85.1 82 84.7 C80.1 84.3 78.6 83.7 76.2 82.4 C73.9 81 70 78.1 67.7 76.7 C65.3 75.3 63.8 74.4 61.9 74 C60 73.5 57.6 73.8 56.2 74.1 C54.8 74.5 54.3 75 53.4 75.8 C52.4 76.7 51.4 78.1 50.5 79.2 C49.6 80.4 48.9 82.1 48 83 C47.1 83.9 45.8 84.5 45.3 84.8",
  tail2:
    "M45.3 84.8 C46.2 84.7 49.2 84.5 50.5 84.3 C51.8 84.1 51.9 84.1 53.4 83.6 C54.8 83.1 57.6 81.9 59.1 81.2 C60.5 80.5 61.3 80 61.9 79.5 C62.6 79 62.8 78.4 63 78.2",
};

/** The filled eye. Its colour is the `--color-corvid-eye` token, never the stroke. */
export const CORVID_EYE = { cx: 34.2, cy: 27.7, r: 3 } as const;

/** Stroke width for the full mark, from 24 px up. */
export const MARK_STROKE = 3.6;

/**
 * Stroke width for the glyph, the 16 and 32 px subset. The plan started at 6
 * and the 16 px tab-strip render did not read as a bird until 7; at 8 the
 * beak and the wing merge.
 */
export const GLYPH_STROKE = 7;

/** The glyph's eye. One unit wider than the mark's, so it survives 32 px. */
export const GLYPH_EYE_R = 4;

/** The parts the glyph keeps. No chest, no tail. */
export const GLYPH_PARTS: readonly CorvidPart[] = ["body", "beak", "wing"];

/**
 * The tile: the gradient rounded square behind the glyph in the tab strip
 * and on a home screen. Literal colours, because a favicon cannot read CSS
 * tokens and librsvg does not resolve them either.
 */
export const TILE = {
  box: 64,
  radius: 14,
  /** How far the glyph's ink stays from the tile's edge, in box units. */
  glyphInset: 5,
  gradientFrom: "#00628a",
  gradientTo: "#47befd",
  ink: "#ffffff",
  eye: "#47befd",
} as const;

/** Brand colours for renders outside the app, where no token applies. */
export const BRAND = {
  /** The light primary, `--color-primary` in `src/index.css`. */
  mark: "#006a91",
  /** `--color-corvid-eye` in the light palette. */
  eyeLight: "#47befd",
  /** `--color-corvid-eye` in the dark palette. */
  eyeDark: "#7fd6ff",
} as const;

// ---------------------------------------------------------------------------
// Geometry helpers. Pure, so the build script, the components and the tests
// all measure the drawing the same way.
// ---------------------------------------------------------------------------

export type Point = readonly [number, number];

export interface PathCommand {
  cmd: "M" | "C";
  points: Point[];
}

/**
 * Parse one path string. Only absolute `M` and `C` are accepted, which is
 * all this file emits; anything else throws, so a hand edit that slips in a
 * relative command fails the unit test instead of drawing something odd.
 */
export function parsePath(d: string): PathCommand[] {
  const out: PathCommand[] = [];
  const tokens = d.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;
    const cmd = token[0];
    if (cmd !== "M" && cmd !== "C") {
      throw new Error(`Unsupported path command "${token}" in "${d}"`);
    }
    const count = cmd === "M" ? 1 : 3;
    const numbers = [token.slice(1), ...tokens.slice(i + 1, i + count * 2)];
    if (numbers.length !== count * 2) {
      throw new Error(`Short ${cmd} command at "${token}" in "${d}"`);
    }
    const values = numbers.map((n) => {
      if (!/^-?\d+(\.\d+)?$/.test(n)) {
        throw new Error(`Bad number "${n}" in "${d}"`);
      }
      return Number(n);
    });
    const points: Point[] = [];
    for (let j = 0; j < values.length; j += 2) {
      points.push([values[j]!, values[j + 1]!]);
    }
    out.push({ cmd, points });
    i += count * 2;
  }
  return out;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A point on a cubic Bézier. */
function cubic(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
    a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1],
  ];
}

/**
 * The box the given paths' ink occupies, with `stroke` on. Every cubic is
 * sampled twenty times, which is exact enough for placing the glyph on the
 * tile and for the padding test.
 */
export function pathBounds(paths: readonly string[], stroke = 0): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = ([x, y]: Point) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const d of paths) {
    let current: Point = [0, 0];
    for (const { cmd, points } of parsePath(d)) {
      if (cmd === "M") {
        current = points[0]!;
        take(current);
        continue;
      }
      const [c1, c2, p1] = points as [Point, Point, Point];
      for (let s = 1; s <= 20; s++) take(cubic(current, c1, c2, p1, s / 20));
      current = p1;
    }
  }
  const half = stroke / 2;
  return {
    minX: minX - half,
    minY: minY - half,
    maxX: maxX + half,
    maxY: maxY + half,
  };
}

export interface Placement {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * Where the glyph goes on a square of `box` units so that its ink, stroke
 * included, fills the square minus `inset` on every side and sits centred.
 * The result is an SVG `translate(tx ty) scale(scale)` for a group holding
 * the glyph paths in their own 100-unit coordinates.
 */
export function fitGlyph(box: number, inset: number): Placement {
  const ink = pathBounds(
    GLYPH_PARTS.map((part) => CORVID_PATHS[part]),
    GLYPH_STROKE,
  );
  const width = ink.maxX - ink.minX;
  const height = ink.maxY - ink.minY;
  const scale = (box - 2 * inset) / Math.max(width, height);
  const tx = (box - width * scale) / 2 - ink.minX * scale;
  const ty = (box - height * scale) / 2 - ink.minY * scale;
  return {
    scale: round(scale),
    tx: round(tx),
    ty: round(ty),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
