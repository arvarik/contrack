/**
 * ContactListItem — A single row in the contact list.
 *
 * Performance:
 * - Wrapped in React.memo with a structural comparator to prevent cascade
 *   rerenders when unrelated ContactList state (flashId, contextMenu, etc.) changes.
 * - Prefetches the contact detail query on pointer enter (100ms debounce) so
 *   by the time the user clicks, the detail pane loads instantly from cache.
 */
import React, { useState, useRef, useCallback, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  CheckCheck,
  Building,
  Briefcase,
  CalendarClock,
  Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { ScoreRingAvatar } from "../../components/ScoreRingAvatar";
import { scoreView, scoreWords } from "../../../shared/scoreBand";
import { useCompanyLogo } from "../../hooks/useCompanyLogo";
import { formatDay } from "../../lib/datetime";
import { listRow, TONE_TEXT } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { Contact } from "../../types";
import { DENSITY_METRICS, type ListDensity } from "../../hooks/useListDensity";
import { ROVING_INDEX_ATTR, type RovingItemProps } from "./useRovingList";
import { PROXIMITY_ROW_ATTR } from "../../hooks/useProximityLift";
import { describeFollowUp } from "../../lib/followUp";
import { MapPin } from "lucide-react";

import { formatDistanceToNowStrict } from "date-fns";

/**
 * "3mo" / "5d" / "—" — a recency stamp short enough to sit in a list row.
 *
 * `formatDistanceToNowStrict` gives "3 months"; the list has room for a
 * column, not a sentence.
 */
function shortRecency(iso: string | null | undefined): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  const words = formatDistanceToNowStrict(parsed).split(" ");
  const value = words[0];
  const unit = (words[1] ?? "").replace(/s$/, "");
  const abbrev: Record<string, string> = {
    second: "s",
    minute: "m",
    hour: "h",
    day: "d",
    week: "w",
    month: "mo",
    year: "y",
  };
  return `${value}${abbrev[unit] ?? ""}`;
}

import { apiFetch } from "../../api/client";

// ---------------------------------------------------------------------------
// ContactListItem — memoized row component
// ---------------------------------------------------------------------------

interface ContactListItemProps {
  contact: Contact;
  idPrefix?: string;
  /** Comfortable keeps the roomy default; compact roughly doubles rows/screen. */
  density: ListDensity;
  active: boolean;
  isSelectMode: boolean;
  isSelected: boolean;
  /**
   * False on the Recent strip when the same person is also a row in the list
   * under it: one contact looks selected in one place, so that copy takes no
   * tint. It keeps `aria-current` and its checkbox. A contact the list does
   * not show (a ghost, or one a filter leaves out) has only its Recent copy,
   * and that copy takes the tint.
   */
  showSelection?: boolean;
  /** `extend` is true for a shift-click: select the range, don't toggle. */
  onToggleSelect: (id: string, extend: boolean) => void;
  /**
   * The row's place in the list's roving Tab order (see useRovingList).
   * Passed as separate props rather than one object so the memo comparison
   * still skips rows whose Tab stop did not move.
   */
  rovingIndex?: number;
  tabIndex?: RovingItemProps["tabIndex"];
  onRowKeyDown?: RovingItemProps["onKeyDown"];
  onRowFocus?: RovingItemProps["onFocus"];
}

