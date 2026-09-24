/**
 * corvidBrain — what a perched corvid does next, and when.
 *
 * The motions in `corvidMotion.ts` say what a preen or a blink looks like.
 * This decides which one plays: a small state machine with a clock, a random
 * source and a few inputs. It keeps no timers of its own. The component that
 * owns the bird asks `sample(now)` for a pose on each frame it draws, and
 * `nextChange(now)` for how long it may sleep between frames. A sitting bird
 * that is only waiting for its next blink asks for no frames at all.
 *
 * What it plays, in three layers:
 *
 * 1. **Blinks**, on their own clock, every three to seven seconds, one in
 *    five doubled. They never wait for anything else.
 * 2. **One act at a time.** Small acts, a look about or a cock of the head,
 *    come every six to fourteen seconds. Big ones, a preen, a feather shake,
 *    a wing stretch, a silent caw or a hop, every twenty to fifty. A big act
 *    waits while the person is typing or clicking, because a bird that
 *    preens while you type is a bird you stop wanting on the screen. The
 *    same big act never plays twice in a row.
 * 3. **Held postures**, faded in and out: ready while the perch is hovered or
 *    focused, asleep after two and a half minutes with no input at all.
 *    Any input wakes it, with a start.
 *
 * And one continuous thing: when the pointer comes near, the head follows it,
 * in the quick turns and still holds a bird's head moves in.
 *
 * Everything that happens to the bird from outside arrives through `send`:
 * a hover, the pointer, a key, or a reaction the app asked for, such as the
 * nod when a follow-up is done. `sample` then answers with the pose.
 *
 * @module lib/corvidBrain
 */
import { HOME_POSE, type CorvidPose } from "../assets/corvidRig";
import {
  between,
  easeInOut,
  easeOutBack,
  makeBlink,
  makeCaw,
  makeCock,
  makeDoze,
  makeFlutter,
  makeGlance,
  makeHop,
  makeLookBack,
  makeNod,
  makePreen,
  makeReady,
  makeRuffle,
  makeShake,
  makeStartle,
  makeStretch,
  pickWeighted,
  sampleMotion,
  type Motion,
  type MotionName,
  type Rng,
} from "./corvidMotion";

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

/** Between blinks, in ms. */
export const BLINK_EVERY: readonly [number, number] = [2_800, 7_200];
/** Between small acts: a look about, a cock of the head, a look back. */
export const SMALL_EVERY: readonly [number, number] = [6_000, 14_000];
/** Between big acts: a preen, a shake, a stretch, a caw, a hop. */
export const BIG_EVERY: readonly [number, number] = [20_000, 50_000];
/** A big act waits this long after the last key or click. */
export const QUIET_FOR = 2_500;
/** No input for this long and the bird falls asleep. */
export const DOZE_AFTER = 150_000;
/** The pointer has to come this close, in px, before the bird watches it. */
export const WATCH_RADIUS = 260;

/** The acts a bird picks from by itself, and how often each is picked. */
const SMALL_ACTS: readonly (readonly [MotionName, number])[] = [
  ["glance", 5],
  ["cock", 3],
  ["lookBack", 2],
];
const BIG_ACTS: readonly (readonly [MotionName, number])[] = [
  ["preen", 3],
  ["ruffle", 2.5],
  ["stretch", 2],
  ["caw", 1.5],
  ["hop", 1],
];

/** What a reaction may ask for. */
export type CorvidReaction =
  | "nod"
  | "hop"
  | "ruffle"
  | "cock"
  | "glance"
  | "lookBack"
  | "shake"
  | "flutter"
  | "caw"
  | "preen"
  | "stretch"
  | "startle";

