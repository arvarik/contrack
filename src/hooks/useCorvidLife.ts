/**
 * useCorvidLife — a perched corvid that lives.
 *
 * Give a mark `alive` and this runs a `CorvidBrain` for it: blinks, looks
 * about, preens, shakes its feathers, stretches, caws without a sound, and
 * falls asleep when nobody has touched the app for a while. The ring never
 * moves. Only the bird's own paths are repainted.
 *
 * It costs nothing while the bird is still. Between acts it sleeps on one
 * timer until the next thing is due, and it draws frames only while
 * something is actually moving. It stops altogether while the tab is hidden,
 * while the mark is out of view, while the bird is away flying, and at
 * motion level "off".
 *
 * One bird is the app's own: the sidebar perch passes `primary`. That one
 * listens to the whole app. It answers `corvidReact()`, notices
 * `noteCorvidActivity()`, watches the pointer when it comes near, and
 * notices when the person has gone quiet. Any other living mark answers
 * only a reaction addressed to it, and its own controls.
 *
 * @module hooks/useCorvidLife
 */
import { useEffect, useMemo, type RefObject } from "react";
import { CORVID_EYE } from "../assets/corvidPaths";
import {
  birdElements,
  isHomePose,
  paintHome,
  paintPose,
} from "../components/brand/corvidDom";
import {
  CorvidBrain,
  makeCorvidMotion,
  type CorvidBrainEvent,
  type CorvidReaction,
} from "../lib/corvidBrain";
import {
  CORVID_AWAY_EVENT,
  CORVID_HOME_EVENT,
  CORVID_REACT_EVENT,
  CORVID_STIR_EVENT,
  type CorvidPerchDetail,
  type CorvidReactDetail,
} from "../lib/corvid";
import { sampleMotion } from "../lib/corvidMotion";
import { HOME_POSE } from "../assets/corvidRig";

/** A mark smaller than this never lives: a blink is invisible at 20 px. */
export const LIFE_MIN_SIZE = 24;

/** A handle on one living mark, for the component that owns it. */
export interface CorvidControls {
  /** Play one act now. */
  react(reaction: CorvidReaction): void;
  /** The perch is hovered or focused, or stops being. */
  hover(on: boolean): void;
}

interface Attachable extends CorvidControls {
  attach(send: (event: CorvidBrainEvent) => void): () => void;
}

/** A stable handle to pass to a mark as `controls`. */
export function useCorvidControls(): CorvidControls {
  return useMemo<Attachable>(() => {
    let send: ((event: CorvidBrainEvent) => void) | null = null;
    return {
      react: (reaction) => send?.({ type: "react", reaction }),
      hover: (on) => send?.({ type: "hover", on }),
      attach(next) {
        send = next;
        return () => {
          if (send === next) send = null;
        };
      },
    };
  }, []);
}

export interface CorvidLifeOptions {
  /** False at motion level "off". */
  enabled: boolean;
  /** Run the brain: the bird acts by itself. */
  alive: boolean;
  /**
   * A mark that does not live can still answer: it plays a reaction sent to
   * it, or through its controls, and then holds still again. The phone's
   * 20 px perch is one.
   */
  reactive?: boolean;
  /** One act to play when the mark appears. */
  once?: CorvidReaction | null;
  /** The app's own bird. See the module comment. */
  primary?: boolean;
  temperament?: "lively" | "calm";
  tempo?: number;
  controls?: CorvidControls;
}

const isEditable = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.isContentEditable ||
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA")
  );
};

