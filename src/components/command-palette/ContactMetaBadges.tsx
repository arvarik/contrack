/**
 * ContactMetaBadges — Inline metadata badges for search result cards.
 *
 * Renders up to 3 lightweight data points on any search result card:
 *   1. Relationship score dot (🟢/🟡/🔴) — after the contact name
 *   2. "Last contact" time distance — below role/company
 *   3. Data age indicator — not rendered here (see DataAgeHalo)
 *
 * Designed to be composable: each badge renders only if its data is non-null.
 * Zero API calls — uses data already present in the search result payload.
 *
 * @module src/components/command-palette/ContactMetaBadges
 */
import React from "react";
import { formatDistanceToNow } from "date-fns";
import { Clock, RefreshCw } from "lucide-react";

// ─── Score Dot ───────────────────────────────────────────────────────────────

interface ScoreDotProps {
  score: number | null | undefined;
}

const scoreColor = (score: number): string => {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-rose-500";
};

const scoreLabel = (score: number): string => {
  if (score >= 70) return "Strong";
  if (score >= 40) return "Moderate";
  return "At risk";
};

/**
 * A 6px colored circle indicating relationship health.
 * Renders inline after the contact name.
 *
 * Hidden for contacts that have never been interacted with (score 0 or null)
 * to avoid alarming users on fresh imports with hundreds of uncontacted contacts.
 */
export const ScoreDot = ({ score }: ScoreDotProps) => {
  if (score == null || score === 0) return null;

  return (
    <span
      title={`Score: ${score} — ${scoreLabel(score)}`}
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${scoreColor(score)}`}
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
    const distance = formatDistanceToNow(new Date(lastContactedAt), { addSuffix: true });
    text = distance;
    // Consider > 60 days as stale for visual emphasis
    const daysSince = (Date.now() - new Date(lastContactedAt).getTime()) / (1000 * 60 * 60 * 24);
    isStale = daysSince > 60;
  } catch {
    text = "Unknown";
  }

  return (
    <span className={`text-[11px] flex items-center gap-1 ${isStale ? "text-rose-500/70" : "text-on-surface-variant/50"}`}>
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
  onRefresh: (contactId: string) => void;
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
  const ageLabel = months >= 12 ? `${Math.floor(months / 12)}y old` : `${months}mo old`;

  const disabled = !hasGroundingCapacity || isEnriching;
  const tooltip = isThisEnriching
    ? "Refreshing…"
    : !hasGroundingCapacity
    ? "Grounding quota exhausted for today"
    : `Refresh data for this contact`;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger the result's onSelect
    e.preventDefault();
    if (!disabled) {
      onRefresh(contactId);
    }
  };

  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-amber-600/80 bg-amber-500/10 px-1.5 py-0.5 rounded-md font-medium">
      {ageLabel}
      <button
        type="button"
        title={tooltip}
        onClick={handleClick}
        disabled={disabled}
        className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded transition-colors ${
          disabled
            ? "text-on-surface-variant/30 cursor-not-allowed"
            : "text-amber-600 hover:text-amber-700 hover:bg-amber-500/20 cursor-pointer"
        } ${isThisEnriching ? "animate-spin" : ""}`}
      >
        <RefreshCw className="w-2.5 h-2.5" />
      </button>
    </span>
  );
};
