/**
 * readmeScenes: the corvid at work across the README, drawn by its rig.
 *
 * - `renderFlowSvg`: the four steps, Import, Dedupe, Enrich and Track, stacked
 *   vertically beside their GIFs. The bird sits in each ring for the time it
 *   takes to watch the step, plays two acts there, and flies down to the next.
 *   From Track it flies off the bottom and comes back in at the top to land in
 *   Import, so the loop repeats with no seam.
 * - `renderTreeSvg`: a minimal mono-line tree at the foot of the README whose
 *   three main boughs hold Get help, Contribute and License. Each bough
 *   cradles a nest ring, and one corvid flies in a triangle from nest to nest
 *   every nine seconds, playing perched acts while in each nest.
 *
 * As in `animatedLockup.ts`, a README image runs no script, so the motion is
 * SMIL. Every pose is the rig's, every flight is `planFlight`'s, and one
 * seeded random source makes every build write the same file.
 */
import {
  BIRD_PART_ORDER,
  BRAND,
  CORVID_EYE,
  CORVID_OPTICAL,
  CORVID_PATHS,
  CORVID_RING,
} from "../../src/assets/corvidPaths.ts";
import {
  HOME_POSE,
  bodyCenter,
  drawCorvid,
  rollDrawing,
  type CorvidPose,
  type Vec,
} from "../../src/assets/corvidRig.ts";
import {
  planFlight,
  type FlightFrame,
  type FlightKind,
  type FlightPerch,
  type FlightViewport,
} from "../../src/lib/corvidFlight.ts";
import { createRng, type Rng } from "../../src/lib/corvidMotion.ts";
import {
  FRAME_RATE,
  REDUCED_MOTION_STYLE,
  animate,
  birdLines,
  birdTracks,
  fixed,
  loopFrames,
  loopPose,
  perchLoop,
  type ActName,
  type Track,
} from "./animatedLockup.ts";
import { face, outline, textPath } from "./type.ts";

const STEP = 1000 / FRAME_RATE;

/** The bird in one frame, and where it is drawn, in the scene's units. */
export interface SceneFrame {
  pose: CorvidPose;
  /** 1 upright, -1 upside down, as `FlightFrame.roll`. */
  roll: number;
  /** Where `center` is drawn. */
  x: number;
  y: number;
  /** The rig's 100-unit box, in scene units. */
  size: number;
  /** Degrees clockwise about `center`. */
  rotate: number;
  /** The point of the rig box that `x` and `y` hold, in rig units. */
  center: Vec;
  /** Not drawn: the frames either side of a jump out of the picture. */
  hidden?: boolean;
}

/** The bird's ink in `frame`, in scene units, pen width left out. */
export function inkBox(frame: SceneFrame): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const k = frame.size / 100;
  const turn = (frame.rotate * Math.PI) / 180;
  const drawing = rollDrawing(
    drawCorvid(frame.pose),
    frame.roll,
    bodyCenter(frame.pose)[1],
  );
  const box = {
    left: Infinity,
    top: Infinity,
    right: -Infinity,
    bottom: -Infinity,
  };
  for (const [px, py] of [
    ...drawing.head.flat(),
    ...drawing.chest,
    ...drawing.wing,
    ...drawing.tail1,
    ...drawing.tail2,
    ...drawing.nape,
  ]) {
    const u = (px - frame.center[0]) * k;
    const v = (py - frame.center[1]) * k;
    const x = frame.x + u * Math.cos(turn) - v * Math.sin(turn);
    const y = frame.y + u * Math.sin(turn) + v * Math.cos(turn);
    box.left = Math.min(box.left, x);
    box.right = Math.max(box.right, x);
    box.top = Math.min(box.top, y);
    box.bottom = Math.max(box.bottom, y);
  }
  return box;
}

/** The middle of the logo's body: where a sitting bird is held. */
const HOME_CENTER = bodyCenter(HOME_POSE);

/** A sitting bird in `perch`, in `pose`, drawn as the ring's own mark. */
function perched(perch: FlightPerch, pose: CorvidPose): SceneFrame {
  return {
    pose,
    roll: 1,
    x: perch.left + (HOME_CENTER[0] / 100) * perch.size,
    y: perch.top + (HOME_CENTER[1] / 100) * perch.size,
    size: perch.size,
    rotate: 0,
    center: HOME_CENTER,
  };
}

/** A frame of a flight, held by the body's middle as `CorvidFlight` holds it. */
const flying = (frame: FlightFrame): SceneFrame => ({
  ...frame,
  center: bodyCenter(frame.pose),
});

/** A scene being written: its random source, its room and its frames so far. */
interface Scene {
  rng: Rng;
  viewport: FlightViewport;
  frames: SceneFrame[];
}

/**
 * The bird sits in `perch` and plays `acts`, each after a still moment, with
 * blinks between, as the lockup's loop does. Each stay draws its own seed
 * from the scene's random source.
 */
