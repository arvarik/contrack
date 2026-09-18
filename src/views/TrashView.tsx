import React, { useState } from "react";
import { Trash2, ArchiveRestore, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { useTrash, useRestoreContact, usePurgeTrashedContact } from "../api";
import { Modal } from "../components/ui/Modal";
import { CARD, ICON_BTN } from "../lib/styles";
import { EmptyState } from "../components/ui/EmptyState";
import { CorvidMark } from "../components/brand/CorvidMark";
import { cn } from "../lib/utils";
import { fallbackAvatarUrl } from "../lib/avatar";
import type { TrashedContact } from "../types";

// ---------------------------------------------------------------------------
// TrashView — recently deleted contacts with restore + permanent delete
// ---------------------------------------------------------------------------

function daysUntilPurge(deletedAt: string, retentionDays = 30): number {
  const purgeAt = new Date(deletedAt).getTime() + retentionDays * 86_400_000;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / 86_400_000));
}

function deletedLabel(deletedAt: string): string {
  const days = Math.floor(
    (Date.now() - new Date(deletedAt).getTime()) / 86_400_000,
  );
  if (days <= 0) return "Deleted today";
  if (days === 1) return "Deleted yesterday";
  return `Deleted ${days} days ago`;
}

export const TrashView = () => {
  const { data, isLoading } = useTrash();
  const items = data?.items ?? [];
  const retentionDays = data?.retentionDays ?? 30;
  const restore = useRestoreContact();
  const purge = usePurgeTrashedContact();
  const [purgeTarget, setPurgeTarget] = useState<TrashedContact | null>(null);

  const handleRestore = (item: TrashedContact) => {
    restore.mutate(item.id, {
      onSuccess: () => toast.success(`Restored ${item.name}`),
      onError: (err) =>
        toast.error(
          `Restore failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
    });
  };

  const handlePurge = () => {
    if (!purgeTarget) return;
    const { id, name } = purgeTarget;
    purge.mutate(id, {
      onSuccess: () => {
        setPurgeTarget(null);
        toast.success(`Permanently deleted ${name}`);
      },
      onError: (err) =>
        toast.error(
          `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
    });
  };

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-on-surface-variant">Loading trash…</div>
    );
  }

  if (items.length === 0) {
    return (
      /*
        No number in the sentence. The server's window is TRASH_RETENTION_DAYS
        (30 by default), and the client cannot read what an instance set.
      */
      <EmptyState
        illustration={<CorvidMark size={64} className="text-primary/60" />}
        title="Trash is empty"
        body="You can restore a deleted contact from here until it is removed for good."
      />
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <p className="text-sm text-on-surface-variant">
          {items.length} contact{items.length !== 1 ? "s" : ""} in the trash.
          Each is removed forever {retentionDays} days after deletion.
        </p>
      </div>

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -24 }}
              className={cn(CARD, "flex items-center gap-4 py-3")}
            >
              <img
                src={item.avatarUrl || fallbackAvatarUrl(item.name)}
                alt={item.name}
                className="w-10 h-10 rounded-full object-cover bg-surface-container-high grayscale opacity-70"
              />
              <div className="flex-1 min-w-0">
                <div className="font-bold truncate">{item.name}</div>
                <div className="text-xs text-on-surface-variant truncate">
                  {item.company ? `${item.company} · ` : ""}
                  {deletedLabel(item.deletedAt)} · purges in{" "}
                  {daysUntilPurge(item.deletedAt, retentionDays)} day
                  {daysUntilPurge(item.deletedAt, retentionDays) !== 1
                    ? "s"
                    : ""}
                </div>
              </div>
              <button
                onClick={() => handleRestore(item)}
                disabled={restore.isPending}
                className={cn(ICON_BTN, "text-success")}
                title="Restore contact"
                aria-label={`Restore ${item.name}`}
              >
                <ArchiveRestore className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPurgeTarget(item)}
                disabled={purge.isPending}
                className={cn(ICON_BTN, "text-error")}
                title="Delete forever"
                aria-label={`Permanently delete ${item.name}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <Modal
        isOpen={!!purgeTarget}
        onClose={() => setPurgeTarget(null)}
        title="Delete forever?"
      >
        <div className="space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 shrink-0 bg-red-500/10 text-error rounded-full flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <p className="text-sm text-on-surface-variant">
              <strong className="text-on-surface">{purgeTarget?.name}</strong>{" "}
              and their entire history (interactions, notes, action items) will
              be permanently deleted. This cannot be undone.
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setPurgeTarget(null)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handlePurge}
              disabled={purge.isPending}
              className="px-4 py-2 min-h-[44px] sm:min-h-[40px] rounded-xl text-sm font-bold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              {purge.isPending ? "Deleting…" : "Delete forever"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
