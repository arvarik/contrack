import React, { useState } from "react";
import { cn } from "../../lib/utils";
import { CARD_COMPACT, SECTION_HEADING, TAG_PILL } from "../../lib/styles";
import { DashboardPayload } from "../../api";
import { Link } from "react-router-dom";
import { Ghost, HeartPulse, Sparkles, Clock } from "lucide-react";
import { FloatingContactCard } from "../../components/FloatingContactCard";
import { fallbackAvatarUrl } from "../../lib/avatar";
import { ScoreBreakdown } from "../../components/ScoreBreakdown";

interface NetworkHealthProps {
  payload: DashboardPayload;
  /** CSS entrance delay from `tileDelay(index)`. */
  delay?: string;
}

const Avatar = ({
  url,
  name,
  size = "w-10 h-10",
}: {
  url?: string | null;
  name: string;
  size?: string;
}) => {
  const src = url || fallbackAvatarUrl(name);
  return (
    <img
      src={src}
      alt={name}
      // Avatars are decorative-adjacent and always off-screen-cheap; decoding
      // async keeps a slow one from blocking the row it sits in.
      loading="lazy"
      decoding="async"
      className={cn(
        "rounded-full object-cover shadow-sm bg-surface-container-highest",
        size,
      )}
    />
  );
};

export const NetworkHealthPanel = ({ payload, delay }: NetworkHealthProps) => {
  const [floatingContactId, setFloatingContactId] = useState<string | null>(
    null,
  );

  return (
    <div
      style={{ animationDelay: delay }}
      className="tile-enter flex flex-col gap-6"
    >
      {/* GHOSTS */}
      {payload.ghosts.length > 0 && (
        <div
          className={cn(
            CARD_COMPACT,
            "bg-surface-container border-dashed border-2 border-surface-container-high",
          )}
        >
          <div className="flex items-center gap-2 mb-4">
            <Ghost className="w-4 h-4 text-on-surface-variant" />
            <span className={SECTION_HEADING}>Unlock Your Network</span>
            <span
              className={cn(
                TAG_PILL,
                "ml-auto bg-surface-container-high text-on-surface-variant",
              )}
            >
              {payload.ghosts.length} detected
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {payload.ghosts.slice(0, 5).map((g) => (
              <Link
                key={g.id}
                to={`/contact/${g.id}`}
                className="flex items-center gap-2 bg-surface-container-lowest pr-4 pl-1.5 py-1.5 rounded-full hover:bg-surface hover:ring-1 hover:ring-primary/20 transition-all group shadow-sm"
              >
                <Avatar
                  url={g.avatarUrl}
                  name={g.name}
                  size="w-6 h-6 text-[10px]"
                />
                <span className="text-xs font-bold text-on-surface group-hover:text-primary transition-colors">
                  {g.name}
                </span>
                {g.mentionCount > 1 && (
                  <span className="text-[9px] font-mono font-bold text-on-surface-variant opacity-60">
                    {g.mentionCount} mentions
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* AT RISK */}
      {payload.atRisk.length > 0 && (
        <div className={CARD_COMPACT}>
          <div className="flex items-center gap-2 mb-4">
            <HeartPulse className="w-4 h-4 text-error" />
            <span className={SECTION_HEADING}>Relationships to Rescue</span>
          </div>
          <div className="flex flex-col gap-2">
            {payload.atRisk.map((c) => (
              /*
                The score badge is a *sibling* of the row link, overlaid on the
                avatar, rather than a child of it. Two reasons, and the second
                is the one that matters: a button inside an anchor is invalid
                HTML that browsers resolve however they like, and a click on
                the badge would otherwise navigate away from the very contact
                whose score you asked about.
              */
              <div key={c.id} className="relative">
                <Link
                  to={`/contact/${c.id}`}
                  className="flex items-center gap-3 p-2 rounded-xl hover:bg-surface-container-low transition-colors group"
                >
                  <Avatar url={c.avatarUrl} name={c.name} size="w-9 h-9" />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-sm font-bold text-on-surface truncate group-hover:text-primary transition-colors">
                      {c.name}
                    </span>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-error opacity-80">
                      {c.daysSinceContact} days silent
                    </span>
                  </div>
                  <div className="shrink-0 p-2 bg-surface-container text-on-surface-variant rounded-lg group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                    <Sparkles className="w-4 h-4" />
                  </div>
                </Link>

                {/* Sits on the avatar's bottom-right: 8px row padding + 36px
                    avatar − half the 16px badge. */}
                <ScoreBreakdown
                  contactId={c.id}
                  score={Math.round(c.relationshipScore)}
                  className="absolute left-[34px] top-[34px]"
                >
                  <span className="w-4 h-4 bg-error rounded-full border-2 border-surface flex items-center justify-center">
                    <span className="text-[7px] font-bold text-white leading-none">
                      {Math.round(c.relationshipScore)}
                    </span>
                  </span>
                </ScoreBreakdown>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RECENTLY ADDED */}
      {payload.recentlyAdded.length > 0 && (
        <div className={CARD_COMPACT}>
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-on-surface-variant" />
            <span className={SECTION_HEADING}>Recently Added</span>
          </div>
          <div className="flex -space-x-3 overflow-hidden ml-1 py-1">
            {payload.recentlyAdded.map((c) => (
              <button
                key={c.id}
                onClick={() => setFloatingContactId(c.id)}
                title={c.name}
                aria-label={c.name}
                className="relative z-10 hover:z-20 transform hover:scale-110 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
              >
                <img
                  src={c.avatarUrl || fallbackAvatarUrl(c.name)}
                  alt={c.name}
                  loading="lazy"
                  decoding="async"
                  className="w-10 h-10 rounded-full border-2 border-surface-container-lowest object-cover shadow-sm bg-surface-container-highest"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      <FloatingContactCard
        contactId={floatingContactId}
        isOpen={!!floatingContactId}
        onClose={() => setFloatingContactId(null)}
        showNetworkButton
      />
    </div>
  );
};
