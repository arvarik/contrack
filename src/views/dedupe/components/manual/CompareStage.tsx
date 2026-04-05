import React from 'react';
import { motion } from 'motion/react';
import { ArrowRight, ChevronLeft, Shield, AlertTriangle } from 'lucide-react';
import { ContactCard } from '../shared/ContactCard';
import type { Contact } from '../../../../types';
import { cn } from '../../../../lib/utils';

interface CompareStageProps {
  selected: Contact[];
  primaryId: string | null;
  setPrimaryId: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
}

export const CompareStage = ({ selected, primaryId, setPrimaryId, onBack, onNext }: CompareStageProps) => {
  return (
    <motion.div
      key="compare"
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
        <p className="text-xs text-on-surface-variant">
          Choose which contact should be the primary (keeper)
        </p>
      </div>

      {/* Comparison cards */}
      <div className={cn(
        "grid gap-4 mb-6",
        selected.length === 2 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1 lg:grid-cols-3"
      )}>
        {selected.map((contact) => (
          <ContactCard
            key={contact.id}
            contact={contact}
            label={contact.id === primaryId ? 'Primary (Keeper)' : 'Will Merge In'}
            labelColor={contact.id === primaryId
              ? 'text-emerald-600 bg-emerald-500/10'
              : 'text-amber-600 bg-amber-500/10'
            }
            other={selected.find(c => c.id !== contact.id)}
            isPrimary={contact.id === primaryId}
            onSetPrimary={() => setPrimaryId(contact.id)}
          />
        ))}
      </div>

      {/* Warning for 3-way merge */}
      {selected.length === 3 && (
        <div className="flex items-start gap-3 p-4 bg-amber-500/8 rounded-xl mb-6">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-amber-600 mb-1">3-Way Merge</div>
            <p className="text-xs text-on-surface-variant">
              Two contacts will be merged sequentially into the primary. All data from both
              duplicates will be preserved and combined.
            </p>
          </div>
        </div>
      )}

      <button
        onClick={onNext}
        disabled={!primaryId}
        className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-40"
      >
        <Shield className="w-5 h-5" />
        Preview Merge Result
        <ArrowRight className="w-4 h-4" />
      </button>
    </motion.div>
  );
};
