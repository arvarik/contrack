/**
 * InboxCard: what needs cleaning up, one row per job.
 *
 * Every row is a link to the place where the job is done: the duplicates
 * page, the list filtered to the people who miss a field, the connectors
 * page. The first row is the tracking action: "6 new this month, 2
 * untracked" opens the list at `tracked:no`, which is where a person decides
 * who to keep up with. It replaced the New people card, whose number was a
 * vanity count with a modal behind it.
 *
 * With nothing to do the card is one line, "Nothing to clean up.", because
 * nobody reads a framed box that says nothing.
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
import { cn } from "../../../lib/utils";
import { PULSE_ROW, PULSE_TYPE } from "../lib/pulseStyles";

export interface InboxCardProps {
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
  /**
   * The contacts added in the last 30 days, and how many of them nobody
   * tracks yet. Computed on the client from the slim rows.
   */
  newPeople?: { total: number; untracked: number };
}

/** A count inside a row's sentence: the figure the row is about. */
const N = ({ children }: { children: React.ReactNode }) => (
  <span className="font-semibold text-on-surface tabular-nums">{children}</span>
);

/**
 * One row: a glyph, a sentence that wraps rather than truncates, and a
 * chevron that says the row goes somewhere. The whole row is the link.
 */
const InboxRow = ({
  to,
  icon: Icon,
  tone = "text-on-surface-variant",
  children,
}: {
  to: string;
  icon: LucideIcon;
  tone?: string;
  children: React.ReactNode;
}) => (
  <li>
    <Link to={to} className={PULSE_ROW}>
      <Icon className={cn("w-4 h-4 shrink-0", tone)} aria-hidden="true" />
      <span className={cn(PULSE_TYPE.rowTitle, "min-w-0 flex-1 text-pretty")}>
        {children}
      </span>
      <ChevronRight
        className="w-4 h-4 shrink-0 text-on-surface-variant opacity-50 transition-all group-hover:opacity-100 group-hover:translate-x-0.5"
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
            className="w-4 h-4 text-success shrink-0"
            aria-hidden="true"
          />
          Nothing to clean up.
        </span>
      </CardFrame>
    );
  }

  return (
    <CardFrame cardId="inbox" title="Inbox" count={totalItems}>
      <ul className="flex flex-col gap-1.5">
        {/* The tracking action first: the new people nobody follows yet. */}
        {newPeople && untracked > 0 && (
          <InboxRow to="/?q=tracked:no" icon={UserPlus} tone="text-primary">
            <N>{newPeople.total}</N> new this month, <N>{untracked}</N>{" "}
            untracked
          </InboxRow>
        )}

        {pendingDuplicates > 0 && (
          <InboxRow to="/pulse/duplicates" icon={Copy}>
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
                PULSE_ROW,
                "w-full text-left cursor-pointer bg-transparent hover:bg-surface-container-low rounded-xl",
              )}
            >
              <Ghost
                className="w-4 h-4 shrink-0 text-on-surface-variant"
                aria-hidden="true"
              />
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
                    className="hit-area inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-container hover:bg-surface-container-high text-xs font-medium text-on-surface transition-colors"
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
          <InboxRow to="/settings/connectors/people" icon={UserCheck}>
            <N>{correspondents}</N> people you talk to are not contacts
          </InboxRow>
        )}
      </ul>
    </CardFrame>
  );
};
