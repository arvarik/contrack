/**
 * color.ts — the colour maths the theme is built on.
 *
 * Pure functions, no DOM. Everything here is measured rather than asserted:
 * the accent picker has to guarantee that whatever colour somebody chooses,
 * the text painted in it still clears WCAG AA on every surface it lands on.
 * That guarantee is only worth something if the same numbers the browser will
 * compute are computed here first.
 *
 * Two colour spaces are used and they do different jobs.
 *
 * sRGB, and the WCAG relative-luminance formula over it, is what "contrast"
 * means. It is not perceptually uniform, so it is a poor space to move a
 * colour around in.
 *
 * OKLCH is perceptually uniform, so lowering L darkens a colour without
 * swinging its hue — which is exactly what deriving a readable primary from
 * somebody's favourite blue requires. Every derivation happens in OKLCH and
 * every check happens in sRGB.
 *
 * @module lib/color
 */

export interface Rgb {
  /** 0–255. */
  r: number;
  g: number;
  b: number;
}

export interface Oklch {
  /** Perceptual lightness, 0–1. */
  l: number;
  /** Chroma. 0 is grey; about 0.37 is the most sRGB can hold. */
  c: number;
  /** Hue angle in degrees, 0–360. */
  h: number;
}

// ---------------------------------------------------------------------------
// Hex
// ---------------------------------------------------------------------------

/** `#rrggbb` or `#rgb` to channel values. Throws on anything else. */
export function hexToRgb(hex: string): Rgb {
  const text = hex.trim().replace(/^#/, "");
  const full =
    text.length === 3
      ? text
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : text;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

const channel = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

function toLinear(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function fromLinear(value: number): number {
  const v =
    value <= 0.0031308
      ? value * 12.92
      : 1.055 * Math.pow(Math.max(value, 0), 1 / 2.4) - 0.055;
  return v * 255;
}

/** WCAG relative luminance, 0–1. */
export function luminance(color: Rgb): number {
  return (
    0.2126 * toLinear(color.r) +
    0.7152 * toLinear(color.g) +
    0.0722 * toLinear(color.b)
  );
}

/** WCAG contrast ratio, 1–21. Symmetric: the order of the two does not matter. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Composite a translucent colour over an opaque one.
 *
 * This is what makes the check honest. The binding contrast case in this app
 * is not text on a card; it is a pill where `text-primary` sits on a
 * `bg-primary/15` wash of itself, over whatever is behind that.
 */
export function over(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return {
    r: top.r * alpha + bottom.r * (1 - alpha),
    g: top.g * alpha + bottom.g * (1 - alpha),
    b: top.b * alpha + bottom.b * (1 - alpha),
  };
}

// ---------------------------------------------------------------------------
// OKLab / OKLCH
// ---------------------------------------------------------------------------
// Björn Ottosson's matrices, https://bottosson.github.io/posts/oklab/.

export function rgbToOklch(color: Rgb): Oklch {
  const r = toLinear(color.r);
  const g = toLinear(color.g);
  const b = toLinear(color.b);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const c = Math.sqrt(okA * okA + okB * okB);
  const h = c < 1e-7 ? 0 : ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360;
  return { l: okL, c, h };
}

function oklchToRgbRaw({ l, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const bb = c * Math.sin(rad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = l - 0.0894841775 * a - 1.291485548 * bb;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  return {
    r: fromLinear(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    g: fromLinear(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    b: fromLinear(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  };
}

const inGamut = ({ r, g, b }: Rgb) =>
  r >= -0.5 && r <= 255.5 && g >= -0.5 && g <= 255.5 && b >= -0.5 && b <= 255.5;

/**
 * OKLCH to sRGB, reducing chroma until the colour fits.
 *
 * A hue and lightness pair can name a colour no monitor can show. Clipping the
 * channels instead would shift the hue, which is what makes a "red" accent at
 * high lightness come back orange. Binary search on chroma keeps the hue and
 * the lightness and gives up only saturation, which is the one of the three
 * nobody notices losing.
 */
export function oklchToRgb(color: Oklch): Rgb {
  const direct = oklchToRgbRaw(color);
  if (inGamut(direct)) return clampRgb(direct);

  let lo = 0;
  let hi = color.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToRgbRaw({ ...color, c: mid }))) lo = mid;
    else hi = mid;
  }
  return clampRgb(oklchToRgbRaw({ ...color, c: lo }));
}

function clampRgb({ r, g, b }: Rgb): Rgb {
  return {
    r: Math.max(0, Math.min(255, r)),
    g: Math.max(0, Math.min(255, g)),
    b: Math.max(0, Math.min(255, b)),
  };
}

/** Same hue and chroma, a different perceptual lightness. */
export function withLightness(color: Oklch, l: number): Oklch {
  return { ...color, l: Math.max(0, Math.min(1, l)) };
}

/** Same hue and lightness, chroma scaled and capped. */
export function scaleChroma(color: Oklch, factor: number, max = 0.4): Oklch {
  return { ...color, c: Math.max(0, Math.min(max, color.c * factor)) };
}
