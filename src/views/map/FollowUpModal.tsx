/**
 * FollowUpModal — Creates follow-up action items in bulk or for an individual contact.
 *
 * Provides:
 * - Title input for the action item
 * - Due date presets: Tomorrow, 3 days, Next week, or a custom date picker
 * - Cap at 100 contacts with an informative toast
 * - Invalidation of actionItems, dashboard, and contacts queries
 *
 * @module views/map/FollowUpModal
 */
import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Calendar } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { apiFetch } from "../../api/client";
import { FORM_INPUT, FORM_LABEL, SELECTED_TINT } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { RadioDot } from "../../components/ui/RadioDot";

export type DueDatePreset = "tomorrow" | "3days" | "nextweek" | "pick";

/** The due date choices, in the order the toggles show them. */
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

export interface FollowUpModalProps {
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

  const queryClient = useQueryClient();

  const handleClose = () => {
    if (isSubmitting) return;
    setTitle("");
    setPreset("tomorrow");
    setCustomDate(getPresetDate("tomorrow"));
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const dueAt = preset === "pick" ? customDate : getPresetDate(preset);
      const targetIds = contactIds.slice(0, 100);

      if (contactIds.length > 100) {
        toast.info("Follow-ups capped at 100 contacts");
      }

      await Promise.all(
        targetIds.map(async (id) => {
          const res = await apiFetch(`/contacts/${id}/action-items`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: title.trim(),
              dueAt,
            }),
          });
          if (!res.ok) {
            throw new Error(`Failed to create follow-up for contact ${id}`);
          }
        }),
      );

      toast.success(
        `Added follow-up for ${targetIds.length} contact${targetIds.length !== 1 ? "s" : ""}`,
      );
      handleClose();
      onSuccess?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to add follow-up: ${message}`);
    } finally {
      queryClient.invalidateQueries({ queryKey: ["actionItems"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      setIsSubmitting(false);
    }
  };

  const count = contactIds.length;
  const modalTitle =
    count === 1 ? "Add follow-up" : `Add follow-up (${count} selected)`;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={modalTitle}>
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        <div>
          <label htmlFor="followup-title" className={FORM_LABEL}>
            Task title *
          </label>
          <input
            id="followup-title"
            required
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Catch up over coffee"
            className={FORM_INPUT}
          />
        </div>

        <div>
          <span className={FORM_LABEL}>Due date</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1.5">
            {/*
              A selected preset is the tint and its ink, with a filled
              `RadioDot`, so "chosen" is a shape as well as a hue, and
              `aria-pressed` says it to a screen reader.
            */}
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
            disabled={isSubmitting || !title.trim()}
            className="btn-primary"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>
              {count === 1
                ? "Add follow-up"
                : `Add to ${Math.min(count, 100)} contacts`}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