function stay(
  scene: Scene,
  perch: FlightPerch,
  acts: readonly ActName[],
  pause: readonly [number, number] = [1_600, 2_400],
): void {
  const loop = perchLoop(Math.floor(scene.rng() * 1e9), acts, pause);
  const frames = loopFrames(loop);
  for (let i = 0; i < frames; i++) {
    scene.frames.push(perched(perch, loopPose(loop, i * STEP)));
  }
}

/**
 * The frames of a flight from `from` to `to`: a takeoff of `kind`, then a
 * call home to `to` once the bird is in the air and `ready`.
 */
function flightBetween(
  rng: Rng,
  viewport: FlightViewport,
  kind: FlightKind,
  from: FlightPerch,
  to: FlightPerch,
  ready: (at: FlightFrame) => boolean = () => true,
): SceneFrame[] {
  const out = planFlight({ kind, viewport, perch: from, rng });
  let t = 0;
  while (!out.interruptible(t) || !ready(out.frame(t))) {
    t += STEP;
    if (t > out.duration) throw new Error(`The ${kind} never turned home`);
  }
  const frames: SceneFrame[] = [];
  for (let s = 0; s < t; s += STEP) frames.push(flying(out.frame(s)));
  const at = out.frame(t);
  const home = planFlight({
    kind: "loop",
    viewport,
    perch: to,
    rng,
    airborne: {
      x: at.x,
      y: at.y,
      facing: at.pose.headFacing >= 0 ? 1 : -1,
      from: at,
    },
  });
  for (let s = 0; s < home.duration; s += STEP) {
    frames.push(flying(home.frame(s)));
  }
  return frames;
}

/**
 * The bird leaves `from` on a flight of `kind`, as it leaves the perch in
 * the app, and once it is in the air and `ready` it is called home to `to`.
 * A landing ends on the logo in `to`.
 */
function flyTo(
  scene: Scene,
  kind: FlightKind,
  from: FlightPerch,
  to: FlightPerch,
  ready: (at: FlightFrame) => boolean = () => true,
): void {
  scene.frames.push(
    ...flightBetween(scene.rng, scene.viewport, kind, from, to, ready),
  );
}

/**
 * How far an in-between keyframe may stray from the line between its
 * neighbors. A stroke may stray 0.6 of a rig unit, under half a pixel at the
 * size the README shows the bird, because a wingbeat otherwise keeps almost
 * every frame. A move may stray a quarter of a scene unit, a turn half a
 * degree.
 */
const TOLERANCE = {
  stroke: 0.6,
  move: 0.25,
  turn: 0.5,
  scale: 0.0025,
  center: 0.15,
};

/** One transform of the bird over the scene. */
function transformTrack(
  frames: readonly SceneFrame[],
  transform: NonNullable<Track["transform"]>,
  value: (frame: SceneFrame) => number[],
  places: number,
  tolerance: number,
): Track {
  return {
    attribute: "transform",
    transform,
    values: frames.map((frame) =>
      value(frame)
        .map((n) => fixed(n, places))
        .join(" "),
    ),
    numbers: (v) => v.split(" ").map(Number),
    tolerance,
  };
}

/**
 * The moving bird, as SVG lines: four groups, outermost first, that move it
 * to its point, turn it, scale it and hold it by its center, then its
 * strokes and eye, each with what it does over the scene.
 */
function sceneBird(
  frames: readonly SceneFrame[],
  eye: string,
  indent: string,
): string[] {
  const loop = [...frames, frames[0]!];
  const count = frames.length;
  const duration = count * STEP;
  const tracks = [
    transformTrack(loop, "translate", (f) => [f.x, f.y], 2, TOLERANCE.move),
    transformTrack(loop, "rotate", (f) => [f.rotate], 1, TOLERANCE.turn),
    transformTrack(loop, "scale", (f) => [f.size / 100], 4, TOLERANCE.scale),
    transformTrack(
      loop,
      "translate",
      (f) => [-f.center[0], -f.center[1]],
      2,
      TOLERANCE.center,
    ),
  ];
  // Hidden over a jump out of the picture, so the one frame the bird takes
  // to cross back is never drawn.
  const shown: Track = {
    attribute: "visibility",
    values: loop.map((f) => (f.hidden ? "hidden" : "visible")),
    numbers: () => [],
    tolerance: 0,
    discrete: true,
  };
  const lines: string[] = [];
  tracks.forEach((track, depth) => {
    const pad = `${indent}${"  ".repeat(depth)}`;
    const first = `${track.transform}(${track.values[0]})`;
    lines.push(`${pad}<g transform="${first}">`);
    if (depth === 0 && new Set(shown.values).size > 1) {
      lines.push(`${pad}  ${animate(shown, count, duration)}`);
    }
    if (new Set(track.values).size > 1) {
      lines.push(`${pad}  ${animate(track, count, duration)}`);
    }
  });
  const inner = `${indent}${"  ".repeat(tracks.length)}`;
  const drawings = loop.map((f) =>
    rollDrawing(drawCorvid(f.pose), f.roll, bodyCenter(f.pose)[1]),
  );
  lines.push(
    ...birdLines(birdTracks(drawings, TOLERANCE.stroke), eye, inner, (track) =>
      animate(track, count, duration),
    ),
  );
  for (let depth = tracks.length - 1; depth >= 0; depth--) {
    lines.push(`${indent}${"  ".repeat(depth)}</g>`);
  }
  return lines;
}

