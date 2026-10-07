/**
 * The corvid's flights, measured. Every flight is flown frame by frame at 60
 * fps, over many seeds and three windows, and checked on every frame:
 *
 * - It leaves and lands as the logo, at the perch's place and size, so the
 *   swap to and from the perch's bird is invisible.
 * - It stays inside the window, and away from the perch inside the part a
 *   flight may cross.
 * - It faces the way it goes, turning round rather than flying backwards.
 * - Seeds give different routes, and one seed gives one route.
 */
import { describe, expect, it } from "vitest";
import {
  FLIGHT_EDGE,
  FLIGHT_MD,
  FLIGHT_PHONE_BOTTOM,
  FLIGHT_TOP,
  SEARCH_HUNT_MS,
  canHunt,
  flightBox,
  flightSize,
  planFlight,
  searchGround,
  type FlightBox,
  type FlightFrame,
  type FlightKind,
  type FlightPerch,
  type FlightPlan,
  type FlightViewport,
} from "../../../../src/lib/corvidFlight";
import {
  HOME_POSE,
  POSE_KEYS,
  bodyCenter,
  drawCorvid,
} from "../../../../src/assets/corvidRig";
import { createRng } from "../../../../src/lib/corvidMotion";
import { motionLevel } from "../../../../src/lib/corvid";

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

const perchCenter = (perch: FlightPerch) => {
  const [x, y] = bodyCenter(HOME_POSE);
  return [
    perch.left + (x / 100) * perch.size,
    perch.top + (y / 100) * perch.size,
  ] as const;
};

const expectHome = (frame: FlightFrame, perch: FlightPerch) => {
  const [x, y] = perchCenter(perch);
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
    expect(flightSize(LAPTOP)).toBeGreaterThan(SIDEBAR.size);
    expect(flightSize(PHONE)).toBeGreaterThan(FOOTER.size);
    expect(flightSize(PHONE)).toBeLessThan(flightSize(LAPTOP));
  });
});

const CASES: [string, FlightViewport, FlightPerch][] = [
  ["a laptop", LAPTOP, SIDEBAR],
  ["a small window", SMALL, SIDEBAR],
  ["a phone", PHONE, FOOTER],
];

