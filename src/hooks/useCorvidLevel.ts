/**
 * useCorvidLevel — how much the bird may move, on this account, right now.
 *
 * One hook so that no surface has to remember the rule. `motionLevel` in
 * `lib/corvid.ts` is the rule itself and stays pure, because the flight path
 * tests exercise every combination of its three inputs without a renderer.
 * This is the wiring: the account's choice, plus the two ways a person can
 * ask for less motion.
 *
 * Safe outside the providers. The sign-in screens render before
 * `PreferencesProvider` exists and the crash screen renders after everything
 * has gone, and in both cases `usePreferences` hands back the defaults rather
 * than throwing. A bird on those screens moves at the default level, which is
 * the same answer a fresh account gets.
 *
 * @module hooks/useCorvidLevel
 */
import { useReducedMotion } from "motion/react";
import { usePreferences } from "../contexts/PreferencesContext";
import { motionLevel, type MotionLevel } from "../lib/corvid";

export function useCorvidLevel(): MotionLevel {
  const { preferences } = usePreferences();
  const prefersReducedMotion = useReducedMotion();
  return motionLevel(
    preferences.mascotMotion,
    Boolean(prefersReducedMotion),
    preferences.motion,
  );
}
