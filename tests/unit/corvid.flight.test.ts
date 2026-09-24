/**
 * The corvid's flights, measured.
 *
 * `planFlight` is pure so that "the bird left the window", "the bird flew
 * upside down" and "the bird landed somewhere other than its ring" are
 * failures a test can see. Every flight here is flown frame by frame at 60
 * frames a second, over many seeds and three windows, and every promise is
 * checked on every frame rather than on the waypoints the route was drawn
 * through:
 *
 * - It leaves as the logo and lands as the logo, at the perch's place and
 *   size, so the swap between the perch's bird and the flying one is
 *   invisible at both ends.
 * - It stays inside the window, and away from the perch inside the part of
 *   the window a flight may cross.
 * - It faces the way it goes, turning round rather than flying backwards.
 * - It is random: seeds give different routes, and one seed gives one route.
 */
import { describe, expect, it } from "vitest";
import {
  FLIGHT_EDGE,
  FLIGHT_MD,
  FLIGHT_PHONE_BOTTOM,
  FLIGHT_TOP,
  flightBox,
  flightSize,
  planFlight,
  type FlightFrame,
  type FlightKind,
  type FlightPerch,
  type FlightPlan,
  type FlightViewport,
} from "../../src/lib/corvidFlight";
import { HOME_POSE, POSE_KEYS, bodyCentre } from "../../src/assets/corvidRig";
import { createRng } from "../../src/lib/corvidMotion";
import { motionLevel } from "../../src/lib/corvid";

const PHONE: FlightViewport = { width: 390, height: 844 };
const LAPTOP: FlightViewport = { width: 1440, height: 900 };
const SMALL: FlightViewport = { width: 1024, height: 640 };

/** The sidebar perch: 40 px at the top of the rail. */
const SIDEBAR: FlightPerch = { left: 16, top: 12, size: 40 };
/** The phone's perch, at the right end of the Settings footer. */
const FOOTER: FlightPerch = { left: 346, top: 700, size: 20 };

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

function fly(plan: FlightPlan, step = 1000 / 60): FlightFrame[] {
  const frames: FlightFrame[] = [];
  for (let t = 0; t < plan.duration; t += step) frames.push(plan.frame(t));
  frames.push(plan.frame(plan.duration));
  return frames;
}

const perchCentre = (perch: FlightPerch) => {
  const [x, y] = bodyCentre(HOME_POSE);
  return [
    perch.left + (x / 100) * perch.size,
    perch.top + (y / 100) * perch.size,
  ] as const;
};

const expectHome = (frame: FlightFrame, perch: FlightPerch) => {
  const [x, y] = perchCentre(perch);
  expect(frame.x).toBeCloseTo(x, 6);
  expect(frame.y).toBeCloseTo(y, 6);
  expect(frame.size).toBeCloseTo(perch.size, 6);
  expect(frame.rotate).toBeCloseTo(0, 6);
  expect(frame.roll).toBe(1);
  for (const key of POSE_KEYS)
    expect(frame.pose[key], key).toBeCloseTo(HOME_POSE[key], 6);
};

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

  it("flies the bird larger than it sits, smaller on a phone", () => {
    expect(flightSize(LAPTOP)).toBe(64);
    expect(flightSize(PHONE)).toBe(52);
  });
});

const CASES: [string, FlightViewport, FlightPerch][] = [
  ["a laptop", LAPTOP, SIDEBAR],
  ["a small window", SMALL, SIDEBAR],
  ["a phone", PHONE, FOOTER],
];

for (const kind of ["loop", "sortie", "swoop"] as FlightKind[]) {
  describe(`a ${kind}`, () => {
    for (const [name, viewport, perch] of CASES) {
      it(`leaves as the logo and lands as the logo, on ${name}`, () => {
        for (const seed of SEEDS) {
          const plan = planFlight({
            kind,
            viewport,
            perch,
            rng: createRng(seed),
          });
          expect(plan.lands).toBe(true);
          expectHome(plan.frame(0), perch);
          expectHome(plan.frame(plan.duration), perch);
        }
      });

      it(`stays in the window, and in the flight box away from the perch, on ${name}`, () => {
        const box = flightBox(viewport);
        const [px, py] = perchCentre(perch);
        for (const seed of SEEDS) {
          const plan = planFlight({
            kind,
            viewport,
            perch,
            rng: createRng(seed),
          });
          for (const f of fly(plan)) {
            expect(f.x).toBeGreaterThanOrEqual(0);
            expect(f.x).toBeLessThanOrEqual(viewport.width);
            expect(f.y).toBeGreaterThanOrEqual(0);
            expect(f.y).toBeLessThanOrEqual(viewport.height);
            if (Math.hypot(f.x - px, f.y - py) > 120) {
              // The body's middle, give or take the bob of a wingbeat.
              expect(f.x).toBeGreaterThanOrEqual(box.left - 3);
              expect(f.x).toBeLessThanOrEqual(box.right + 3);
              expect(f.y).toBeGreaterThanOrEqual(box.top - 3);
              expect(f.y).toBeLessThanOrEqual(box.bottom + 3);
            }
          }
        }
      });
    }

    it("never flies upside down, except in a roll, and never tilts past 50 degrees", () => {
      for (const seed of SEEDS) {
        const plan = planFlight({
          kind,
          viewport: LAPTOP,
          perch: SIDEBAR,
          rng: createRng(seed),
        });
        const frames = fly(plan);
        const rolling = frames.filter((f) => f.roll < 1);
        // A roll is one short stretch, well under a second.
        expect(rolling.length * (1000 / 60)).toBeLessThan(620);
        for (const f of frames) {
          expect(Math.abs(f.rotate)).toBeLessThanOrEqual(50.5);
          expect(f.roll).toBeGreaterThanOrEqual(-1);
          expect(f.roll).toBeLessThanOrEqual(1);
        }
      }
    });
  });
}

