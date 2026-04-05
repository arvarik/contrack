import React from 'react';
import { motion } from 'motion/react';
import { Merge, ArrowRight } from 'lucide-react';
import { ContactPicker } from '../ContactPicker';
import type { Contact } from '../../../types';

interface SelectStageProps {
  selected: Contact[];
  onSelectionChange: (contacts: Contact[]) => void;
  onNext: () => void;
}

export const SelectStage = ({ selected, onSelectionChange, onNext }: SelectStageProps) => {
  return (
    <motion.div
      key="select"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex-1 flex flex-col min-h-0"
    >
      <div className="mb-4">
        <h3 className="text-sm font-bold text-on-surface mb-1">Select contacts to merge</h3>
        <p className="text-xs text-on-surface-variant">
          Choose 2-3 contacts you want to merge. All their data will be combined.
        </p>
      </div>

      <div className="flex-1 min-h-0">
        <ContactPicker
          selected={selected}
          onSelectionChange={onSelectionChange}
          maxSelection={3}
        />
      </div>

      <div className="pt-4 shrink-0">
        <button
          onClick={onNext}
          disabled={selected.length < 2}
          className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-40"
        >
          <Merge className="w-5 h-5" />
          Compare {selected.length > 0 ? `${selected.length} Contacts` : ''}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
};
