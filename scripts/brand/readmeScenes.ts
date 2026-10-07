/**
 * readmeScenes: the corvid at work across the README, drawn by its rig.
 *
 * - `renderFlowSvg`: the four steps, Import, Dedupe, Enrich and Track, as
 *   four rings. The bird sits in each in turn, plays an act there, and flies
 *   on to the next. From Track it flies out of the picture and comes back in
 *   on the left to land in Import, so the loop repeats with no seam.
 * - `renderPerchSvg`: one bird in its ring, for a card at the foot of the
 *   README, with acts of its own.
 *
 * As in `animatedLockup.ts`, a README image runs no script, so the motion is
 * SMIL. Every pose is the rig's, every flight is `planFlight`'s, and one
 * seeded random source makes every build write the same file. A flight takes
 * off with the app's launch and lands with its landing: the takeoff is a
 * sortie from one ring, and once the bird is in the air it is called home to
 * the next ring, as a second press on the perch calls it home in the app.
 *
 * A flying bird is placed as `CorvidFlight` places it: the body's middle at
 * the route's point, turned and scaled about it. Four nested groups carry
 * that, each with one `<animateTransform>`, and the strokes keep the rig's
 * own units inside them.
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
  livingBird,
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
  pause: readonly [number, number] = [700, 1_300],
): void {
  const loop = perchLoop(Math.floor(scene.rng() * 1e9), acts, pause);
  const frames = loopFrames(loop);
  for (let i = 0; i < frames; i++) {
    scene.frames.push(perched(perch, loopPose(loop, i * STEP)));
  }
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
  const { rng, viewport } = scene;
  const out = planFlight({ kind, viewport, perch: from, rng });
  let t = 0;
  while (!out.interruptible(t) || !ready(out.frame(t))) {
    t += STEP;
    if (t > out.duration) throw new Error(`The ${kind} never turned home`);
  }
  for (let s = 0; s < t; s += STEP) scene.frames.push(flying(out.frame(s)));
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
    scene.frames.push(flying(home.frame(s)));
  }
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

// The four steps

/** The steps the README tells, in order, and the act the bird plays at each. */
export const FLOW_STEPS: readonly { label: string; acts: ActName[] }[] = [
  { label: "Import", acts: ["glance"] },
  { label: "Dedupe", acts: ["lookBack"] },
  { label: "Enrich", acts: ["caw"] },
  { label: "Track", acts: ["nod"] },
];

/** The seed of the flow scene, chosen for routes that read well. */
const FLOW_SEED = 22;

/**
 * The room the flights are planned in. It is wider than the picture, so the
 * bird can fly out of the picture on the right and come back in on the left
 * without crossing the rings.
 */
export const FLOW_ROOM = { width: 1000, height: 250 } as const;

/** The part of the room the picture shows: all of the bird, every frame. */
export const FLOW_VIEW = {
  left: 100,
  width: 800,
  top: 58,
  height: 138,
} as const;

/** Each ring's box. The flying bird is `flightSize`, a little nearer. */
const FLOW_RING = 60;
const FLOW_RING_TOP = 90;
const FLOW_LABEL_SIZE = 22;

/** Where each step's ring sits: evenly across the picture. */
export function flowPerches(): FlightPerch[] {
  const gap = FLOW_VIEW.width / FLOW_STEPS.length;
  return FLOW_STEPS.map((_, i) => ({
    left: FLOW_VIEW.left + gap * (i + 0.5) - FLOW_RING / 2,
    top: FLOW_RING_TOP,
    size: FLOW_RING,
  }));
}

