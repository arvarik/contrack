/**
 * corvid.ts — the seam between whatever wants the bird to move and the one
 * overlay that moves it.
 *
 * Nothing here imports React. A view that wants a flight calls `flyCorvid()`
 * and forgets about it; `CorvidFlight`, mounted once in `App`, is the only
 * listener. That keeps the Pulse celebration, the sidebar perch and anything
 * a later plan adds from each owning a copy of the animation.
 *
 * `buildFlightPath` is pure on purpose. A path that leaves the viewport, or
 * crosses the page header, or hides under a phone's tab bar, is a bug that a
 * unit test can catch, and a test can only catch it when the geometry is a
 * function of two rectangles rather than of the DOM.
 *
 * @module lib/corvid
 */
import type { MascotMotion, MotionPreference } from "../api/preferences";

/** Someone asked the corvid to fly. Owned by `CorvidFlight`. */
export const CORVID_FLY_EVENT = "contrack:corvid-fly";

/**
 * `loop` is the sidebar click: one wide circuit of the window and home.
 * `swoop` is the celebration: one pass across the top of the page.
 */
export type CorvidFlightKind = "loop" | "swoop";

/** The payload {@link CORVID_FLY_EVENT} carries. */
export interface CorvidFlyDetail {
  kind: CorvidFlightKind;
  /**
   * Where the bird starts and lands. Omitted means the sidebar perch, which
   * the overlay finds for itself.
   */
  from?: DOMRect;
}

/** How much the corvid is allowed to move, once every input has had its say. */
export type MotionLevel = MascotMotion;

/** Ask the corvid to fly. Silent when no overlay is mounted. */
export const flyCorvid = (detail: Partial<CorvidFlyDetail> = {}): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CorvidFlyDetail>(CORVID_FLY_EVENT, {
      detail: { kind: detail.kind ?? "loop", from: detail.from },
    }),
  );
};

/**
 * What the bird may do, from the account's choice and the two ways a person
 * can ask for less motion.
 *
 * Either reduced input wins over the preference. Someone who turned reduced
 * motion on in their operating system did not turn it on for every app except
 * this one, and the Appearance page says so under the row.
 */
export function motionLevel(
  mascotMotion: MascotMotion,
  prefersReducedMotion: boolean,
  motionPreference: MotionPreference = "system",
): MotionLevel {
  if (prefersReducedMotion) return "off";
  if (motionPreference === "reduced") return "off";
  return mascotMotion;
}

/**
 * Whether this browser can follow a motion path.
 *
 * Safari before 16 ignores `offset-path`, which would leave the bird sitting
 * at the top left of the window for four and a half seconds. The caller plays
 * the hop instead.
 */
export function supportsOffsetPath(): boolean {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") {
    return false;
  }
  return CSS.supports("offset-path", "path('M0 0')");
}

// ---------------------------------------------------------------------------
// The flight path
// ---------------------------------------------------------------------------

/** How far the flight stays inside the left, right and bottom edges. */
export const FLIGHT_EDGE = 24;

/** The band at the top of the window the page header owns. */
export const FLIGHT_TOP = 56;

/** The band at the bottom a phone's tab bar owns. */
export const FLIGHT_PHONE_BOTTOM = 96;

/** Tailwind's `md`. Below it the tab bar exists, above it the sidebar does. */
export const FLIGHT_MD = 768;

export interface FlightViewport {
  width: number;
  height: number;
}

