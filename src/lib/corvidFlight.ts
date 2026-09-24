/**
 * corvidFlight — where the corvid goes when it leaves the ring, and how it
 * moves on the way.
 *
 * `planFlight` draws a new route every time: a lap of the window in either
 * direction, a figure of eight, a short outing near the perch, or the
 * celebration's pass along the top. The route is a spline through random
 * waypoints inside the part of the window the bird may cross, and the plan
 * then answers one question, `frame(t)`: where the bird is `t` ms in, how
 * big, at what angle, and in what pose.
 *
 * Why a flight looks alive and not looped:
 *
 * - **The route is random**, and so is the pace: a cruising speed per
 *   flight, slower in a climb and faster in a dive, a push off the perch and
 *   a braking flare at the end.
 * - **The wings work in bursts.** Three to six beats at five to seven beats a
 *   second, then a glide of a third of a second to a second, and more beats
 *   when the route climbs. The first beats off the perch are the strongest.
 * - **The bird turns round rather than flying upside down.** Its body faces
 *   the way it goes, and when the route doubles back it turns, narrowing
 *   through the turn the way a bird seen side on does. It pitches with the
 *   climb and leans into the curve, a little.
 * - **Now and then it plays.** A barrel roll on a celebration and on the odd
 *   lap, because ravens do that, and a slow drift nearer and farther away.
 *
 * It takes off from the ring and lands back in it. Off the ring it crouches,
 * turns its body under its head to face the way it will go, draws its nape
 * in and leaps. Coming home it flares, touches down, folds its wing, looks
 * back over its shoulder and lets the ring have its nape again. The first
 * and last frames are the logo at the perch's size and place, so the swap
 * between the perch and the flying bird cannot be seen.
 *
 * Everything is a pure function of the request and the random source, so a
 * seeded test can fly the same route twice and measure it.
 *
 * @module lib/corvidFlight
 */
import { HOME_POSE, bodyCentre, type CorvidPose } from "../assets/corvidRig";
import {
  between,
  chance,
  count,
  easeIn,
  easeInOut,
  easeOut,
  sign,
  type Rng,
} from "./corvidMotion";

// ---------------------------------------------------------------------------
// Where a flight may go
// ---------------------------------------------------------------------------

/** How far the flight stays inside the left, right and bottom edges. */
export const FLIGHT_EDGE = 24;
/** The band at the top of the window that the page header owns. */
export const FLIGHT_TOP = 56;
/** The band at the bottom that a phone's tab bar owns. */
export const FLIGHT_PHONE_BOTTOM = 96;
/** Tailwind's `md`. Below it the tab bar exists, above it the sidebar does. */
export const FLIGHT_MD = 768;

export interface FlightViewport {
  width: number;
  height: number;
}

export interface FlightBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The rectangle a flight is allowed to cross.
 *
 * A window can be smaller than its own margins, so each axis collapses to its
 * midpoint rather than inverting. A degenerate box gives a flight that goes
 * nowhere, which is the right answer for a window 100 pixels tall.
 */
export function flightBox(viewport: FlightViewport): FlightBox {
  const bottomBand =
    viewport.width < FLIGHT_MD ? FLIGHT_PHONE_BOTTOM : FLIGHT_EDGE;
  const [left, right] = span(FLIGHT_EDGE, viewport.width - FLIGHT_EDGE);
  const [top, bottom] = span(FLIGHT_TOP, viewport.height - bottomBand);
  return { left, top, right, bottom };
}

function span(low: number, high: number): [number, number] {
  if (low <= high) return [low, high];
  const middle = (low + high) / 2;
  return [middle, middle];
}

type Point = [number, number];

const clampTo = (box: FlightBox, [x, y]: Point): Point => [
  Math.min(Math.max(x, box.left), box.right),
  Math.min(Math.max(y, box.top), box.bottom),
];

// ---------------------------------------------------------------------------
// The request and the plan
// ---------------------------------------------------------------------------

/**
 * `loop` is the perch's click: a lap of the window. `swoop` is the
 * celebration: a pass along the top, with a flourish. `sortie` is the bird
 * stretching its wings by itself: short, near the perch, and home.
 */
export type FlightKind = "loop" | "swoop" | "sortie";

export interface FlightPerch {
  /** The perch's mark: its top left corner and its size, in px. */
  left: number;
  top: number;
  size: number;
}

