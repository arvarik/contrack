/**
 * build-icons: every brand asset, from the one drawing in
 * `src/assets/corvidPaths.ts`.
 *
 *   npm run brand:icons
 *
 * What the app serves, in `public/`:
 *
 *   favicon-16.png            a tab at 1x: the tiny master, fitted to the pixels
 *   favicon-32.png            a tab at 2x: the small master, fitted to the pixels
 *   favicon-48.png            a tab at 3x, and search results: small
 *   favicon.ico               the three frames above, for everything that asks
 *                             for /favicon.ico
 *   apple-touch-icon.png      180, square and opaque, for iOS to round: medium
 *   icon-192.png, -512.png    the rounded tile, for launchers: medium
 *   icon-maskable-192.png, icon-maskable-512.png
 *                             full bleed, the bird inside the safe circle
 *   og-image.png              1200 by 630, the link preview
 *
 * The brand kit, in `docs/brand/` (its README says what each file is for):
 *
 *   corvid-mark.svg, .png             the logo on a light ground
 *   corvid-mark-dark.svg, .png        the logo on a dark ground
 *   corvid-mark-black.svg             one colour, for print
 *   corvid-mark-white.svg             one colour, reversed
 *   corvid-app-icon.svg, -1024.png    the app icon's master
 *   contrack-lockup.svg, .png         the mark and the name, light ground
 *   contrack-lockup-dark.svg, .png    the same, dark ground
 *   social-preview.png                1280 by 640, the repository's card
 *   corvid-optical-sizes.png          the four masters at the sizes they serve
 *   corvid-mark-variants.png          the four colour versions on their grounds
 *   corvid-poses.svg, .png            the model sheet (see `poseSheet.ts`)
 *
 * Every colour here is a literal from `BRAND` and `TILE`. A favicon cannot
 * read CSS tokens, and librsvg, which sharp rasterises through, does not
 * resolve `var()` either. `tests/unit/brand.paths.test.ts` checks each
 * literal against the token it copies. Every word is an outline in the
 * app's own faces (see `type.ts`), so no render depends on the fonts the
 * machine has.
 *
 * The outputs are committed. `tests/unit/brand.icons.test.ts` renders every
 * SVG again and compares it with the committed file, byte for byte, so a
 * change to the paths, the masters or the fonts without a rebuild fails CI.
 * It checks each raster's size and the icon file's frames. A raster's bytes
 * depend on the libvips and librsvg of the machine that drew it, so they
 * are not compared.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp, { type OverlayOptions } from "sharp";
import {
  BRAND,
  CORVID_BOX,
  CORVID_EYE,
  CORVID_OPTICAL,
  CORVID_PATHS,
  TILE,
  fitMark,
  samplePath,
  type OpticalMaster,
  type Placement,
} from "../../src/assets/corvidPaths.ts";
import { renderPoseSheet } from "./poseSheet.ts";
import { face, outline, textPath, wrap, type FaceName } from "./type.ts";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const PUBLIC = path.join(ROOT, "public");
const BRAND_DIR = path.join(ROOT, "docs", "brand");

const { tiny, small, medium, large } = CORVID_OPTICAL;

/**
 * A maskable icon's safe zone: the circle of 40 percent of its width about
 * its middle. A launcher may crop the icon to any shape that holds it.
 */
export const MASKABLE_SAFE_RADIUS = 0.4;

/** The name is set as every heading in the app: `tracking-tight`. */
const NAME_TRACKING = -0.025;

const round = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// SVG builders
// ---------------------------------------------------------------------------

/** A master's paths and eye in a group placed by `placement`, as SVG lines. */
function markGroup(
  master: OpticalMaster,
  { scale, tx, ty }: Placement,
  ink: string,
  eye: string,
  indent: string,
): string[] {
  return [
    `${indent}<g transform="translate(${tx} ${ty}) scale(${scale})" fill="none" stroke="${ink}" stroke-width="${master.stroke}" stroke-linecap="round" stroke-linejoin="round">`,
    ...master.parts.map(
      (part) => `${indent}  <path d="${CORVID_PATHS[part]}" />`,
    ),
    ...(master.eye > 0
      ? [
          `${indent}  <circle cx="${CORVID_EYE.cx}" cy="${CORVID_EYE.cy}" r="${master.eye}" fill="${eye}" stroke="none" />`,
        ]
      : []),
    `${indent}</g>`,
  ];
}

