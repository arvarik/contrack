import { useState, useCallback } from "react";
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
import { formatRelative } from "../lib/datetime";
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
import { cn, errorText, plural } from "../lib/utils";
import { FloatingContactCard } from "../components/FloatingContactCard";
import { SETTINGS_PAGE } from "./settings/layout";

// Archived contacts: one card with a strip that counts them and holds Select,
// then a row per contact with Restore. A row opens the contact's card.

export const ArchivedContactsView = () => {
  const { data: contacts = [], isLoading } = useArchivedContacts();
  const unarchive = useUnarchiveContact();
  const bulkUpdate = useBulkUpdateContacts();
  const bulkDelete = useBulkDeleteContacts();
  const bulkRestore = useBulkRestoreContacts();

  // Select mode
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

  const handleUnarchive = (id: string, name: string) => {
    unarchive.mutate(id, {
      onSuccess: () => toast.success(`${name} restored to Network`),
      onError: (err) =>
        toast.error(`Could not restore ${name}: ${errorText(err)}`),
    });
  };

  const handleBulkRestore = () => {
    const ids = Array.from(selectedIds) as string[];
    bulkUpdate.mutate(
      { ids, data: { isArchived: false } },
      {
        onSuccess: ({ count }) => {
          toast.success(
            `Restored ${plural(count, "contact", "contacts")} to Network`,
          );
          exitSelectMode();
        },
        onError: (err) =>
          toast.error(`Could not restore the contacts: ${errorText(err)}`),
      },
    );
  };

  // A soft delete, as anywhere else: the contacts move to Trash until the
  // retention runs out.
  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds) as string[];
    bulkDelete.mutate(ids, {
      onSuccess: ({ count, retentionDays }) => {
        toastUndoableDelete({
          count,
          retentionDays,
          onUndo: () =>
            bulkRestore.mutate(ids, {
              onError: (err) =>
                toast.error(`Could not restore: ${errorText(err)}`),
            }),
        });
        exitSelectMode();
      },
      onError: (err) =>
        toast.error(`Could not delete the contacts: ${errorText(err)}`),
    });
  };

  return (
    // The bottom padding stays tall at every width: the bulk bar floats over
    // the end of the list. From md the shell's own 40 px end adds to it.
    <div className={cn(SETTINGS_PAGE, "md:pb-18")}>
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
          body="Archive a contact from the menu on its page"
        />
      )}

      {!isLoading && contacts.length > 0 && (
        <div className={cn(CARD, "p-0")}>
          <div className="flex items-center gap-2 px-4 sm:px-6 py-2 min-h-[48px] bg-surface-container-low rounded-t-2xl">
            <span className={cn(SECTION_HEADING, "flex-1 min-w-0")}>
              {plural(contacts.length, "contact", "contacts")} archived
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

                  {/* The row is not a control, so the ring keeps its own name
                      and tooltip. */}
                  <div className="relative shrink-0">
                    <ScoreRingAvatar contact={contact} size={44} ring="list" />
                    {/* Warning ink on the card face, like the contact page's
                        Archived badge: white on raw amber is about 2 to 1. */}
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-surface-container-lowest text-warning rounded-full flex items-center justify-center shadow-sm">
                      <Archive className="w-2.5 h-2.5" />
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* The row takes a pointer anywhere; the name is the
                        control a keyboard reaches. Its click is the row's. */}
                    <button
                      type="button"
                      aria-pressed={isSelectMode ? isSelected : undefined}
                      className="font-semibold text-sm text-on-surface break-words block max-w-full text-left rounded-md"
                    >
                      {contact.name}
                    </button>
                    {/* "Archived" names the date, so it is not read as the
                        last edit. */}
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      {[
                        [contact.role, contact.company]
                          .filter(Boolean)
                          .join(" at "),
                        `Archived ${formatRelative(contact.archivedAt ?? contact.updatedAt, "")}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>

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

      {/* The bulk bar */}
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
              <span className="text-sm font-bold text-on-surface mr-2 shrink-0">
                <span className="text-primary">{selectedCount}</span> selected
              </span>

              <div className="flex-1" />

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

      <FloatingContactCard
        contactId={floatingContactId}
        isOpen={!!floatingContactId}
        onClose={() => setFloatingContactId(null)}
      />
    </div>
  );
};
