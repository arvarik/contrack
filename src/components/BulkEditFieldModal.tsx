import React, { useState } from "react";
import { Pencil } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Select } from "./ui/Select";
import { cn } from "../lib/utils";
import { LABEL } from "../lib/styles";

// ---------------------------------------------------------------------------
// BulkEditFieldModal — pick a field + value to apply to many selected contacts.
//
//   1. The field picker is the shared `Select`, so it opens the same solid
//      panel as every other dropdown in the app and carries the keys, the
//      outside click and the focus return once. It used to be a hand-written
//      listbox with its own click-outside listener.
//   2. Every interactive control meets the 44-px touch-target minimum
//      (Apple HIG / WCAG 2.5.5 AAA), preventing tap-target misses on phones.
//   3. The input uses `text-base` on mobile to suppress iOS Safari's
//      auto-zoom-on-focus behaviour that would jolt the modal layout.
// ---------------------------------------------------------------------------

interface Field {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "number";
}

const EDITABLE_FIELDS: Field[] = [
  {
    key: "role",
    label: "Role / Title",
    placeholder: "e.g. Senior Engineer",
    type: "text",
  },
  {
    key: "company",
    label: "Company",
    placeholder: "e.g. Acme Corp",
    type: "text",
  },
  {
    key: "industry",
    label: "Industry",
    placeholder: "e.g. Technology",
    type: "text",
  },
  {
    key: "location",
    label: "Location",
    placeholder: "e.g. San Francisco, CA",
    type: "text",
  },
  {
    key: "cadenceDays",
    label: "Cadence (days)",
    placeholder: "e.g. 30",
    type: "number",
  },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  selectedCount: number;
  onApply: (field: string, value: string | number) => void;
  isPending: boolean;
}

export const BulkEditFieldModal = ({
  isOpen,
  onClose,
  selectedCount,
  onApply,
  isPending,
}: Props) => {
  const [selectedField, setSelectedField] = useState<Field>(EDITABLE_FIELDS[0]);
  const [value, setValue] = useState("");

  const chooseField = (key: string) => {
    const field = EDITABLE_FIELDS.find((f) => f.key === key);
    if (!field) return;
    setSelectedField(field);
    setValue("");
  };

  const handleApply = () => {
    if (!value.trim()) return;
    const finalVal =
      selectedField.type === "number" ? Number(value) : value.trim();
    onApply(selectedField.key, finalVal);
  };

  const handleClose = () => {
    setValue("");
    setSelectedField(EDITABLE_FIELDS[0]);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Edit Field">
      <div className="space-y-5 pt-2">
        <p className="text-sm sm:text-xs text-on-surface-variant">
          Apply a value to{" "}
          <span className="font-bold text-on-surface">{selectedCount}</span>{" "}
          selected contact{selectedCount !== 1 ? "s" : ""}.
        </p>

        {/* Field selector */}
        <div>
          {/* The visible caption. The Select carries its own name. */}
          <span id="bulk-edit-field-label" className={cn(LABEL, "block mb-2")}>
            Field to Edit
          </span>
          <Select
            variant="field"
            label="Field to edit"
            value={selectedField.key}
            onChange={chooseField}
            options={EDITABLE_FIELDS.map((field) => ({
              value: field.key,
              label: field.label,
            }))}
          />
        </div>

        {/* Value input */}
        <div>
          <label htmlFor="bulk-edit-value" className={cn(LABEL, "block mb-2")}>
            New Value
          </label>
          <input
            id="bulk-edit-value"
            key={selectedField.key}
            // Dialog the user opened to type a value.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            type={selectedField.type}
            inputMode={selectedField.type === "number" ? "numeric" : "text"}
            min={selectedField.type === "number" ? 1 : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) handleApply();
            }}
            placeholder={selectedField.placeholder}
            // text-base on mobile suppresses iOS auto-zoom on focus.
            className="w-full bg-surface-container-low border-none rounded-xl px-4 py-3 text-base sm:text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"
          />
        </div>

        {/* Preview */}
        {value.trim() && (
          <div className="bg-primary/5 rounded-xl px-4 py-3 text-sm">
            <span className="text-on-surface-variant">Set </span>
            <span className="font-bold text-primary">
              {selectedField.label}
            </span>
            <span className="text-on-surface-variant"> → </span>
            <span className="font-bold text-on-surface">"{value.trim()}"</span>
            <span className="text-on-surface-variant">
              {" "}
              for {selectedCount} contact{selectedCount !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Actions — stack on mobile, side-by-side on tablet+. */}
        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
          <button onClick={handleClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!value.trim() || isPending}
            className="btn-primary flex-1"
          >
            <Pencil className="w-4 h-4" />
            {isPending ? "Applying…" : "Apply to All"}
          </button>
        </div>
      </div>
    </Modal>
  );
};
