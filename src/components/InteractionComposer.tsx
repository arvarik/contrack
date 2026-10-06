/**
 * The one place a note, a call, a meeting or an email is written, on the
 * contact page and, in its `compact` form, in the quick interaction dialog.
 *
 * Top to bottom:
 * 1. The editor (tiptap, named "Note"), with @mentions.
 * 2. The follow-up line. A date in it ("next Tuesday at 2pm") becomes a
 *    follow-up on save. A weekday is always the next one.
 * 3. A message line, only after a Save that cannot go ahead.
 * 4. The action bar: the type control and Save.
 *
 * `collapsible` (the narrow contact layout) shows the editor alone until it
 * takes focus. Save is always enabled: a Save with nothing to send says what
 * is missing and puts focus where it can be fixed.
 *
 * A save's rules:
 * - Nothing is cleared until the server has the note, and then only the part
 *   that was sent (`lib/composerSubmission`).
 * - A Save with only a follow-up saves only the follow-up: an empty note
 *   would count as talking to the person and move their score.
 * - The draft is on disk a moment after typing, per account and contact
 *   (`lib/composerDrafts`). The compact composer keeps one draft of its own,
 *   so closing the dialog never loses the note.
 * - One request at a time, however Save is pressed.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import { FileText, Phone, Handshake, Mail, CalendarClock } from "lucide-react";
import * as chrono from "chrono-node";
import { toast } from "sonner";
import { formatDue } from "../lib/datetime";
import { LinkPreviewExtension } from "./LinkPreviewExtension";
import { getMentionSuggestion } from "./MentionSuggestion";
import { Segmented, type SegmentedOption } from "./ui/Segmented";
import { useAddInteraction, useContactNames } from "../api";
import { useCreateActionItem } from "../api/actionItems";
import type { Interaction } from "../types";
import { COMPOSER, KBD_SM, TAG_PILL } from "../lib/styles";
import { cn } from "../lib/utils";
import { MOD_KEY, touchFirst } from "../lib/platform";
import { useAuth } from "./auth/AuthGate";
import {
  draftKey,
  isEmptyDraft,
  readDraft,
  writeDraft,
} from "../lib/composerDrafts";
import { markSubmission, removeSubmitted } from "../lib/composerSubmission";
import {
  INTERACTION_LABELS,
  type InteractionKind,
} from "../lib/interactionKinds";

/** The type control's options, in the order they are shown. */
const INTERACTION_TYPES: readonly SegmentedOption<InteractionKind>[] = [
  { value: "note", label: INTERACTION_LABELS.note, icon: FileText },
  { value: "call", label: INTERACTION_LABELS.call, icon: Phone },
  { value: "meeting", label: INTERACTION_LABELS.meeting, icon: Handshake },
  { value: "email", label: INTERACTION_LABELS.email, icon: Mail },
];

/** Placeholder copy per interaction type. Also the editor's description. */
const PLACEHOLDERS: Record<InteractionKind, string> = {
  note: "Write a quick note…",
  call: "Summarize the call…",
  meeting: "Capture meeting highlights…",
  email: "Log an email interaction…",
};

/** What a Save that cannot go ahead says. */
const COMPOSER_MESSAGES = {
  empty: "Write something first",
  date: "Add a date to the follow-up, like Friday or May 3",
  contact: "Choose a contact first",
} as const;

type Problem = keyof typeof COMPOSER_MESSAGES;

/** The quick interaction dialog's draft, in place of a contact's id. */
const QUICK_DRAFT = "quick-interaction";

/** How long after the last keystroke the draft is written to storage. */
const DRAFT_WRITE_DELAY_MS = 300;

/**
 * The first date in a follow-up line, always ahead of `now`: on a Monday,
 * "Friday" is this Friday, not the one three days ago.
 */
function parseFollowUp(text: string, now = new Date()) {
  return chrono.parse(text, now, { forwardDate: true })[0] ?? null;
}

/**
 * The follow-up in a follow-up line, or null when it names no date. The
 * title is the line without the date and its small words: "Send slides next
 * Tuesday" is "Send slides", and a bare date is "Follow up".
 */
