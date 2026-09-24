/**
 * corvidMotion — how the corvid moves when it is not flying.
 *
 * A motion is a short piece of choreography: a few keyframed tracks on the
 * numbers in `CorvidPose`, with a length. `sampleMotion` plays one at a time
 * `t` on top of a pose. Motions are made fresh each time by a maker that
 * takes a random source, so no two blinks, preens or head turns are quite
 * the same length, reach or rhythm. That is most of what makes the bird look
 * alive rather than looped:
 *
 * - The head moves the way a bird's does, in quick turns with still holds
 *   between them, not in smooth sweeps.
 * - Timings are drawn from ranges, and some motions repeat a random number of
 *   times: two to four nibbles in a preen, one to three bobs in a caw.
 * - Nothing here keeps time or state. The brain (`corvidBrain.ts`) decides
 *   what to play and when; this file only says what each motion looks like.
 *
 * Tracks add to the pose, except the four fields that are proportions, which
 * multiply: the eye's openness, the two facings and the wing's turn. A blink
 * therefore closes whatever eye the bird has, and a head turn turns whatever
 * way the head was facing.
 *
 * @module lib/corvidMotion
 */
import type { CorvidPose } from "../assets/corvidRig";

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

/** A source of numbers in [0, 1). `Math.random` is one. */
export type Rng = () => number;

/**
 * A seeded source, for tests and for the reference renders: the same seed
 * gives the same bird. Mulberry32, which is small and good enough to choose
 * how long a blink lasts.
 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const between = (rng: Rng, low: number, high: number): number =>
  low + (high - low) * rng();

export const chance = (rng: Rng, p: number): boolean => rng() < p;

/** A whole number from `low` to `high`, both included. */
export const count = (rng: Rng, low: number, high: number): number =>
  Math.floor(between(rng, low, high + 1));

/** Either sign, evenly. */
export const sign = (rng: Rng): 1 | -1 => (rng() < 0.5 ? -1 : 1);

/** One of the items, in proportion to its weight. */
export function pickWeighted<T>(
  rng: Rng,
  items: readonly (readonly [T, number])[],
): T {
  const total = items.reduce((sum, [, weight]) => sum + Math.max(weight, 0), 0);
  let roll = rng() * total;
  for (const [item, weight] of items) {
    roll -= Math.max(weight, 0);
    if (roll < 0) return item;
  }
  return items[items.length - 1]![0];
}

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

export type Easing = (t: number) => number;

const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

export const easeInOut: Easing = (t) =>
  0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));
export const easeOut: Easing = (t) => Math.sin((Math.PI / 2) * clamp01(t));
export const easeIn: Easing = (t) => 1 - Math.cos((Math.PI / 2) * clamp01(t));
export const linear: Easing = (t) => clamp01(t);
/** Overshoots a little and settles: a head that snaps and stops. */
export const easeOutBack: Easing = (t) => {
  const x = clamp01(t) - 1;
  return 1 + 2.2 * x * x * x + 1.2 * x * x;
};

// ---------------------------------------------------------------------------
// Tracks and motions
// ---------------------------------------------------------------------------

/** One keyframe: the track reaches `value` at `at` ms, arriving by `ease`. */
export interface Key {
  at: number;
  value: number;
  ease?: Easing;
}

/** The fields a track multiplies rather than adds to. */
const PROPORTIONS = new Set<keyof CorvidPose>([
  "eye",
  "headFacing",
  "bodyFacing",
  "wingTurn",
]);

/** A track's value when it has no keys yet: nothing added, nothing scaled. */
const neutral = (field: keyof CorvidPose) => (PROPORTIONS.has(field) ? 1 : 0);

export type Tracks = Partial<Record<keyof CorvidPose, Key[]>>;

export interface Motion {
  name: MotionName;
  /** How long it lasts, in ms. `Infinity` for a posture that holds. */
  duration: number;
  tracks: Tracks;
}

