/** Confirms a batch before it starts: its size, depth, engine, time and cost. */
import { Sparkles } from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import type { Contact } from "../../../types";
import type { ResearchDepth } from "../../../../shared/researchDepth";
import { batchEstimate, DEPTH_WORDS } from "../../../lib/researchDepth";
import { DIALOG_ACTIONS } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  selectedContacts: Contact[];
  isStarting: boolean;
  depth: ResearchDepth;
  /** Whether the measured figures describe this research (Gemini only). */
  showEstimate: boolean;
  /** The engine a batch runs, when it is SearXNG or both. */
  searchWith?: { name: string; does: string };
}

export function AISearchConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  selectedContacts,
  isStarting,
  depth,
  showEstimate,
  searchWith,
}: Props) {
  const total = selectedContacts.length;
  const previouslySearched = selectedContacts.filter(
    (c) => c.aiHydratedAt,
  ).length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Start enrichment">
      <div className="space-y-5 pt-2">
        <p className="text-sm text-on-surface-variant leading-relaxed">
          You're about to research{" "}
          <span className="font-bold text-on-surface">{total}</span> contact
          {total !== 1 ? "s" : ""} on the web, at{" "}
          <span className="font-bold text-on-surface">
            {DEPTH_WORDS[depth].name}
          </span>{" "}
          depth
        </p>

        <div className="space-y-2.5">
          <InfoRow text={DEPTH_WORDS[depth].does} />
          {searchWith && (
            <InfoRow
              text={`Searches with ${searchWith.name}. ${searchWith.does}`}
            />
          )}
          {showEstimate && <InfoRow text={batchEstimate(depth, total)} />}
          <InfoRow text="Runs in the background, so you can keep working" />
        </div>

        {previouslySearched > 0 && (
          <p className="text-xs text-on-surface-variant bg-surface-container-low rounded-xl p-3 leading-relaxed">
            <span className="font-bold">{previouslySearched}</span> already
            researched. Only new details will be added
          </p>
        )}

        <div className={cn(DIALOG_ACTIONS, "pt-1")}>
          <button
            type="button"
            onClick={onClose}
            disabled={isStarting}
            className="btn-secondary flex-1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isStarting || total === 0}
            className="btn-primary flex-1"
          >
            <Sparkles className="w-4 h-4" />
            {isStarting
              ? "Starting…"
              : `Search ${total} contact${total !== 1 ? "s" : ""}`}
          </button>
        </div>

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
