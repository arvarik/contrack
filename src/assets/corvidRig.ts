/**
 * The corvid's rig: the bird in `corvidPaths.ts`, able to move.
 *
 * The mark is a ring and a bird. The ring is the C, and it never moves. The
 * bird is five strokes and an eye, and this file poses them. Every pose is a
 * set of numbers (how far into flight, which way the head faces, how high
 * the wing is), and `drawCorvid` turns one set into the same strokes the
 * mark is drawn with. There is no second drawing of the bird anywhere:
 *
 * - The sitting bird is read from `CORVID_PATHS` at load, so `HOME_POSE`
 *   draws the logo point for point. `corvidRig.test.ts` holds that.
 * - The flying bird is the same five strokes in other places. The head is
 *   the logo's head, turned, and never redrawn. The wing is the logo's wing
 *   in its own frame, hinged at the shoulder. The tail keeps its hairpin.
 * - One line is new: the nape. Sitting in the ring, the bird borrows the
 *   ring for the back of its head. A bird out of the ring needs its own, so
 *   the nape draws itself in as the bird leaves and back out as it lands.
 *
 * How a pose is built, in order:
 *
 * 1. The body blends between two shapes, `PERCH` (the logo) and `FLIGHT`
 *    (level, tail behind), by `flight`. `crouch` squats the sitting bird on
 *    its feet and leans it forward.
 * 2. The body turns under the head about the neck's x by `bodyFacing`: 1 is
 *    the logo's body, -1 the mirror. The head keeps its own `headFacing`, so
 *    a bird can turn round on its perch with its head held still, which is
 *    what a real one does.
 * 3. The head is rigid. It turns about `NECK`, faces by `headFacing` and
 *    tilts by `headAngle` (positive lifts the beak whichever way it faces).
 *    The throat hangs between the head and the body: each of its points
 *    follows the head by a weight that falls to nothing at the shoulder, so
 *    the neck bends instead of breaking.
 * 4. The wing is the logo's wing in its own frame, the hinge at the origin
 *    and the tip along +x. `wingSpread` opens it, `wingCurl` bends the tip,
 *    `wingTurn` narrows it through the middle of a stroke so the leading
 *    edge stays in front, and `wingAngle` swings it about the shoulder.
 *
 * Everything here is pure arithmetic on a 100-unit box, y down, the same
 * box as the mark, so the flight overlay, the perch, the brand script and
 * the tests all draw the one bird the same way.
 *
 * @module assets/corvidRig
 */
import { CORVID_EYE, CORVID_PATHS, parsePath } from "./corvidPaths";

export type Vec = readonly [number, number];

// ---------------------------------------------------------------------------
// The logo, as points
// ---------------------------------------------------------------------------

/**
 * The points a path passes through. Every stroke in `corvidPaths.ts` is a
 * Catmull-Rom spline written out as cubics, so the end points of its cubics
 * are the whole drawing and the handles follow from them.
 */
export function throughPoints(d: string): Vec[][] {
  const spans: Vec[][] = [];
  for (const { cmd, points } of parsePath(d)) {
    if (cmd === "M") spans.push([points[0]!]);
    else spans[spans.length - 1]!.push(points[2]!);
  }
  return spans;
}

const only = (d: string): Vec[] => throughPoints(d)[0]!;
const [LOGO_CROWN, LOGO_JAW] = throughPoints(CORVID_PATHS.head) as [
  Vec[],
  Vec[],
];
const LOGO_CHEST = only(CORVID_PATHS.chest);
const LOGO_WING = only(CORVID_PATHS.wing);
const LOGO_TAIL1 = only(CORVID_PATHS.tail1);
const LOGO_TAIL2 = only(CORVID_PATHS.tail2);

/** The jaw's first four points are the lower beak; the rest is the throat. */
const JAW_RIGID = 4;

/** The head turns and tilts about this point. The body turns about its x. */
export const NECK: Vec = [37, 35];

/** The wing hinges here, in the round of its base. */
export const SHOULDER: Vec = [38.6, 47.4];

/** Where the sitting bird's weight is: a crouch squats onto this point. */
export const FEET: Vec = [44, 84];

// ---------------------------------------------------------------------------
// Small vector helpers
// ---------------------------------------------------------------------------

const RAD = Math.PI / 180;
const rotate = ([x, y]: Vec, deg: number): Vec => {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return [x * c - y * s, x * s + y * c];
};
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const mix = (a: Vec, b: Vec, t: number): Vec => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const mixAll = (a: readonly Vec[], b: readonly Vec[], t: number): Vec[] =>
  t === 0 ? a.slice() : a.map((p, i) => mix(p, b[i]!, t));