export interface FlightRequest {
  kind: FlightKind;
  viewport: FlightViewport;
  /** Where the bird sits. Null: a flypast from off the left edge and out. */
  perch: FlightPerch | null;
  rng: Rng;
  /**
   * Already flying: the way home after a second press. The plan skips the
   * launch, starts where the bird is, facing the way it faces, and eases
   * out of the frame it was drawing, so nothing about the bird jumps.
   */
  airborne?: { x: number; y: number; facing: 1 | -1; from?: FlightFrame };
}

/** One moment of a flight. */
export interface FlightFrame {
  /** Where the middle of the bird's body is, in px. */
  x: number;
  y: number;
  /** How many px one 100-unit rig box is drawn at. */
  size: number;
  /** The whole bird's angle, degrees clockwise. */
  rotate: number;
  /** 1 upright, -1 upside down. A barrel roll passes through 0. */
  roll: number;
  pose: CorvidPose;
}

export interface FlightPlan {
  kind: FlightKind;
  /** How long it takes, in ms, from the first crouch to the last settle. */
  duration: number;
  /** Whether it ends on the perch. A flypast ends off screen. */
  lands: boolean;
  /** The route, as `M` and `L` in px, for tests and for a debugging eye. */
  route: string;
  frame(t: number): FlightFrame;
  /**
   * Whether the bird may be asked home at `t`: not while it is still
   * leaving the ring, and not once it is coming in to land.
   */
  interruptible(t: number): boolean;
}

/** How big the bird flies, in px per rig box: bigger than it sits. */
export const flightSize = (viewport: FlightViewport): number =>
  viewport.width < FLIGHT_MD ? 52 : 64;

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** Off the perch: crouch, turn, leap. The route starts partway in. */
const LAUNCH_MS = 480;
/** When the bird starts along the route: after it has turned, in the ring. */
const DEPART_MS = 215;
/** The braking flare before touchdown. */
const FLARE_MS = 380;
/** After touchdown: fold, look back, give the ring its nape. */
const SETTLE_MS = 480;
/** How long a turn round takes in the air. */
const TURN_MS = 170;
/** A barrel roll. */
const ROLL_MS = 580;
/** How long the way home takes to ease out of the frame it began in. */
const HOMEWARD_BLEND_MS = 180;
/** The bird grows from the ring's size to its flying size over this span. */
const GROW_FROM = 150;
const GROW_TO = 720;
/** It starts shrinking back this long before the flare. */
const SHRINK_LEAD = 320;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** The waypoints of one flight, the perch first and last when it lands. */
function waypoints(req: FlightRequest, start: Point, box: FlightBox): Point[] {
  const { rng, kind, viewport } = req;
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const centre: Point = [box.left + width / 2, box.top + height / 2];
  const at = (fx: number, fy: number): Point =>
    clampTo(box, [box.left + width * fx, box.top + height * fy]);

  if (!req.perch) {
    // A flypast: in from the left, along the upper third, out on the right.
    const y = between(rng, 0.08, 0.22);
    const off = flightSize(viewport);
    return [
      [box.left - off * 1.5, box.top + height * y],
      at(between(rng, 0.2, 0.3), y + between(rng, 0.06, 0.14)),
      at(between(rng, 0.45, 0.55), y - between(rng, 0, 0.06)),
      at(between(rng, 0.7, 0.8), y + between(rng, 0.04, 0.12)),
      [box.right + off * 1.5, box.top + height * (y - 0.04)],
    ];
  }

  // Off the perch: up and away into the room, then the route, then an
  // approach from the ring's open side, so the bird comes in flying toward
  // its own ring and lands facing the way the logo's body does.
  const side = start[0] < centre[0] ? 1 : -1;
  const launch = clampTo(box, [
    start[0] + side * between(rng, 80, 120),
    start[1] + between(rng, 26, 60),
  ]);
  // The approach comes up from below and to the open side of the ring, the
  // way a bird swoops up onto a perch to shed its speed.
  const approach: Point = [
    start[0] + side * between(rng, 140, 190),
    Math.max(start[1] + between(rng, 50, 90), box.top),
  ];

  let middle: Point[];
  if (kind === "sortie") {
    // A short outing near home: one small loop in the corner of the room
    // by the ring, out along the top, round, and back underneath.
    const reachX = Math.min(width * 0.42, 520);
    const reachY = Math.min(height * 0.42, 320);
    const out = (fx: number, fy: number): Point =>
      clampTo(box, [start[0] + side * reachX * fx, box.top + reachY * fy]);
    middle = [
      out(between(rng, 0.45, 0.65), between(rng, 0, 0.2)),
      out(between(rng, 0.8, 1), between(rng, 0.35, 0.65)),
      out(between(rng, 0.35, 0.55), between(rng, 0.7, 1)),
    ];
  } else if (kind === "swoop") {
    // The celebration: along the top third, round in a wide turn at the
    // far end, and home a little lower, with room to bank all the way.
    const y = between(rng, 0.06, 0.18);
    const drop = between(rng, 0.14, 0.22);
    middle = [
      at(0.3, y + between(rng, 0.04, 0.1)),
      at(between(rng, 0.55, 0.62), y - between(rng, 0, 0.04)),
      at(between(rng, 0.8, 0.86), y + between(rng, 0.02, 0.06)),
      at(0.95, y + drop * 0.5),
      at(between(rng, 0.8, 0.86), y + drop),
      at(between(rng, 0.5, 0.6), y + drop + between(rng, 0, 0.06)),
    ];
    if (side < 0)
      middle = middle.map(([x, py]) => [box.right - (x - box.left), py]);
  } else {
    // A lap: three to five waypoints round the room's middle, clockwise or
    // not, near the walls or cutting the corners, and one lap in five
    // crosses itself into a figure of eight.
    const n = count(rng, 3, 5);
    const direction = sign(rng);
    const startAngle = Math.atan2(start[1] - centre[1], start[0] - centre[0]);
    middle = [];
    for (let i = 1; i <= n; i++) {
      const angle =
        startAngle +
        direction * ((i / (n + 1)) * 2 * Math.PI + between(rng, -0.3, 0.3));
      const reach = between(rng, 0.5, 0.85);
      middle.push(
        clampTo(box, [
          centre[0] + Math.cos(angle) * (width / 2) * reach,
          centre[1] + Math.sin(angle) * (height / 2) * reach,
        ]),
      );
    }
    if (n >= 4 && chance(rng, 0.2)) {
      const a = middle[1]!;
      middle[1] = middle[2]!;
      middle[2] = a;
    }
  }
  return relax([start, launch, ...middle, approach, start]);
}

