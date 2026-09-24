/**
 * The corvid's repertoire.
 *
 * Every act the bird plays on its perch is made fresh from a random source.
 * The promises measured here are the ones the rest of the app leans on:
 *
 * 1. Every act starts and ends at the logo. A bird that finished a preen a
 *    degree off would be a logo a degree off until the next act.
 * 2. No two are quite alike: timings, reaches and repeats vary with the
 *    seed, and one seed always gives the same act.
 * 3. Tracks add, proportions multiply, and a weight fades a whole motion.
 */
import { describe, expect, it } from "vitest";
import {
  HOME_POSE,
  POSE_KEYS,
  type CorvidPose,
} from "../../src/assets/corvidRig";
import {
  between,
  choreograph,
  count,
  createRng,
  easeInOut,
  easeOutBack,
  makeBlink,
  pickWeighted,
  sampleMotion,
  sampleTrack,
  type Motion,
  type MotionName,
} from "../../src/lib/corvidMotion";
import { makeCorvidMotion } from "../../src/lib/corvidBrain";

const FINITE: MotionName[] = [
  "blink",
  "glance",
  "cock",
  "lookBack",
  "preen",
  "ruffle",
  "stretch",
  "caw",
  "hop",
  "nod",
  "shake",
  "flutter",
  "startle",
];

const at = (motion: Motion, t: number): CorvidPose =>
  sampleMotion({ ...HOME_POSE }, motion, t);

const expectHome = (pose: CorvidPose, label: string) => {
  for (const key of POSE_KEYS)
    expect(pose[key], `${label}: ${key}`).toBeCloseTo(HOME_POSE[key], 9);
};

describe("the random source", () => {
  it("gives the same numbers from the same seed, and others from another", () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    for (const n of first) expect(n >= 0 && n < 1).toBe(true);
  });

  it("draws within its ranges, both ends of a count included", () => {
    const rng = createRng(1);
    const counts = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const x = between(rng, 3, 7);
      expect(x >= 3 && x < 7).toBe(true);
      counts.add(count(rng, 1, 3));
    }
    expect([...counts].sort()).toEqual([1, 2, 3]);
  });

  it("picks by weight, and never an item that weighs nothing", () => {
    const rng = createRng(5);
    const tally = { a: 0, b: 0, never: 0 };
    for (let i = 0; i < 2000; i++) {
      tally[
        pickWeighted(rng, [
          ["a", 3],
          ["b", 1],
          ["never", 0],
        ] as const)
      ] += 1;
    }
    expect(tally.never).toBe(0);
    expect(tally.a / tally.b).toBeGreaterThan(2.3);
    expect(tally.a / tally.b).toBeLessThan(3.8);
  });
});

describe("tracks", () => {
  it("holds before the first key and after the last, and eases between", () => {
    const keys = [
      { at: 100, value: 2 },
      { at: 300, value: 6, ease: easeInOut },
    ];
    expect(sampleTrack(keys, 0)).toBe(2);
    expect(sampleTrack(keys, 200)).toBeCloseTo(4, 9);
    expect(sampleTrack(keys, 999)).toBe(6);
    expect(sampleTrack([], 50)).toBe(0);
  });

  it("overshoots a little with the head's snap, and settles", () => {
    const peak = Math.max(
      ...Array.from({ length: 50 }, (_, i) => easeOutBack(i / 49)),
    );
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.12);
    expect(easeOutBack(1)).toBeCloseTo(1, 9);
  });

  it("adds to most fields and multiplies the proportions", () => {
    const motion: Motion = {
      name: "nod",
      duration: 100,
      tracks: choreograph([
        { at: 100, set: { headAngle: 10, eye: 0.5, headFacing: -1 } },
      ]),
    };
    const pose = sampleMotion(
      { ...HOME_POSE, headAngle: 5, eye: 0.8, headFacing: 1 },
      motion,
      100,
    );
    expect(pose.headAngle).toBe(15);
    expect(pose.eye).toBeCloseTo(0.4, 9);
    expect(pose.headFacing).toBe(-1);
  });

  it("fades a whole motion by its weight", () => {
    const motion: Motion = {
      name: "nod",
      duration: 100,
      tracks: choreograph([{ at: 100, set: { headAngle: 10, eye: 0 } }]),
    };
    const half = sampleMotion({ ...HOME_POSE }, motion, 100, 0.5);
    expect(half.headAngle).toBe(5);
    expect(half.eye).toBeCloseTo(0.5, 9);
  });
});