const ContactListItemInner = ({
  contact,
  idPrefix = "contact-row",
  density,
  active,
  isSelectMode,
  isSelected,
  showSelection = true,
  onToggleSelect,
  rovingIndex,
  tabIndex,
  onRowKeyDown,
  onRowFocus,
}: ContactListItemProps) => {
  const primaryEmail = contact.emails?.[0]?.email || null;
  const logoInfo = useCompanyLogo(primaryEmail, contact.company);
  const logoUrl = logoInfo?.url;
  const [imgError, setImgError] = useState(false);
  const queryClient = useQueryClient();
  const location = useLocation();
  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
    },
    [contact.id],
  );

  // ── Hover prefetch ─────────────────────────────────────────────────────────
  // Prefetch the full contact detail after 100ms hover so clicking is instant.

  const handlePointerEnter = useCallback(() => {
    if (isSelectMode || active) return; // already loaded or irrelevant in select mode
    if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
    prefetchTimer.current = setTimeout(() => {
      queryClient.prefetchQuery({
        queryKey: ["contacts", contact.id],
        queryFn: ({ signal }) =>
          apiFetch(`/contacts/${contact.id}`, { signal }).then((r) => {
            if (!r.ok) throw new Error("Failed to prefetch contact");
            return r.json();
          }),
        // Re-use the global staleTime so we don't over-fetch
        staleTime: 30_000,
      });
    }, 100);
  }, [contact.id, isSelectMode, active, queryClient]);

  const handlePointerLeave = useCallback(() => {
    if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
  }, []);

  // ── Click handler (select mode) ────────────────────────────────────────────

  const handleClick = (e: React.MouseEvent) => {
    if (isSelectMode) {
      e.preventDefault();
      onToggleSelect(contact.id, e.shiftKey);
    }
  };

  const handleLogoError = () => {
    setImgError(true);
  };

  const compact = density === "compact";
  const metrics = DENSITY_METRICS[density];
  const followUp = describeFollowUp(contact.nextFollowUpAt);
  // One selected look: the open contact, or a row picked in select mode.
  const selected = showSelection && (isSelectMode ? isSelected : active);

  // The row's name says the score in words, so the ring's colour is never the
  // only sign of it: "Betty Clark, Global Dynamics, score 72, strong". The
  // middle part is the line printed under the name, the company or else the
  // role, and it is left out when the row prints neither. A contact nobody
  // tracks has no ring and no score words: "Betty Clark, Global Dynamics".
  // The follow-up closes it, for the same reason the glyph's colour is not
  // enough: "…, follow-up 3 days overdue".
  const view = scoreView(contact);
  const rowName = [
    contact.name,
    contact.company || contact.role,
    scoreWords(view, { sentence: true }),
    followUp && followUp.text.charAt(0).toLowerCase() + followUp.text.slice(1),
  ]
    .filter(Boolean)
    .join(", ");
  // The calendar glyph, in the tone of how late the follow-up is. Its words
  // are the row's name and the tooltip of the box around it.
  const followUpGlyph = followUp && (
    <CalendarClock
      aria-hidden="true"
      className={cn("w-3.5 h-3.5", TONE_TEXT[followUp.tone])}
    />
  );

  return (
    <Link
      id={`${idPrefix}-${contact.id}`}
      aria-label={rowName}
      aria-current={active && !isSelectMode ? "page" : undefined}
      to={isSelectMode ? "#" : `/contact/${contact.id}${location.search}`}
      onClick={handleClick}
      tabIndex={tabIndex}
      {...(rovingIndex !== undefined && { [ROVING_INDEX_ATTR]: rovingIndex })}
      {...{ [PROXIMITY_ROW_ATTR]: "" }}
      onKeyDown={onRowKeyDown}
      onFocus={onRowFocus}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      className={cn(
        listRow(selected),
        // The row rises toward the pointer (`useProximityLift` on the
        // list), so its transition names `translate` with its colours.
        "proximity-row transition-[translate,color,background-color]",
        // Compact trims the padding, not the information: the same name and
        // company are shown, just in less vertical space.
        compact && "gap-2.5 p-2",
        isSelectMode && "cursor-pointer select-none",
      )}
    >
      {/* Checkbox overlay in select mode */}
      <AnimatePresence>
        {isSelectMode && (
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            className="shrink-0"
          >
            <div
              className={cn(
                "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors",
                isSelected
                  ? "bg-primary border-primary"
                  : "border-on-surface-variant/40 bg-surface-container-low",
              )}
            >
              {isSelected && <CheckCheck className="w-3 h-3 text-on-primary" />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The row's name already says the score, so the ring is decorative
          and a screen reader hears the score once. The tooltip stays on this
          wrapper for a pointer user, and aria-hidden keeps it out of the
          accessibility tree. */}
      <span
        className="shrink-0 flex"
        title={scoreWords(view) ?? undefined}
        aria-hidden="true"
      >
        <ScoreRingAvatar
          contact={contact}
          size={metrics.avatarSize}
          ring="list"
          decorative
        />
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-1.5 min-w-0">
            {/*
              Not a heading. The list sits under an h1 on the Network page and
              an h2 beside an open contact, so a fixed level was wrong on one
              of them, and a heading per row is thirty headings to skip past.
              The row is a link, and its name is already the link's name.
            */}
            <span
              className={cn(
                "block text-sm font-semibold truncate",
                selected ? "text-on-primary-wash" : "text-on-surface",
              )}
            >
              {contact.name}
            </span>
            {contact.isGhost ? (
              <span title="Ghost contact" className="shrink-0 flex">
                <Sparkles className="w-3.5 h-3.5 text-primary opacity-80" />
              </span>
            ) : null}
          </div>
          {/* The next follow-up in the tones of Pulse's due chips, and its
              words for a pointer: the glyph alone said nothing. Between 768
              and 1023 px it moves to its own slot in the column on the
              right, where it no longer shifts with the city's width. */}
          {followUp && (
            <span
              title={followUp.text}
              className="flex shrink-0 pl-2 md:hidden lg:flex"
            >
              {followUpGlyph}
            </span>
          )}
        </div>

        {contact.company ? (
          <p
            className={cn(
              "text-xs text-on-surface-variant truncate font-medium flex items-center gap-1.5",
              compact ? "mt-0" : "mt-0.5",
            )}
          >
            {logoUrl && !imgError ? (
              <img
                src={logoUrl}
                alt={`${contact.company} logo`}
                onError={handleLogoError}
                className="w-4 h-4 rounded-full object-scale-down bg-transparent"
              />
            ) : (
              <Building className="w-3.5 h-3.5 opacity-60" />
            )}
            {contact.company}
          </p>
        ) : contact.role ? (
          <p
            className={cn(
              "text-xs text-on-surface-variant truncate flex items-center gap-1.5",
              compact ? "mt-0" : "mt-0.5",
            )}
          >
            <Briefcase className="w-3.5 h-3.5 opacity-60" />
            {contact.role}
          </p>
        ) : null}
      </div>

      {/*
        Tablet-only metadata column.

        Between 768 and 1023 px the list is the whole content area — roughly a
        700 px row carrying a name and a company, with most of it empty. Above
        1023 px the list collapses to a 350 px column beside the detail pane
        and there is no room for this; below 768 px there is no room either.
        So it appears exactly in the band that has spare width, which is what
        `md:flex lg:hidden` says.

        Recency is the signal a relationship CRM is actually for, so it gets
        the column rather than, say, the role.
      */}
      <div className="hidden md:flex lg:hidden items-center gap-5 shrink-0 pl-4 text-xs text-on-surface-variant">
        {contact.location && (
          <span className="flex items-center gap-1.5 max-w-[14rem] truncate">
            <MapPin className="w-3.5 h-3.5 shrink-0 opacity-60" />
            <span className="truncate">{contact.location}</span>
          </span>
        )}
        {/* The follow-up's slot: the same width on every row, empty when
            there is none, so the glyphs and the recency line up. */}
        <span title={followUp?.text} className="flex w-3.5 shrink-0">
          {followUpGlyph}
        </span>
        <span
          className="w-14 text-right tabular-nums"
          title={
            contact.lastContactedAt
              ? `Last contacted ${formatDay(contact.lastContactedAt)}`
              : "No logged interactions yet"
          }
        >
          {shortRecency(contact.lastContactedAt)}
        </span>
      </div>
    </Link>
  );
};

// Query structural sharing keeps unchanged contact objects stable.
export const ContactListItem = React.memo(ContactListItemInner);
