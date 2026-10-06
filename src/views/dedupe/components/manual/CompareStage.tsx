import { motion } from "motion/react";
import { useQueries } from "@tanstack/react-query";
import { ChevronLeft, GitMerge, Loader2 } from "lucide-react";
import { contactQuery } from "../../../../api/contactCache";
import type { Contact } from "../../../../types";
import { DuplicateComparison } from "../DuplicateComparison";
import { roomAtBottom } from "../../utils/stickyRoom";

interface CompareStageProps {
  selected: Contact[];
  primaryId: string | null;
  setPrimaryId: (id: string) => void;
  onBack: () => void;
  onMerge: () => Promise<void>;
  isMerging: boolean;
}

/**
 * The chosen contacts compared. The picker's slim contacts lack profile
 * links and sources, so each is fetched in full, and the slim one stands in
 * until it arrives.
 */
export const CompareStage = ({
  selected,
  primaryId,
  setPrimaryId,
  onBack,
  onMerge,
  isMerging,
}: CompareStageProps) => {
  const full = useQueries({
    queries: selected.map((c) => contactQuery(c.id)),
  });
  const contacts = selected.map((c, i) => full[i]?.data ?? c);
  const others = selected.length - 1;

  return (
    <motion.div
      key="compare"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col gap-4"
    >
      {primaryId && (
        <DuplicateComparison
          contacts={contacts}
          keeperId={primaryId}
          onKeeperChange={setPrimaryId}
        />
      )}

      {/* Sticks to the bottom of the screen, above the tab bar below md. */}
      <div
        ref={roomAtBottom}
        className="sticky bottom-[calc(3.375rem+max(0.75rem,env(safe-area-inset-bottom)))] md:bottom-0 z-10 py-4 bg-surface flex gap-3"
      >
        <button type="button" onClick={onBack} className="btn-secondary flex-1">
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          Back
        </button>
        <button
          type="button"
          onClick={() => void onMerge()}
          disabled={isMerging || !primaryId}
          className="btn-primary flex-1"
        >
          {isMerging ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <GitMerge className="w-4 h-4" aria-hidden="true" />
          )}
          {others === 1
            ? "Merge 2 contacts"
            : `Merge ${selected.length} contacts`}
        </button>
      </div>
    </motion.div>
  );
};
