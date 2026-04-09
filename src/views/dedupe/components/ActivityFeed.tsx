import React, { useMemo } from 'react';
import { Undo2, Sparkles, User, Loader2, Clock, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { useMergeLog, useUndoMerge } from '../../../api';
import { cn } from '../../../lib/utils';

// =============================================================================
// ActivityFeed — Merge audit log with undo capability
// =============================================================================

/** Group entries by relative date. */
function groupByDate(entries: any[]): { label: string; items: any[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const thisWeek = new Date(today.getTime() - 7 * 86400000);

  const groups: Map<string, any[]> = new Map();

  for (const entry of entries) {
    const date = new Date(entry.mergedAt);
    let label: string;
    if (date >= today) label = 'Today';
    else if (date >= yesterday) label = 'Yesterday';
    else if (date >= thisWeek) label = 'This Week';
    else label = 'Older';

    const existing = groups.get(label) ?? [];
    existing.push(entry);
    groups.set(label, existing);
  }

  // Preserve chronological group ordering
  const order = ['Today', 'Yesterday', 'This Week', 'Older'];
  return order
    .filter(label => groups.has(label))
    .map(label => ({ label, items: groups.get(label)! }));
}

export const ActivityFeed = () => {
  const { data: entries = [], isLoading } = useMergeLog();
  const undoMerge = useUndoMerge();

  const groups = useMemo(() => groupByDate(entries), [entries]);

  const handleUndo = async (id: string, name: string) => {
    try {
      await undoMerge.mutateAsync(id);
      toast.success(`Restored "${name}"`);
    } catch (err: any) {
      toast.error(`Undo failed: ${err.message}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-on-surface-variant" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Clock className="w-10 h-10 text-on-surface-variant/30 mb-3" />
        <p className="text-sm text-on-surface-variant">No merge activity yet.</p>
        <p className="text-xs text-on-surface-variant/60 mt-1">Merged contacts will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map(group => (
        <div key={group.label}>
          <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant px-1 mb-2">
            {group.label}
          </div>
          <div className="space-y-1.5">
            {group.items.map((entry, i) => {
              const isAuto = entry.mergedBy === 'auto';
              const isUndone = !!entry.undoneAt;
              const canUndo = entry.mergeType === 'soft' && !isUndone;

              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.02, 0.2) }}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl transition-colors",
                    isUndone
                      ? "bg-surface-container-low/50 opacity-60"
                      : "bg-surface-container-lowest"
                  )}
                >
                  {/* Icon */}
                  <div className={cn(
                    "p-1.5 rounded-lg shrink-0",
                    isUndone ? "bg-surface-container-high" :
                    isAuto ? "bg-primary/10" : "bg-emerald-500/10"
                  )}>
                    {isUndone ? (
                      <Undo2 className="w-3.5 h-3.5 text-on-surface-variant" />
                    ) : isAuto ? (
                      <Sparkles className="w-3.5 h-3.5 text-primary" />
                    ) : (
                      <User className="w-3.5 h-3.5 text-emerald-600" />
                    )}
                  </div>

                  {/* Description */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-on-surface leading-snug">
                      {isUndone ? (
                        <span className="text-on-surface-variant line-through">
                          Merged "{entry.duplicateName}" → "{entry.primaryName}"
                        </span>
                      ) : (
                        <>
                          {isAuto ? (
                            <span className="text-primary font-bold">Auto-merged </span>
                          ) : (
                            <span className="text-emerald-600 font-bold">Merged </span>
                          )}
                          <span className="font-bold">"{entry.duplicateName}"</span>
                          <span className="text-on-surface-variant"> → </span>
                          <span className="font-bold">"{entry.primaryName}"</span>
                        </>
                      )}
                    </p>
                    <p className="text-[11px] text-on-surface-variant mt-0.5">
                      {isUndone ? 'Undone' : `${(entry.confidence * 100).toFixed(0)}% confidence`}
                      {entry.reasoning && !isUndone && ` · ${entry.reasoning.slice(0, 60)}${entry.reasoning.length > 60 ? '…' : ''}`}
                    </p>
                  </div>

                  {/* Undo button */}
                  {canUndo && (
                    <button
                      onClick={() => handleUndo(entry.id, entry.duplicateName)}
                      disabled={undoMerge.isPending}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-on-surface-variant bg-surface-container-low hover:bg-surface-container-high rounded-full transition-colors disabled:opacity-50"
                    >
                      <Undo2 className="w-3 h-3" />
                      Undo
                    </button>
                  )}

                  {isUndone && (
                    <span className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-on-surface-variant/50">
                      <CheckCircle2 className="w-3 h-3" />
                      Restored
                    </span>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