// ============================================================================
// 1. The four vertical steps (readme-flow.svg / readme-flow-dark.svg)
// ============================================================================

/** The steps the README tells, in order, and the acts the bird plays at each. */
export const FLOW_STEPS: readonly { label: string; acts: ActName[] }[] = [
  { label: "Import", acts: ["glance", "cock"] },
  { label: "Dedupe", acts: ["lookBack", "preen"] },
  { label: "Enrich", acts: ["caw", "glance"] },
  { label: "Track", acts: ["nod", "ruffle"] },
];

/** The seed of the flow scene, chosen for routes that read well. */
const FLOW_SEED = 22;

/**
 * The vertical room the flights are planned in. It is taller than the picture,
 * so the bird can fly out of the picture at the bottom and come back in at the
 * top without crossing the rings.
 */
export const FLOW_ROOM = { width: 116, height: 2990 } as const;

/** The part of the room the picture shows: all of the bird, every frame. */
export const FLOW_VIEW = {
  left: -20,
  width: 156,
  top: 68,
  height: 2806,
} as const;

/** Each ring's box, centered horizontally in the vertical column. */
const FLOW_RING = 56;
const FLOW_RING_LEFT = (FLOW_ROOM.width - FLOW_RING) / 2;
const FLOW_LABEL_SIZE = 19;

/**
 * Vertical fractions of `FLOW_VIEW.height` where each GIF's midpoint sits in
 * the 4-row README table (accounting for the heading + copy above each GIF).
 */
const FLOW_STEP_FRACTIONS = [0.15, 0.394, 0.658, 0.912] as const;

/**
 * Where each step's ring sits: aligned with the vertical midpoint of its
 * corresponding GIF in the README table.
 */
export function flowPerches(): FlightPerch[] {
  return FLOW_STEPS.map((_, i) => ({
    left: FLOW_RING_LEFT,
    top:
      FLOW_VIEW.top +
      FLOW_VIEW.height * FLOW_STEP_FRACTIONS[i]! -
      FLOW_RING / 2 -
      14,
    size: FLOW_RING,
  }));
}

/** Every frame of the vertical flow scene, from the bird at home in the first ring. */
export function flowFrames(seed: number = FLOW_SEED): SceneFrame[] {
  const perches = flowPerches();
  const scene: Scene = {
    rng: createRng(seed),
    viewport: FLOW_ROOM,
    frames: [],
  };
  FLOW_STEPS.forEach(({ acts }, i) => {
    stay(scene, perches[i]!, acts, [1_600, 2_400]);
    if (i < perches.length - 1) {
      flyTo(scene, "sortie", perches[i]!, perches[i + 1]!);
    }
  });

  // Off the bottom: toward a ring beyond the picture's bottom edge, until all
  // of the bird is past the edge.
  const edge = FLOW_VIEW.top + FLOW_VIEW.height;
  const beyond = { ...perches.at(-1)!, top: FLOW_ROOM.height - FLOW_RING };
  const leaving = scene.frames.length;
  flyTo(scene, "sortie", perches.at(-1)!, beyond);
  const gone = scene.frames.findIndex(
    (frame, i) => i > leaving && inkBox(frame).top > edge,
  );
  if (gone < 0) throw new Error("The bird never left the picture");
  scene.frames.length = gone + 1;
  scene.frames[gone]!.hidden = true;

  // Back in from the top, already flying, and home to the first ring.
  const [first] = perches;
  const back = planFlight({
    kind: "loop",
    viewport: FLOW_ROOM,
    perch: first!,
    rng: scene.rng,
    airborne: {
      x: first!.left + FLOW_RING * 0.8,
      y: -4,
      facing: -1,
    },
  });
  for (let s = 0; s < back.duration; s += STEP) {
    scene.frames.push(flying(back.frame(s)));
  }
  scene.frames[gone + 1]!.hidden = true;
  // The bird is home in the first ring. It rests there until the scene is a
  // whole number of tenths of a second, six frames each.
  while (scene.frames.length % (FRAME_RATE / 10) !== 0) {
    scene.frames.push(perched(perches[0]!, { ...HOME_POSE }));
  }
  return scene.frames;
}

/** One ring, drawn as the mark's ring in `perch`'s box. */
const ringLine = (perch: FlightPerch, indent: string) =>
  `${indent}<path transform="translate(${fixed(perch.left, 2)} ${fixed(perch.top, 2)}) scale(${fixed(perch.size / 100, 4)})" d="${CORVID_PATHS[CORVID_RING]}" />`;

/**
 * The still bird, the logo, for reduced motion: in `perch`'s box, or in the
 * mark's own box when there is no perch.
 */
