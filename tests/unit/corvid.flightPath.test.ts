/**
 * The corvid's flight, as geometry.
 *
 * `buildFlightPath` is pure so that "the bird flew behind the page header"
 * and "the bird went off the bottom of a phone" are failures a test can see.
 * Every assertion here measures the real curve: the path is parsed back with
 * the same `parsePath` the mark uses, and every cubic is sampled, rather than
 * trusting the waypoints the curve was built from.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  FLIGHT_EDGE,
  FLIGHT_MD,
  FLIGHT_PHONE_BOTTOM,
  FLIGHT_TOP,
  buildFlightPath,
  buildHomePath,
  flightBox,
  flightSeconds,
  motionLevel,
  offscreenStart,
  supportsOffsetPath,
  type FlightViewport,
} from "../../src/lib/corvid";
import { parsePath, type Point } from "../../src/assets/corvidPaths";

const PHONE: FlightViewport = { width: 390, height: 844 };
const LAPTOP: FlightViewport = { width: 1440, height: 900 };
/** A window dragged down to one column: narrow, and taller than it is wide. */
const NARROW_TALL: FlightViewport = { width: 320, height: 1200 };

/** The sidebar perch sits above the header band, which is the whole point. */
const PERCH = { x: 32, y: 40 };

function cubic(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
    a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1],
  ];
}

interface Sample {
  point: Point;
  /** Which cubic it came from, counting from zero. */
  segment: number;
}

/** Every cubic of `d`, sampled forty times, plus each segment's index. */
function samples(d: string): Sample[] {
  const out: Sample[] = [];
  let current: Point = [0, 0];
  let segment = 0;
  for (const { cmd, points } of parsePath(d)) {
    if (cmd === "M") {
      current = points[0]!;
      out.push({ point: current, segment: -1 });
      continue;
    }
    const [c1, c2, p1] = points as [Point, Point, Point];
    for (let s = 1; s <= 40; s++) {
      out.push({ point: cubic(current, c1, c2, p1, s / 40), segment });
    }
    current = p1;
    segment += 1;
  }
  return out;
}

const segmentCount = (d: string) =>
  parsePath(d).filter((command) => command.cmd === "C").length;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("flightBox", () => {
  it("keeps the flight clear of the header and the edges on a laptop", () => {
    expect(flightBox(LAPTOP)).toEqual({
      left: FLIGHT_EDGE,
      top: FLIGHT_TOP,
      right: LAPTOP.width - FLIGHT_EDGE,
      bottom: LAPTOP.height - FLIGHT_EDGE,
    });
  });

  it("leaves the phone's tab bar alone below the md breakpoint", () => {
    expect(PHONE.width).toBeLessThan(FLIGHT_MD);
    expect(flightBox(PHONE).bottom).toBe(PHONE.height - FLIGHT_PHONE_BOTTOM);
  });

  it("collapses to a point rather than inverting in a tiny window", () => {
    const box = flightBox({ width: 30, height: 60 });
    expect(box.left).toBe(box.right);
    expect(box.top).toBe(box.bottom);
  });
});

describe("buildFlightPath", () => {
  const cases: [string, FlightViewport][] = [
    ["a phone", PHONE],
    ["a laptop", LAPTOP],
    ["a narrow tall window", NARROW_TALL],
  ];

  for (const [name, viewport] of cases) {
    describe(name, () => {
      const d = buildFlightPath(viewport, PERCH);

      it("parses as absolute M and C commands only", () => {
        expect(() => parsePath(d)).not.toThrow();
        expect(segmentCount(d)).toBeGreaterThan(3);
      });

      it("starts and ends at the perch", () => {
        const points = samples(d);
        expect(points[0]!.point).toEqual([PERCH.x, PERCH.y]);
        const last = points[points.length - 1]!.point;
        expect(last[0]).toBeCloseTo(PERCH.x, 1);
        expect(last[1]).toBeCloseTo(PERCH.y, 1);
      });

      it("never leaves the window", () => {
        for (const { point } of samples(d)) {
          expect(point[0]).toBeGreaterThanOrEqual(0);
          expect(point[0]).toBeLessThanOrEqual(viewport.width);
          expect(point[1]).toBeGreaterThanOrEqual(0);
          expect(point[1]).toBeLessThanOrEqual(viewport.height);
        }
      });

      it("keeps every stretch away from the perch inside the margins", () => {
        // The first and last cubics run between the perch and the box, and
        // the perch is allowed to sit outside it: that is how the bird
        // reaches a sidebar mark above the header band. Everything between
        // them is the flight proper.
        const box = flightBox(viewport);
        const last = segmentCount(d) - 1;
        const middle = samples(d).filter(
          (sample) => sample.segment > 0 && sample.segment < last,
        );
        expect(middle.length).toBeGreaterThan(0);
        for (const { point } of middle) {
          expect(point[0]).toBeGreaterThanOrEqual(box.left - 0.05);
          expect(point[0]).toBeLessThanOrEqual(box.right + 0.05);
          expect(point[1]).toBeGreaterThanOrEqual(box.top - 0.05);
          expect(point[1]).toBeLessThanOrEqual(box.bottom + 0.05);
        }
      });
    });
  }

  it("crosses the whole window, not just the corner it started in", () => {
    const points = samples(buildFlightPath(LAPTOP, PERCH)).map((s) => s.point);
    const right = Math.max(...points.map((p) => p[0]));
    const low = Math.max(...points.map((p) => p[1]));
    expect(right).toBeGreaterThan(LAPTOP.width * 0.8);
    expect(low).toBeGreaterThan(LAPTOP.height * 0.6);
  });

  it("keeps the swoop in the top of the window and out of the way", () => {
    const d = buildFlightPath(LAPTOP, PERCH, "swoop");
    const box = flightBox(LAPTOP);
    const third = box.top + (box.bottom - box.top) / 3;
    for (const { point, segment } of samples(d)) {
      if (segment <= 0) continue;
      expect(point[1]).toBeLessThanOrEqual(third);
    }
    expect(flightSeconds("swoop")).toBeLessThan(flightSeconds("loop"));
  });

  it("gives a window smaller than its own margins a path that goes nowhere", () => {
    const tiny = { width: 30, height: 60 };
    const d = buildFlightPath(tiny, PERCH);
    const box = flightBox(tiny);
    const last = segmentCount(d) - 1;
    // The two ends still reach the perch. Everything between them sits on the
    // one point the box collapsed to, so the bird hops rather than flies.
    for (const { point, segment } of samples(d)) {
      if (segment <= 0 || segment >= last) continue;
      expect(point[0]).toBeCloseTo(box.left, 1);
      expect(point[1]).toBeCloseTo(box.top, 1);
    }
  });
});

