/**
 * useCorvidIdle — the bird blinks while it sits there.
 *
 * The animation itself is CSS: a keyframe on `[data-part="eye"]` for the
 * blink and one on the svg for the head tilt, both in `index.css`. This hook
 * only decides when to add the class and when to take it off again. Keeping
 * the motion in CSS means the compositor runs it and a re-render never
 * restarts it halfway.
 *
 * Three rules keep it from becoming noise:
 *
 * 1. Four to nine seconds between blinks. Closer together and the bird looks
 *    nervous; further apart and nobody ever sees one.
 * 2. One blink in five is a two-degree head tilt instead, so the idle is not
 *    a metronome.
 * 3. Nothing runs while the tab is in the background, and a mark under 24 px
 *    never gets a timer at all. The favicon-sized marks are a smudge at that
 *    size and there can be many of them on one page.
 *
 * @module hooks/useCorvidIdle
 */
import { useEffect, type RefObject } from "react";

/** A mark smaller than this never idles. */
export const IDLE_MIN_SIZE = 24;

/** The shortest and longest wait between two idle beats, in milliseconds. */
export const IDLE_MIN_MS = 4_000;
export const IDLE_MAX_MS = 9_000;

/** How often a beat is a head tilt rather than a blink. */
export const TILT_CHANCE = 0.2;

/** The class that plays one blink. Matches the keyframe in `index.css`. */
export const BLINK_CLASS = "corvid-blink";

/** The class that plays one head tilt. */
export const TILT_CLASS = "corvid-tilt";

/** How long each beat lasts. The class comes off when its keyframe ends. */
export const BLINK_MS = 140;
export const TILT_MS = 420;

export interface CorvidIdleOptions {
  /** `false` at motion level "off", or wherever the mark must hold still. */
  enabled: boolean;
  /** The mark's rendered size, in CSS pixels. */
  size: number;
}

/**
 * Blink the mark `ref` points at, now and then.
 *
 * @param ref     the mark's `<svg>`. A null ref simply never beats.
 * @param options whether to run at all, and how big the mark is.
 */
export function useCorvidIdle(
  ref: RefObject<SVGSVGElement | null>,
  { enabled, size }: CorvidIdleOptions,
): void {
  useEffect(() => {
    if (!enabled || size < IDLE_MIN_SIZE) return;
    if (typeof window === "undefined") return;

    let nextBeat: ReturnType<typeof setTimeout> | undefined;
    let endBeat: ReturnType<typeof setTimeout> | undefined;
    /** Whatever the mark was on the last beat, for the cleanup to tidy. */
    let lastBeaten: SVGSVGElement | null = null;

    const wait = () =>
      IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);

    const schedule = () => {
      nextBeat = setTimeout(beat, wait());
    };

    const beat = () => {
      // A blink nobody can see is a timer nobody needs. Wait it out instead.
      if (typeof document !== "undefined" && document.hidden) {
        schedule();
        return;
      }
      const element = ref.current;
      if (!element) {
        schedule();
        return;
      }
      const tilt = Math.random() < TILT_CHANCE;
      const className = tilt ? TILT_CLASS : BLINK_CLASS;
      lastBeaten = element;
      element.classList.add(className);
      endBeat = setTimeout(
        () => {
          element.classList.remove(className);
          schedule();
        },
        tilt ? TILT_MS : BLINK_MS,
      );
    };

    schedule();

    return () => {
      if (nextBeat) clearTimeout(nextBeat);
      if (endBeat) clearTimeout(endBeat);
      // The element this effect actually touched, not whatever the ref holds
      // now: a remount points the ref at a new node mid-beat.
      lastBeaten?.classList.remove(BLINK_CLASS, TILT_CLASS);
    };
  }, [enabled, size, ref]);
}

/**
 * Play one beat on an element that is not idling: the hop when the perch is
 * clicked, or the blink when the bird lands.
 *
 * Returns a function that takes the class off early, so a caller that
 * unmounts mid-beat does not leave a dangling timer.
 */
export function playCorvidBeat(
  element: Element | null | undefined,
  className: string,
  durationMs: number,
): () => void {
  if (!element) return () => {};
  // Off and on again, so a second click restarts the keyframe rather than
  // being swallowed because the class is already there.
  element.classList.remove(className);
  void (element as HTMLElement).offsetWidth;
  element.classList.add(className);
  const timer = setTimeout(
    () => element.classList.remove(className),
    durationMs,
  );
  return () => {
    clearTimeout(timer);
    element.classList.remove(className);
  };
}

/** The class and the length of the hop the perch plays when it is clicked. */
export const HOP_CLASS = "corvid-hop";
export const HOP_MS = 120;