function stillBird(eye: string, indent: string, perch?: FlightPerch): string[] {
  const place = perch
    ? ` transform="translate(${fixed(perch.left, 2)} ${fixed(perch.top, 2)}) scale(${fixed(perch.size / 100, 4)})"`
    : "";
  return [
    `${indent}<g class="still"${place}>`,
    ...BIRD_PART_ORDER.map(
      (part) => `${indent}  <path d="${CORVID_PATHS[part]}" />`,
    ),
    `${indent}  <circle cx="${CORVID_EYE.cx}" cy="${CORVID_EYE.cy}" r="${CORVID_OPTICAL.large.eye}" fill="${eye}" stroke="none" />`,
    `${indent}</g>`,
  ];
}

/** The colors of a scene on a light or a dark page. */
const paint = (dark: boolean) => ({
  ink: dark ? BRAND.markDark : BRAND.mark,
  eye: dark ? BRAND.eyeDark : BRAND.eyeLight,
  text: dark ? BRAND.onSurfaceDark : BRAND.onSurface,
  trail: dark ? BRAND.onSurfaceVariantDark : BRAND.onSurfaceVariant,
});

/**
 * The vertical flow scene, for a light or a dark page: the four rings stacked
 * top-to-bottom with their names, a vertical dotted trail from each to the
 * next, and the bird flying down from step to step.
 */
export async function renderFlowSvg(dark: boolean): Promise<string> {
  const { left, top, width, height } = FLOW_VIEW;
  const colors = paint(dark);
  const perches = flowPerches();
  const name = await face("name");
  const ringMiddleX = FLOW_RING_LEFT + FLOW_RING / 2;
  const labels = FLOW_STEPS.map(({ label }, i) => {
    const line = outline(name, label, FLOW_LABEL_SIZE, -0.025);
    const x = ringMiddleX - (line.ink.left + line.ink.right) / 2;
    return `  ${textPath(line, x, perches[i]!.top + FLOW_RING + 28, colors.text)}`;
  });
  // A vertical dotted trail from beneath each step's label to the top of the next ring.
  const trails = perches.slice(0, -1).map((perch, i) => {
    const from = perch.top + FLOW_RING + 48;
    const to = perches[i + 1]!.top - 16;
    return `    <path d="M${fixed(ringMiddleX, 2)} ${fixed(from, 2)} V${fixed(to, 2)}" />`;
  });
  const alt = `${FLOW_STEPS.map((step) => step.label).join(", then ")}: the Contrack corvid flies from step to step.`;
  const stroke = `fill="none" stroke="${colors.ink}" stroke-width="${CORVID_OPTICAL.large.stroke}" stroke-linecap="round" stroke-linejoin="round"`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${alt}">`,
    `  <title>${alt}</title>`,
    `  <!-- Generated by scripts/brand/build-icons.ts from scripts/brand/readmeScenes.ts. Do not edit. -->`,
    ...REDUCED_MOTION_STYLE.map((line) => `  ${line}`),
    `  <g fill="none" stroke="${colors.trail}" stroke-width="2" stroke-linecap="round" stroke-dasharray="0.1 9">`,
    ...trails,
    `  </g>`,
    ...labels,
    `  <g ${stroke}>`,
    ...perches.map((perch) => ringLine(perch, "    ")),
    ...stillBird(colors.eye, "    ", perches[0]!),
    `    <g class="alive">`,
    ...sceneBird(flowFrames(), colors.eye, "      "),
    `    </g>`,
    `  </g>`,
    `</svg>`,
    ``,
  ].join("\n");
}

// ============================================================================
// 2. The branched tree at the foot of the README (readme-tree.svg)
// ============================================================================

const REPO_URL = "https://github.com/arvarik/contrack";

export interface TreeTwig {
  text: string;
  /** Optional link target when the twig label is a clickable resource. */
  href?: string;
  /** Where the twig splits from its main bough. */
  from: Vec;
  /** Control point of the twig's curve toward the text stem. */
  ctrl: Vec;
  /** Baseline start `(x, y)` of the text; for `"left"` alignment `x` is the right edge. */
  anchor: Vec;
  align: "left" | "right";
  /** Angle (degrees) of the terminal leaf at the tip of the text stem. */
  leafAngle: number;
}

export interface TreeBranch {
  id: "help" | "contribute" | "license";
  title: string;
  titlePos: Vec;
  perch: FlightPerch;
  acts: readonly ActName[];
  twigs: readonly TreeTwig[];
}

/**
 * The three main boughs of the tree, arranged in a canopy triangle:
 * - `help` on the lower-left bough
 * - `contribute` on the high central crown bough
 * - `license` on the lower-right bough
 */
