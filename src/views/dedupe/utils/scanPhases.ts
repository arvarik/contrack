/**
 * The words and the pipeline of a dedupe scan's progress card.
 *
 * Kept apart from `DedupeView` so a unit test can hold them. The card used
 * to test the old mode names only (deterministic, ai, both), so the three
 * modes the picker offers (quick, deep, full) showed no exact-match or AI
 * row, and a row turned done before its phase had run.
 *
 * @module views/dedupe/utils/scanPhases
 */
import type { DedupeScanMode, DedupeScanPhase } from "../../../types";

/**
 * A scan mode's name on the progress card, in sentence case and with the
 * picker's words for its three modes. `capitalize` printed "Ai Mode".
 */
export const MODE_NAME: Record<DedupeScanMode, string> = {
  quick: "Quick",
  deep: "Smart",
  full: "Full",
  deterministic: "Deterministic",
  ai: "AI",
  both: "Deterministic and AI",
};

/**
 * The order the server runs a scan's phases in (server/services/dedupe,
 * `engine.ts` and `passes.ts`). Every mode runs the exact-match pass, and
 * every mode but Quick runs blocking, scoring and the AI pass after it.
 */
const PHASE_ORDER: DedupeScanPhase[] = [
  "starting",
  "normalizing",
  "deterministic",
  "blocking",
  "scoring",
  "ai",
  "clustering",
  "persisting",
  "complete",
];

/** Whether the mode runs the AI pass: every mode but Quick (the server's `resolveMode`). */
export const runsAiPass = (mode: DedupeScanMode): boolean =>
  mode !== "quick" && mode !== "deterministic";

/**
 * A pipeline row's status: pending before the phase `from`, active from
 * `from` through `to`, done after `to`. An error leaves every row pending.
 */
export const stepStatus = (
  phase: DedupeScanPhase,
  from: DedupeScanPhase,
  to: DedupeScanPhase,
): "pending" | "active" | "done" => {
  const at = PHASE_ORDER.indexOf(phase);
  if (at < PHASE_ORDER.indexOf(from)) return "pending";
  if (at <= PHASE_ORDER.indexOf(to)) return "active";
  return "done";
};
