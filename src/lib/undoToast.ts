/**
 * The one place that describes a contact deletion to the person. A delete is
 * soft: the contact sits in Trash for the retention an admin sets. So the
 * toast says so and offers Undo, instead of a confirmation dialog that would
 * tax every correct deletion to guard against a mistake Trash covers.
 */
import { useEffect } from "react";
import { toast } from "sonner";
import { MAIN_CONTENT_ID } from "../components/layout/SkipLink";

/**
 * How long Undo stays on screen: longer than Sonner's 4 s default, because
 * realizing a mistake takes a beat, and short enough not to linger.
 */
export const UNDO_DURATION_MS = 10_000;

/**
 * The options of a toast for a write that Undo reverses: the Undo action,
 * on screen as long as a deletion's.
 */
export const withUndo = (onUndo: () => void) => ({
  duration: UNDO_DURATION_MS,
  action: { label: "Undo", onClick: onUndo },
});

interface UndoableDeleteOptions {
  /** How many contacts went to Trash. */
  count: number;
  /** Used instead of a count when exactly one contact is named. */
  name?: string;
  /**
   * How long Trash keeps them. The server answers it with the delete, because
   * an admin sets it and a member cannot read that setting.
   */
  retentionDays: number;
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
  retentionDays,
  onUndo,
}: UndoableDeleteOptions): void {
  const subject = name ?? `${count} contact${count === 1 ? "" : "s"}`;
  const kept = `${retentionDays} ${retentionDays === 1 ? "day" : "days"}`;

  toast.success(`${subject} moved to Trash`, {
    description: `Restorable for ${kept}`,
    ...withUndo(onUndo),
  });
}

const inToasts = (node: EventTarget | null) =>
  node instanceof Element && node.closest("[data-sonner-toaster]") !== null;

/**
 * Alt+T takes the keyboard to the toasts (Sonner's key). A pressed Undo
 * leaves with its toast, so this puts focus back where it was before Alt+T,
 * or on the page's content when that element is gone. Called once, in App.
 */
export function useToastFocusReturn(): void {
  useEffect(() => {
    let before: HTMLElement | null = null;
    const onFocusIn = (event: FocusEvent) => {
      if (inToasts(event.target) && !inToasts(event.relatedTarget)) {
        before = event.relatedTarget as HTMLElement | null;
      }
    };
    const onClick = (event: MouseEvent) => {
      // A key pressed the button (`detail` 0): a pointer keeps its place.
      if (event.detail !== 0 || !inToasts(event.target)) return;
      setTimeout(() => {
        const active = document.activeElement;
        if (active && active !== document.body && !inToasts(active)) return;
        const target = before?.isConnected
          ? before
          : document.getElementById(MAIN_CONTENT_ID);
        target?.focus({ preventScroll: true });
      });
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
}