/** The point the bird leaves from and returns to, in viewport pixels. */
export interface FlightPerch {
  x: number;
  y: number;
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

/** One axis of the box, collapsed to its midpoint when the margins overlap. */
function span(low: number, high: number): [number, number] {
  if (low <= high) return [low, high];
  const middle = (low + high) / 2;
  return [middle, middle];
}

type Vec = [number, number];

const clampTo = (box: FlightBox, [x, y]: Vec): Vec => [
  Math.min(Math.max(x, box.left), box.right),
  Math.min(Math.max(y, box.top), box.bottom),
];

/** One decimal is finer than a pixel, and `parsePath` rejects exponents. */
const fixed = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

/**
 * The waypoints of one flight, perch first and perch last.
 *
 * The loop is clockwise from the perch on the left: up and right along the
 * header line, down the right edge, back across the bottom, up the left edge
 * and home. The swoop is the celebration: one pass along the top third and a
 * quicker return above it.
 */
export function flightWaypoints(
  viewport: FlightViewport,
  perch: FlightPerch,
  kind: CorvidFlightKind = "loop",
): Vec[] {
  const box = flightBox(viewport);
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const at = (fx: number, fy: number): Vec =>
    clampTo(box, [box.left + width * fx, box.top + height * fy]);
  const start: Vec = [perch.x, perch.y];

  if (kind === "swoop") {
    return [
      start,
      at(0.25, 0.14),
      at(0.75, 0.24),
      at(1, 0.1),
      at(0.4, 0.04),
      start,
    ];
  }

  return [
    start,
    at(0.25, 0),
    at(1, 0.28),
    at(0.78, 0.78),
    at(0.3, 1),
    at(0, 0.45),
    start,
  ];
}

/**
 * The flight as an SVG path for `offset-path`, in viewport pixels.
 *
 * A Catmull-Rom spline through the waypoints, written out as cubic Béziers so
 * the curve passes through every one of them. Both handles of every segment
 * are clamped into the box, and a cubic never leaves the convex hull of its
 * four control points, so the only part of the curve outside the box is the
 * stretch between the perch and the first waypoint. That is what lets the
 * perch sit in the sidebar's top band while the flight itself keeps clear of
 * the header and the tab bar.
 *
 * Absolute `M` and `C` only, rounded to one decimal, so `parsePath` in
 * `assets/corvidPaths.ts` reads it back and the test measures the real curve.
 */
export function buildFlightPath(
  viewport: FlightViewport,
  perch: FlightPerch,
  kind: CorvidFlightKind = "loop",
): string {
  const points = flightWaypoints(viewport, perch, kind);
  const box = flightBox(viewport);
  const at = (i: number): Vec =>
    points[Math.min(Math.max(i, 0), points.length - 1)]!;

  let d = `M${fixed(points[0]![0])} ${fixed(points[0]![1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    // Catmull-Rom to Bézier, at the usual tension of one sixth.
    const c1 = clampTo(box, [
      p1[0] + (p2[0] - p0[0]) / 6,
      p1[1] + (p2[1] - p0[1]) / 6,
    ]);
    const c2 = clampTo(box, [
      p2[0] - (p3[0] - p1[0]) / 6,
      p2[1] - (p3[1] - p1[1]) / 6,
    ]);
    d +=
      ` C${fixed(c1[0])} ${fixed(c1[1])}` +
      ` ${fixed(c2[0])} ${fixed(c2[1])}` +
      ` ${fixed(p2[0])} ${fixed(p2[1])}`;
  }
  return d;
}

/**
 * A short curve from wherever the bird is now to the perch.
 *
 * A second click while the bird is out asks it home. Restarting the loop
 * would send it round again, so the overlay swaps the path for this one and
 * runs it in under a second.
 */
export function buildHomePath(
  viewport: FlightViewport,
  perch: FlightPerch,
  from: FlightPerch,
): string {
  const box = flightBox(viewport);
  const mid = clampTo(box, [
    (from.x + perch.x) / 2,
    Math.min(from.y, perch.y) - (box.bottom - box.top) * 0.12,
  ]);
  return (
    `M${fixed(from.x)} ${fixed(from.y)}` +
    ` C${fixed(mid[0])} ${fixed(mid[1])}` +
    ` ${fixed(mid[0])} ${fixed(mid[1])}` +
    ` ${fixed(perch.x)} ${fixed(perch.y)}`
  );
}

/**
 * Where a swoop starts when there is no perch to leave from.
 *
 * A celebration is a flypast, not a bird leaving its perch: Pulse fires one
 * when the last follow-up clears, and on a phone there is no perch on that
 * page at all. The sidebar's is in the DOM but CSS-hidden, so its rectangle
 * is all zeros, and a flight built from that would come out of the top left
 * corner of the window and go back into it.
 *
 * This is a point just outside the left edge, on the band the swoop uses, so
 * the bird comes in from off screen, crosses, and leaves the same way.
 */
export function offscreenStart(viewport: FlightViewport): FlightPerch {
  const box = flightBox(viewport);
  return {
    x: box.left - FLIGHT_SIZE,
    y: box.top + (box.bottom - box.top) * 0.14,
  };
}

/** The flying bird's size. The overlay renders the mark at this. */
export const FLIGHT_SIZE = 48;

/** How long a full flight takes, in seconds. */
export const FLIGHT_SECONDS = 4.5;

/** How long the way home takes after a second click, in seconds. */
export const HOMING_SECONDS = 0.8;

/** The celebration pass is shorter than the circuit. */
export const SWOOP_SECONDS = 2;

/** How long a flight lasts, by kind. */
export const flightSeconds = (kind: CorvidFlightKind): number =>
  kind === "swoop" ? SWOOP_SECONDS : FLIGHT_SECONDS;
