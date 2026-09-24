import React from "react";
import { motion } from "motion/react";
import { ArrowRight, ChevronLeft, Shield, AlertTriangle } from "lucide-react";
import { ContactCard } from "../shared/ContactCard";
import type { Contact } from "../../../../types";
import { cn } from "../../../../lib/utils";
import { TONE_WASH } from "../../../../lib/styles";

interface CompareStageProps {
  selected: Contact[];
  primaryId: string | null;
  setPrimaryId: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
}

export const CompareStage = ({
  selected,
  primaryId,
  setPrimaryId,
  onBack,
  onNext,
}: CompareStageProps) => {
  return (
    <motion.div
      key="compare"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <button
          onClick={onBack}
          className="hit-area flex items-center gap-1.5 text-sm text-on-surface-variant hover:text-on-surface transition-colors shrink-0"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <p className="text-xs text-on-surface-variant text-right">
          Choose which contact should be the primary (keeper)
        </p>
      </div>

      {/* Comparison cards */}
      <div
        className={cn(
          "grid gap-4 mb-6",
          selected.length === 2
            ? "grid-cols-1 lg:grid-cols-2"
            : "grid-cols-1 lg:grid-cols-3",
        )}
      >
        {selected.map((contact) => (
          <ContactCard
            key={contact.id}
            contact={contact}
            label={
              contact.id === primaryId ? "Primary (keeper)" : "Will merge in"
            }
            labelColor={
              contact.id === primaryId ? TONE_WASH.success : TONE_WASH.warning
            }
            other={selected.find((c) => c.id !== contact.id)}
            isPrimary={contact.id === primaryId}
            onSetPrimary={() => setPrimaryId(contact.id)}
          />
        ))}
      </div>

      {/* Warning for 3-way merge */}
      {selected.length === 3 && (
        <div className="flex items-start gap-3 p-4 bg-warning/8 rounded-xl mb-6">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-warning mb-1">
              3-way merge
            </div>
            <p className="text-xs text-on-surface-variant">
              Two contacts will be merged sequentially into the primary. All
              data from both duplicates will be preserved and combined
            </p>
          </div>
        </div>
      )}

      <button
        onClick={onNext}
        disabled={!primaryId}
        className="btn-primary w-full"
      >
        <Shield className="w-5 h-5" />
        Preview merge result
        <ArrowRight className="w-4 h-4" />
      </button>
    </motion.div>
  );
};
