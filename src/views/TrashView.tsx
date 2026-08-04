import React, { useState } from "react";
import { Trash2, ArchiveRestore, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { useTrash, useRestoreContact, usePurgeTrashedContact } from "../api";
import { Modal } from "../components/ui/Modal";
import { CARD, EMPTY_STATE, ICON_BTN } from "../lib/styles";
import { cn } from "../lib/utils";
import { fallbackAvatarUrl } from "../lib/avatar";
import type { TrashedContact } from "../types";

// ---------------------------------------------------------------------------
// TrashView — recently deleted contacts with restore + permanent delete
// ---------------------------------------------------------------------------

/** Matches the server default; overridable via TRASH_RETENTION_DAYS. */
const RETENTION_DAYS = 30;

function daysUntilPurge(deletedAt: string): number {
  const purgeAt = new Date(deletedAt).getTime() + RETENTION_DAYS * 86_400_000;
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
  const { data: items = [], isLoading } = useTrash();
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
      <div className={cn(EMPTY_STATE, "m-6")}>
        <Trash2 className="w-10 h-10 text-on-surface-variant/40 mx-auto mb-4" />
        <p className="font-bold">Trash is empty</p>
        <p className="text-sm text-on-surface-variant mt-1">
          Deleted contacts stay here for {RETENTION_DAYS} days before being
          removed forever.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <p className="text-sm text-on-surface-variant">
          {items.length} contact{items.length !== 1 ? "s" : ""} in the trash.
          Each is removed forever {RETENTION_DAYS} days after deletion.
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
                  {daysUntilPurge(item.deletedAt)} day
                  {daysUntilPurge(item.deletedAt) !== 1 ? "s" : ""}
                </div>
              </div>
              <button
                onClick={() => handleRestore(item)}
                disabled={restore.isPending}
                className={cn(ICON_BTN, "text-emerald-600")}
                title="Restore contact"
                aria-label={`Restore ${item.name}`}
              >
                <ArchiveRestore className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPurgeTarget(item)}
                disabled={purge.isPending}
                className={cn(ICON_BTN, "text-red-500")}
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
            <div className="w-10 h-10 shrink-0 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center">
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
              className="px-4 py-2 rounded-xl text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handlePurge}
              disabled={purge.isPending}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              {purge.isPending ? "Deleting…" : "Delete forever"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
