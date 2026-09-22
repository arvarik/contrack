import React, { useCallback, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  X,
  Loader2,
  Sparkles,
  Shield,
  Crown,
  ChevronDown,
  ChevronUp,
  Link2,
  AlertTriangle,
} from "lucide-react";
import {
  motion,
  useMotionValue,
  useTransform,
  useAnimation,
} from "motion/react";
import type { Contact, DedupeCluster, ClusterPair } from "../../../types";
import { ContactCard } from "./shared/ContactCard";
import { MatchBadge } from "./shared/MatchBadge";
import { cn } from "../../../lib/utils";
import { CARD, LABEL, SELECTED_TINT, TONE_WASH } from "../../../lib/styles";
import { DURATION, EASE } from "../../../lib/motion";
import { fallbackAvatarUrl } from "../../../lib/avatar";
import { detectMergeConflicts } from "../utils/conflicts";

/** The card leaving the screen after a swipe or a button: an exit, so slow. */
const FLY_OFF = { duration: DURATION.slow, ease: EASE };

// =============================================================================
// ClusterSwipeCard — N-contact cluster review card with draggable gestures
// =============================================================================

interface ClusterSwipeCardProps {
  key?: React.Key;
  cluster: DedupeCluster;
  onMerge: (primaryId: string, duplicateIds: string[]) => Promise<void>;
  onDismiss: () => void;
  isMerging: boolean;
  hasNext: boolean;
}

