/**
 * InteractionDetailModal: one timeline entry, read in full or edited.
 *
 * Built on the shared `Modal`, so it is a dialog like every other: focus
 * moves in and stays in, Escape and Android's Back close it, a phone shows
 * it as a sheet, and the page behind it (the map under a contact) does not
 * also take the Escape. It was a hand-made overlay that did none of this.
 *
 * Edit uses the note editor itself (`NoteEditor`, from the composer's
 * chunk), so a note keeps its paragraphs and @mentions. It used to open the
 * raw HTML in a plain box. A Save that fails keeps the edit and says so, and
 * a close with unsaved changes asks first.
 *
 * A follow-up's row marks it done. The request waits for the toast's Undo
 * (`startPendingDelete`, as on Pulse): no route reopens a follow-up.
 */
import React, { Suspense } from "react";
import DOMPurify from "dompurify";
import {
  CalendarCheck,
  FileText,
  Calendar,
  Mail,
  Phone,
  Handshake,
  ActivitySquare,
  Edit2,
  Save,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { type Interaction } from "../../../types";
import { DialogCloseButton, Modal } from "../../../components/ui/Modal";
import { noteEditorChunk } from "../../../components/composerChunk";
import {
  BTN_QUIET,
  LABEL,
  SECTION_HEADING,
  TONE_TEXT,
} from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { TIPTAP_SANITIZE_CONFIG } from "../../../lib/sanitize";
import { formatDue, formatWhen } from "../../../lib/datetime";
import { isPastDay } from "../../../../shared/dates";
import { useHiddenPendingIds } from "../../../lib/pendingDeletes";

const NoteEditor = noteEditorChunk.Component;

interface InteractionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  interaction: Interaction | null;
  /** Marks a follow-up done, with Undo. */
  onCompleteActionItem: (id: string) => void;
  /** Resolves when the server has the change, and rejects when it failed. */
  onUpdateInteraction: (
    id: string,
    data: { title?: string; content?: string | null },
  ) => Promise<unknown>;
  /** Open in edit mode. The timeline kebab's Edit sets it. */
  initialEditing?: boolean;
  /**
   * Shows a Delete button beside Edit. The caller asks for confirmation in a
   * dialog over this one, so Cancel brings focus back to Delete.
   */
  onDelete?: () => void;
}

const TYPE_ICONS: Record<string, LucideIcon> = {
  note: FileText,
  call: Phone,
  meeting: Handshake,
  email: Mail,
};

