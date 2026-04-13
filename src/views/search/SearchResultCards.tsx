/**
 * ResultCard — Single search result card for the AI Search view.
 *
 * Animation strategy: CSS `result-card-enter` with `animation-delay` instead of
 * Framer Motion per-card stagger. CSS opacity animations are always GPU-composited
 * and never trigger layout recalculation.
 */
import React from 'react';
import {
  Sparkles, Briefcase, Building, MapPin, Globe, ArrowRight,
} from 'lucide-react';
import type { SemanticMatch } from '../../types';
import { CARD, TAG_PILL } from '../../lib/styles';
import { cn } from '../../lib/utils';
import { fallbackAvatarUrl } from '../../lib/avatar';

// =============================================================================
// ResultCard
// =============================================================================

interface ResultCardProps {
  match: SemanticMatch;
  index: number;
  isFallback: boolean;
  onClick: () => void;
}

export const ResultCard = ({
  match,
  index,
  isFallback,
  onClick,
}: ResultCardProps) => (
  <div
    className="result-card-enter"
    style={{ animationDelay: `${index * 45}ms` }}
  >
    <button
      onClick={onClick}
      className={cn(
        CARD,
        'w-full text-left flex items-start gap-4 group',
        'hover:shadow-md hover:scale-[1.005] transition-[shadow,transform] duration-200 cursor-pointer',
        'hover:ring-2 hover:ring-primary/20',
      )}
    >
      <img
        src={match.avatarUrl || fallbackAvatarUrl(match.name)}
        alt=""
        loading="lazy"
        className="w-12 h-12 rounded-full bg-surface-container-high object-cover shrink-0 mt-0.5"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {/* Name + fallback badge */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-on-surface truncate">{match.name}</span>
          {isFallback && (
            <span className="text-[9px] font-bold uppercase tracking-widest bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded shrink-0">
              Keyword
            </span>
          )}
        </div>

        {/* Role / Company / Location / Industry */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-on-surface-variant">
          {match.role && (
            <span className="flex items-center gap-1">
              <Briefcase className="w-3 h-3" />{match.role}
            </span>
          )}
          {match.company && (
            <span className="flex items-center gap-1">
              <Building className="w-3 h-3" />{match.company}
            </span>
          )}
          {match.location && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />{match.location}
            </span>
          )}
          {match.industry && (
            <span className="flex items-center gap-1">
              <Globe className="w-3 h-3" />{match.industry}
            </span>
          )}
        </div>

        {/* AI Reason — plain render, no nested motion element */}
        {match.aiReason && (
          <div className="flex items-start gap-1.5 mt-1">
            <Sparkles className="w-3.5 h-3.5 text-primary/60 shrink-0 mt-0.5" />
            <span className="text-sm text-primary/80 italic leading-snug">{match.aiReason}</span>
          </div>
        )}

        {/* Tags */}
        {match.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {match.tags.slice(0, 5).map(t => (
              <span key={t.id} className={TAG_PILL}>{t.tag}</span>
            ))}
            {match.tags.length > 5 && (
              <span className="text-[10px] text-on-surface-variant opacity-50">+{match.tags.length - 5}</span>
            )}
          </div>
        )}
      </div>

      {/* Arrow */}
      <ArrowRight className="w-4 h-4 text-on-surface-variant opacity-0 group-hover:opacity-60 transition-opacity shrink-0 mt-2" />
    </button>
  </div>
);

// =============================================================================
// ShimmerCard — Loading skeleton for search results
// =============================================================================

interface ShimmerCardProps {
  delay?: number;
}

export const ShimmerCard = ({ delay = 0 }: ShimmerCardProps) => (
  <div
    className={cn(CARD, 'flex items-start gap-4 result-card-enter')}
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
