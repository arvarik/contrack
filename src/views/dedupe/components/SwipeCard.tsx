import React, { useCallback, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, X, Loader2, ArrowLeftRight, Sparkles,
} from 'lucide-react';
import { motion, useMotionValue, useTransform, useAnimation, AnimatePresence } from 'motion/react';
import type { Contact, DedupeSuggestion } from '../../../types';
import { ContactCard } from './shared/ContactCard';
import { MatchBadge } from './shared/MatchBadge';
import { cn } from '../../../lib/utils';

// =============================================================================
// SwipeCard — Tinder-style draggable review card
// =============================================================================

interface SwipeCardProps {
  suggestion: DedupeSuggestion;
  onMerge: (primaryId: string, duplicateId: string) => Promise<void>;
  onDismiss: () => void;
  isMerging: boolean;
  /** The next suggestion to show behind the current card */
  nextSuggestion?: DedupeSuggestion | null;
}

export const SwipeCard = ({ suggestion, onMerge, onDismiss, isMerging, nextSuggestion }: SwipeCardProps) => {
  const [swapped, setSwapped] = useState(false);

  // Derive the "primary" and "duplicate" based on swap state
  const primary = swapped ? suggestion.contactB : suggestion.contactA;
  const duplicate = swapped ? suggestion.contactA : suggestion.contactB;

  const x = useMotionValue(0);
  const controls = useAnimation();

  // Visual transforms based on drag position
  const rotate = useTransform(x, [-300, 0, 300], [-12, 0, 12]);
  const approveOpacity = useTransform(x, [0, 80, 200], [0, 0.5, 1]);
  const rejectOpacity = useTransform(x, [-200, -80, 0], [1, 0.5, 0]);

  const handleDragEnd = useCallback((_: any, info: { offset: { x: number }; velocity: { x: number } }) => {
    const threshold = 100;
    const velocityThreshold = 500;

    if (info.offset.x > threshold || info.velocity.x > velocityThreshold) {
      // Swipe right → merge
      controls.start({
        x: 600,
        opacity: 0,
        rotate: 15,
        transition: { duration: 0.4, ease: 'easeOut' },
      }).then(() => {
        onMerge(primary.id, duplicate.id);
      });
    } else if (info.offset.x < -threshold || info.velocity.x < -velocityThreshold) {
      // Swipe left → dismiss
      controls.start({
        x: -600,
        opacity: 0,
        rotate: -15,
        transition: { duration: 0.4, ease: 'easeOut' },
      }).then(() => {
        onDismiss();
      });
    } else {
      // Snap back
      controls.start({
        x: 0,
        rotate: 0,
        transition: { type: 'spring', stiffness: 500, damping: 30 },
      });
    }
  }, [controls, onMerge, onDismiss, primary.id, duplicate.id]);

  const handleButtonMerge = useCallback(async () => {
    if (isMerging) return;
    await controls.start({
      x: 600,
      opacity: 0,
      rotate: 15,
      transition: { duration: 0.35, ease: 'easeOut' },
    });
    onMerge(primary.id, duplicate.id);
  }, [controls, onMerge, primary.id, duplicate.id, isMerging]);

  const handleButtonDismiss = useCallback(async () => {
    await controls.start({
      x: -600,
      opacity: 0,
      rotate: -15,
      transition: { duration: 0.35, ease: 'easeOut' },
    });
    onDismiss();
  }, [controls, onDismiss]);

  return (
    <div className="relative">
      {/* Background card (next suggestion peek) */}
      {nextSuggestion && (
        <div className="absolute inset-0 card-stack-behind rounded-2xl bg-surface-container-lowest shadow-sm" />
      )}

      {/* Main draggable card */}
      <motion.div
        key={suggestion.id}
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
        {/* Swipe overlay indicators */}
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
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm p-5 space-y-3 relative z-0">
          {/* Reasoning */}
          <div className="bg-surface-container-low rounded-xl p-3 flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-on-surface leading-relaxed">{suggestion.reasoning}</p>
            </div>
            <MatchBadge type={suggestion.matchType} confidence={suggestion.confidence} />
          </div>

          {/* Side-by-side contact cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 relative">
            <ContactCard
              contact={primary}
              label="Primary (Keeper)"
              labelColor="text-emerald-600 bg-emerald-500/10"
              other={duplicate}
            />

            {/* Swap button between cards */}
            <button
              onClick={() => setSwapped(s => !s)}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 p-2.5 bg-surface-container-lowest rounded-full shadow-lg hover:shadow-xl hover:scale-110 transition-all hidden lg:flex items-center justify-center group"
              title="Swap primary / duplicate"
            >
              <ArrowLeftRight className="w-4 h-4 text-on-surface-variant group-hover:text-primary transition-colors" />
            </button>

            <ContactCard
              contact={duplicate}
              label="Duplicate (Merges In)"
              labelColor="text-amber-600 bg-amber-500/10"
              other={primary}
            />
          </div>

          {/* Mobile swap button */}
          <button
            onClick={() => setSwapped(s => !s)}
            className="lg:hidden w-full flex items-center justify-center gap-2 py-2 bg-surface-container-low rounded-xl text-xs font-bold text-on-surface-variant hover:text-primary transition-colors"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Swap Primary / Duplicate
          </button>

          {/* Desktop action buttons */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={handleButtonDismiss}
              className="group flex items-center gap-3 px-6 py-3 bg-surface-container-low hover:bg-rose-500/8 rounded-2xl transition-all text-on-surface-variant hover:text-rose-600"
            >
              <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
              <div className="text-left">
                <div className="text-sm font-bold">Keep Separate</div>
                <div className="text-[10px] uppercase tracking-wider opacity-60">← or Swipe Left</div>
              </div>
            </button>

            <button
              onClick={handleButtonMerge}
              disabled={isMerging}
              className="group flex items-center gap-3 px-6 py-3 bg-primary text-on-primary rounded-2xl hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-50"
            >
              <div className="text-right">
                <div className="text-sm font-bold">
                  {isMerging ? 'Merging...' : 'Merge'}
                </div>
                <div className="text-[10px] uppercase tracking-wider opacity-70">Swipe Right or →</div>
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