export const InteractionDetailModal = ({
  isOpen,
  onClose,
  interaction,
  onCompleteActionItem,
  onUpdateInteraction,
  initialEditing = false,
  onDelete,
}: InteractionDetailModalProps) => {
  const [isEditing, setIsEditing] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [content, setContent] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  /** A close was asked for with unsaved changes: the dialog asks first. */
  const [askDiscard, setAskDiscard] = React.useState(false);
  const pending = useHiddenPendingIds();

  // Each opening starts from the saved note. Not on each refetch of the
  // same note: that would drop an edit.
  const id = interaction?.id;
  React.useEffect(() => {
    if (!isOpen || !interaction) return;
    setTitle(interaction.title);
    setContent(interaction.content ?? "");
    setIsEditing(initialEditing);
    setAskDiscard(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, id, initialEditing]);

  const sanitizedContent = React.useMemo(
    () =>
      interaction?.content
        ? DOMPurify.sanitize(interaction.content, TIPTAP_SANITIZE_CONFIG)
        : "",
    [interaction?.content],
  );

  if (!interaction) return null;

  const dirty =
    isEditing &&
    (title !== interaction.title || content !== (interaction.content ?? ""));
  const close = () => (dirty ? setAskDiscard(true) : onClose());

  const save = async () => {
    setSaving(true);
    try {
      await onUpdateInteraction(interaction.id, {
        title: title.trim() || interaction.title,
        content: content || null,
      });
      setIsEditing(false);
      setAskDiscard(false);
    } catch {
      toast.error("Could not save the note. Your changes are still here");
    } finally {
      setSaving(false);
    }
  };

  const Icon = TYPE_ICONS[interaction.type.toLowerCase()] ?? ActivitySquare;
  const hasContent = !!sanitizedContent && sanitizedContent !== "<p></p>";

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      ariaLabel={interaction.title}
      size="lg"
    >
      {/* The title has a row of its own, so a phone shows all of it. */}
      <div className="shrink-0 px-5 pt-3 pb-4 sm:px-6 sm:pt-5 bg-surface-container-low">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-primary/10 shrink-0">
            <Icon aria-hidden="true" className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                aria-label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="min-h-[44px] sm:pointer-fine:min-h-0 text-base sm:text-lg font-bold text-on-surface w-full bg-surface-container-lowest px-2 py-0.5 rounded-lg"
              />
            ) : (
              // The dialog's own heading, which names it, is the title for a
              // screen reader. This is the same words, drawn.
              <p
                aria-hidden="true"
                className="text-lg font-bold font-headline text-on-surface break-words"
              >
                {interaction.title}
              </p>
            )}
            <p className="text-xs text-on-surface-variant font-medium flex items-center gap-1.5 mt-0.5">
              <Calendar aria-hidden="true" className="w-3 h-3" />
              {formatWhen(interaction.date)}
            </p>
          </div>
          <DialogCloseButton onClick={close} />
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3 sm:pl-12">
          {askDiscard ? (
            <>
              <span
                role="alert"
                className="text-sm font-semibold text-on-surface mr-auto"
              >
                Discard your changes?
              </span>
              <button
                type="button"
                onClick={() => setAskDiscard(false)}
                className="btn-secondary btn-sm"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={onClose}
                className="btn-danger btn-sm"
              >
                Discard
              </button>
            </>
          ) : isEditing ? (
            <>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="btn-primary btn-sm"
              >
                <Save aria-hidden="true" className="w-4 h-4" />
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTitle(interaction.title);
                  setContent(interaction.content ?? "");
                  setIsEditing(false);
                }}
                className={BTN_QUIET}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className={BTN_QUIET}
              >
                <Edit2 aria-hidden="true" className="w-4 h-4" /> Edit
              </button>
              {onDelete && (
                // The same quiet look as Edit. Red shows only inside the
                // confirmation, where the choice is made.
                <button type="button" onClick={onDelete} className={BTN_QUIET}>
                  <Trash2 aria-hidden="true" className="w-4 h-4" /> Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="p-5 sm:p-8 flex flex-col gap-8">
        <div>
          <h3 className={cn(SECTION_HEADING, "mb-3")}>Transcript and notes</h3>
          {isEditing ? (
            <Suspense
              fallback={
                <div className="min-h-[80px] rounded-xl bg-surface-container-low" />
              }
            >
              <NoteEditor html={content} onChange={setContent} />
            </Suspense>
          ) : hasContent ? (
            <div
              className="prose prose-sm max-w-none text-on-surface prose-p:my-2 prose-headings:my-3 break-words prose-a:text-primary"
              dangerouslySetInnerHTML={{ __html: sanitizedContent }}
            />
          ) : (
            <span className="text-sm italic text-on-surface-variant">
              No notes
            </span>
          )}
        </div>

        {!!interaction.actionItems?.length && (
          <div>
            <h3 className={cn(SECTION_HEADING, "mb-3")}>Follow-up</h3>
            <ul className="flex flex-col gap-2">
              {interaction.actionItems.map((action) => {
                const done = !!action.completedAt || pending.has(action.id);
                return (
                  <li key={action.id}>
                    {/* One control per row: the row is the button. */}
                    <button
                      type="button"
                      disabled={done}
                      aria-label={
                        done
                          ? `${action.title}, done`
                          : `Mark done: ${action.title}`
                      }
                      onClick={() => onCompleteActionItem(action.id)}
                      className={cn(
                        "w-full flex items-start gap-3 p-3 rounded-xl bg-surface-container text-left transition-colors",
                        done ? "cursor-default" : "state-layer group",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0",
                          done
                            ? "bg-primary border-primary text-on-primary"
                            : "border-on-surface-variant/40 bg-surface-container-low group-hover:border-primary/50",
                        )}
                      >
                        {done && <CalendarCheck className="w-3 h-3" />}
                      </span>
                      <span className="flex flex-col min-w-0">
                        <span
                          className={cn(
                            "text-sm font-bold break-words",
                            done
                              ? "text-on-surface-variant line-through"
                              : "text-on-surface group-hover:text-primary",
                          )}
                        >
                          {action.title}
                        </span>
                        {/* Red only when it is late: the error tone means
                            overdue, not due. */}
                        <span
                          className={cn(
                            LABEL,
                            "mt-0.5",
                            !done && isPastDay(action.dueAt) && TONE_TEXT.error,
                          )}
                        >
                          Due {formatDue(action.dueAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
};
