import React, { useMemo } from "react";
import {
  Undo2,
  Sparkles,
  User,
  Loader2,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { motion } from "motion/react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useMergeLog, useUndoMerge } from "../../../api";
import { cn } from "../../../lib/utils";
import { LABEL, TONE_WASH } from "../../../lib/styles";
import { DURATION, EASE } from "../../../lib/motion";
import type { MergeLogEntry } from "../../../types";
import { EmptyState } from "../../../components/ui/EmptyState";

// =============================================================================
// ActivityFeed — Merge audit log with undo capability
// =============================================================================

/**
 * "3 hours ago" for the row, the full local timestamp for the tooltip.
 *
 * The feed already groups by Today / Yesterday / This week, which answers
 * "roughly when" — but inside a group every entry looked simultaneous, and
 * for an audit log of destructive operations the order and spacing of events
 * is most of the value. date-fns is already a dependency and is what the rest
 * of the app uses for relative time.
 */
function relativeTime(iso: string): string {
  const date = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "";
  return formatDistanceToNow(date, { addSuffix: true });
}

function exactTime(iso: string): string {
  const date = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    dateStyle: "full",
    timeStyle: "short",
  });
}

/** Group entries by relative date. */
function groupByDate(
  entries: MergeLogEntry[],
): { label: string; items: MergeLogEntry[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const thisWeek = new Date(today.getTime() - 7 * 86400000);

  const groups: Map<string, MergeLogEntry[]> = new Map();

  for (const entry of entries) {
    const date = new Date(entry.mergedAt);
    let label: string;
    if (date >= today) label = "Today";
    else if (date >= yesterday) label = "Yesterday";
    else if (date >= thisWeek) label = "This week";
    else label = "Older";

    const existing = groups.get(label) ?? [];
    existing.push(entry);
    groups.set(label, existing);
  }

  // Preserve chronological group ordering
  const order = ["Today", "Yesterday", "This week", "Older"];
  return order
    .filter((label) => groups.has(label))
    .map((label) => ({ label, items: groups.get(label)! }));
}

export const ActivityFeed = () => {
  const { data: entries = [], isLoading } = useMergeLog();
  const undoMerge = useUndoMerge();

  const groups = useMemo(() => groupByDate(entries), [entries]);

  const handleUndo = async (id: string, name: string | undefined) => {
    try {
      const res = await undoMerge.mutateAsync(id);
      if (res?.conflicts && res.conflicts.length > 0) {
        toast.warning(
          `Restored "${name}" with ${res.conflicts.length} conflict(s): survivor edits were retained.`,
        );
      } else {
        toast.success(`Restored "${name}"`);
      }
    } catch (err: unknown) {
      toast.error(
        `Undo failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-on-surface-variant" />
      </div>
    );
  }

  if (entries.length === 0) {
    // Level 3: the feed sits under the "Merge activity" panel's h2.
    return (
      <EmptyState
        level={3}
        icon={Clock}
        title="No merge activity yet"
        body="Merged contacts will appear here"
      />
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.label}>
          <div className={cn(LABEL, "px-1 mb-2")}>{group.label}</div>
          <div className="space-y-1.5">
            {group.items.map((entry, i) => {
              const isAuto = entry.mergedBy === "auto";
              const isUndone = !!entry.undoneAt;
              const canUndo = !isUndone;

              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: DURATION.slow,
                    ease: EASE,
                    delay: Math.min(i * 0.02, 0.2),
                  }}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl transition-colors",
                    isUndone
                      ? "bg-surface-container-low/50 opacity-60"
                      : "bg-surface-container-lowest",
                  )}
                >
                  {/* Icon */}
                  <div
                    className={cn(
                      "p-1.5 rounded-lg shrink-0",
                      TONE_WASH[
                        isUndone ? "neutral" : isAuto ? "primary" : "success"
                      ],
                    )}
                  >
                    {isUndone ? (
                      <Undo2 className="w-3.5 h-3.5" />
                    ) : isAuto ? (
                      <Sparkles className="w-3.5 h-3.5" />
                    ) : (
                      <User className="w-3.5 h-3.5" />
                    )}
                  </div>

                  {/* Description */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-on-surface leading-snug">
                      {isUndone ? (
                        <span className="text-on-surface-variant line-through">
                          Merged "{entry.duplicateName}" → "{entry.primaryName}"
                        </span>
                      ) : (
                        <>
                          {isAuto ? (
                            <span className="text-primary font-bold">
                              Auto-merged{" "}
                            </span>
                          ) : (
                            <span className="text-success font-bold">
                              Merged{" "}
                            </span>
                          )}
                          <span className="font-bold">
                            "{entry.duplicateName}"
                          </span>
                          <span className="text-on-surface-variant"> → </span>
                          <span className="font-bold">
                            "{entry.primaryName}"
                          </span>
                        </>
                      )}
                    </p>
                    <p className="text-[11px] text-on-surface-variant mt-0.5">
                      <time
                        dateTime={entry.mergedAt}
                        title={exactTime(entry.mergedAt)}
                        className="font-bold"
                      >
                        {relativeTime(entry.mergedAt)}
                      </time>
                      {" · "}
                      {isUndone
                        ? "Undone"
                        : `${(entry.confidence * 100).toFixed(0)}% confidence`}
                      {entry.reasoning &&
                        !isUndone &&
                        ` · ${entry.reasoning.slice(0, 60)}${entry.reasoning.length > 60 ? "…" : ""}`}
                    </p>
                  </div>

                  {/* Undo button */}
                  {canUndo && (
                    <button
                      onClick={() => handleUndo(entry.id, entry.duplicateName)}
                      disabled={undoMerge.isPending}
                      className="hit-area state-layer shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-on-surface-variant bg-surface-container-low rounded-lg transition-colors disabled:cursor-not-allowed"
                    >
                      <Undo2 className="w-3 h-3" />
                      Undo
                    </button>
                  )}

                  {isUndone && (
                    <span className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-on-surface-variant">
                      <CheckCircle2 className="w-3 h-3" />
                      Restored
                    </span>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
