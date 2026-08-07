/**
 * undoToast — the one place that describes a deletion to the user.
 *
 * Deleting a contact in Contrack is a soft delete: the row gets a `deletedAt`
 * stamp and sits in Trash for 30 days. The UI did not say so. The bulk-delete
 * dialog claimed "Permanently delete N contacts… This cannot be undone", and
 * the archived view's success toast said "Permanently deleted" — both plainly
 * false, and false in the expensive direction. Telling someone a reversible
 * action is irreversible makes them hedge: they archive things they meant to
 * delete, and the list they came to tidy stays untidy.
 *
 * A confirmation dialog is also the wrong control here. It taxes every correct
 * deletion — the overwhelming majority — to guard against a rare mistake that
 * Trash already covers. An undo affordance charges nothing up front and is
 * there exactly when it is needed.
 *
 * @module lib/undoToast
 */
import { toast } from "sonner";

/**
 * How long the undo stays on screen.
 *
 * Longer than sonner's 4s default: undo is only useful if it is still there
 * when the user realises what they did, and realising takes a beat. Short
 * enough that it does not linger over the next thing they do.
 */
const UNDO_DURATION_MS = 10_000;

export interface UndoableDeleteOptions {
  /** How many contacts went to Trash. */
  count: number;
  /** Used instead of a count when exactly one contact is named. */
  name?: string;
  /** Put them back. */
  onUndo: () => void;
}

/**
 * Announce a completed soft-delete with an Undo action.
 *
 * @example toastUndoableDelete({ name: "Alex Chen", onUndo: restore, count: 1 })
 * @example toastUndoableDelete({ count: 12, onUndo: restoreAll })
 */
export function toastUndoableDelete({
  count,
  name,
  onUndo,
}: UndoableDeleteOptions): void {
  const subject = name ?? `${count} contact${count === 1 ? "" : "s"}`;

  toast.success(`${subject} moved to Trash`, {
    description: "Restorable for 30 days.",
    duration: UNDO_DURATION_MS,
    action: {
      label: "Undo",
      onClick: onUndo,
    },
  });
}