describe("which way the bird faces", () => {
  it("faces the way it flies, nearly always", () => {
    let checked = 0;
    let wrong = 0;
    for (const seed of SEEDS) {
      const plan = planFlight({
        kind: "loop",
        viewport: LAPTOP,
        perch: SIDEBAR,
        rng: createRng(seed),
      });
      const frames = fly(plan);
      // Skip the launch and the landing, where it turns on purpose.
      for (let i = 40; i < frames.length - 50; i++) {
        const a = frames[i - 1]!;
        const b = frames[i]!;
        const vx = b.x - a.x;
        const speed = Math.hypot(vx, b.y - a.y);
        if (speed < 2 || Math.abs(vx) < 0.6 * speed) continue;
        checked += 1;
        if (Math.sign(vx) !== Math.sign(b.pose.headFacing)) wrong += 1;
      }
    }
    expect(checked).toBeGreaterThan(1000);
    // A turn takes a sixth of a second, and a turn is where the two differ.
    expect(wrong / checked).toBeLessThan(0.04);
  });

  it("keeps the head facing the way the body does while it flies", () => {
    const plan = planFlight({
      kind: "loop",
      viewport: LAPTOP,
      perch: SIDEBAR,
      rng: createRng(4),
    });
    for (const f of fly(plan).slice(40, -50)) {
      // The rig's body faces left, so facing right is its mirror.
      expect(Math.sign(f.pose.headFacing)).toBe(-Math.sign(f.pose.bodyFacing));
    }
  });
});

describe("turning round", () => {
  /** Whether a run of facings only ever moves one way. */
  const oneWay = (values: number[]) => {
    const rising = values[values.length - 1]! >= values[0]!;
    return values.every(
      (v, i) =>
        i === 0 ||
        (rising ? v >= values[i - 1]! - 1e-9 : v <= values[i - 1]! + 1e-9),
    );
  };

  it("turns about on the perch in one sweep, never flipping back", () => {
    for (const seed of SEEDS) {
      for (const [viewport, perch] of [
        [LAPTOP, SIDEBAR],
        [PHONE, FOOTER],
      ] as const) {
        const plan = planFlight({
          kind: "loop",
          viewport,
          perch,
          rng: createRng(seed),
        });
        const launch = Array.from({ length: 60 }, (_, i) => plan.frame(i * 8));
        expect(
          oneWay(launch.map((f) => f.pose.bodyFacing)),
          `body, seed ${seed}`,
        ).toBe(true);
        expect(
          oneWay(launch.map((f) => f.pose.headFacing)),
          `head, seed ${seed}`,
        ).toBe(true);
        // Never flat: a bird seen side on narrows, it does not vanish.
        for (const f of launch) {
          expect(Math.abs(f.pose.bodyFacing)).toBeGreaterThanOrEqual(0.2);
          expect(Math.abs(f.pose.headFacing)).toBeGreaterThanOrEqual(0.2);
        }
      }
    }
  });

  it("turns back into the logo on landing in one sweep, never flipping back", () => {
    for (const seed of SEEDS) {
      for (const [viewport, perch] of [
        [LAPTOP, SIDEBAR],
        [PHONE, FOOTER],
      ] as const) {
        const plan = planFlight({
          kind: "loop",
          viewport,
          perch,
          rng: createRng(seed),
        });
        const settle = Array.from({ length: 60 }, (_, i) =>
          plan.frame(plan.duration - 480 + i * 8),
        );
        expect(
          oneWay(settle.map((f) => f.pose.bodyFacing)),
          `body, seed ${seed}`,
        ).toBe(true);
        expect(
          oneWay(settle.map((f) => f.pose.headFacing)),
          `head, seed ${seed}`,
        ).toBe(true);
      }
    }
  });
});

