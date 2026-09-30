/**
 * SummaryBar — Tinted hero card for the AI Stats page.
 * Shows a badge when calls are simulated or on Gemini's free tier, the
 * session summary sentence, and a Brain icon watermark.
 */
import { cn } from "../../../lib/utils";
import { CARD_TINTED, LABEL_PRIMARY } from "../../../lib/styles";
import { DURATION, EASE } from "../../../lib/motion";
import { Brain } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { AIStatsSummary } from "../../../api";

interface SummaryBarProps {
  summary?: AIStatsSummary | null;
  isLoading: boolean;
}

/**
 * The badge, shown only when it tells a reader something about their calls.
 * Mock mode means nothing reached a provider. The Gemini free tier means
 * Google may use the prompts, contacts' details included, to improve its
 * products, which is the one tier fact worth a warning.
 */
function badgeFor(s: AIStatsSummary): { label: string; color: string } | null {
  if (s.tier === "MOCK")
    return {
      label: "Mock mode",
      color: "bg-warning/10 text-warning ring-warning/20",
    };
  if (s.freeTier)
    return {
      label: "Gemini free tier",
      color: "bg-warning/10 text-warning ring-warning/20",
    };
  return null;
}

function buildSummaryText(s: AIStatsSummary): string {
  const { session, tier, freeTier } = s;
  if (session.totalInvocations === 0) return "No AI activity recorded yet";

  const parts: string[] = [];
  parts.push(
    `${session.totalInvocations} invocation${session.totalInvocations !== 1 ? "s" : ""}`,
  );
  parts.push(`${session.freshCalls} fresh`);
  parts.push(`${session.cachedCalls} cached`);

  if (session.totalTokens > 0) {
    parts.push(`${formatCompact(session.totalTokens)} tokens`);
  }

  // An estimate at list prices, so not on a free-tier key Google does not bill.
  if (tier === "LIVE" && !freeTier && session.estimatedCostUsd > 0) {
    parts.push(`~$${session.estimatedCostUsd.toFixed(4)} est.`);
  }

  return parts.join(" · ");
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export const SummaryBar = ({ summary, isLoading }: SummaryBarProps) => {
  const tierInfo = summary ? badgeFor(summary) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.slow, ease: EASE }}
      className={cn(CARD_TINTED, "col-span-full")}
    >
      <div className="flex items-center gap-2 mb-4">
        <Brain className="w-4 h-4 text-primary" />
        <span className={LABEL_PRIMARY}>AI usage</span>
        {tierInfo && (
          <span
            className={cn(
              "text-[11px] ml-auto uppercase tracking-[0.08em] font-bold px-2 py-0.5 rounded-md ring-1",
              tierInfo.color,
            )}
          >
            {tierInfo.label}
          </span>
        )}
      </div>

      <AnimatePresence mode="wait">
        {isLoading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            <div className="h-4 bg-primary/20 rounded animate-pulse w-3/4" />
            <div className="h-4 bg-primary/20 rounded animate-pulse w-full" />
          </motion.div>
        ) : summary ? (
          <motion.div
            key="loaded"
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            transition={{ duration: DURATION.slow, ease: EASE }}
          >
            <p className="text-on-surface font-headline text-lg leading-relaxed text-pretty">
              {buildSummaryText(summary)}
            </p>
          </motion.div>
        ) : (
          <motion.div key="empty" className="text-on-surface-variant text-sm">
            Unable to load AI usage data.
          </motion.div>
        )}
      </AnimatePresence>

      {/* A watermark. The card is not a control, so it does not move on hover. */}
      <div className="absolute -right-8 -bottom-8 opacity-5 pointer-events-none">
        <Brain className="w-48 h-48 text-primary" />
      </div>
    </motion.div>
  );
};
