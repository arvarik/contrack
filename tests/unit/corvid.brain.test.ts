/**
 * The perched corvid's brain.
 *
 * The brain keeps no timers, so a test can live ten minutes of a bird's day
 * in a few milliseconds: a seeded random source, a clock the test moves, and
 * `sample` called every frame. What it has to get right is when, not what:
 *
 * - blinks on their own clock, small acts often, big acts rarely, and the
 *   same big act never twice in a row;
 * - nothing big while the person is typing;
 * - asleep after two and a half quiet minutes, awake with a start;
 * - ready while hovered; watching the pointer when it comes near;
 * - a reaction the app asks for plays at once;
 * - no frames wanted while nothing moves.
 */
import { describe, expect, it } from "vitest";
import {
  BIG_EVERY,
  BLINK_EVERY,
  CorvidBrain,
  DOZE_AFTER,
  QUIET_FOR,
  WATCH_RADIUS,
} from "../../src/lib/corvidBrain";
import { createRng, type MotionName } from "../../src/lib/corvidMotion";
import { HOME_POSE, type CorvidPose } from "../../src/assets/corvidRig";

const FRAME = 1000 / 60;
const BIG = new Set<MotionName>(["preen", "ruffle", "stretch", "caw", "hop"]);

interface Run {
  poses: { t: number; pose: CorvidPose; playing: MotionName | null }[];
}

/** Live `ms` of the bird's life from `start`, calling `each` before every frame. */
function live(
  brain: CorvidBrain,
  start: number,
  ms: number,
  each?: (t: number) => void,
  step = FRAME,
): Run {
  const poses: Run["poses"] = [];
  for (let t = start; t <= start + ms; t += step) {
    each?.(t);
    poses.push({ t, pose: brain.sample(t), playing: brain.playing });
  }
  return { poses };
}

/** Each act's name and the moment it started. */
function acts(run: Run) {
  const out: { name: MotionName; at: number }[] = [];
  let last: MotionName | null = null;
  for (const { t, playing } of run.poses) {
    if (playing && playing !== last) out.push({ name: playing, at: t });
    last = playing;
  }
  return out;
}

/** Keep a person at the screen: a click a minute, so nobody dozes off. */
const present = (brain: CorvidBrain) => {
  let next = 60_000;
  return (t: number) => {
    if (t >= next) {
      brain.send({ type: "input" }, t);
      next += 60_000;
    }
  };
};

describe("blinks", () => {
  it("come every three to seven seconds, on their own clock", () => {
    const brain = new CorvidBrain({ rng: createRng(3), now: 0 });
    const run = live(brain, 0, 120_000, present(brain));
    const closings: number[] = [];
    let open = true;
    for (const { t, pose } of run.poses) {
      if (open && pose.eye < 0.3) closings.push(t);
      open = pose.eye >= 0.3;
    }
    // A second closing within half a second is the pair of a double blink.
    const starts = closings.filter(
      (t, i) => i === 0 || t - closings[i - 1]! > 500,
    );
    expect(starts.length).toBeGreaterThan(15);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i]! - starts[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(BLINK_EVERY[0]);
      expect(gap).toBeLessThanOrEqual(BLINK_EVERY[1] + 800);
    }
  });
});

describe("acts", () => {
  it("plays small acts often and big ones rarely, never the same big one twice running", () => {
    const brain = new CorvidBrain({ rng: createRng(11), now: 0 });
    const run = live(brain, 0, 600_000, present(brain));
    const all = acts(run);
    const big = all.filter((a) => BIG.has(a.name));
    const small = all.filter((a) => !BIG.has(a.name));
    expect(small.length).toBeGreaterThan(big.length);
    expect(big.length).toBeGreaterThan(600_000 / BIG_EVERY[1] - 2);
    expect(big.length).toBeLessThan(600_000 / BIG_EVERY[0] + 2);
    for (let i = 1; i < big.length; i++)
      expect(big[i]!.name).not.toBe(big[i - 1]!.name);
    expect(new Set(big.map((a) => a.name)).size).toBeGreaterThanOrEqual(4);
  });

  it("waits with anything big while the person is typing", () => {
    const brain = new CorvidBrain({ rng: createRng(5), now: 0 });
    let nextKey = 0;
    const run = live(brain, 0, 180_000, (t) => {
      if (t >= nextKey) {
        brain.send({ type: "typing" }, t);
        nextKey = t + QUIET_FOR / 3;
      }
    });
    expect(acts(run).filter((a) => BIG.has(a.name))).toEqual([]);
  });

  it("does nothing big at all when it is calm", () => {
    const brain = new CorvidBrain({
      rng: createRng(9),
      now: 0,
      temperament: "calm",
    });
    const run = live(brain, 0, 600_000, present(brain));
    expect(acts(run).filter((a) => BIG.has(a.name))).toEqual([]);
    expect(acts(run).length).toBeGreaterThan(20);
  });

  it("comes back to the logo between acts", () => {
    const brain = new CorvidBrain({ rng: createRng(2), now: 0 });
    const run = live(brain, 0, 90_000, present(brain));
    const resting = run.poses.filter((p) => !p.playing && p.pose.eye === 1);
    expect(resting.length).toBeGreaterThan(1000);
    for (const { pose } of resting.slice(0, 200))
      expect(pose).toEqual(HOME_POSE);
  });
});