/** The value of one track at `t`. Before the first key it is that key's. */
export function sampleTrack(keys: readonly Key[], t: number): number {
  if (keys.length === 0) return 0;
  if (t <= keys[0]!.at) return keys[0]!.value;
  for (let i = 1; i < keys.length; i++) {
    const key = keys[i]!;
    if (t <= key.at) {
      const previous = keys[i - 1]!;
      const span = key.at - previous.at;
      const k =
        span <= 0 ? 1 : (key.ease ?? easeInOut)((t - previous.at) / span);
      return previous.value + (key.value - previous.value) * k;
    }
  }
  return keys[keys.length - 1]!.value;
}

/**
 * Play `motion` at `t` ms on top of `pose`. `weight` fades the whole motion
 * in or out, which is how a held posture such as dozing eases away.
 */
export function sampleMotion(
  pose: CorvidPose,
  motion: Motion,
  t: number,
  weight = 1,
): CorvidPose {
  const out = { ...pose };
  const apply = (field: keyof CorvidPose, value: number) => {
    if (PROPORTIONS.has(field)) out[field] *= 1 + (value - 1) * weight;
    else out[field] += value * weight;
  };
  for (const field of Object.keys(motion.tracks) as (keyof CorvidPose)[]) {
    apply(field, sampleTrack(motion.tracks[field]!, t));
  }
  return out;
}

/**
 * Tracks written as a list of moments, each setting some fields. A field
 * holds its last value until a later moment changes it, so a choreography
 * reads like the stage directions it is.
 */
export function choreograph(
  moments: readonly { at: number; ease?: Easing; set: Partial<CorvidPose> }[],
): Tracks {
  const tracks: Tracks = {};
  const fields = new Set<keyof CorvidPose>();
  for (const moment of moments) {
    for (const field of Object.keys(moment.set) as (keyof CorvidPose)[])
      fields.add(field);
  }
  for (const field of fields) {
    const keys: Key[] = [{ at: 0, value: neutral(field) }];
    for (const moment of moments) {
      const value = moment.set[field];
      if (value === undefined) continue;
      keys.push({ at: moment.at, value, ease: moment.ease });
    }
    tracks[field] = keys;
  }
  return tracks;
}

/** The longest track's last key. */
const lastKey = (tracks: Tracks) =>
  Math.max(
    0,
    ...Object.values(tracks).map((keys) => keys![keys!.length - 1]!.at),
  );

const motion = (
  name: MotionName,
  tracks: Tracks,
  duration = lastKey(tracks),
): Motion => ({
  name,
  duration,
  tracks,
});

// ---------------------------------------------------------------------------
// The repertoire
// ---------------------------------------------------------------------------

export type MotionName =
  | "blink"
  | "glance"
  | "cock"
  | "lookBack"
  | "preen"
  | "ruffle"
  | "stretch"
  | "caw"
  | "hop"
  | "nod"
  | "shake"
  | "flutter"
  | "startle"
  | "ready"
  | "doze";

/** A blink: shut in a third of it, and one in five is two blinks. */
export function makeBlink(rng: Rng, slow = false): Motion {
  const close = slow ? between(rng, 180, 260) : between(rng, 45, 70);
  const hold = slow ? between(rng, 120, 220) : between(rng, 20, 45);
  const open = slow ? between(rng, 220, 320) : between(rng, 60, 90);
  const moments: { at: number; ease?: Easing; set: Partial<CorvidPose> }[] = [
    { at: close, set: { eye: 0 } },
    { at: close + hold, set: { eye: 0 } },
    { at: close + hold + open, set: { eye: 1 } },
  ];
  if (!slow && chance(rng, 0.2)) {
    const gap = between(rng, 90, 160);
    const start = close + hold + open + gap;
    moments.push(
      { at: start, set: { eye: 1 } },
      { at: start + close, set: { eye: 0 } },
      { at: start + close + hold, set: { eye: 0 } },
      { at: start + close + hold + open, set: { eye: 1 } },
    );
  }
  return motion("blink", choreograph(moments));
}

