/**
 * A search result card for the People mode. The stagger is a CSS
 * `animation-delay`, which stays on the compositor.
 *
 * The list is one Tab stop (`useRovingFocus`). The card and its question
 * mark both take the stop's props, so Tab reaches only the current mark.
 */
import React from "react";
import {
  Sparkles,
  Briefcase,
  Building,
  MapPin,
  Globe,
  ArrowRight,
} from "lucide-react";
import type { SemanticMatch } from "../../types";
import { CARD, CARD_INTERACTIVE, TAG_PILL, TONE_WASH } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { fallbackAvatarUrl } from "../../lib/avatar";
import {
  MATCH_BADGE,
  isUnverified,
} from "../../components/command-palette/utils";
import { InfoTip } from "../../components/ui/InfoTip";
import { MatchedFields } from "./MatchedFields";

interface ResultCardProps {
  key?: React.Key;
  match: SemanticMatch;
  index: number;
  /** The chunk's `fallback`. It decides the badge when the match has no `verified`. */
  isFallback: boolean;
  onClick: () => void;
  /** The list's roving Tab stop, from `useRovingFocus`. */
  itemProps?: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    "data-roving"?: number;
  };
}

export const ResultCard = ({
  match,
  index,
  isFallback,
  onClick,
  itemProps,
}: ResultCardProps) => {
  /** AI did not check this match. "Approximate" says more, so it wins. */
  const unverified = !match.approximate && isUnverified(match, isFallback);
  return (
    <div
      // The fade-in makes each card its own layer, so the card with an open
      // question mark rises to cover the cards after it.
      className="result-card-enter relative has-[[data-tip=open]]:z-10"
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <button
        type="button"
        {...itemProps}
        onClick={onClick}
        className={cn(
          CARD_INTERACTIVE,
          "w-full text-left flex items-start gap-4 group",
          // Room in the top right corner for the question mark.
          unverified && "pr-12",
        )}
      >
        <img
          src={match.avatarUrl || fallbackAvatarUrl(match.name)}
          alt=""
          className="w-12 h-12 rounded-full bg-surface-container-high object-cover shrink-0 mt-0.5"
        />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          {/* The row wraps, so on a phone the badge does not cut the name. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-bold text-on-surface truncate">
              {match.name}
            </span>
            {match.approximate && (
              <span className={cn(TONE_WASH.primary, MATCH_BADGE)}>
                Approximate
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-on-surface-variant">
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
            {match.location && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {match.location}
              </span>
            )}
            {match.industry && (
              <span className="flex items-center gap-1">
                <Globe className="w-3 h-3" />
                {match.industry}
              </span>
            )}
          </div>

          {/* Without `matchedOn`, the server sends a one-line AI reason. */}
          {match.matchedOn?.length ? (
            <MatchedFields fields={match.matchedOn} />
          ) : (
            match.aiReason && (
              <div className="flex items-start gap-1.5 mt-1">
                <Sparkles className="w-3.5 h-3.5 text-ai shrink-0 mt-0.5" />
                <span className="text-sm text-ai italic leading-snug">
                  {match.aiReason}
                </span>
              </div>
            )
          )}

          {match.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {match.tags.slice(0, 5).map((t) => (
                <span key={t.id} className={TAG_PILL}>
                  {t.tag}
                </span>
              ))}
              {/* Full strength: at half opacity the contrast is about 2:1. */}
              {match.tags.length > 5 && (
                <span className="text-[11px] text-on-surface-variant">
                  +{match.tags.length - 5}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Centered: the top right corner belongs to the question mark. */}
        <ArrowRight className="w-4 h-4 text-on-surface-variant opacity-0 group-hover:opacity-60 transition-opacity shrink-0 self-center" />
      </button>

      {/* A sibling laid over the card's corner: a button inside a button is
          invalid HTML. */}
      {unverified && (
        <InfoTip
          label={`${match.name}: not verified by AI`}
          tone="warning"
          align="end"
          tabIndex={itemProps?.tabIndex}
          className="absolute top-3 right-3"
        >
          <strong className="block font-bold">Not verified by AI</strong>
          {match.name} matches your words or their meaning, but AI did not check
          the match
        </InfoTip>
      )}
    </div>
  );
};

interface ShimmerCardProps {
  delay?: number;
}

export const ShimmerCard = ({ delay = 0 }: ShimmerCardProps) => (
  <div
    className={cn(CARD, "flex items-start gap-4 result-card-enter")}
    style={{ animationDelay: `${delay * 1000}ms` }}
  >
    <div className="w-12 h-12 rounded-full bg-primary/10 animate-pulse shrink-0" />
    <div className="flex-1 space-y-2.5 py-1">
      <div className="h-4 bg-primary/10 rounded-full animate-pulse w-1/3" />
      <div className="h-3 bg-surface-container-high rounded-full animate-pulse w-3/5" />
      <div className="h-3 bg-surface-container rounded-full animate-pulse w-4/5" />
    </div>
  </div>
);
