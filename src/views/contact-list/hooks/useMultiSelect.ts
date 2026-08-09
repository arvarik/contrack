/**
 * useMultiSelect — Multi-select state and bulk action handlers for the contact list.
 *
 * Manages the selection lifecycle (enter/exit mode, toggle individual, select all)
 * and all bulk mutation side-effects (delete, archive, add to list, color change,
 * CSV export). Returns a clean API surface that the UI shell wires to buttons.
 *
 * @param filteredContacts - The currently visible contacts (post-filter/search).
 *        Used by `selectAll` to select only what the user can see.
 */
import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { toastUndoableDelete } from "../../../lib/undoToast";
import {
  useBulkDeleteContacts,
  useBulkRestoreContacts,
  useBulkUpdateContacts,
  useBulkAddToList,
} from "../../../api";
import type { Contact } from "../../../types";

export function useMultiSelect(filteredContacts: Contact[]) {
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /**
   * The last row clicked without shift — the anchor a shift-click ranges from.
   *
   * A ref rather than state: it changes on every click but nothing renders
   * from it, and making it state would re-render the whole list to store a
   * string nobody displays.
   */
  const anchorRef = useRef<string | null>(null);

  const bulkDelete = useBulkDeleteContacts();
  const bulkRestore = useBulkRestoreContacts();
  const bulkUpdate = useBulkUpdateContacts();
  const bulkAddToList = useBulkAddToList();

  // ── Lifecycle ─────────────────────────────────────────────────────────
  const enterSelectMode = useCallback(() => {
    setIsSelectMode(true);
    setSelectedIds(new Set());
  }, []);

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  /**
   * Toggle one row, or — with `extend` — select everything between the anchor
   * and this row.
   *
   * A range *adds*; it never deselects. Shift-clicking across rows that happen
   * to be selected already and having them flip off is never what anyone
   * means by "select from here to there", and it is invisible until you look
   * at the count.
   *
   * Ranges run over `filteredContacts`, which is what is actually on screen —
   * so a range under an active search selects the rows you can see between
   * the two you clicked, not the hidden ones between them in the full list.
   */
  const toggleSelect = useCallback(
    (contactId: string, extend = false) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const anchor = anchorRef.current;

        if (extend && anchor && anchor !== contactId) {
          const ids = filteredContacts.map((c) => c.id);
          const from = ids.indexOf(anchor);
          const to = ids.indexOf(contactId);
          if (from !== -1 && to !== -1) {
            const [lo, hi] = from < to ? [from, to] : [to, from];
            for (let i = lo; i <= hi; i++) next.add(ids[i]);
            return next;
          }
          // Anchor scrolled out of the filtered set — fall through to a plain
          // toggle rather than silently doing nothing.
        }

        next.has(contactId) ? next.delete(contactId) : next.add(contactId);
        return next;
      });
      // Shift-click extends from the original anchor, so a run of shift-clicks
      // keeps growing from one point rather than walking it forward.
      if (!extend) anchorRef.current = contactId;
    },
    [filteredContacts],
  );

  /** Deselect everything while staying in select mode. */
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filteredContacts.map((c) => c.id)));
  }, [filteredContacts]);

  // ── Bulk Actions ──────────────────────────────────────────────────────

  /**
   * Delete now, offer undo — no confirmation dialog.
   *
   * This is a soft delete into a 30-day Trash, so a modal asking "are you
   * sure?" charges every correct deletion for a mistake that is already
   * recoverable. See lib/undoToast.
   */
  const handleBulkDelete = useCallback(() => {
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
  }, [selectedIds, bulkDelete, bulkRestore, exitSelectMode]);

  const handleBulkArchive = useCallback(() => {
    const ids = Array.from(selectedIds) as string[];
    bulkUpdate.mutate(
      { ids, data: { isArchived: true } },
      {
        onSuccess: ({ count }) => {
          toast.success(`Archived ${count} contact${count !== 1 ? "s" : ""}`);
          exitSelectMode();
        },
        onError: (err) =>
          toast.error(
            `Archive failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
      },
    );
  }, [selectedIds, bulkUpdate, exitSelectMode]);

  const handleBulkAddToList = useCallback(
    (listId: string) => {
      const contactIds = Array.from(selectedIds) as string[];
      bulkAddToList.mutate(
        { listId, contactIds },
        {
          onSuccess: ({ count }) => {
            toast.success(
              `Added ${count} contact${count !== 1 ? "s" : ""} to list`,
            );
            exitSelectMode();
          },
          onError: (err) =>
            toast.error(
              `Failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
        },
      );
    },
    [selectedIds, bulkAddToList, exitSelectMode],
  );

  const handleBulkColorChange = useCallback(
    (vibeId: string) => {
      const ids = Array.from(selectedIds) as string[];
      bulkUpdate.mutate(
        { ids, data: { themeColor: vibeId } },
        {
          onSuccess: ({ count }) => {
            toast.success(
              `Updated color for ${count} contact${count !== 1 ? "s" : ""}`,
            );
            exitSelectMode();
          },
          onError: (err) =>
            toast.error(
              `Color update failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
        },
      );
    },
    [selectedIds, bulkUpdate, exitSelectMode],
  );

  /** Export selected contacts as CSV to clipboard. */
  const handleExportCSV = useCallback(() => {
    const selected = filteredContacts.filter((c) => selectedIds.has(c.id));
    const header = "Name,Role,Company,Location,Email,Phone";
    const rows = selected.map((c) =>
      [
        c.name,
        c.role || "",
        c.company || "",
        c.location || "",
        c.emails?.[0]?.email || "",
        c.phones?.[0]?.phone || "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [header, ...rows].join("\n");

    const copyToClipboard = (text: string): Promise<void> => {
      // Try modern async Clipboard API first
      if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text);
      }
      // Fallback: legacy execCommand approach (works in all browsers)
      return new Promise((resolve, reject) => {
        const el = document.createElement("textarea");
        el.value = text;
        el.style.cssText =
          "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
        document.body.appendChild(el);
        el.focus();
        el.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(el);
        ok ? resolve() : reject(new Error("execCommand copy failed"));
      });
    };

    copyToClipboard(csv)
      .then(() => {
        toast.success(
          `Copied ${selected.length} contact${selected.length !== 1 ? "s" : ""} as CSV`,
        );
        exitSelectMode();
      })
      .catch(() => {
        toast.error(
          "Clipboard access denied — please allow clipboard permissions and try again.",
        );
      });
  }, [filteredContacts, selectedIds, exitSelectMode]);

  const selectedCount = selectedIds.size;
  const isPending =
    bulkUpdate.isPending || bulkDelete.isPending || bulkAddToList.isPending;

  return {
    isSelectMode,
    selectedIds,
    selectedCount,
    isPending,
    isBulkDeletePending: bulkDelete.isPending,
    isBulkAddToListPending: bulkAddToList.isPending,
    enterSelectMode,
    exitSelectMode,
    toggleSelect,
    clearSelection,
    selectAll,
    handleBulkDelete,
    handleBulkArchive,
    handleBulkAddToList,
    handleBulkColorChange,
    handleExportCSV,
  };
}
