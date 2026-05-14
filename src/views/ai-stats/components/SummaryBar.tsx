/**
 * SummaryBar — Tinted hero card for the AI Stats page.
 * Shows the current tier badge, session summary sentence, and a Brain icon watermark.
 */
import React from "react";
import { cn } from "../../../lib/utils";
import { CARD_TINTED, SECTION_HEADING } from "../../../lib/styles";
import { Brain } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { AIStatsSummary } from "../../../api";

interface SummaryBarProps {
  summary?: AIStatsSummary | null;
  isLoading: boolean;
}

const TIER_LABELS: Record<string, { label: string; color: string }> = {
  FREE: {
    label: "Free Tier",
    color: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
  },
  PAID: {
    label: "Paid Tier",
    color: "bg-blue-500/10 text-blue-400 ring-blue-500/20",
  },
  MOCK: {
    label: "Mock Mode",
    color: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
  },
  OPENAI: {
    label: "OpenAI",
    color: "bg-teal-500/10 text-teal-400 ring-teal-500/20",
  },
  ANTHROPIC: {
    label: "Anthropic",
    color: "bg-orange-500/10 text-orange-400 ring-orange-500/20",
  },
};

function buildSummaryText(s: AIStatsSummary): string {
  const { session, tier } = s;
  if (session.totalInvocations === 0) return "No AI activity recorded yet.";

  const parts: string[] = [];
  parts.push(
    `${session.totalInvocations} invocation${session.totalInvocations !== 1 ? "s" : ""}`,
  );
  parts.push(`${session.freshCalls} fresh`);
  parts.push(`${session.cachedCalls} cached`);

  if (session.totalTokens > 0) {
    parts.push(`${formatCompact(session.totalTokens)} tokens`);
  }

  // Cost displays for any paid provider (PAID, OPENAI, ANTHROPIC — anything not FREE/MOCK)
  const isPaidProvider = tier !== "FREE" && tier !== "MOCK";
  if (isPaidProvider && session.estimatedCostUsd > 0) {
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
  const tierInfo = summary
    ? (TIER_LABELS[summary.tier] ?? TIER_LABELS.MOCK)
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={cn(CARD_TINTED, "col-span-full group")}
    >
      <div className="flex items-center gap-2 mb-4">
        <Brain className="w-4 h-4 text-primary" />
        <span
          className={cn(
            SECTION_HEADING,
            "mb-0 text-primary uppercase tracking-widest font-bold",
          )}
        >
          AI Usage
        </span>
        {tierInfo && (
          <span
            className={cn(
              "text-[10px] ml-auto uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ring-1",
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
            transition={{ duration: 0.6 }}
          >
            <p className="text-on-surface font-headline text-lg leading-relaxed text-pretty">
              {buildSummaryText(summary)}
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            className="text-on-surface-variant/70 text-sm"
          >
            Unable to load AI usage data.
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute -right-8 -bottom-8 opacity-5 pointer-events-none transition-transform duration-700 group-hover:scale-110 group-hover:-rotate-12">
        <Brain className="w-48 h-48 text-primary" />
      </div>
    </motion.div>
  );
};
