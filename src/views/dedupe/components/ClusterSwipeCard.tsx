import React, { useCallback, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, X, Loader2, Sparkles,
  Shield, Crown, ChevronDown, ChevronUp, Link2, AlertTriangle,
} from 'lucide-react';
import { motion, useMotionValue, useTransform, useAnimation } from 'motion/react';
import type { Contact, DedupeCluster, ClusterPair } from '../../../types';
import { ContactCard } from './shared/ContactCard';
import { MatchBadge } from './shared/MatchBadge';
import { cn } from '../../../lib/utils';
import { fallbackAvatarUrl } from '../../../lib/avatar';

// =============================================================================
// ClusterSwipeCard — N-contact cluster review card with draggable gestures
// =============================================================================

interface ClusterSwipeCardProps {
  cluster: DedupeCluster;
  onMerge: (primaryId: string, duplicateIds: string[]) => Promise<void>;
  onDismiss: () => void;
  isMerging: boolean;
  hasNext: boolean;
}

export const ClusterSwipeCard = ({
  cluster, onMerge, onDismiss, isMerging, hasNext,
}: ClusterSwipeCardProps) => {
  const [selectedPrimaryId, setSelectedPrimaryId] = useState(cluster.suggestedPrimaryId);
  const [showEvidence, setShowEvidence] = useState(false);
  const [largeClusterConfirmed, setLargeClusterConfirmed] = useState(false);

  const x = useMotionValue(0);
  const controls = useAnimation();
  const rotate = useTransform(x, [-300, 0, 300], [-12, 0, 12]);
  const approveOpacity = useTransform(x, [0, 80, 200], [0, 0.5, 1]);
  const rejectOpacity = useTransform(x, [-200, -80, 0], [1, 0.5, 0]);

  const primary = useMemo(
    () => cluster.contacts.find(c => c.id === selectedPrimaryId) ?? cluster.contacts[0],
    [cluster.contacts, selectedPrimaryId],
  );

  const duplicates = useMemo(
    () => cluster.contacts.filter(c => c.id !== selectedPrimaryId),
    [cluster.contacts, selectedPrimaryId],
  );

  const duplicateIds = useMemo(
    () => duplicates.map(c => c.id),
    [duplicates],
  );

  const handleDragEnd = useCallback((_: any, info: { offset: { x: number }; velocity: { x: number } }) => {
    const threshold = 100;
    const velocityThreshold = 500;

    if (info.offset.x > threshold || info.velocity.x > velocityThreshold) {
      // Block swipe-merge for large clusters that haven't been confirmed
      if (cluster.requiresConfirmation && !largeClusterConfirmed) {
        controls.start({ x: 0, rotate: 0, transition: { type: 'spring', stiffness: 500, damping: 30 } });
        return;
      }
      controls.start({
        x: 600, opacity: 0, rotate: 15,
        transition: { duration: 0.4, ease: 'easeOut' },
      }).then(() => onMerge(selectedPrimaryId, duplicateIds));
    } else if (info.offset.x < -threshold || info.velocity.x < -velocityThreshold) {
      controls.start({
        x: -600, opacity: 0, rotate: -15,
        transition: { duration: 0.4, ease: 'easeOut' },
      }).then(() => onDismiss());
    } else {
      controls.start({
        x: 0, rotate: 0,
        transition: { type: 'spring', stiffness: 500, damping: 30 },
      });
    }
  }, [controls, onMerge, onDismiss, selectedPrimaryId, duplicateIds]);

  const handleButtonMerge = useCallback(async () => {
    if (isMerging) return;
    if (cluster.requiresConfirmation && !largeClusterConfirmed) return;
    await controls.start({
      x: 600, opacity: 0, rotate: 15,
      transition: { duration: 0.35, ease: 'easeOut' },
    });
    onMerge(selectedPrimaryId, duplicateIds);
  }, [controls, onMerge, selectedPrimaryId, duplicateIds, isMerging, cluster.requiresConfirmation, largeClusterConfirmed]);

  const handleButtonDismiss = useCallback(async () => {
    await controls.start({
      x: -600, opacity: 0, rotate: -15,
      transition: { duration: 0.35, ease: 'easeOut' },
    });
    onDismiss();
  }, [controls, onDismiss]);

  return (
    <div className="relative">
      {/* Background card peek */}
      {hasNext && (
        <div className="absolute inset-0 card-stack-behind rounded-2xl bg-surface-container-lowest shadow-sm" />
      )}

      {/* Main draggable card */}
      <motion.div
        key={cluster.id}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.7}
        onDragEnd={handleDragEnd}
        animate={controls}
        style={{ x, rotate }}
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className="relative cursor-grab active:cursor-grabbing"
      >
        {/* Swipe overlays */}
        <motion.div
          className="absolute inset-0 rounded-2xl swipe-approve-overlay z-10 pointer-events-none flex items-center justify-center"
          style={{ opacity: approveOpacity }}
        >
          <div className="p-4 bg-emerald-500/20 rounded-full">
            <Check className="w-12 h-12 text-emerald-500" strokeWidth={3} />
          </div>
        </motion.div>
        <motion.div
          className="absolute inset-0 rounded-2xl swipe-reject-overlay z-10 pointer-events-none flex items-center justify-center"
          style={{ opacity: rejectOpacity }}
        >
          <div className="p-4 bg-rose-500/20 rounded-full">
            <X className="w-12 h-12 text-rose-500" strokeWidth={3} />
          </div>
        </motion.div>

        {/* Card content */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm p-5 space-y-4 relative z-0">
          {/* Cluster summary header */}
          <div className="bg-surface-container-low rounded-xl p-3 flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-on-surface leading-relaxed">{cluster.summary}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-bold text-on-surface-variant bg-surface-container-high px-2.5 py-1 rounded-full tabular-nums">
                {cluster.size} contacts
              </span>
              {cluster.hasWeakLink && (
                <span className="text-xs font-bold text-amber-600 bg-amber-500/10 px-2.5 py-1 rounded-full">
                  Weak link
                </span>
              )}
            </div>
          </div>

          {/* Large cluster warning */}
          {cluster.size > 5 && (
            <div className="flex items-start gap-3 bg-amber-500/8 rounded-xl p-3" role="alert">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 leading-relaxed">
                <span className="font-bold">Large cluster ({cluster.size} contacts).</span>{' '}
                Review carefully — merging many contacts is irreversible. Consider dismissing and re-scanning after partial merges.
              </p>
            </div>
          )}

          {/* Weak link explanation */}
          {cluster.hasWeakLink && (
            <div className="flex items-start gap-3 bg-surface-container-low rounded-xl p-3" role="note">
              <Shield className="w-4 h-4 text-on-surface-variant shrink-0 mt-0.5" />
              <p className="text-xs text-on-surface-variant leading-relaxed">
                <span className="font-bold">Weak link detected.</span>{' '}
                At least one connection in this cluster has confidence below 60%. Check the evidence panel to verify.
              </p>
            </div>
          )}

          {/* Contact strip — horizontal scrollable row of avatars for selecting primary */}
          <div className="space-y-2" role="radiogroup" aria-label="Select primary contact">
            <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant px-1">
              Select Primary Contact
            </div>
            <div className="flex gap-2 overflow-x-auto p-1 nice-scrollbar">
              {cluster.contacts.map(contact => {
                const isSelectedPrimary = contact.id === selectedPrimaryId;
                return (
                  <button
                    key={contact.id}
                    onClick={() => setSelectedPrimaryId(contact.id)}
                    role="radio"
                    aria-checked={isSelectedPrimary}
                    aria-label={`Set ${contact.name} as primary contact`}
                    className={cn(
                      "shrink-0 flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all min-w-0",
                      isSelectedPrimary
                        ? "bg-emerald-500/10 ring-2 ring-emerald-500/50 shadow-sm"
                        : "bg-surface-container-low hover:bg-surface-container-high"
                    )}
                  >
                    <img
                      src={contact.avatarUrl || fallbackAvatarUrl(contact.name)}
                      alt={contact.name}
                      className="w-9 h-9 rounded-full object-cover bg-surface-container-high shrink-0"
                    />
                    <div className="min-w-0 text-left">
                      <div className="text-sm font-bold truncate max-w-[140px]">{contact.name}</div>
                      {contact.company && (
                        <div className="text-[11px] text-on-surface-variant truncate max-w-[140px]">{contact.company}</div>
                      )}
                    </div>
                    {isSelectedPrimary && (
                      <Crown className="w-4 h-4 text-emerald-600 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Primary vs. Duplicates comparison */}
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
                  onSetPrimary={() => setSelectedPrimaryId(dup.id)}
                />
              ))}
            </div>
          </div>

          {/* Evidence toggle */}
          <button
            onClick={() => setShowEvidence(s => !s)}
            aria-expanded={showEvidence}
            aria-controls="cluster-evidence"
            className="w-full flex items-center justify-center gap-2 py-2 bg-surface-container-low hover:bg-surface-container-high rounded-xl text-xs font-bold text-on-surface-variant transition-colors"
          >
            <Link2 className="w-3.5 h-3.5" />
            {showEvidence ? 'Hide' : 'Show'} Evidence ({cluster.pairs.length} link{cluster.pairs.length !== 1 ? 's' : ''})
            {showEvidence ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showEvidence && (
            <motion.div
              id="cluster-evidence"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              className="space-y-2 overflow-hidden"
            >
              {cluster.pairs.map((pair, i) => (
                <EvidenceRow key={i} pair={pair} contacts={cluster.contacts} />
              ))}
            </motion.div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <button
              onClick={handleButtonDismiss}
              aria-label="Keep contacts separate"
              className="group flex items-center gap-3 px-6 py-3 bg-surface-container-low hover:bg-rose-500/8 rounded-2xl transition-all text-on-surface-variant hover:text-rose-600 w-full sm:w-auto justify-center"
            >
              <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
              <div className="text-left">
                <div className="text-sm font-bold">Keep Separate</div>
                <div className="text-[10px] uppercase tracking-wider opacity-60">Swipe left</div>
              </div>
            </button>

            {/* Large cluster confirmation warning */}
            {cluster.requiresConfirmation && (
              <div className="w-full">
                <div className="flex items-start gap-3 p-3 bg-amber-500/10 rounded-xl mb-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-amber-600">Large cluster warning</p>
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      This cluster contains {cluster.size} contacts. Merging this many records is irreversible. Please double-check before proceeding.
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={largeClusterConfirmed}
                    onChange={(e) => setLargeClusterConfirmed(e.target.checked)}
                    className="w-4 h-4 rounded accent-primary"
                  />
                  <span className="text-sm font-bold text-on-surface">
                    I confirm these {cluster.size} contacts should be merged
                  </span>
                </label>
              </div>
            )}

            <button
              onClick={handleButtonMerge}
              disabled={isMerging || (cluster.requiresConfirmation && !largeClusterConfirmed)}
              aria-label={`Merge ${cluster.size} contacts into one`}
              className="group flex items-center gap-3 px-6 py-3 bg-primary text-on-primary rounded-2xl hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-50 w-full sm:w-auto justify-center"
            >
              <div className="text-right">
                <div className="text-sm font-bold">
                  {isMerging ? 'Merging...' : 'Merge'}
                </div>
                <div className="text-[10px] uppercase tracking-wider opacity-70">Swipe right →</div>
              </div>
              {isMerging ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

// =============================================================================
// EvidenceRow — A single pair evidence item within the cluster
// =============================================================================

function EvidenceRow({ pair, contacts }: { pair: ClusterPair; contacts: Contact[] }) {
  const contactA = contacts.find(c => c.id === pair.contactIdA);
  const contactB = contacts.find(c => c.id === pair.contactIdB);

  return (
    <div className="flex items-center gap-3 bg-surface-container-low rounded-xl px-3 py-2.5 text-sm">
      {/* Contact A name */}
      <span className="font-bold text-on-surface truncate min-w-0 flex-1 text-right">
        {contactA?.name ?? 'Unknown'}
      </span>

      {/* Evidence badge */}
      <MatchBadge type={pair.matchType} confidence={pair.confidence} />

      {/* Contact B name */}
      <span className="font-bold text-on-surface truncate min-w-0 flex-1">
        {contactB?.name ?? 'Unknown'}
      </span>
    </div>
  );
}
