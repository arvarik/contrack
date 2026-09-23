/**
 * ContactMetaBadges — Inline metadata badges for search result cards.
 *
 * Renders up to 2 lightweight data points on any search result card:
 *   1. Relationship score dot — after the contact name, in its band's tone
 *   2. "Last contact" time distance — below role/company
 *
 * The avatar wears no freshness ring any more: a coloured ring around an
 * avatar is the relationship's health everywhere else in the app.
 *
 * Designed to be composable: each badge renders only if its data is non-null.
 * Zero API calls — uses data already present in the search result payload.
 *
 * @module src/components/command-palette/ContactMetaBadges
 */
import React from "react";
import { formatDistanceToNow } from "date-fns";
import { Clock, RefreshCw } from "lucide-react";
import { CorvidThinking } from "../brand/CorvidThinking";
import { TONE_DOT, TONE_WASH } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { describeScore, scoreView } from "../../../shared/scoreBand";

// ─── Score Dot ───────────────────────────────────────────────────────────────

interface ScoreDotProps {
  /**
   * The contact the dot stands for. `scoreView` reads the three fields and
   * decides whether there is a score at all, so the palette and the ring
   * can never disagree.
   */
  contact: {
    isTracked: boolean;
    relationshipScore?: number | null;
    lastContactedAt?: string | null;
  };
}

/**
 * A 6 px coloured circle after the contact's name, for the band.
 *
 * The dot shows for a tracked contact with a score. It is absent for a
 * contact nobody tracks and for one with nothing logged yet, so a fresh
 * import of hundreds of people shows no wall of red. It takes its band's
 * tone (`SCORE_BANDS` in shared/scoreBand), the token the avatar ring
 * strokes with, so the palette and the ring agree on the colour as well as
 * the cut points.
 */
export const ScoreDot = ({ contact }: ScoreDotProps) => {
  const view = scoreView(contact);
  if (view.kind !== "scored" || view.score === 0) return null;

  return (
    <span
      title={describeScore(view.score)}
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[view.band.token]}`}
    />
  );
};

// ─── Last Contact Line ───────────────────────────────────────────────────────

interface LastContactLineProps {
  lastContactedAt: string | null | undefined;
}

/**
 * Compact "last contact" indicator rendered below the role/company line.
 * Shows relative time ("3 weeks ago") when there IS contact history.
 *
 * Returns null for never-contacted contacts — avoids a wall of alarming
 * "Never contacted" labels when users import hundreds of contacts at once.
 */
export const LastContactLine = ({ lastContactedAt }: LastContactLineProps) => {
  if (!lastContactedAt) return null;

  let text: string;
  let isStale = false;

  try {
    const distance = formatDistanceToNow(new Date(lastContactedAt), {
      addSuffix: true,
    });
    text = distance;
    // Consider > 60 days as stale for visual emphasis
    const daysSince =
      (Date.now() - new Date(lastContactedAt).getTime()) /
      (1000 * 60 * 60 * 24);
    isStale = daysSince > 60;
  } catch {
    text = "Unknown";
  }

  return (
    <span
      className={`text-[11px] flex items-center gap-1 ${isStale ? "text-error" : "text-on-surface-variant"}`}
    >
      <Clock className="w-2.5 h-2.5 shrink-0" />
      {text}
    </span>
  );
};

// ─── Stale Data Chip ─────────────────────────────────────────────────────────

interface StaleChipProps {
  contactId: string;
  updatedAt: string | null | undefined;
  /** From useGroundingCapacity() — whether refresh is possible */
  hasGroundingCapacity: boolean;
  /** From useEnrichContact().isPending */
  isEnriching: boolean;
  /** Contact ID currently being enriched (to target loading state) */
  enrichingContactId: string | null;
  /** Callback to trigger enrichment */
  onRefresh?: (contactId: string) => void;
}

/**
 * Inline chip showing data staleness with a refresh action.
 * Only renders when data is > 6 months old.
 * The ⟳ button triggers single-contact AI enrichment via TwoPassStrategy.
 */
export const StaleChip = ({
  contactId,
  updatedAt,
  hasGroundingCapacity,
  isEnriching,
  enrichingContactId,
  onRefresh,
}: StaleChipProps) => {
  if (!updatedAt) return null;

  const ms = Date.now() - new Date(updatedAt).getTime();
  const months = Math.floor(ms / (1000 * 60 * 60 * 24 * 30));
  if (months < 6) return null;

  const isThisEnriching = isEnriching && enrichingContactId === contactId;
  const ageLabel =
    months >= 12 ? `${Math.floor(months / 12)}y old` : `${months}mo old`;

  const disabled = !hasGroundingCapacity || isEnriching;
  const tooltip = isThisEnriching
    ? "Refreshing…"
    : !hasGroundingCapacity
      ? "Grounding quota exhausted for today"
      : `Refresh data for this contact`;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger the result's onSelect
    e.preventDefault();
    if (!disabled && onRefresh) {
      onRefresh(contactId);
    }
  };

  return (
    <span
      className={cn(
        TONE_WASH.warning,
        "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md font-medium",
      )}
    >
      {ageLabel}
      {onRefresh && (
        <button
          type="button"
          title={tooltip}
          onClick={handleClick}
          disabled={disabled}
          className={cn(
            "hit-area state-layer inline-flex items-center justify-center w-4 h-4 rounded transition-colors",
            disabled
              ? "text-on-surface-variant/30 cursor-not-allowed"
              : "text-warning cursor-pointer",
          )}
        >
          {/*
            The bird thinks while this contact refreshes. Decorative, because
            the button's own title already says "Refreshing…". The icon box
            grew from 14 to 16 px so the glyph still reads as a bird; the tap
            box is unchanged at 44 px, from `hit-area`.
          */}
          {isThisEnriching ? (
            <CorvidThinking decorative size={16} />
          ) : (
            <RefreshCw className="w-2.5 h-2.5" />
          )}
        </button>
      )}
    </span>
  );
};