export function useCorvidLife(
  ref: RefObject<SVGSVGElement | null>,
  {
    enabled,
    alive,
    reactive = false,
    once = null,
    primary = false,
    temperament = "lively",
    tempo = 1,
    controls,
  }: CorvidLifeOptions,
): void {
  useEffect(() => {
    const svg = ref.current;
    if (!svg || !enabled || (!alive && !once && !reactive)) return;
    if (
      typeof window === "undefined" ||
      typeof requestAnimationFrame === "undefined"
    )
      return;
    const bird = birdElements(svg);
    const eyeRadius = Number(bird.eye?.getAttribute("rx")) || CORVID_EYE.r;
    const now = () => performance.now();

    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let away = false;
    let atHome = true;
    let stopped = false;

    const paint = (pose: typeof HOME_POSE) => {
      if (isHomePose(pose)) {
        if (!atHome) paintHome(bird, eyeRadius);
        atHome = true;
      } else {
        paintPose(bird, pose);
        atHome = false;
      }
    };
    const halt = () => {
      if (frame) cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
      frame = 0;
      timer = undefined;
    };

    const owns = (el: Element | null | undefined) =>
      !!el && (el === svg || el.contains(svg));

    // A mark that does not live: no brain and no schedule, only the acts it
    // is asked for, one at a time, each played to its end and then home.
    if (!alive) {
      let playing: {
        motion: ReturnType<typeof makeCorvidMotion>;
        start: number;
      } | null = null;
      const step = () => {
        frame = 0;
        if (stopped || !playing) return;
        const t = now() - playing.start;
        if (t >= playing.motion.duration) {
          playing = null;
          paint(HOME_POSE);
          return;
        }
        paint(sampleMotion({ ...HOME_POSE }, playing.motion, t));
        frame = requestAnimationFrame(step);
      };
      const play = (reaction: CorvidReaction) => {
        if (stopped) return;
        playing = {
          motion: makeCorvidMotion(reaction, Math.random),
          start: now(),
        };
        if (!frame) frame = requestAnimationFrame(step);
      };
      const detachOne = (controls as Attachable | undefined)?.attach(
        (event) => {
          if (event.type === "react") play(event.reaction);
        },
      );
      const onReactOne = (event: Event) => {
        const detail = (event as CustomEvent<CorvidReactDetail>).detail;
        if (detail?.target && owns(detail.target)) play(detail.reaction);
      };
      if (reactive) window.addEventListener(CORVID_REACT_EVENT, onReactOne);
      if (once) play(once);
      return () => {
        stopped = true;
        halt();
        detachOne?.();
        window.removeEventListener(CORVID_REACT_EVENT, onReactOne);
        paint(HOME_POSE);
      };
    }

    const newBrain = () =>
      new CorvidBrain({
        rng: Math.random,
        now: now(),
        temperament,
        tempo,
        dozes: primary,
      });
    let brain = newBrain();
    if (once) brain.send({ type: "react", reaction: once }, now());

    // A bird nobody can see sleeps: in a hidden tab, or out of view, which
    // is the sidebar's own bird on a phone, where CSS hides the rail. The
    // observer and the visibility event wake it. Where there is no
    // observer, as in a test, the mark counts as on screen.
    let onScreen = true;
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            onScreen = entries.some((entry) => entry.isIntersecting);
            if (onScreen) kick();
          });
    observer?.observe(svg);

    const tick = () => {
      frame = 0;
      timer = undefined;
      if (stopped || away || document.hidden || !onScreen) return;
      const t = now();
      paint(brain.sample(t));
      const wait = brain.nextChange(t);
      if (wait === 0) frame = requestAnimationFrame(tick);
      else timer = setTimeout(tick, Math.min(wait, 30_000));
    };
    const kick = () => {
      if (stopped || away) return;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const send = (event: CorvidBrainEvent) => {
      brain.send(event, now());
      kick();
    };
    const detach = (controls as Attachable | undefined)?.attach(send);

    const onReact = (event: Event) => {
      const detail = (event as CustomEvent<CorvidReactDetail>).detail;
      if (!detail) return;
      if (detail.target ? owns(detail.target) : primary)
        send({ type: "react", reaction: detail.reaction });
    };
    const onStir = () => send({ type: "stir" });
    const onAway = (event: Event) => {
      if (!owns((event as CustomEvent<CorvidPerchDetail>).detail?.perch))
        return;
      away = true;
      halt();
      paint(HOME_POSE);
    };
    const onHome = (event: Event) => {
      if (!owns((event as CustomEvent<CorvidPerchDetail>).detail?.perch))
        return;
      away = false;
      brain = newBrain();
      kick();
    };
    const onVisible = () => {
      if (!document.hidden) kick();
    };

    window.addEventListener(CORVID_REACT_EVENT, onReact);
    window.addEventListener(CORVID_AWAY_EVENT, onAway);
    window.addEventListener(CORVID_HOME_EVENT, onHome);
    document.addEventListener("visibilitychange", onVisible);

    // The app's own bird watches the pointer and notices the person.
    const cleanups: (() => void)[] = [];
    if (primary) {
      window.addEventListener(CORVID_STIR_EVENT, onStir);
      cleanups.push(() =>
        window.removeEventListener(CORVID_STIR_EVENT, onStir),
      );

      let rect = svg.getBoundingClientRect();
      let rectAt = now();
      let lastPointer = 0;
      const onPointer = (event: PointerEvent) => {
        const t = now();
        if (t - lastPointer < 50) return;
        lastPointer = t;
        if (t - rectAt > 500) {
          rect = svg.getBoundingClientRect();
          rectAt = t;
        }
        if (rect.width === 0) return;
        send({
          type: "pointer",
          dx: event.clientX - (rect.left + rect.width / 2),
          dy: event.clientY - (rect.top + rect.height / 2),
        });
      };
      const onLeave = () => send({ type: "pointerGone" });
      let lastInput = 0;
      const onInput = () => {
        const t = now();
        if (t - lastInput < 300) return;
        lastInput = t;
        send({ type: "input" });
      };
      const onKey = (event: KeyboardEvent) => {
        if (isEditable(event.target)) brain.send({ type: "typing" }, now());
        else onInput();
      };
      window.addEventListener("pointermove", onPointer, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
      window.addEventListener("pointerdown", onInput, {
        passive: true,
        capture: true,
      });
      window.addEventListener("wheel", onInput, { passive: true });
      window.addEventListener("keydown", onKey, { capture: true });
      cleanups.push(() => {
        window.removeEventListener("pointermove", onPointer);
        document.documentElement.removeEventListener("pointerleave", onLeave);
        window.removeEventListener("pointerdown", onInput, { capture: true });
        window.removeEventListener("wheel", onInput);
        window.removeEventListener("keydown", onKey, { capture: true });
      });
    }

    tick();

    return () => {
      stopped = true;
      halt();
      detach?.();
      observer?.disconnect();
      window.removeEventListener(CORVID_REACT_EVENT, onReact);
      window.removeEventListener(CORVID_AWAY_EVENT, onAway);
      window.removeEventListener(CORVID_HOME_EVENT, onHome);
      document.removeEventListener("visibilitychange", onVisible);
      for (const cleanup of cleanups) cleanup();
      paint(HOME_POSE);
    };
  }, [
    ref,
    enabled,
    alive,
    reactive,
    once,
    primary,
    temperament,
    tempo,
    controls,
  ]);
}
