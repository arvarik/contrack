/**
 * InteractionComposer: the one place a note, a call, a meeting or an email is
 * written.
 *
 * There used to be two. The contact page had a rich tiptap editor with
 * @mentions and a follow-up line. The quick interaction dialog had a plain
 * textarea with no mentions and no follow-up. The same act behaved two ways,
 * depending on where a person started it. Now both places draw this
 * component, and the dialog asks for its `compact` form.
 *
 * What it draws, top to bottom:
 *
 * 1. The editor. A tiptap instance named "Note", described by the
 *    placeholder for the chosen type, with @mentions of the people in the
 *    network.
 * 2. The next-action line. A date in it ("next Tuesday at 2pm") becomes a
 *    follow-up task on save, and the parsed date shows beside the field. The
 *    "⌘ Enter to save" hint sits at the end of the line, from `sm`.
 * 3. A message line, only after a Save that cannot go ahead: "Write something
 *    first", or in the dialog "Choose a contact first".
 * 4. The action bar: the type control (a radiogroup, text from `sm` and
 *    glyphs below) and Save.
 *
 * In the narrow contact layout the composer is `collapsible`: one line, the
 * editor alone, until it takes focus. The page opens on the timeline, not on
 * an empty form.
 *
 * Save is always enabled. A disabled button said nothing about why it could
 * not be pressed, and a keyboard user could not reach it to find out. A Save
 * with nothing to send now says what is missing and puts focus where it can
 * be fixed.
 *
 * The rules a save keeps, from the composer this replaces:
 *
 * - Nothing is cleared until the server has the note, and then only the part
 *   that was sent (`lib/composerSubmission`).
 * - On the contact page the draft is on disk within a moment of typing, per
 *   account and contact (`lib/composerDrafts`). The compact composer keeps no
 *   draft: the dialog opens empty, and its contact can change under the text.
 * - One request at a time, however Save is pressed.
 *
 * @module components/InteractionComposer
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
import { formatWhen } from "../lib/datetime";
import { LinkPreviewExtension } from "./LinkPreviewExtension";
import { getMentionSuggestion } from "./MentionSuggestion";
import { Segmented, type SegmentedOption } from "./ui/Segmented";
import { useAddInteraction, useContactNames } from "../api";
import type { Interaction } from "../types";
import { COMPOSER, KBD_SM, TAG_PILL } from "../lib/styles";
import { cn } from "../lib/utils";
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

export type { InteractionKind };

/** The type control's options, in the order they are shown. */
export const INTERACTION_TYPES: readonly SegmentedOption<InteractionKind>[] = [
  { value: "note", label: INTERACTION_LABELS.note, icon: FileText },
  { value: "call", label: INTERACTION_LABELS.call, icon: Phone },
  { value: "meeting", label: INTERACTION_LABELS.meeting, icon: Handshake },
  { value: "email", label: INTERACTION_LABELS.email, icon: Mail },
];

/** Placeholder copy per interaction type. Also the editor's description. */
const PLACEHOLDERS: Record<InteractionKind, string> = {
  note: "Write a quick note...",
  call: "Summarize the call...",
  meeting: "Capture meeting highlights...",
  email: "Log an email interaction...",
};

/** What a Save that cannot go ahead says. */
export const COMPOSER_MESSAGES = {
  empty: "Write something first",
  contact: "Choose a contact first",
} as const;

type Problem = keyof typeof COMPOSER_MESSAGES;

/** How long after the last keystroke the draft is written to storage. */
const DRAFT_WRITE_DELAY_MS = 300;

/**
 * The follow-up task in a "next action" line, or null when it names no date.
 *
 * The date is what chrono found. The title is the rest of the line with the
 * date and the small words around it removed, so "Send slides next Tuesday"
 * becomes "Send slides", and a line that is only a date becomes "Follow up".
 */
function followUpFromText(
  text: string,
): { title: string; dueAt: string } | null {
  const parsedDate = chrono.parseDate(text);
  if (!parsedDate) return null;
  const chronoResult = chrono.parse(text)[0];
  let actionItemTitle = "Follow up";

  if (chronoResult && chronoResult.text) {
    let titleText = text.replace(chronoResult.text, "").trim();

    let previous;
    do {
      previous = titleText;
      titleText = titleText
        .replace(/^(on|at|by|in|for|with|the|to)\s+/i, "")
        .trim();
      titleText = titleText
        .replace(/\s+(on|at|by|in|for|with|the|to)$/i, "")
        .trim();
    } while (titleText !== previous);

    if (titleText.length > 0) {
      actionItemTitle = titleText.charAt(0).toUpperCase() + titleText.slice(1);
    }
  }

  return { title: actionItemTitle, dueAt: parsedDate.toISOString() };
}

