import React from "react";
import { Command } from "cmdk";
import { motion } from "motion/react";
import { Briefcase, Building, Sparkles } from "lucide-react";
import type { SemanticMatch } from "../../types";
import { fallbackAvatarUrl } from "../../lib/avatar";
import { DURATION, EASE } from "../../lib/motion";
import { TONE_WASH } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { ScoreDot, LastContactLine, StaleChip } from "./ContactMetaBadges";
import { ITEM_CURRENT, MATCH_BADGE } from "./utils";

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
  isFallback: boolean;
  /** Enrichment props for StaleChip */
  hasGroundingCapacity: boolean;
  isEnriching: boolean;
  enrichingContactId: string | null;
  onRefresh?: (contactId: string) => void;
}

export const AIResultCard = ({
  match,
  index,
  onSelect,
  isFallback,
  hasGroundingCapacity,
  isEnriching,
  enrichingContactId,
  onRefresh,
}: AIResultCardProps) => (
  <Command.Item
    key={match.id}
    value={`ai_${match.id}_${match.name}`}
    onSelect={onSelect}
    className={cn(
      "flex items-start gap-3 px-3 py-3 rounded-xl cursor-default select-none transition-colors text-on-surface group",
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
      {/* The avatar wears no ring: a coloured ring around an avatar is the
          relationship's health everywhere else, and the dot after the name
          says it here. */}
      <img
        src={match.avatarUrl || fallbackAvatarUrl(match.name)}
        alt=""
        className="w-8 h-8 mt-0.5 shrink-0 rounded-full bg-surface-container-highest object-cover"
      />

      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        {/* Name + Score Dot + Fallback Badge */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm truncate">{match.name}</span>
          <ScoreDot contact={match} />
          {match.approximate ? (
            <span className={cn(TONE_WASH.primary, MATCH_BADGE)}>
              Approximate
            </span>
          ) : isFallback ? (
            <span className={cn(TONE_WASH.warning, MATCH_BADGE)}>Fallback</span>
          ) : null}
        </div>

        {/* Role + Company */}
        {(match.role || match.company) && (
          <span className="text-xs text-on-surface-variant flex items-center gap-2 truncate">
            {match.role && (
              <span className="flex items-center gap-1">
                <Briefcase className="w-3 h-3" />
                {match.role}
              </span>
            )}
            {match.company && (
              <span className="flex items-center gap-1">
                <Building className="w-3 h-3" />
                {match.company}
              </span>
            )}
          </span>
        )}

        {/* Last Contact Line */}
        <LastContactLine lastContactedAt={match.lastContactedAt} />

        {/* Stale Data Chip */}
        <StaleChip
          contactId={match.id}
          updatedAt={match.updatedAt}
          hasGroundingCapacity={hasGroundingCapacity}
          isEnriching={isEnriching}
          enrichingContactId={enrichingContactId}
          onRefresh={onRefresh}
        />

        {/* AI reason: a model wrote this line, so it wears the AI colour. */}
        {match.aiReason && (
          <motion.span
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: index * 0.06 + 0.1,
              duration: DURATION.slow,
              ease: EASE,
            }}
            className="text-xs text-ai italic flex items-center gap-1 mt-0.5"
          >
            <Sparkles className="w-3 h-3 text-ai shrink-0" />
            {match.aiReason}
          </motion.span>
        )}
      </div>
    </motion.div>
  </Command.Item>
);
