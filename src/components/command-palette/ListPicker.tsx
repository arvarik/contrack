/**
 * ListPicker — Inline list membership picker for the action sub-menu.
 *
 * Shows all available lists with checkmarks for current memberships.
 * Enter on a list toggles membership. Escape returns to action menu.
 *
 * @module components/command-palette/ListPicker
 */
import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useLists,
  useAddToList,
  useRemoveFromList,
  useContacts,
} from "../../api";
import { ICON_BTN, SELECTED_ROW } from "../../lib/styles";
import { DURATION, EASE } from "../../lib/motion";
import { cn } from "../../lib/utils";
import { ListIcon } from "../../views/contact-list/CreateListModal";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ListPickerProps {
  contactId: string;
  contactName: string;
  onBack: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const ListPicker: React.FC<ListPickerProps> = ({
  contactId,
  contactName,
  onBack,
}) => {
  const { data: lists = [] } = useLists();
  const { data: contacts = [] } = useContacts();
  const addToList = useAddToList();
  const removeFromList = useRemoveFromList();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listboxId = useId();
  const [pendingListId, setPendingListId] = useState<string | null>(null);

  // ── Get current list memberships for this contact ───────────────────────
  const memberListIds = useMemo(() => {
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact?.lists) return new Set<string>();
    return new Set(contact.lists.map((l) => l.id));
  }, [contacts, contactId]);

  // ── Toggle membership ──────────────────────────────────────────────────
  const handleToggle = useCallback(
    async (listId: string) => {
      const listName = lists.find((l) => l.id === listId)?.name ?? "list";
      setPendingListId(listId);

      try {
        if (memberListIds.has(listId)) {
          await removeFromList.mutateAsync({ listId, contactId });
          toast.success(`Removed ${contactName} from "${listName}"`);
        } else {
          await addToList.mutateAsync({ listId, contactId });
          toast.success(`Added ${contactName} to "${listName}"`);
        }
      } catch (err: unknown) {
        toast.error(
          `Could not change the list: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setPendingListId(null);
      }
    },
    [lists, memberListIds, contactId, contactName, addToList, removeFromList],
  );

  // ── Keyboard navigation ─────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // The palette's search box keeps the focus while the picker shows, so
      // its keys are the picker's. The picker skipped every input, so it took
      // no key at all. Another field, or a focused button, keeps its own.
      const target = e.target instanceof Element ? e.target : null;
      if (
        target &&
        !target.hasAttribute("cmdk-input") &&
        target.closest("input, textarea, select, button, a[href]")
      )
        return;

      switch (e.key) {
        case "Home":
        case "End":
          e.preventDefault();
          setSelectedIndex(e.key === "Home" ? 0 : lists.length - 1);
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % lists.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + lists.length) % lists.length);
          break;
        case "Enter":
          e.preventDefault();
          if (lists[selectedIndex]) handleToggle(lists[selectedIndex].id);
          break;
        case "Escape":
        case "ArrowLeft":
          e.preventDefault();
          e.stopPropagation();
          onBack();
          break;
      }
    },
    [lists, selectedIndex, handleToggle, onBack],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: DURATION.fast, ease: EASE }}
      className="p-2"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5 mb-1">
        <button
          onClick={onBack}
          onMouseDown={(e) => e.preventDefault()}
          className={cn(ICON_BTN, "pointer-fine:p-1 -ml-1")}
          aria-label="Back to actions"
        >
          <ArrowLeft className="w-5 h-5 pointer-fine:w-4 pointer-fine:h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-on-surface truncate">
            Lists for {contactName}
          </p>
          <p className="text-[11px] text-on-surface-variant">
            Pick a list to add or remove
          </p>
        </div>
      </div>

      {/* List items */}
      {lists.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-on-surface-variant">
          <p className="font-bold text-on-surface mb-1">No lists yet</p>
          <p className="text-xs">Create a list from the Settings page first</p>
        </div>
      ) : (
        // A listbox the palette's input names the current row of
        // (`aria-activedescendant`, synced in CommandPalette), so a screen
        // reader hears the arrows. The rows are not Tab stops.
        <div
          role="listbox"
          id={listboxId}
          aria-label={`Lists for ${contactName}`}
          data-palette-popup=""
          className="space-y-0.5 max-h-[240px] overflow-y-auto"
        >
          {lists.map((list, i) => {
            const isMember = memberListIds.has(list.id);
            const isPending = pendingListId === list.id;

            return (
              <button
                key={list.id}
                type="button"
                role="option"
                id={`${listboxId}-${i}`}
                aria-selected={i === selectedIndex}
                aria-checked={isMember}
                tabIndex={-1}
                onClick={() => handleToggle(list.id)}
                onMouseDown={(e) => e.preventDefault()}
                disabled={isPending}
                className={cn(
                  "state-layer w-full min-h-[44px] pointer-fine:min-h-0 flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors",
                  i === selectedIndex
                    ? cn(SELECTED_ROW, "text-on-primary-wash")
                    : "text-on-surface",
                  isPending && "opacity-50",
                )}
              >
                {/* The list's icon, drawn as the lists page draws it. Its
                    name, such as "star", used to show as text. */}
                <ListIcon
                  icon={list.icon}
                  className="w-4 h-4 shrink-0 text-on-surface-variant"
                />

                {/* List name */}
                <span className="flex-1 text-left font-medium truncate">
                  {list.name}
                </span>

                {/* Membership indicator */}
                {isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                ) : isMember ? (
                  <Check className="w-4 h-4 text-primary" />
                ) : (
                  <span className="w-4 h-4 rounded border border-on-surface-variant/20" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </motion.div>
  );
};
