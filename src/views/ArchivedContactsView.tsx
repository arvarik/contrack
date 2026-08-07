import React, { useState, useCallback } from "react";
import {
  Archive,
  ArchiveRestore,
  User,
  Square,
  CheckSquare,
  CheckCheck,
  Trash2,
} from "lucide-react";
import {
  useArchivedContacts,
  useUnarchiveContact,
  useBulkUpdateContacts,
  useBulkDeleteContacts,
  useBulkRestoreContacts,
} from "../api";
import { HealthRingAvatar } from "../components/HealthRingAvatar";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { toastUndoableDelete } from "../lib/undoToast";
import { CARD, SECTION_HEADING, EMPTY_STATE, ICON_BTN } from "../lib/styles";
import { cn } from "../lib/utils";
import { FloatingContactCard } from "../components/FloatingContactCard";

// ---------------------------------------------------------------------------
// ArchivedContactsView — lists archived contacts with individual + bulk restore
// ---------------------------------------------------------------------------

export const ArchivedContactsView = () => {
  const { data: contacts = [], isLoading } = useArchivedContacts();
  const unarchive = useUnarchiveContact();
  const bulkUpdate = useBulkUpdateContacts();
  const bulkDelete = useBulkDeleteContacts();
  const bulkRestore = useBulkRestoreContacts();

  // ── Multi-select state ────────────────────────────────────────────────
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [floatingContactId, setFloatingContactId] = useState<string | null>(
    null,
  );

  const enterSelectMode = () => {
    setIsSelectMode(true);
    setSelectedIds(new Set());
  };
  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const selectAll = () => setSelectedIds(new Set(contacts.map((c) => c.id)));
  const selectedCount = selectedIds.size;

  // ── Individual restore ────────────────────────────────────────────────
  const handleUnarchive = (id: string, name: string) => {
    unarchive.mutate(id, {
      onSuccess: () => toast.success(`${name} restored to network`),
      onError: (err) =>
        toast.error(
          `Failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
    });
  };

  // ── Bulk restore ──────────────────────────────────────────────────────
  const handleBulkRestore = () => {
    const ids = Array.from(selectedIds) as string[];
    bulkUpdate.mutate(
      { ids, data: { isArchived: false } },
      {
        onSuccess: ({ count }) => {
          toast.success(
            `Restored ${count} contact${count !== 1 ? "s" : ""} to network`,
          );
          exitSelectMode();
        },
        onError: (err) =>
          toast.error(
            `Restore failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
      },
    );
  };

  // ── Bulk delete ───────────────────────────────────────────────────────
  /**
   * Deleting an archived contact is the same soft delete as anywhere else —
   * it moves to Trash for 30 days. This used to report "Permanently deleted",
   * which was simply untrue.
   */
  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds) as string[];
    bulkDelete.mutate(ids, {
      onSuccess: ({ count }) => {
        toastUndoableDelete({
          count,
          onUndo: () =>
            bulkRestore.mutate(ids, {
              onError: (err) =>
                toast.error(
                  `Could not restore: ${err instanceof Error ? err.message : String(err)}`,
                ),
            }),
        });
        exitSelectMode();
      },
      onError: (err) =>
        toast.error(
          `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
    });
  };

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-6 pb-28">
      {/*
        Description and actions only — the Settings shell above already
        renders the archive icon and the "Archived Contacts" heading, and
        printing them again here stacked two headers with the same words.
      */}
      <div className="flex items-start gap-3 mb-2">
        <p className="flex-1 min-w-0 text-sm text-on-surface-variant">
          Archived contacts are hidden from your Network and Map, but remain
          accessible here and via Ask Contrack.
        </p>

        {/* Multi-select toggle */}
        {contacts.length > 0 && (
          <button
            onClick={isSelectMode ? exitSelectMode : enterSelectMode}
            className={cn(
              ICON_BTN,
              isSelectMode && "text-primary bg-primary/10",
            )}
            title={isSelectMode ? "Exit Select Mode" : "Multi-Select"}
          >
            {isSelectMode ? (
              <CheckSquare className="w-5 h-5" />
            ) : (
              <Square className="w-5 h-5" />
            )}
          </button>
        )}

        {/* Select All / Deselect All */}
        {isSelectMode && (
          <button
            onClick={
              selectedCount === contacts.length
                ? () => setSelectedIds(new Set())
                : selectAll
            }
            className="text-xs font-bold text-primary px-3 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/15 transition-colors whitespace-nowrap"
          >
            {selectedCount === contacts.length ? "Deselect All" : "Select All"}
          </button>
        )}
      </div>

      {isLoading && (
        <div className="flex justify-center p-12">
          <div className="animate-pulse w-6 h-6 rounded-full bg-amber-500/20" />
        </div>
      )}

      {!isLoading && contacts.length === 0 && (
        <div className={cn(EMPTY_STATE, "flex flex-col items-center py-16")}>
          <Archive className="w-10 h-10 text-on-surface-variant/30 mb-4" />
          <p className="font-semibold text-sm">No archived contacts</p>
          <p className="text-xs mt-1 text-on-surface-variant">
            Archive contacts from their detail page to hide them from your
            Network.
          </p>
        </div>
      )}

      {!isLoading && contacts.length > 0 && (
        <div className={cn(CARD, "p-0 overflow-hidden")}>
          <div className="px-6 py-4 bg-surface-container-low">
            <span className={cn(SECTION_HEADING, "flex items-center gap-2")}>
              <User className="w-3.5 h-3.5" />
              {contacts.length} contact{contacts.length !== 1 ? "s" : ""}{" "}
              archived
            </span>
          </div>
          <AnimatePresence initial={false}>
            {contacts.map((contact, i) => {
              const isSelected = selectedIds.has(contact.id);
              return (
                <motion.div
                  key={contact.id}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => {
                    if (isSelectMode) {
                      toggleSelect(contact.id);
                      return;
                    }
                    setFloatingContactId(contact.id);
                  }}
                  className={cn(
                    "flex items-center gap-4 px-6 py-4 transition-colors group cursor-pointer",
                    isSelectMode &&
                      isSelected &&
                      "bg-primary/8 ring-inset ring-2 ring-primary/30",
                    "hover:bg-surface-container-low",
                  )}
                >
                  {/* Checkbox */}
                  <AnimatePresence>
                    {isSelectMode && (
                      <motion.div
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.6, opacity: 0 }}
                        className="shrink-0"
                      >
                        <div
                          className={cn(
                            "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all",
                            isSelected
                              ? "bg-primary border-primary"
                              : "border-on-surface-variant/40 bg-surface-container-low",
                          )}
                        >
                          {isSelected && (
                            <CheckCheck className="w-3 h-3 text-white" />
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <HealthRingAvatar contact={contact} size={44} />
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-amber-500/90 rounded-full flex items-center justify-center shadow-sm">
                      <Archive className="w-2.5 h-2.5 text-white" />
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm text-on-surface group-hover:text-primary transition-colors truncate block text-left">
                      {contact.name}
                    </span>
                    {(contact.role || contact.company) && (
                      <p className="text-xs text-on-surface-variant mt-0.5 truncate">
                        {[contact.role, contact.company]
                          .filter(Boolean)
                          .join(" at ")}
                      </p>
                    )}
                  </div>

                  {/* Archived date */}
                  <span className="text-[10px] text-on-surface-variant opacity-50 hidden sm:block shrink-0">
                    {contact.updatedAt
                      ? new Date(contact.updatedAt).toLocaleDateString(
                          undefined,
                          { month: "short", day: "numeric", year: "numeric" },
                        )
                      : ""}
                  </span>

                  {/* Individual restore button (hidden in select mode) */}
                  {!isSelectMode && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUnarchive(contact.id, contact.name);
                      }}
                      disabled={unarchive.isPending}
                      title="Restore to Network"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-warning bg-amber-500/10 hover:bg-amber-500/20 transition-colors opacity-0 group-hover:opacity-100 shrink-0 disabled:opacity-50"
                    >
                      <ArchiveRestore className="w-3.5 h-3.5" />
                      Restore
                    </button>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* ── Bulk Action Bottom Toolbar ──────────────────────────────────────── */}
      <AnimatePresence>
        {isSelectMode && selectedCount > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 300 }}
            className="fixed bottom-6 left-0 right-0 z-40 px-6 max-w-4xl mx-auto"
          >
            <div className="glass-panel rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-2">
              {/* Selected count */}
              <span className="text-sm font-bold text-on-surface mr-2 shrink-0">
                <span className="text-primary">{selectedCount}</span> selected
              </span>

              <div className="flex-1" />

              {/* Restore */}
              <button
                onClick={handleBulkRestore}
                disabled={bulkUpdate.isPending}
                className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-warning hover:bg-amber-500/10 transition-colors disabled:opacity-40 shrink-0"
              >
                <ArchiveRestore className="w-4 h-4" />
                <span className="text-[9px] font-bold uppercase tracking-widest opacity-80">
                  {bulkUpdate.isPending ? "Restoring…" : "Restore"}
                </span>
              </button>

              <div className="w-px h-6 bg-surface-container-high mx-1" />

              {/* Delete Permanently */}
              <button
                onClick={() => handleBulkDelete()}
                disabled={bulkDelete.isPending}
                className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-error hover:bg-rose-500/10 transition-colors disabled:opacity-40 shrink-0"
              >
                <Trash2 className="w-4 h-4" />
                <span className="text-[9px] font-bold uppercase tracking-widest opacity-80">
                  Delete
                </span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Contact Card overlay */}
      <FloatingContactCard
        contactId={floatingContactId}
        isOpen={!!floatingContactId}
        onClose={() => setFloatingContactId(null)}
      />
    </div>
  );
};