describe("offscreenStart", () => {
  // Pulse fires a swoop when the last follow-up clears, and on a phone that
  // page carries no perch: the sidebar's is in the DOM but CSS-hidden, so
  // its rectangle is all zeros. A flight built from that comes out of the
  // top left corner of the window. This is where it comes from instead.
  it("is off the left edge, in the band the swoop crosses", () => {
    const start = offscreenStart(LAPTOP);
    const box = flightBox(LAPTOP);
    expect(start.x).toBeLessThan(0);
    expect(start.y).toBeGreaterThan(box.top);
    expect(start.y).toBeLessThan(box.top + (box.bottom - box.top) / 3);
  });

  it("keeps the whole swoop in the top third of a phone", () => {
    const start = offscreenStart(PHONE);
    const box = flightBox(PHONE);
    const third = box.top + (box.bottom - box.top) / 3;
    for (const { point, segment } of samples(
      buildFlightPath(PHONE, start, "swoop"),
    )) {
      if (segment <= 0) continue;
      expect(point[1]).toBeLessThanOrEqual(third);
    }
  });

  it("starts and ends off screen, so the bird arrives and leaves", () => {
    const start = offscreenStart(LAPTOP);
    const points = samples(buildFlightPath(LAPTOP, start, "swoop"));
    expect(points[0]!.point[0]).toBeLessThan(0);
    expect(points[points.length - 1]!.point[0]).toBeLessThan(0);
  });
});

describe("buildHomePath", () => {
  it("runs from where the bird is to the perch, inside the window", () => {
    const from = { x: 1300, y: 700 };
    const d = buildHomePath(LAPTOP, PERCH, from);
    const points = samples(d);
    expect(points[0]!.point).toEqual([from.x, from.y]);
    const last = points[points.length - 1]!.point;
    expect(last[0]).toBeCloseTo(PERCH.x, 1);
    expect(last[1]).toBeCloseTo(PERCH.y, 1);
    for (const { point } of points) {
      expect(point[0]).toBeGreaterThanOrEqual(0);
      expect(point[1]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("motionLevel", () => {
  it("passes the account's choice through when nothing asks for less", () => {
    expect(motionLevel("full", false, "system")).toBe("full");
    expect(motionLevel("subtle", false, "system")).toBe("subtle");
    expect(motionLevel("off", false, "system")).toBe("off");
  });

  it("is off when the operating system asks for reduced motion", () => {
    expect(motionLevel("full", true, "system")).toBe("off");
    expect(motionLevel("subtle", true, "system")).toBe("off");
    expect(motionLevel("off", true, "system")).toBe("off");
  });

  it("is off when the Motion row asks for reduced motion", () => {
    expect(motionLevel("full", false, "reduced")).toBe("off");
    expect(motionLevel("subtle", false, "reduced")).toBe("off");
  });

  it("is off when both ask, and defaults the Motion row to system", () => {
    expect(motionLevel("full", true, "reduced")).toBe("off");
    expect(motionLevel("full", false)).toBe("full");
  });
});

describe("supportsOffsetPath", () => {
  it("is false where the browser has no CSS.supports to ask", () => {
    vi.stubGlobal("CSS", undefined);
    expect(supportsOffsetPath()).toBe(false);
  });

  it("asks CSS.supports for the property the overlay actually sets", () => {
    const supports = vi.fn().mockReturnValue(true);
    vi.stubGlobal("CSS", { supports });
    expect(supportsOffsetPath()).toBe(true);
    expect(supports).toHaveBeenCalledWith("offset-path", "path('M0 0')");
  });

  it("is false in a browser that ignores offset-path", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    expect(supportsOffsetPath()).toBe(false);
  });
});
