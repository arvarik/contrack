/**
 * The words and the pipeline of a dedupe scan's progress card.
 *
 * Kept apart from `DedupeView` so a unit test can hold them. A row turns
 * done only after its phase has run.
 *
 * @module views/dedupe/utils/scanPhases
 */
import type { DedupeScanMode, DedupeScanPhase } from "../../../types";

/** A scan mode's name on the progress card, in the picker's words. */
export const MODE_NAME: Record<DedupeScanMode, string> = {
  quick: "Quick",
  deep: "Smart",
  full: "Full",
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

/** Whether the mode runs the AI pass: every mode but Quick (the server's `runScan`). */
export const runsAiPass = (mode: DedupeScanMode): boolean => mode !== "quick";

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
