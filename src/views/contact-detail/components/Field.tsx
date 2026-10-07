/**
 * Field: one labeled value, or one labeled list of values, in the Details
 * card. Every value sits in the same frame:
 *
 * 1. A sentence-case label (`FIELD_LABEL`) that also names the group, so a
 *    screen reader says "Email" before the rows.
 * 2. The value, edited in place (`EditableField`).
 * 3. One "+ Add" button with a 44 px tap box (`ADD_BUTTON`).
 *
 * The label is a `span`: the value is a button, and a `<label>` names a
 * form field, not a button.
 */
import React, { useId } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { ADD_BUTTON, FIELD_LABEL } from "../../../lib/styles";
import { withUndo } from "../../../lib/undoToast";

/** The text of a value at rest: 14 px, medium weight, full contrast. */
export const FIELD_VALUE = "text-sm font-medium text-on-surface";

interface AddButtonProps {
  /**
   * The accessible name, for example "Add email". The visible text is "Add",
   * so the name must contain "Add" for speech input to find the button.
   */
  label: string;
  onClick: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}

/** "+ Add" under a field. Pass a `ref` to focus it again after a form. */
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

interface FieldProps {
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
 * Offers Undo after a value is removed. A remove saves at once and asks
 * nothing, so every remove on the contact page offers this way back.
 */
export const showUndoToast = (label: string, onUndo: () => void) => {
  toast(label, withUndo(onUndo));
};
