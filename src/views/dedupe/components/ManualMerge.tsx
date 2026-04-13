import React, { useCallback, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import type { Contact } from '../../../types';
import { useMergeContacts } from '../../../api';
import { toast } from 'sonner';
import { cn } from '../../../lib/utils';
import { SelectStage } from './manual/SelectStage';
import { CompareStage } from './manual/CompareStage';
import { PreviewStage } from './manual/PreviewStage';
import { SuccessStage } from './manual/SuccessStage';

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
    } catch (err: unknown) {
      toast.error(`Merge failed: ${(err instanceof Error ? err.message : String(err))}`);
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
    return <SuccessStage primary={primary} duplicates={duplicates} onReset={reset} />;
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
          <SelectStage 
            selected={selected} 
            onSelectionChange={handleSelectionChange} 
            onNext={() => setStage('compare')} 
          />
        )}
        {stage === 'compare' && (
          <CompareStage 
            selected={selected} 
            primaryId={primaryId} 
            setPrimaryId={setPrimaryId} 
            onBack={() => setStage('select')} 
            onNext={() => setStage('preview')} 
          />
        )}
        {stage === 'preview' && (
          <PreviewStage 
            primary={primary} 
            duplicates={duplicates} 
            onBack={() => setStage('compare')} 
            onMerge={handleMerge} 
            isMerging={mergeContacts.isPending} 
          />
        )}
      </AnimatePresence>
    </div>
  );
};
