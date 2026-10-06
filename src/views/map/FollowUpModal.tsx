/** One follow-up per selected contact, in one request: all saved or none. */
import React, { useState } from "react";
import { toast } from "sonner";
import { Loader2, Calendar } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { useBulkCreateActionItems } from "../../api/actionItems";
import { MAX_BULK_ACTION_ITEMS } from "../../../shared/contracts/actionItems";
import { FORM_INPUT, FORM_LABEL, SELECTED_TINT } from "../../lib/styles";
import { cn, errorText } from "../../lib/utils";
import { RadioDot } from "../../components/ui/RadioDot";

type DueDatePreset = "tomorrow" | "3days" | "nextweek" | "pick";

const PRESETS: { value: DueDatePreset; label: string }[] = [
  { value: "tomorrow", label: "Tomorrow" },
  { value: "3days", label: "3 days" },
  { value: "nextweek", label: "Next week" },
  { value: "pick", label: "Pick date" },
];

export function getPresetDate(
  preset: "tomorrow" | "3days" | "nextweek",
  now = new Date(),
): string {
  const d = new Date(now);
  if (preset === "tomorrow") {
    d.setDate(d.getDate() + 1);
  } else if (preset === "3days") {
    d.setDate(d.getDate() + 3);
  } else if (preset === "nextweek") {
    d.setDate(d.getDate() + 7);
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface FollowUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  contactIds: string[];
  onSuccess?: () => void;
}

export const FollowUpModal: React.FC<FollowUpModalProps> = ({
  isOpen,
  onClose,
  contactIds,
  onSuccess,
}) => {
  const [title, setTitle] = useState("");
  const [preset, setPreset] = useState<DueDatePreset>("tomorrow");
  const [customDate, setCustomDate] = useState(() => getPresetDate("tomorrow"));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const bulkCreate = useBulkCreateActionItems();
  const count = contactIds.length;
  const tooMany = count > MAX_BULK_ACTION_ITEMS;

  const handleClose = () => {
    if (isSubmitting) return;
    setTitle("");
    setPreset("tomorrow");
    setCustomDate(getPresetDate("tomorrow"));
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || tooMany || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const dueAt = preset === "pick" ? customDate : getPresetDate(preset);
      const { count: added } = await bulkCreate.mutateAsync({
        contactIds,
        title: title.trim(),
        dueAt,
      });
      toast.success(
        `Follow-up added for ${added} contact${added !== 1 ? "s" : ""}`,
      );
      handleClose();
      onSuccess?.();
    } catch (err: unknown) {
      toast.error(`Could not add the follow-up: ${errorText(err)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const modalTitle =
    count === 1 ? "Add follow-up" : `Add follow-up (${count} selected)`;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={modalTitle}>
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        <div>
          <label htmlFor="followup-title" className={FORM_LABEL}>
            Follow-up *
          </label>
          <input
            id="followup-title"
            required
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="For example, catch up over coffee"
            className={FORM_INPUT}
          />
        </div>

        <div>
          <span className={FORM_LABEL}>Due date</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1.5">
            {/* The `RadioDot` shows "chosen" as a shape, not only a hue. */}
            {PRESETS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={preset === value}
                onClick={() => setPreset(value)}
                className={cn(
                  "hit-area py-2 px-3 rounded-xl text-xs font-semibold transition-colors text-center cursor-pointer flex items-center justify-center gap-1.5",
                  preset === value
                    ? SELECTED_TINT
                    : "state-layer bg-surface-container-high/60 text-on-surface",
                )}
              >
                <RadioDot checked={preset === value} />
                {value === "pick" && <Calendar className="w-3.5 h-3.5" />}
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {preset === "pick" && (
          <div>
            <label htmlFor="followup-custom-date" className={FORM_LABEL}>
              Choose date
            </label>
            <input
              id="followup-custom-date"
              type="date"
              required
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className={FORM_INPUT}
            />
          </div>
        )}

        {tooMany && (
          <p className="text-xs text-error font-medium">
            A follow-up can go to {MAX_BULK_ACTION_ITEMS} people at a time.
            Select fewer people to add it
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-outline-variant/20">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !title.trim() || tooMany}
            className="btn-primary"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>
              {count === 1 ? "Add follow-up" : `Add to ${count} contacts`}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