/** Every frame of the flow scene, from the bird at home in the first ring. */
export function flowFrames(seed: number = FLOW_SEED): SceneFrame[] {
  const perches = flowPerches();
  const scene: Scene = {
    rng: createRng(seed),
    viewport: FLOW_ROOM,
    frames: [],
  };
  FLOW_STEPS.forEach(({ acts }, i) => {
    stay(scene, perches[i]!, acts);
    if (i < perches.length - 1) {
      flyTo(scene, "sortie", perches[i]!, perches[i + 1]!);
    }
  });

  // Off to the right: toward a ring beyond the picture's edge, until all of
  // the bird is past the edge.
  const edge = FLOW_VIEW.left + FLOW_VIEW.width;
  const beyond = { ...perches.at(-1)!, left: FLOW_ROOM.width - FLOW_RING };
  const leaving = scene.frames.length;
  flyTo(scene, "sortie", perches.at(-1)!, beyond);
  const gone = scene.frames.findIndex(
    (frame, i) => i > leaving && inkBox(frame).left > edge,
  );
  if (gone < 0) throw new Error("The bird never left the picture");
  scene.frames.length = gone + 1;
  scene.frames[gone]!.hidden = true;

  // Back in from the left, already flying, and home to the first ring.
  const [first] = perches;
  const back = planFlight({
    kind: "loop",
    viewport: FLOW_ROOM,
    perch: first!,
    rng: scene.rng,
    airborne: { x: 0, y: first!.top + FLOW_RING * 0.7, facing: 1 },
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
 * The flow scene, for a light or a dark page: the four rings with their
 * names, a dotted trail from each to the next, and the bird going round.
 */
export async function renderFlowSvg(dark: boolean): Promise<string> {
  const { left, top, width, height } = FLOW_VIEW;
  const colors = paint(dark);
  const perches = flowPerches();
  const name = await face("name");
  const ringMiddle = FLOW_RING_TOP + FLOW_RING / 2;
  const labels = FLOW_STEPS.map(({ label }, i) => {
    const line = outline(name, label, FLOW_LABEL_SIZE, -0.025);
    const middle = perches[i]!.left + FLOW_RING / 2;
    const x = middle - (line.ink.left + line.ink.right) / 2;
    return `  ${textPath(line, x, FLOW_RING_TOP + FLOW_RING + 34, colors.text)}`;
  });
  // A dotted trail from the open side of each ring to the back of the next.
  const trails = perches.slice(0, -1).map((perch, i) => {
    const from = perch.left + FLOW_RING + 10;
    const to = perches[i + 1]!.left - 6;
    return `    <path d="M${fixed(from, 2)} ${ringMiddle} H${fixed(to, 2)}" />`;
  });
  const alt = `${FLOW_STEPS.map((step) => step.label).join(", then ")}: the Contrack corvid flies from step to step.`;
  const stroke = `fill="none" stroke="${colors.ink}" stroke-width="${CORVID_OPTICAL.large.stroke}" stroke-linecap="round" stroke-linejoin="round"`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${alt}">`,
    `  <title>${alt}</title>`,
    `  <!-- Generated by scripts/brand/build-icons.ts from scripts/brand/readmeScenes.ts. Do not edit. -->`,
    ...REDUCED_MOTION_STYLE.map((line) => `  ${line}`),
    `  <g fill="none" stroke="${colors.trail}" stroke-width="2" stroke-linecap="round" stroke-dasharray="0.1 7">`,
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

// The birds at the foot of the README

/** The cards at the foot of the README, and the acts each one's bird plays. */
export const PERCHES = {
  help: { seed: 11, acts: ["cock", "caw", "glance"] },
  contribute: { seed: 23, acts: ["preen", "glance", "stretch"] },
  license: { seed: 31, acts: ["lookBack", "ruffle", "cock"] },
} as const satisfies Record<string, { seed: number; acts: ActName[] }>;
export type PerchName = keyof typeof PERCHES;

/**
 * One bird in its ring, in the mark's own box, for a light or a dark page.
 * It is the animated lockup's mark without the name, with acts of its own.
 */
export function renderPerchSvg(which: PerchName, dark: boolean): string {
  const { seed, acts } = PERCHES[which];
  const colors = paint(dark);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" role="img" aria-label="The Contrack corvid">`,
    `  <title>The Contrack corvid</title>`,
    `  <!-- Generated by scripts/brand/build-icons.ts from scripts/brand/readmeScenes.ts. Do not edit. -->`,
    ...REDUCED_MOTION_STYLE.map((line) => `  ${line}`),
    `  <g fill="none" stroke="${colors.ink}" stroke-width="${CORVID_OPTICAL.large.stroke}" stroke-linecap="round" stroke-linejoin="round">`,
    `    <path d="${CORVID_PATHS[CORVID_RING]}" />`,
    ...stillBird(colors.eye, "    "),
    ...livingBird(colors.eye, "    ", perchLoop(seed, acts)),
    `  </g>`,
    `</svg>`,
    ``,
  ].join("\n");
}