/** The sharpest turn a flight takes at a waypoint, in degrees. */
const MAX_TURN = 100;

/**
 * Soften any waypoint the route would turn too sharply at. A bird at speed
 * cannot turn on a point, and a random route will now and then ask it to:
 * such a waypoint is drawn toward the middle of its two neighbours until the
 * turn is one a bird could make. The ends stay where they are.
 */
function relax(points: Point[]): Point[] {
  const out = points.map((p) => [...p] as Point);
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1]!;
      const b = out[i]!;
      const c = out[i + 1]!;
      if (turnAt(a, b, c) <= MAX_TURN) continue;
      out[i] = [
        b[0] + ((a[0] + c[0]) / 2 - b[0]) * 0.35,
        b[1] + ((a[1] + c[1]) / 2 - b[1]) * 0.35,
      ];
      changed = true;
    }
    if (!changed) break;
  }
  return out;
}

/** How far the direction turns at `b`, from `a` through `b` to `c`, in degrees. */
function turnAt(a: Point, b: Point, c: Point): number {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const vx = c[0] - b[0];
  const vy = c[1] - b[1];
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu < 1e-6 || lv < 1e-6) return 0;
  const cos = Math.min(1, Math.max(-1, (ux * vx + uy * vy) / (lu * lv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * A centripetal Catmull-Rom spline through the waypoints, sampled densely.
 * Centripetal, because the uniform kind loops and cusps when two waypoints
 * fall close together, and a random route will do that sooner or later.
 */
function spline(points: readonly Point[], perSegment = 28): Point[] {
  const out: Point[] = [points[0]!];
  const n = points.length;
  const at = (i: number): Point => {
    if (i < 0) return mirrored(points[0]!, points[1]!);
    if (i >= n) return mirrored(points[n - 1]!, points[n - 2]!);
    return points[i]!;
  };
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    for (let s = 1; s <= perSegment; s++) {
      const t = t1 + ((t2 - t1) * s) / perSegment;
      out.push(barryGoldman(p0, p1, p2, p3, t0, t1, t2, t3, t));
    }
  }
  return out;
}

const mirrored = (a: Point, b: Point): Point => [
  2 * a[0] - b[0],
  2 * a[1] - b[1],
];
const knot = (a: Point, b: Point) =>
  Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5, 1e-3);

function barryGoldman(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t0: number,
  t1: number,
  t2: number,
  t3: number,
  t: number,
): Point {
  const l = (a: Point, b: Point, ta: number, tb: number): Point => {
    const k = tb === ta ? 0 : (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  const a1 = l(p0, p1, t0, t1);
  const a2 = l(p1, p2, t1, t2);
  const a3 = l(p2, p3, t2, t3);
  const b1 = l(a1, a2, t0, t2);
  const b2 = l(a2, a3, t1, t3);
  return l(b1, b2, t1, t2);
}

// ---------------------------------------------------------------------------
// The wings
// ---------------------------------------------------------------------------

interface WingPose {
  wingAngle: number;
  wingSpread: number;
  wingCurl: number;
  wingTurn: number;
}

/**
 * One wingbeat. `phase` 0 is the top of the stroke. The downstroke takes 55
 * percent: it does the work. Through the middle of each stroke the wing
 * turns edge on, so its leading edge stays in front both ways, and on the
 * way up it half folds, the way a bird's hand does.
 */
export function wingbeat(phase: number, power = 1): WingPose {
  const ph = ((phase % 1) + 1) % 1;
  const top = -74 * power;
  const bottom = 60 * power;
  const down = 0.55;
  const floor = 0.22;
  const edge = (v: number) =>
    Math.abs(v) < floor ? (v < 0 ? -floor : floor) : v;
  if (ph < down) {
    const u = ph / down;
    return {
      wingAngle: top + (bottom - top) * easeInOut(u),
      wingSpread: 1,
      wingCurl: -0.4 * Math.sin(Math.PI * u),
      wingTurn: edge(Math.cos(Math.PI * u)),
    };
  }
  const u = (ph - down) / (1 - down);
  return {
    wingAngle: bottom + (top - bottom) * easeInOut(u),
    wingSpread: 1 - 0.4 * Math.sin(Math.PI * u),
    wingCurl: 0.5 * Math.sin(Math.PI * u),
    wingTurn: edge(-Math.cos(Math.PI * u)),
  };
}

/** Wings held out, a little above level, lifting and falling on the air. */
const glide = (t: number, dihedral: number): WingPose => ({
  wingAngle: dihedral + 3.5 * Math.sin(t / 310) + 1.5 * Math.sin(t / 97),
  wingSpread: 1,
  wingCurl: 0.12,
  wingTurn: 1,
});

const mixWing = (a: WingPose, b: WingPose, t: number): WingPose => ({
  wingAngle: a.wingAngle + (b.wingAngle - a.wingAngle) * t,
  wingSpread: a.wingSpread + (b.wingSpread - a.wingSpread) * t,
  wingCurl: a.wingCurl + (b.wingCurl - a.wingCurl) * t,
  wingTurn: a.wingTurn + (b.wingTurn - a.wingTurn) * t,
});

interface Burst {
  start: number;
  end: number;
  hz: number;
  power: number;
}

/**
 * When the wings beat and when they glide, from the end of the launch to
 * the flare. Bursts of three to six beats; glides between them, cut short
 * where the route climbs, because a climbing bird cannot coast.
 */
function wingSchedule(
  rng: Rng,
  from: number,
  to: number,
  climbing: (t: number) => number,
  offThePerch: boolean,
): Burst[] {
  const bursts: Burst[] = [];
  let t = from;
  // The push off the perch: two strong, quick beats, from the top.
  const firstHz = between(rng, 6.6, 7.4);
  const first = offThePerch ? 2 : count(rng, 2, 4);
  bursts.push({
    start: t,
    end: t + (first / firstHz) * 1000,
    hz: firstHz,
    power: offThePerch ? 1.08 : 1,
  });
  t = bursts[0]!.end;
  while (t < to) {
    const climb = climbing(t);
    const glideFor =
      climb > 0.25
        ? between(rng, 80, 220)
        : between(rng, 340, 1100) * (1 - climb);
    t += glideFor;
    if (t >= to) break;
    const hz = between(rng, 5.2, 6.6);
    const beats = count(rng, 3, 6) + (climb > 0.25 ? 2 : 0);
    const end = Math.min(t + (beats / hz) * 1000, to);
    bursts.push({ start: t, end, hz, power: between(rng, 0.85, 1.02) });
    t = end;
  }
  return bursts;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

interface Track {
  points: Point[];
  /** Arc length at each point, px. */
  length: number[];
  /** Time at each point, ms from departure. */
  time: number[];
}

/** Walk the route at a speed that breathes with the climb, and time it. */
function timeRoute(
  points: Point[],
  cruise: number,
  lands: boolean,
  pushesOff: boolean,
): Track {
  const length = [0];
  for (let i = 1; i < points.length; i++) {
    length.push(
      length[i - 1]! +
        Math.hypot(
          points[i]![0] - points[i - 1]![0],
          points[i]![1] - points[i - 1]![1],
        ),
    );
  }
  const total = length[length.length - 1]!;
  const time = [0];
  for (let i = 1; i < points.length; i++) {
    const ds = length[i]! - length[i - 1]!;
    const dy = points[i]![1] - points[i - 1]![1];
    const slope = ds > 0 ? dy / ds : 0;
    // Up is negative y: slower climbing, faster diving.
    let v = cruise * (1 + (slope > 0 ? 0.28 : 0.22) * slope);
    // Slower through a tight curve, the way a bird banks round one.
    v *= Math.max(0.45, 1 - curvature(points, i) * 60);
    const s = length[i]!;
    if (pushesOff) v *= 0.3 + 0.7 * easeOut(Math.min(s / 170, 1));
    if (lands) {
      const toGo = total - s;
      v *= 0.2 + 0.8 * easeIn(Math.min(toGo / 170, 1));
    }
    time.push(time[i - 1]! + (ds / Math.max(v, 1)) * 1000);
  }
  return { points, length, time };
}

/**
 * How sharply the route bends at point `i`, in radians per px, measured over
 * a few points either side so the sampling does not show through.
 */
function curvature(points: readonly Point[], i: number): number {
  const a = points[Math.max(i - 3, 0)]!;
  const b = points[i]!;
  const c = points[Math.min(i + 3, points.length - 1)]!;
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const vx = c[0] - b[0];
  const vy = c[1] - b[1];
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu < 1e-6 || lv < 1e-6) return 0;
  const cos = Math.min(1, Math.max(-1, (ux * vx + uy * vy) / (lu * lv)));
  return Math.acos(cos) / ((lu + lv) / 2);
}

/** Where along the track the bird is at `t` ms from departure. */
function locate(
  track: Track,
  t: number,
): { point: Point; index: number; s: number } {
  const { time, points, length } = track;
  if (t <= 0) return { point: points[0]!, index: 0, s: 0 };
  const last = time.length - 1;
  if (t >= time[last]!)
    return { point: points[last]!, index: last, s: length[last]! };
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid]! <= t) lo = mid;
    else hi = mid;
  }
  const k = (t - time[lo]!) / (time[hi]! - time[lo]!);
  const a = points[lo]!;
  const b = points[hi]!;
  return {
    point: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k],
    index: lo,
    s: length[lo]! + (length[hi]! - length[lo]!) * k,
  };
}

