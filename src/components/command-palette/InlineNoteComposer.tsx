/**
 * InlineNoteComposer — Compact note/call composer inside the action sub-menu.
 *
 * Renders directly in the command palette (not a separate modal).
 * Cmd+Enter saves. Escape returns to the action sub-menu.
 *
 * @module components/command-palette/InlineNoteComposer
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { FileText, Phone, ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAddInteraction } from '../../api';
import { KBD_SM } from '../../lib/styles';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InlineNoteComposerProps {
  contactId: string;
  contactName: string;
  type: 'note' | 'call';
  onBack: () => void;
  onComplete: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const InlineNoteComposer: React.FC<InlineNoteComposerProps> = ({
  contactId,
  contactName,
  type,
  onBack,
  onComplete,
}) => {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addInteraction = useAddInteraction();

  // Auto-focus textarea on mount
  useEffect(() => {
    // Delay to let animation finish
    const timer = setTimeout(() => textareaRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleSave = useCallback(async () => {
    if (!content.trim()) return;

    try {
      const titleMap = {
        note: 'Quick Note',
        call: 'Phone Call',
      };

      await addInteraction.mutateAsync({
        contactId,
        data: {
          type,
          title: titleMap[type],
          content: content.trim(),
          date: new Date().toISOString(),
        },
      });

      toast.success(`${type === 'note' ? 'Note' : 'Call'} logged for ${contactName}`);
      onComplete();
    } catch (err: unknown) {
      toast.error(`Failed to log ${type}: ${(err instanceof Error ? err.message : String(err))}`);
    }
  }, [content, contactId, contactName, type, addInteraction, onComplete]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Cmd+Enter or Ctrl+Enter to save
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  }, [handleSave]);

  const isNote = type === 'note';
  const Icon = isNote ? FileText : Phone;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="p-2"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5 mb-2">
        <button
          onClick={onBack}
          onMouseDown={(e) => e.preventDefault()}
          className="p-2 sm:p-1 -ml-1 rounded-lg hover:bg-surface-container-high active:bg-surface-container-highest transition-colors text-on-surface-variant hover:text-on-surface"
          aria-label="Back to actions"
        >
          <ArrowLeft className="w-5 h-5 sm:w-4 sm:h-4" />
        </button>
        <div className={`w-7 h-7 flex items-center justify-center rounded-lg ${isNote ? 'bg-blue-500/15 text-blue-500' : 'bg-emerald-500/15 text-emerald-500'}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-on-surface truncate">
            {isNote ? 'Note' : 'Call'} for {contactName}
          </p>
        </div>
      </div>

      {/* Textarea */}
      <div className="px-3">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isNote ? 'Type your note...' : 'Call summary...'}
          className="w-full bg-surface-container-low rounded-xl p-3 text-sm text-on-surface placeholder:text-on-surface-variant/40 resize-none focus:ring-2 focus:ring-primary/30 focus:outline-none transition-shadow min-h-[80px] max-h-[160px]"
          rows={3}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <button
          onClick={onBack}
          className="text-xs text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1"
        >
          <kbd className={`${KBD_SM} hidden sm:inline-flex`}>ESC</kbd>
          <span className="hidden sm:inline">back</span>
          <span className="sm:hidden">Cancel</span>
        </button>

        <button
          onClick={handleSave}
          disabled={!content.trim() || addInteraction.isPending}
          className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {addInteraction.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <>
              Save
              <kbd className={`${KBD_SM} hidden sm:inline-flex`}>⌘↵</kbd>
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
};
