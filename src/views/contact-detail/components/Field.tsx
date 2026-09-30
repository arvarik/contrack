/**
 * Field: one labelled value, or one labelled list of values, in the Details
 * card.
 *
 * The card had three ways to add a value, and each looked different (finding
 * A3 of the UI review). Emails and phones had an italic "Add another" that
 * read as a placeholder. Preferences and interests had an underlined bare
 * input that looked like a line under the card. The labels were uppercase
 * under an uppercase heading, so the heading did not stand out (D9). Every
 * value now sits in the same frame:
 *
 * 1. A label in sentence case at 12 px (`FIELD_LABEL`). It also names the
 *    group, so a screen reader says "Email" before the rows.
 * 2. The value. A click or Enter edits it in place, and a pencil marks it on
 *    touch and on keyboard focus (`EditableField`, `EditHint`).
 * 3. One "+ Add" button. It is a real button in primary text with a 44 px
 *    tap box (`ADD_BUTTON`).
 *
 * The label is a `span` and not a `<label>`. The value is a button, and a
 * `<label>` names a form field, not a button.
 *
 * @module views/contact-detail/components/Field
 */
import React, { useId } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { ADD_BUTTON, FIELD_LABEL } from "../../../lib/styles";

/** The text of a value at rest: 14 px, medium weight, full contrast. */
export const FIELD_VALUE = "text-sm font-medium text-on-surface";

export interface AddButtonProps {
  /**
   * The accessible name, for example "Add email". The visible text is "Add",
   * so the name must contain "Add" for speech input to find the button.
   */
  label: string;
  onClick: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * "+ Add" under a field. A caller that moves focus back to it after a form
 * closes passes a `ref`.
 */
export const AddButton = ({ label, onClick, ref }: AddButtonProps) => (
  <button
    ref={ref}
    type="button"
    aria-label={label}
    onClick={onClick}
    className={ADD_BUTTON}
  >
    <Plus aria-hidden="true" className="w-4 h-4" />
    Add
  </button>
);

export interface FieldProps {
  /** The name above the value, in sentence case: "Email", "Next follow-up". */
  label: string;
  children?: React.ReactNode;
}

export const Field = ({ label, children }: FieldProps) => {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1">
      <span id={labelId} className={FIELD_LABEL}>
        {label}
      </span>
      {children}
    </div>
  );
};

/**
 * Offers "Undo" for 7 seconds after a value is removed.
 *
 * A remove saves at once and asks nothing first, so a slip of the thumb needs
 * a way back. Every remove in the card uses this one toast.
 */
export const showUndoToast = (label: string, onUndo: () => void) => {
  toast(label, {
    duration: 7000,
    action: {
      label: "Undo",
      onClick: onUndo,
    },
  });
};
