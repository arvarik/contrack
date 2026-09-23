/**
 * BulkModals — Shared modal dialogs for bulk operations (Add to List, Bulk Edit Field).
 *
 * Used by both ContactList and MapView.
 *
 * @module components/bulk/BulkModals
 */
import React from "react";
import type { ContactList } from "../../types";
import { Modal } from "../ui/Modal";
import { BulkEditFieldModal } from "../BulkEditFieldModal";
import { useLists } from "../../api/lists";
import { ListIcon } from "../../views/contact-list/CreateListModal";

export interface BulkModalsProps {
  selectedCount: number;
  // Add to list
  isAddToListOpen: boolean;
  onCloseAddToList: () => void;
  onBulkAddToList: (listId: string) => void;
  isBulkAddToListPending?: boolean;
  lists?: ContactList[];
  // Bulk edit
  isBulkEditOpen: boolean;
  onCloseBulkEdit: () => void;
  onBulkEditApply: (field: string, value: string | number) => void;
  isBulkEditPending?: boolean;
}

export const BulkModals: React.FC<BulkModalsProps> = ({
  selectedCount,
  isAddToListOpen,
  onCloseAddToList,
  onBulkAddToList,
  isBulkAddToListPending = false,
  lists: passedLists,
  isBulkEditOpen,
  onCloseBulkEdit,
  onBulkEditApply,
  isBulkEditPending = false,
}) => {
  const { data: fetchedLists = [] } = useLists();
  const lists = passedLists ?? fetchedLists;

  return (
    <>
      {/* ── Add to List Modal ──────────────────────────────────────────── */}
      <Modal
        isOpen={isAddToListOpen}
        onClose={onCloseAddToList}
        title="Add to list"
      >
        <div className="space-y-2 pt-2">
          <p className="text-xs text-on-surface-variant mb-4">
            Choose a list to add the {selectedCount} selected contact
            {selectedCount !== 1 ? "s" : ""} to:
          </p>
          {lists.length === 0 && (
            <p className="text-sm text-on-surface-variant text-center py-4">
              No lists yet. Create one first.
            </p>
          )}
          {lists.map((list) => (
            <button
              key={list.id}
              type="button"
              onClick={() => onBulkAddToList(list.id)}
              disabled={isBulkAddToListPending}
              className="state-layer flex items-center gap-3 w-full px-4 py-3 rounded-xl bg-surface-container transition-colors text-left disabled:text-on-surface-variant disabled:cursor-not-allowed cursor-pointer"
            >
              <span className="text-primary">
                <ListIcon icon={list.icon} className="w-4 h-4" />
              </span>
              <span className="font-semibold text-sm text-on-surface">
                {list.name}
              </span>
              <span className="ml-auto text-xs text-on-surface-variant opacity-60">
                {list.memberCount ?? 0} members
              </span>
            </button>
          ))}
        </div>
      </Modal>

      {/* ── Bulk Edit Field Modal ─────────────────────────────────────── */}
      <BulkEditFieldModal
        isOpen={isBulkEditOpen}
        onClose={onCloseBulkEdit}
        selectedCount={selectedCount}
        onApply={onBulkEditApply}
        isPending={isBulkEditPending}
      />
    </>
  );
};