describe("randomness", () => {
  it("draws the same route from the same seed", () => {
    const a = planFlight({
      kind: "loop",
      viewport: LAPTOP,
      perch: SIDEBAR,
      rng: createRng(99),
    });
    const b = planFlight({
      kind: "loop",
      viewport: LAPTOP,
      perch: SIDEBAR,
      rng: createRng(99),
    });
    expect(a.route).toBe(b.route);
    expect(a.duration).toBe(b.duration);
    expect(a.frame(1234)).toEqual(b.frame(1234));
  });

  it("draws a different route from each seed", () => {
    const routes = new Set(
      SEEDS.map(
        (seed) =>
          planFlight({
            kind: "loop",
            viewport: LAPTOP,
            perch: SIDEBAR,
            rng: createRng(seed),
          }).route,
      ),
    );
    expect(routes.size).toBe(SEEDS.length);
  });

  it("goes round both ways over enough laps", () => {
    let clockwise = 0;
    for (const seed of SEEDS) {
      const plan = planFlight({
        kind: "loop",
        viewport: LAPTOP,
        perch: SIDEBAR,
        rng: createRng(seed),
      });
      // The shoelace sign of the route: positive is clockwise on a screen.
      const pts = fly(plan, 50).map((f) => [f.x, f.y] as const);
      let area = 0;
      for (let i = 1; i < pts.length; i++)
        area += pts[i - 1]![0] * pts[i]![1] - pts[i]![0] * pts[i - 1]![1];
      if (area > 0) clockwise += 1;
    }
    expect(clockwise).toBeGreaterThan(0);
    expect(clockwise).toBeLessThan(SEEDS.length);
  });
});

describe("how long and how far", () => {
  it("takes a lap in three to ten seconds on a laptop", () => {
    for (const seed of SEEDS) {
      const plan = planFlight({
        kind: "loop",
        viewport: LAPTOP,
        perch: SIDEBAR,
        rng: createRng(seed),
      });
      expect(plan.duration).toBeGreaterThan(3_000);
      expect(plan.duration).toBeLessThan(10_000);
    }
  });

  it("keeps an outing short and near home", () => {
    const box = flightBox(LAPTOP);
    for (const seed of SEEDS) {
      const plan = planFlight({
        kind: "sortie",
        viewport: LAPTOP,
        perch: SIDEBAR,
        rng: createRng(seed),
      });
      expect(plan.duration).toBeLessThan(5_500);
      for (const f of fly(plan)) {
        expect(f.x).toBeLessThan(
          SIDEBAR.left + (box.right - box.left) * 0.42 + 80,
        );
        expect(f.y).toBeLessThan(box.top + (box.bottom - box.top) * 0.42 + 60);
      }
    }
  });

  it("beats its wings and glides, in the same flight", () => {
    for (const seed of SEEDS) {
      const plan = planFlight({
        kind: "loop",
        viewport: LAPTOP,
        perch: SIDEBAR,
        rng: createRng(seed),
      });
      const frames = fly(plan).slice(30, -30);
      const beating = frames.filter((f) => f.pose.wingTurn < 0).length;
      const gliding = frames.filter(
        (f) => f.pose.wingTurn === 1 && f.pose.wingSpread === 1,
      ).length;
      expect(beating).toBeGreaterThan(10);
      expect(gliding).toBeGreaterThan(10);
    }
  });
});

describe("a flypast", () => {
  it("comes in from beyond the left edge and leaves beyond the right, and never lands", () => {
    for (const seed of SEEDS) {
      const plan = planFlight({
        kind: "swoop",
        viewport: PHONE,
        perch: null,
        rng: createRng(seed),
      });
      expect(plan.lands).toBe(false);
      expect(plan.frame(0).x).toBeLessThan(0);
      expect(plan.frame(plan.duration).x).toBeGreaterThan(PHONE.width);
      // It crosses the top of the page, clear of the tab bar.
      for (const f of fly(plan)) expect(f.y).toBeLessThan(PHONE.height / 2);
    }
  });
});

describe("the way home", () => {
  it("starts where the bird is and lands in the ring, quickly", () => {
    for (const seed of SEEDS) {
      const plan = planFlight({
        kind: "loop",
        viewport: LAPTOP,
        perch: SIDEBAR,
        rng: createRng(seed),
        airborne: { x: 900, y: 500, facing: -1 },
      });
      const first = plan.frame(0);
      expect(first.x).toBeCloseTo(900, 0);
      expect(first.pose.flight).toBe(1);
      expectHome(plan.frame(plan.duration), SIDEBAR);
      expect(plan.duration).toBeLessThan(3_500);
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
