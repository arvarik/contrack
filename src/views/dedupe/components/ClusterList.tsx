import React, { useState, useCallback, useMemo } from 'react';
import {
  CheckCircle2, Loader2, ChevronDown, ChevronUp,
  Merge as MergeIcon, Crown, Link2, Users, AlertTriangle, Shield,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { DedupeCluster } from '../../../types';
import { ContactCard } from './shared/ContactCard';
import { MatchBadge } from './shared/MatchBadge';
import { cn } from '../../../lib/utils';
import { toast } from 'sonner';
import { useMergeCluster, useMergeClusters } from '../../../api';
import { fallbackAvatarUrl } from '../../../lib/avatar';

// =============================================================================
// ClusterList — Expandable list of duplicate clusters with bulk merge
// =============================================================================

interface ClusterListProps {
  clusters: DedupeCluster[];
  onRemoveCluster: (id: string) => void;
}

export const ClusterList = ({ clusters, onRemoveCluster }: ClusterListProps) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [primaryOverrides, setPrimaryOverrides] = useState<Map<string, string>>(new Map());
  const mergeCluster = useMergeCluster();
  const mergeClusters = useMergeClusters();

  const allSelected = clusters.length > 0 && selected.size === clusters.length;

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(clusters.map(c => c.id)));
  }, [allSelected, clusters]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => prev === id ? null : id);
  }, []);

  const getPrimaryId = useCallback((cluster: DedupeCluster) => {
    return primaryOverrides.get(cluster.id) ?? cluster.suggestedPrimaryId;
  }, [primaryOverrides]);

  const handleSetPrimary = useCallback((clusterId: string, contactId: string) => {
    setPrimaryOverrides(prev => new Map(prev).set(clusterId, contactId));
  }, []);

  // Merge a single cluster
  const handleSingleMerge = useCallback(async (cluster: DedupeCluster) => {
    const primaryId = getPrimaryId(cluster);
    const duplicateIds = cluster.contacts.filter(c => c.id !== primaryId).map(c => c.id);
    try {
      await mergeCluster.mutateAsync({ primaryId, duplicateIds });
      onRemoveCluster(cluster.id);
      toast.success(`Merged ${cluster.size} contacts into one`);
    } catch (err: any) {
      toast.error(`Merge failed: ${err.message}`);
    }
  }, [mergeCluster, getPrimaryId, onRemoveCluster]);

  // Bulk merge all selected clusters
  const handleBulkMerge = useCallback(async () => {
    const clusterPayloads = clusters
      .filter(c => selected.has(c.id))
      .map(cluster => {
        const primaryId = getPrimaryId(cluster);
        return {
          primaryId,
          duplicateIds: cluster.contacts.filter(c => c.id !== primaryId).map(c => c.id),
        };
      });

    if (clusterPayloads.length === 0) return;

    try {
      const result = await mergeClusters.mutateAsync(clusterPayloads);
      // Remove successfully merged clusters
      for (const r of result.results) {
        if (r.merged > 0) {
          const cluster = clusters.find(c => getPrimaryId(c) === r.primaryId);
          if (cluster) onRemoveCluster(cluster.id);
        }
      }
      setSelected(new Set());
      toast.success(`Merged ${result.totalMerged} contacts across ${result.results.length} clusters`);
      if (result.totalFailed > 0) {
        toast.error(`${result.totalFailed} merge(s) failed`);
      }
    } catch (err: any) {
      toast.error(`Batch merge failed: ${err.message}`);
    }
  }, [clusters, selected, getPrimaryId, mergeClusters, onRemoveCluster]);

  if (clusters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-16">
        <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-4" />
        <h3 className="text-lg font-headline font-bold mb-2">All clean!</h3>
        <p className="text-sm text-on-surface-variant">No duplicate clusters remaining.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="shrink-0 flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleSelectAll}
            aria-label={allSelected ? 'Deselect all clusters' : 'Select all clusters'}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all",
              allSelected
                ? "bg-primary/15 text-primary"
                : "bg-surface-container-low text-on-surface-variant hover:text-on-surface"
            )}
          >
            <div className={cn(
              "w-4 h-4 rounded flex items-center justify-center transition-all",
              allSelected ? "bg-primary text-white" : "bg-surface-container-high"
            )}>
              {allSelected && <CheckCircle2 className="w-3 h-3" />}
            </div>
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
          <span className="text-xs text-on-surface-variant">
            {clusters.length} cluster{clusters.length !== 1 ? 's' : ''}
            {' · '}
            {clusters.reduce((sum, c) => sum + c.size, 0)} contacts
            {selected.size > 0 && (
              <span className="ml-1 text-primary font-bold">· {selected.size} selected</span>
            )}
          </span>
        </div>

        {selected.size > 0 && (
          <button
            onClick={handleBulkMerge}
            disabled={mergeClusters.isPending}
            className="flex items-center gap-2 px-5 py-2 signature-gradient text-white rounded-full text-sm font-bold hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-50"
          >
            {mergeClusters.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <MergeIcon className="w-4 h-4" />
            )}
            Merge {selected.size} Cluster{selected.size !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Cluster rows */}
      <div className="flex-1 overflow-y-auto space-y-2 nice-scrollbar pr-1">
        {clusters.map((cluster, i) => {
          const isSelected = selected.has(cluster.id);
          const isExpanded = expanded === cluster.id;
          const primaryId = getPrimaryId(cluster);
          const primary = cluster.contacts.find(c => c.id === primaryId) ?? cluster.contacts[0];
          const duplicates = cluster.contacts.filter(c => c.id !== primaryId);

          return (
            <motion.div
              key={cluster.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3) }}
            >
              <div className={cn(
                "bg-surface-container-lowest rounded-2xl shadow-sm transition-all",
                isSelected && "ring-2 ring-primary/40"
              )}>
                {/* Summary row */}
                <div
                  className="flex items-center gap-3 px-5 py-4 cursor-pointer group"
                  onClick={() => toggleExpand(cluster.id)}
                >
                  {/* Checkbox */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleSelect(cluster.id); }}
                    aria-label={isSelected ? `Deselect cluster ${primary.name}` : `Select cluster ${primary.name}`}
                    aria-pressed={isSelected}
                    className={cn(
                      "w-5 h-5 rounded flex items-center justify-center shrink-0 transition-all",
                      isSelected ? "bg-primary text-white" : "bg-surface-container-high group-hover:bg-surface-container-highest"
                    )}
                  >
                    {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                  </button>

                  {/* Stacked avatars */}
                  <div className="flex items-center -space-x-2 shrink-0">
                    {cluster.contacts.slice(0, 4).map((contact, idx) => (
                      <img
                        key={contact.id}
                        src={contact.avatarUrl || fallbackAvatarUrl(contact.name)}
                        alt={contact.name}
                        className="w-8 h-8 rounded-full object-cover bg-surface-container-high ring-2 ring-surface-container-lowest"
                        style={{ zIndex: 4 - idx }}
                      />
                    ))}
                    {cluster.size > 4 && (
                      <div className="w-8 h-8 rounded-full bg-surface-container-high ring-2 ring-surface-container-lowest flex items-center justify-center text-[10px] font-bold text-on-surface-variant">
                        +{cluster.size - 4}
                      </div>
                    )}
                  </div>

                  {/* Cluster info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate">{primary.name}</div>
                    <div className="text-[11px] text-on-surface-variant truncate">
                      {cluster.summary}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold text-on-surface-variant bg-surface-container-low px-2.5 py-1 rounded-full flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {cluster.size}
                    </span>
                    {cluster.hasWeakLink && (
                      <span className="text-xs font-bold text-amber-600 bg-amber-500/10 px-2.5 py-1 rounded-full">
                        Weak
                      </span>
                    )}
                    <span className={cn(
                      "text-xs font-bold px-2.5 py-1 rounded-full tabular-nums",
                      cluster.aggregateConfidence >= 0.9
                        ? "text-emerald-600 bg-emerald-500/10"
                        : cluster.aggregateConfidence >= 0.7
                        ? "text-primary bg-primary/10"
                        : "text-amber-600 bg-amber-500/10"
                    )}>
                      {Math.round(cluster.aggregateConfidence * 100)}%
                    </span>
                  </div>

                  {/* Skip button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemoveCluster(cluster.id); toast('Kept separate', { icon: <Shield className="w-4 h-4 text-on-surface-variant" /> }); }}
                    aria-label={`Skip cluster ${primary.name}`}
                    className="shrink-0 px-3 py-1.5 text-xs font-bold text-on-surface-variant bg-surface-container-low hover:bg-rose-500/8 hover:text-rose-600 rounded-full transition-colors"
                  >
                    Skip
                  </button>

                  {/* Merge button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSingleMerge(cluster); }}
                    disabled={mergeCluster.isPending}
                    aria-label={`Merge ${cluster.size} contacts in this cluster`}
                    className="shrink-0 px-3 py-1.5 text-xs font-bold text-primary bg-primary/10 hover:bg-primary/15 rounded-full transition-colors disabled:opacity-50"
                  >
                    Merge
                  </button>

                  {/* Expand chevron */}
                  <div className="shrink-0 text-on-surface-variant/40">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </div>

                {/* Expanded detail */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-5 space-y-4">
                        {/* Large cluster warning */}
                        {cluster.size > 5 && (
                          <div className="flex items-start gap-3 bg-amber-500/8 rounded-xl p-3" role="alert">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-700 leading-relaxed">
                              <span className="font-bold">Large cluster ({cluster.size} contacts).</span>{' '}
                              Review carefully — merging is irreversible.
                            </p>
                          </div>
                        )}

                        {/* Weak link warning */}
                        {cluster.hasWeakLink && (
                          <div className="flex items-start gap-3 bg-surface-container-low rounded-xl p-3" role="note">
                            <Shield className="w-4 h-4 text-on-surface-variant shrink-0 mt-0.5" />
                            <p className="text-xs text-on-surface-variant leading-relaxed">
                              <span className="font-bold">Weak link.</span>{' '}
                              At least one connection has {'<'}60% confidence. Check evidence below.
                            </p>
                          </div>
                        )}

                        {/* Primary selector strip */}
                        <div className="space-y-2" role="radiogroup" aria-label="Select primary contact">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                            Select Primary
                          </div>
                          <div className="flex gap-2 overflow-x-auto pb-1 nice-scrollbar">
                            {cluster.contacts.map(contact => (
                              <button
                                key={contact.id}
                                onClick={() => handleSetPrimary(cluster.id, contact.id)}
                                role="radio"
                                aria-checked={contact.id === primaryId}
                                aria-label={`Set ${contact.name} as primary`}
                                className={cn(
                                  "shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-xs",
                                  contact.id === primaryId
                                    ? "bg-emerald-500/10 ring-2 ring-emerald-500/50 font-bold"
                                    : "bg-surface-container-low hover:bg-surface-container-high"
                                )}
                              >
                                <img
                                  src={contact.avatarUrl || fallbackAvatarUrl(contact.name)}
                                  alt={contact.name}
                                  className="w-6 h-6 rounded-full object-cover bg-surface-container-high"
                                />
                                <span className="truncate max-w-[120px]">{contact.name}</span>
                                {contact.id === primaryId && <Crown className="w-3.5 h-3.5 text-emerald-600" />}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Contact comparison cards */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                          <ContactCard
                            contact={primary}
                            label="Primary (Keeper)"
                            labelColor="text-emerald-600 bg-emerald-500/10"
                            isPrimary
                          />
                          <div className="space-y-3">
                            {duplicates.map(dup => (
                              <ContactCard
                                key={dup.id}
                                contact={dup}
                                label="Merges In"
                                labelColor="text-amber-600 bg-amber-500/10"
                                other={primary}
                                onSetPrimary={() => handleSetPrimary(cluster.id, dup.id)}
                              />
                            ))}
                          </div>
                        </div>

                        {/* Evidence panel */}
                        {cluster.pairs.length > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                              <Link2 className="w-3 h-3" />
                              Evidence ({cluster.pairs.length} link{cluster.pairs.length !== 1 ? 's' : ''})
                            </div>
                            <div className="space-y-1.5">
                              {cluster.pairs.map((pair, j) => {
                                const cA = cluster.contacts.find(c => c.id === pair.contactIdA);
                                const cB = cluster.contacts.find(c => c.id === pair.contactIdB);
                                return (
                                  <div
                                    key={j}
                                    className="flex items-center gap-3 bg-surface-container-low rounded-xl px-3 py-2.5 text-sm"
                                  >
                                    <span className="font-bold text-on-surface truncate min-w-0 flex-1 text-right">
                                      {cA?.name ?? 'Unknown'}
                                    </span>
                                    <MatchBadge type={pair.matchType} confidence={pair.confidence} />
                                    <span className="font-bold text-on-surface truncate min-w-0 flex-1">
                                      {cB?.name ?? 'Unknown'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
