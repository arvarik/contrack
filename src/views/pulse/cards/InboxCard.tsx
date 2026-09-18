import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  Inbox,
  CheckCircle2,
  Copy,
  Ghost,
  Clock,
  Building,
  MapPin,
  Mail,
  UserCheck,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { CardFrame } from "../components/CardFrame";
import { fallbackAvatarUrl } from "../../../lib/avatar";

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
}

export const InboxCard = ({
  pendingDuplicates = 0,
  ghosts = [],
  hygiene,
  correspondents = 0,
}: InboxCardProps) => {
  const [ghostsExpanded, setGhostsExpanded] = useState(false);

  const missingCompany = hygiene?.missingCompany ?? 0;
  const missingLocation = hygiene?.missingLocation ?? 0;
  const missingEmail = hygiene?.missingEmail ?? 0;
  const stale = hygiene?.stale ?? 0;
  const ghostCount = ghosts.length;

  const totalItems =
    pendingDuplicates +
    ghostCount +
    missingCompany +
    missingLocation +
    missingEmail +
    stale +
    correspondents;

  const isZero = totalItems === 0;

  return (
    <CardFrame cardId="inbox" title="Inbox" icon={Inbox} count={totalItems}>
      {isZero ? (
        <div className="flex items-center gap-3 py-4 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <div className="text-xs sm:text-sm font-semibold">
            Inbox zero. Nothing to clean up.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Review Duplicates */}
          {pendingDuplicates > 0 && (
            <Link
              to="/pulse/duplicates"
              className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container-lowest hover:bg-surface-container border border-outline/10 transition-colors group text-xs"
            >
              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                <Copy className="w-4 h-4 text-primary shrink-0 opacity-80" />
                <span className="font-medium text-on-surface group-hover:text-primary transition-colors truncate">
                  Review {pendingDuplicates} possible{" "}
                  {pendingDuplicates === 1 ? "duplicate" : "duplicates"}
                </span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-on-surface-variant group-hover:text-primary shrink-0 transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}

          {/* Stale data */}
          {stale > 0 && (
            <Link
              to="/?q=updated:>6m"
              className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container-lowest hover:bg-surface-container border border-outline/10 transition-colors group text-xs"
            >
              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 opacity-80" />
                <span className="font-medium text-on-surface group-hover:text-primary transition-colors truncate">
                  {stale} {stale === 1 ? "contact has" : "contacts have"} stale
                  data
                </span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-on-surface-variant group-hover:text-primary shrink-0 transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}

          {/* Ghosts */}
          {ghostCount > 0 && (
            <div className="rounded-xl bg-surface-container-lowest border border-outline/10 p-2.5 text-xs">
              <button
                type="button"
                onClick={() => setGhostsExpanded(!ghostsExpanded)}
                className="w-full flex items-center justify-between cursor-pointer group text-left"
              >
                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                  <Ghost className="w-4 h-4 text-on-surface-variant shrink-0" />
                  <span className="font-medium text-on-surface group-hover:text-primary transition-colors truncate">
                    {ghostCount} {ghostCount === 1 ? "person is" : "people are"}{" "}
                    mentioned but not in your network
                  </span>
                </div>
                {ghostsExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5 text-on-surface-variant shrink-0" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-on-surface-variant shrink-0" />
                )}
              </button>

              {ghostsExpanded && (
                <div className="mt-2.5 pt-2 border-t border-outline/10 flex flex-wrap gap-1.5">
                  {ghosts.slice(0, 8).map((g) => (
                    <Link
                      key={g.id}
                      to={`/contact/${g.id}`}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-surface-container hover:bg-surface-container-high text-[11px] font-medium text-on-surface transition-colors"
                    >
                      <img
                        src={g.avatarUrl || fallbackAvatarUrl(g.name)}
                        alt={g.name}
                        className="w-3.5 h-3.5 rounded-full object-cover"
                      />
                      <span>{g.name}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Missing company */}
          {missingCompany > 0 && (
            <Link
              to="/?q=missing:company"
              className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container-lowest hover:bg-surface-container border border-outline/10 transition-colors group text-xs"
            >
              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                <Building className="w-4 h-4 text-on-surface-variant shrink-0 opacity-80" />
                <span className="font-medium text-on-surface group-hover:text-primary transition-colors truncate">
                  {missingCompany} without a company
                </span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-on-surface-variant group-hover:text-primary shrink-0 transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}

          {/* Missing location */}
          {missingLocation > 0 && (
            <Link
              to="/?q=missing:location"
              className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container-lowest hover:bg-surface-container border border-outline/10 transition-colors group text-xs"
            >
              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                <MapPin className="w-4 h-4 text-on-surface-variant shrink-0 opacity-80" />
                <span className="font-medium text-on-surface group-hover:text-primary transition-colors truncate">
                  {missingLocation} without a location
                </span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-on-surface-variant group-hover:text-primary shrink-0 transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}

          {/* Missing email */}
          {missingEmail > 0 && (
            <Link
              to="/?q=missing:email"
              className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container-lowest hover:bg-surface-container border border-outline/10 transition-colors group text-xs"
            >
              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                <Mail className="w-4 h-4 text-on-surface-variant shrink-0 opacity-80" />
                <span className="font-medium text-on-surface group-hover:text-primary transition-colors truncate">
                  {missingEmail} without an email
                </span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-on-surface-variant group-hover:text-primary shrink-0 transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}

          {/* Correspondents */}
          {correspondents > 0 && (
            <Link
              to="/settings/connectors/people"
              className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container-lowest hover:bg-surface-container border border-outline/10 transition-colors group text-xs"
            >
              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                <UserCheck className="w-4 h-4 text-primary shrink-0 opacity-80" />
                <span className="font-medium text-on-surface group-hover:text-primary transition-colors truncate">
                  {correspondents} people you talk to are not contacts
                </span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-on-surface-variant group-hover:text-primary shrink-0 transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>
      )}
    </CardFrame>
  );
};