const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

// ---------------------------------------------------------------------------
// The wing, in its own frame
// ---------------------------------------------------------------------------

/** The logo wing's resting angle about the shoulder, in degrees. */
const LOGO_WING_ANGLE =
  Math.atan2(LOGO_WING[0]![1] - SHOULDER[1], LOGO_WING[0]![0] - SHOULDER[0]) /
  RAD;

/** The logo's wing with the hinge at the origin and the tip along +x. */
const WING_FOLDED: readonly Vec[] = LOGO_WING.map((p) =>
  rotate(sub(p, SHOULDER), -LOGO_WING_ANGLE),
);

/**
 * The same wing, open. A fifth wider and a little longer at the flick, which
 * is the trailing feathers: close enough to the folded wing that the bird
 * opening its wing reads as this wing opening, and not as a new shape.
 */
const WING_OPEN: readonly Vec[] = WING_FOLDED.map(([x, y], i) => [
  x * (i >= 16 ? 1.08 : 1.02),
  y * 1.2,
]);

// ---------------------------------------------------------------------------
// The two body shapes
// ---------------------------------------------------------------------------

interface BodyShape {
  chest: readonly Vec[];
  tail1: readonly Vec[];
  tail2: readonly Vec[];
  /** The nape. Sitting, this is the line with the head looking back. */
  nape: readonly Vec[];
  /** Where each throat point sits when it follows the body. */
  throat: readonly Vec[];
  /** Where the head's pivot sits. */
  neck: Vec;
  /** How far the head is lifted in this shape, in degrees. */
  beakUp: number;
  shoulder: Vec;
  wingAngle: number;
  tailPivot: Vec;
}

/**
 * The logo, sitting in the ring. Every stroke but the nape is read from the
 * mark. The nape runs round the back of the head to the top of the chest,
 * inside the ring's line: the ring draws it while the bird is home.
 */
const PERCH: BodyShape = {
  chest: LOGO_CHEST,
  tail1: LOGO_TAIL1,
  tail2: LOGO_TAIL2,
  nape: [
    [27.1, 21.1],
    [24.6, 23.4],
    [22.8, 26.6],
    [22.2, 30],
    [22.8, 33.4],
    [24.4, 36.2],
    [26.7, 38.3],
  ],
  throat: LOGO_JAW.slice(JAW_RIGID),
  neck: NECK,
  beakUp: 0,
  shoulder: SHOULDER,
  wingAngle: LOGO_WING_ANGLE,
  tailPivot: [48, 80],
};

/**
 * Level flight, facing left like the logo's body, the tail trailing right.
 * The head is the logo's head turned to face the way it flies, lifted nine
 * degrees so the beak leads; the nape becomes the line of the back.
 */
const FLIGHT: BodyShape = {
  chest: [
    [38.4, 63.2],
    [43, 65.2],
    [48.5, 66.2],
    [54, 66],
    [59.5, 64.8],
    [64.5, 62.6],
    [68.6, 60],
    [71.8, 57.4],
    [74, 55.2],
    [75.2, 53.6],
    [75.8, 52.4],
    [76, 51.6],
  ],
  tail1: [
    [74.5, 46.4],
    [79, 46.6],
    [83.5, 47],
    [87.5, 47.6],
    [90.6, 48.5],
    [91.8, 49.6],
    [91.2, 50.8],
    [89, 52],
    [85.6, 53.1],
    [81.8, 53.9],
    [78.6, 54.1],
    [76.4, 53.6],
    [75, 52.8],
    [74, 53.8],
    [73.5, 55.3],
    [73.7, 56.6],
  ],
  tail2: [
    [77, 50],
    [80.2, 50.2],
    [83.2, 50.4],
    [86, 50.6],
    [88, 50.7],
    [89.3, 50.7],
  ],
  nape: [
    [33, 34.6],
    [40, 35.4],
    [47.5, 37.2],
    [55, 39.6],
    [62.5, 42.2],
    [69, 44.6],
    [74.5, 46.4],
  ],
  throat: [
    [29.2, 48.6],
    [29.9, 52.2],
    [31.1, 55.6],
    [33, 58.7],
    [35.5, 61.3],
    [38.4, 63.2],
  ],
  neck: [21.09, 46.77],
  beakUp: 9,
  shoulder: [44, 40],
  wingAngle: -6,
  tailPivot: [75, 50],
};

