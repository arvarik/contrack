/** Saved-answer stats per AI cache tier, collapsed by default. */
import { useState } from "react";
import { cn } from "../../../lib/utils";
import { CARD, SECTION_HEADING } from "../../../lib/styles";
import { DatabaseZap, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { AIStatsCacheTier } from "../../../api";
import { InfoTip } from "../../../components/ui/InfoTip";
import { DURATION, EASE } from "../../../lib/motion";

interface CacheTiersAccordionProps {
  cacheTiers: Record<string, AIStatsCacheTier>;
}

const TIER_LABELS: Record<string, string> = {
  briefing: "Briefings",
  rerank: "Reranking results",
  synthesis: "Ask answers",
  mentions: "Mentions",
  dailyInsight: "Daily insight",
  queryParse: "Reading a question",
  hyde: "Expanded questions",
};

/**
 * What each tier caches and what a reuse saves, in the UI's words. A bare hit
 * rate means nothing without them.
 */
const TIER_DESCRIPTIONS: Record<string, string> = {
  briefing:
    "Catch me up summaries written for a single contact. Reused means the summary was reused instead of asking the model for it again",
  rerank:
    "AI reordering of search results by relevance. Reused means this query was ranked before, so no model call was needed",
  synthesis:
    "The written answer to an Ask Contrack question. Reused means the same question had already been answered",
  mentions:
    "Finding the people named inside a note you wrote. Reused means that exact note text was already parsed",
  dailyInsight:
    "The daily observation shown on the Pulse page. Reused means today's insight was already generated",
  queryParse:
    "The filters pulled out of an Ask Contrack question, such as a city, a company or a job title. Reused means this question was read before",
  hyde: "An expanded version of your question, used to search by meaning instead of by keyword. Reused means the same question was expanded before",
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
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="hit-area w-full flex items-center gap-2 group"
      >
        <DatabaseZap className="w-4 h-4 text-primary" />
        <span className={cn(SECTION_HEADING, "mb-0")}>
          Saved answers by feature
        </span>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: DURATION.slow, ease: EASE }}
          className="ml-auto"
        >
          <ChevronDown className="w-4 h-4 text-on-surface-variant group-hover:text-on-surface transition-colors" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: DURATION.slow, ease: EASE }}
            className="overflow-hidden"
          >
            {/* Six 56px columns and the name do not fit a phone, so the
                table scrolls sideways in its own box, not the page. */}
            <div className="mt-4 space-y-0 overflow-x-auto -mx-2 px-2">
              <div className="grid grid-cols-[minmax(120px,1fr)_56px_56px_56px_56px_56px_56px] gap-2 px-2 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-on-surface-variant min-w-[504px]">
                <span>Feature</span>
                <span className="text-right">Saved</span>
                <span className="text-right">Reused</span>
                <span className="text-right">New</span>
                <span className="text-right">Dropped</span>
                <span className="text-right">Reuse</span>
                <span className="text-right">Kept</span>
              </div>

              {tiers.map(([name, tier], i) => (
                <div
                  key={name}
                  className={cn(
                    "grid grid-cols-[minmax(120px,1fr)_56px_56px_56px_56px_56px_56px] gap-2 px-2 py-2 rounded-lg text-xs tabular-nums min-w-[504px]",
                    i % 2 === 0 ? "bg-surface-container-low/50" : "",
                  )}
                >
                  <span className="font-bold text-on-surface flex items-center gap-1.5 min-w-0">
                    <span className="truncate">
                      {TIER_LABELS[name] ?? name}
                    </span>
                    {TIER_DESCRIPTIONS[name] && (
                      <InfoTip
                        label={`About ${TIER_LABELS[name] ?? name}`}
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
