/**
 * ConfirmDialog — the second question before something irreversible.
 *
 * Written for 2.0, where several actions cannot be undone by the person
 * taking them: revoking a token somebody's script is using, revoking an
 * invitation, deleting an account and its contacts. Before this the codebase
 * had no confirmation of any kind, because before this nothing an
 * administrator could do reached anybody else.
 *
 * The rules it encodes:
 *
 *   The title asks the question. The body says what happens, in the specific
 *   — "the script using it stops working", not "this action is permanent".
 *   The confirm button repeats the verb, so the last thing read before the
 *   click names the deed rather than saying "OK".
 *   `children` is where a caller puts anything that has to be true first: a
 *   count, a warning, a checkbox.
 */
import { type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import { cn } from "../../lib/utils";

export const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  tone = "danger",
  busy = false,
  disabled = false,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  /** Repeat the verb: "Revoke token", not "Confirm". */
  confirmLabel: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  /** True while a precondition in `children` is unmet. */
  disabled?: boolean;
  children?: ReactNode;
}) => (
  <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
    <div className="space-y-4">
      {description && (
        <div className="text-sm text-on-surface-variant text-pretty space-y-2">
          {description}
        </div>
      )}
      {children}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className={cn(
            "px-5 py-3 sm:py-2.5 rounded-xl font-bold text-sm",
            "bg-surface-container-high text-on-surface",
            "hover:bg-surface-container-highest transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || disabled}
          className={cn(
            "px-5 py-3 sm:py-2.5 rounded-xl font-bold text-sm",
            "flex items-center justify-center gap-2 transition-opacity hover:opacity-90",
            tone === "danger"
              ? "bg-error text-on-error"
              : "bg-primary text-on-primary",
            "disabled:bg-surface-container-high disabled:text-on-surface-variant",
            "disabled:cursor-not-allowed disabled:hover:opacity-100",
          )}
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {confirmLabel}
        </button>
      </div>
    </div>
  </Modal>
);