describe("every act", () => {
  it("starts and ends at the logo, whatever the seed", () => {
    for (const name of FINITE) {
      for (let seed = 1; seed <= 40; seed++) {
        const motion = makeCorvidMotion(name, createRng(seed));
        expect(Number.isFinite(motion.duration), name).toBe(true);
        expectHome(at(motion, 0), `${name} start`);
        expectHome(at(motion, motion.duration), `${name} end`);
        expectHome(at(motion, motion.duration + 5_000), `${name} after`);
      }
    }
  });

  it("moves in between: none of them is a still picture", () => {
    for (const name of FINITE) {
      const motion = makeCorvidMotion(name, createRng(3));
      const moved = Array.from({ length: 20 }, (_, i) =>
        at(motion, ((i + 1) / 21) * motion.duration),
      ).some((pose) =>
        POSE_KEYS.some((key) => Math.abs(pose[key] - HOME_POSE[key]) > 0.05),
      );
      expect(moved, name).toBe(true);
    }
  });

  it("is quick: nothing on the perch takes more than three and a half seconds", () => {
    for (const name of FINITE) {
      for (let seed = 1; seed <= 40; seed++) {
        expect(
          makeCorvidMotion(name, createRng(seed)).duration,
          name,
        ).toBeLessThan(3_500);
      }
    }
  });

  it("varies with the seed and repeats with it", () => {
    for (const name of [
      "glance",
      "preen",
      "caw",
      "ruffle",
      "stretch",
    ] as MotionName[]) {
      const lengths = new Set<number>();
      for (let seed = 1; seed <= 12; seed++)
        lengths.add(makeCorvidMotion(name, createRng(seed)).duration);
      expect(lengths.size, name).toBeGreaterThan(8);
      expect(makeCorvidMotion(name, createRng(9)).duration).toBe(
        makeCorvidMotion(name, createRng(9)).duration,
      );
    }
  });

  it("never touches the ring: every track is a field of the bird's pose", () => {
    for (const name of [...FINITE, "ready", "doze"] as MotionName[]) {
      const motion = makeCorvidMotion(name, createRng(2));
      for (const field of Object.keys(motion.tracks))
        expect(POSE_KEYS).toContain(field);
    }
  });
});

describe("blinks", () => {
  it("shut the eye most of the way and open it again", () => {
    const blink = makeBlink(createRng(8));
    const eyes = Array.from(
      { length: 60 },
      (_, i) => at(blink, (i / 59) * blink.duration).eye,
    );
    expect(Math.min(...eyes)).toBe(0);
    expect(eyes[eyes.length - 1]).toBe(1);
  });

  it("come in pairs about one time in five", () => {
    let doubles = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const blink = makeBlink(createRng(seed));
      const shuts = Array.from(
        { length: 200 },
        (_, i) => at(blink, (i / 199) * blink.duration).eye,
      );
      let closings = 0;
      for (let i = 1; i < shuts.length; i++)
        if (shuts[i]! < 0.2 && shuts[i - 1]! >= 0.2) closings += 1;
      if (closings === 2) doubles += 1;
    }
    expect(doubles / 400).toBeGreaterThan(0.12);
    expect(doubles / 400).toBeLessThan(0.28);
  });
});

describe("held postures", () => {
  it("hold for as long as they are asked to", () => {
    for (const name of ["ready", "doze"] as MotionName[]) {
      expect(makeCorvidMotion(name, createRng(1)).duration).toBe(Infinity);
    }
  });

  it("put the bird to sleep with its eye shut and its feathers up, breathing", () => {
    const doze = makeCorvidMotion("doze", createRng(1));
    const deep = at(doze, 10_000);
    expect(deep.eye).toBeLessThan(0.05);
    expect(deep.headY).toBeGreaterThan(1);
    const breaths = Array.from(
      { length: 40 },
      (_, i) => at(doze, 10_000 + i * 200).fluff,
    );
    expect(Math.max(...breaths) - Math.min(...breaths)).toBeGreaterThan(0.1);
  });
});