export const ClusterSwipeCard = ({
  cluster,
  onMerge,
  onDismiss,
  isMerging,
  hasNext,
}: ClusterSwipeCardProps) => {
  const [selectedPrimaryId, setSelectedPrimaryId] = useState(
    cluster.suggestedPrimaryId,
  );
  const [showEvidence, setShowEvidence] = useState(false);
  const [largeClusterConfirmed, setLargeClusterConfirmed] = useState(false);

  const x = useMotionValue(0);
  const controls = useAnimation();
  const rotate = useTransform(x, [-300, 0, 300], [-12, 0, 12]);
  const approveOpacity = useTransform(x, [0, 80, 200], [0, 0.5, 1]);
  const rejectOpacity = useTransform(x, [-200, -80, 0], [1, 0.5, 0]);

  const primary = useMemo(
    () =>
      cluster.contacts.find((c) => c.id === selectedPrimaryId) ??
      cluster.contacts[0],
    [cluster.contacts, selectedPrimaryId],
  );

  const duplicates = useMemo(
    () => cluster.contacts.filter((c) => c.id !== selectedPrimaryId),
    [cluster.contacts, selectedPrimaryId],
  );

  const duplicateIds = useMemo(() => duplicates.map((c) => c.id), [duplicates]);

  const conflicts = useMemo(
    () => detectMergeConflicts(primary, duplicates),
    [primary, duplicates],
  );

  const handleDragEnd = useCallback(
    (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
      const threshold = 100;
      const velocityThreshold = 500;

      if (info.offset.x > threshold || info.velocity.x > velocityThreshold) {
        // Block swipe-merge for large clusters that haven't been confirmed
        if (cluster.requiresConfirmation && !largeClusterConfirmed) {
          controls.start({
            x: 0,
            rotate: 0,
            transition: { type: "spring", stiffness: 500, damping: 30 },
          });
          return;
        }
        controls
          .start({
            x: 600,
            opacity: 0,
            rotate: 15,
            transition: FLY_OFF,
          })
          .then(() => onMerge(selectedPrimaryId, duplicateIds));
      } else if (
        info.offset.x < -threshold ||
        info.velocity.x < -velocityThreshold
      ) {
        controls
          .start({
            x: -600,
            opacity: 0,
            rotate: -15,
            transition: FLY_OFF,
          })
          .then(() => onDismiss());
      } else {
        controls.start({
          x: 0,
          rotate: 0,
          transition: { type: "spring", stiffness: 500, damping: 30 },
        });
      }
    },
    // requiresConfirmation/largeClusterConfirmed were missing here — a real
    // stale closure: after the user ticked the large-cluster confirmation,
    // the swipe handler still held the pre-confirmation value and silently
    // kept blocking the merge. The buttons worked; the swipe did not.
    [
      controls,
      onMerge,
      onDismiss,
      selectedPrimaryId,
      duplicateIds,
      cluster.requiresConfirmation,
      largeClusterConfirmed,
    ],
  );

  const handleButtonMerge = useCallback(async () => {
    if (isMerging) return;
    if (cluster.requiresConfirmation && !largeClusterConfirmed) return;
    await controls.start({
      x: 600,
      opacity: 0,
      rotate: 15,
      transition: FLY_OFF,
    });
    onMerge(selectedPrimaryId, duplicateIds);
  }, [
    controls,
    onMerge,
    selectedPrimaryId,
    duplicateIds,
    isMerging,
    cluster.requiresConfirmation,
    largeClusterConfirmed,
  ]);

  const handleButtonDismiss = useCallback(async () => {
    await controls.start({
      x: -600,
      opacity: 0,
      rotate: -15,
      transition: FLY_OFF,
    });
    onDismiss();
  }, [controls, onDismiss]);

  return (
    <div className="relative">
      {/* Background card peek */}
      {hasNext && (
        <div className={cn(CARD, "absolute inset-0 card-stack-behind")} />
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
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="relative cursor-grab active:cursor-grabbing"
      >
        {/* Swipe overlays */}
        <motion.div
          className="absolute inset-0 rounded-2xl swipe-approve-overlay z-10 pointer-events-none flex items-center justify-center"
          style={{ opacity: approveOpacity }}
        >
          <div className="p-4 bg-emerald-500/20 rounded-full">
            <Check className="w-12 h-12 text-success" strokeWidth={3} />
          </div>
        </motion.div>
        <motion.div
          className="absolute inset-0 rounded-2xl swipe-reject-overlay z-10 pointer-events-none flex items-center justify-center"
          style={{ opacity: rejectOpacity }}
        >
          <div className="p-4 bg-rose-500/20 rounded-full">
            <X className="w-12 h-12 text-error" strokeWidth={3} />
          </div>
        </motion.div>

        {/* Card content */}
        <div className={cn(CARD, "p-5 space-y-4 relative z-0")}>
          {/* Cluster summary header */}
          <div className="bg-surface-container-low rounded-xl p-3 flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-on-surface leading-relaxed">
                {cluster.summary}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={cn(
                  "text-xs font-bold px-2.5 py-1 rounded-md tabular-nums",
                  TONE_WASH.neutral,
                )}
              >
                {cluster.size} contacts
              </span>
              {cluster.hasWeakLink && (
                <span
                  className={cn(
                    "text-xs font-bold px-2.5 py-1 rounded-md",
                    TONE_WASH.warning,
                  )}
                >
                  Weak link
                </span>
              )}
            </div>
          </div>

          {/* Large cluster warning */}
          {cluster.size > 5 && (
            <div
              className="flex items-start gap-3 bg-amber-500/8 rounded-xl p-3"
              role="alert"
            >
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-warning leading-relaxed">
                <span className="font-bold">
                  Large cluster ({cluster.size} contacts).
                </span>{" "}
                Review carefully — merging many contacts is irreversible.
                Consider dismissing and re-scanning after partial merges.
              </p>
            </div>
          )}

          {/* Weak link explanation */}
          {cluster.hasWeakLink && (
            <div
              className="flex items-start gap-3 bg-surface-container-low rounded-xl p-3"
              role="note"
            >
              <Shield className="w-4 h-4 text-on-surface-variant shrink-0 mt-0.5" />
              <p className="text-xs text-on-surface-variant leading-relaxed">
                <span className="font-bold">Weak link detected.</span> At least
                one connection in this cluster has confidence below 60%. Check
                the evidence panel to verify.
              </p>
            </div>
          )}

          {/* Contact strip — horizontal scrollable row of avatars for selecting primary */}
          <div
            className="space-y-2"
            role="radiogroup"
            aria-label="Select primary contact"
          >
            <div className={cn(LABEL, "px-1")}>Select primary contact</div>
            <div className="flex gap-2 overflow-x-auto p-1 nice-scrollbar">
              {cluster.contacts.map((contact) => {
                const isSelectedPrimary = contact.id === selectedPrimaryId;
                return (
                  <button
                    key={contact.id}
                    onClick={() => setSelectedPrimaryId(contact.id)}
                    role="radio"
                    aria-checked={isSelectedPrimary}
                    aria-label={`Set ${contact.name} as primary contact`}
                    className={cn(
                      "shrink-0 flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-colors min-w-0",
                      isSelectedPrimary
                        ? SELECTED_TINT
                        : "state-layer bg-surface-container-low",
                    )}
                  >
                    <img
                      src={contact.avatarUrl || fallbackAvatarUrl(contact.name)}
                      alt={contact.name}
                      className="w-9 h-9 rounded-full object-cover bg-surface-container-high shrink-0"
                    />
                    <div className="min-w-0 text-left">
                      <div className="text-sm font-bold truncate max-w-[140px]">
                        {contact.name}
                      </div>
                      {contact.company && (
                        <div className="text-[11px] text-on-surface-variant truncate max-w-[140px]">
                          {contact.company}
                        </div>
                      )}
                    </div>
                    {isSelectedPrimary && (
                      <Crown className="w-4 h-4 text-success shrink-0" />
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
              label="Primary (keeper)"
              labelColor={TONE_WASH.success}
              isPrimary
            />
            <div className="space-y-3">
              {duplicates.map((dup) => (
                <ContactCard
                  key={dup.id}
                  contact={dup}
                  label="Merges in"
                  labelColor={TONE_WASH.warning}
                  other={primary}
                  onSetPrimary={() => setSelectedPrimaryId(dup.id)}
                />
              ))}
            </div>
          </div>

          {/* Evidence toggle */}
          <button
            onClick={() => setShowEvidence((s) => !s)}
            aria-expanded={showEvidence}
            aria-controls="cluster-evidence"
            className="state-layer w-full flex items-center justify-center gap-2 py-2 min-h-[44px] sm:min-h-0 bg-surface-container-low rounded-xl text-xs font-bold text-on-surface-variant transition-colors"
          >
            <Link2 className="w-3.5 h-3.5" />
            {showEvidence ? "Hide" : "Show"} evidence ({cluster.pairs.length}{" "}
            link{cluster.pairs.length !== 1 ? "s" : ""})
            {showEvidence ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          {showEvidence && (
            <motion.div
              id="cluster-evidence"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              className="space-y-2 overflow-hidden"
            >
              {cluster.pairs.map((pair, i) => (
                <EvidenceRow key={i} pair={pair} contacts={cluster.contacts} />
              ))}
            </motion.div>
          )}

          {/* Conflicting field values banner */}
          {conflicts.length > 0 && (
            <div className="flex items-start gap-2.5 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-on-surface">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-warning">
                  {conflicts.length} field conflict(s):
                </span>{" "}
                <span className="text-on-surface-variant">
                  {conflicts
                    .map((c) => c.label)
                    .slice(0, 3)
                    .join(", ")}
                  {conflicts.length > 3 ? ` +${conflicts.length - 3} more` : ""}
                  . Primary values will be kept.
                </span>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <button
              onClick={handleButtonDismiss}
              aria-label="Keep contacts separate"
              className="group btn-secondary w-full sm:w-auto"
            >
              <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
              <div className="text-left">
                <div className="text-sm font-bold">Keep separate</div>
                <div className="text-[11px] uppercase tracking-[0.08em] opacity-60">
                  Swipe left
                </div>
              </div>
            </button>

            {/* Large cluster confirmation warning */}
            {cluster.requiresConfirmation && (
              <div className="w-full">
                <div className="flex items-start gap-3 p-3 bg-amber-500/10 rounded-xl mb-3">
                  <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-warning">
                      Large cluster warning
                    </p>
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      This cluster contains {cluster.size} contacts. Merging
                      this many records is irreversible. Please double-check
                      before proceeding.
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 min-h-[44px] sm:min-h-0 cursor-pointer select-none">
                  <input
                    aria-label="Confirm merging this large cluster"
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
              disabled={
                isMerging ||
                (cluster.requiresConfirmation && !largeClusterConfirmed)
              }
              aria-label={`Merge ${cluster.size} contacts into one`}
              className="group btn-primary w-full sm:w-auto"
            >
              <div className="text-right">
                <div className="text-sm font-bold">
                  {isMerging ? "Merging..." : "Merge"}
                </div>
                <div className="text-[11px] uppercase tracking-[0.08em] opacity-70">
                  Swipe right →
                </div>
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

function EvidenceRow({
  pair,
  contacts,
}: {
  key?: React.Key;
  pair: ClusterPair;
  contacts: Contact[];
}) {
  const contactA = contacts.find((c) => c.id === pair.contactIdA);
  const contactB = contacts.find((c) => c.id === pair.contactIdB);

  return (
    <div className="flex items-center gap-3 bg-surface-container-low rounded-xl px-3 py-2.5 text-sm">
      {/* Contact A name */}
      <span className="font-bold text-on-surface truncate min-w-0 flex-1 text-right">
        {contactA?.name ?? "Unknown"}
      </span>

      {/* Evidence badge */}
      <MatchBadge type={pair.matchType} confidence={pair.confidence} />

      {/* Contact B name */}
      <span className="font-bold text-on-surface truncate min-w-0 flex-1">
        {contactB?.name ?? "Unknown"}
      </span>
    </div>
  );
}
