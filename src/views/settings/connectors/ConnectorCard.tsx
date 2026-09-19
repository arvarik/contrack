/**
 * ConnectorCard — displays a single configured connector.
 *
 * Shows kind icon, name, status badge, sync schedules, last run statistics,
 * inline error or reauth states, and an action menu (Sync now, Pause/Resume,
 * Edit, Run history, Remove).
 *
 * @module views/settings/connectors/ConnectorCard
 */

import React, { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Calendar,
  Globe,
  History,
  KeyRound,
  Loader2,
  Mail,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Badge, type BadgeTone } from "../../../components/ui/Badge";
import { ActionMenu } from "../../../components/ui/ActionMenu";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { formatRelative } from "../../../lib/datetime";
import {
  useDeleteConnector,
  useSyncConnector,
  useUpdateConnector,
} from "../../../api/connectors";
import type {
  ConnectorKind,
  ConnectorStatus,
  ConnectorSummary,
} from "../../../../shared/connectors";

interface ConnectorCardProps {
  connector: ConnectorSummary;
  onEdit: (connector: ConnectorSummary) => void;
  onShowRuns: (connector: ConnectorSummary) => void;
  onReconnect?: (connector: ConnectorSummary) => void;
}

const KIND_ICONS: Record<ConnectorKind, LucideIcon> = {
  ics: Calendar,
  imap: Mail,
  google: Globe,
};

function statusBadgeInfo(status: ConnectorStatus): {
  tone: BadgeTone;
  label: string;
} {
  switch (status) {
    case "active":
      return { tone: "success", label: "Active" };
    case "paused":
      return { tone: "neutral", label: "Paused" };
    case "error":
      return { tone: "warning", label: "Error" };
    case "needs_reauth":
      return { tone: "danger", label: "Needs Reauth" };
    default:
      return { tone: "neutral", label: status };
  }
}

function computeTimingLine(connector: ConnectorSummary): string {
  if (connector.status === "paused") {
    return "Sync paused";
  }
  const lastSyncStr = connector.lastRunAt
    ? `Last sync ${formatRelative(connector.lastRunAt)}`
    : "Never synced";

  if (!connector.nextRunAt) {
    return lastSyncStr;
  }

  const nextMs = new Date(connector.nextRunAt).getTime() - Date.now();
  const nextMin = Math.round(nextMs / 60000);
  const nextStr =
    nextMin <= 0
      ? "due now"
      : nextMin < 60
        ? `next in ${nextMin} min`
        : `next in ${Math.round(nextMin / 60)} hr`;

  return `${lastSyncStr} · ${nextStr}`;
}

