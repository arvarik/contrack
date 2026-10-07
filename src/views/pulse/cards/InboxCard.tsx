/**
 * What needs cleaning up, one row per job, each a link to where the job is
 * done. The first row, "6 new this month, 2 untracked", opens the list at
 * `added:<30d tracked:no`, the people it counts. Empty, the card is one line.
 */
import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  Building,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Ghost,
  Mail,
  MapPin,
  UserCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { CardFrame } from "../components/CardFrame";
import { fallbackAvatarUrl } from "../../../lib/avatar";
import { TONE_TEXT, TONE_WASH, type Tone } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { PULSE_ROW, PULSE_ROW_STATIC, PULSE_TYPE } from "../lib/pulseStyles";

interface InboxCardProps {
  pendingDuplicates?: number;
  ghosts?: Array<{
    id: string;
    name: string;
    avatarUrl?: string | null;
    company?: string | null;
  }>;
  hygiene?: {
    missingCompany: number;
    missingLocation: number;
    missingEmail: number;
    stale: number;
  };
  correspondents?: number;
  /** Contacts added in the last 30 days, and how many nobody tracks yet. */
  newPeople?: { total: number; untracked: number };
}

/** A count inside a row's sentence: the figure the row is about. */
const N = ({ children }: { children: React.ReactNode }) => (
  <span className="font-semibold text-on-surface tabular-nums">{children}</span>
);

/** A row's glyph in a tile of its tone. */
const RowIcon = ({ icon: Icon, tone }: { icon: LucideIcon; tone: Tone }) => (
  <span
    className={cn(
      "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
      TONE_WASH[tone],
    )}
    aria-hidden="true"
  >
    <Icon className="w-4 h-4" />
  </span>
);

/** One row, all one link. Its sentence wraps rather than truncates. */
const InboxRow = ({
  to,
  icon,
  tone = "neutral",
  children,
}: {
  to: string;
  icon: LucideIcon;
  tone?: Tone;
  children: React.ReactNode;
}) => (
  <li>
    <Link to={to} className={PULSE_ROW}>
      <RowIcon icon={icon} tone={tone} />
      <span className={cn(PULSE_TYPE.rowTitle, "min-w-0 flex-1 text-pretty")}>
        {children}
      </span>
      <ChevronRight
        className="w-4 h-4 shrink-0 text-on-surface-variant opacity-50 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      />
    </Link>
  </li>
);

export const InboxCard = ({
  pendingDuplicates = 0,
  ghosts = [],
  hygiene,
  correspondents = 0,
  newPeople,
}: InboxCardProps) => {
  const [ghostsExpanded, setGhostsExpanded] = useState(false);

  const missingCompany = hygiene?.missingCompany ?? 0;
  const missingLocation = hygiene?.missingLocation ?? 0;
  const missingEmail = hygiene?.missingEmail ?? 0;
  const stale = hygiene?.stale ?? 0;
  const ghostCount = ghosts.length;
  const untracked = newPeople?.untracked ?? 0;

  const totalItems =
    untracked +
    pendingDuplicates +
    ghostCount +
    missingCompany +
    missingLocation +
    missingEmail +
    stale +
    correspondents;

  if (totalItems === 0) {
    return (
      <CardFrame cardId="inbox" title="Inbox" count={0} variant="line">
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2
            className={cn("w-4 h-4 shrink-0", TONE_TEXT.success)}
            aria-hidden="true"
          />
          Nothing to clean up
        </span>
      </CardFrame>
    );
  }

  return (
    <CardFrame cardId="inbox" title="Inbox" count={totalItems}>
      <ul className="flex flex-col gap-1.5">
        {newPeople && untracked > 0 && (
          <InboxRow
            to={`/?q=${encodeURIComponent("added:<30d tracked:no")}`}
            icon={UserPlus}
            tone="success"
          >
            <N>{newPeople.total}</N> new this month, <N>{untracked}</N>{" "}
            untracked
          </InboxRow>
        )}

        {pendingDuplicates > 0 && (
          <InboxRow to="/pulse/duplicates" icon={Copy} tone="warning">
            Review <N>{pendingDuplicates}</N> possible{" "}
            {pendingDuplicates === 1 ? "duplicate" : "duplicates"}
          </InboxRow>
        )}

        {stale > 0 && (
          <InboxRow to="/?q=updated:>6m" icon={Clock}>
            <N>{stale}</N> {stale === 1 ? "contact has" : "contacts have"} stale
            data
          </InboxRow>
        )}

        {/* Ghosts expand in place: the names are the action. */}
        {ghostCount > 0 && (
          <li className="rounded-xl bg-surface-container-low/70">
            <button
              type="button"
              onClick={() => setGhostsExpanded((open) => !open)}
              aria-expanded={ghostsExpanded}
              aria-controls="ghosts-list"
              className={cn(
                // Closed, the row lifts like the others. Open, the item holds
                // the names too, so the button takes the state layer alone.
                ghostsExpanded
                  ? `state-layer group ${PULSE_ROW_STATIC}`
                  : PULSE_ROW,
                // The item carries the wash, so the open list sits on it too.
                "w-full text-left cursor-pointer bg-transparent",
              )}
            >
              <RowIcon icon={Ghost} tone="neutral" />
              <span
                className={cn(
                  PULSE_TYPE.rowTitle,
                  "min-w-0 flex-1 text-pretty",
                )}
              >
                <N>{ghostCount}</N>{" "}
                {ghostCount === 1 ? "person is" : "people are"} mentioned but
                not in your network
              </span>
              {ghostsExpanded ? (
                <ChevronUp
                  className="w-4 h-4 shrink-0 text-on-surface-variant"
                  aria-hidden="true"
                />
              ) : (
                <ChevronDown
                  className="w-4 h-4 shrink-0 text-on-surface-variant"
                  aria-hidden="true"
                />
              )}
            </button>

            {ghostsExpanded && (
              <div
                id="ghosts-list"
                className="flex flex-wrap gap-1.5 px-3 pb-3 pt-0.5"
              >
                {ghosts.slice(0, 8).map((g) => (
                  <Link
                    key={g.id}
                    to={`/contact/${g.id}`}
                    // A chip that opens a contact is a whole control: it lifts.
                    className="hit-area state-layer lift inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-container text-xs font-medium text-on-surface"
                  >
                    <img
                      src={g.avatarUrl || fallbackAvatarUrl(g.name)}
                      alt=""
                      className="w-4 h-4 rounded-full object-cover"
                    />
                    <span>{g.name}</span>
                  </Link>
                ))}
              </div>
            )}
          </li>
        )}

        {missingCompany > 0 && (
          <InboxRow to="/?q=missing:company" icon={Building}>
            <N>{missingCompany}</N> without a company
          </InboxRow>
        )}

        {missingLocation > 0 && (
          <InboxRow to="/?q=missing:location" icon={MapPin}>
            <N>{missingLocation}</N> without a location
          </InboxRow>
        )}

        {missingEmail > 0 && (
          <InboxRow to="/?q=missing:email" icon={Mail}>
            <N>{missingEmail}</N> without an email
          </InboxRow>
        )}

        {correspondents > 0 && (
          <InboxRow
            to="/settings/connectors/people"
            icon={UserCheck}
            tone="primary"
          >
            <N>{correspondents}</N> people you talk to are not contacts
          </InboxRow>
        )}
      </ul>
    </CardFrame>
  );
};
