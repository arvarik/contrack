import React from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, Merge, Loader2 } from 'lucide-react';
import { MergePreview } from '../MergePreview';
import type { Contact } from '../../../types';

interface PreviewStageProps {
  primary: Contact | null;
  duplicates: Contact[];
  onBack: () => void;
  onMerge: () => Promise<void>;
  isMerging: boolean;
}

export const PreviewStage = ({ primary, duplicates, onBack, onMerge, isMerging }: PreviewStageProps) => {
  if (!primary) return null;

  return (
    <motion.div
      key="preview"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex-1 overflow-y-auto min-h-0 nice-scrollbar"
    >
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
      </div>

      <MergePreview primary={primary} duplicates={duplicates} />

      <div className="flex items-center gap-3 mt-8">
        <button
          onClick={onBack}
          className="btn-secondary flex-1 flex items-center justify-center gap-2 py-3"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Compare
        </button>
        <button
          onClick={onMerge}
          disabled={isMerging}
          className="btn-primary flex-1 flex items-center justify-center gap-2 py-3 disabled:opacity-50"
        >
          {isMerging ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Merging...
            </>
          ) : (
            <>
              <Merge className="w-5 h-5" />
              Confirm Merge
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
};
