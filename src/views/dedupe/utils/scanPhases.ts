/** The steps of a check for duplicates, as its progress shows them. */
import type { DedupeScanMode, DedupeScanPhase } from "../../../types";

/**
 * The order the server runs a check's phases in (server/services/dedupe,
 * `engine.ts` and `passes.ts`). Quick skips blocking, scoring and AI.
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

/** As the server's `runScan` decides. */
export const runsAiPass = (mode: DedupeScanMode): boolean => mode !== "quick";

/** One step of the progress: its words and the phases it spans. */
export interface CheckStep {
  label: string;
  from: DedupeScanPhase;
  to: DedupeScanPhase;
  /** Only a check with AI on runs it. */
  ai: boolean;
}

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

/** Pending before `from`, active through `to`, then done. An error: pending. */
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
