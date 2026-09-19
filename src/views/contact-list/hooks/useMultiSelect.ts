/**
 * useMultiSelect — Multi-select state and bulk action handlers for the contact list.
 *
 * Manages the selection lifecycle (enter/exit mode, toggle individual, select all)
 * and delegates bulk mutation side-effects to `useBulkActions`.
 *
 * @param filteredContacts - The currently visible contacts (post-filter/search).
 *        Used by `selectAll` to select only what the user can see.
 */
import { useState, useCallback, useRef } from "react";
import { useBulkActions } from "../../../components/bulk/useBulkActions";
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

  const enterSelectMode = useCallback(() => {
    setIsSelectMode(true);
    setSelectedIds(new Set());
  }, []);

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const bulkActions = useBulkActions({
    selectedIds,
    onComplete: exitSelectMode,
    contacts: filteredContacts,
  });

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

  const selectedCount = selectedIds.size;

  return {
    isSelectMode,
    selectedIds,
    selectedCount,
    isPending: bulkActions.isPending,
    isBulkDeletePending: bulkActions.isBulkDeletePending,
    isBulkAddToListPending: bulkActions.isBulkAddToListPending,
    isBulkEditPending: bulkActions.isBulkEditPending,
    isAddToListOpen: bulkActions.isAddToListOpen,
    setIsAddToListOpen: bulkActions.setIsAddToListOpen,
    isBulkEditOpen: bulkActions.isBulkEditOpen,
    setIsBulkEditOpen: bulkActions.setIsBulkEditOpen,
    enterSelectMode,
    exitSelectMode,
    toggleSelect,
    clearSelection,
    selectAll,
    handleBulkDelete: bulkActions.handleBulkDelete,
    handleBulkArchive: bulkActions.handleBulkArchive,
    handleBulkAddToList: bulkActions.handleBulkAddToList,
    handleBulkColorChange: bulkActions.handleBulkColorChange,
    handleBulkEditApply: bulkActions.handleBulkEditApply,
    handleExportCSV: bulkActions.handleExportCSV,
  };
}