export const TREE_BRANCHES: readonly TreeBranch[] = [
  {
    id: "help",
    title: "Get help",
    titlePos: [294, 338],
    perch: { left: 266, top: 250, size: 56 },
    acts: ["cock", "caw"],
    twigs: [
      {
        text: "Read the docs",
        href: `${REPO_URL}/blob/main/docs/README.md`,
        from: [256, 154],
        ctrl: [228, 155],
        anchor: [196, 148],
        align: "left",
        leafAngle: -165,
      },
      {
        text: "Ask a question",
        href: `${REPO_URL}/discussions/categories/q-a`,
        from: [246, 314],
        ctrl: [216, 255],
        anchor: [186, 248],
        align: "left",
        leafAngle: 175,
      },
      {
        text: "Report a bug or idea",
        href: `${REPO_URL}/issues/new/choose`,
        from: [254, 344],
        ctrl: [224, 391],
        anchor: [192, 384],
        align: "left",
        leafAngle: 168,
      },
      {
        text: "Security policy",
        href: `${REPO_URL}/blob/main/SECURITY.md`,
        from: [292, 354],
        ctrl: [258, 441],
        anchor: [216, 434],
        align: "left",
        leafAngle: 162,
      },
      {
        text: "Email the maintainer",
        href: "mailto:arvind.arikatla@gmail.com",
        from: [322, 348],
        ctrl: [288, 487],
        anchor: [244, 480],
        align: "left",
        leafAngle: 158,
      },
    ],
  },
  {
    id: "contribute",
    title: "Contribute",
    titlePos: [480, 264],
    perch: { left: 452, top: 174, size: 56 },
    acts: ["preen", "glance"],
    twigs: [
      {
        text: "Send a change",
        href: `${REPO_URL}/blob/main/CONTRIBUTING.md`,
        from: [402, 52],
        ctrl: [390, 55],
        anchor: [376, 48],
        align: "left",
        leafAngle: -168,
      },
      {
        text: "Agent instructions",
        href: `${REPO_URL}/blob/main/AGENTS.md`,
        from: [412, 108],
        ctrl: [392, 105],
        anchor: [368, 98],
        align: "left",
        leafAngle: 172,
      },
      {
        text: "Code of Conduct",
        href: `${REPO_URL}/blob/main/CODE_OF_CONDUCT.md`,
        from: [558, 52],
        ctrl: [570, 55],
        anchor: [584, 48],
        align: "right",
        leafAngle: -12,
      },
      {
        text: "What changed",
        href: `${REPO_URL}/blob/main/CHANGELOG.md`,
        from: [548, 108],
        ctrl: [568, 105],
        anchor: [592, 98],
        align: "right",
        leafAngle: 8,
      },
    ],
  },
  {
    id: "license",
    title: "License",
    titlePos: [666, 338],
    perch: { left: 638, top: 250, size: 56 },
    acts: ["lookBack", "ruffle"],
    twigs: [
      {
        text: "GNU AGPL v3",
        href: `${REPO_URL}/blob/main/LICENSE`,
        from: [704, 154],
        ctrl: [732, 155],
        anchor: [764, 148],
        align: "right",
        leafAngle: -15,
      },
      {
        text: "Free to use & change",
        from: [714, 314],
        ctrl: [744, 255],
        anchor: [774, 248],
        align: "right",
        leafAngle: 5,
      },
      {
        text: "Share your changes",
        from: [706, 344],
        ctrl: [736, 391],
        anchor: [768, 384],
        align: "right",
        leafAngle: 14,
      },
    ],
  },
];

const TREE_SEED = 30;
export const TREE_ROOM = { width: 960, height: 540 } as const;
export const TREE_VIEW = {
  left: 0,
  top: 12,
  width: 960,
  height: 516,
} as const;

/**
 * The central canopy tile (`r4-c`) that holds all three nests and the entire
 * triangle flight so the animated bird never crosses a tile boundary.
 */
export const TREE_CANOPY_VIEW = {
  left: 240,
  top: 164,
  width: 480,
  height: 192,
} as const;

export interface TreeTile {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alt: string;
  animated?: boolean;
}

/**
 * The 13 seamless tiles that compose the README tree so every branch label can
 * be wrapped in its own HTML `<a href="...">` tag on GitHub.
 */
export const TREE_TILES: readonly TreeTile[] = [
  {
    id: "r1-l",
    x: 0,
    y: 12,
    width: 480,
    height: 56,
    alt: "Contribute: Send a change",
  },
  {
    id: "r1-r",
    x: 480,
    y: 12,
    width: 480,
    height: 56,
    alt: "Contribute: Code of Conduct",
  },
  {
    id: "r2-l",
    x: 0,
    y: 68,
    width: 480,
    height: 52,
    alt: "Contribute: Agent instructions",
  },
  {
    id: "r2-r",
    x: 480,
    y: 68,
    width: 480,
    height: 52,
    alt: "Contribute: What changed",
  },
  {
    id: "r3-l",
    x: 0,
    y: 120,
    width: 480,
    height: 44,
    alt: "Get help: Read the docs",
  },
  {
    id: "r3-r",
    x: 480,
    y: 120,
    width: 480,
    height: 44,
    alt: "License: GNU AGPL v3",
  },
  {
    id: "r4-l",
    x: 0,
    y: 164,
    width: 240,
    height: 192,
    alt: "Get help: Ask a question",
  },
  {
    id: "r4-c",
    x: 240,
    y: 164,
    width: 480,
    height: 192,
    alt: "The Contrack tree: Get help, Contribute, and License nests with the corvid flying from nest to nest",
    animated: true,
  },
  {
    id: "r4-r",
    x: 720,
    y: 164,
    width: 240,
    height: 192,
    alt: "License: Free to use and change",
  },
  {
    id: "r5-l",
    x: 0,
    y: 356,
    width: 480,
    height: 50,
    alt: "Get help: Report a bug or idea",
  },
  {
    id: "r5-r",
    x: 480,
    y: 356,
    width: 480,
    height: 50,
    alt: "License: Share your changes",
  },
  {
    id: "r6",
    x: 0,
    y: 406,
    width: 960,
    height: 48,
    alt: "Get help: Security policy",
  },
  {
    id: "r7",
    x: 0,
    y: 454,
    width: 960,
    height: 74,
    alt: "Get help: Email the maintainer",
  },
];