/**
 * What is left of the follow-up line once the submitted part is removed.
 *
 * The same rule the editor follows. A line that was not touched while the
 * save was out is cleared. A line the person kept typing into keeps only what
 * they added. A line rewritten from scratch is theirs and stays whole.
 */
function followUpRemainder(current: string, submitted: string): string {
  if (current === submitted) return "";
  if (current.startsWith(submitted)) {
    return current.slice(submitted.length).trimStart();
  }
  return current;
}

/** The title an interaction is stored with, from its type and content. */
function titleFor(kind: InteractionKind, hasContent: boolean): string {
  if (kind !== "note") return `Logged ${kind}`;
  return hasContent ? "Quick Note" : "Action Scheduled";
}

export interface InteractionComposerProps {
  /**
   * Who the interaction is with. Null in the quick interaction dialog until
   * a contact is chosen, and a Save then asks for one.
   */
  contactId: string | null;
  /**
   * The dialog's form: no card around it, and no draft on disk. Everything
   * else, the editor, mentions, the follow-up line and the keys, is the same.
   */
  compact?: boolean;
  /**
   * True when something outside asks the editor to take focus: "Log
   * interaction" in the contact header, or the dialog once it has a contact.
   * The composer focuses the editor as soon as it exists and calls
   * `onFocusHandled`, and the caller sets this back to false.
   */
  focusRequested?: boolean;
  onFocusHandled?: () => void;
  /** Called after the server has the interaction. */
  onSaved?: (saved: { type: InteractionKind; contactId: string }) => void;
  /** Called when Save is pressed with no contact. The dialog focuses its picker. */
  onContactMissing?: () => void;
  /**
   * The narrow contact page's form. The composer is one line, the editor
   * alone, until something in it takes focus. Then the next-action line,
   * the type control and Save open under it. It closes again when focus
   * leaves and there is nothing written.
   */
  collapsible?: boolean;
}

