import React, { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import { LinkPreviewExtension } from "./LinkPreviewExtension";
import { useAddInteraction, useContactNames } from "../api";
import type { Interaction } from "../types";
import { getMentionSuggestion } from "./MentionSuggestion";
import { FileText, Phone, Handshake, Mail, CalendarClock } from "lucide-react";
import * as chrono from "chrono-node";
import { format } from "date-fns";
import { toast } from "sonner";
import { COMPOSER, TAG_PILL, iconToggle } from "../lib/styles";
import { cn } from "../lib/utils";
import { useAuth } from "./auth/AuthGate";
import {
  draftKey,
  readDraft,
  writeDraft,
  type DraftKind,
} from "../lib/composerDrafts";
import { markSubmission, removeSubmitted } from "../lib/composerSubmission";

/** Placeholder copy per interaction type — see the Placeholder config below. */
const PLACEHOLDERS = {
  note: "Write a quick note...",
  call: "Summarize the call...",
  meeting: "Capture meeting highlights...",
  email: "Log an email interaction...",
} as const;

type InteractionKind = DraftKind;

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
      // Capitalize first letter
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

export const RichInteractionComposer = ({
  contactId,
}: {
  contactId: string;
}) => {
  const { user } = useAuth();
  const storageKey = draftKey(user?.id, contactId);
  // Keyed on the draft, so a change of contact or of account replaces the
  // editor rather than carrying one person's half-written note onto another
  // page. The unmount flushes the old draft, the mount reads the new one.
  return (
    <Composer key={storageKey} contactId={contactId} storageKey={storageKey} />
  );
};

/**
 * The type toggle's look: `iconToggle` with a neutral selected state.
 *
 * The shared active state is a solid primary fill, and the primary is the
 * contact's colour, so under a violet contact the selected type read as the
 * AI colour. Choosing a type is a selection, not AI, so it wears a neutral
 * fill. `hit-area` gives each 32 px toggle a 44 px tap box.
 */
const typeToggle = (active: boolean) =>
  cn(
    iconToggle(active),
    "hit-area",
    active && "bg-surface-container-high text-on-surface",
  );

const Composer = ({
  contactId,
  storageKey,
}: {
  contactId: string;
  storageKey: string;
}) => {
  const [draft] = useState(() => readDraft(storageKey));
  const [type, setType] = useState<InteractionKind>(draft?.type ?? "note");
  /**
   * Mirrors `type` for the Placeholder callback and for the submit path, both
   * of which run outside React's render cycle and so cannot close over state.
   */
  const typeRef = useRef<InteractionKind>(type);
  const { data: allContacts = [] } = useContactNames();
  const addInteraction = useAddInteraction();
  const [followUpText, setFollowUpText] = useState(draft?.followUpText ?? "");
  const followUpRef = useRef(followUpText);
  const [hasContent, setHasContent] = useState(
    !!draft && draft.html.trim() !== "" && draft.html.trim() !== "<p></p>",
  );
  const [isSaving, setIsSaving] = useState(false);
  const parsedDate = chrono.parseDate(followUpText);
  const placeholderId = React.useId();

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
    writeDraft(storageKey, {
      html: lastHtmlRef.current,
      followUpText: followUpRef.current,
      type: typeRef.current,
    });
  }, [storageKey]);
  const persistSoon = useCallback(() => {
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(persistNow, DRAFT_WRITE_DELAY_MS);
  }, [persistNow]);

  useEffect(() => {
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
  }, [persistNow]);

  useEffect(() => {
    followUpRef.current = followUpText;
    persistSoon();
  }, [followUpText, persistSoon]);

  // ── The save ───────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed || pendingRef.current) return;

    const kind = typeRef.current;
    const followUp = followUpRef.current;
    const isEditorEmpty = editor.isEmpty;
    if (isEditorEmpty && !followUp.trim()) return;

    const payload: Partial<Interaction> = {
      type: kind,
      title:
        kind === "note"
          ? isEditorEmpty
            ? "Action Scheduled"
            : "Quick Note"
          : `Logged ${kind}`,
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
      await addInteraction.mutateAsync({ contactId, data: payload });

      if (followUpItem) toast.success("Follow-up scheduled!");
      // Only now, and only the submitted part.
      removeSubmitted(editor, mark);
      setFollowUpText((current) => followUpRemainder(current, followUp));
      persistSoon();
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
  }, [addInteraction, contactId, persistNow, persistSoon]);

  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  // Created once. The shortcut reaches the current submit through the ref,
  // so it does not matter that the editor keeps the first render's copy.
  const [SubmitExtension] = useState(() =>
    Extension.create({
      name: "submitShortcut",
      addKeyboardShortcuts() {
        return {
          "Mod-Enter": () => {
            submitRef.current();
            return true; // prevent default behavior
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
            "bg-primary/10 text-primary font-bold px-1 py-0.5 rounded-md cursor-pointer",
        },
        suggestion: getMentionSuggestion(allContacts),
      }),
      LinkPreviewExtension,
    ],
    content: draft?.html ?? "",
    onUpdate: ({ editor }) => {
      lastHtmlRef.current = editor.isEmpty ? "" : editor.getHTML();
      setHasContent(!editor.isEmpty);
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
       */
      attributes: {
        role: "textbox",
        "aria-label": "Note",
        "aria-multiline": "true",
        "aria-describedby": placeholderId,
        class:
          "prose prose-sm max-w-none focus:outline-none min-h-[80px] text-on-surface break-words prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1",
      },
    },
  });

  useEffect(() => {
    editorRef.current = editor ?? null;
  }, [editor]);

  /*
   * Refresh the placeholder when the interaction type changes.
   *
   * This used to reach into `editor.extensionManager.extensions`, find the
   * placeholder extension by name with a non-null assertion, and mutate its
   * options in place. That crashed the whole contact detail view the moment
   * the composer was code-split — `extensionManager` is null until the editor
   * finishes initialising, and the `if (editor)` guard did not catch it
   * because the editor object itself exists by then.
   *
   * The placeholder is now a function (see Placeholder.configure above), so
   * all this has to do is ask ProseMirror to recompute decorations.
   */
  useEffect(() => {
    typeRef.current = type;
    persistSoon();
    if (editor && !editor.isDestroyed && editor.view) {
      editor.view.dispatch(editor.state.tr);
    }
  }, [type, editor, persistSoon]);

  const canSave = (hasContent || followUpText.trim().length > 0) && !isSaving;

  return (
    <div
      className={cn(COMPOSER, "p-0 overflow-hidden flex flex-col shadow-md")}
    >
      {/* Editor area */}
      <div className="p-5 flex-1 relative">
        <EditorContent editor={editor} className="w-full custom-tiptap" />
        {/* The placeholder as text, for the editor's aria-describedby. */}
        <span id={placeholderId} className="sr-only">
          {PLACEHOLDERS[type]}
        </span>

        {/* Next action field smoothly integrated into the editor card */}
        <div className="mt-4 group flex items-center relative">
          <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-surface-container to-transparent -top-3 opacity-50" />
          <div className="flex flex-1 items-center px-3 py-2.5 bg-surface-container-lowest rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-primary/20 transition-all">
            <CalendarClock className="w-4 h-4 text-primary mr-2.5 shrink-0" />
            <input
              aria-label="Next action"
              value={followUpText}
              onChange={(e) => setFollowUpText(e.target.value)}
              placeholder="Next Action (e.g. Follow up next Tuesday at 2pm)..."
              className="flex-1 bg-transparent border-none text-xs font-semibold text-on-surface focus:ring-0 p-0 focus:outline-none placeholder:text-on-surface-variant"
            />
            {parsedDate && (
              <span className={cn(TAG_PILL, "ml-2 shrink-0 shadow-sm")}>
                {format(parsedDate, "MMM d, h:mm a")}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="bg-surface-container-low/40 px-5 py-3 flex items-center justify-between">
        {/*
          Icon buttons named by `aria-label`. They used to carry a `title`
          alone, which names a control for a pointer on hover and for nobody
          on touch.
        */}
        <div
          role="group"
          aria-label="Interaction type"
          className="flex gap-1.5 bg-surface-container-lowest p-1 rounded-xl shadow-sm"
        >
          <button
            onClick={() => setType("note")}
            className={typeToggle(type === "note")}
            aria-pressed={type === "note"}
            aria-label="Note"
          >
            <FileText className="w-4 h-4" />
          </button>
          <button
            onClick={() => setType("call")}
            className={typeToggle(type === "call")}
            aria-pressed={type === "call"}
            aria-label="Call"
          >
            <Phone className="w-4 h-4" />
          </button>
          <button
            onClick={() => setType("meeting")}
            className={typeToggle(type === "meeting")}
            aria-pressed={type === "meeting"}
            aria-label="Meeting"
          >
            <Handshake className="w-4 h-4" />
          </button>
          <button
            onClick={() => setType("email")}
            className={typeToggle(type === "email")}
            aria-pressed={type === "email"}
            aria-label="Email"
          >
            <Mail className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={() => submitRef.current()}
          disabled={!canSave}
          aria-busy={isSaving}
          className="btn-primary px-7"
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
};