/** Exact frames per leg of the triangle: 9.0 seconds at 60 fps. */
export const TREE_LEG_FRAMES = 9 * FRAME_RATE;

/** Where the three nests sit in the tree. */
export function treePerches(): FlightPerch[] {
  return TREE_BRANCHES.map((b) => b.perch);
}

/**
 * Every frame of the tree scene: for each of the three nests in the triangle,
 * the bird stays in the nest playing its perched acts and then flies to the
 * next nest, taking exactly 9 seconds (`TREE_LEG_FRAMES`) per branch.
 * Flights are planned within `TREE_CANOPY_VIEW` so the bird stays inside the
 * center canopy tile (`r4-c`).
 */
export function treeFrames(seed: number = TREE_SEED): SceneFrame[] {
  const perches = treePerches();
  const localRoom = {
    width: TREE_CANOPY_VIEW.width,
    height: TREE_CANOPY_VIEW.height,
  };
  const toLocal = (p: FlightPerch): FlightPerch => ({
    left: p.left - TREE_CANOPY_VIEW.left,
    top: p.top - TREE_CANOPY_VIEW.top,
    size: p.size,
  });
  const rng = createRng(seed);
  const frames: SceneFrame[] = [];

  TREE_BRANCHES.forEach(({ acts }, i) => {
    const from = perches[i]!;
    const to = perches[(i + 1) % perches.length]!;
    const staySeed = Math.floor(rng() * 1e9);
    const flight = flightBetween(
      rng,
      localRoom,
      "sortie",
      toLocal(from),
      toLocal(to),
    ).map((f) => ({
      ...f,
      x: f.x + TREE_CANOPY_VIEW.left,
      y: f.y + TREE_CANOPY_VIEW.top,
    }));
    const stayCount = TREE_LEG_FRAMES - flight.length;
    if (stayCount < FRAME_RATE * 2) {
      throw new Error(`Flight ${i} left too few frames to rest in the nest`);
    }
    const loop = perchLoop(staySeed, acts, [1_100, 1_500]);
    for (let f = 0; f < stayCount; f++) {
      const t = Math.min(f * STEP, loop.duration);
      frames.push(perched(from, loopPose(loop, t)));
    }
    frames.push(...flight);
  });

  return frames;
}

/** A mono-line botanical leaf sprouting at `(x, y)` at `angleDeg` degrees. */
function leafPath(
  x: number,
  y: number,
  angleDeg: number,
  length = 18,
  halfWidth = 5.2,
): string {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const pt = (u: number, v: number): string =>
    `${fixed(x + u * cos - v * sin, 1)} ${fixed(y + u * sin + v * cos, 1)}`;
  return [
    `M${pt(0, 0)}`,
    `C${pt(length * 0.32, -halfWidth)} ${pt(length * 0.72, -halfWidth * 0.85)} ${pt(length, 0)}`,
    `C${pt(length * 0.72, halfWidth * 0.85)} ${pt(length * 0.32, halfWidth)} ${pt(0, 0)}`,
    `M${pt(1.5, 0)} L${pt(length * 0.68, 0)}`,
  ].join(" ");
}

/** Woven mono-line nest twigs cradling `perch`'s ring in the fork of its branch. */
function nestCradlePaths(perch: FlightPerch): string[] {
  const cx = perch.left + perch.size * 0.5;
  const by = perch.top + perch.size * 0.92;
  const r = perch.size * 0.54;
  return [
    `M${fixed(cx - r, 1)} ${fixed(by - 8, 1)} Q${fixed(cx, 1)} ${fixed(by + 12, 1)} ${fixed(cx + r, 1)} ${fixed(by - 9, 1)}`,
    `M${fixed(cx - r * 0.82, 1)} ${fixed(by - 2, 1)} Q${fixed(cx + 3, 1)} ${fixed(by + 15, 1)} ${fixed(cx + r * 0.86, 1)} ${fixed(by - 3, 1)}`,
    `M${fixed(cx - r * 1.08, 1)} ${fixed(by - 14, 1)} Q${fixed(cx - r * 0.25, 1)} ${fixed(by + 8, 1)} ${fixed(cx + r * 0.55, 1)} ${fixed(by + 3, 1)}`,
  ];
}