/** A fresh motion by name, with its own random timing. */
export function makeCorvidMotion(name: MotionName, rng: Rng): Motion {
  switch (name) {
    case "blink":
      return makeBlink(rng);
    case "glance":
      return makeGlance(rng);
    case "cock":
      return makeCock(rng);
    case "lookBack":
      return makeLookBack(rng);
    case "preen":
      return makePreen(rng);
    case "ruffle":
      return makeRuffle(rng);
    case "stretch":
      return makeStretch(rng);
    case "caw":
      return makeCaw(rng);
    case "hop":
      return makeHop(rng);
    case "nod":
      return makeNod(rng);
    case "shake":
      return makeShake();
    case "flutter":
      return makeFlutter(rng);
    case "startle":
      return makeStartle(rng);
    case "ready":
      return makeReady();
    case "doze":
      return makeDoze(rng);
  }
}

// ---------------------------------------------------------------------------
// The brain
// ---------------------------------------------------------------------------

export interface CorvidBrainOptions {
  rng: Rng;
  /** The clock the brain starts at, in ms. */
  now: number;
  /**
   * "lively" picks big acts by itself. "calm" only blinks and looks about,
   * for a bird that is an illustration and should not steal the eye.
   */
  temperament?: "lively" | "calm";
  /** More than 1 is busier: the Appearance preview plays at 4. */
  tempo?: number;
  /** Whether the bird may fall asleep. The preview never does. */
  dozes?: boolean;
}

export type CorvidBrainEvent =
  /** The perch is hovered or focused, or stops being. */
  | { type: "hover"; on: boolean }
  /** Where the pointer is from the bird's centre, in px. */
  | { type: "pointer"; dx: number; dy: number }
  /** The pointer left the window, or the bird should stop watching it. */
  | { type: "pointerGone" }
  /** Any input: a click, a scroll, a touch. Wakes the bird. */
  | { type: "input" }
  /** A key pressed. A big act waits until the typing stops. */
  | { type: "typing" }
  /** Play this now, whatever the bird was doing. */
  | { type: "react"; reaction: CorvidReaction }
  /** Something happened in the app: play a big act if the page is quiet. */
  | { type: "stir" };

interface Playing {
  motion: Motion;
  start: number;
}

interface Held {
  motion: Motion;
  start: number;
  /** How much of it shows, 0 to 1, and where that is heading. */
  weight: number;
  target: 0 | 1;
}

/** One head turn toward the pointer: from where it was to where it looks. */
interface Look {
  from: { angle: number; facing: number };
  to: { angle: number; facing: number };
  start: number;
  duration: number;
}

const HOLD_FADE_MS: Record<"ready" | "doze", { in: number; out: number }> = {
  ready: { in: 160, out: 240 },
  doze: { in: 1_400, out: 260 },
};

export class CorvidBrain {
  private readonly rng: Rng;
  private readonly tempo: number;
  private readonly temperament: "lively" | "calm";
  private readonly dozes: boolean;

  private act: Playing | null = null;
  private blink: Playing | null = null;
  private held: Partial<Record<"ready" | "doze", Held>> = {};
  private look: Look | null = null;
  private lookTarget: { angle: number; facing: number } | null = null;

  private nextBlinkAt: number;
  private nextSmallAt: number;
  private nextBigAt: number;
  private nextLookAt = 0;
  private lastInputAt: number;
  private lastTypingAt = -Infinity;
  private lastBig: MotionName | null = null;
  private lastSample: number;

  constructor({
    rng,
    now,
    temperament = "lively",
    tempo = 1,
    dozes = true,
  }: CorvidBrainOptions) {
    this.rng = rng;
    this.tempo = tempo;
    this.temperament = temperament;
    this.dozes = dozes;
    this.lastInputAt = now;
    this.lastSample = now;
    this.nextBlinkAt = now + this.wait(BLINK_EVERY) * 0.6;
    this.nextSmallAt = now + this.wait(SMALL_EVERY);
    // Nothing big in the first stretch after the bird appears.
    this.nextBigAt = now + 12_000 / tempo + this.wait(BIG_EVERY) * 0.5;
  }

  private wait([low, high]: readonly [number, number]): number {
    return between(this.rng, low, high) / this.tempo;
  }

  /** Whether the bird is asleep, or falling asleep. */
  get dozing(): boolean {
    return this.held.doze?.target === 1;
  }