function formatStats(
  kind: ConnectorKind,
  stats: Record<string, number> | null,
): string | null {
  if (!stats) return null;
  const parts: string[] = [];
  const meetings =
    stats.meetings !== undefined
      ? stats.meetings
      : kind === "ics"
        ? stats.interactions
        : undefined;
  if (meetings) parts.push(`${meetings} meeting${meetings === 1 ? "" : "s"}`);
  if (stats.messages)
    parts.push(`${stats.messages} message${stats.messages === 1 ? "" : "s"}`);
  if (stats.interactions && !meetings && !stats.messages) {
    parts.push(
      `${stats.interactions} interaction${stats.interactions === 1 ? "" : "s"}`,
    );
  }
  if (stats.ghosts)
    parts.push(`${stats.ghosts} new ghost${stats.ghosts === 1 ? "" : "s"}`);
  if (stats.errors)
    parts.push(`${stats.errors} error${stats.errors === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export const ConnectorCard: React.FC<ConnectorCardProps> = ({
  connector,
  onEdit,
  onShowRuns,
  onReconnect,
}) => {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteImported, setDeleteImported] = useState(false);

  const sync = useSyncConnector();
  const update = useUpdateConnector();
  const remove = useDeleteConnector();

  const Icon = KIND_ICONS[connector.kind] ?? Calendar;
  const badge = statusBadgeInfo(connector.status);
  const timingLine = computeTimingLine(connector);
  const statsLine = formatStats(
    connector.kind,
    connector.lastRunStats as Record<string, number> | null,
  );

  const handleSyncNow = async () => {
    try {
      await sync.mutateAsync(connector.id);
      toast.success(`Sync started for ${connector.name}`);
    } catch (err) {
      toast.error((err as Error).message || "Failed to start sync");
    }
  };

  const handleTogglePause = async () => {
    const nextStatus = connector.status === "paused" ? "active" : "paused";
    try {
      await update.mutateAsync({
        id: connector.id,
        status: nextStatus,
      });
      toast.success(
        nextStatus === "paused"
          ? `Paused ${connector.name}`
          : `Resumed ${connector.name}`,
      );
    } catch (err) {
      toast.error(
        (err as Error).message || "Failed to update connector status",
      );
    }
  };

  const handleDelete = async () => {
    try {
      await remove.mutateAsync({
        id: connector.id,
        deleteImported,
      });
      toast.success(`Removed ${connector.name}`);
      setDeleteConfirmOpen(false);
    } catch (err) {
      toast.error((err as Error).message || "Failed to delete connector");
    }
  };

  const isBusy = sync.isPending || update.isPending || remove.isPending;

  return (
    <>
      <div className="rounded-2xl bg-surface-container border border-surface-container-high/60 p-4 transition-all hover:border-surface-container-highest space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-on-surface truncate">
                  {connector.name}
                </h3>
                <Badge tone={badge.tone}>{badge.label}</Badge>
              </div>
              <p className="text-xs text-on-surface-variant mt-0.5">
                {timingLine}
              </p>
            </div>
          </div>

          <ActionMenu
            label={`Actions for ${connector.name}`}
            items={[
              {
                id: "sync",
                label: "Sync now",
                icon: RefreshCw,
                onSelect: handleSyncNow,
                disabled: isBusy || connector.status === "paused",
              },
              {
                id: "pause-resume",
                label: connector.status === "paused" ? "Resume" : "Pause",
                icon: connector.status === "paused" ? Play : Pause,
                onSelect: handleTogglePause,
                disabled: isBusy,
              },
              {
                id: "edit",
                label: "Edit",
                icon: Pencil,
                onSelect: () => onEdit(connector),
                disabled: isBusy,
              },
              {
                id: "runs",
                label: "Run history",
                icon: History,
                onSelect: () => onShowRuns(connector),
              },
              {
                id: "delete",
                label: "Remove",
                icon: Trash2,
                danger: true,
                onSelect: () => setDeleteConfirmOpen(true),
                disabled: isBusy,
              },
            ]}
          />
        </div>

        {/* Syncing indicator */}
        {sync.isPending && (
          <div
            role="status"
            className="flex items-center gap-2 text-xs text-primary font-medium"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            <span>Syncing…</span>
          </div>
        )}

        {/* Last run stats */}
        {statsLine && !sync.isPending && (
          <div className="text-xs font-mono text-on-surface-variant bg-surface-container-high/40 rounded-lg px-2.5 py-1.5 inline-block">
            {statsLine}
          </div>
        )}

        {/* Error state */}
        {connector.status === "error" && connector.lastError && (
          <div
            role="alert"
            className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-warning flex items-start justify-between gap-3"
          >
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle
                className="w-4 h-4 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="font-medium">Last sync failed</p>
                <p className="text-[11px] text-warning/90 mt-0.5 font-mono break-all">
                  {connector.lastError}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={isBusy}
              className="hit-area shrink-0 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-xs font-medium text-warning transition-colors"
            >
              Retry now
            </button>
          </div>
        )}

        {/* Needs reauth state */}
        {connector.status === "needs_reauth" && (
          <div
            role="alert"
            className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-xs text-error flex items-start justify-between gap-3"
          >
            <div className="flex items-start gap-2 min-w-0">
              <KeyRound
                className="w-4 h-4 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="font-medium">Authentication expired</p>
                <p className="text-[11px] text-error/90 mt-0.5 font-mono break-all">
                  {connector.lastError ||
                    "The server rejected credentials for this connector."}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                onReconnect ? onReconnect(connector) : onEdit(connector)
              }
              className="hit-area shrink-0 px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-xs font-medium text-error transition-colors"
            >
              Reconnect
            </button>
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDelete}
        title={`Remove ${connector.name}?`}
        confirmLabel="Remove connector"
        tone="danger"
        busy={remove.isPending}
      >
        <div className="space-y-3 pt-2">
          <p className="text-xs text-on-surface-variant">
            This will stop future syncs for this connector.
          </p>

          <label className="flex items-start gap-2 text-xs text-on-surface cursor-pointer select-none">
            <input
              type="checkbox"
              checked={deleteImported}
              onChange={(e) => setDeleteImported(e.target.checked)}
              className="mt-0.5 rounded border-surface-container-high text-primary focus:ring-primary"
            />
            <span>
              Also delete all interactions and ghost contacts created by this
              connector.
            </span>
          </label>
        </div>
      </ConfirmDialog>
    </>
  );
};
