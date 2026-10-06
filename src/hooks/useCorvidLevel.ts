/**
 * How much the bird may move, on this account, right now: the account's
 * choice plus the two ways a person can ask for less motion. `motionLevel`
 * in `lib/corvid.ts` is the rule and stays pure, so tests cover every input
 * without a renderer. This is the wiring.
 *
 * Safe outside the providers: on the sign-in screens and the crash screen
 * `usePreferences` gives the defaults, so a bird there moves at the default
 * level, as on a fresh account.
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