interface TileOptions {
  master: OpticalMaster;
  /** Pixel size for a raster. Left out of an SVG master, which scales. */
  size?: number;
  /** Corner radius, in the tile's 64 units. 0 is full bleed. */
  radius?: number;
  /** How far the ink keeps from the edge, in the tile's units. */
  inset?: number;
  /** A shift of the bird, in device pixels, onto the pixel grid. */
  nudge?: readonly [number, number];
  /** The ink alone, white on black, to measure how sharply it lands. */
  inkOnly?: boolean;
  comment?: string;
}

/** The tile's ground and bird, as SVG lines in its 64-unit box. */
function tileBody(
  {
    master,
    size,
    radius = TILE.radius,
    inset = master.tileInset,
    nudge = [0, 0],
    inkOnly = false,
  }: TileOptions,
  indent: string,
): string[] {
  const box = TILE.box;
  const placed = fitMark(master, box, inset);
  const unitsPerPixel = size ? box / size : 0;
  const placement = {
    scale: placed.scale,
    tx: round(placed.tx + nudge[0] * unitsPerPixel),
    ty: round(placed.ty + nudge[1] * unitsPerPixel),
  };
  const ground = inkOnly
    ? [`${indent}<rect width="${box}" height="${box}" fill="#000000" />`]
    : [
        `${indent}<defs>`,
        `${indent}  <linearGradient id="contrack-tile" x1="0" y1="0" x2="1" y2="1">`,
        `${indent}    <stop offset="0" stop-color="${TILE.gradientFrom}" />`,
        `${indent}    <stop offset="1" stop-color="${TILE.gradientTo}" />`,
        `${indent}  </linearGradient>`,
        `${indent}</defs>`,
        `${indent}<rect width="${box}" height="${box}" rx="${radius}" fill="url(#contrack-tile)" />`,
      ];
  return [
    ...ground,
    ...markGroup(
      master,
      placement,
      TILE.ink,
      inkOnly ? TILE.ink : TILE.eye,
      indent,
    ),
  ];
}

/** The tile with a master on it, as a document. */
function tileSvg(options: TileOptions): string {
  const box = TILE.box;
  const dims = options.size
    ? ` width="${options.size}" height="${options.size}"`
    : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}"${dims} role="img" aria-label="Contrack">`,
    `  <title>Contrack</title>`,
    ...(options.comment ? [options.comment] : []),
    ...tileBody(options, "  "),
    `</svg>`,
    ``,
  ].join("\n");
}

/** The four colour versions of the logo, for the brand kit. */
export const MARK_VARIANTS = {
  "corvid-mark": {
    ink: BRAND.mark,
    eye: BRAND.eyeLight,
    use: "The logo on a light ground: the primary, with the cyan eye.",
  },
  "corvid-mark-dark": {
    ink: BRAND.markDark,
    eye: BRAND.eyeDark,
    use: "The logo on a dark ground: the dark palette's primary and eye.",
  },
  "corvid-mark-black": {
    ink: "#000000",
    eye: "#000000",
    use: "One colour, for print and for a surface that takes one ink.",
  },
  "corvid-mark-white": {
    ink: "#ffffff",
    eye: "#ffffff",
    use: "One colour, reversed out of a photograph or a brand colour.",
  },
} as const;
export type MarkVariant = keyof typeof MARK_VARIANTS;

/** The logo, `large`, in its own 100-unit box, which holds its clear margin. */
export function renderMarkSvg(variant: MarkVariant, size?: number): string {
  const { ink, eye, use } = MARK_VARIANTS[variant];
  const dims = size ? ` width="${size}" height="${size}"` : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CORVID_BOX} ${CORVID_BOX}"${dims} role="img" aria-label="Contrack">`,
    `  <title>Contrack</title>`,
    `  <!-- ${use} Generated by scripts/brand/build-icons.ts from src/assets/corvidPaths.ts. Do not edit. -->`,
    ...markGroup(large, { scale: 1, tx: 0, ty: 0 }, ink, eye, "  "),
    `</svg>`,
    ``,
  ].join("\n");
}

