import React from "react";
import { cn } from "../../lib/utils";
import { CARD_TINTED, SECTION_HEADING } from "../../lib/styles";
import { Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { DailyInsight } from "../../api";

interface DailyInsightCardProps {
  insight?: DailyInsight | null;
  isLoading: boolean;
  delay?: number;
}

export const DailyInsightCard = ({
  insight,
  isLoading,
  delay = 0,
}: DailyInsightCardProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={cn(CARD_TINTED, "col-span-full group")}
    >
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-4 h-4 text-primary" />
        <span
          className={cn(
            SECTION_HEADING,
            "mb-0 text-primary uppercase tracking-widest font-bold",
          )}
        >
          Network Intelligence
        </span>
        {insight && (
          <span className="text-[10px] text-primary/60 ml-auto uppercase tracking-widest font-bold bg-primary/5 px-2 py-0.5 rounded-full ring-1 ring-primary/20">
            {insight.category}
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
            <div className="h-4 bg-primary/20 rounded animate-pulse w-5/6" />
          </motion.div>
        ) : insight ? (
          <motion.div
            key="loaded"
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.6 }}
            className="relative"
          >
            <p className="text-on-surface font-headline text-lg leading-relaxed md:w-11/12 text-pretty">
              {insight.text}
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            className="text-on-surface-variant/70 text-sm"
          >
            Configure your AI provider API key to receive automated relationship
            insights.
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute -right-8 -bottom-8 opacity-5 pointer-events-none transition-transform duration-700 group-hover:scale-110 group-hover:-rotate-12">
        <Sparkles className="w-48 h-48 text-primary" />
      </div>
    </motion.div>
  );
};
