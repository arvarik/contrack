/**
 * ListPicker — Inline list membership picker for the action sub-menu.
 *
 * Shows all available lists with checkmarks for current memberships.
 * Enter on a list toggles membership. Escape returns to action menu.
 *
 * @module components/command-palette/ListPicker
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLists, useAddToList, useRemoveFromList, useContacts } from '../../api';
import { KBD_SM } from '../../lib/styles';

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
  const [pendingListId, setPendingListId] = useState<string | null>(null);

  // ── Get current list memberships for this contact ───────────────────────
  const memberListIds = useMemo(() => {
    const contact = contacts.find(c => c.id === contactId);
    if (!contact?.lists) return new Set<string>();
    return new Set(contact.lists.map(l => l.id));
  }, [contacts, contactId]);

  // ── Toggle membership ──────────────────────────────────────────────────
  const handleToggle = useCallback(async (listId: string) => {
    const listName = lists.find(l => l.id === listId)?.name ?? 'list';
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
      toast.error(`Failed: ${(err instanceof Error ? err.message : String(err))}`);
    } finally {
      setPendingListId(null);
    }
  }, [lists, memberListIds, contactId, contactName, addToList, removeFromList]);

  // ── Keyboard navigation ─────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % lists.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + lists.length) % lists.length);
        break;
      case 'Enter':
        e.preventDefault();
        if (lists[selectedIndex]) handleToggle(lists[selectedIndex].id);
        break;
      case 'Escape':
      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        onBack();
        break;
    }
  }, [lists, selectedIndex, handleToggle, onBack]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="p-2"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5 mb-1">
        <button
          onClick={onBack}
          onMouseDown={(e) => e.preventDefault()}
          className="p-2 sm:p-1 -ml-1 rounded-lg hover:bg-surface-container-high active:bg-surface-container-highest transition-colors text-on-surface-variant hover:text-on-surface"
          aria-label="Back to actions"
        >
          <ArrowLeft className="w-5 h-5 sm:w-4 sm:h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-on-surface truncate">
            Lists for {contactName}
          </p>
          <p className="text-[10px] text-on-surface-variant">Toggle membership</p>
        </div>
      </div>

      {/* List items */}
      {lists.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-on-surface-variant">
          <p className="font-bold text-on-surface mb-1">No lists yet</p>
          <p className="text-xs">Create a list from the Settings page first.</p>
        </div>
      ) : (
        <div className="space-y-0.5 max-h-[240px] overflow-y-auto">
          {lists.map((list, i) => {
            const isMember = memberListIds.has(list.id);
            const isPending = pendingListId === list.id;

            return (
              <button
                key={list.id}
                onClick={() => handleToggle(list.id)}
                onMouseDown={(e) => e.preventDefault()}
                disabled={isPending}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all
                  ${i === selectedIndex
                    ? 'bg-primary/10 text-primary'
                    : 'text-on-surface hover:bg-surface-container-low'
                  }
                  ${isPending ? 'opacity-50' : ''}
                `}
              >
                {/* List icon */}
                <span className="text-base w-6 text-center">{list.icon || '📋'}</span>

                {/* List name */}
                <span className="flex-1 text-left font-medium truncate">{list.name}</span>

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

      {/* Footer hint */}
      <div className="hidden sm:flex items-center justify-center gap-2 px-3 pt-3 pb-1 text-[10px] text-on-surface-variant/40">
        <kbd className={KBD_SM}>↵</kbd> toggle
        <span>·</span>
        <kbd className={KBD_SM}>ESC</kbd> back
      </div>
    </motion.div>
  );
};