/**
 * The sitting nape with the head turned to look the way the body faces: the
 * crown's first point is then on the other side of the pivot, so the line
 * runs down the back of the neck to the top of the wing instead.
 */
const PERCH_NAPE_AHEAD: readonly Vec[] = [
  [46.9, 21.1],
  [49.3, 23.3],
  [50.9, 26.4],
  [51.6, 29.9],
  [51.5, 33.6],
  [50.6, 37.6],
  [49.4, 41.6],
];

/** How much of the head each throat point follows. The rest follows the body. */
const THROAT_FOLLOWS_HEAD = [0.9, 0.75, 0.55, 0.35, 0.15, 0] as const;

// ---------------------------------------------------------------------------
// The pose
// ---------------------------------------------------------------------------

/**
 * Everything the bird can do, as numbers. Angles are degrees. Distances are
 * units of the 100-unit box. The home pose, every field at its default, is
 * the logo.
 */
export interface CorvidPose {
  /** 0 sitting (the logo), 1 flying. */
  flight: number;
  /** Sitting only: -1 drawn up tall, 1 squatting to spring. */
  crouch: number;
  /** 1 the logo's body, -1 its mirror. Passes through 0 when it turns. */
  bodyFacing: number;
  /** How much of the nape is drawn, from the head down. 0 in the ring. */
  nape: number;
  /** 0 to 1. The feathers stand up and the outline grows a little. */
  fluff: number;
  /** The whole bird, ring excluded, moved by this much. */
  x: number;
  y: number;
  /** Beak up, in degrees, whichever way the head faces. */
  headAngle: number;
  /** 1 the beak points right, as in the logo, -1 left. */
  headFacing: number;
  /** The head moved off its pivot, x along the body's facing. */
  headX: number;
  headY: number;
  /** 0 shut, 1 open as far as a caw. */
  beak: number;
  /** 1 open, 0 shut. */
  eye: number;
  /** Tip down is positive, about the shoulder, from the shape's rest angle. */
  wingAngle: number;
  /** 0 folded (the logo), 1 open. */
  wingSpread: number;
  /** Bends the tip: positive bends it down, negative up. */
  wingCurl: number;
  /** 1 the side the logo shows, -1 the underside, near 0 edge on. */
  wingTurn: number;
  /** Tip down is positive, about the root of the tail. */
  tailAngle: number;
}

/** The logo. */
export const HOME_POSE: Readonly<CorvidPose> = Object.freeze({
  flight: 0,
  crouch: 0,
  bodyFacing: 1,
  nape: 0,
  fluff: 0,
  x: 0,
  y: 0,
  headAngle: 0,
  headFacing: 1,
  headX: 0,
  headY: 0,
  beak: 0,
  eye: 1,
  wingAngle: 0,
  wingSpread: 0,
  wingCurl: 0,
  wingTurn: 1,
  tailAngle: 0,
});

/** The home pose with some fields changed. */
export const corvidPose = (changes: Partial<CorvidPose> = {}): CorvidPose => ({
  ...HOME_POSE,
  ...changes,
});

/** The fields a pose adds up from, so behaviours can be layered. */
export const POSE_KEYS = Object.keys(HOME_POSE) as (keyof CorvidPose)[];

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/** One posed bird, as the points each stroke passes through. */
export interface CorvidDrawing {
  /** The crown, then the beak and the throat: the logo's head is two spans. */
  head: [Vec[], Vec[]];
  chest: Vec[];
  wing: Vec[];
  tail1: Vec[];
  tail2: Vec[];
  /** Empty while the ring stands in for it. */
  nape: Vec[];
  eye: { cx: number; cy: number; rx: number; ry: number };
}

/** The first `t` of a polyline, by length. */
export function trimPoints(points: readonly Vec[], t: number): Vec[] {
  if (t >= 1) return points.slice();
  if (t <= 0 || points.length < 2) return [];
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    lengths.push(lengths[i - 1]! + Math.hypot(bx - ax, by - ay));
  }
  const want = lengths[lengths.length - 1]! * t;
  const out: Vec[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    if (lengths[i]! <= want) {
      out.push(points[i]!);
      continue;
    }
    const k = (want - lengths[i - 1]!) / (lengths[i]! - lengths[i - 1]!);
    out.push(mix(points[i - 1]!, points[i]!, k));
    break;
  }
  return out;
}

/** The mark's eye radius. The rig's eye is an ellipse so it can blink. */
const EYE_R = CORVID_EYE.r;

