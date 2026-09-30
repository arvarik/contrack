/**
 * animatedLockup: the lockup's bird, alive, for the README.
 *
 * The README heads with the lockup, and there the bird does what it does on
 * the sidebar perch: it blinks, looks about, preens, caws without a sound
 * and stretches a wing, and between times it sits still as the logo. A
 * README image is an `<img>`, which runs no script, so the motion is written
 * into the SVG as SMIL: one `<animate>` for each stroke's `d` and one for
 * each number of the eye. Every current browser plays SMIL inside an image.
 *
 * Nothing here draws the bird. The motion is the app's own:
 *
 * 1. `SCORE` says which acts play, in order. Each act is made by its maker
 *    in `src/lib/corvidMotion.ts`, from one seeded random source, so its
 *    reach and rhythm are the app's, and every build writes the same file.
 *    A still moment comes before each act. Blinks keep their own clock, and
 *    a blink plays over an act, as `CorvidBrain` layers them.
 * 2. The loop is sampled at the app's 60 frames a second. `drawCorvid` poses
 *    every frame and `corvidPathData` writes it, as the app paints a frame.
 * 3. A frame is dropped when a straight line between the frames kept either
 *    side of it passes within `TOLERANCE` of it. Each attribute keeps its own
 *    frames, so a stroke that holds still costs nothing while another moves.
 *
 * The loop starts and ends on `HOME_POSE`, so it repeats with no seam. A
 * stroke at rest is written with the logo's own path data, as `paintHome`
 * paints it in the app, so the still bird is the static lockup exactly. The
 * ring is not the bird's, and nothing here draws it.
 *
 * `CorvidBrain` does not direct the loop. It plans for a session in the app,
 * where a big act waits twenty seconds or more, so it cannot promise variety
 * in half a minute, or a loop that ends still. It also imports without file
 * extensions, which Node cannot load. The loop keeps what the brain does to a
 * perched bird: one act at a time, and blinks on `BLINK_EVERY`, its clock.
 */
import { CORVID_PATHS } from "../../src/assets/corvidPaths.ts";
import {
  HOME_POSE,
  corvidPathData,
  drawCorvid,
  type CorvidDrawing,
  type CorvidPose,
  type Vec,
} from "../../src/assets/corvidRig.ts";
import {
  between,
  createRng,
  makeBlink,
  makeCaw,
  makeCock,
  makeGlance,
  makeLookBack,
  makePreen,
  makeStretch,
  sampleMotion,
  type Motion,
  type Rng,
} from "../../src/lib/corvidMotion.ts";

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

/**
 * The seed of the loop the README shows. It was chosen from the first few
 * hundred for a loop that moves within its first second and a half, rests
 * under four seconds across the seam, and plays a full version of each act:
 * a glance of three turns, a preen of four nibbles, a cock of the head that
 * is answered the other way, and a caw of two bows.
 */
export const LOOP_SEED = 46;

/** The app's frame rate, and the rate the loop is sampled at. */
export const FRAME_RATE = 60;

/** Between blinks, in ms: `BLINK_EVERY` in `src/lib/corvidBrain.ts`. */
export const BLINK_EVERY: readonly [number, number] = [2_800, 7_200];

/** A still moment before each act, and after the last one, in ms. */
const PAUSE: readonly [number, number] = [1_400, 2_600];

/** The acts the loop plays, by name, and the maker of each. */
const MAKERS = {
  glance: makeGlance,
  cock: makeCock,
  lookBack: makeLookBack,
  preen: makePreen,
  caw: makeCaw,
  stretch: makeStretch,
} satisfies Record<string, (rng: Rng) => Motion>;

/**
 * The acts, in the order they play: the three ways of looking about, and
 * between them the three big acts, which move the rest of the bird. The
 * preen takes the head into the wing, the caw opens the beak and the
 * stretch opens the wing.
 */
export const SCORE: readonly (keyof typeof MAKERS)[] = [
  "glance",
  "preen",
  "cock",
  "caw",
  "lookBack",
  "stretch",
];

/** One motion in the loop, and when it starts, in ms. */
export interface Cue {
  motion: Motion;
  start: number;
}

