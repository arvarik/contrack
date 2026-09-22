/**
 * MapHoverCard — Rich hover and pinned card for map contact pins.
 *
 * Requirements:
 * - Tooltip state on 150 ms hover and on focus with NO buttons (never traps focus).
 * - Pinned dialog state on click or Space with a heading and four IconButtons:
 *   1. Open (navigates to /map/contact/:id)
 *   2. Log note (QuickInteractionModal with initialContactId)
 *   3. Add to list (Add to list modal for this contact)
 *   4. Follow-up (Follow-up modal for this contact)
 * - ScoreRingAvatar 44 px
 * - Score chip (with ScoreBreakdown on click when pinned)
 * - Last contact ("Last contact 12 days ago" or "Never")
 * - Local time from timeZoneAt ("14:05 · GMT+1")
 * - Up to three tags with TAG_PILL
 * - Lists
 * - Escape closes and returns focus to the pin
 * - 300 px width, CARD_COMPACT tokens
 *
 * @module views/map/MapHoverCard
 */
import React, { useEffect, useRef, useMemo } from "react";
import { Popup } from "react-map-gl/maplibre";
import type { Map as MapLibreMap } from "maplibre-gl";
import { formatDistanceToNow } from "date-fns";
import {
  ExternalLink,
  PenLine,
  ListPlus,
  CalendarPlus,
  Clock,
  MapPin,
} from "lucide-react";
import type { MapContact } from "../../../shared/geo";
import { ScoreRingAvatar } from "../../components/ScoreRingAvatar";
import { ScoreBreakdown } from "../../components/ScoreBreakdown";
import { IconButton } from "../../components/ui/IconButton";
import { timeZoneAt } from "../../components/LocalTimeWeather";
import { TAG_PILL, TONE_WASH } from "../../lib/styles";
import { NOT_TRACKED_TEXT, scoreView } from "../../../shared/scoreBand";
import { cn } from "../../lib/utils";

/** Half the 48 px pin plus clearance so the card clears the ring. */
const PIN_CLEARANCE = 30;

export function formatCardLocalTime(
  lat: number | null | undefined,
  lng: number | null | undefined,
  now = new Date(),
): string | null {
  if (lat == null || lng == null) return null;
  const tz = timeZoneAt(lat, lng);
  if (!tz) return null;
  try {
    const timeStr = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);

    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(now);

    const offset = parts.find((p) => p.type === "timeZoneName")?.value || "";
    return `${timeStr} · ${offset}`;
  } catch {
    return null;
  }
}

export function formatLastContact(lastContactedAt?: string | null): string {
  if (!lastContactedAt) return "Never";
  try {
    return `Last contact ${formatDistanceToNow(new Date(lastContactedAt), { addSuffix: true })}`;
  } catch {
    return "Never";
  }
}

export interface MapHoverCardProps {
  contact: MapContact;
  pinned: boolean;
  onClose: () => void;
  onOpen?: (id: string) => void;
  onLogNote?: (id: string) => void;
  onAddToList?: (id: string) => void;
  onFollowUp?: (id: string) => void;
  map?: MapLibreMap | null;
}