export function followUpFromText(
  text: string,
  now = new Date(),
): { title: string; dueAt: string } | null {
  const found = parseFollowUp(text, now);
  if (!found) return null;
  let title = text.replace(found.text, "").trim();
  let previous;
  do {
    previous = title;
    title = title
      .replace(/^(on|at|by|in|for|with|the|to)\s+/i, "")
      .replace(/\s+(on|at|by|in|for|with|the|to)$/i, "")
      .trim();
  } while (title !== previous);
  return {
    title: title ? title.charAt(0).toUpperCase() + title.slice(1) : "Follow up",
    dueAt: found.start.date().toISOString(),
  };
}

/**
 * What is left of the follow-up line once the submitted part goes, by the
 * editor's rule: an untouched line clears, a line typed into keeps only the
 * addition, and a rewritten line stays whole.
 */
function followUpRemainder(current: string, submitted: string): string {
  if (current === submitted) return "";
  if (current.startsWith(submitted)) {
    return current.slice(submitted.length).trimStart();
  }
  return current;
}

/** The editor's own box: 16 px on a phone, where iOS zooms a smaller field. */
const EDITOR_CLASS =
  "prose prose-sm max-w-none min-h-[80px] text-base sm:text-sm text-on-surface break-words prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1";

/** @mentions of the people `contacts` names when somebody types @. */
const mentions = (contacts: Parameters<typeof getMentionSuggestion>[0]) =>
  Mention.configure({
    HTMLAttributes: {
      class:
        "bg-primary/10 text-on-primary-wash font-bold px-1 py-0.5 rounded-md cursor-pointer",
    },
    suggestion: getMentionSuggestion(contacts),
  });

/**
 * The editor alone, for a note already saved: the timeline's overlay edits
 * with it, so a note keeps its paragraphs and its @mentions.
 */
export const NoteEditor = ({
  html,
  onChange,
}: {
  html: string;
  /** The note as HTML, or "" when it is empty. */
  onChange: (html: string) => void;
}) => {
  const { data: contacts = [] } = useContactNames();
  const contactsRef = useRef(contacts);
  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);
  const editor = useEditor({
    extensions: [
      StarterKit,
      mentions(() => contactsRef.current),
      LinkPreviewExtension,
    ],
    content: html,
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? "" : editor.getHTML()),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Note",
        "aria-multiline": "true",
        class: EDITOR_CLASS,
      },
    },
  });
  return (
    <EditorContent
      editor={editor}
      className="custom-tiptap focus-frame bg-surface-container-low rounded-xl px-3 py-2"
    />
  );
};

interface InteractionComposerProps {
  /**
   * Who the interaction is with. Null in the quick interaction dialog until
   * a contact is chosen, and a Save then asks for one.
   */
  contactId: string | null;
  /** The dialog's form: no card around it, and one draft for the dialog. */
  compact?: boolean;
  /**
   * True when something outside asks the editor to take focus. The composer
   * focuses it once it exists and calls `onFocusHandled`, and the caller
   * sets this back to false.
   */
  focusRequested?: boolean;
  onFocusHandled?: () => void;
  /** Called after the server has the interaction. */
  onSaved?: (saved: { type: InteractionKind; contactId: string }) => void;
  /** Called when Save is pressed with no contact. The dialog focuses its picker. */
  onContactMissing?: () => void;
  /**
   * The narrow contact page's form: the editor alone until something in it
   * takes focus, and again when focus leaves with nothing written.
   */
  collapsible?: boolean;
}

export const InteractionComposer = (props: InteractionComposerProps) => {
  const { user } = useAuth();
  const storageKey = props.compact
    ? draftKey(user?.id, QUICK_DRAFT)
    : props.contactId
      ? draftKey(user?.id, props.contactId)
      : null;
  // Keyed on the draft, so a new contact or account replaces the editor and
  // a half-written note stays with its person. The compact composer keeps
  // one editor while its contact is chosen.
  return <Composer key={storageKey} {...props} storageKey={storageKey} />;
};

