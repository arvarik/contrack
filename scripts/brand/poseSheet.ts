/**
 * poseSheet: the corvid's model sheet, drawn by its own rig.
 *
 * An animator's reference: the one bird in every pose it takes, in the ring
 * and out of it, sitting, working its wings, and in the air. Every cell is
 * `drawCorvid` on a pose, so the sheet is not a picture of the bird but the
 * bird, and it cannot drift from what the app draws: `npm run brand:icons`
 * writes it with the icons, and `tests/unit/brand.icons.test.ts` compares
 * the committed SVG with a fresh render.
 *
 * Every cell draws the bird at one scale, so a flying bird is exactly as big
 * as a sitting one: the reach of a wing is visible as reach, not shrunk to
 * fit its cell.
 */
import {
  corvidPathData,
  corvidPose,
  drawCorvid,
  type CorvidPose,
  type Vec,
} from "../../src/assets/corvidRig.ts";
import {
  BRAND,
  CORVID_PATHS,
  MARK_STROKE,
} from "../../src/assets/corvidPaths.ts";
import { wingbeat } from "../../src/lib/corvidFlight.ts";
import {
  createRng,
  makeDoze,
  makePreen,
  makeStretch,
  sampleMotion,
} from "../../src/lib/corvidMotion.ts";

interface Cell {
  label: string;
  pose: CorvidPose;
  /** Draw the ring the bird sits in. */
  ring?: boolean;
  /** Degrees clockwise, about the middle of the drawing. */
  rotate?: number;
  /** Upside down, halfway through a roll. */
  roll?: boolean;
}

const at = (
  make: (rng: () => number) => Parameters<typeof sampleMotion>[1],
  t: number,
) => sampleMotion(corvidPose(), make(createRng(1)), t);

const flying = (changes: Partial<CorvidPose> = {}) =>
  corvidPose({ flight: 1, nape: 1, headFacing: -1, wingSpread: 1, ...changes });

const glide = { wingAngle: -16, wingSpread: 1, wingCurl: 0.12, wingTurn: 1 };

/** The sheet, row by row. */
export const POSE_ROWS: { title: string; cells: Cell[] }[] = [
  {
    title: "In the ring",
    cells: [
      { label: "At home", pose: corvidPose(), ring: true },
      { label: "Looks up", pose: corvidPose({ headAngle: 12 }), ring: true },
      { label: "Looks down", pose: corvidPose({ headAngle: -14 }), ring: true },
      {
        label: "Looks back",
        pose: corvidPose({ headFacing: -1, headAngle: 4 }),
        ring: true,
      },
      { label: "Blinks", pose: corvidPose({ eye: 0 }), ring: true },
      {
        label: "Caws, silently",
        pose: corvidPose({
          beak: 1,
          headAngle: -10,
          headX: -1.8,
          crouch: 0.45,
          fluff: 0.35,
          tailAngle: -5,
        }),
        ring: true,
      },
      { label: "Preens", pose: at(makePreen, 320), ring: true },
      { label: "Dozes", pose: at(makeDoze, 6_000), ring: true },
    ],
  },
  {
    title: "On the perch",
    cells: [
      {
        label: "Ready to go",
        pose: corvidPose({ crouch: 0.45, headAngle: 7, wingAngle: -4 }),
        ring: true,
      },
      {
        label: "Shakes its feathers",
        pose: corvidPose({
          fluff: 1,
          crouch: -0.25,
          headAngle: 7,
          wingAngle: -3,
          tailAngle: 5,
        }),
        ring: true,
      },
      { label: "Stretches a wing", pose: at(makeStretch, 700), ring: true },
      {
        label: "Hops",
        pose: corvidPose({ y: -4, crouch: -0.4, headAngle: 4 }),
        ring: true,
      },
      {
        label: "Flutters",
        pose: corvidPose({
          y: -3,
          crouch: -0.3,
          wingSpread: 0.7,
          wingAngle: -44,
          headAngle: 6,
        }),
        ring: true,
      },
      {
        label: "Turns about",
        pose: corvidPose({ bodyFacing: -1, crouch: 0.7, nape: 1 }),
        ring: true,
      },
      {
        label: "Leaps",
        pose: corvidPose({
          bodyFacing: -1,
          flight: 0.8,
          nape: 1,
          wingSpread: 0.9,
          wingAngle: -70,
        }),
      },
      { label: "Out of the ring", pose: corvidPose({ nape: 1 }) },
    ],
  },
  {
    title: "The wingbeat",
    cells: Array.from({ length: 8 }, (_, i) => ({
      label:
        i === 0
          ? "Top of the stroke"
          : i === 4
            ? "Bottom of the stroke"
            : `${i * 12.5}%`,
      pose: flying(wingbeat(i / 8)),
    })),
  },
  {
    title: "In the air",
    cells: [
      { label: "Glides", pose: flying(glide) },
      { label: "Climbs", pose: flying(wingbeat(0.1)), rotate: 24 },
      {
        label: "Dives",
        pose: flying({ ...glide, wingAngle: -4, wingSpread: 0.55 }),
        rotate: -30,
      },
      {
        label: "Turns round",
        pose: flying({ ...glide, bodyFacing: 0.45, headFacing: -0.45 }),
      },
      {
        label: "Flies right",
        pose: flying({ ...glide, bodyFacing: -1, headFacing: 1 }),
      },
      { label: "Rolls", pose: flying(glide), roll: true },
      {
        label: "Flares to land",
        pose: flying({
          wingAngle: -92,
          wingSpread: 1,
          wingCurl: -0.3,
          wingTurn: 1,
        }),
        rotate: 22,
      },
      {
        label: "Lands",
        pose: corvidPose({
          flight: 0.25,
          nape: 0.8,
          headFacing: -1,
          wingSpread: 0.3,
          wingAngle: -12,
          crouch: 0.5,
        }),
        ring: true,
      },
    ],
  },
];