const APP_ICON_COMMENT = `  <!--
    The Contrack app icon: the corvid, medium optical size, white on the
    tile. The source of every launcher, home screen and store icon.

    Generated by scripts/brand/build-icons.ts from src/assets/corvidPaths.ts.
    Do not edit this file. Change the paths or CORVID_OPTICAL, run
    \`npm run brand:icons\`, and commit what it writes.
  -->`;

/** `docs/brand/corvid-app-icon.svg`, byte for byte. */
export function renderAppIconSvg(): string {
  return tileSvg({ master: medium, comment: APP_ICON_COMMENT });
}

/**
 * The lockup: the mark and the name, in the proportions of `<Wordmark>`.
 * The name is set at 0.7 of the mark's height, tracked as the app's
 * headings are, and its ink is centred on the mark's. The gap is the
 * component's 8 px at 28 px, scaled. The box keeps the mark's own side
 * margin after the name too. Units are pixels at the PNG's size.
 */
export async function renderLockupSvg(dark: boolean): Promise<string> {
  const height = 240;
  const name = outline(
    await face("name"),
    "Contrack",
    height * 0.7,
    NAME_TRACKING,
  );
  const gap = r2((height * 8) / 28);
  const margin = r2((height * 8) / CORVID_BOX);
  const inkWidth = name.ink.right - name.ink.left;
  const width = r2(height + gap + inkWidth + margin);
  const baseline = height / 2 - (name.ink.top + name.ink.bottom) / 2;
  const variant = MARK_VARIANTS[dark ? "corvid-mark-dark" : "corvid-mark"];
  const scale = height / CORVID_BOX;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Contrack">`,
    `  <title>Contrack</title>`,
    `  <!-- The mark and the name, for a ${dark ? "dark" : "light"} ground. Generated by scripts/brand/build-icons.ts. Do not edit. -->`,
    ...markGroup(
      large,
      { scale, tx: 0, ty: 0 },
      variant.ink,
      variant.eye,
      "  ",
    ),
    `  ${textPath(name, height + gap - name.ink.left, baseline, dark ? BRAND.onSurfaceDark : BRAND.onSurface)}`,
    `</svg>`,
    ``,
  ].join("\n");
}

/**
 * A link card: the app icon at left, the name and one line of the
 * description at right, the group centred on the light surface. The link
 * preview is 1200 by 630 and the repository card 1280 by 640. Everything
 * scales with the height, so the two are one composition.
 */