const Composer = ({
  contactId,
  compact = false,
  focusRequested = false,
  onFocusHandled,
  onSaved,
  onContactMissing,
  collapsible = false,
  storageKey,
}: InteractionComposerProps & { storageKey: string | null }) => {
  const [draft] = useState(() => (storageKey ? readDraft(storageKey) : null));
  const [type, setType] = useState<InteractionKind>(draft?.type ?? "note");
  /**
   * Whether the whole composer shows. Always true unless `collapsible`. A
   * draft from disk opens it, so half-written text never hides.
   */
  const [opened, setOpened] = useState(() => !!draft && !isEmptyDraft(draft));
  const expanded = !collapsible || opened;
  const rootRef = useRef<HTMLDivElement>(null);
  /** `type`, for the placeholder and the submit path, which run outside render. */
  const typeRef = useRef<InteractionKind>(type);
  const { data: allContacts = [] } = useContactNames();
  /**
   * The people @ can mention, read when somebody types @. The editor is
   * created once, maybe before the names load.
   */
  const contactsRef = useRef(allContacts);
  useEffect(() => {
    contactsRef.current = allContacts;
  }, [allContacts]);
  const addInteraction = useAddInteraction();
  const createFollowUp = useCreateActionItem();
  const [followUpText, setFollowUpText] = useState(draft?.followUpText ?? "");
  const followUpRef = useRef(followUpText);
  const [isSaving, setIsSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const parsedDate = parseFollowUp(followUpText)?.start.date();
  const placeholderId = React.useId();
  const messageId = React.useId();

  /**
   * Refs for everything the submit path reads: the Mod-Enter shortcut is
   * registered once, with the first render's closures. `pendingRef` is the
   * duplicate guard for the same reason.
   */
  const editorRef = useRef<Editor | null>(null);
  const pendingRef = useRef(false);
  const followUpInput = useRef<HTMLInputElement>(null);
  const submitRef = useRef<() => void>(() => {});
  const contactIdRef = useRef(contactId);
  useEffect(() => {
    contactIdRef.current = contactId;
  }, [contactId]);
  /** The editor's HTML as of its last update, readable after it is gone. */
  const lastHtmlRef = useRef(draft?.html ?? "");

  // The draft: written a moment after the last keystroke, and at once when
  // the page hides or unloads or this composer unmounts. An expired session
  // replaces the whole app, and the unmount flush keeps the note.
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistNow = useCallback(() => {
    if (writeTimer.current) {
      clearTimeout(writeTimer.current);
      writeTimer.current = null;
    }
    if (!storageKey) return;
    writeDraft(storageKey, {
      html: lastHtmlRef.current,
      followUpText: followUpRef.current,
      type: typeRef.current,
    });
  }, [storageKey]);
  const persistSoon = useCallback(() => {
    if (!storageKey) return;
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(persistNow, DRAFT_WRITE_DELAY_MS);
  }, [persistNow, storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    const onHidden = () => {
      if (document.visibilityState === "hidden") persistNow();
    };
    window.addEventListener("pagehide", persistNow);
    window.addEventListener("beforeunload", persistNow);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", persistNow);
      window.removeEventListener("beforeunload", persistNow);
      document.removeEventListener("visibilitychange", onHidden);
      persistNow();
    };
  }, [persistNow, storageKey]);

  useEffect(() => {
    followUpRef.current = followUpText;
    persistSoon();
  }, [followUpText, persistSoon]);

  // A message answers one press of Save. The first change after it, a key
  // typed or a contact chosen, takes it away.
  useEffect(() => {
    if (problem === "contact" && contactId) setProblem(null);
  }, [contactId, problem]);

  // ── The save ───────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed || pendingRef.current) return;

    const kind = typeRef.current;
    const followUp = followUpRef.current;
    const isEditorEmpty = editor.isEmpty;
    if (isEditorEmpty && !followUp.trim()) {
      setProblem("empty");
      editor.commands.focus();
      return;
    }
    // A follow-up needs a date, or a line with none would vanish on Save.
    const followUpItem = followUpFromText(followUp);
    if (followUp.trim() && !followUpItem) {
      setProblem("date");
      followUpInput.current?.focus();
      return;
    }
    const target = contactIdRef.current;
    if (!target) {
      setProblem("contact");
      onContactMissing?.();
      return;
    }
    setProblem(null);

    // Nothing is cleared yet. The mark records where the submitted content
    // ends and follows it through anything typed while the request is out.
    const mark = markSubmission(editor);
    pendingRef.current = true;
    setIsSaving(true);
    try {
      if (isEditorEmpty) {
        // Only a follow-up: no note, so nobody counts as contacted.
        await createFollowUp.mutateAsync({
          contactId: target,
          ...followUpItem!,
        });
      } else {
        const payload: Partial<Interaction> = {
          type: kind,
          title: INTERACTION_LABELS[kind],
          content: editor.getHTML(),
          date: new Date().toISOString(),
        };
        if (followUpItem) payload.actionItem = followUpItem;
        await addInteraction.mutateAsync({ contactId: target, data: payload });
      }

      if (followUpItem) {
        toast.success(`Follow-up set for ${formatDue(followUpItem.dueAt)}`);
      }
      // Only now, and only the submitted part.
      removeSubmitted(editor, mark);
      setFollowUpText((current) => followUpRemainder(current, followUp));
      persistSoon();
      onSaved?.({ type: kind, contactId: target });
    } catch {
      mark.stop();
      // On disk before anything else happens. A 401 here is followed by the
      // gate taking the screen, and the note must already be kept by then.
      persistNow();
      toast.error("Could not save the note");
    } finally {
      pendingRef.current = false;
      setIsSaving(false);
    }
  }, [
    addInteraction,
    createFollowUp,
    onContactMissing,
    onSaved,
    persistNow,
    persistSoon,
  ]);

  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  // Created once: the shortcut reaches the current submit through the ref.
  // It must win over StarterKit's hard break, which binds the same keys.
  const [SubmitExtension] = useState(() =>
    Extension.create({
      name: "submitShortcut",
      addKeyboardShortcuts() {
        return {
          "Mod-Enter": () => {
            submitRef.current();
            return true;
          },
        };
      },
    }),
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        // A function, re-read whenever decorations are recomputed.
        placeholder: () => PLACEHOLDERS[typeRef.current],
        showOnlyWhenEditable: false,
      }),
      SubmitExtension,
      mentions(() => contactsRef.current),
      LinkPreviewExtension,
    ],
    content: draft?.html ?? "",
    onUpdate: ({ editor }) => {
      lastHtmlRef.current = editor.isEmpty ? "" : editor.getHTML();
      if (!editor.isEmpty) setProblem(null);
      persistSoon();
    },
    editorProps: {
      /**
       * A name and a description for the contenteditable. The placeholder is
       * a CSS decoration a screen reader skips, so the description points at
       * a hidden copy. Set once, so the id must not change.
       *
       * 16 px text on a phone, or iOS zooms on focus.
       */
      attributes: {
        role: "textbox",
        "aria-label": "Note",
        "aria-multiline": "true",
        "aria-describedby": placeholderId,
        class: EDITOR_CLASS,
      },
    },
  });

  useEffect(() => {
    editorRef.current = editor ?? null;
  }, [editor]);

  // Somebody outside asked for the editor: focus it, with the caret at the
  // end and the editor scrolled into view, and say so.
  useEffect(() => {
    if (!focusRequested || !editor || editor.isDestroyed) return;
    editor.chain().focus("end").scrollIntoView().run();
    onFocusHandled?.();
  }, [focusRequested, editor, onFocusHandled]);

  /*
   * Refreshes the placeholder when the type changes, by asking ProseMirror
   * to recompute decorations. Not through `editor.extensionManager`, which
   * is null until the editor finishes initializing.
   */
  useEffect(() => {
    typeRef.current = type;
    persistSoon();
    if (editor && !editor.isDestroyed && editor.view) {
      editor.view.dispatch(editor.state.tr);
    }
  }, [type, editor, persistSoon]);

  /**
   * ⌘ Enter anywhere in the composer: the follow-up line, the type control,
   * Save itself. The editor answers the keys first and marks them handled.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submitRef.current();
    }
  };

  /**
   * Focus leaving a collapsible composer closes it, when nothing is written
   * and no save is out. Focus moving inside it keeps it open.
   */
  const onBlur = (event: React.FocusEvent) => {
    if (!collapsible) return;
    const next = event.relatedTarget as Node | null;
    if (next && rootRef.current?.contains(next)) return;
    const current = editorRef.current;
    if (current && !current.isDestroyed && !current.isEmpty) return;
    if (followUpRef.current.trim() || pendingRef.current) return;
    setProblem(null);
    setOpened(false);
  };

  return (
    // Key and focus handlers on the container, not a control: the events come
    // from the fields and buttons inside it.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      onFocus={collapsible ? () => setOpened(true) : undefined}
      onBlur={onBlur}
      data-expanded={expanded}
      className={cn(
        compact
          ? "flex flex-col"
          : cn(
              COMPOSER,
              "p-0 flex flex-col",
              // `clip`, not `hidden`, when the bar can stick: `hidden` makes
              // the card the bar's scroller.
              collapsible ? "overflow-clip" : "overflow-hidden",
            ),
      )}
    >
      {/* While collapsed, a tap anywhere on the line focuses the editor. The
          editor is the keyboard's way in, so the area needs no key handler. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className={cn(
          "flex-1 relative",
          compact ? "px-5 pt-2" : expanded ? "p-5" : "px-5 py-3 cursor-text",
        )}
        onClick={
          expanded ? undefined : () => editorRef.current?.commands.focus("end")
        }
      >
        <EditorContent
          editor={editor}
          className={cn(
            "w-full custom-tiptap",
            // The dialog's form has no card around it, so the field box is
            // the frame that draws the ring while the editor has focus.
            compact &&
              "focus-frame bg-surface-container-low rounded-xl px-3 py-2",
            // One line: the editor's own 80 px floor is set once, when it is
            // created, so the collapsed form lifts it from outside.
            !expanded && "[&_.ProseMirror]:min-h-0",
          )}
        />
        {/* The placeholder as text, for the editor's aria-describedby. */}
        <span id={placeholderId} className="sr-only">
          {PLACEHOLDERS[type]}
        </span>

        {/* The follow-up line, and the save hint at its end */}
        <div
          className={cn(
            "mt-4 flex items-center gap-3 relative",
            !expanded && "hidden",
          )}
        >
          {/* One box for the glyph, the field and the date. In the card the
              card draws the ring, and in the dialog this box does. */}
          <div
            className={cn(
              "flex flex-1 items-center px-3 py-0 sm:py-2.5 bg-surface-container-lowest rounded-xl shadow-sm",
              compact && "focus-frame",
            )}
          >
            <CalendarClock
              aria-hidden="true"
              className="w-4 h-4 text-primary mr-2.5 shrink-0"
            />
            <input
              ref={followUpInput}
              aria-label="Follow-up"
              // A phone's return key reads Done and puts the keyboard away,
              // so Save is in view.
              enterKeyHint="done"
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  touchFirst()
                ) {
                  event.currentTarget.blur();
                }
              }}
              value={followUpText}
              onChange={(e) => {
                setFollowUpText(e.target.value);
                setProblem(null);
              }}
              // Short enough for a phone's field.
              placeholder="Follow-up, like call back Tuesday"
              // A field draws no `::after`, so the 44 px tap floor on a phone
              // has to be the field's own height. 16 px there stops iOS
              // zooming in.
              className="flex-1 min-w-0 min-h-[44px] sm:pointer-fine:min-h-0 bg-transparent border-none text-base sm:text-xs font-semibold text-on-surface p-0 placeholder:text-on-surface-variant"
            />
            {parsedDate && (
              <span className={cn(TAG_PILL, "ml-2 shrink-0")}>
                {formatDue(parsedDate.toISOString())}
              </span>
            )}
          </div>
          {/* Not beside Save: in the dialog the bar is full. */}
          <span className="hidden sm:inline-flex items-center gap-1 shrink-0 text-xs text-on-surface-variant whitespace-nowrap">
            <kbd className={KBD_SM}>{MOD_KEY}</kbd>
            <kbd className={KBD_SM}>Enter</kbd>
            <span>to save</span>
          </span>
        </div>

        {problem && expanded && (
          <p
            id={messageId}
            role="alert"
            className="mt-3 text-sm font-semibold text-error"
          >
            {COMPOSER_MESSAGES[problem]}
          </p>
        )}
      </div>

      {/* Action bar */}
      <div
        className={cn(
          "flex items-center justify-between gap-3",
          compact
            ? "px-5 py-3.5 mt-4 bg-surface-container-low sticky bottom-0 sm:static"
            : "bg-surface-container-low/40 px-5 py-3",
          // On a phone the bar sticks on top of the tab bar, or on the
          // keyboard while it is up, so Save stays in reach
          // (`--tabbar-space` and `--keyboard-inset` in index.css).
          collapsible &&
            "sticky bottom-[calc(var(--tabbar-space)+var(--keyboard-inset))] md:static z-10 bg-surface-container-low",
          !expanded && "hidden",
        )}
      >
        <Segmented
          options={INTERACTION_TYPES}
          value={type}
          onChange={setType}
          label="Interaction type"
          className="w-auto"
        />

        <button
          type="button"
          onClick={() => submitRef.current()}
          aria-busy={isSaving}
          aria-describedby={problem ? messageId : undefined}
          className="btn-primary ml-auto"
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
};
