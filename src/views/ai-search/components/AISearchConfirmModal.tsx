/**
 * AISearchConfirmModal — Credit warning + confirmation before starting.
 *
 * Shows:
 * - How many contacts will be searched
 * - How many have been previously searched (re-search info)
 * - Estimated time
 * - Additive-only data safety guarantee
 */
import React from "react";
import { Sparkles } from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import type { Contact } from "../../../types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  selectedContacts: Contact[];
  isStarting: boolean;
}

export function AISearchConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  selectedContacts,
  isStarting,
}: Props) {
  const total = selectedContacts.length;
  const previouslySearched = selectedContacts.filter(
    (c) => c.aiHydratedAt,
  ).length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Start AI Search">
      <div className="space-y-5 pt-2">
        {/* Description */}
        <p className="text-sm text-on-surface-variant leading-relaxed">
          You're about to research{" "}
          <span className="font-bold text-on-surface">{total}</span> contact
          {total !== 1 ? "s" : ""} using AI-powered internet search.
        </p>

        {/* Info bullets */}
        <div className="space-y-2.5">
          <InfoRow
            text={`Uses approximately ${total} AI search credit${total !== 1 ? "s" : ""}`}
          />
          <InfoRow
            text={
              total === 1
                ? "Takes about 1 minute to complete"
                : `Takes about ${Math.ceil(total * 0.4)}–${Math.ceil(total * 0.6)} minutes to complete`
            }
          />
          <InfoRow text="Runs in the background — you can keep working" />
        </div>

        {/* Re-search info */}
        {previouslySearched > 0 && (
          <p className="text-xs text-on-surface-variant bg-surface-container-low rounded-xl p-3 leading-relaxed">
            <span className="font-bold">{previouslySearched}</span> of these
            contact{previouslySearched !== 1 ? "s have" : " has"} been
            previously searched. New information will be added to their
            profiles.
          </p>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            disabled={isStarting}
            className="flex-1 py-2.5 rounded-xl bg-surface-container font-bold text-sm text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isStarting}
            className="flex-1 py-2.5 rounded-xl btn-primary font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            {isStarting
              ? "Starting…"
              : `Search ${total} Contact${total !== 1 ? "s" : ""}`}
          </button>
        </div>

        {/* Safety note */}
        <p className="text-[10px] text-on-surface-variant/60 text-center leading-relaxed">
          New data fills empty fields. Your existing data is never overwritten.
        </p>
      </div>
    </Modal>
  );
}

function InfoRow({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 text-sm text-on-surface-variant">
      <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}
