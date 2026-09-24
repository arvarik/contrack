/**
 * type: the brand's typefaces as outlines, for the images that carry words.
 *
 * The link preview, the repository card and the lockups set the name in
 * Manrope ExtraBold and the line under it in Inter, the app's own headline
 * and body faces. They read the WOFF2 files the app serves from
 * `public/fonts`, so an image cannot drift from the page, and they draw each
 * word as SVG outlines, so a render is the same on every machine: no font
 * lookup and no fallback face.
 *
 * That is the reason for this file. sharp sets text through Pango, and on
 * macOS Pango finds fonts through the system, not through the file it is
 * given. Manrope is not a system font, so the name in the link preview came
 * out in Helvetica. Outlines from `fontkit` match the browser: "Contrack" at
 * 128 px, ExtraBold, `letter-spacing: -0.025em`, measures 559.70 px here and
 * 559.75 px in Chromium.
 *
 * The files are variable fonts (Manrope 200 to 800, Inter 100 to 900), so a
 * weight is a point on the `wght` axis. `fontkit` cannot take a weight from
 * a WOFF2 font directly, so `wawoff2` unpacks it to TrueType first.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";
import wawoff2 from "wawoff2";

const FONTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/fonts",
);

/** The faces the brand sets words in: the app's `font-headline` and `font-body`. */
export const FACES = {
  /** The name, as every heading in the app: Manrope at 800. */
  name: { file: "manrope-latin.woff2", weight: 800 },
  /** Running text: Inter at 400. */
  body: { file: "inter-latin.woff2", weight: 400 },
  /** A label: Inter at 700. */
  label: { file: "inter-latin.woff2", weight: 700 },
} as const;
export type FaceName = keyof typeof FACES;

const loaded = new Map<FaceName, Promise<fontkit.Font>>();

/** One of the brand's faces, at its weight. Loaded once. */
export function face(name: FaceName): Promise<fontkit.Font> {
  let font = loaded.get(name);
  if (!font) {
    const { file, weight } = FACES[name];
    font = readFile(path.join(FONTS, file))
      .then((woff2) => wawoff2.decompress(woff2))
      .then((ttf) => {
        const whole = fontkit.create(Buffer.from(ttf));
        if (!("getVariation" in whole)) {
          throw new Error(`${file} is a collection, not one font`);
        }
        return whole.getVariation({ wght: weight });
      });
    loaded.set(name, font);
  }
  return font;
}

/** A line of text as outlines, in pixels, with its baseline at y 0. */
export interface Outline {
  /** SVG path data. y grows downward, as in SVG. */
  d: string;
  /** The pen's travel, tracking included: what CSS calls the width. */
  advance: number;
  /** The ink's box. `top` is negative: above the baseline. */
  ink: { left: number; top: number; right: number; bottom: number };
}

/**
 * One line set at `px`, with `tracking` in em after every character, as CSS
 * `letter-spacing` adds it. Kerning and ligatures come from the font.
 */
export function outline(
  font: fontkit.Font,
  content: string,
  px: number,
  tracking = 0,
): Outline {
  const k = px / font.unitsPerEm;
  const run = font.layout(content);
  const parts: string[] = [];
  let pen = 0;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  run.glyphs.forEach((glyph, i) => {
    const position = run.positions[i]!;
    const x = pen + position.xOffset * k;
    const y = -position.yOffset * k;
    const shape = glyph.path.scale(k, -k).translate(x, y);
    const d = shape.toSVG();
    if (d) {
      parts.push(d);
      const box = shape.bbox;
      left = Math.min(left, box.minX);
      top = Math.min(top, box.minY);
      right = Math.max(right, box.maxX);
      bottom = Math.max(bottom, box.maxY);
    }
    pen += position.xAdvance * k + tracking * px;
  });
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    d: parts.join(""),
    advance: round(pen),
    ink: {
      left: round(left),
      top: round(top),
      right: round(right),
      bottom: round(bottom),
    },
  };
}

/** How wide a line would be, tracking included. */
export function measure(
  font: fontkit.Font,
  content: string,
  px: number,
  tracking = 0,
): number {
  return outline(font, content, px, tracking).advance;
}

/** Words broken into lines no wider than `width`, greedily. */
export function wrap(
  font: fontkit.Font,
  content: string,
  px: number,
  width: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of content.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(font, next, px) > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** A line's outlines as an SVG path, its pen at `x` on the baseline `y`. */
export function textPath(
  line: Outline,
  x: number,
  y: number,
  fill: string,
): string {
  const round = (n: number) => Math.round(n * 100) / 100;
  return `<path transform="translate(${round(x)} ${round(y)})" fill="${fill}" d="${line.d}" />`;
}