/**
 * A look about: one to three quick head turns, each held still. A bird's
 * head moves in snaps and holds. Smooth sweeps read as a machine.
 */
export function makeGlance(rng: Rng): Motion {
  const moments: { at: number; ease?: Easing; set: Partial<CorvidPose> }[] = [];
  let at = 0;
  for (let i = count(rng, 1, 3); i > 0; i--) {
    at += between(rng, 70, 110);
    moments.push({
      at,
      ease: easeOutBack,
      set: { headAngle: between(rng, -9, 13), headX: between(rng, -0.8, 0.8) },
    });
    at += between(rng, 350, 850);
    moments.push({ at, set: {} });
  }
  at += between(rng, 80, 120);
  moments.push({ at, ease: easeOutBack, set: { headAngle: 0, headX: 0 } });
  return motion("glance", choreograph(moments), at);
}

/** A curious cock of the head, sometimes answered the other way. */
export function makeCock(rng: Rng): Motion {
  const side = sign(rng);
  let at = between(rng, 90, 140);
  const moments: { at: number; ease?: Easing; set: Partial<CorvidPose> }[] = [
    {
      at,
      ease: easeOutBack,
      set: { headAngle: side * between(rng, 9, 16), headY: -0.6 },
    },
  ];
  at += between(rng, 600, 1300);
  moments.push({ at, set: {} });
  if (chance(rng, 0.45)) {
    at += between(rng, 110, 150);
    moments.push({
      at,
      ease: easeOutBack,
      set: { headAngle: -side * between(rng, 5, 10) },
    });
    at += between(rng, 380, 800);
    moments.push({ at, set: {} });
  }
  at += between(rng, 120, 170);
  moments.push({ at, ease: easeInOut, set: { headAngle: 0, headY: 0 } });
  return motion("cock", choreograph(moments), at);
}

/** It looks the other way for a moment, the head turning on its own. */
export function makeLookBack(rng: Rng): Motion {
  const turn = between(rng, 80, 110);
  const hold = between(rng, 700, 1900);
  const tilt = between(rng, -6, 8);
  const moments = [
    { at: turn, set: { headFacing: -1, headAngle: tilt } },
    { at: turn + hold * 0.5, set: {} },
    {
      at: turn + hold * 0.5 + 90,
      ease: easeOutBack,
      set: { headAngle: tilt + between(rng, -6, 6) },
    },
    { at: turn + hold, set: {} },
    { at: turn * 2 + hold, set: { headFacing: 1, headAngle: 0 } },
  ];
  return motion("lookBack", choreograph(moments));
}

/**
 * Preening: the head goes down into the wing, nibbles two to four times with
 * the eye half shut, and comes back up. The wing lifts a little to meet it.
 */
export function makePreen(rng: Rng): Motion {
  const reach = between(rng, 260, 340);
  const down = {
    headAngle: -between(rng, 56, 66),
    headX: between(rng, 7, 10),
    headY: between(rng, 9, 12),
    wingAngle: -between(rng, 4, 8),
    eye: 0.55,
  };
  const moments: { at: number; ease?: Easing; set: Partial<CorvidPose> }[] = [
    { at: reach, set: down },
  ];
  let at = reach;
  for (let i = count(rng, 2, 4); i > 0; i--) {
    at += between(rng, 60, 80);
    moments.push({
      at,
      ease: easeOut,
      set: {
        headAngle: down.headAngle + between(rng, 4, 7),
        headY: down.headY - between(rng, 1, 2),
      },
    });
    at += between(rng, 60, 90);
    moments.push({
      at,
      ease: easeIn,
      set: { headAngle: down.headAngle, headY: down.headY },
    });
    at += between(rng, 40, 160);
    moments.push({ at, set: {} });
  }
  at += between(rng, 260, 340);
  moments.push({
    at,
    set: { headAngle: 0, headX: 0, headY: 0, wingAngle: 0, eye: 1 },
  });
  return motion("preen", choreograph(moments));
}