  /** The act playing now, for tests and for the reference renders. */
  get playing(): MotionName | null {
    return this.act?.motion.name ?? null;
  }

  send(event: CorvidBrainEvent, now: number): void {
    switch (event.type) {
      case "hover":
        if (event.on) this.wake(now);
        this.hold("ready", event.on ? 1 : 0, now);
        return;
      case "pointer": {
        // A moving pointer is a person at the screen: it keeps the bird
        // awake, and wakes it if it had nodded off.
        this.input(now);
        const distance = Math.hypot(event.dx, event.dy);
        if (distance > WATCH_RADIUS) {
          this.lookTarget = null;
          return;
        }
        // The head turns toward the pointer: up or down by where it is, and
        // round to the other side when it is well behind the beak.
        const facing = event.dx < -24 ? -1 : 1;
        const angle = Math.max(
          -16,
          Math.min(
            20,
            (Math.atan2(-event.dy, Math.abs(event.dx) + 24) * 180) / Math.PI,
          ),
        );
        this.lookTarget = { angle, facing };
        return;
      }
      case "pointerGone":
        this.lookTarget = null;
        return;
      case "typing":
        this.lastTypingAt = now;
        this.input(now);
        return;
      case "input":
        this.input(now);
        return;
      case "react":
        this.wake(now, false);
        this.start(event.reaction, now);
        return;
      case "stir":
        if (this.dozing || this.act) return;
        if (now - this.lastTypingAt < QUIET_FOR) return;
        this.startBig(now);
        return;
    }
  }

  private input(now: number) {
    this.lastInputAt = now;
    this.wake(now);
  }

  /** Out of a doze, with a start unless the caller has its own motion. */
  private wake(now: number, startle = true) {
    if (!this.dozing) return;
    this.hold("doze", 0, now);
    if (startle) this.start("startle", now);
  }

  private hold(name: "ready" | "doze", target: 0 | 1, now: number) {
    const current = this.held[name];
    if (current) {
      current.weight = this.heldWeight(name, current, now);
      current.start = now;
      current.target = target;
      return;
    }
    if (target === 0) return;
    this.held[name] = {
      motion: makeCorvidMotion(name, this.rng),
      start: now,
      weight: 0,
      target,
    };
  }

  private heldWeight(name: "ready" | "doze", held: Held, now: number): number {
    const fade = HOLD_FADE_MS[name][held.target === 1 ? "in" : "out"];
    const moved = (now - held.start) / fade;
    return held.target === 1
      ? Math.min(1, held.weight + moved)
      : Math.max(0, held.weight - moved);
  }

  private start(name: MotionName, now: number) {
    this.act = { motion: makeCorvidMotion(name, this.rng), start: now };
  }

  private startBig(now: number) {
    const choices = BIG_ACTS.filter(([name]) => name !== this.lastBig);
    const name = pickWeighted(this.rng, choices);
    this.lastBig = name;
    this.start(name, now);
    this.nextBigAt = now + this.wait(BIG_EVERY);
  }

  /** Let the schedule catch up to `now`: start whatever is due. */
  private advance(now: number) {
    // A tab in the background is not sampled. Coming back after an hour
    // should not replay the hour, so a long gap pushes the plan forward.
    const gap = now - this.lastSample;
    if (gap > 5_000) {
      this.nextBlinkAt += gap;
      this.nextSmallAt += gap;
      this.nextBigAt += gap;
    }
    this.lastSample = now;

    if (this.act && now - this.act.start >= this.act.motion.duration)
      this.act = null;
    if (this.blink && now - this.blink.start >= this.blink.motion.duration)
      this.blink = null;
    for (const name of ["ready", "doze"] as const) {
      const held = this.held[name];
      if (held && held.target === 0 && this.heldWeight(name, held, now) === 0) {
        delete this.held[name];
      }
    }

    if (
      this.dozes &&
      !this.dozing &&
      !this.act &&
      now - this.lastInputAt >= DOZE_AFTER
    ) {
      this.hold("doze", 1, now);
    }
    if (this.dozing) return;

    if (!this.blink && now >= this.nextBlinkAt) {
      this.blink = { motion: makeBlink(this.rng), start: now };
      this.nextBlinkAt = now + this.wait(BLINK_EVERY);
    }
    if (this.act) return;
    const quiet =
      now - this.lastTypingAt >= QUIET_FOR && now - this.lastInputAt >= 800;
    if (now >= this.nextBigAt && this.temperament === "lively") {
      if (quiet && !this.held.ready) this.startBig(now);
      else this.nextBigAt = now + this.wait([3_000, 6_000]);
      if (this.act) return;
    }
    if (now >= this.nextSmallAt) {
      // A watched pointer is its own look about.
      if (!this.lookTarget) this.start(pickWeighted(this.rng, SMALL_ACTS), now);
      this.nextSmallAt = now + this.wait(SMALL_EVERY);
    }
  }

