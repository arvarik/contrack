import React from "react";
import { motion } from "motion/react";
import { Merge, ArrowRight } from "lucide-react";
import { ContactPicker } from "../ContactPicker";
import type { Contact } from "../../../../types";
import { roomAtBottom } from "../../utils/stickyRoom";

interface SelectStageProps {
  selected: Contact[];
  onSelectionChange: (contacts: Contact[]) => void;
  onNext: () => void;
}

export const SelectStage = ({
  selected,
  onSelectionChange,
  onNext,
}: SelectStageProps) => {
  return (
    <motion.div
      key="select"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col"
    >
      <div>
        <h3 className="text-sm font-bold text-on-surface mb-1">
          Select contacts to merge
        </h3>
        <p className="text-xs text-on-surface-variant">
          Choose 2 to 5 contacts to merge. All their data is combined
        </p>
      </div>

      <ContactPicker
        selected={selected}
        onSelectionChange={onSelectionChange}
        maxSelection={5}
      />

      {/* The page is the one scroller and the picker takes its full height,
          so the button sticks to the bottom of the screen and stays in
          reach while a person picks. Below md it sits on top of the tab
          bar, and the offset is the bar's height, as in
          InteractionComposer. */}
      <div
        ref={roomAtBottom}
        className="sticky bottom-[calc(3.375rem+max(0.75rem,env(safe-area-inset-bottom)))] md:bottom-0 z-10 pt-4 pb-4 bg-surface"
      >
        <button
          onClick={onNext}
          disabled={selected.length < 2}
          className="btn-primary w-full"
        >
          <Merge className="w-5 h-5" />
          Compare {selected.length > 0 ? `${selected.length} contacts` : ""}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
};