/** Pose the bird. Pure: the same pose always draws the same bird. */
export function drawCorvid(pose: CorvidPose): CorvidDrawing {
  const f = clamp01(pose.flight);
  const sitting = 1 - f;
  const shape = <K extends "chest" | "tail1" | "tail2" | "throat">(key: K) =>
    mixAll(PERCH[key], FLIGHT[key], f);

  // The head looks ahead when it faces the way the body does.
  const ahead = clamp01(
    (1 - pose.headFacing * Math.sign(pose.bodyFacing || 1)) / 2,
  );

  // 1. Sitting posture: squat onto the feet and lean into it.
  const crouch = pose.crouch * sitting;
  const squat = ([x, y]: Vec): Vec => {
    const height = Math.max(FEET[1] - y, 0) / 60;
    return [
      x - 2.5 * crouch * height,
      FEET[1] + (y - FEET[1]) * (1 - 0.07 * crouch),
    ];
  };
  // Feathers up: about the middle of the body, a little more across than up.
  const middle = mix([48, 60], [55, 52], f);
  const puff = ([x, y]: Vec): Vec => [
    middle[0] + (x - middle[0]) * (1 + 0.05 * pose.fluff),
    middle[1] + (y - middle[1]) * (1 + 0.04 * pose.fluff),
  ];
  // 2. The body turns under the head.
  const bf = pose.bodyFacing;
  const turn = ([x, y]: Vec): Vec => [NECK[0] + (x - NECK[0]) * bf, y];
  const offset = ([x, y]: Vec): Vec => [x + pose.x, y + pose.y];
  const body = (p: Vec): Vec => offset(turn(puff(squat(p))));

  // 3. The head: rigid, pivoting on the neck.
  const hf = pose.headFacing;
  const neck = mix(PERCH.neck, FLIGHT.neck, f);
  const anchor = add(body(neck), [pose.headX * Math.sign(bf || 1), pose.headY]);
  const lift =
    PERCH.beakUp + (FLIGHT.beakUp - PERCH.beakUp) * f + pose.headAngle;
  const tilt = -(hf < 0 ? -1 : 1) * lift;
  const head = ([x, y]: Vec): Vec =>
    add(anchor, rotate([(x - NECK[0]) * hf, y - NECK[1]], tilt));

  const crown = LOGO_CROWN.map(head);
  // The lower beak drops about the gape, most at the tip.
  const gape = LOGO_JAW[JAW_RIGID - 1]!;
  const open = 20 * pose.beak;
  const beak = LOGO_JAW.slice(0, JAW_RIGID).map((p, i) =>
    head(
      i < JAW_RIGID - 1
        ? add(gape, rotate(sub(p, gape), open * (1 - i / (JAW_RIGID - 1))))
        : p,
    ),
  );
  const throatBody = shape("throat").map(body);
  const throat = LOGO_JAW.slice(JAW_RIGID).map((p, i) =>
    mix(throatBody[i]!, head(p), THROAT_FOLLOWS_HEAD[i]!),
  );

  // The tail flicks about its root, the tip most.
  const tailPivot = mix(PERCH.tailPivot, FLIGHT.tailPivot, f);
  const flick = (points: Vec[]) =>
    pose.tailAngle === 0
      ? points
      : points.map((p) => {
          const reach = Math.min(
            Math.hypot(p[0] - tailPivot[0], p[1] - tailPivot[1]) / 40,
            1,
          );
          return add(
            tailPivot,
            rotate(sub(p, tailPivot), pose.tailAngle * reach),
          );
        });

  // 4. The wing, in its own frame, then hinged at the shoulder.
  const shoulder = mix(PERCH.shoulder, FLIGHT.shoulder, f);
  const rest = PERCH.wingAngle + (FLIGHT.wingAngle - PERCH.wingAngle) * f;
  const wingLocal = mixAll(WING_FOLDED, WING_OPEN, clamp01(pose.wingSpread));
  const wing = wingLocal.map(([x, y]) => {
    const bend = pose.wingCurl * 10 * (Math.max(x, 0) / 50) ** 2;
    return body(
      add(
        shoulder,
        rotate([x, y * pose.wingTurn + bend], rest + pose.wingAngle),
      ),
    );
  });

  // The nape: from the crown's first point, round the back of the head.
  const napeSitting = mixAll(PERCH.nape, PERCH_NAPE_AHEAD, ahead);
  const nape = mixAll(napeSitting, FLIGHT.nape, f).map(body);
  nape[0] = crown[0]!;

  const eye = head([CORVID_EYE.cx, CORVID_EYE.cy]);
  return {
    head: [crown, [...beak, ...throat]],
    chest: shape("chest").map(body),
    wing,
    tail1: flick(shape("tail1")).map(body),
    tail2: flick(shape("tail2")).map(body),
    nape: trimPoints(nape, pose.nape),
    eye: {
      cx: eye[0],
      cy: eye[1],
      rx: EYE_R * Math.max(Math.abs(hf), 0.35),
      ry: EYE_R * Math.max(clamp01(pose.eye), 0.08),
    },
  };
}