/** The point `s` px along the track. */
function pointAt(track: Track, s: number): Point {
  const { length, points } = track;
  const last = length.length - 1;
  if (s <= 0) return points[0]!;
  if (s >= length[last]!) return points[last]!;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (length[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const k = (s - length[lo]!) / (length[hi]! - length[lo]!);
  const a = points[lo]!;
  const b = points[hi]!;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/** The direction of travel around `s`, smoothed over a short stretch. */
function heading(track: Track, s: number, reach = 22): Point {
  const a = pointAt(track, s - reach);
  const b = pointAt(track, s + reach);
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
}

interface Turn {
  at: number;
  to: 1 | -1;
}

/**
 * When the bird turns round: whenever the route has gone back on the way
 * the bird faces for a while, not at every wobble. `+1` faces right.
 */
function turns(track: Track, initial: 1 | -1, until: number): Turn[] {
  const out: Turn[] = [];
  let facing = initial;
  let lastTurn = -Infinity;
  for (let t = 0; t < until; t += 16) {
    const { s } = locate(track, t);
    // Look a little ahead, so the turn is under way as the route bends and
    // the bird is not caught flying backwards before it turns.
    const [hx] = heading(track, s + 45, 30);
    if (hx * facing < -0.2 && t - lastTurn > TURN_MS * 2) {
      facing = facing === 1 ? -1 : 1;
      out.push({ at: t, to: facing });
      lastTurn = t;
    }
  }
  return out;
}

/**
 * Which way the bird faces at `t`, as the rig's two facings. On screen, +1
 * faces right. The rig's own body faces left, so facing right is its mirror:
 * the body's facing is minus the screen's and the head's is the screen's.
 */
function facingAt(
  initial: 1 | -1,
  list: readonly Turn[],
  t: number,
): { body: number; head: number; lean: number } {
  let current: number = initial;
  for (const turn of list) {
    if (t < turn.at) break;
    const u = (t - turn.at) / TURN_MS;
    if (u < 1) {
      // `lean` runs smoothly through zero; the facings never quite reach it:
      // a bird seen side on narrows, it does not vanish.
      const lean = current + (turn.to - current) * easeInOut(u);
      let f = lean;
      if (Math.abs(f) < 0.2)
        f = u < 0.5 ? 0.2 * Math.sign(current) : 0.2 * turn.to;
      return { body: -f, head: f, lean };
    }
    current = turn.to;
  }
  return { body: -current, head: current, lean: current };
}

/** A facing on its way through zero, but never quite at it: its own sign. */
const notFlat = (v: number) =>
  Math.abs(v) < 0.2 ? 0.2 * (Math.sign(v) || 1) : v;

/** Plan one flight. */
export function planFlight(req: FlightRequest): FlightPlan {
  const { rng, viewport, perch } = req;
  const box = flightBox(viewport);
  const size = flightSize(viewport);
  const lands = perch !== null;
  const airborne = req.airborne ?? null;

  // The perch's bird sits in the logo pose, so its body's middle is the
  // logo's, at the perch's scale.
  const home = bodyCentre(HOME_POSE);
  const perchCentre: Point | null = perch
    ? [
        perch.left + (home[0] / 100) * perch.size,
        perch.top + (home[1] / 100) * perch.size,
      ]
    : null;
  const perchSize = perch?.size ?? size;

  const wp =
    airborne && perchCentre
      ? homeWaypoints(req, [airborne.x, airborne.y], perchCentre, box)
      : waypoints(req, perchCentre ?? [box.left, box.top], box);
  const raw = spline(wp);
  // Keep the route in the room, except where it has to reach the perch, and
  // except a flypast's way in and out, which is off screen on purpose.
  const points = raw.map((p): Point => {
    if (
      perchCentre &&
      Math.hypot(p[0] - perchCentre[0], p[1] - perchCentre[1]) < 110
    ) {
      return [
        Math.min(Math.max(p[0], 4), viewport.width - 4),
        Math.min(Math.max(p[1], 4), viewport.height - 4),
      ];
    }
    if (!perchCentre)
      return [p[0], Math.min(Math.max(p[1], box.top), box.bottom)];
    return clampTo(box, p);
  });
  // Where the spline ran along a wall, clamping leaves a corner. A few
  // passes of a small average round it off, ends held where they are.
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const c = points[i + 1]!;
      points[i] = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4];
    }
  }

  const cruise =
    between(rng, 600, 780) *
    Math.min(Math.max(viewport.width / 1440, 0.72), 1.1);
  const track = timeRoute(points, cruise, lands, airborne === null);
  const routeMs = track.time[track.time.length - 1]!;

  // Departure and arrival, in plan time.
  const launches = lands && !airborne;
  const depart = launches ? DEPART_MS : 0;
  const arrive = depart + routeMs;
  const duration = lands ? arrive + SETTLE_MS : arrive;

  // Facing: off the perch the body turns to face the launch. In the air it
  // keeps the facing it had.
  const launchDir: 1 | -1 = airborne
    ? airborne.facing
    : heading(track, 40, 40)[0] >= 0
      ? 1
      : -1;
  const turnList = turns(track, launchDir, routeMs - (lands ? FLARE_MS : 0));

  // Wings, from the end of the launch to the flare.
  const cruiseFrom = launches ? LAUNCH_MS : 0;
  const cruiseTo = lands ? arrive - FLARE_MS : duration;
  const climbing = (t: number) => {
    const { s } = locate(track, t - depart);
    return Math.max(0, -heading(track, s, 40)[1]);
  };
  const bursts = wingSchedule(rng, cruiseFrom, cruiseTo, climbing, launches);
  const dihedral = -between(rng, 10, 22);

  // A barrel roll, somewhere in the middle.
  const rollChance =
    req.kind === "swoop" ? 0.45 : req.kind === "loop" && !airborne ? 0.18 : 0;
  let rollAt = -Infinity;
  if (chance(rng, rollChance) && cruiseTo - cruiseFrom > ROLL_MS * 3) {
    rollAt = between(
      rng,
      cruiseFrom + (cruiseTo - cruiseFrom) * 0.3,
      cruiseFrom + (cruiseTo - cruiseFrom) * 0.6,
    );
  }
  // Nearer and farther, slowly.
  const depthPeriod = between(rng, 2600, 4200);
  const depthPhase = between(rng, 0, Math.PI * 2);

  /** The wings at `t`, and how far the stroke lifts the body. */
  const wingAt = (t: number): { wing: WingPose; lift: number } => {
    const held = glide(t, dihedral);
    if (t >= rollAt && t <= rollAt + ROLL_MS) return { wing: held, lift: 0 };
    for (const burst of bursts) {
      if (t < burst.start - 140) break;
      if (t > burst.end + 160) continue;
      const phase = (Math.max(t - burst.start, 0) * burst.hz) / 1000;
      const into = (t - (burst.start - 140)) / 140;
      const outOf = (burst.end + 160 - t) / 160;
      const beating = Math.min(1, Math.max(0, Math.min(into, outOf)));
      // The body rises on the downstroke and sinks on the way up.
      const lift = Math.sin(2 * Math.PI * (phase - 0.08)) * beating;
      return {
        wing: mixWing(held, wingbeat(phase, burst.power), beating),
        lift,
      };
    }
    return { wing: held, lift: 0 };
  };

  // Which way it faces as it reaches the perch, so touchdown can turn it
  // back into the logo whichever way it came in.
  const arrival = facingAt(
    launchDir,
    turnList,
    Math.max(routeMs - FLARE_MS, 0),
  );

  const frame = (t: number): FlightFrame => {
    const clampT = Math.min(Math.max(t, 0), duration);
    const pathT = clampT - depart;
    const { point, s } = locate(track, pathT);
    let [x, y] = point;
    const [hx, hy] = heading(track, s + 12, 26);
    const facing = facingAt(launchDir, turnList, Math.max(pathT, 0));
    let { wing, lift } = wingAt(clampT);
    let pose: CorvidPose = {
      ...HOME_POSE,
      nape: 1,
      flight: 1,
      bodyFacing: facing.body,
      headFacing: facing.head,
    };

    // Pitch with the climb, nose up when the route rises, whichever way the
    // bird faces. Facing right is the rig's mirror, so the same climb turns
    // the other way, and through a turn the pitch leans smoothly through
    // level instead of flipping.
    const climb = (Math.atan2(hy, Math.abs(hx)) * 180) / Math.PI;
    let rotate = Math.max(-50, Math.min(50, climb)) * facing.lean;
    y -= 1.8 * lift;

    // Nearer and farther.
    const cruising = lands
      ? Math.min(
          1,
          Math.max(0, (clampT - cruiseFrom) / 500),
          Math.max(0, (arrive - FLARE_MS - clampT) / 500),
        )
      : 1;
    let currentSize =
      size *
      (1 +
        0.1 *
          Math.sin((2 * Math.PI * clampT) / depthPeriod + depthPhase) *
          cruising);

    if (launches && clampT < LAUNCH_MS) {
      // Off the perch. The logo's body faces left and its head looks back
      // right, so a launch to the right is the body turning under a head
      // that holds still, and a launch to the left is the head turning.
      const k = clampT;
      // Down onto the feet, turn about in the ring with a little hop, and go.
      const crouch =
        k < 120
          ? 0.9 * easeOut(k / 120)
          : k < 250
            ? 0.9 - 1.1 * easeInOut((k - 120) / 130)
            : -0.2 * (1 - easeOut((k - 250) / 180));
      const rise = easeInOut((k - 210) / 260);
      const turnU = easeInOut((k - 100) / 110);
      const headU = easeInOut((k - 90) / 100);
      pose = {
        ...pose,
        flight: rise,
        crouch,
        nape: easeInOut((k - 150) / 180),
        bodyFacing: launchDir > 0 ? notFlat(1 - 2 * turnU) : 1,
        headFacing: launchDir > 0 ? 1 : notFlat(1 - 2 * headU),
        headAngle: 8 * easeOut(k / 140) * (1 - rise),
      };
      const open = easeInOut((k - 180) / 240);
      const folded: WingPose = {
        wingAngle: -6 * easeOut(k / 140),
        wingSpread: 0,
        wingCurl: 0,
        wingTurn: 1,
      };
      const raised: WingPose = {
        wingAngle: -74,
        wingSpread: 1,
        wingCurl: 0,
        wingTurn: 1,
      };
      wing = mixWing(folded, raised, open);
      lift = 0;
      rotate *= rise;
      // The hop of the turn, at the perch's scale.
      const hop = Math.sin(Math.PI * Math.min(Math.max((k - 100) / 130, 0), 1));
      y = point[1] - hop * 0.07 * perchSize * (1 - rise);
    }

    if (lands && clampT > arrive - FLARE_MS) {
      // Coming home: flare, touch down, fold, look back, settle.
      const k = clampT - (arrive - FLARE_MS);
      const after = Math.max(0, k - FLARE_MS);
      const flare = easeInOut(k / 220);
      const brake = wingbeat(0.1 + (k / 1000) * 8, 0.75);
      const braking: WingPose = {
        ...brake,
        wingAngle: brake.wingAngle - 18,
        wingSpread: 1,
      };
      const folded: WingPose = {
        wingAngle: 0,
        wingSpread: 0,
        wingCurl: 0,
        wingTurn: 1,
      };
      wing = mixWing(
        mixWing(wing, braking, flare),
        folded,
        easeInOut(after / 260),
      );
      const nose = 22 * flare * (1 - easeInOut(after / 120));
      rotate = rotate * (1 - flare) + (arrival.head > 0 ? -nose : nose);
      pose.flight = 1 - easeInOut((k - FLARE_MS + 200) / 260);
      pose.crouch =
        after > 0 ? 0.6 * Math.sin(Math.PI * Math.min(after / 300, 1)) : 0;
      if (after > 0) {
        // Back into the logo: the body faces left, and the head looks back
        // over it to the right. Whichever of the two is the wrong way turns.
        const bodyU = easeInOut((after - 40) / 120);
        const headU = easeInOut((after - 200) / 110);
        pose.bodyFacing = arrival.body > 0 ? 1 : notFlat(-1 + 2 * bodyU);
        pose.headFacing = arrival.head > 0 ? 1 : notFlat(-1 + 2 * headU);
        x = perchCentre![0];
        y = perchCentre![1];
      }
      pose.nape = 1 - easeInOut((after - 170) / 260);
      lift *= 1 - flare;
      if (after === 0) y -= 1.8 * lift;
    }

    // Nearer as it leaves the ring, back to the ring's size as it lands,
    // each over more than half a second, so the change reads as distance.
    if (launches) {
      const grow = easeInOut((clampT - GROW_FROM) / (GROW_TO - GROW_FROM));
      currentSize = perchSize + (currentSize - perchSize) * grow;
    }
    if (lands) {
      const from = arrive - FLARE_MS - SHRINK_LEAD;
      const shrink = easeInOut((clampT - from) / (FLARE_MS + SHRINK_LEAD - 60));
      currentSize = currentSize + (perchSize - currentSize) * shrink;
    }

    // The roll: upside down and back, the wings held out.
    let roll =
      clampT >= rollAt && clampT <= rollAt + ROLL_MS
        ? Math.cos((2 * Math.PI * (clampT - rollAt)) / ROLL_MS)
        : 1;

    // The way home eases out of the frame the bird was in when it was asked.
    const from = airborne?.from;
    if (from && clampT < HOMEWARD_BLEND_MS) {
      const k = easeInOut(clampT / HOMEWARD_BLEND_MS);
      x = from.x + (x - from.x) * k;
      y = from.y + (y - from.y) * k;
      currentSize = from.size + (currentSize - from.size) * k;
      rotate = from.rotate + (rotate - from.rotate) * k;
      roll = from.roll + (roll - from.roll) * k;
      wing = mixWing(
        {
          wingAngle: from.pose.wingAngle,
          wingSpread: from.pose.wingSpread,
          wingCurl: from.pose.wingCurl,
          wingTurn: from.pose.wingTurn,
        },
        wing,
        k,
      );
    }

    return {
      x,
      y,
      size: currentSize,
      rotate,
      roll,
      pose: { ...pose, ...wing },
    };
  };

  const interruptible = (t: number) =>
    lands && t >= (launches ? LAUNCH_MS : 0) && t <= arrive - FLARE_MS;

  const route = points
    .map(
      ([px, py], i) =>
        `${i === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`,
    )
    .join(" ");
  return { kind: req.kind, duration, lands, route, frame, interruptible };
}

/**
 * The way home from wherever the bird is: the second click on the perch.
 * Round to the ring's open side and in.
 */
function homeWaypoints(
  req: FlightRequest,
  from: Point,
  perch: Point,
  box: FlightBox,
): Point[] {
  const side = perch[0] < box.left + (box.right - box.left) / 2 ? 1 : -1;
  const approach: Point = [
    perch[0] + side * between(req.rng, 150, 200),
    Math.max(perch[1] + between(req.rng, 20, 40), box.top),
  ];
  const middle = clampTo(box, [
    (from[0] + approach[0]) / 2,
    Math.min(from[1], approach[1]) - between(req.rng, 20, 60),
  ]);
  return relax([from, middle, approach, perch]);
}