export interface PerchLoop {
  /** The acts, one at a time, in order. */
  acts: Cue[];
  /** The blinks, on their own clock. */
  blinks: Cue[];
  /** How long the loop is, in ms: a whole number of frames. */
  duration: number;
}

/** The nearest frame to `ms`, as a time. Every cue starts on a frame. */
const onFrame = (ms: number) =>
  (Math.round((ms * FRAME_RATE) / 1000) * 1000) / FRAME_RATE;

/** The loop the seed gives. The same seed always gives the same loop. */
export function perchLoop(seed: number = LOOP_SEED): PerchLoop {
  const rng = createRng(seed);
  const acts: Cue[] = [];
  let end = 0;
  for (const name of SCORE) {
    const start = onFrame(end + between(rng, ...PAUSE));
    const motion = MAKERS[name](rng);
    acts.push({ motion, start });
    end = start + motion.duration;
  }
  // A tenth of a second is six frames, so the loop ends on a frame.
  const duration = Math.ceil((end + between(rng, ...PAUSE)) / 100) * 100;

  // The first blink comes sooner than the rest, as the brain's does. A
  // blink that would still be open when the loop ends is not played.
  const blinks: Cue[] = [];
  let next = between(rng, ...BLINK_EVERY) * 0.6;
  for (;;) {
    const motion = makeBlink(rng);
    const start = onFrame(next);
    if (start + motion.duration > duration) break;
    blinks.push({ motion, start });
    next = start + between(rng, ...BLINK_EVERY);
  }
  return { acts, blinks, duration };
}

const playing = (cues: readonly Cue[], t: number) =>
  cues.find(({ motion, start }) => t >= start && t < start + motion.duration);

/** The pose at `t` ms: the act playing, then a blink over it. */
export function loopPose(loop: PerchLoop, t: number): CorvidPose {
  let pose: CorvidPose = { ...HOME_POSE };
  const act = playing(loop.acts, t);
  if (act) pose = sampleMotion(pose, act.motion, t - act.start);
  const blink = playing(loop.blinks, t);
  if (blink) pose = sampleMotion(pose, blink.motion, t - blink.start);
  return pose;
}

/** How many frames the loop is. Frame 0 and this frame are both at rest. */
export const loopFrames = (loop: PerchLoop): number =>
  Math.round((loop.duration * FRAME_RATE) / 1000);

// ---------------------------------------------------------------------------
// Tracks: what each attribute is in every frame
// ---------------------------------------------------------------------------

/**
 * How far an in-between frame may stray, in the mark's 100 units, from the
 * straight line between the frames kept either side of it. At the README's
 * 400 px a unit is 0.9 px, so a quarter of a unit is under a quarter of a
 * pixel, and only while the bird moves fast.
 */
const TOLERANCE = 0.25;

/** The eye is small and its numbers are few, so it keeps closer. */
const EYE_TOLERANCE = 0.05;

/** A run of equal values this long, a tenth of a second, is a hold. */
const HOLD_FRAMES = FRAME_RATE / 10;

/** The bird's strokes, in the order the app draws them: the nape first. */
const STROKES = ["nape", "chest", "wing", "tail1", "tail2", "head"] as const;
type Stroke = (typeof STROKES)[number];

/** One attribute's value in every frame of the loop. */
interface Track {
  attribute: string;
  values: string[];
  /** The numbers a value draws with, to measure how far apart two are. */
  numbers: (value: string) => number[];
  tolerance: number;
  /** Held until the next value, never blended: `visibility`. */
  discrete?: boolean;
}

/** One element of the bird and what its attributes do over the loop. */
interface BirdPart {
  tag: "path" | "ellipse";
  tracks: Track[];
}

const spansOf = (drawing: CorvidDrawing, stroke: Stroke): Vec[][] =>
  stroke === "head" ? drawing.head : [drawing[stroke]];