export async function renderCardSvg(
  width: number,
  height: number,
  description: string,
): Promise<string> {
  const k = height / 630;
  const tileSize = 300 * k;
  const nameFace = await face("name");
  const bodyFace = await face("body");
  const name = outline(nameFace, "Contrack", 128 * k, NAME_TRACKING);
  const taglinePx = 32 * k;
  const lines = wrap(bodyFace, description, taglinePx, 680 * k).map((line) =>
    outline(bodyFace, line, taglinePx),
  );
  const leading = taglinePx * 1.4;

  // The block: the name's ink, then the tagline, one line under the other.
  const nameAbove = -name.ink.top;
  const firstLineGap = 30 * k + taglinePx * 0.75;
  const blockHeight = nameAbove + firstLineGap + (lines.length - 1) * leading;
  const nameBaseline = (height - blockHeight) / 2 + nameAbove;

  const textWidth = Math.max(
    name.ink.right - name.ink.left,
    ...lines.map((line) => line.ink.right - line.ink.left),
  );
  const gap = 80 * k;
  const left = (width - (tileSize + gap + textWidth)) / 2;
  const textLeft = left + tileSize + gap;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `  <rect width="${width}" height="${height}" fill="${BRAND.surface}" />`,
    `  <svg x="${r2(left)}" y="${r2((height - tileSize) / 2)}" width="${r2(tileSize)}" height="${r2(tileSize)}" viewBox="0 0 ${TILE.box} ${TILE.box}">`,
    ...tileBody({ master: medium, size: tileSize }, "    "),
    `  </svg>`,
    `  ${textPath(name, textLeft - name.ink.left, nameBaseline, BRAND.onSurface)}`,
    ...lines.map(
      (line, i) =>
        `  ${textPath(line, textLeft - line.ink.left, nameBaseline + firstLineGap + i * leading, BRAND.onSurfaceVariant)}`,
    ),
    `</svg>`,
    ``,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Raster
// ---------------------------------------------------------------------------

function png(svg: string, density = 72): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * How soft a render of the ink alone is: the share of each pixel that is
 * neither ink nor ground, summed. A stroke that lands on whole pixels
 * scores low. A stroke that straddles two scores high, and reads as blur.
 */
async function blurOf(svg: string): Promise<number> {
  const { data } = await sharp(Buffer.from(svg), { density: 72 })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let blur = 0;
  for (const value of data) {
    const ink = value / 255;
    blur += Math.min(ink, 1 - ink);
  }
  return blur;
}

/**
 * The shift, in eighths of a pixel, that lands the most of a small icon's
 * ink on whole pixels. At 16 and 32 px a stroke is one or two pixels wide,
 * and a quarter pixel decides whether it reads as a line or a smear. Ties
 * keep the smallest shift, so the bird stays nearest the middle.
 */
async function fitToPixels(
  master: OpticalMaster,
  size: number,
): Promise<readonly [number, number]> {
  let best: readonly [number, number] = [0, 0];
  let bestBlur = Infinity;
  for (let i = -4; i < 4; i++) {
    for (let j = -4; j < 4; j++) {
      const nudge = [i / 8, j / 8] as const;
      const blur = await blurOf(
        tileSvg({ master, size, nudge, inkOnly: true }),
      );
      const nearer = Math.hypot(...nudge) < Math.hypot(...best);
      if (blur < bestBlur - 1e-6 || (blur < bestBlur + 1e-6 && nearer)) {
        best = nudge;
        bestBlur = blur;
      }
    }
  }
  return best;
}

/** A small favicon: the master on the tile, fitted to its pixels. */
async function favicon(master: OpticalMaster, size: number): Promise<Buffer> {
  const nudge = await fitToPixels(master, size);
  return png(tileSvg({ master, size, nudge }));
}

/**
 * A Windows icon file of PNG frames, the one format every browser, Windows
 * and the crawlers that ask for `/favicon.ico` all read.
 */
export function icoFile(
  frames: readonly { size: number; png: Buffer }[],
): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1: an icon, not a cursor
  header.writeUInt16LE(frames.length, 4);
  const directory = Buffer.alloc(16 * frames.length);
  let offset = header.length + directory.length;
  frames.forEach(({ size, png: data }, i) => {
    const at = i * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, at);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2); // no palette
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits a pixel
    directory.writeUInt32LE(data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, directory, ...frames.map((f) => f.png)]);
}

/** How far a master's ink reaches from the middle of a tile, in its units. */
export function inkReach(master: OpticalMaster, inset: number): number {
  const { scale, tx, ty } = fitMark(master, TILE.box, inset);
  const middle = TILE.box / 2;
  let reach = 0;
  for (const part of master.parts) {
    for (const [x, y] of samplePath(CORVID_PATHS[part])) {
      reach = Math.max(
        reach,
        Math.hypot(x * scale + tx - middle, y * scale + ty - middle),
      );
    }
  }
  return reach + (master.stroke / 2) * scale;
}

/**
 * The inset that keeps a master's ink inside a maskable icon's safe circle,
 * to a hundredth of a unit, found by halving.
 */
export function maskableInset(master: OpticalMaster): number {
  const limit = MASKABLE_SAFE_RADIUS * TILE.box;
  let fits = TILE.box / 2;
  let spills = 0;
  for (let i = 0; i < 40; i++) {
    const mid = (fits + spills) / 2;
    if (inkReach(master, mid) <= limit) fits = mid;
    else spills = mid;
  }
  return Math.ceil(fits * 100) / 100;
}

/**
 * The first sentence of the site description in `index.html`, after the
 * "Contrack" lead-in, so the preview and the meta tag say the same thing.
 */