/** A shake of the feathers: puff up, a fast shiver, settle. */
export function makeRuffle(rng: Rng): Motion {
  const up = between(rng, 100, 140);
  const shiver = between(rng, 220, 320);
  const hz = between(rng, 13, 17);
  const moments: { at: number; ease?: Easing; set: Partial<CorvidPose> }[] = [
    { at: up, ease: easeOut, set: { fluff: 1, crouch: -0.25 } },
  ];
  const steps = Math.round((shiver / 1000) * hz * 2);
  for (let i = 1; i <= steps; i++) {
    const fade = 1 - i / (steps + 1);
    const s = i % 2 === 0 ? 1 : -1;
    moments.push({
      at: up + (shiver * i) / steps,
      ease: easeInOut,
      set: {
        headAngle: s * 7 * fade,
        x: s * 0.7 * fade,
        wingAngle: -s * 3 * fade,
        tailAngle: s * 5 * fade,
      },
    });
  }
  const end = up + shiver + between(rng, 220, 300);
  moments.push({
    at: end,
    set: {
      fluff: 0,
      crouch: 0,
      headAngle: 0,
      x: 0,
      wingAngle: 0,
      tailAngle: 0,
    },
  });
  return motion("ruffle", choreograph(moments));
}

/** The wing stretched down and back, the bird stood tall, then folded. */
export function makeStretch(rng: Rng): Motion {
  const out = between(rng, 320, 420);
  const hold = between(rng, 420, 820);
  const moments = [
    {
      at: out,
      set: {
        wingAngle: between(rng, 16, 22),
        wingSpread: between(rng, 0.45, 0.6),
        tailAngle: -between(rng, 4, 7),
        headAngle: between(rng, 4, 8),
        crouch: -0.35,
      },
    },
    { at: out + hold, set: {} },
    {
      at: out + hold + between(rng, 300, 380),
      set: {
        wingAngle: 0,
        wingSpread: 0,
        tailAngle: 0,
        headAngle: 0,
        crouch: 0,
      },
    },
  ];
  return motion("stretch", choreograph(moments));
}

/**
 * A caw with no sound: one to three bows, the beak opening at the bottom of
 * each, the tail flicking up. The page stays quiet. The bird does not.
 */
export function makeCaw(rng: Rng): Motion {
  const moments: { at: number; ease?: Easing; set: Partial<CorvidPose> }[] = [];
  let at = 0;
  for (let i = count(rng, 1, 3); i > 0; i--) {
    at += between(rng, 120, 150);
    moments.push({
      at,
      ease: easeOut,
      set: {
        headAngle: -between(rng, 8, 12),
        headX: -1.8,
        beak: 1,
        crouch: 0.45,
        tailAngle: -5,
        fluff: 0.35,
      },
    });
    at += between(rng, 150, 190);
    moments.push({
      at,
      ease: easeInOut,
      set: { headAngle: 2, headX: 0, beak: 0, crouch: 0, tailAngle: 0 },
    });
    at += between(rng, 60, 180);
    moments.push({ at, set: {} });
  }
  at += 140;
  moments.push({ at, set: { headAngle: 0, fluff: 0 } });
  return motion("caw", choreograph(moments));
}

/** One small hop on the spot, squashing into it and out of it. */
export function makeHop(rng: Rng, height = between(rng, 3, 4.5)): Motion {
  const moments = [
    { at: 80, ease: easeOut, set: { crouch: 0.7 } },
    { at: 200, ease: easeOut, set: { crouch: -0.4, y: -height, headAngle: 4 } },
    { at: 310, ease: easeIn, set: { crouch: 0.55, y: 0, headAngle: -2 } },
    { at: 430, ease: easeInOut, set: { crouch: 0, headAngle: 0 } },
  ];
  return motion("hop", choreograph(moments));
}