  /** The head's turn toward the pointer at `now`, snapping and holding. */
  private watch(now: number): { angle: number; facing: number } {
    const rest = { angle: 0, facing: 1 };
    const at = (look: Look) => {
      const k = Math.min(1, (now - look.start) / look.duration);
      const e = easeOutBack(k);
      const f = easeInOut(k);
      return {
        angle: look.from.angle + (look.to.angle - look.from.angle) * e,
        facing: look.from.facing + (look.to.facing - look.from.facing) * f,
      };
    };
    const current = this.look ? at(this.look) : rest;
    const target = this.act || this.dozing ? rest : (this.lookTarget ?? rest);
    const moved =
      Math.abs(target.angle - (this.look?.to.angle ?? 0)) > 2.5 ||
      target.facing !== (this.look?.to.facing ?? 1);
    if (moved && now >= this.nextLookAt) {
      this.look = {
        from: current,
        to: target,
        start: now,
        duration:
          target.facing !== current.facing ? 110 : between(this.rng, 70, 110),
      };
      // The next turn waits a moment: a bird looks, holds, looks again.
      this.nextLookAt = now + between(this.rng, 180, 420);
    }
    return this.look ? at(this.look) : rest;
  }

  /** The pose at `now`. Call it once per drawn frame. */
  sample(now: number): CorvidPose {
    this.advance(now);
    let pose: CorvidPose = { ...HOME_POSE };
    for (const name of ["ready", "doze"] as const) {
      const held = this.held[name];
      if (held)
        pose = sampleMotion(
          pose,
          held.motion,
          now - held.start,
          this.heldWeight(name, held, now),
        );
    }
    if (this.act)
      pose = sampleMotion(pose, this.act.motion, now - this.act.start);
    const look = this.watch(now);
    pose.headAngle += look.angle;
    // Facing turns through zero, so a look behind is a head turn.
    pose.headFacing *=
      Math.abs(look.facing) < 0.2
        ? Math.sign(look.facing || 1) * 0.2
        : look.facing;
    if (this.blink)
      pose = sampleMotion(pose, this.blink.motion, now - this.blink.start);
    return pose;
  }

  /**
   * How long until the bird next needs drawing, in ms. 0 means draw every
   * frame now: something is moving.
   */
  nextChange(now: number): number {
    const moving =
      this.act !== null ||
      this.blink !== null ||
      (this.look !== null && now - this.look.start < this.look.duration) ||
      Object.entries(this.held).some(([name, held]) => {
        const weight = this.heldWeight(name as "ready" | "doze", held!, now);
        return held!.target === 1 ? weight < 1 : weight > 0;
      });
    if (moving) return 0;
    // Asleep, it breathes: a frame every so often is plenty for that.
    if (this.dozing) return 90;
    const due = Math.min(
      this.nextBlinkAt,
      this.nextSmallAt,
      this.temperament === "lively" ? this.nextBigAt : Infinity,
      this.dozes ? this.lastInputAt + DOZE_AFTER : Infinity,
    );
    return Math.max(16, due - now);
  }
}