export const MapHoverCard: React.FC<MapHoverCardProps> = ({
  contact,
  pinned,
  onClose,
  onOpen,
  onLogNote,
  onAddToList,
  onFollowUp,
  map,
}) => {
  const firstActionRef = useRef<HTMLButtonElement>(null);

  // Auto-focus first action button when entering pinned mode
  useEffect(() => {
    if (pinned) {
      firstActionRef.current?.focus();
    }
  }, [pinned]);

  // Escape key closes card and returns focus to pin button
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        const pinBtn = document.querySelector<HTMLButtonElement>(
          `button[data-contact-id="${contact.id}"]`,
        );
        pinBtn?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, contact.id]);

  const localTime = useMemo(
    () => formatCardLocalTime(contact.lat, contact.lng),
    [contact.lat, contact.lng],
  );

  const lastContactStr = useMemo(
    () => formatLastContact(contact.lastContactedAt),
    [contact.lastContactedAt],
  );

  const tags = (contact.tags || []).slice(0, 3);
  const lists = contact.lists || [];
  // The card used to print the stored column, so a contact nobody had met
  // showed "Score 50". It reads the same view as the ring now.
  const view = scoreView(contact);
  const score = view.kind === "scored" ? view.score : null;

  // The chip wears the band's tone. A contact with no score wears the neutral
  // one.
  const scoreChip = cn(
    "inline-flex items-center px-2 py-0.5 rounded-md font-bold text-[11px]",
    TONE_WASH[view.kind === "scored" ? view.band.token : "neutral"],
  );

  const anchor = useMemo(() => {
    if (!map) return undefined;
    try {
      const pt = map.project([contact.lng, contact.lat]);
      if (pt.y < 280) return "top";
    } catch {
      // ignore
    }
    return undefined;
  }, [map, contact.lng, contact.lat]);

  return (
    <Popup
      longitude={contact.lng}
      latitude={contact.lat}
      offset={PIN_CLEARANCE}
      anchor={anchor}
      closeButton={false}
      closeOnClick={false}
      focusAfterOpen={false}
      maxWidth="320px"
      className="contact-popup"
    >
      <div
        role={pinned ? "dialog" : "tooltip"}
        aria-label={pinned ? contact.name : undefined}
        id={`map-hover-card-${contact.id}`}
        className="w-[300px] bg-surface-container-lowest/98 backdrop-blur-md rounded-2xl p-4 shadow-xl border border-outline-variant/30 font-body space-y-3"
      >
        {/* Header: Avatar, Name, Role & Company */}
        <div className="flex items-start gap-3">
          <ScoreRingAvatar contact={contact} size={44} ring="list" decorative />
          <div className="min-w-0 flex-1">
            {pinned ? (
              <h2 className="text-sm font-extrabold text-on-surface truncate">
                <a
                  href={`/map/contact/${contact.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onOpen?.(contact.id);
                  }}
                  className="hover:underline"
                >
                  {contact.name}
                </a>
              </h2>
            ) : (
              <p className="text-sm font-extrabold text-on-surface truncate">
                {contact.name}
              </p>
            )}

            {(contact.role || contact.company) && (
              <p className="text-xs text-on-surface-variant truncate">
                {[contact.role, contact.company].filter(Boolean).join(" at ")}
              </p>
            )}

            {contact.location && (
              <p className="flex items-center gap-1 text-[11px] font-semibold text-primary truncate mt-0.5">
                <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span>{contact.location}</span>
              </p>
            )}
          </div>
        </div>

        {/* Facts row: Score chip, Last contact, Local time */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs border-t border-outline-variant/20">
          {view.kind === "untracked" && (
            <span className={scoreChip}>{NOT_TRACKED_TEXT}</span>
          )}
          {score !== null && (
            <div className="shrink-0">
              {pinned ? (
                <ScoreBreakdown contactId={contact.id} score={score}>
                  <span className={cn(scoreChip, "cursor-pointer hit-area")}>
                    Score {score}
                  </span>
                </ScoreBreakdown>
              ) : (
                <span className={scoreChip}>Score {score}</span>
              )}
            </div>
          )}

          <span className="text-on-surface-variant text-[11px]">
            {lastContactStr}
          </span>

          {localTime && (
            <span className="inline-flex items-center gap-1 text-[11px] text-on-surface-variant font-medium ml-auto">
              <Clock className="w-3 h-3 text-primary/70 shrink-0" />
              <span>{localTime}</span>
            </span>
          )}
        </div>

        {/* Tags & Lists */}
        {(tags.length > 0 || lists.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {tags.map((tag) => (
              <span key={tag} className={TAG_PILL}>
                {tag}
              </span>
            ))}
            {lists.map((l) => (
              <span
                key={l.id}
                className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-secondary/10 text-secondary"
                title={l.name}
              >
                {l.name}
              </span>
            ))}
          </div>
        )}

        {/* Action buttons — only rendered in pinned state */}
        {pinned && (
          <div className="flex items-center justify-between pt-2 border-t border-outline-variant/20">
            <IconButton
              ref={firstActionRef}
              aria-label="Open contact"
              title="Open contact details"
              onClick={() => onOpen?.(contact.id)}
              tone="subtle"
              size="sm"
            >
              <ExternalLink className="w-4 h-4" />
            </IconButton>
            <IconButton
              aria-label="Log interaction"
              title="Log interaction"
              onClick={() => onLogNote?.(contact.id)}
              tone="subtle"
              size="sm"
            >
              <PenLine className="w-4 h-4" />
            </IconButton>
            <IconButton
              aria-label="Add to list"
              title="Add to list"
              onClick={() => onAddToList?.(contact.id)}
              tone="subtle"
              size="sm"
            >
              <ListPlus className="w-4 h-4" />
            </IconButton>
            <IconButton
              aria-label="Add follow-up"
              title="Add follow-up task"
              onClick={() => onFollowUp?.(contact.id)}
              tone="subtle"
              size="sm"
            >
              <CalendarPlus className="w-4 h-4" />
            </IconButton>
          </div>
        )}
      </div>
    </Popup>
  );
};
