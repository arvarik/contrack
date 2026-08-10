/**
 * CacheTiersAccordion — Collapsible cache tier detail section.
 * Shows hit/miss/eviction stats per AI cache tier with color-coded hit rates.
 */
import React, { useState } from "react";
import { cn } from "../../../lib/utils";
import { CARD, SECTION_HEADING } from "../../../lib/styles";
import { DatabaseZap, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { AIStatsCacheTier } from "../../../api";
import { InfoTip } from "../../../components/ui/InfoTip";

interface CacheTiersAccordionProps {
  cacheTiers: Record<string, AIStatsCacheTier>;
}

/** Human-readable tier labels. */
const TIER_LABELS: Record<string, string> = {
  briefing: "Briefing",
  rerank: "Rerank",
  synthesis: "Synthesis",
  mentions: "Mentions",
  dailyInsight: "Daily Insight",
  queryParse: "Query Parse",
  hyde: "Query Expansion",
};

/**
 * What each tier caches, and what a hit actually saved you.
 *
 * "Rerank: 82%" tells you nothing unless you know what a rerank is and what
 * was avoided by not doing one. Each description names the feature in the
 * words the UI uses for it, then says what a cache hit means in practice.
 */
const TIER_DESCRIPTIONS: Record<string, string> = {
  briefing:
    "Catch Me Up summaries written for a single contact. A hit means the summary was reused instead of asking the model for it again.",
  rerank:
    "AI reordering of search results by relevance. A hit means this query was ranked before, so no model call was needed.",
  synthesis:
    "The written answer to an Ask Contrack question. A hit means the same question had already been answered.",
  mentions:
    "Finding the people named inside a note you wrote. A hit means that exact note text was already parsed.",
  dailyInsight:
    "The daily observation shown on the Relationship Pulse page. A hit means today's insight was already generated.",
  queryParse:
    "The filters pulled out of an Ask Contrack question, such as a city, a company or a job title. A hit means this question was read before.",
  hyde: "An expanded version of your question, used to search by meaning instead of by keyword. A hit means the same question was expanded before.",
};

function formatTTL(ms: number): string {
  if (ms >= 24 * 60 * 60_000) return `${ms / (24 * 60 * 60_000)}d`;
  if (ms >= 60 * 60_000) return `${ms / (60 * 60_000)}h`;
  if (ms >= 60_000) return `${ms / 60_000}m`;
  return `${ms / 1_000}s`;
}

function hitRateColor(rate: number): string {
  if (rate >= 0.75) return "text-success";
  if (rate >= 0.5) return "text-on-surface-variant";
  return "text-warning";
}

export const CacheTiersAccordion = ({
  cacheTiers,
}: CacheTiersAccordionProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const tiers = Object.entries(cacheTiers);

  return (
    <div className={CARD}>
      {/* Header — clickable */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 group"
      >
        <DatabaseZap className="w-4 h-4 text-primary" />
        <span className={cn(SECTION_HEADING, "mb-0")}>Cache Tiers</span>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="ml-auto"
        >
          <ChevronDown className="w-4 h-4 text-on-surface-variant group-hover:text-on-surface-variant transition-colors" />
        </motion.div>
      </button>

      {/* Expanded content */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {/*
              Six numeric columns at a fixed 50px plus the tier name do not fit
              a phone. Rather than shrink the numbers into illegibility or drop
              columns, the table scrolls sideways inside its own container; the
              card itself never causes the page to scroll horizontally.
            */}
            <div className="mt-4 space-y-0 overflow-x-auto -mx-2 px-2">
              {/* Header row */}
              <div className="grid grid-cols-[minmax(120px,1fr)_50px_50px_50px_50px_50px_50px] gap-2 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant min-w-[420px]">
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
                    "grid grid-cols-[minmax(120px,1fr)_50px_50px_50px_50px_50px_50px] gap-2 px-2 py-2 rounded-lg text-xs tabular-nums min-w-[420px]",
                    i % 2 === 0 ? "bg-surface-container-low/50" : "",
                  )}
                >
                  <span className="font-bold text-on-surface flex items-center gap-1.5 min-w-0">
                    <span className="truncate">
                      {TIER_LABELS[name] ?? name}
                    </span>
                    {TIER_DESCRIPTIONS[name] && (
                      <InfoTip
                        label={`About the ${TIER_LABELS[name] ?? name} cache`}
                        className="shrink-0"
                      >
                        {TIER_DESCRIPTIONS[name]}
                      </InfoTip>
                    )}
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
                  <span
                    className={cn(
                      "text-right font-bold",
                      hitRateColor(tier.hitRate),
                    )}
                  >
                    {(tier.hitRate * 100).toFixed(0)}%
                  </span>
                  <span className="text-right text-on-surface-variant">
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
