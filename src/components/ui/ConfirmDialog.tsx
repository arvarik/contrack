/**
 * The second question before something irreversible. The title asks it.
 * The body says what happens, specifically ("the script using it stops
 * working"). The confirm button repeats the verb, not "OK". `children`
 * holds what must be true first: a count, a warning, a checkbox.
 */
import { type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import { DIALOG_ACTIONS } from "../../lib/styles";

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
      <div className={DIALOG_ACTIONS}>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="btn-secondary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || disabled}
          className={tone === "danger" ? "btn-danger" : "btn-primary"}
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {confirmLabel}
        </button>
      </div>
    </div>
  </Modal>
);
