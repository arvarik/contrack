import React, { useState } from "react";
import { ArchiveRestore, Loader2, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { useTrash, useRestoreContact, usePurgeTrashedContact } from "../api";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { CARD, ICON_BTN, SECTION_HEADING } from "../lib/styles";
import { EmptyState } from "../components/ui/EmptyState";
import { CorvidMark } from "../components/brand/CorvidMark";
import { cn } from "../lib/utils";
import { fallbackAvatarUrl } from "../lib/avatar";
import type { TrashedContact } from "../types";
import { SETTINGS_PAGE } from "./settings/layout";

// ---------------------------------------------------------------------------
// TrashView — recently deleted contacts with restore + permanent delete
//
// The same shape as Archived contacts: one card, a strip that counts what is
// in it, and a row for each contact with Restore and Delete forever. Delete
// forever asks first, with the red button and the verb repeated.
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

const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;

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
        toast.success(`Deleted ${name} forever`);
      },
      onError: (err) =>
        toast.error(
          `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
    });
  };

  if (isLoading) {
    return (
      <div className={cn(SETTINGS_PAGE, "flex justify-center py-12")}>
        <Loader2
          aria-label="Loading Trash"
          className="w-6 h-6 animate-spin text-primary"
        />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      /*
        No number in the sentence. The server's window is TRASH_RETENTION_DAYS
        (30 by default), and the client cannot read what an instance set.
      */
      <div className={SETTINGS_PAGE}>
        <EmptyState
          illustration={<CorvidMark size={64} className="text-primary/60" />}
          title="Trash is empty"
        />
      </div>
    );
  }

  return (
    <div className={SETTINGS_PAGE}>
      <div className={cn(CARD, "p-0")}>
        <p
          className={cn(
            SECTION_HEADING,
            "px-4 sm:px-6 py-3 bg-surface-container-low rounded-t-2xl",
          )}
        >
          {items.length} {items.length === 1 ? "contact" : "contacts"} · removed
          for good {days(retentionDays)} after deletion
        </p>
        <div className="py-2">
          <AnimatePresence initial={false}>
            {items.map((item) => {
              const daysLeft = daysUntilPurge(item.deletedAt, retentionDays);
              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  className="flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-2.5"
                >
                  <img
                    src={item.avatarUrl || fallbackAvatarUrl(item.name)}
                    alt=""
                    className="w-10 h-10 rounded-full object-cover bg-surface-container-high grayscale opacity-70 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-on-surface truncate">
                      {item.name}
                    </p>
                    <p className="text-xs text-on-surface-variant truncate">
                      {item.company ? `${item.company} · ` : ""}
                      {deletedLabel(item.deletedAt)} · gone for good in{" "}
                      {days(daysLeft)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRestore(item)}
                    disabled={restore.isPending}
                    className="btn-secondary btn-sm shrink-0"
                    aria-label={`Restore ${item.name}`}
                  >
                    <ArchiveRestore
                      aria-hidden="true"
                      className="w-3.5 h-3.5"
                    />
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => setPurgeTarget(item)}
                    disabled={purge.isPending}
                    className={cn(ICON_BTN, "hover:text-error shrink-0")}
                    title="Delete forever"
                    aria-label={`Delete ${item.name} forever`}
                  >
                    <Trash2 aria-hidden="true" className="w-4 h-4" />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!purgeTarget}
        onClose={() => setPurgeTarget(null)}
        onConfirm={handlePurge}
        title={`Delete ${purgeTarget?.name ?? "this contact"} forever?`}
        description={
          <p>
            <strong className="text-on-surface">{purgeTarget?.name}</strong> and
            their whole history, with every interaction, note, and action item,
            are deleted. This cannot be undone
          </p>
        }
        confirmLabel="Delete forever"
        tone="danger"
        busy={purge.isPending}
      />
    </div>
  );
};