const CELL = 180;
/** Units of the rig's box shown across one cell: the same for every cell. */
const REACH = 132;
const GAP = 12;
const PAD = 28;
const TITLE = 34;
const LABEL = 26;
const SURFACE = BRAND.surface;
const CARD = "#ffffff";
const INK = BRAND.onSurface;
const MUTED = BRAND.onSurfaceVariant;

const num = (n: number) => String(Math.round(n * 100) / 100);

/** The middle of a drawing, for centring a cell on it. */
function middle(pose: CorvidPose, ring: boolean): Vec {
  if (ring) return [50, 50];
  const d = drawCorvid(pose);
  const pts = [
    ...d.head[0],
    ...d.head[1],
    ...d.chest,
    ...d.wing,
    ...d.tail1,
    ...d.tail2,
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
}

function cellSvg(cell: Cell, x: number, y: number): string {
  const [cx, cy] = middle(cell.pose, !!cell.ring);
  const k = CELL / REACH;
  const d = drawCorvid(cell.pose);
  const paths = corvidPathData(d);
  const strokes = [
    paths.nape,
    paths.chest,
    paths.wing,
    paths.tail1,
    paths.tail2,
    paths.head,
  ]
    .filter(Boolean)
    .map((p) => `<path d="${p}"/>`)
    .join("");
  const turn = [
    cell.rotate ? `rotate(${cell.rotate} ${num(cx)} ${num(cy)})` : "",
    cell.roll ? `translate(0 ${num(2 * cy)}) scale(1 -1)` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const eye = `<ellipse cx="${num(d.eye.cx)}" cy="${num(d.eye.cy)}" rx="${num(d.eye.rx)}" ry="${num(d.eye.ry)}" fill="${BRAND.eyeLight}" stroke="none"/>`;
  return [
    `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="18" fill="${CARD}"/>`,
    `<g transform="translate(${num(x + CELL / 2)} ${num(y + CELL / 2)}) scale(${num(k)}) translate(${num(-cx)} ${num(-cy)})" fill="none" stroke="${BRAND.mark}" stroke-width="${MARK_STROKE}" stroke-linecap="round" stroke-linejoin="round">`,
    cell.ring ? `<path d="${CORVID_PATHS.ring}"/>` : "",
    `<g${turn ? ` transform="${turn}"` : ""}>${strokes}${eye}</g>`,
    `</g>`,
    `<text x="${num(x + CELL / 2)}" y="${num(y + CELL + 18)}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="13" fill="${MUTED}">${cell.label}</text>`,
  ].join("");
}

/** The whole sheet, as SVG. */
export function renderPoseSheet(): string {
  const columns = Math.max(...POSE_ROWS.map((row) => row.cells.length));
  const width = PAD * 2 + columns * CELL + (columns - 1) * GAP;
  const rowHeight = TITLE + CELL + LABEL;
  const height =
    PAD * 2 + 40 + POSE_ROWS.length * rowHeight + (POSE_ROWS.length - 1) * GAP;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<!-- Generated by scripts/brand/build-icons.ts from src/assets/corvidRig.ts. Do not edit. -->`,
    `<rect width="${width}" height="${height}" fill="${SURFACE}"/>`,
    `<text x="${PAD}" y="${PAD + 22}" font-family="Manrope, Inter, Helvetica, Arial, sans-serif" font-size="24" font-weight="800" fill="${INK}">The corvid</text>`,
    `<text x="${PAD + 150}" y="${PAD + 22}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="14" fill="${MUTED}">One drawing, posed by its rig. The ring never moves. Every cell is drawn at the same scale.</text>`,
  ];
  POSE_ROWS.forEach((row, r) => {
    const top = PAD + 40 + r * (rowHeight + GAP);
    parts.push(
      `<text x="${PAD}" y="${top + 22}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="15" font-weight="700" fill="${INK}">${row.title}</text>`,
    );
    row.cells.forEach((cell, c) => {
      parts.push(cellSvg(cell, PAD + c * (CELL + GAP), top + TITLE));
    });
  });
  parts.push(`</svg>`, ``);
  return parts.join("\n");
}
