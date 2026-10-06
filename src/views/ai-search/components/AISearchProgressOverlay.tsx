/**
 * A floating research progress panel, bottom right. It does not block the
 * app, and it stays open until the person minimizes or dismisses it.
 */
import React, { useState, useMemo } from "react";
import {
  Sparkles,
  Circle,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import type { AISearchBatch, AISearchJob } from "../../../types";
import { cn } from "../../../lib/utils";
import { BTN_QUIET, CARD, ICON_BTN, TAG_PILL } from "../../../lib/styles";
import { DEPTH_WORDS } from "../../../lib/researchDepth";
import { DURATION, EASE } from "../../../lib/motion";
import { NAMES } from "../../../lib/names";

interface Props {
  batch: AISearchBatch;
  onDismiss: () => void;
  onCancel: () => void;
  isCanceling?: boolean;
  connectionError?: boolean;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  cancelled: <XCircle className="w-3.5 h-3.5 text-on-surface-variant" />,
  queued: <Circle className="w-3.5 h-3.5 text-on-surface-variant" />,
  searching: <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />,
  merging: <Loader2 className="w-3.5 h-3.5 text-warning animate-spin" />,
  success: <CheckCircle2 className="w-3.5 h-3.5 text-success" />,
  error: <XCircle className="w-3.5 h-3.5 text-error" />,
};

export function AISearchProgressOverlay({
  batch,
  onDismiss,
  onCancel,
  isCanceling,
  connectionError,
}: Props) {
  const [isMinimized, setIsMinimized] = useState(false);

  const completed = useMemo(
    () =>
      batch.jobs.filter(
        (j) =>
          j.status === "success" ||
          j.status === "error" ||
          j.status === "cancelled",
      ).length,
    [batch.jobs],
  );
  const succeeded = useMemo(
    () => batch.jobs.filter((j) => j.status === "success").length,
    [batch.jobs],
  );
  const failed = useMemo(
    () => batch.jobs.filter((j) => j.status === "error").length,
    [batch.jobs],
  );
  const totalFields = useMemo(
    () => batch.jobs.reduce((sum, j) => sum + j.fieldsUpdated, 0),
    [batch.jobs],
  );
  // Every finished job searched and found no page about its person.
  const nobodyFound =
    succeeded > 0 &&
    batch.jobs.every(
      (j) => j.status !== "success" || j.outcome === "no-public-info",
    );
  const total = batch.jobs.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;
  const isComplete =
    batch.status === "complete" || batch.status === "cancelled";

  if (isMinimized) {
    return (
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        // Over the phone's tab bar, not on it.
        className="fixed bottom-[calc(var(--tabbar-space)+0.75rem)] md:bottom-6 right-4 md:right-6 z-50"
      >
        <button
          onClick={() => setIsMinimized(false)}
          // It floats over the page, so it keeps its shadow and hairline.
          className={cn(
            "hit-area state-layer flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-xl",
            "bg-surface-container-lowest ring-1 ring-surface-container-highest/30",
            "transition-colors cursor-pointer",
            "text-sm font-semibold",
          )}
        >
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-on-surface">
            {!isComplete && (
              <span>
                {completed}/{total} researched{" "}
              </span>
            )}
            {batch.status === "cancelled" && <span>Research stopped </span>}
            {succeeded > 0 && (
              <span className="text-success">{succeeded} updated</span>
            )}
            {succeeded > 0 && failed > 0 && ", "}
            {failed > 0 && <span className="text-error">{failed} failed</span>}
          </span>
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ y: 40, opacity: 0, scale: 0.95 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      transition={{ type: "spring", damping: 24, stiffness: 300 }}
      // Over the phone's tab bar, not on it.
      className="fixed bottom-[calc(var(--tabbar-space)+0.75rem)] md:bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-var(--tabbar-space)-1.5rem)] md:max-h-[calc(100dvh-2rem)] overflow-y-auto"
    >
      <div
        className={cn(
          CARD,
          "p-0 shadow-2xl ring-1 ring-surface-container-highest/30 overflow-hidden",
        )}
      >
        <div className="px-4 py-3 bg-surface-container-low flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="font-bold text-sm text-on-surface flex-1">
            {NAMES.enrichment.label}
          </span>
          <span className="text-xs text-on-surface-variant tabular-nums">
            {completed}/{total}
          </span>
          <button
            aria-label="Minimize research progress"
            onClick={() => setIsMinimized(true)}
            className={cn(ICON_BTN, "p-1")}
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button
            aria-label={
              isComplete
                ? "Dismiss research progress"
                : "Minimize research progress"
            }
            onClick={isComplete ? onDismiss : () => setIsMinimized(true)}
            className={cn(ICON_BTN, "p-1 hover:text-error")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="h-1 bg-surface-container-high">
          <motion.div
            className="h-full bg-gradient-to-r from-primary-dim to-primary-container"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: DURATION.slow, ease: EASE }}
          />
        </div>

        {!isComplete && (
          <div className="px-4 py-2 flex items-center justify-between gap-2 text-xs">
            <span role="status">
              {connectionError
                ? "Reconnecting to research status…"
                : "Completed updates save as research continues"}
            </span>
            <button
              onClick={onCancel}
              disabled={isCanceling}
              className="hit-area state-layer shrink-0 px-2 py-1 rounded text-error disabled:opacity-50"
            >
              {isCanceling ? "Stopping…" : "Stop research"}
            </button>
          </div>
        )}
        <div className="max-h-64 overflow-y-auto">
          {batch.jobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </div>

        {isComplete && (
          <div className="px-4 py-2.5 bg-surface-container-low text-xs text-on-surface-variant flex items-center gap-2">
            <span className="flex-1">
              {totalFields > 0 ? (
                <span>
                  <span className="font-bold text-success">{totalFields}</span>{" "}
                  field{totalFields !== 1 ? "s" : ""} enriched
                  {batch.totalTokens > 0 && (
                    <span className="ml-1">
                      · ~{(batch.totalTokens / 1000).toFixed(1)}k tokens
                    </span>
                  )}
                </span>
              ) : (
                <span>
                  {batch.status === "cancelled"
                    ? "Research stopped"
                    : failed
                      ? "Research could not complete"
                      : nobodyFound
                        ? succeeded > 1
                          ? "No web page about these people"
                          : "No web page about this person"
                        : "No new data found"}
                </span>
              )}
            </span>
            <button
              aria-label="Dismiss research progress"
              onClick={onDismiss}
              className={BTN_QUIET}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function JobRow({ job }: { key?: React.Key; job: AISearchJob }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
      <div className="shrink-0">{STATUS_ICONS[job.status]}</div>
      <span
        className={cn(
          "flex-1 truncate",
          job.status === "success" ? "text-on-surface" : "",
          job.status === "error" ? "text-error" : "",
          job.status === "queued" ? "text-on-surface-variant" : "",
          job.status === "searching" || job.status === "merging"
            ? "text-on-surface font-medium"
            : "",
        )}
      >
        {job.contactName}
      </span>
      {/* The default depth goes unsaid: a row says only a Deep run, which
          takes minutes where Standard takes seconds. */}
      {job.depth === "deep" && (
        <span className={cn(TAG_PILL, "shrink-0")}>
          {DEPTH_WORDS.deep.name}
        </span>
      )}
      <span className="text-[11px] text-on-surface-variant shrink-0 tabular-nums">
        {job.status === "success" && job.latencyMs != null && (
          <span className="text-success">
            {(job.latencyMs / 1000).toFixed(1)}s
          </span>
        )}
        {job.status === "success" && job.fieldsUpdated > 0 && (
          <span className="ml-1 opacity-60">+{job.fieldsUpdated}</span>
        )}
        {job.status === "success" && job.fieldsUpdated === 0 && (
          <span className="ml-1 opacity-60">
            {job.outcome === "no-public-info"
              ? "No public info"
              : "Nothing new"}
          </span>
        )}
        {job.status === "error" && (
          <span className="text-error font-bold" title={job.error}>
            Error
          </span>
        )}
        {job.status === "searching" && (
          <span className="text-primary opacity-60">Searching…</span>
        )}
        {job.status === "merging" && (
          <span className="text-warning opacity-60">Merging…</span>
        )}
      </span>
      {job.status === "cancelled" && (
        <span className="text-xs text-on-surface-variant">Stopped</span>
      )}
      {job.status === "error" && (
        <p className="w-full pl-6 text-xs text-error break-words">
          {job.error || "Research failed. Open this contact to retry"}
        </p>
      )}
    </div>
  );
}
