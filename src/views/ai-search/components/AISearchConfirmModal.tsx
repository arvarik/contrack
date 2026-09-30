/**
 * AISearchConfirmModal — the cost and time of a batch, confirmed before it
 * starts.
 *
 * Shows:
 * - How many contacts will be searched, and at which depth
 * - The batch's time and cost at that depth, from the measured figures,
 *   when research runs on Gemini, where they were measured
 * - How many have been previously searched (re-search info)
 * - Additive-only data safety guarantee
 */
import { Sparkles } from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import type { Contact } from "../../../types";
import type { ResearchDepth } from "../../../../shared/researchDepth";
import { batchEstimate, DEPTH_WORDS } from "../../../lib/researchDepth";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  selectedContacts: Contact[];
  isStarting: boolean;
  depth: ResearchDepth;
  /** Whether the measured figures describe this research (Gemini only). */
  showEstimate: boolean;
}

export function AISearchConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  selectedContacts,
  isStarting,
  depth,
  showEstimate,
}: Props) {
  const total = selectedContacts.length;
  const previouslySearched = selectedContacts.filter(
    (c) => c.aiHydratedAt,
  ).length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Start enrichment">
      <div className="space-y-5 pt-2">
        {/* Description */}
        <p className="text-sm text-on-surface-variant leading-relaxed">
          You're about to research{" "}
          <span className="font-bold text-on-surface">{total}</span> contact
          {total !== 1 ? "s" : ""} on the web, at{" "}
          <span className="font-bold text-on-surface">
            {DEPTH_WORDS[depth].name}
          </span>{" "}
          depth
        </p>

        {/* Info bullets */}
        <div className="space-y-2.5">
          <InfoRow text={DEPTH_WORDS[depth].does} />
          {showEstimate && <InfoRow text={batchEstimate(depth, total)} />}
          <InfoRow text="Runs in the background, so you can keep working" />
        </div>

        {/* Re-search info */}
        {previouslySearched > 0 && (
          <p className="text-xs text-on-surface-variant bg-surface-container-low rounded-xl p-3 leading-relaxed">
            <span className="font-bold">{previouslySearched}</span> of these
            contact{previouslySearched !== 1 ? "s have" : " has"} been
            previously searched. New information will be added to their profiles
          </p>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            disabled={isStarting}
            className="btn-secondary flex-1"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isStarting}
            className="btn-primary flex-1"
          >
            <Sparkles className="w-4 h-4" />
            {isStarting
              ? "Starting…"
              : `Search ${total} contact${total !== 1 ? "s" : ""}`}
          </button>
        </div>

        {/* Safety note */}
        <p className="text-[11px] text-on-surface-variant text-center leading-relaxed">
          New data fills empty fields. Your existing data is never overwritten
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
