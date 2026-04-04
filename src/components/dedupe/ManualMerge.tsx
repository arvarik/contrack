import React, { useCallback, useState } from 'react';
import {
  Users, ArrowRight, ChevronLeft, Shield, Loader2,
  CheckCircle2, Merge, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Contact } from '../../types';
import { useMergeContacts } from '../../api';
import { ContactCard } from './ContactCompare';
import { ContactPicker } from './ContactPicker';
import { MergePreview } from './MergePreview';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { EMPTY_HERO } from '../../lib/styles';

// =============================================================================
// ManualMerge — 3-stage manual merge workflow
// =============================================================================

type Stage = 'select' | 'compare' | 'preview';

export const ManualMerge = () => {
  const [stage, setStage] = useState<Stage>('select');
  const [selected, setSelected] = useState<Contact[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [mergeComplete, setMergeComplete] = useState(false);
  const mergeContacts = useMergeContacts();

  // Auto-set first selected as primary
  const handleSelectionChange = useCallback((contacts: Contact[]) => {
    setSelected(contacts);
    if (contacts.length > 0 && (!primaryId || !contacts.find(c => c.id === primaryId))) {
      setPrimaryId(contacts[0].id);
    }
    if (contacts.length === 0) {
      setPrimaryId(null);
    }
  }, [primaryId]);

  const primary = selected.find(c => c.id === primaryId) ?? null;
  const duplicates = selected.filter(c => c.id !== primaryId);

  const handleMerge = useCallback(async () => {
    if (!primary || duplicates.length === 0 || mergeContacts.isPending) return;

    try {
      // Sequential merge: each duplicate merges into the primary
      for (const dup of duplicates) {
        await mergeContacts.mutateAsync({
          primaryId: primary.id,
          duplicateId: dup.id,
        });
      }
      setMergeComplete(true);
      toast.success(
        `Merged ${duplicates.length} contact${duplicates.length > 1 ? 's' : ''} into "${primary.name}"`,
      );
    } catch (err: any) {
      toast.error(`Merge failed: ${err.message}`);
    }
  }, [primary, duplicates, mergeContacts]);

  const reset = () => {
    setSelected([]);
    setPrimaryId(null);
    setStage('select');
    setMergeComplete(false);
  };

  // Success state
  if (mergeComplete) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={cn(EMPTY_HERO, "py-16")}
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.1 }}
          className="p-6 bg-emerald-500/10 rounded-3xl mb-6"
        >
          <CheckCircle2 className="w-16 h-16 text-emerald-500" />
        </motion.div>
        <h2 className="text-xl font-headline font-bold mb-2">Merge Complete!</h2>
        <p className="text-on-surface-variant text-sm mb-6">
          {duplicates.length} contact{duplicates.length > 1 ? 's were' : ' was'} merged into "{primary?.name}".
          All timeline entries, emails, and data have been consolidated.
        </p>
        <button onClick={reset} className="btn-primary px-8 py-3">
          Merge More Contacts
        </button>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Stage indicator */}
      <div className="flex items-center gap-2 mb-6 px-1">
        {(['select', 'compare', 'preview'] as Stage[]).map((s, i) => (
          <React.Fragment key={s}>
            {i > 0 && <div className="h-px flex-1 bg-surface-container-high" />}
            <button
              onClick={() => {
                // Only allow going back, not jumping ahead
                if (s === 'select') { setStage(s); }
                else if (s === 'compare' && selected.length >= 2) { setStage(s); }
                else if (s === 'preview' && primary && duplicates.length > 0) { setStage(s); }
              }}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap",
                stage === s
                  ? "bg-primary/10 text-primary"
                  : "text-on-surface-variant hover:text-on-surface"
              )}
            >
              <span className={cn(
                "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                stage === s ? "bg-primary text-white" : "bg-surface-container-high text-on-surface-variant"
              )}>
                {i + 1}
              </span>
              {s === 'select' ? 'Select' : s === 'compare' ? 'Compare' : 'Confirm'}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* Stage content */}
      <AnimatePresence mode="wait">
        {stage === 'select' && (
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
                onSelectionChange={handleSelectionChange}
                maxSelection={3}
              />
            </div>

            <div className="pt-4 shrink-0">
              <button
                onClick={() => setStage('compare')}
                disabled={selected.length < 2}
                className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-40"
              >
                <Merge className="w-5 h-5" />
                Compare {selected.length > 0 ? `${selected.length} Contacts` : ''}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}

        {stage === 'compare' && (
          <motion.div
            key="compare"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex-1 overflow-y-auto min-h-0"
          >
            <div className="mb-4 flex items-center justify-between">
              <button
                onClick={() => setStage('select')}
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
              onClick={() => setStage('preview')}
              disabled={!primaryId}
              className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-40"
            >
              <Shield className="w-5 h-5" />
              Preview Merge Result
              <ArrowRight className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {stage === 'preview' && primary && (
          <motion.div
            key="preview"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex-1 overflow-y-auto min-h-0"
          >
            <div className="mb-4 flex items-center justify-between">
              <button
                onClick={() => setStage('compare')}
                className="flex items-center gap-1.5 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
            </div>

            <MergePreview primary={primary} duplicates={duplicates} />

            <div className="flex items-center gap-3 mt-8">
              <button
                onClick={() => setStage('compare')}
                className="btn-secondary flex-1 flex items-center justify-center gap-2 py-3"
              >
                <ChevronLeft className="w-4 h-4" />
                Back to Compare
              </button>
              <button
                onClick={handleMerge}
                disabled={mergeContacts.isPending}
                className="btn-primary flex-1 flex items-center justify-center gap-2 py-3 disabled:opacity-50"
              >
                {mergeContacts.isPending ? (
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
        )}
      </AnimatePresence>
    </div>
  );
};
