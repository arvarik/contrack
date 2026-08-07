import React from "react";
import { motion } from "motion/react";
import { CheckCircle2 } from "lucide-react";
import type { Contact } from "../../../../types";
import { cn } from "../../../../lib/utils";
import { EMPTY_HERO } from "../../../../lib/styles";

interface SuccessStageProps {
  primary: Contact | null;
  duplicates: Contact[];
  onReset: () => void;
}

export const SuccessStage = ({
  primary,
  duplicates,
  onReset,
}: SuccessStageProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(EMPTY_HERO, "py-16")}
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 15, delay: 0.1 }}
        className="p-6 bg-emerald-500/10 rounded-3xl mb-6"
      >
        <CheckCircle2 className="w-16 h-16 text-success" />
      </motion.div>
      <h2 className="text-xl font-headline font-bold mb-2">Merge Complete!</h2>
      <p className="text-on-surface-variant text-sm mb-6">
        {duplicates.length} contact{duplicates.length > 1 ? "s were" : " was"}{" "}
        merged into "{primary?.name}". All timeline entries, emails, and data
        have been consolidated.
      </p>
      <button onClick={onReset} className="btn-primary px-8 py-3">
        Merge More Contacts
      </button>
    </motion.div>
  );
};
