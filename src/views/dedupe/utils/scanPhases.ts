/**
 * The steps of a check for duplicates, as its progress shows them.
 *
 * Kept apart from the check's card so a unit test can hold them. A step
 * turns done only after its phase has run.
 *
 * @module views/dedupe/utils/scanPhases
 */
import type { DedupeScanMode, DedupeScanPhase } from "../../../types";

/**
 * The order the server runs a check's phases in (server/services/dedupe,
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

/** One step of the progress: its words and the phases it spans. */
export interface CheckStep {
  label: string;
  from: DedupeScanPhase;
  to: DedupeScanPhase;
  /** Only a check with AI on runs it. */
  ai: boolean;
}

/** The steps, in the words a person reads. */
export const CHECK_STEPS: readonly CheckStep[] = [
  {
    label: "Same email, phone or name",
    from: "deterministic",
    to: "deterministic",
    ai: false,
  },
  {
    label: "Close matches, checked by AI",
    from: "blocking",
    to: "ai",
    ai: true,
  },
  { label: "Grouping", from: "clustering", to: "clustering", ai: false },
];

/**
 * A step's status: pending before the phase `from`, active from `from`
 * through `to`, done after `to`. An error leaves every step pending.
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
