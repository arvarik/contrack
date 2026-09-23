import React, { useState, useCallback } from "react";
import {
  Archive,
  ArchiveRestore,
  CheckCheck,
  Loader2,
  Trash2,
} from "lucide-react";
import {
  useArchivedContacts,
  useUnarchiveContact,
  useBulkUpdateContacts,
  useBulkDeleteContacts,
  useBulkRestoreContacts,
} from "../api";
import { ScoreRingAvatar } from "../components/ScoreRingAvatar";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { formatDay } from "../lib/datetime";
import { toastUndoableDelete } from "../lib/undoToast";
import {
  BAR_BUTTON,
  BAR_LABEL,
  BTN_QUIET,
  CARD,
  SECTION_HEADING,
  SELECTED_ROW,
} from "../lib/styles";
import { DURATION, EASE } from "../lib/motion";
import { EmptyState } from "../components/ui/EmptyState";
import { CorvidMark } from "../components/brand/CorvidMark";
import { cn } from "../lib/utils";
import { FloatingContactCard } from "../components/FloatingContactCard";
import { SETTINGS_PAGE } from "./settings/layout";

// ---------------------------------------------------------------------------
// ArchivedContactsView — lists archived contacts with individual + bulk restore
//
// One card: a strip that counts the contacts and holds Select, then a row for
// each contact with Restore. The page's header above says what the page is
// for. A row opens the contact's card; its name is the button a keyboard
// reaches, since the row itself is not one.
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
    // The bottom padding stays tall at every width: the bulk bar floats over
    // the end of the list.
    <div className={cn(SETTINGS_PAGE, "md:pb-28")}>
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2
            aria-label="Loading archived contacts"
            className="w-6 h-6 animate-spin text-primary"
          />
        </div>
      )}

      {!isLoading && contacts.length === 0 && (
        <EmptyState
          illustration={<CorvidMark size={64} className="text-primary/60" />}
          title="No archived contacts"
          body="Archive contacts from their detail page to hide them from your Network."
        />
      )}

      {!isLoading && contacts.length > 0 && (
        <div className={cn(CARD, "p-0")}>
          <div className="flex items-center gap-2 px-4 sm:px-6 py-2 min-h-[48px] bg-surface-container-low rounded-t-2xl">
            <span className={cn(SECTION_HEADING, "flex-1 min-w-0")}>
              {contacts.length} {contacts.length === 1 ? "contact" : "contacts"}{" "}
              archived
            </span>
            {isSelectMode && (
              <button
                type="button"
                onClick={
                  selectedCount === contacts.length
                    ? () => setSelectedIds(new Set())
                    : selectAll
                }
                className={BTN_QUIET}
              >
                {selectedCount === contacts.length
                  ? "Deselect all"
                  : "Select all"}
              </button>
            )}
            <button
              type="button"
              onClick={isSelectMode ? exitSelectMode : enterSelectMode}
              aria-pressed={isSelectMode}
              className={BTN_QUIET}
            >
              {isSelectMode ? "Done" : "Select"}
            </button>
          </div>
          <AnimatePresence initial={false}>
            {contacts.map((contact, i) => {
              const isSelected = selectedIds.has(contact.id);
              return (
                <motion.div
                  key={contact.id}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{
                    opacity: 0,
                    x: 40,
                    transition: { duration: DURATION.slow, ease: EASE },
                  }}
                  transition={{
                    duration: DURATION.slow,
                    ease: EASE,
                    delay: i * 0.03,
                  }}
                  onClick={() => {
                    if (isSelectMode) {
                      toggleSelect(contact.id);
                      return;
                    }
                    setFloatingContactId(contact.id);
                  }}
                  className={cn(
                    "state-layer flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-3 transition-colors cursor-pointer",
                    isSelectMode && isSelected && SELECTED_ROW,
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
                            "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors",
                            isSelected
                              ? "bg-primary border-primary"
                              : "border-on-surface-variant/40 bg-surface-container-low",
                          )}
                        >
                          {isSelected && (
                            <CheckCheck className="w-3 h-3 text-on-primary" />
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Avatar. The row is not a control, so the ring keeps its
                      own name ("Score 72, strong") and its tooltip. */}
                  <div className="relative shrink-0">
                    <ScoreRingAvatar contact={contact} size={44} ring="list" />
                    {/* The warning ink on the card face, like the contact
                        page's Archived badge. White on a raw amber measured
                        about 2 to 1. */}
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-surface-container-lowest text-warning rounded-full flex items-center justify-center shadow-sm">
                      <Archive className="w-2.5 h-2.5" />
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    {/* The row takes a pointer anywhere; the name is the
                        control a keyboard reaches. Its click is the row's. */}
                    <button
                      type="button"
                      aria-pressed={isSelectMode ? isSelected : undefined}
                      className="font-semibold text-sm text-on-surface truncate block max-w-full text-left rounded-md"
                    >
                      {contact.name}
                    </button>
                    {(contact.role || contact.company) && (
                      <p className="text-xs text-on-surface-variant mt-0.5 truncate">
                        {[contact.role, contact.company]
                          .filter(Boolean)
                          .join(" at ")}
                      </p>
                    )}
                  </div>

                  {/* Archived date */}
                  <span className="text-xs text-on-surface-variant hidden sm:block shrink-0">
                    {formatDay(contact.updatedAt, "")}
                  </span>

                  {/* Individual restore button (hidden in select mode) */}
                  {!isSelectMode && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUnarchive(contact.id, contact.name);
                      }}
                      disabled={unarchive.isPending}
                      aria-label={`Restore ${contact.name}`}
                      className="btn-secondary btn-sm shrink-0"
                    >
                      <ArchiveRestore
                        aria-hidden="true"
                        className="w-3.5 h-3.5"
                      />
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
            // Sticks to the bottom of the page's scroller, above the phone's
            // tab bar, in the page's own column.
            className="sticky bottom-24 md:bottom-6 z-40 mt-6"
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
                className={cn(BAR_BUTTON, "text-warning disabled:opacity-40")}
              >
                <ArchiveRestore className="w-4 h-4" />
                <span className={BAR_LABEL}>
                  {bulkUpdate.isPending ? "Restoring…" : "Restore"}
                </span>
              </button>

              <div className="w-px h-6 bg-surface-container-high mx-1" />

              {/* Delete: moves them to Trash, with an undo */}
              <button
                onClick={() => handleBulkDelete()}
                disabled={bulkDelete.isPending}
                className={cn(BAR_BUTTON, "text-error disabled:opacity-40")}
              >
                <Trash2 className="w-4 h-4" />
                <span className={BAR_LABEL}>Delete</span>
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