/**
 * The trunk, roots, three primary boughs and decorative canopy twigs & leaves.
 */
function treeStructurePaths(): {
  heavy: string[];
  medium: string[];
  fine: string[];
} {
  // Primary trunk, roots, and the three main boughs leading to each nest fork.
  const heavy = [
    // Left root -> left trunk -> left main bough into Get help nest fork
    "M388 512 C432 510 458 492 465 446 C470 412 468 380 456 360 C422 332 374 312 320 298",
    // Right root -> right trunk -> right main bough into License nest fork
    "M572 512 C528 510 502 492 495 446 C490 412 492 380 504 360 C538 332 586 312 640 298",
    // Center heartwood -> rises from trunk base and forks into a chalice around "Contribute"
    "M480 514 C479 452 478 396 475 342 C472 308 468 292 456 284 C430 274 414 262 414 246 C414 230 430 220 452 220",
    "M487 486 C485 426 484 374 486 328 C488 302 492 290 504 284 C530 274 546 262 546 246 C546 230 530 220 508 220",
    // Supporting under-boughs for left and right nests, parting around "Get help" and "License"
    "M462 384 C418 354 374 334 344 326 C332 346 312 354 286 354 C258 354 244 342 244 326 C244 310 256 298 272 294",
    "M498 384 C542 354 586 334 616 326 C628 346 648 354 674 354 C702 354 716 342 716 326 C716 310 704 298 688 294",
  ];

  // Secondary structural limbs, root flares, crown limbs, and nest cradles.
  const medium = [
    // Root flares at the base of the trunk
    "M356 515 Q422 516 468 498",
    "M604 515 Q538 516 492 498",
    "M422 520 Q462 516 480 502",
    "M538 520 Q498 516 480 502",
    // Upper crown limbs rising from the Contribute chalice to hold the 4 Contribute twigs
    "M432 224 C422 178 412 114 402 52",
    "M528 224 C538 178 548 114 558 52",
    // Outer canopy limbs arching above the left and right nests
    "M366 320 C338 264 302 204 256 154",
    "M594 320 C622 264 658 204 704 154",
    ...TREE_BRANCHES.flatMap((b) => nestCradlePaths(b.perch)),
  ];

  // Decorative canopy leaves along the trunk forks and boughs.
  const leaves: Array<[number, number, number, number, number]> = [
    [366, 316, -125, 17, 4.8],
    [408, 336, -135, 16, 4.5],
    [594, 316, -55, 17, 4.8],
    [552, 336, -45, 16, 4.5],
    [306, 212, -145, 17, 4.8],
    [320, 220, -75, 15, 4.4],
    [654, 212, -35, 17, 4.8],
    [640, 220, -105, 15, 4.4],
    [420, 152, -150, 17, 4.6],
    [540, 152, -30, 17, 4.6],
    [468, 314, -140, 16, 4.5],
    [492, 314, -40, 16, 4.5],
    [402, 52, -110, 16, 4.5],
    [558, 52, -70, 16, 4.5],
    [356, 515, -165, 15, 4.2],
    [604, 515, -15, 15, 4.2],
  ];

  const fine = leaves.map(([x, y, a, l, w]) => leafPath(x, y, a, l, w));
  return { heavy, medium, fine };
}

