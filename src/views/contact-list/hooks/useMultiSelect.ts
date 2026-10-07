/**
 * Select mode and its selection for the contact list. The bulk actions come
 * from `useBulkActions`. Select all and ranges cover `filteredContacts`, the
 * rows on screen.
 */
import { useState, useCallback, useRef } from "react";
import { useBulkActions } from "../../../components/bulk/useBulkActions";
import type { Contact } from "../../../types";

export function useMultiSelect(filteredContacts: Contact[]) {
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // The last row clicked without shift, where a shift-click range starts. A
  // ref, since nothing renders from it.
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

  // Toggle one row, or with `extend` add every row from the anchor to this
  // one. A range only adds, never deselects.
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
          // The anchor left the filtered set: a plain toggle.
        }

        next.has(contactId) ? next.delete(contactId) : next.add(contactId);
        return next;
      });
      // A run of shift-clicks grows from one anchor.
      if (!extend) anchorRef.current = contactId;
    },
    [filteredContacts],
  );

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
    selectionTracked: bulkActions.selectionTracked,
    handleBulkTrack: bulkActions.handleBulkTrack,
    handleBulkDelete: bulkActions.handleBulkDelete,
    handleBulkArchive: bulkActions.handleBulkArchive,
    handleBulkAddToList: bulkActions.handleBulkAddToList,
    handleBulkColorChange: bulkActions.handleBulkColorChange,
    handleBulkEditApply: bulkActions.handleBulkEditApply,
    handleExportCSV: bulkActions.handleExportCSV,
  };
}