for (const kind of ["loop", "sortie", "swoop", "search"] as FlightKind[]) {
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
        const [px, py] = perchCenter(perch);
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

describe("smoothness", () => {
  const KINDS: FlightKind[] = ["loop", "sortie", "swoop", "search"];

  it("never pitches more than 18 degrees in one frame, turns included", () => {
    for (const kind of KINDS) {
      for (const seed of SEEDS) {
        const frames = fly(
          planFlight({
            kind,
            viewport: LAPTOP,
            perch: SIDEBAR,
            rng: createRng(seed),
          }),
        );
        for (let i = 1; i < frames.length; i++) {
          expect(
            Math.abs(frames[i]!.rotate - frames[i - 1]!.rotate),
            `${kind} ${seed} ${i}`,
          ).toBeLessThan(18);
        }
      }
    }
  });

  it("never doubles back within a frame: every turn has a radius", () => {
    for (const kind of KINDS) {
      for (const seed of SEEDS) {
        const plan = planFlight({
          kind,
          viewport: LAPTOP,
          perch: SIDEBAR,
          rng: createRng(seed),
        });
        const frames = fly(plan);
        // Between the launch and the flare, where the bird is under way.
        for (let i = 40; i < frames.length - 60; i++) {
          const a = frames[i - 1]!;
          const b = frames[i]!;
          const c = frames[i + 1]!;
          const u = [b.x - a.x, b.y - a.y];
          const v = [c.x - b.x, c.y - b.y];
          const lu = Math.hypot(u[0]!, u[1]!);
          const lv = Math.hypot(v[0]!, v[1]!);
          if (lu < 3 || lv < 3) continue;
          const turn =
            (Math.acos(
              Math.min(1, (u[0]! * v[0]! + u[1]! * v[1]!) / (lu * lv)),
            ) *
              180) /
            Math.PI;
          expect(turn, `${kind} ${seed} ${i}`).toBeLessThan(45);
        }
      }
    }
  });

  it("grows and shrinks smoothly: never more than 2 px in one frame", () => {
    for (const [viewport, perch] of [
      [LAPTOP, SIDEBAR],
      [PHONE, FOOTER],
    ] as const) {
      for (const seed of SEEDS) {
        const frames = fly(
          planFlight({ kind: "loop", viewport, perch, rng: createRng(seed) }),
        );
        for (let i = 1; i < frames.length; i++) {
          expect(
            Math.abs(frames[i]!.size - frames[i - 1]!.size),
            `${seed} ${i}`,
          ).toBeLessThan(2);
        }
      }
    }
  });

  it("keeps its head where it was while it turns about in the ring", () => {
    for (const seed of SEEDS) {
      const plan = planFlight({
        kind: "loop",
        viewport: LAPTOP,
        perch: SIDEBAR,
        rng: createRng(seed),
      });
      const eyeAt = (t: number) => {
        const f = plan.frame(t);
        const [cx] = bodyCenter(f.pose);
        const eye = drawCorvid(f.pose).eye;
        return f.x + ((eye.cx - cx) * f.size) / 100;
      };
      const start = eyeAt(0);
      // The body turns under the head between 100 and 210 ms, before the leap.
      for (let t = 0; t <= 205; t += 5)
        expect(Math.abs(eyeAt(t) - start), `${seed} ${t}`).toBeLessThan(3);
    }
  });
});

describe("a second press", () => {
  it("eases the way home out of the frame the bird was in", () => {
    for (const seed of SEEDS) {
      const first = planFlight({
        kind: "loop",
        viewport: LAPTOP,
        perch: SIDEBAR,
        rng: createRng(seed),
      });
      const at = first.frame(1_700);
      const home = planFlight({
        kind: "loop",
        viewport: LAPTOP,
        perch: SIDEBAR,
        rng: createRng(seed + 100),
        airborne: {
          x: at.x,
          y: at.y,
          facing: at.pose.headFacing >= 0 ? 1 : -1,
          from: at,
        },
      });
      const next = home.frame(0);
      expect(next.x).toBeCloseTo(at.x, 3);
      expect(next.y).toBeCloseTo(at.y, 0);
      expect(next.size).toBeCloseTo(at.size, 6);
      expect(next.rotate).toBeCloseTo(at.rotate, 6);
      expect(next.pose.wingAngle).toBeCloseTo(at.pose.wingAngle, 6);
      const frames = fly(home);
      for (let i = 1; i < frames.length; i++) {
        expect(Math.abs(frames[i]!.size - frames[i - 1]!.size)).toBeLessThan(
          2.5,
        );
        expect(
          Math.abs(frames[i]!.rotate - frames[i - 1]!.rotate),
        ).toBeLessThan(18);
      }
      expectHome(frames[frames.length - 1]!, SIDEBAR);
    }
  });

  it("is only heard between leaving the ring and coming in to land", () => {
    const plan = planFlight({
      kind: "loop",
      viewport: LAPTOP,
      perch: SIDEBAR,
      rng: createRng(3),
    });
    expect(plan.interruptible(100)).toBe(false);
    expect(plan.interruptible(600)).toBe(true);
    expect(plan.interruptible(plan.duration / 2)).toBe(true);
    expect(plan.interruptible(plan.duration - 300)).toBe(false);
    const flypast = planFlight({
      kind: "swoop",
      viewport: PHONE,
      perch: null,
      rng: createRng(3),
    });
    expect(flypast.interruptible(flypast.duration / 2)).toBe(false);
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

describe("a search over a ground, with no column to keep out of", () => {
  /** A search box bird, and a ground below it on a laptop. */
  const BOX_BIRD: FlightPerch = { left: 316, top: 196, size: 20 };
  const GROUND = { left: 296, top: 330, right: 1144, bottom: 900 };
  /** The same on a phone: the whole width, down past the tab bar. */
  const PHONE_BIRD: FlightPerch = { left: 32, top: 140, size: 20 };
  const PHONE_GROUND = { left: 16, top: 250, right: 374, bottom: 844 };

  const CASES = [
    ["a laptop", LAPTOP, BOX_BIRD, GROUND],
    ["a phone", PHONE, PHONE_BIRD, PHONE_GROUND],
  ] as const;

  for (const [name, viewport, perch, ground] of CASES) {
    it(`hunts over the ground it is given, and all of it, on ${name}`, () => {
      const box = flightBox(viewport);
      // The ground inside the room: the phone's tab bar is not in it.
      const bottom = Math.min(ground.bottom, box.bottom);
      const width = ground.right - ground.left;
      const height = bottom - ground.top;
      const spread: number[] = [];
      for (const seed of SEEDS) {
        const plan = planFlight({
          kind: "search",
          viewport,
          perch,
          rng: createRng(seed),
          area: ground,
        });
        const frames = fly(plan).slice(90, -90);
        const over = frames.filter(
          (f) =>
            f.x >= ground.left - 40 &&
            f.x <= ground.right + 40 &&
            f.y >= ground.top - 40 &&
            f.y <= bottom + 40,
        );
        // Out of the search box and back, and the rest over the ground.
        expect(over.length / frames.length, `${seed}`).toBeGreaterThan(0.9);
        // It wanders the ground rather than circling its middle. The bird
        // turns before an edge, so it keeps about a turn's width off each.
        const xs = frames.map((f) => f.x);
        const ys = frames.map((f) => f.y);
        spread.push((Math.max(...xs) - Math.min(...xs)) / width);
        expect(Math.max(...ys) - Math.min(...ys), `${seed}`).toBeGreaterThan(
          height * 0.5,
        );
      }
      expect(Math.min(...spread)).toBeGreaterThan(0.4);
      expect(spread.reduce((a, b) => a + b) / spread.length).toBeGreaterThan(
        0.6,
      );
    });

    it(`hunts for about ${SEARCH_HUNT_MS / 1000} seconds, then lands by itself, on ${name}`, () => {
      for (const seed of SEEDS) {
        const plan = planFlight({
          kind: "search",
          viewport,
          perch,
          rng: createRng(seed),
          area: ground,
        });
        expect(plan.lands).toBe(true);
        // Longer than the server's 12 second budget for a model answer.
        expect(plan.duration, `${seed}`).toBeGreaterThan(18_000);
        expect(plan.duration, `${seed}`).toBeLessThan(40_000);
        expectHome(plan.frame(plan.duration), perch);
      }
    });
  }

  it("flies slower than a lap: it is looking, not racing", () => {
    const speed = (plan: FlightPlan) => {
      const frames = fly(plan).slice(60, -60);
      let path = 0;
      for (let i = 1; i < frames.length; i++)
        path += Math.hypot(
          frames[i]!.x - frames[i - 1]!.x,
          frames[i]!.y - frames[i - 1]!.y,
        );
      return path / frames.length;
    };
    for (const seed of SEEDS) {
      const hunt = planFlight({
        kind: "search",
        viewport: LAPTOP,
        perch: BOX_BIRD,
        rng: createRng(seed),
        area: GROUND,
      });
      const lap = planFlight({
        kind: "loop",
        viewport: LAPTOP,
        perch: BOX_BIRD,
        rng: createRng(seed),
      });
      expect(speed(hunt), `${seed}`).toBeLessThan(speed(lap));
    }
  });

  it("keeps a ground that runs off the room inside it", () => {
    const box = flightBox(LAPTOP);
    const plan = planFlight({
      kind: "search",
      viewport: LAPTOP,
      perch: BOX_BIRD,
      rng: createRng(7),
      area: { left: -400, top: 330, right: 2400, bottom: 2000 },
    });
    for (const f of fly(plan).slice(60)) {
      expect(f.x).toBeGreaterThanOrEqual(box.left - 3);
      expect(f.x).toBeLessThanOrEqual(box.right + 3);
      expect(f.y).toBeLessThanOrEqual(box.bottom + 3);
    }
  });

  it("can be called home from anywhere in the hunt", () => {
    const plan = planFlight({
      kind: "search",
      viewport: LAPTOP,
      perch: BOX_BIRD,
      rng: createRng(11),
      area: GROUND,
    });
    // Out of the ring within half a second, and it stays that way until
    // it comes in to land.
    expect(plan.interruptible(600)).toBe(true);
    for (let t = 600; t < plan.duration - 2_000; t += 500)
      expect(plan.interruptible(t), `${t}`).toBe(true);
  });
});

describe("a search round the column", () => {
  /**
   * The Ask page as measured in a browser: the page beside the nav rail,
   * the search box, and the bird in it. The column the bird keeps out of is
   * the search box and the results under it, down past the window's bottom.
   */
  interface Layout {
    name: string;
    viewport: FlightViewport;
    area: FlightBox;
    field: FlightBox;
    perch: FlightPerch;
    /** Where the hunt goes: beside the column, or over it. */
    hunts: ("left" | "right" | "top")[];
  }
  const column = (field: FlightBox, viewport: FlightViewport): FlightBox => ({
    ...field,
    bottom: viewport.height,
  });
  const LAYOUTS: Layout[] = [
    {
      name: "a laptop",
      viewport: LAPTOP,
      area: { left: 64, top: 0, right: 1440, bottom: 900 },
      field: { left: 408, top: 102, right: 1096, bottom: 182 },
      perch: { left: 432, top: 132, size: 20 },
      hunts: ["left", "right"],
    },
    {
      name: "a small laptop",
      viewport: { width: 1024, height: 768 },
      area: { left: 64, top: 0, right: 1024, bottom: 768 },
      field: { left: 184, top: 102, right: 680, bottom: 182 },
      perch: { left: 208, top: 132, size: 20 },
      hunts: ["right"],
    },
    {
      name: "a tablet",
      viewport: { width: 800, height: 1000 },
      area: { left: 64, top: 0, right: 800, bottom: 1000 },
      field: { left: 88, top: 96, right: 776, bottom: 176 },
      perch: { left: 112, top: 126, size: 20 },
      hunts: ["top"],
    },
    {
      name: "a phone",
      viewport: { width: 390, height: 664 },
      area: { left: 0, top: 0, right: 390, bottom: 664 },
      field: { left: 16, top: 142, right: 374, bottom: 202 },
      perch: { left: 32, top: 162, size: 20 },
      hunts: ["top"],
    },
  ];
  const MANY = Array.from({ length: 24 }, (_, i) => i + 1);

  const plan = (layout: Layout, seed: number) =>
    planFlight({
      kind: "search",
      viewport: layout.viewport,
      perch: layout.perch,
      rng: createRng(seed),
      area: layout.area,
      avoid: column(layout.field, layout.viewport),
    });

  /** The frames away from the perch: not leaving it, not landing on it. */
  const away = (frames: FlightFrame[], perch: FlightPerch) => {
    const [px, py] = perchCenter(perch);
    return frames.filter((f) => Math.hypot(f.x - px, f.y - py) >= 110);
  };

  /** Which part of the page a frame is in. */
  const partOf = (f: FlightFrame, field: FlightBox) =>
    f.x < field.left ? "left" : f.x > field.right ? "right" : "top";

  for (const layout of LAYOUTS) {
    const { name, viewport, area, field, perch } = layout;
    const size = flightSize(viewport);

    it(`never flies over the search box or the results, on ${name}`, () => {
      for (const seed of MANY) {
        for (const f of away(fly(plan(layout, seed)), perch)) {
          // Half a bird out beside the column, or nearly as much over it:
          // the body clears the column, and so does most of each wing.
          const beside = Math.max(field.left - f.x, f.x - field.right);
          const over = field.top - f.y;
          expect(
            beside >= 0.5 * size || over >= 0.4 * size,
            `${seed} at ${f.x.toFixed(1)},${f.y.toFixed(1)}`,
          ).toBe(true);
        }
      }
    });

    it(`stays on the page, off the nav rail and the tab bar, on ${name}`, () => {
      const room = flightBox(viewport);
      for (const seed of MANY.slice(0, 8)) {
        for (const f of away(fly(plan(layout, seed)), perch)) {
          expect(f.x).toBeGreaterThanOrEqual(area.left + size / 2 - 3);
          expect(f.x).toBeLessThanOrEqual(area.right - size / 2 + 3);
          expect(f.y).toBeGreaterThanOrEqual(FLIGHT_EDGE - 3);
          expect(f.y).toBeLessThanOrEqual(room.bottom + 3);
        }
      }
    });

    it(`hunts where there is room, on ${name}`, () => {
      const seen = new Set<string>();
      for (const seed of MANY) {
        const frames = away(fly(plan(layout, seed)), perch);
        const parts = frames.map((f) => partOf(f, field));
        for (const part of parts) seen.add(part);
        // Nearly all of the hunt is where the layout has room for one.
        const hunting = parts.filter((part) => layout.hunts.includes(part));
        expect(hunting.length / parts.length, `${seed}`).toBeGreaterThan(0.85);
      }
      for (const part of layout.hunts) expect(seen).toContain(part);
    });

    it(`hunts for about ${SEARCH_HUNT_MS / 1000} seconds, then lands in the search box, on ${name}`, () => {
      for (const seed of MANY) {
        const flight = plan(layout, seed);
        expect(flight.lands).toBe(true);
        expect(flight.duration, `${seed}`).toBeGreaterThan(18_000);
        expect(flight.duration, `${seed}`).toBeLessThan(40_000);
        expectHome(flight.frame(0), perch);
        expectHome(flight.frame(flight.duration), perch);
      }
    });

    it(`comes home round the column when called early, on ${name}`, () => {
      for (const seed of MANY.slice(0, 8)) {
        const hunt = plan(layout, seed);
        for (const t of [2_500, 7_000, 13_000]) {
          const at = hunt.frame(t);
          const home = planFlight({
            kind: "loop",
            viewport,
            perch,
            rng: createRng(seed),
            airborne: { x: at.x, y: at.y, facing: 1, from: at },
            area,
            avoid: column(field, viewport),
          });
          for (const f of away(fly(home), perch)) {
            const beside = Math.max(field.left - f.x, f.x - field.right);
            expect(
              beside >= 0.5 * size || field.top - f.y >= 0.4 * size,
              `${seed} at ${t}`,
            ).toBe(true);
          }
          expectHome(home.frame(home.duration), perch);
          // The short way: a few seconds, however far out the bird is.
          expect(home.duration).toBeLessThan(5_000);
        }
      }
    });
  }

  /**
   * How often the bird's height turns from rising to falling or back, per
   * 100 px it travels across. A change counts once it has gone 4 px the
   * other way, so the 1.8 px bob of a wingbeat is not one.
   */
  const reversalsPer100 = (frames: FlightFrame[]) => {
    let dir = 0;
    let extreme = frames[0]!.y;
    let count = 0;
    let across = 0;
    for (let i = 1; i < frames.length; i++) {
      across += Math.abs(frames[i]!.x - frames[i - 1]!.x);
      const { y } = frames[i]!;
      if (dir >= 0 && y > extreme) {
        extreme = y;
        dir = 1;
      } else if (dir <= 0 && y < extreme) {
        extreme = y;
        dir = -1;
      }
      if (dir === 1 && extreme - y >= 4) {
        count += 1;
        dir = -1;
        extreme = y;
      } else if (dir === -1 && y - extreme >= 4) {
        count += 1;
        dir = 1;
        extreme = y;
      }
    }
    return (count / across) * 100;
  };

  for (const layout of LAYOUTS.filter((l) => l.hunts.includes("top"))) {
    it(`patrols a band too thin to circle in, in long gentle passes, on ${layout.name}`, () => {
      const band = searchGround(
        layout.viewport,
        layout.area,
        column(layout.field, layout.viewport),
        layout.perch,
      ).zones.find((zone) => zone.side === "top")!.rect;
      const size = flightSize(layout.viewport);
      for (const seed of MANY) {
        // The hunt alone: past the takeoff, and before the way home.
        const frames = fly(plan(layout, seed)).slice(90, -120);
        // Circling in a 40 px band turned nearly every step: about four
        // times per 100 px. A patrol rises and falls about once.
        expect(reversalsPer100(frames), `${seed}`).toBeLessThan(2);
        const xs = frames.map((f) => f.x);
        expect(
          (Math.max(...xs) - Math.min(...xs)) / (band.right - band.left),
          `${seed}`,
        ).toBeGreaterThan(0.7);
        for (const f of away(frames, layout.perch))
          expect(layout.field.top - f.y, `${seed}`).toBeGreaterThanOrEqual(
            0.4 * size,
          );
      }
    });
  }

  it("draws a different hunt for each seed: the sides in a different order", () => {
    const laptop = LAYOUTS[0]!;
    const orders = new Set<string>();
    let both = 0;
    for (const seed of MANY) {
      const parts = away(fly(plan(laptop, seed)), laptop.perch)
        .map((f) => partOf(f, laptop.field))
        .filter((part) => part !== "top");
      const order = parts.filter((part, i) => part !== parts[i - 1]);
      orders.add(order.join(" "));
      if (order.includes("left") && order.includes("right")) both += 1;
    }
    expect(orders.size).toBeGreaterThanOrEqual(4);
    // Many hunts cross over the top to the other side, and many stay.
    expect(both).toBeGreaterThanOrEqual(6);
    expect(both).toBeLessThan(MANY.length);
  });

  it("faces the way it flies round the column, nearly always", () => {
    let checked = 0;
    let wrong = 0;
    for (const layout of LAYOUTS) {
      for (const seed of SEEDS) {
        const frames = fly(plan(layout, seed));
        for (let i = 40; i < frames.length - 50; i++) {
          const a = frames[i - 1]!;
          const b = frames[i]!;
          const vx = b.x - a.x;
          const speed = Math.hypot(vx, b.y - a.y);
          if (speed < 1 || Math.abs(vx) < 0.6 * speed) continue;
          checked += 1;
          if (Math.sign(vx) !== Math.sign(b.pose.headFacing)) wrong += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(wrong / checked).toBeLessThan(0.06);
  });

  it("finds room on each layout, and none in a window with no margins", () => {
    for (const { viewport, area, field, perch } of LAYOUTS)
      expect(
        canHunt(searchGround(viewport, area, column(field, viewport), perch)),
      ).toBe(true);
    // The page is the column's width, and the box is at the very top.
    const cramped = { width: 400, height: 500 };
    expect(
      canHunt(
        searchGround(
          cramped,
          { left: 0, top: 0, right: 400, bottom: 500 },
          { left: 8, top: 4, right: 392, bottom: 500 },
          { left: 24, top: 24, size: 20 },
        ),
      ),
    ).toBe(false);
  });

  it("with no band over the column, hunts only the side the perch can reach", () => {
    const layout = {
      ...LAYOUTS[0]!,
      // Scrolled up: the search box's top is at the window's top.
      field: { left: 408, top: 8, right: 1096, bottom: 88 },
      perch: { left: 432, top: 38, size: 20 },
      hunts: ["left" as const],
    };
    const ground = searchGround(
      layout.viewport,
      layout.area,
      column(layout.field, layout.viewport),
      layout.perch,
    );
    expect(ground.zones.map((zone) => [zone.side, zone.hunts])).toEqual([
      ["left", true],
      ["right", false],
    ]);
    for (const seed of SEEDS) {
      for (const f of away(fly(plan(layout, seed)), layout.perch)) {
        expect(f.x).toBeLessThan(layout.field.left - 0.5 * flightSize(LAPTOP));
      }
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
