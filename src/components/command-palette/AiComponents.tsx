import React from "react";
import { Command } from "cmdk";
import { motion } from "motion/react";
import { HelpCircle, Sparkles } from "lucide-react";
import type { SemanticMatch } from "../../types";
import { fallbackAvatarUrl } from "../../lib/avatar";
import { DURATION, EASE } from "../../lib/motion";
import { cn } from "../../lib/utils";
import { ContactRowBody } from "./ContactMetaBadges";
import { ITEM_CURRENT, isUnverified } from "./utils";

export const AIShimmerRow = ({ delay = 0 }: { delay?: number }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ delay, duration: DURATION.slow, ease: EASE }}
    className="flex items-center gap-3 px-3 py-3 rounded-xl"
  >
    <div className="w-8 h-8 rounded-full bg-primary/10 animate-pulse shrink-0" />
    <div className="flex-1 space-y-2">
      <div className="h-3 bg-primary/10 rounded-full animate-pulse w-2/5" />
      <div className="h-2.5 bg-surface-container-high rounded-full animate-pulse w-3/5" />
      <div className="h-2 bg-surface-container rounded-full animate-pulse w-4/5" />
    </div>
  </motion.div>
);

interface AIResultCardProps {
  key?: React.Key;
  match: SemanticMatch;
  index: number;
  onSelect: () => void;
  /** The chunk's `fallback`. It decides the badge when the match has no `verified`. */
  isFallback: boolean;
  /**
   * AI is set up. Without it the reason under the name comes from rules
   * only, and it takes the plain ink, not the AI color and its sparkle.
   */
  ai?: boolean;
}

export const AIResultCard = ({
  match,
  index,
  onSelect,
  isFallback,
  ai = true,
}: AIResultCardProps) => (
  <Command.Item
    key={match.id}
    value={`ai_${match.id}_${match.name}`}
    onSelect={onSelect}
    className={cn(
      "flex items-start gap-3 px-3 py-2 rounded-xl cursor-default select-none transition-colors text-on-surface group",
      ITEM_CURRENT,
    )}
  >
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        delay: index * 0.06,
        duration: DURATION.slow,
        ease: EASE,
      }}
      className="contents"
    >
      {/* The avatar wears no ring: a colored ring around an avatar is the
          relationship's health everywhere else, and the dot after the name
          says it here. */}
      <img
        src={match.avatarUrl || fallbackAvatarUrl(match.name)}
        alt=""
        className="w-8 h-8 mt-0.5 shrink-0 rounded-full bg-surface-container-highest object-cover"
      />

      <ContactRowBody contact={match}>
        {/* The reason: the AI color while AI answers, plain without it. */}
        {match.aiReason && (
          <motion.span
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: index * 0.06 + 0.1,
              duration: DURATION.slow,
              ease: EASE,
            }}
            className={cn(
              "text-xs italic flex items-center gap-1 mt-0.5",
              ai ? "text-ai" : "text-on-surface-variant",
            )}
          >
            {ai && <Sparkles className="w-3 h-3 text-ai shrink-0" />}
            {match.aiReason}
          </motion.span>
        )}
      </ContactRowBody>

      {/*
        The question mark of a match AI did not verify, in the top right
        corner as on the Ask page. A row is an option, and an option holds
        no second control, so this mark is a picture with a name, not a
        button: the name joins the option's name, the pointer shows the
        title, and the group heading above says it for every row.
      */}
      {!match.approximate && isUnverified(match, isFallback) && (
        <span
          role="img"
          aria-label="Not verified by AI"
          title="Not verified by AI"
          className="shrink-0 mt-0.5 text-warning"
        >
          <HelpCircle className="w-[18px] h-[18px]" aria-hidden="true" />
        </span>
      )}
    </motion.div>
  </Command.Item>
);
