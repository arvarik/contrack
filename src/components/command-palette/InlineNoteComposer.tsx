/**
 * InlineNoteComposer — Compact composer for a note, a call, a meeting or an
 * email, inside the palette: from the action sub-menu (N, C), and from `>`
 * mode on a touch screen, where a one-line box hid a longer note.
 *
 * Renders directly in the command palette (not a separate modal).
 * Cmd+Enter saves. Escape returns to where it opened from.
 *
 * The text is a draft on disk from the first keystroke, so Escape, a click
 * on the backdrop or ⌘K does not lose it. It is read back the next time the
 * composer opens for the same contact, and cleared once the note is saved.
 *
 * @module components/command-palette/InlineNoteComposer
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Calendar,
  FileText,
  Loader2,
  Mail,
  Phone,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useAddInteraction } from "../../api";
import { BTN_QUIET, ICON_BTN, KBD_SM } from "../../lib/styles";
import { DURATION, EASE } from "../../lib/motion";
import { cn, errorText } from "../../lib/utils";
import { chordLabel, MOD_KEY } from "../../lib/platform";
import {
  clearDraft,
  draftKey,
  readDraft,
  writeDraft,
} from "../../lib/composerDrafts";
import { useAuth } from "../auth/AuthGate";
import { INTERACTION_LABELS } from "../../lib/interactionKinds";
import type { LogKind } from "./actionMode";

// ─── Types ────────────────────────────────────────────────────────────────────

/** How each kind looks in the composer. */
const KIND: Record<
  LogKind,
  { label: string; icon: LucideIcon; tone: string; placeholder: string }
> = {
  note: {
    label: "Note",
    icon: FileText,
    tone: "bg-info/15 text-info",
    placeholder: "Type your note…",
  },
  call: {
    label: "Call",
    icon: Phone,
    tone: "bg-success/15 text-success",
    placeholder: "Call summary…",
  },
  meeting: {
    label: "Meeting",
    icon: Calendar,
    tone: "bg-success/15 text-success",
    placeholder: "Meeting summary…",
  },
  email: {
    label: "Email",
    icon: Mail,
    tone: "bg-info/15 text-info",
    placeholder: "What the email said…",
  },
};

interface InlineNoteComposerProps {
  contactId: string;
  contactName: string;
  type: LogKind;
  /** Words already typed for it, in `>` mode. A saved draft wins. */
  initialText?: string;
  /** What the back control returns to. */
  backLabel?: string;
  onBack: () => void;
  onComplete: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const InlineNoteComposer: React.FC<InlineNoteComposerProps> = ({
  contactId,
  contactName,
  type,
  initialText = "",
  backLabel = "actions",
  onBack,
  onComplete,
}) => {
  const { user } = useAuth();
  // Apart from the contact page's draft, which holds the editor's HTML.
  const storageKey = draftKey(user?.id, `quick:${contactId}`);
  const [content, setContent] = useState(
    () => readDraft(storageKey)?.html || initialText,
  );
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
      await addInteraction.mutateAsync({
        contactId,
        data: {
          type,
          title: INTERACTION_LABELS[type],
          content: content.trim(),
          date: new Date().toISOString(),
        },
      });

      clearDraft(storageKey);
      toast.success(`${KIND[type].label} logged for ${contactName}`);
      onComplete();
    } catch (err: unknown) {
      toast.error(`Could not log the ${type}: ${errorText(err)}`);
    }
  }, [
    content,
    contactId,
    contactName,
    type,
    addInteraction,
    onComplete,
    storageKey,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Cmd+Enter or Ctrl+Enter to save
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave],
  );

  const { label, icon: Icon, tone, placeholder } = KIND[type];

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: DURATION.fast, ease: EASE }}
      className="p-2"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5 mb-2">
        <button
          onClick={onBack}
          onMouseDown={(e) => e.preventDefault()}
          className={cn(ICON_BTN, "pointer-fine:p-1 -ml-1")}
          aria-label={`Back to ${backLabel}`}
        >
          <ArrowLeft className="w-5 h-5 pointer-fine:w-4 pointer-fine:h-4" />
        </button>
        <div
          className={`w-7 h-7 flex items-center justify-center rounded-lg ${tone}`}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-on-surface truncate">
            {label} for {contactName}
          </p>
        </div>
      </div>

      {/* Textarea */}
      <div className="px-3">
        <textarea
          aria-label={label}
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            writeDraft(storageKey, {
              html: e.target.value,
              followUpText: "",
              type,
            });
          }}
          onKeyDown={(e) => {
            handleKeyDown(e);
            // The text area's own keys: Enter makes a new line and the
            // arrows move the caret. cmdk's handler on the palette took
            // them for its list. Escape and ⌘K still reach the palette.
            if (
              !e.metaKey &&
              !e.ctrlKey &&
              ["Enter", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)
            )
              e.stopPropagation();
          }}
          placeholder={placeholder}
          className="w-full bg-surface-container-low rounded-xl p-3 text-sm text-on-surface placeholder:text-on-surface-variant resize-none min-h-[80px] max-h-[160px]"
          rows={3}
        />
      </div>

      {/* Footer. It sticks to the bottom of the palette's scroll area: with
          a phone's keyboard up, Save sat below the visible part. */}
      <div className="sticky bottom-0 z-10 flex items-center justify-between px-3 pt-2 pb-1 bg-surface-container-lowest">
        {/* `-ml-2` keeps the text in line with the note above it. */}
        <button onClick={onBack} className={cn(BTN_QUIET, "-ml-2")}>
          <kbd className={`${KBD_SM} hidden pointer-fine:inline-flex`}>ESC</kbd>
          <span className="hidden pointer-fine:inline">back</span>
          <span className="pointer-fine:hidden">Cancel</span>
        </button>

        <button
          onClick={handleSave}
          disabled={!content.trim() || addInteraction.isPending}
          className="btn-primary btn-sm"
        >
          {addInteraction.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <>
              Save
              <kbd className={`${KBD_SM} hidden pointer-fine:inline-flex`}>
                {chordLabel([MOD_KEY, "↵"])}
              </kbd>
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
};