// ---------------------------------------------------------------------------
// Path data
// ---------------------------------------------------------------------------

/** One decimal, written short, the way `corvidPaths.ts` writes its numbers. */
const num = (n: number): string => String(Math.round(n * 10) / 10 || 0);

/**
 * A Catmull-Rom spline through the points, as absolute `M` and `C` only, at
 * the tension the mark was traced with. `parsePath` reads it back.
 */
export function splinePath(points: readonly Vec[]): string {
  if (points.length < 2) return "";
  const n = points.length;
  const at = (i: number) => points[Math.min(Math.max(i, 0), n - 1)]!;
  let d = `M${num(points[0]![0])} ${num(points[0]![1])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    d +=
      ` C${num(p1[0] + (p2[0] - p0[0]) / 6)} ${num(p1[1] + (p2[1] - p0[1]) / 6)}` +
      ` ${num(p2[0] - (p3[0] - p1[0]) / 6)} ${num(p2[1] - (p3[1] - p1[1]) / 6)}` +
      ` ${num(p2[0])} ${num(p2[1])}`;
  }
  return d;
}

/** The strokes a drawing makes, keyed like the mark's parts. */
export interface CorvidPathData {
  head: string;
  chest: string;
  wing: string;
  tail1: string;
  tail2: string;
  nape: string;
}

export function corvidPathData(drawing: CorvidDrawing): CorvidPathData {
  return {
    head: `${splinePath(drawing.head[0])} ${splinePath(drawing.head[1])}`,
    chest: splinePath(drawing.chest),
    wing: splinePath(drawing.wing),
    tail1: splinePath(drawing.tail1),
    tail2: splinePath(drawing.tail2),
    nape: splinePath(drawing.nape),
  };
}

/**
 * A drawing turned about its long axis, the line `y = about`, as in a barrel
 * roll: `roll` 1 is upright, -1 upside down and 0 edge on. It moves the
 * points and not the pen, so every stroke keeps its width. A squash in CSS
 * thins the strokes with the bird, and the edge-on bird goes to a broken
 * hairline. This one stays a line as thick as the rest of the drawing.
 */
export function rollDrawing(
  drawing: CorvidDrawing,
  roll: number,
  about: number,
): CorvidDrawing {
  if (roll === 1) return drawing;
  const turn = (points: readonly Vec[]): Vec[] =>
    points.map(([x, y]): Vec => [x, about + (y - about) * roll]);
  return {
    head: [turn(drawing.head[0]), turn(drawing.head[1])],
    chest: turn(drawing.chest),
    wing: turn(drawing.wing),
    tail1: turn(drawing.tail1),
    tail2: turn(drawing.tail2),
    nape: turn(drawing.nape),
    eye: {
      ...drawing.eye,
      cy: about + (drawing.eye.cy - about) * roll,
      ry: drawing.eye.ry * Math.abs(roll),
    },
  };
}

// ---------------------------------------------------------------------------
// Placing a flying bird
// ---------------------------------------------------------------------------

/**
 * The point a flight path carries: the middle of the body, in rig units. A
 * flying bird's is the middle of its back, mirrored with the body, so the
 * path holds the bird by its body and not by a corner of the box while it
 * turns and flaps.
 *
 * A sitting bird's is the middle of the mark, and it does not move when the
 * body turns: a bird turning round on its perch turns about its neck, with
 * its head held still, so the point it is held by must hold still too. The
 * mirror comes in with flight.
 */
export function bodyCentre(
  pose: Pick<CorvidPose, "flight" | "bodyFacing" | "x" | "y">,
): Vec {
  const f = clamp01(pose.flight);
  const [x, y] = mix([56, 54], [56, 52], f);
  const facing = 1 + (pose.bodyFacing - 1) * f;
  return [NECK[0] + (x - NECK[0]) * facing + pose.x, y + pose.y];
}