const pathNumbers = (d: string) =>
  (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

/** A number to `places` decimals, written short. */
const fixed = (n: number, places: number) =>
  String(Number(n.toFixed(places)) || 0);

/**
 * Every drawing of the loop with the same number of points in each span of
 * a stroke, frame after frame. Path data morphs only between paths with the
 * same commands, and the nape is trimmed to fewer points as it draws itself
 * in. A short span repeats its last point, and the extra segments have no
 * length. A span that is not drawn at all waits, collapsed, where it is
 * first drawn, and its stroke is hidden while it does.
 */
function evenOut(drawings: readonly CorvidDrawing[]): CorvidDrawing[] {
  const shape = STROKES.map((stroke) => {
    const width: number[] = [];
    const rest: Vec[] = [];
    for (const drawing of drawings) {
      spansOf(drawing, stroke).forEach((span, i) => {
        width[i] = Math.max(width[i] ?? 0, span.length);
        rest[i] ??= span[0];
      });
    }
    return { stroke, width, rest };
  });
  return drawings.map((drawing) => {
    const even = { ...drawing };
    for (const { stroke, width, rest } of shape) {
      const spans = spansOf(drawing, stroke).map((span, i) => {
        const out = span.length > 0 ? span.slice() : [rest[i] ?? [0, 0]];
        while (out.length < width[i]!) out.push(out[out.length - 1]!);
        return out;
      });
      if (stroke === "head") even.head = spans as [Vec[], Vec[]];
      else even[stroke] = spans[0]!;
    }
    return even;
  });
}

/**
 * What every part of the bird is in every frame of the loop. At rest, a
 * stroke is the logo's own path data, as long as it kept the logo's points.
 */
function loopTracks(loop: PerchLoop): BirdPart[] {
  const frames = loopFrames(loop);
  const drawings = Array.from({ length: frames + 1 }, (_, i) =>
    drawCorvid(loopPose(loop, (i * loop.duration) / frames)),
  );
  const home = drawCorvid(HOME_POSE);
  const [homeData, ...data] = evenOut([home, ...drawings]).map(corvidPathData);

  const parts: BirdPart[] = [];
  for (const stroke of STROKES) {
    const drawn = drawings.map((drawing) =>
      spansOf(drawing, stroke).some((span) => span.length > 0),
    );
    if (!drawn.includes(true)) continue;
    const logo =
      stroke !== "nape" &&
      pathNumbers(homeData[stroke]).length ===
        pathNumbers(CORVID_PATHS[stroke]).length
        ? CORVID_PATHS[stroke]
        : null;
    const tracks: Track[] = [
      {
        attribute: "d",
        values: data.map((frame) =>
          logo !== null && frame[stroke] === homeData[stroke]
            ? logo
            : frame[stroke],
        ),
        numbers: pathNumbers,
        tolerance: TOLERANCE,
      },
    ];
    if (drawn.includes(false)) {
      tracks.push({
        attribute: "visibility",
        values: drawn.map((on) => (on ? "visible" : "hidden")),
        numbers: () => [],
        tolerance: 0,
        discrete: true,
      });
    }
    parts.push({ tag: "path", tracks });
  }
  parts.push({
    tag: "ellipse",
    tracks: (["cx", "cy", "rx", "ry"] as const).map((attribute) => ({
      attribute,
      values: drawings.map((drawing) => fixed(drawing.eye[attribute], 2)),
      numbers: (value) => [Number(value)],
      tolerance: EYE_TOLERANCE,
    })),
  });
  return parts;
}

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

/**
 * The frames of a track worth keeping. A frame goes when a straight line
 * between the frames kept either side passes within the tolerance of it,
 * because a straight line is what the browser draws between two keyframes.
 * A discrete track keeps each frame where its value changes.
 *
 * A hold is exact. Both ends of a run of equal values that lasts
 * `HOLD_FRAMES` or more are kept, so a stroke that holds still is drawn with
 * its own value, and the bird at rest is the logo and not a line that passes
 * near it. A shorter run is a slow moment of a movement, where two frames
 * round to the same tenth. The frames inside a run are never needed, so a
 * long stillness costs two keyframes.
 */
function keyframes(track: Track): number[] {
  const { values } = track;
  const last = values.length - 1;
  if (track.discrete)
    return values.flatMap((value, i) =>
      i === 0 || value !== values[i - 1] ? [i] : [],
    );

  // The candidates: the ends of each run of equal values. The ends of a
  // hold, and the loop's first and last frames, must be kept.
  const frames: number[] = [];
  const pinned: boolean[] = [];
  for (let start = 0, i = 1; i <= last + 1; i++) {
    if (i <= last && values[i] === values[start]) continue;
    const end = i - 1;
    const hold = end - start + 1 >= HOLD_FRAMES;
    frames.push(start);
    pinned.push(hold || start === 0 || start === last);
    if (end > start) {
      frames.push(end);
      pinned.push(hold || end === last);
    }
    start = i;
  }
  const numbers = frames.map((i) => track.numbers(values[i]!));
  const straight = (a: number, b: number) => {
    const from = numbers[a]!;
    const to = numbers[b]!;
    for (let m = a + 1; m < b; m++) {
      const k = (frames[m]! - frames[a]!) / (frames[b]! - frames[a]!);
      const at = numbers[m]!;
      for (let i = 0; i < at.length; i++) {
        const line = from[i]! + (to[i]! - from[i]!) * k;
        if (Math.abs(line - at[i]!) > track.tolerance) return false;
      }
    }
    return true;
  };
  const kept = [0];
  for (let from = 0; from < frames.length - 1;) {
    let to = from + 1;
    while (to < frames.length - 1 && !pinned[to] && straight(from, to + 1))
      to++;
    kept.push(to);
    from = to;
  }
  return kept.map((i) => frames[i]!);
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

/**
 * The style that holds the bird still for a person who asked for less
 * motion. CSS cannot pause SMIL, so the lockup carries the still bird too,
 * hidden, and shows it in place of the moving one.
 */
export const REDUCED_MOTION_STYLE: readonly string[] = [
  `<style>`,
  `  .still { display: none; }`,
  `  @media (prefers-reduced-motion: reduce) {`,
  `    .alive { display: none; }`,
  `    .still { display: inline; }`,
  `  }`,
  `</style>`,
];

/** One attribute over the loop, as an `<animate>` element. */
function animate(track: Track, loop: PerchLoop): string {
  const frames = loopFrames(loop);
  const kept = keyframes(track);
  const keyTimes = kept.map((i) => fixed(i / frames, 4)).join(";");
  const values = kept.map((i) => track.values[i]).join(";");
  const discrete = track.discrete ? ` calcMode="discrete"` : "";
  return `<animate attributeName="${track.attribute}" dur="${loop.duration / 1000}s" repeatCount="indefinite"${discrete} keyTimes="${keyTimes}" values="${values}" />`;
}

/**
 * The living bird, as the lines of an SVG group. Each stroke has its path
 * data at rest and an `<animate>` for what it does over the loop, and the
 * eye is an ellipse, so that it can blink. The group's class is `alive`,
 * which `REDUCED_MOTION_STYLE` hides for a person who asked for less motion.
 */
export function livingBird(
  eye: string,
  indent: string,
  loop: PerchLoop = perchLoop(),
): string[] {
  const inner = `${indent}  `;
  const lines = [`${indent}<g class="alive">`];
  for (const { tag, tracks } of loopTracks(loop)) {
    // Each attribute at rest, as frame 0 has it, which is the logo's. A
    // stroke is visible unless it says otherwise.
    const rest = tracks
      .filter((track) => track.values[0] !== "visible")
      .map((track) => ` ${track.attribute}="${track.values[0]}"`)
      .join("");
    const paint = tag === "ellipse" ? ` fill="${eye}" stroke="none"` : "";
    const moving = tracks.filter((track) => new Set(track.values).size > 1);
    if (moving.length === 0) {
      lines.push(`${inner}<${tag}${rest}${paint} />`);
      continue;
    }
    lines.push(
      `${inner}<${tag}${rest}${paint}>`,
      ...moving.map((track) => `${inner}  ${animate(track, loop)}`),
      `${inner}</${tag}>`,
    );
  }
  lines.push(`${indent}</g>`);
  return lines;
}
