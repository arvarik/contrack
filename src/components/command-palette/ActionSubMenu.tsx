/**
 * ActionSubMenu — Keyboard-first action panel for a focused contact.
 *
 * Activated by pressing `→` on a focused search result.
 * Provides quick actions without leaving the command palette:
 *   👤 View Profile (Enter), 📝 Log Note (N), 📞 Log Call (C),
 *   ✨ Catch Me Up (B), 📋 Add to List (L)
 *
 * @module components/command-palette/ActionSubMenu
 */
import React, { useEffect, useCallback, useState, useRef } from 'react';
import { motion } from 'motion/react';
import {
  User, FileText, Phone, Sparkles, ListPlus,
  ArrowLeft,
} from 'lucide-react';
import { KBD_SM } from '../../lib/styles';
import { fallbackAvatarUrl } from '../../lib/avatar';
import { InlineNoteComposer } from './InlineNoteComposer';
import { ListPicker } from './ListPicker';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SubMenuMode = 'actions' | 'note' | 'call' | 'list';

interface ActionSubMenuProps {
  contactId: string;
  contactName: string;
  contactAvatarUrl: string | null;
  onViewProfile: () => void;
  onCatchMeUp: () => void;
  onBack: () => void;
  onClose: () => void;
}

interface ActionItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut: string;
  handler: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const ActionSubMenu: React.FC<ActionSubMenuProps> = ({
  contactId,
  contactName,
  contactAvatarUrl,
  onViewProfile,
  onCatchMeUp,
  onBack,
  onClose,
}) => {
  const [mode, setMode] = useState<SubMenuMode>('actions');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const actionsRef = useRef<HTMLDivElement>(null);

  // ── Action items ────────────────────────────────────────────────────────
  const actions: ActionItem[] = [
    {
      id: 'view',
      label: 'View Profile',
      icon: <User className="w-4 h-4" />,
      shortcut: '↵',
      handler: onViewProfile,
    },
    {
      id: 'note',
      label: 'Log Note',
      icon: <FileText className="w-4 h-4" />,
      shortcut: 'N',
      handler: () => setMode('note'),
    },
    {
      id: 'call',
      label: 'Log Call',
      icon: <Phone className="w-4 h-4" />,
      shortcut: 'C',
      handler: () => setMode('call'),
    },
    {
      id: 'brief',
      label: 'Catch Me Up',
      icon: <Sparkles className="w-4 h-4" />,
      shortcut: 'B',
      handler: onCatchMeUp,
    },
    {
      id: 'list',
      label: 'Add to List',
      icon: <ListPlus className="w-4 h-4" />,
      shortcut: 'L',
      handler: () => setMode('list'),
    },
  ];

  // ── Keyboard handling ───────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't intercept when in a sub-mode that handles its own keys
    if (mode !== 'actions') {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMode('actions');
        setSelectedIndex(0);
      }
      return;
    }

    // Typing target check — don't intercept when typing in a textarea/input
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onBack();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % actions.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + actions.length) % actions.length);
        break;
      case 'Enter':
        e.preventDefault();
        actions[selectedIndex]?.handler();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        onBack();
        break;
      // Letter shortcuts
      case 'n':
      case 'N':
        e.preventDefault();
        setMode('note');
        break;
      case 'c':
      case 'C':
        e.preventDefault();
        setMode('call');
        break;
      case 'b':
      case 'B':
        e.preventDefault();
        onCatchMeUp();
        break;
      case 'l':
      case 'L':
        e.preventDefault();
        setMode('list');
        break;
    }
  }, [mode, selectedIndex, actions, onBack, onCatchMeUp]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  // ── Note / Call composer ────────────────────────────────────────────────
  if (mode === 'note' || mode === 'call') {
    return (
      <InlineNoteComposer
        contactId={contactId}
        contactName={contactName}
        type={mode === 'note' ? 'note' : 'call'}
        onBack={() => { setMode('actions'); setSelectedIndex(0); }}
        onComplete={onClose}
      />
    );
  }

  // ── List picker ─────────────────────────────────────────────────────────
  if (mode === 'list') {
    return (
      <ListPicker
        contactId={contactId}
        contactName={contactName}
        onBack={() => { setMode('actions'); setSelectedIndex(0); }}
      />
    );
  }

  // ── Actions list ────────────────────────────────────────────────────────
  return (
    <motion.div
      ref={actionsRef}
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
          aria-label="Back to results"
        >
          <ArrowLeft className="w-5 h-5 sm:w-4 sm:h-4" />
        </button>
        <img
          src={contactAvatarUrl || fallbackAvatarUrl(contactName)}
          alt=""
          className="w-7 h-7 rounded-full bg-surface-container-highest object-cover"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-on-surface truncate">{contactName}</p>
          <p className="text-[10px] text-on-surface-variant uppercase tracking-widest">Actions</p>
        </div>
      </div>

      {/* Action items */}
      <div className="space-y-0.5">
        {actions.map((action, i) => (
          <button
            key={action.id}
            onClick={action.handler}
            onMouseDown={(e) => e.preventDefault()}
            className={`
              w-full flex items-center gap-3 px-3 py-3 sm:py-2.5 rounded-xl text-sm transition-all active:scale-[0.98]
              ${i === selectedIndex
                ? 'bg-primary/10 text-primary'
                : 'text-on-surface hover:bg-surface-container-low active:bg-surface-container-low'
              }
            `}
          >
            <span className={`
              w-8 h-8 flex items-center justify-center rounded-lg shrink-0
              ${i === selectedIndex
                ? 'bg-primary/15 text-primary'
                : 'bg-surface-container-high text-on-surface-variant'
              }
            `}>
              {action.icon}
            </span>
            <span className="flex-1 text-left font-medium">{action.label}</span>
            <kbd className={`${KBD_SM} hidden sm:inline-flex`}>{action.shortcut}</kbd>
          </button>
        ))}
      </div>

      {/* Footer hint */}
      <div className="hidden sm:flex items-center justify-center gap-2 px-3 pt-3 pb-1 text-[10px] text-on-surface-variant/40">
        <kbd className={KBD_SM}>↑↓</kbd> navigate
        <span>·</span>
        <kbd className={KBD_SM}>←</kbd> back
        <span>·</span>
        letter to quick-select
      </div>
    </motion.div>
  );
};