export function descriptionLine(indexHtml: string): string {
  const meta = indexHtml.match(/name="description"\s+content="([^"]+)"/);
  if (!meta) throw new Error("index.html has no description meta");
  const body = meta[1]!
    .split(/\s[—-]\s/)
    .pop()!
    .trim();
  const sentence = body.match(/^(.*?\.)(\s|$)/);
  return sentence ? sentence[1]! : body;
}

/** The site description's first sentence, read from `index.html`. */
async function description(): Promise<string> {
  return descriptionLine(await readFile(path.join(ROOT, "index.html"), "utf8"));
}

/** A caption for a reference sheet, as a PNG of its outlines. */
async function caption(
  content: string,
  px: number,
  colour: string,
  faceName: FaceName = "body",
): Promise<Buffer> {
  const line = outline(await face(faceName), content, px);
  const width = Math.ceil(line.advance + 4);
  const height = Math.ceil(px * 1.4);
  return png(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${textPath(line, 0, px * 1.05, colour)}</svg>`,
  );
}

async function sizeOf(image: Buffer): Promise<{ w: number; h: number }> {
  const meta = await sharp(image).metadata();
  return { w: meta.width!, h: meta.height! };
}

/**
 * The optical sizes, for the brand guide: each master at the size it
 * serves, once magnified so every pixel shows, and once at its true size.
 */
async function opticalSheet(): Promise<Buffer> {
  const cell = 224;
  const pad = 32;
  const columns: {
    title: string;
    note: string;
    pixels: Buffer;
    actual: Buffer;
  }[] = [
    {
      title: "tiny",
      note: "16 px: a tab at 1x",
      pixels: await favicon(tiny, 16),
      actual: await favicon(tiny, 16),
    },
    {
      title: "small",
      note: "32 px: a tab at 2x",
      pixels: await favicon(small, 32),
      actual: await favicon(small, 32),
    },
    {
      title: "medium",
      note: "64 px: launcher icons",
      pixels: await png(tileSvg({ master: medium, size: 64 })),
      actual: await png(tileSvg({ master: medium, size: 64 })),
    },
    {
      title: "large",
      note: "the logo, 96 pt and up",
      pixels: await png(renderMarkSvg("corvid-mark", cell)),
      actual: await png(renderMarkSvg("corvid-mark", 64)),
    },
  ];
  const width = pad + columns.length * (cell + pad);
  const height = pad + 64 + cell + 24 + 64 + pad;
  const layers: OverlayOptions[] = [];
  for (const [i, column] of columns.entries()) {
    const left = pad + i * (cell + pad);
    layers.push({
      input: await caption(column.title, 20, BRAND.onSurface, "label"),
      left,
      top: pad,
    });
    layers.push({
      input: await caption(column.note, 15, BRAND.onSurfaceVariant),
      left,
      top: pad + 30,
    });
    const { w } = await sizeOf(column.pixels);
    const magnified =
      w === cell
        ? column.pixels
        : await sharp(column.pixels)
            .resize(cell, cell, { kernel: "nearest" })
            .png()
            .toBuffer();
    layers.push({ input: magnified, left, top: pad + 64 });
    layers.push({ input: column.actual, left, top: pad + 64 + cell + 24 });
  }
  return sharp({
    create: { width, height, channels: 4, background: BRAND.surface },
  })
    .composite(layers)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** The four colour versions of the logo on the grounds they are for. */
async function variantSheet(): Promise<Buffer> {
  const cell = 200;
  const pad = 24;
  const grounds: [MarkVariant, string, string][] = [
    ["corvid-mark", BRAND.surface, "light ground"],
    ["corvid-mark-dark", BRAND.surfaceDark, "dark ground"],
    ["corvid-mark-black", "#ffffff", "one colour"],
    ["corvid-mark-white", BRAND.mark, "reversed"],
  ];
  const width = pad + grounds.length * (cell + pad);
  const height = pad + cell + 12 + 24 + pad;
  const layers: OverlayOptions[] = [];
  for (const [i, [variant, ground, label]] of grounds.entries()) {
    const left = pad + i * (cell + pad);
    const swatch = await sharp({
      create: { width: cell, height: cell, channels: 4, background: ground },
    })
      .composite([{ input: await png(renderMarkSvg(variant, cell)) }])
      .png()
      .toBuffer();
    layers.push({ input: swatch, left, top: pad });
    layers.push({
      input: await caption(label, 15, BRAND.onSurfaceVariant),
      left,
      top: pad + cell + 12,
    });
  }
  return sharp({
    create: { width, height, channels: 4, background: BRAND.surface },
  })
    .composite(layers)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export async function build(): Promise<string[]> {
  await mkdir(BRAND_DIR, { recursive: true });

  const favicon16 = await favicon(tiny, 16);
  const favicon32 = await favicon(small, 32);
  const favicon48 = await png(tileSvg({ master: small, size: 48 }));
  const launcher = (size: number) => png(tileSvg({ master: medium, size }));
  const maskable = (size: number) =>
    png(
      tileSvg({
        master: medium,
        size,
        radius: 0,
        inset: maskableInset(medium),
      }),
    );
  const line = await description();
  const lockupLight = await renderLockupSvg(false);
  const lockupDark = await renderLockupSvg(true);

  const outputs: Array<[string, Buffer | string]> = [
    [path.join(PUBLIC, "favicon-16.png"), favicon16],
    [path.join(PUBLIC, "favicon-32.png"), favicon32],
    [path.join(PUBLIC, "favicon-48.png"), favicon48],
    [
      path.join(PUBLIC, "favicon.ico"),
      icoFile([
        { size: 16, png: favicon16 },
        { size: 32, png: favicon32 },
        { size: 48, png: favicon48 },
      ]),
    ],
    // Square and opaque: iOS rounds the corners itself, and fills any
    // transparency with black.
    [
      path.join(PUBLIC, "apple-touch-icon.png"),
      await png(tileSvg({ master: medium, size: 180, radius: 0 })),
    ],
    [path.join(PUBLIC, "icon-192.png"), await launcher(192)],
    [path.join(PUBLIC, "icon-512.png"), await launcher(512)],
    [path.join(PUBLIC, "icon-maskable-192.png"), await maskable(192)],
    [path.join(PUBLIC, "icon-maskable-512.png"), await maskable(512)],
    [
      path.join(PUBLIC, "og-image.png"),
      await png(await renderCardSvg(1200, 630, line)),
    ],

    ...(Object.keys(MARK_VARIANTS) as MarkVariant[]).map(
      (variant): [string, string] => [
        path.join(BRAND_DIR, `${variant}.svg`),
        renderMarkSvg(variant),
      ],
    ),
    [
      path.join(BRAND_DIR, "corvid-mark.png"),
      await png(renderMarkSvg("corvid-mark", 512)),
    ],
    [
      path.join(BRAND_DIR, "corvid-mark-dark.png"),
      await png(renderMarkSvg("corvid-mark-dark", 512)),
    ],
    [path.join(BRAND_DIR, "corvid-app-icon.svg"), renderAppIconSvg()],
    [
      path.join(BRAND_DIR, "corvid-app-icon-1024.png"),
      await png(tileSvg({ master: medium, size: 1024 })),
    ],
    [path.join(BRAND_DIR, "contrack-lockup.svg"), lockupLight],
    [path.join(BRAND_DIR, "contrack-lockup.png"), await png(lockupLight)],
    [path.join(BRAND_DIR, "contrack-lockup-dark.svg"), lockupDark],
    [path.join(BRAND_DIR, "contrack-lockup-dark.png"), await png(lockupDark)],
    [
      path.join(BRAND_DIR, "social-preview.png"),
      await png(await renderCardSvg(1280, 640, line)),
    ],
    [path.join(BRAND_DIR, "corvid-optical-sizes.png"), await opticalSheet()],
    [path.join(BRAND_DIR, "corvid-mark-variants.png"), await variantSheet()],
    [path.join(BRAND_DIR, "corvid-poses.svg"), renderPoseSheet()],
    [
      path.join(BRAND_DIR, "corvid-poses.png"),
      await png(renderPoseSheet(), 144),
    ],
  ];

  for (const [file, content] of outputs) {
    await writeFile(file, content);
  }
  return outputs.map(([file]) => path.relative(ROOT, file));
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const written = await build();
  for (const file of written) console.log(`wrote ${file}`);
}
