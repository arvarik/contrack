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
import { HOME_POSE, bodyCentre, type CorvidPose } from "../assets/corvidRig.ts";
import {
  between,
  chance,
  count,
  easeIn,
  easeInOut,
  easeOut,
  pickWeighted,
  sign,
  type Rng,
} from "./corvidMotion.ts";

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

/** A rectangle in viewport px. */
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
 * stretching its wings by itself: short, near the perch, and home. `search`
 * is the bird hunting for an answer: a long, calmer wander over the `area`
 * the page gives it, beside and above the column it must `avoid`, until it
 * is called home.
 */
export type FlightKind = "loop" | "swoop" | "sortie" | "search";

export interface FlightPerch {
  /** The perch's mark: its top left corner and its size, in px. */
  left: number;
  top: number;
  size: number;
}

interface FlightRequest {
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
  /**
   * A `search` flight's hunting ground, in px. It is kept inside the room.
   * Without `avoid`, the bird hunts over all of it. With `avoid`, it is the
   * page the bird may cross, and the bird hunts in the part of it that
   * `avoid` leaves free. Other kinds ignore it.
   */
  area?: FlightBox;
  /**
   * The column the bird must keep out of, in px: the search box and the
   * results under it, down to the bottom of the page. A `search` flight
   * hunts beside it and above it, never over it, and so does the way home
   * from one. Only the takeoff from the search box and the landing back in
   * it cross its edge.
   */
  avoid?: FlightBox;
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
function waypoints(
  req: FlightRequest,
  start: Point,
  box: FlightBox,
  ground: SearchGround | null,
): Point[] {
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

  // A search with a column to keep out of has a route of its own.
  if (kind === "search" && ground) return searchRoute(req, ground, start);

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
  if (kind === "search") {
    middle = huntingRoute(req, box, launch, approach);
  } else if (kind === "sortie") {
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

/**
 * How long a search flight hunts before it lands by itself, in ms. Twice
 * the server's 12 second budget for a model answer, so the bird is still
 * out when the slowest answer arrives.
 */
export const SEARCH_HUNT_MS = 26_000;
/** A hunting bird's speed, against a lap's: slower, looking about. */
const SEARCH_PACE = 0.62;
/**
 * A bird called home round the column, against a lap's: faster. The way
 * round is longer than the way across, and the answer is already on screen.
 */
const HOMEWARD_PACE = 1.3;
/**
 * The most a hunting bird turns from one waypoint to the next, in degrees.
 * With waypoints {@link huntingRoute} spaces 40 to 75 px apart, its
 * tightest circle is about one and a half spacings across.
 */
const HUNT_TURN = 40;
/**
 * A hunting bird's average speed, against its cruise. It is always turning,
 * and `timeRoute` slows it through each turn. Measured over three hundred
 * seeds on a laptop, a small window and a phone.
 */
const HUNT_SLOWING = 0.42;
/** The most waypoints one hunt draws, however small its steps. */
const HUNT_POINTS = 900;

/** How a hunting bird steps and turns over one piece of ground. */
interface HuntStride {
  /** Px from one waypoint to the next. */
  spacing: number;
  /** The most it turns from one waypoint to the next, in radians. */
  maxTurn: number;
  /** The circle its tightest turns draw, as a radius in px. */
  radius: number;
  /** How far in from the ground's edges its body's middle keeps, in px. */
  edge: number;
}

/** A hunting bird, part way along its route. */
interface Hunter {
  at: Point;
  heading: number;
  turn: number;
  points: Point[];
  /**
   * How much of the hunt the route has used: px, or ms when `pace` is set.
   */
  flown: number;
  /**
   * The bird's straight-line speed, in px per ms. When set, each step
   * counts the time `timeRoute` will give it, slowed through its turn, so a
   * hunt of tight turns in a thin band lasts as long as a wide one.
   */
  pace?: number;
}

/** Count one step against the hunt. */
function spend(
  hunter: Hunter,
  step: number,
  turn: number,
  scale = HUNT_TIME_SCALE,
): void {
  if (!hunter.pace) {
    hunter.flown += step;
    return;
  }
  // `timeRoute` slows the bird through a curve, the same way.
  const bend = step > 0 ? Math.abs(turn) / step : 0;
  hunter.flown +=
    (scale * step) / (hunter.pace * Math.max(0.45, 1 - bend * 60));
}

/**
 * The time `timeRoute` gives a hunt, against the time its steps alone say:
 * the spline bends between the steps as well, and the bird slows on each
 * climb. Measured over forty seeds on a laptop, a small window, a tablet
 * and a phone: the same within a few percent on all four.
 */
const HUNT_TIME_SCALE = 1.4;

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** The stride for a ground: the usual one, or tighter where it is narrow. */
function strideFor(ground: FlightBox): HuntStride {
  const width = ground.right - ground.left;
  const height = ground.bottom - ground.top;
  const narrow = Math.min(width, height);
  const maxTurn = (HUNT_TURN * Math.PI) / 180;
  const chord = 2 * Math.sin(maxTurn / 2);
  const reach = Math.min(Math.hypot(width, height), 2 * narrow);
  let spacing = Math.min(Math.max(reach * 0.07, 40), 75);
  let radius = spacing / chord;
  const edge = Math.min(20, narrow / 8);
  // A ground too narrow to turn round in at the usual stride gets tighter
  // turns, never a wider ground: the space round a search is all there is.
  const fits = (narrow - 2 * edge) / 2.4;
  if (radius > fits) {
    radius = Math.max(fits, HUNT_MIN_RADIUS);
    spacing = radius * chord;
  }
  return { spacing, maxTurn, radius, edge };
}

/**
 * Wander over a ground until the route has used `until` of the hunt's
 * length, the way a bird hunts:
 *
 * 1. Its turn drifts from step to step, so it curves one way for a while,
 *    then the other, and now and then closes a circle.
 * 2. When the ground's edge is close ahead, it turns for the middle as hard
 *    as it may, and so never meets the edge.
 *
 * No step turns more than the stride allows, well under `relax`'s limit,
 * so `relax` leaves the route alone and the spline never cusps. Small
 * steps drift less per step, so a tight stride curves no more per px than
 * the usual one.
 */
function wander(
  hunter: Hunter,
  ground: FlightBox,
  stride: HuntStride,
  until: number,
  rng: Rng,
  lengthwise = false,
): void {
  const { spacing, maxTurn, radius } = stride;
  const width = ground.right - ground.left;
  const height = ground.bottom - ground.top;
  const edge = Math.min(stride.edge, width / 4, height / 4);
  // Where the bird turns for when the edge is close: the ground's middle,
  // or, `lengthwise`, the nearest point of its long middle line. A bird in
  // a thin band that turned for the band's one middle point would circle
  // it for ever. Turning for the line, it flies the band's length.
  const half = lengthwise ? Math.min(width, height) / 2 : Infinity;
  const middleOf = ([x, y]: Point): Point => [
    Math.min(
      Math.max(x, ground.left + Math.min(half, width / 2)),
      ground.right - Math.min(half, width / 2),
    ),
    Math.min(
      Math.max(y, ground.top + Math.min(half, height / 2)),
      ground.bottom - Math.min(half, height / 2),
    ),
  ];
  const onGround = ([x, y]: Point) =>
    x >= ground.left + edge &&
    x <= ground.right - edge &&
    y >= ground.top + edge &&
    y <= ground.bottom - edge;
  const toGround = ([x, y]: Point): Point => [
    Math.min(Math.max(x, ground.left + edge), ground.right - edge),
    Math.min(Math.max(y, ground.top + edge), ground.bottom - edge),
  ];
  // How far ahead the bird looks for the edge: room for a half circle.
  const ahead = 1.4 * radius + spacing;
  const drift = Math.min(1, spacing / 40);
  while (hunter.flown < until && hunter.points.length < HUNT_POINTS) {
    const look: Point = [
      hunter.at[0] + Math.cos(hunter.heading) * ahead,
      hunter.at[1] + Math.sin(hunter.heading) * ahead,
    ];
    if (onGround(look)) {
      hunter.turn = Math.min(
        Math.max(
          hunter.turn * 0.7 + between(rng, -0.6, 0.6) * maxTurn * drift,
          -maxTurn,
        ),
        maxTurn,
      );
    } else {
      const middle = middleOf(hunter.at);
      const toMiddle = wrap(
        Math.atan2(middle[1] - hunter.at[1], middle[0] - hunter.at[0]) -
          hunter.heading,
      );
      hunter.turn = (toMiddle < 0 ? -1 : 1) * maxTurn;
    }
    hunter.heading = wrap(hunter.heading + hunter.turn);
    hunter.at = toGround([
      hunter.at[0] + Math.cos(hunter.heading) * spacing,
      hunter.at[1] + Math.sin(hunter.heading) * spacing,
    ]);
    hunter.points.push(hunter.at);
    spend(hunter, spacing, hunter.turn);
  }
}

/**
 * Fly on to a point, turning toward it no harder than the stride allows,
 * and land on it exactly once it is ahead and within a step. `free` keeps
 * each step in the space the bird may cross.
 */
function flyTo(
  hunter: Hunter,
  target: Point,
  stride: HuntStride,
  free: (point: Point) => Point,
): void {
  const { spacing, maxTurn } = stride;
  const start = Math.hypot(target[0] - hunter.at[0], target[1] - hunter.at[1]);
  // A target inside the tightest circle can be circled for ever. Give up
  // after the steps a long way round would take, and go straight on.
  let steps = Math.ceil((start + 4 * stride.radius) / spacing) + 12;
  while (steps-- > 0 && hunter.points.length < HUNT_POINTS) {
    const dx = target[0] - hunter.at[0];
    const dy = target[1] - hunter.at[1];
    const distance = Math.hypot(dx, dy);
    if (distance < 0.5) break;
    const want = wrap(Math.atan2(dy, dx) - hunter.heading);
    hunter.turn = Math.min(Math.max(want, -maxTurn), maxTurn);
    hunter.heading = wrap(hunter.heading + hunter.turn);
    const reaches = Math.abs(want) <= maxTurn && distance <= spacing;
    const step = reaches ? distance : spacing;
    hunter.at = reaches
      ? target
      : free([
          hunter.at[0] + Math.cos(hunter.heading) * step,
          hunter.at[1] + Math.sin(hunter.heading) * step,
        ]);
    hunter.points.push(hunter.at);
    spend(hunter, step, hunter.turn);
    if (reaches) break;
  }
}

/**
 * Patrol a band too thin to circle in smoothly, such as the band over the
 * search box on a tablet: about 40 px tall. Circling there needs steps of
 * a few px and a turn that flips nearly every step, which draws a jittery
 * sawtooth, not a bird. A patrol instead:
 *
 * 1. Flies along the band in long steps, 50 to 90 px, each to a random
 *    height inside it, and never climbing or falling more than a gentle
 *    slope, so the bird rises and falls as it goes.
 * 2. Turns round at each end in a narrow hairpin: out a little past its
 *    last step, and back at the other half of the band's height. `relax`
 *    and the spline round the hairpin off, and the rig turns the bird round.
 * 3. Now and then turns round before the end, so no two patrols match.
 * 4. At the end of the hunt, turns round once more if it is flying away
 *    from `homeX`, so the way home is ahead of it.
 *
 * The band is horizontal: only the band over the column is ever this thin
 * and hunted in.
 */
function patrol(
  hunter: Hunter,
  band: FlightBox,
  until: number,
  rng: Rng,
  homeX: number,
): void {
  const height = band.bottom - band.top;
  const inset = Math.min(Math.max(height * 0.2, 4), 18);
  const low = band.top + inset;
  const high = band.bottom - inset;
  const middle = (band.top + band.bottom) / 2;
  const endInset = Math.min(24, (band.right - band.left) / 6);
  const west = band.left + endInset;
  const east = band.right - endInset;
  let dir: 1 | -1 = east - hunter.at[0] >= hunter.at[0] - west ? 1 : -1;
  let sinceTurn = 0;

  const go = (point: Point) => {
    const [dx, dy] = [point[0] - hunter.at[0], point[1] - hunter.at[1]];
    const step = Math.hypot(dx, dy);
    if (step < 1) return;
    const heading = Math.atan2(dy, dx);
    hunter.turn = hunter.points.length ? wrap(heading - hunter.heading) : 0;
    hunter.heading = heading;
    hunter.at = point;
    hunter.points.push(point);
    spend(hunter, step, hunter.turn, PATROL_TIME_SCALE);
  };
  /** A height for a step this long: random, and at a gentle slope. */
  const heightFor = (step: number) =>
    Math.min(
      Math.max(between(rng, low, high), hunter.at[1] - PATROL_SLOPE * step),
      hunter.at[1] + PATROL_SLOPE * step,
    );
  const hairpin = () => {
    const [x, y] = hunter.at;
    const back =
      y < middle ? between(rng, middle, high) : between(rng, low, middle);
    const tipX = x + dir * between(rng, 8, 16);
    go([Math.min(Math.max(tipX, band.left), band.right), (y + back) / 2]);
    go([x - dir * between(rng, 30, 50), back]);
    dir = dir === 1 ? -1 : 1;
    sinceTurn = 0;
  };

  while (hunter.flown < until && hunter.points.length < HUNT_POINTS) {
    const step = between(rng, 50, 90);
    const x = hunter.at[0] + dir * step;
    const early = sinceTurn >= 2 && chance(rng, PATROL_EARLY_TURN);
    const pastEnd = dir > 0 ? x >= east : x <= west;
    if (early || pastEnd) {
      if (pastEnd) {
        const end = dir > 0 ? east : west;
        go([end, heightFor(Math.abs(end - hunter.at[0]))]);
      }
      hairpin();
      continue;
    }
    go([x, heightFor(step)]);
    sinceTurn += 1;
  }
  if (dir * (homeX - hunter.at[0]) < 0 && Math.abs(homeX - hunter.at[0]) > 40)
    hairpin();
}

/**
 * A search flight's middle, with no column to keep out of: a wander over
 * the area the page gives it.
 *
 * 1. The ground is the area, kept inside the room, and grown to room for a
 *    full turn when it is smaller than that.
 * 2. The bird enters it at a random spot, then wanders (`wander`).
 * 3. It stops once the route is about {@link SEARCH_HUNT_MS} long at the
 *    hunting speed. An answer calls it home long before that.
 * 4. It comes round for home by the same turns, never on the spot.
 */
function huntingRoute(
  req: FlightRequest,
  box: FlightBox,
  start: Point,
  end: Point,
): Point[] {
  const { rng, viewport } = req;
  const area = req.area ?? box;
  let left = Math.min(Math.max(area.left, box.left), box.right);
  let right = Math.max(Math.min(area.right, box.right), left);
  let top = Math.min(Math.max(area.top, box.top), box.bottom);
  let bottom = Math.max(Math.min(area.bottom, box.bottom), top);
  const maxTurn = (HUNT_TURN * Math.PI) / 180;
  const reach = Math.min(
    Math.hypot(right - left, bottom - top),
    2 * Math.min(right - left, bottom - top),
  );
  // The step, and the circle the tightest turns draw.
  const spacing = Math.min(Math.max(reach * 0.07, 40), 75);
  const radius = spacing / (2 * Math.sin(maxTurn / 2));
  // Keep the body's middle in from the edges of the ground.
  const inset = 20;
  // A ground too small to turn round in grows about its middle.
  const room = 2.4 * radius + 2 * inset;
  if (right - left < room) {
    const mid = (left + right) / 2;
    left = Math.max(box.left, mid - room / 2);
    right = Math.min(box.right, mid + room / 2);
  }
  if (bottom - top < room) {
    const mid = (top + bottom) / 2;
    top = Math.max(box.top, mid - room / 2);
    bottom = Math.min(box.bottom, mid + room / 2);
  }
  const ground = { left, top, right, bottom };
  const width = right - left;
  const height = bottom - top;
  const middle: Point = [left + width / 2, top + height / 2];
  const stride: HuntStride = { spacing, maxTurn, radius, edge: inset };

  const at: Point = [
    left + width * between(rng, 0.25, 0.75),
    top + height * between(rng, 0.25, 0.75),
  ];
  const hunter: Hunter = {
    at,
    heading: Math.atan2(at[1] - start[1], at[0] - start[0]),
    turn: 0,
    points: [at],
    flown: 0,
  };
  wander(hunter, ground, stride, huntLength(viewport), rng);
  // Round for home, a step at a time, on the side the middle is: a bird
  // by the edge that turned the other way would be pressed against it.
  const toMiddle = wrap(
    Math.atan2(middle[1] - hunter.at[1], middle[0] - hunter.at[0]) -
      hunter.heading,
  );
  const turn = (toMiddle < 0 ? -1 : 1) * maxTurn;
  const edge = Math.min(inset, width / 4, height / 4);
  for (let i = 0; i < 9; i++) {
    const home = wrap(
      Math.atan2(end[1] - hunter.at[1], end[0] - hunter.at[0]) - hunter.heading,
    );
    if (Math.abs(home) <= maxTurn) break;
    hunter.heading = wrap(hunter.heading + turn);
    hunter.at = [
      Math.min(
        Math.max(
          hunter.at[0] + Math.cos(hunter.heading) * spacing,
          left + edge,
        ),
        right - edge,
      ),
      Math.min(
        Math.max(hunter.at[1] + Math.sin(hunter.heading) * spacing, top + edge),
        bottom - edge,
      ),
    ];
    hunter.points.push(hunter.at);
  }
  return hunter.points;
}

/** How much faster a wide window's bird flies, and a narrow one's slower. */
const widthPace = (viewport: FlightViewport) =>
  Math.min(Math.max(viewport.width / 1440, 0.72), 1.1);

/** The route's length: the hunt's time at a hunting bird's usual speed. */
function huntLength(viewport: FlightViewport): number {
  const speed = (690 * SEARCH_PACE * HUNT_SLOWING * widthPace(viewport)) / 1000;
  return SEARCH_HUNT_MS * speed;
}

// ---------------------------------------------------------------------------
// The ground round a search
// ---------------------------------------------------------------------------

/**
 * How far the body's middle keeps from the column's sides, and from its
 * top, against the flying size. A wing at the top of its stroke reaches
 * about 0.72 of the size above the body's middle, 0.63 to either side and
 * 0.44 below it, so the body and the most of each stroke stay clear.
 */
const SIDE_CLEARANCE = 0.6;
const TOP_CLEARANCE = 0.45;
/** A little air between the bird and the column, in px. */
const CLEARANCE_GAP = 4;
/** The tightest circle a hunting bird turns, as a radius in px. */
const HUNT_MIN_RADIUS = 12;
/** The steepest a patrolling bird climbs or falls, as rise over run. */
const PATROL_SLOPE = 0.4;
/** How often a patrolling bird turns round before the band's end, per step. */
const PATROL_EARLY_TURN = 0.1;
/**
 * The time `timeRoute` gives a patrol, against the time its steps alone
 * say. A patrol's long steps bend less between them than a wander's.
 */
const PATROL_TIME_SCALE = 1.1;
/** A zone at least this deep both ways is hunted in when it can be reached. */
const ROOMY_ZONE = 110;
/** A top band this tall is hunted in when there is nowhere roomier. */
const BAND_ZONE = 36;
/** The thinnest zone a bird passes through, in px. */
const CORRIDOR = 20;
/** Without a band over the column, a side zone is reached straight from the perch within this many px. */
const SIDE_REACH = 100;
/** Points of a route this close to the perch are the takeoff or the landing. */
const PERCH_REACH = 110;

/** One piece of the space round the column. */
interface HuntZone {
  side: "left" | "right" | "top";
  /** Where the body's middle may be, in px. */
  rect: FlightBox;
  /** The bird hunts here. Otherwise it only passes through. */
  hunts: boolean;
}

/** The space round the Ask page's column, for a search flight. */
export interface SearchGround {
  /** Every place the body's middle may be, in px. */
  bounds: FlightBox;
  /** The column grown by the bird's clearance. No body's middle goes in. */
  keepOut: FlightBox;
  /** Left of the column, right of it, and the band over it. */
  zones: HuntZone[];
}

const areaOf = (box: FlightBox) =>
  Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);

/**
 * The space a search flight may hunt in: the page, less the column and the
 * bird's clearance round it, as up to three zones.
 *
 * 1. Left and right of the column, the full height of the page. A zone at
 *    least {@link ROOMY_ZONE} px deep both ways is hunted in.
 * 2. The band over the column, where the page's title is. It joins the two
 *    sides, so the bird crosses from one to the other over the top. It is
 *    hunted in only when neither side is roomy, as on a phone.
 * 3. With no band, the bird can only reach a side zone straight from the
 *    perch, so only one close to it is hunted in.
 *
 * The page's own edges keep the bird off the nav rail, and the room's keep
 * it off the phone's tab bar. When no zone is hunted in, the bird stays
 * home: `canHunt`.
 */
export function searchGround(
  viewport: FlightViewport,
  area: FlightBox,
  avoid: FlightBox,
  perch?: FlightPerch | null,
): SearchGround {
  const size = flightSize(viewport);
  const room = flightBox(viewport);
  const inset = size / 2;
  const [left, right] = span(
    Math.max(room.left, area.left + inset),
    Math.min(room.right, area.right - inset),
  );
  const [top, bottom] = span(
    Math.max(FLIGHT_EDGE, area.top + FLIGHT_EDGE),
    Math.min(room.bottom, area.bottom - FLIGHT_EDGE),
  );
  const bounds = { left, top, right, bottom };
  const sideGap = size * SIDE_CLEARANCE + CLEARANCE_GAP;
  const topGap = size * TOP_CLEARANCE + CLEARANCE_GAP;
  const keepOut = {
    left: avoid.left - sideGap,
    top: avoid.top - topGap,
    right: avoid.right + sideGap,
    bottom: avoid.bottom + topGap,
  };
  const candidates: [HuntZone["side"], FlightBox][] = [
    ["left", { left, top, right: Math.min(keepOut.left, right), bottom }],
    ["right", { left: Math.max(keepOut.right, left), top, right, bottom }],
    ["top", { left, top, right, bottom: Math.min(keepOut.top, bottom) }],
  ];
  const zones: HuntZone[] = candidates
    .filter(
      ([, rect]) =>
        rect.right - rect.left >= CORRIDOR &&
        rect.bottom - rect.top >= CORRIDOR,
    )
    .map(([side, rect]) => ({ side, rect, hunts: false }));
  const band = zones.find((zone) => zone.side === "top");
  const centre = perch ? perchPoint(perch) : null;
  const reachable = (zone: HuntZone) =>
    !!band ||
    !centre ||
    (zone.side === "left"
      ? centre[0] - zone.rect.right <= SIDE_REACH
      : zone.rect.left - centre[0] <= SIDE_REACH);
  for (const zone of zones) {
    const { rect } = zone;
    zone.hunts =
      zone.side !== "top" &&
      Math.min(rect.right - rect.left, rect.bottom - rect.top) >= ROOMY_ZONE &&
      reachable(zone);
  }
  if (band && !zones.some((zone) => zone.hunts)) {
    const height = band.rect.bottom - band.rect.top;
    band.hunts =
      height >= BAND_ZONE && band.rect.right - band.rect.left >= 3 * height;
  }
  return { bounds, keepOut, zones };
}

/** A zone too thin to circle in smoothly: the bird patrols it instead. */
const patrols = (zone: HuntZone) =>
  Math.min(zone.rect.right - zone.rect.left, zone.rect.bottom - zone.rect.top) <
  ROOMY_ZONE;

/** Whether a search flight has anywhere to hunt, or the bird stays home. */
export function canHunt(ground: SearchGround): boolean {
  return ground.zones.some((zone) => zone.hunts);
}

/** The middle of a perch's bird, where its flights start and end. */
function perchPoint(perch: FlightPerch): Point {
  const home = bodyCentre(HOME_POSE);
  return [
    perch.left + (home[0] / 100) * perch.size,
    perch.top + (home[1] / 100) * perch.size,
  ];
}

/** Whether a point is inside the column, clearance and all. */
const inKeepOut = (ground: SearchGround, [x, y]: Point) =>
  x > ground.keepOut.left &&
  x < ground.keepOut.right &&
  y > ground.keepOut.top &&
  y < ground.keepOut.bottom;

/**
 * The nearest point the body's middle may be: inside the bounds, and out of
 * the column by its nearest open side.
 */
function freePoint(ground: SearchGround, point: Point): Point {
  const { bounds, keepOut } = ground;
  const p = clampTo(bounds, point);
  if (!inKeepOut(ground, p)) return p;
  const ways: Point[] = [];
  if (keepOut.left > bounds.left) ways.push([keepOut.left, p[1]]);
  if (keepOut.right < bounds.right) ways.push([keepOut.right, p[1]]);
  if (keepOut.top > bounds.top) ways.push([p[0], keepOut.top]);
  if (keepOut.bottom < bounds.bottom) ways.push([p[0], keepOut.bottom]);
  let best = p;
  let bestDistance = Infinity;
  for (const way of ways) {
    const distance = Math.hypot(way[0] - p[0], way[1] - p[1]);
    if (distance < bestDistance) {
      best = way;
      bestDistance = distance;
    }
  }
  return best;
}

/** The band's middle height, or null when there is no band. */
function bandHeight(ground: SearchGround): number | null {
  const band = ground.zones.find((zone) => zone.side === "top");
  return band ? (band.rect.top + band.rect.bottom) / 2 : null;
}

/**
 * Where a side zone meets the band: in the band's middle, a tight turn's
 * width out from the column, so the bird rounds the column's corner in the
 * band and never across the column.
 */
function corner(ground: SearchGround, zone: HuntZone): Point {
  const band = ground.zones.find((z) => z.side === "top");
  const y = bandHeight(ground) ?? (zone.rect.top + zone.rect.bottom) / 2;
  const offset = (band ? strideFor(band.rect).radius : 0) + 6;
  const x =
    zone.side === "left"
      ? Math.max(zone.rect.left, zone.rect.right - offset)
      : Math.min(zone.rect.right, zone.rect.left + offset);
  return [x, y];
}

/** The way from one zone into another: through the band's corners. */
function crossing(ground: SearchGround, from: HuntZone, to: HuntZone): Point[] {
  const way: Point[] = [];
  if (from.side !== "top") way.push(corner(ground, from));
  if (to.side !== "top") way.push(corner(ground, to));
  return way;
}

/** A random spot inside a zone, a stride's edge in from its sides. */
function spotIn(rng: Rng, zone: HuntZone): Point {
  const { rect } = zone;
  const { edge } = strideFor(rect);
  return [
    between(rng, rect.left + edge, rect.right - edge),
    between(rng, rect.top + edge, rect.bottom - edge),
  ];
}

/**
 * A search flight's whole route when the page has a column to keep out of.
 *
 * 1. Up out of the search box into the band over it, toward the side the
 *    first zone is on. Never down, where the results will be.
 * 2. The first zone is drawn at random, in proportion to its area. The
 *    bird flies in and wanders there (`wander`) for a random part of the
 *    hunt.
 * 3. Then it may cross to another zone, over the top of the column through
 *    the band's corners, and wander there. It may also stay. The draw is
 *    fresh each time, so no two hunts visit the zones in the same order.
 * 4. Once the route is about {@link SEARCH_HUNT_MS} long, it comes home: up
 *    its side to the band, along the band to a spot over the perch, and
 *    down into the search box.
 *
 * With no band, the bird flies straight out sideways to the one zone the
 * perch can reach, and back the same way. With nowhere to hunt, it hops up
 * and back: the page's hook does not ask for a flight like that.
 */
function searchRoute(
  req: FlightRequest,
  ground: SearchGround,
  start: Point,
): Point[] {
  const { rng, viewport } = req;
  const free = (point: Point) => freePoint(ground, point);
  const hunting = ground.zones.filter((zone) => zone.hunts);
  const bandY = bandHeight(ground);
  if (!hunting.length) {
    const hop: Point = [start[0], bandY ?? start[1] - 60];
    return relax([start, hop, start]);
  }

  const pick = (current: HuntZone | null): HuntZone =>
    pickWeighted(
      rng,
      hunting.map(
        (zone) =>
          [zone, areaOf(zone.rect) * (zone === current ? 0.6 : 1)] as const,
      ),
    );
  let zone = pick(null);
  const band = ground.zones.find((z) => z.side === "top") ?? null;
  const bandStride = band ? strideFor(band.rect) : null;
  const sideOf = (z: HuntZone, at: Point): 1 | -1 =>
    z.side === "left"
      ? -1
      : z.side === "right"
        ? 1
        : (z.rect.left + z.rect.right) / 2 >= at[0]
          ? 1
          : -1;
  const { left: roomLeft, right: roomRight } = ground.bounds;
  const clampX = (x: number) => Math.min(Math.max(x, roomLeft), roomRight);

  // 1. Off the perch: up into the band, or straight out to the side.
  const side = sideOf(zone, start);
  const launch: Point =
    bandY !== null
      ? [clampX(start[0] + side * between(rng, 30, 60)), bandY]
      : sideExit(ground, side, start);
  // The hunt is timed rather than measured: the bird's pace, slowed
  // through each turn as `timeRoute` will slow it, over its steps.
  const hunter: Hunter = {
    at: launch,
    heading: Math.atan2(launch[1] - start[1], launch[0] - start[0]),
    turn: 0,
    points: [],
    flown: 0,
    pace: (690 * SEARCH_PACE * widthPace(viewport)) / 1000,
  };
  const length = SEARCH_HUNT_MS;
  const tight = (z: HuntZone) => bandStride ?? strideFor(z.rect);

  // A band too thin to circle in is patrolled. It is only ever hunted in
  // when neither side is, so it is the whole hunt.
  if (patrols(zone)) {
    patrol(hunter, zone.rect, length, rng, start[0]);
    const home = homeApproach(rng, ground, hunter.at, start);
    return relax([start, launch, ...hunter.points, home, start]);
  }

  // 2. Into the first zone, round the column's corner if it is a side.
  if (zone.side !== "top" && bandY !== null)
    flyTo(hunter, corner(ground, zone), tight(zone), free);
  flyTo(hunter, spotIn(rng, zone), strideFor(zone.rect), free);

  // 3. Hunt, and now and then cross to another zone.
  while (hunter.flown < length && hunter.points.length < HUNT_POINTS) {
    const dwell = length * between(rng, 0.3, 0.6);
    wander(
      hunter,
      zone.rect,
      strideFor(zone.rect),
      hunter.flown + dwell,
      rng,
      true,
    );
    if (hunter.flown >= length || bandY === null) continue;
    const next = pick(zone);
    if (next === zone) continue;
    const way = crossing(ground, zone, next);
    way.forEach((point, i) =>
      flyTo(hunter, point, i === 0 ? strideFor(zone.rect) : tight(next), free),
    );
    flyTo(hunter, spotIn(rng, next), strideFor(next.rect), free);
    zone = next;
  }

  // 4. Home: up to the band, along it, and down onto the perch. With no
  // band, back out of the side the way it went.
  const home = homeApproach(rng, ground, hunter.at, start);
  if (zone.side !== "top" && bandY !== null)
    flyTo(hunter, corner(ground, zone), strideFor(zone.rect), free);
  flyTo(hunter, home, bandStride ?? strideFor(zone.rect), free);
  const last = hunter.points[hunter.points.length - 1];
  const route = [start, launch, ...hunter.points];
  if (!last || Math.hypot(last[0] - home[0], last[1] - home[1]) > 1)
    route.push(home);
  route.push(start);
  return relax(route);
}

/** Just out of the column's side, level with the perch. */
function sideExit(ground: SearchGround, side: 1 | -1, perch: Point): Point {
  return freePoint(ground, [
    side < 0 ? ground.keepOut.left : ground.keepOut.right,
    perch[1],
  ]);
}

/**
 * The spot a search flight lands from, on the side the bird comes from: in
 * the band over the perch, or with no band, just out of the column's side,
 * level with the perch.
 */
function homeApproach(
  rng: Rng,
  ground: SearchGround,
  from: Point,
  perch: Point,
): Point {
  const side = from[0] < perch[0] ? -1 : 1;
  const bandY = bandHeight(ground);
  if (bandY === null) return sideExit(ground, side, perch);
  const x = perch[0] + side * between(rng, 40, 70);
  return [
    Math.min(Math.max(x, ground.bounds.left), ground.bounds.right),
    bandY,
  ];
}

/**
 * The way home from a search flight, when it is asked home early: up its
 * side of the column to the band, along the band to a spot over the perch,
 * and down. Never across the column, where the answer has just appeared.
 */
function searchHomeWaypoints(
  req: FlightRequest,
  ground: SearchGround,
  from: Point,
  perch: Point,
): Point[] {
  const start = freePoint(ground, from);
  const home = homeApproach(req.rng, ground, start, perch);
  const way: Point[] = [from];
  // Beside the column and below the band: up its side to the band first.
  const zone = ground.zones.find(
    (z) =>
      z.side !== "top" &&
      start[0] >= z.rect.left &&
      start[0] <= z.rect.right &&
      start[1] > ground.keepOut.top,
  );
  if (zone && bandHeight(ground) !== null) way.push(corner(ground, zone));
  way.push(home, perch);
  return relax(way);
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
function spline(points: readonly Point[]): Point[] {
  const perSegment = 28;
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
function locate(track: Track, t: number): { point: Point; s: number } {
  const { time, points, length } = track;
  if (t <= 0) return { point: points[0]!, s: 0 };
  const last = time.length - 1;
  if (t >= time[last]!) return { point: points[last]!, s: length[last]! };
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
  // A search with a column to keep out of flies round that column, and so
  // does the way home from one. Its room is the page round the column.
  const ground =
    req.area && req.avoid && perch && (req.kind === "search" || req.airborne)
      ? searchGround(viewport, req.area, req.avoid, perch)
      : null;
  const box = ground?.bounds ?? flightBox(viewport);
  const size = flightSize(viewport);
  const lands = perch !== null;
  const airborne = req.airborne ?? null;

  // The perch's bird sits in the logo pose, so its body's middle is the
  // logo's, at the perch's scale.
  const perchCentre: Point | null = perch ? perchPoint(perch) : null;
  const perchSize = perch?.size ?? size;
  const nearPerch = (p: Point) =>
    !!perchCentre &&
    Math.hypot(p[0] - perchCentre[0], p[1] - perchCentre[1]) < PERCH_REACH;

  const wp =
    airborne && perchCentre
      ? ground
        ? searchHomeWaypoints(
            req,
            ground,
            [airborne.x, airborne.y],
            perchCentre,
          )
        : homeWaypoints(req, [airborne.x, airborne.y], perchCentre, box)
      : waypoints(req, perchCentre ?? [box.left, box.top], box, ground);
  const raw = spline(wp);
  // Keep the route in the room, except where it has to reach the perch, and
  // except a flypast's way in and out, which is off screen on purpose.
  const points = raw.map((p): Point => {
    if (nearPerch(p)) {
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
  // Round a column, the curve may cut a corner by a few px. Out with it.
  // The takeoff from the search box and the landing back in it are the
  // only part of the route that may cross the column's edge.
  if (ground) {
    for (let i = 0; i < points.length; i++) {
      if (!nearPerch(points[i]!)) points[i] = freePoint(ground, points[i]!);
    }
  }

  const cruise =
    between(rng, 600, 780) *
    widthPace(viewport) *
    (req.kind === "search" ? SEARCH_PACE : 1) *
    (ground && airborne ? HOMEWARD_PACE : 1);
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
    req.kind === "swoop"
      ? 0.45
      : req.kind === "search"
        ? 0.3
        : req.kind === "loop" && !airborne
          ? 0.18
          : 0;
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
  return { duration, lands, route, frame, interruptible };
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
