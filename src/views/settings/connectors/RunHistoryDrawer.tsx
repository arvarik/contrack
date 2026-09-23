/**
 * RunHistoryDrawer — shows recent sync runs for a connector.
 *
 * Displays up to 20 past runs with trigger source, duration, imported counts,
 * error messages, and a "Copy details" button for debugging.
 *
 * @module views/settings/connectors/RunHistoryDrawer
 */

import React, { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, History, Loader2 } from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Badge, type BadgeTone } from "../../../components/ui/Badge";
import { useConnectorRuns } from "../../../api/connectors";
import { formatRelative, formatWhen } from "../../../lib/datetime";
import { copyToClipboard, CLIPBOARD_DENIED } from "../../../lib/clipboard";
import { TONE_WASH } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import type {
  ConnectorRun,
  ConnectorSummary,
} from "../../../../shared/connectors";

interface RunHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  connector: ConnectorSummary | null;
}

function statusTone(status: string): BadgeTone {
  switch (status) {
    case "ok":
    case "completed":
      return "success";
    case "error":
    case "failed":
      return "danger";
    case "running":
      return "primary";
    default:
      return "neutral";
  }
}

function computeDuration(run: ConnectorRun): string {
  if (!run.finishedAt || !run.startedAt) return "—";
  const ms =
    new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatStats(stats: Record<string, number> | null): string {
  if (!stats) return "No items processed";
  const parts: string[] = [];
  if (stats.meetings)
    parts.push(`${stats.meetings} meeting${stats.meetings === 1 ? "" : "s"}`);
  if (stats.messages)
    parts.push(`${stats.messages} message${stats.messages === 1 ? "" : "s"}`);
  if (stats.interactions && !stats.meetings && !stats.messages) {
    parts.push(
      `${stats.interactions} interaction${stats.interactions === 1 ? "" : "s"}`,
    );
  }
  if (stats.ghosts)
    parts.push(
      `${stats.ghosts} new ${stats.ghosts === 1 ? "person" : "people"} seen`,
    );
  if (stats.errors)
    parts.push(`${stats.errors} error${stats.errors === 1 ? "" : "s"}`);
  if (stats.skipped) parts.push(`${stats.skipped} skipped`);
  if (parts.length === 0) {
    return `${stats.fetched ?? 0} fetched`;
  }
  return parts.join(" · ");
}

export const RunHistoryDrawer: React.FC<RunHistoryDrawerProps> = ({
  isOpen,
  onClose,
  connector,
}) => {
  const { data: runs, isLoading } = useConnectorRuns(connector?.id, 20);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (run: ConnectorRun) => {
    try {
      await copyToClipboard(JSON.stringify(run, null, 2));
      setCopiedId(run.id);
      toast.success("Run details copied to clipboard");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error(CLIPBOARD_DENIED);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={connector ? `Run history for ${connector.name}` : "Run history"}
      size="lg"
    >
      <div className="space-y-4 pt-2">
        {isLoading && (
          <div className="flex items-center justify-center py-12 text-on-surface-variant">
            <Loader2 className="w-5 h-5 animate-spin mr-2" aria-hidden="true" />
            <span className="text-sm">Loading runs…</span>
          </div>
        )}

        {!isLoading && (!runs || runs.length === 0) && (
          <EmptyState
            icon={History}
            title="No syncs yet"
            body="Each sync shows up here once the connector runs."
            level={3}
          />
        )}

        {/* A tile for each run, on the dialog's wash: no line between. */}
        {!isLoading && runs && runs.length > 0 && (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {runs.map((run) => (
              <div
                key={run.id}
                className="rounded-xl bg-surface-container-low p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                    <span className="text-xs font-semibold text-on-surface capitalize">
                      {run.trigger} run
                    </span>
                    <span className="text-xs text-on-surface-variant">·</span>
                    <span
                      className="text-xs text-on-surface-variant truncate"
                      title={formatWhen(run.startedAt)}
                    >
                      {formatRelative(run.startedAt)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-mono text-on-surface-variant">
                      {computeDuration(run)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(run)}
                      aria-label="Copy run details"
                      className="hit-area state-layer p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface transition-colors"
                      title="Copy JSON details"
                    >
                      {copiedId === run.id ? (
                        <Check
                          className="w-3.5 h-3.5 text-success"
                          aria-hidden="true"
                        />
                      ) : (
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Stats */}
                <div className="text-xs text-on-surface-variant">
                  {formatStats(run.stats as Record<string, number> | null)}
                </div>

                {/* Error */}
                {run.error && (
                  <div
                    role="alert"
                    className={cn(
                      "rounded-lg p-2 text-xs font-mono break-all",
                      TONE_WASH.error,
                    )}
                  >
                    {run.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
};