/** Shared static layers of the tree scene. */
async function renderTreeStaticLines(
  dark: boolean,
  linkWrap: boolean,
): Promise<{
  colors: ReturnType<typeof paint>;
  perches: FlightPerch[];
  staticLines: string[];
}> {
  const colors = paint(dark);
  const perches = treePerches();
  const nameFace = await face("name");
  const bodyFace = await face("body");
  const { heavy, medium, fine } = treeStructurePaths();

  const twigStemPaths: string[] = [];
  const twigLeafPaths: string[] = [];
  const textPaths: string[] = [];

  for (const branch of TREE_BRANCHES) {
    const heading = outline(nameFace, branch.title, 21, -0.025);
    const hx = branch.titlePos[0] - (heading.ink.left + heading.ink.right) / 2;
    textPaths.push(textPath(heading, hx, branch.titlePos[1], colors.text));

    for (const twig of branch.twigs) {
      const line = outline(bodyFace, twig.text, 15);
      const textW = line.ink.right - line.ink.left;
      const stemY = twig.anchor[1] + 7;
      const padIn = 8;
      const padOut = 10;
      const textX =
        twig.align === "left"
          ? twig.anchor[0] - padIn - line.ink.right
          : twig.anchor[0] + padIn - line.ink.left;
      const stemEnd =
        twig.align === "left"
          ? twig.anchor[0] - padIn - textW - padOut
          : twig.anchor[0] + padIn + textW + padOut;

      twigStemPaths.push(
        `M${fixed(twig.from[0], 1)} ${fixed(twig.from[1], 1)} Q${fixed(twig.ctrl[0], 1)} ${fixed(twig.ctrl[1], 1)} ${fixed(twig.anchor[0], 1)} ${fixed(stemY, 1)} L${fixed(stemEnd, 1)} ${fixed(stemY, 1)}`,
      );
      const nodeLeafAngle = twig.align === "left" ? -42 : -138;
      twigLeafPaths.push(
        leafPath(twig.anchor[0], stemY, nodeLeafAngle, 12, 3.6),
        leafPath(stemEnd, stemY, twig.leafAngle, 17, 4.8),
      );
      const glyph = textPath(
        line,
        textX,
        twig.anchor[1],
        twig.href ? colors.ink : colors.text,
      );
      if (linkWrap && twig.href) {
        const hitLeft = fixed(textX + line.ink.left - 4, 1);
        const hitTop = fixed(twig.anchor[1] - 16, 1);
        const hitW = fixed(textW + 8, 1);
        textPaths.push(
          `<a href="${twig.href}" target="_top"><rect x="${hitLeft}" y="${hitTop}" width="${hitW}" height="24" fill="transparent" />${glyph}</a>`,
        );
      } else {
        textPaths.push(glyph);
      }
    }
  }

  const staticLines = [
    `  <g fill="none" stroke="${colors.ink}" stroke-linecap="round" stroke-linejoin="round">`,
    `    <g stroke-width="2.2">`,
    ...heavy.map((d) => `      <path d="${d}" />`),
    `    </g>`,
    `    <g stroke-width="1.55">`,
    ...medium.map((d) => `      <path d="${d}" />`),
    ...twigStemPaths.map((d) => `      <path d="${d}" />`),
    `    </g>`,
    `    <g stroke-width="1.25">`,
    ...fine.map((d) => `      <path d="${d}" />`),
    ...twigLeafPaths.map((d) => `      <path d="${d}" />`),
    `    </g>`,
    `  </g>`,
    ...textPaths.map((line) => `  ${line}`),
  ];

  return { colors, perches, staticLines };
}

/**
 * The branched tree at the foot of the README: three main boughs ("Get help",
 * "Contribute" and "License") with sub-branches, leaves and text growing from
 * them, a nest ring in each bough, and one corvid flying in a triangle from
 * nest to nest every 9 seconds.
 */
export async function renderTreeSvg(dark: boolean): Promise<string> {
  const { left, top, width, height } = TREE_VIEW;
  const { colors, perches, staticLines } = await renderTreeStaticLines(
    dark,
    true,
  );
  const alt =
    "The Contrack tree: Get help, Contribute and License branches, with the corvid flying from nest to nest.";
  const birdStroke = `fill="none" stroke="${colors.ink}" stroke-width="${CORVID_OPTICAL.large.stroke}" stroke-linecap="round" stroke-linejoin="round"`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${alt}">`,
    `  <title>${alt}</title>`,
    `  <!-- Generated by scripts/brand/build-icons.ts from scripts/brand/readmeScenes.ts. Do not edit. -->`,
    ...REDUCED_MOTION_STYLE.map((line) => `  ${line}`),
    ...staticLines,
    `  <g ${birdStroke}>`,
    ...perches.map((perch) => ringLine(perch, "    ")),
    ...stillBird(colors.eye, "    ", perches[0]!),
    `    <g class="alive">`,
    ...sceneBird(treeFrames(), colors.eye, "      "),
    `    </g>`,
    `  </g>`,
    `</svg>`,
    ``,
  ].join("\n");
}

/**
 * Renders one tile of `TREE_TILES` (`docs/brand/tree/<id>.svg`). Static tiles
 * omit the animated bird so they stay tiny (~3 KB), while the center canopy
 * tile (`r4-c`) includes the nest rings and the animated corvid.
 */
export async function renderTreeTileSvg(
  tile: TreeTile,
  dark: boolean,
): Promise<string> {
  const { colors, perches, staticLines } = await renderTreeStaticLines(
    dark,
    false,
  );
  const birdStroke = `fill="none" stroke="${colors.ink}" stroke-width="${CORVID_OPTICAL.large.stroke}" stroke-linecap="round" stroke-linejoin="round"`;
  const animatedLines = tile.animated
    ? [
        ...REDUCED_MOTION_STYLE.map((line) => `  ${line}`),
        ...staticLines,
        `  <g ${birdStroke}>`,
        ...perches.map((perch) => ringLine(perch, "    ")),
        ...stillBird(colors.eye, "    ", perches[0]!),
        `    <g class="alive">`,
        ...sceneBird(treeFrames(), colors.eye, "      "),
        `    </g>`,
        `  </g>`,
      ]
    : staticLines;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${tile.x} ${tile.y} ${tile.width} ${tile.height}" width="${tile.width}" height="${tile.height}" role="img" aria-label="${tile.alt}">`,
    `  <title>${tile.alt}</title>`,
    `  <!-- Generated by scripts/brand/build-icons.ts from scripts/brand/readmeScenes.ts. Do not edit. -->`,
    ...animatedLines,
    `</svg>`,
    ``,
  ].join("\n");
}
