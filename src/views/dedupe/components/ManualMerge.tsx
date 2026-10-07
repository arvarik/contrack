import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Contact } from "../../../types";
import { undoMerges, useMergeCluster } from "../../../api";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { cn, errorText } from "../../../lib/utils";
import { SELECTED_TINT } from "../../../lib/styles";
import { withUndo } from "../../../lib/undoToast";
import { suggestKeeper } from "../utils/mergeOutcome";
import { SelectStage } from "./manual/SelectStage";
import { CompareStage } from "./manual/CompareStage";

type Stage = "select" | "compare";

const STAGES: { stage: Stage; label: string }[] = [
  { stage: "select", label: "Choose" },
  { stage: "compare", label: "Compare and merge" },
];

/**
 * Choose 2 to 5 contacts, then compare them, choose the keeper and merge.
 * The comparison is the review list's, so a merge by hand says what it keeps
 * the same way. One call merges them all, and its toast has Undo.
 */
export const ManualMerge = () => {
  const qc = useQueryClient();
  const [stage, setStage] = useState<Stage>("select");
  const [selected, setSelected] = useState<Contact[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const mergeCluster = useMergeCluster();

  // The page is one scroller, so a stage change scrolls the tool's top into
  // view, or a new stage opens far down with Back off screen. Reduced motion
  // makes the jump instant.
  const rootRef = useRef<HTMLDivElement>(null);
  const shownRef = useRef(stage);
  const reducedMotion = useReducedMotion();
  const { preferences } = usePreferences();
  const smooth = !reducedMotion && preferences.motion !== "reduced";
  useEffect(() => {
    if (shownRef.current === stage) return;
    shownRef.current = stage;
    // jsdom has no scrollIntoView, so the call is optional.
    rootRef.current?.firstElementChild?.scrollIntoView?.({
      block: "nearest",
      behavior: smooth ? "smooth" : "auto",
    });
  }, [stage, smooth]);

  // The most complete contact, until a person picks another.
  const keeperId =
    selected.find((c) => c.id === primaryId)?.id ??
    (selected.length > 0 ? suggestKeeper(selected).id : null);
  const primary = selected.find((c) => c.id === keeperId) ?? null;
  const others = selected.filter((c) => c.id !== keeperId);

  const handleMerge = useCallback(async () => {
    if (!primary || others.length === 0 || mergeCluster.isPending) return;
    try {
      const result = await mergeCluster.mutateAsync({
        primaryId: primary.id,
        duplicateIds: others.map((c) => c.id),
      });
      const undo = withUndo(() => {
        void undoMerges(qc, result.mergeLogIds, false).catch((err: unknown) =>
          toast.error(`Could not undo: ${errorText(err)}`),
        );
      });
      if (result.merged === 0) {
        toast.error("Nothing was merged");
        return;
      }
      const message =
        result.merged === 1
          ? `Merged ${others[0].name} into ${primary.name}`
          : `Merged ${result.merged} contacts into ${primary.name}`;
      if (result.failed > 0) {
        toast.warning(message, {
          description: `${result.failed} could not be merged`,
          ...undo,
        });
      } else {
        toast.success(message, undo);
      }
      setSelected([]);
      setPrimaryId(null);
      setStage("select");
    } catch (err: unknown) {
      toast.error(`Could not merge: ${errorText(err)}`);
    }
  }, [primary, others, mergeCluster, qc]);

  return (
    <div ref={rootRef} className="flex flex-col w-full">
      {/* The steps, which a stage change scrolls into view. */}
      <div className="flex items-center gap-2 mb-6 px-1">
        {STAGES.map(({ stage: s, label }, i) => (
          <React.Fragment key={s}>
            {i > 0 && <div className="h-px flex-1 bg-surface-container-high" />}
            <button
              type="button"
              onClick={() => {
                // Back is always open. Forward needs two contacts.
                if (s === "select" || selected.length >= 2) setStage(s);
              }}
              aria-current={stage === s ? "step" : undefined}
              className={cn(
                "hit-area flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap",
                stage === s
                  ? SELECTED_TINT
                  : "state-layer text-on-surface-variant hover:text-on-surface",
              )}
            >
              <span
                className={cn(
                  "w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold",
                  stage === s
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-high text-on-surface-variant",
                )}
              >
                {i + 1}
              </span>
              {label}
            </button>
          </React.Fragment>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {stage === "select" ? (
          <SelectStage
            selected={selected}
            onSelectionChange={setSelected}
            onNext={() => setStage("compare")}
          />
        ) : (
          <CompareStage
            selected={selected}
            primaryId={keeperId}
            setPrimaryId={setPrimaryId}
            onBack={() => setStage("select")}
            onMerge={handleMerge}
            isMerging={mergeCluster.isPending}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