/** Yes: a quick dip of the head and back. */
export function makeNod(rng: Rng): Motion {
  const dip = between(rng, 8, 11);
  return motion(
    "nod",
    choreograph([
      { at: 100, ease: easeOut, set: { headAngle: -dip, headY: 0.8 } },
      { at: 230, ease: easeOutBack, set: { headAngle: 2, headY: 0 } },
      { at: 360, set: { headAngle: 0 } },
    ]),
  );
}

/**
 * No: the head turns away and back, twice, fast. Seen side on, a head shake
 * is the head turning, so that is what the bird does.
 */
export function makeShake(): Motion {
  return motion(
    "shake",
    choreograph([
      { at: 60, set: { headFacing: -1, headAngle: -3 } },
      { at: 130, set: { headFacing: 1, headAngle: 0 } },
      { at: 200, set: { headFacing: -1, headAngle: -3 } },
      { at: 280, set: { headFacing: 1, headAngle: 0 } },
    ]),
  );
}

/**
 * Wings open and a few beats on the spot, without leaving: the subtle
 * level's answer to a click, and its celebration.
 */
export function makeFlutter(rng: Rng): Motion {
  const beats = count(rng, 3, 5);
  const beat = between(rng, 120, 150);
  const moments: { at: number; ease?: Easing; set: Partial<CorvidPose> }[] = [
    { at: 90, ease: easeOut, set: { crouch: 0.5 } },
    {
      at: 200,
      ease: easeOut,
      set: {
        crouch: -0.3,
        y: -3,
        wingSpread: 0.7,
        wingAngle: -40,
        headAngle: 6,
      },
    },
  ];
  let at = 200;
  for (let i = 0; i < beats; i++) {
    at += beat / 2;
    moments.push({ at, set: { wingAngle: -8 } });
    at += beat / 2;
    moments.push({ at, set: { wingAngle: -48 } });
  }
  at += 180;
  moments.push({
    at,
    ease: easeIn,
    set: { y: 0, crouch: 0.4, wingAngle: -10, wingSpread: 0.3 },
  });
  at += 220;
  moments.push({
    at,
    set: { crouch: 0, wingAngle: 0, wingSpread: 0, headAngle: 0 },
  });
  return motion("flutter", choreograph(moments));
}

/** Woken: the eye opens wide, the head comes up, the feathers flick. */
export function makeStartle(rng: Rng): Motion {
  return motion(
    "startle",
    choreograph([
      {
        at: 90,
        ease: easeOut,
        set: {
          headAngle: between(rng, 8, 12),
          y: -1.4,
          fluff: 0.8,
          crouch: -0.3,
        },
      },
      { at: 260, set: { y: 0 } },
      { at: 520, set: { headAngle: 0, fluff: 0, crouch: 0 } },
    ]),
  );
}

/**
 * Hovered, or focused: it gets ready to go, weight down and head up. Held
 * for as long as the pointer stays; the brain fades it in and out.
 */
export function makeReady(): Motion {
  return {
    name: "ready",
    duration: Infinity,
    tracks: {
      crouch: [{ at: 0, value: 0.45 }],
      headAngle: [{ at: 0, value: 7 }],
      wingAngle: [{ at: 0, value: -4 }],
      wingSpread: [{ at: 0, value: 0.06 }],
    },
  };
}

/**
 * Asleep: the eye shut, the head sunk, the feathers up. Held until something
 * wakes it. It does not breathe: at the size the mark is drawn a breath is
 * a fifth of a pixel, and a frame every few seconds for motion nobody can
 * see is a cost with nothing to show for it.
 */
export function makeDoze(): Motion {
  return {
    name: "doze",
    duration: Infinity,
    tracks: {
      eye: [
        { at: 0, value: 1 },
        { at: 600, value: 0.45 },
        { at: 1400, value: 0.45 },
        { at: 2200, value: 0 },
      ],
      headAngle: [
        { at: 0, value: 0 },
        { at: 2400, value: -7 },
      ],
      headY: [
        { at: 0, value: 0 },
        { at: 2400, value: 2.2 },
      ],
      fluff: [
        { at: 0, value: 0 },
        { at: 2400, value: 0.55 },
      ],
    },
  };
}