export const InteractionComposer = (props: InteractionComposerProps) => {
  const { user } = useAuth();
  const storageKey =
    !props.compact && props.contactId
      ? draftKey(user?.id, props.contactId)
      : null;
  // Keyed on the draft, so a change of contact or of account replaces the
  // editor rather than carrying one person's half-written note onto another
  // page. The unmount flushes the old draft, the mount reads the new one.
  // The compact composer keeps one editor while its contact is chosen.
  return (
    <Composer
      key={storageKey ?? "compact"}
      {...props}
      storageKey={storageKey}
    />
  );
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
   * draft that comes back from disk opens it, so half-written text never
   * hides behind one line.
   */
  const [opened, setOpened] = useState(() => !!draft && !isEmptyDraft(draft));
  const expanded = !collapsible || opened;
  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * Mirrors `type` for the Placeholder callback and for the submit path, both
   * of which run outside React's render cycle and so cannot close over state.
   */
  const typeRef = useRef<InteractionKind>(type);
  const { data: allContacts = [] } = useContactNames();
  /**
   * The people @ can mention, read at the moment somebody types @. The
   * editor is created once, so a list captured then would stay empty when
   * the names had not loaded yet.
   */
  const contactsRef = useRef(allContacts);
  useEffect(() => {
    contactsRef.current = allContacts;
  }, [allContacts]);
  const addInteraction = useAddInteraction();
  const [followUpText, setFollowUpText] = useState(draft?.followUpText ?? "");
  const followUpRef = useRef(followUpText);
  const [isSaving, setIsSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const parsedDate = chrono.parseDate(followUpText);
  const placeholderId = React.useId();
  const messageId = React.useId();

  /**
   * Refs for everything the submit path reads.
   *
   * The Mod-Enter shortcut is registered once, when the editor is created,
   * with whatever closures the first render had. Read through state, it sent
   * a "note" with no follow-up whatever the screen showed. Read through refs
   * it sends what is there. `pendingRef` is the duplicate guard for the same
   * reason: the button reads state, the shortcut cannot.
   */
  const editorRef = useRef<Editor | null>(null);
  const pendingRef = useRef(false);
  const submitRef = useRef<() => void>(() => {});
  const contactIdRef = useRef(contactId);
  useEffect(() => {
    contactIdRef.current = contactId;
  }, [contactId]);
  /** The editor's HTML as of its last update, readable after it is gone. */
  const lastHtmlRef = useRef(draft?.html ?? "");

  // ── The draft ──────────────────────────────────────────────────────────
  // Written a moment after the last keystroke, and at once when the page is
  // hidden, unloaded, or this composer leaves the tree. A session that
  // expires while a save is out ends with the gate replacing the whole app,
  // and the unmount flush is what puts the note on disk before that.
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
    const target = contactIdRef.current;
    if (!target) {
      setProblem("contact");
      onContactMissing?.();
      return;
    }
    setProblem(null);

    const payload: Partial<Interaction> = {
      type: kind,
      title: titleFor(kind, !isEditorEmpty),
      content: isEditorEmpty ? null : editor.getHTML(),
      date: new Date().toISOString(),
    };
    const followUpItem = followUpFromText(followUp);
    if (followUpItem) payload.actionItem = followUpItem;

    // Nothing is cleared yet. The mark records where the submitted content
    // ends and follows it through anything typed while the request is out.
    const mark = markSubmission(editor);
    pendingRef.current = true;
    setIsSaving(true);
    try {
      await addInteraction.mutateAsync({ contactId: target, data: payload });

      if (followUpItem) toast.success("Follow-up scheduled!");
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
      toast.error("Failed to log interaction");
    } finally {
      pendingRef.current = false;
      setIsSaving(false);
    }
  }, [addInteraction, onContactMissing, onSaved, persistNow, persistSoon]);

  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  // Created once. The shortcut reaches the current submit through the ref,
  // so it does not matter that the editor keeps the first render's copy. It
  // also has to win over StarterKit's hard break, which binds the same keys.
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
        // A function, not a string: it is re-evaluated whenever the
        // placeholder decoration is recomputed, so switching interaction type
        // needs no reach into the editor's internals.
        placeholder: () => PLACEHOLDERS[typeRef.current],
        showOnlyWhenEditable: false,
      }),
      SubmitExtension,
      Mention.configure({
        HTMLAttributes: {
          class:
            "bg-primary/10 text-on-primary-wash font-bold px-1 py-0.5 rounded-md cursor-pointer",
        },
        suggestion: getMentionSuggestion(() => contactsRef.current),
      }),
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
       * A name and a description for the contenteditable.
       *
       * Without them a screen reader lands on an unnamed, empty region. The
       * placeholder is a CSS decoration, so it is not read either, and the
       * description points at a hidden copy of it. These attributes are set
       * once, when the editor is created, so the id must not change.
       *
       * 16 px text on a phone: iOS zooms the page when a smaller field takes
       * focus, which in the dialog's bottom sheet moves Save off the screen.
       */
      attributes: {
        role: "textbox",
        "aria-label": "Note",
        "aria-multiline": "true",
        "aria-describedby": placeholderId,
        class:
          "prose prose-sm max-w-none min-h-[80px] text-base sm:text-sm text-on-surface break-words prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1",
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
   * Refresh the placeholder when the interaction type changes.
   *
   * The placeholder is a function (see Placeholder.configure above), so all
   * this has to do is ask ProseMirror to recompute decorations. It used to
   * reach into `editor.extensionManager`, which is null until the editor has
   * finished initialising, and that crashed the contact page.
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
   * and no save is out. Focus moving between the editor, the next-action
   * line, the type control and Save keeps it open.
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
              // `clip` and not `hidden` when the bar can stick: an overflow
              // that hides makes the card the bar's scroller, and the bar
              // would never move.
              collapsible ? "overflow-clip" : "overflow-hidden",
            ),
      )}
    >
      {/* Editor area. While collapsed, a tap anywhere on the line focuses the
          editor, not only a tap on its text. The editor is the keyboard's way
          in, so the area needs no key handler of its own. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
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

        {/* The next-action line, and the save hint at its end */}
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
              aria-label="Next action"
              value={followUpText}
              onChange={(e) => {
                setFollowUpText(e.target.value);
                if (e.target.value.trim()) setProblem(null);
              }}
              // Short enough for a phone's field: the long example was cut
              // mid-word at 390 px.
              placeholder="Next action, like follow up Tuesday"
              // A field draws no `::after`, so the 44 px tap floor on a phone
              // has to be the field's own height. 16 px there stops iOS
              // zooming in.
              className="flex-1 min-w-0 min-h-[44px] sm:min-h-0 bg-transparent border-none text-base sm:text-xs font-semibold text-on-surface p-0 placeholder:text-on-surface-variant"
            />
            {parsedDate && (
              <span className={cn(TAG_PILL, "ml-2 shrink-0")}>
                {formatWhen(parsedDate.toISOString())}
              </span>
            )}
          </div>
          {/* Here and not beside Save: in the dialog the type control and
              Save already fill the bar. Phones have no keyboard to press it
              with. */}
          <span className="hidden sm:inline-flex items-center gap-1 shrink-0 text-xs text-on-surface-variant whitespace-nowrap">
            <kbd className={KBD_SM}>⌘</kbd>
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
          // On a phone a long note pushes Save down the page. The bar then
          // sticks right on top of the tab bar, which is `md:hidden`, so Save
          // stays in reach while the note is written. The offset is the tab
          // bar's height: 3 rem of tab, 0.375 rem above it, and the larger of
          // 0.75 rem and the home indicator's inset below it (App.tsx).
          collapsible &&
            "sticky bottom-[calc(3.375rem+max(0.75rem,env(safe-area-inset-bottom)))] md:static z-10 bg-surface-container-low",
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
