/**
 * The badges on a search result: the score dot after the name, and the last
 * contact below the role. Each shows only when its data is there. No
 * freshness ring: a ring around an avatar means the relationship's health.
 */
import type { ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import { Clock } from "lucide-react";
import { TONE_DOT, TONE_WASH } from "../../lib/styles";
import { MATCH_BADGE } from "./utils";
import { cn } from "../../lib/utils";
import { describeScore, scoreView } from "../../../shared/scoreBand";

// Score Dot

interface ScoreDotProps {
  /** The contact. `scoreView` decides from it, as the ring does. */
  contact: {
    isTracked: boolean;
    relationshipScore?: number | null;
    lastContactedAt?: string | null;
  };
}

/**
 * A 6 px dot in the band's tone (`SCORE_BANDS`), for a tracked contact with
 * a score. None for an untracked contact or one with nothing logged, so a
 * fresh import shows no wall of red.
 */
const ScoreDot = ({ contact }: ScoreDotProps) => {
  const view = scoreView(contact);
  if (view.kind !== "scored" || view.score === 0) return null;

  return (
    <span
      title={describeScore(view.score)}
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[view.band.token]}`}
    />
  );
};

// Last Contact Line

interface LastContactLineProps {
  lastContactedAt: string | null | undefined;
}

/**
 * The last contact as a relative time ("3 weeks ago"). Nothing for a contact
 * never contacted, so a fresh import shows no wall of "Never contacted".
 */
const LastContactLine = ({ lastContactedAt }: LastContactLineProps) => {
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
      className={`shrink-0 text-[11px] flex items-center gap-1 ${isStale ? "text-error" : "text-on-surface-variant"}`}
    >
      <Clock className="w-2.5 h-2.5 shrink-0" />
      {text}
    </span>
  );
};

// Stale Data Chip

/**
 * "7mo old" after the name, for a contact not updated in six months. Text
 * only: an option holds no second control. Refresh is in the row's actions.
 */
const StaleChip = ({ updatedAt }: { updatedAt: string | null | undefined }) => {
  if (!updatedAt) return null;
  const months = Math.floor(
    (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24 * 30),
  );
  if (months < 6) return null;
  return (
    <span
      className={cn(
        TONE_WASH.warning,
        "shrink-0 text-[11px] px-1.5 py-0.5 rounded-md font-medium",
      )}
    >
      {months >= 12 ? `${Math.floor(months / 12)}y old` : `${months}mo old`}
    </span>
  );
};

// A person's row

/**
 * The two lines of a person's row: the name with its dot and badges, then
 * the role, the company and the last contact.
 */
export const ContactRowBody = ({
  contact,
  children,
}: {
  contact: {
    name: string;
    role?: string | null;
    company?: string | null;
    isTracked: boolean;
    relationshipScore?: number | null;
    lastContactedAt?: string | null;
    updatedAt?: string | null;
    approximate?: boolean;
  };
  /** A line under the two, such as AI's reason. */
  children?: ReactNode;
}) => {
  const work = [contact.role, contact.company].filter(Boolean).join(" · ");
  return (
    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-bold text-sm truncate">{contact.name}</span>
        <ScoreDot contact={contact} />
        {contact.approximate && (
          <span className={cn(TONE_WASH.primary, MATCH_BADGE)}>
            Approximate
          </span>
        )}
        <StaleChip updatedAt={contact.updatedAt} />
      </div>
      {(work || contact.lastContactedAt) && (
        <div className="flex items-center gap-2 min-w-0 text-xs text-on-surface-variant">
          {work && <span className="truncate">{work}</span>}
          <LastContactLine lastContactedAt={contact.lastContactedAt} />
        </div>
      )}
      {children}
    </div>
  );
};