describe("sleep", () => {
  it("dozes off after two and a half quiet minutes, and wakes with a start", () => {
    const brain = new CorvidBrain({ rng: createRng(4), now: 0 });
    live(brain, 0, DOZE_AFTER + 5_000, undefined, 50);
    expect(brain.dozing).toBe(true);
    const asleep = brain.sample(DOZE_AFTER + 8_000);
    expect(asleep.eye).toBeLessThan(0.1);

    brain.send({ type: "input" }, DOZE_AFTER + 8_000);
    expect(brain.dozing).toBe(false);
    expect(brain.playing).toBe("startle");
  });

  it("stays awake while a pointer moves, and never dozes when told not to", () => {
    const watched = new CorvidBrain({ rng: createRng(4), now: 0 });
    live(
      watched,
      0,
      DOZE_AFTER * 2,
      (t) => watched.send({ type: "pointer", dx: 900, dy: 400 }, t),
      500,
    );
    expect(watched.dozing).toBe(false);

    const preview = new CorvidBrain({
      rng: createRng(4),
      now: 0,
      dozes: false,
    });
    live(preview, 0, DOZE_AFTER * 2, undefined, 500);
    expect(preview.dozing).toBe(false);
  });

  it("is asleep when a long hidden hour ends, and does not replay the hour", () => {
    const brain = new CorvidBrain({ rng: createRng(6), now: 0 });
    brain.sample(0);
    brain.sample(3_600_000);
    expect(brain.dozing).toBe(true);
    expect(brain.playing).toBeNull();
  });
});

describe("the perch hovered", () => {
  it("gets ready while hovered and settles when the pointer leaves", () => {
    const brain = new CorvidBrain({ rng: createRng(8), now: 0 });
    brain.send({ type: "hover", on: true }, 1_000);
    expect(brain.sample(1_500).crouch).toBeCloseTo(0.45, 2);
    expect(brain.sample(1_500).headAngle).toBeGreaterThan(5);
    brain.send({ type: "hover", on: false }, 2_000);
    const settled = brain.sample(2_600);
    expect(settled.crouch).toBeCloseTo(0, 6);
  });
});

describe("the pointer", () => {
  it("is watched when it comes near: the head turns up or round toward it", () => {
    const brain = new CorvidBrain({ rng: createRng(1), now: 0 });
    brain.send({ type: "pointer", dx: 120, dy: -120 }, 1_000);
    // The turn starts on the next frame drawn, and is quick.
    brain.sample(1_000);
    const up = brain.sample(1_200);
    expect(up.headAngle).toBeGreaterThan(5);
    expect(up.headFacing).toBe(1);

    brain.send({ type: "pointer", dx: -150, dy: 10 }, 2_000);
    brain.sample(2_000);
    const behind = brain.sample(2_300);
    expect(behind.headFacing).toBeLessThan(0);
  });

  it("is let go beyond reach", () => {
    const brain = new CorvidBrain({ rng: createRng(1), now: 0 });
    brain.send({ type: "pointer", dx: WATCH_RADIUS + 50, dy: -40 }, 1_000);
    const pose = brain.sample(1_300);
    expect(pose.headAngle).toBe(0);
    expect(pose.headFacing).toBe(1);
  });
});

describe("what the app asks for", () => {
  it("plays a reaction at once, over whatever was playing", () => {
    const brain = new CorvidBrain({ rng: createRng(12), now: 0 });
    brain.send({ type: "react", reaction: "preen" }, 100);
    expect(brain.playing).toBe("preen");
    brain.send({ type: "react", reaction: "nod" }, 300);
    expect(brain.playing).toBe("nod");
  });

  it("answers a stir with a big act when the page is quiet, and not while typing", () => {
    const quiet = new CorvidBrain({ rng: createRng(12), now: 0 });
    quiet.send({ type: "stir" }, 10_000);
    expect(BIG.has(quiet.playing!)).toBe(true);

    const busy = new CorvidBrain({ rng: createRng(12), now: 0 });
    busy.send({ type: "typing" }, 9_500);
    busy.send({ type: "stir" }, 10_000);
    expect(busy.playing).toBeNull();
  });
});

describe("frames", () => {
  it("wants every frame while something moves and none while it waits", () => {
    const brain = new CorvidBrain({ rng: createRng(12), now: 0 });
    brain.sample(0);
    const waiting = brain.nextChange(0);
    expect(waiting).toBeGreaterThan(1_000);
    brain.send({ type: "react", reaction: "hop" }, 10);
    brain.sample(20);
    expect(brain.nextChange(20)).toBe(0);
    // The hop is over well before the first blink is due.
    brain.sample(600);
    const next = brain.nextChange(600);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThanOrEqual(BLINK_EVERY[1]);
  });

  it("asks for a slow frame now and then while asleep, for its breathing", () => {
    const brain = new CorvidBrain({ rng: createRng(4), now: 0 });
    live(brain, 0, DOZE_AFTER + 5_000, undefined, 50);
    expect(brain.nextChange(DOZE_AFTER + 5_000)).toBe(90);
  });
});
