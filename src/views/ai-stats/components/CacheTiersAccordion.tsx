/**
 * CacheTiersAccordion — Collapsible cache tier detail section.
 * Shows hit/miss/eviction stats per AI cache tier with color-coded hit rates.
 */
import React, { useState } from 'react';
import { cn } from '../../../lib/utils';
import { CARD, SECTION_HEADING } from '../../../lib/styles';
import { DatabaseZap, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { AIStatsCacheTier } from '../../../api';

interface CacheTiersAccordionProps {
  cacheTiers: Record<string, AIStatsCacheTier>;
}

/** Human-readable tier labels. */
const TIER_LABELS: Record<string, string> = {
  briefing: 'Briefing',
  rerank: 'Rerank',
  synthesis: 'Synthesis',
  mentions: 'Mentions',
  dailyInsight: 'Daily Insight',
};

function formatTTL(ms: number): string {
  if (ms >= 24 * 60 * 60_000) return `${ms / (24 * 60 * 60_000)}d`;
  if (ms >= 60 * 60_000) return `${ms / (60 * 60_000)}h`;
  if (ms >= 60_000) return `${ms / 60_000}m`;
  return `${ms / 1_000}s`;
}

function hitRateColor(rate: number): string {
  if (rate >= 0.75) return 'text-emerald-400';
  if (rate >= 0.50) return 'text-on-surface-variant';
  return 'text-amber-400';
}

export const CacheTiersAccordion = ({ cacheTiers }: CacheTiersAccordionProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const tiers = Object.entries(cacheTiers);
  const totalEntries = tiers.reduce((acc, [, t]) => acc + t.entries, 0);

  return (
    <div className={CARD}>
      {/* Header — clickable */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 group"
      >
        <DatabaseZap className="w-4 h-4 text-primary" />
        <span className={cn(SECTION_HEADING, 'mb-0')}>Cache Tiers</span>
        <span className="text-[10px] font-bold text-on-surface-variant/50 bg-surface-container px-1.5 py-0.5 rounded-full tabular-nums">
          {totalEntries}
        </span>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="ml-auto"
        >
          <ChevronDown className="w-4 h-4 text-on-surface-variant/50 group-hover:text-on-surface-variant transition-colors" />
        </motion.div>
      </button>

      {/* Expanded content */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-0">
              {/* Header row */}
              <div className="grid grid-cols-[1fr_50px_50px_50px_50px_50px_50px] gap-2 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/40">
                <span>Tier</span>
                <span className="text-right">Entries</span>
                <span className="text-right">Hits</span>
                <span className="text-right">Misses</span>
                <span className="text-right">Evicts</span>
                <span className="text-right">Rate</span>
                <span className="text-right">TTL</span>
              </div>

              {tiers.map(([name, tier], i) => (
                <div
                  key={name}
                  className={cn(
                    'grid grid-cols-[1fr_50px_50px_50px_50px_50px_50px] gap-2 px-2 py-2 rounded-lg text-xs tabular-nums',
                    i % 2 === 0 ? 'bg-surface-container-low/50' : ''
                  )}
                >
                  <span className="font-bold text-on-surface">
                    {TIER_LABELS[name] ?? name}
                  </span>
                  <span className="text-right text-on-surface-variant">
                    {tier.entries}/{tier.maxEntries}
                  </span>
                  <span className="text-right text-on-surface-variant">
                    {tier.hits}
                  </span>
                  <span className="text-right text-on-surface-variant">
                    {tier.misses}
                  </span>
                  <span className="text-right text-on-surface-variant">
                    {tier.evictions}
                  </span>
                  <span className={cn('text-right font-bold', hitRateColor(tier.hitRate))}>
                    {(tier.hitRate * 100).toFixed(0)}%
                  </span>
                  <span className="text-right text-on-surface-variant/60">
                    {formatTTL(tier.ttlMs)}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
