/**
 * One row in the contact list. It prefetches what the contact page reads, so
 * the page draws from the cache when it opens.
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
import { type Contact } from "../../types";
import { DENSITY_METRICS, type ListDensity } from "../../hooks/useListDensity";
import { ROVING_INDEX_ATTR, type RovingItemProps } from "./useRovingList";
import { PROXIMITY_ROW_ATTR } from "../../hooks/useProximityLift";
import { describeFollowUp } from "../../lib/followUp";
import { MapPin } from "lucide-react";

import { formatDistanceToNowStrict } from "date-fns";

/** "3mo", "5d" or "—": a recency stamp short enough for a list column. */
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

import { contactQuery } from "../../api/contactCache";
import { canSlide, isPlainClick, useSlideNavigate } from "../settings/slide";
import { timelineQuery } from "../../api/interactions";
import { suggestionQuery } from "../../api/suggestions";
import { keepLoadedImage } from "../../lib/keptImages";

interface ContactListItemProps {
  contact: Contact;
  idPrefix?: string;
  density: ListDensity;
  active: boolean;
  isSelectMode: boolean;
  isSelected: boolean;
  /**
   * False on a Recent copy of a person the list also shows, so one contact
   * takes the selected tint in one place. It keeps `aria-current` and its
   * checkbox.
   */
  showSelection?: boolean;
  /** `extend` is true for a shift-click: select the range, don't toggle. */
  onToggleSelect: (id: string, extend: boolean) => void;
  /**
   * The row's place in the roving Tab order (useRovingList). Separate props,
   * not one object, so the memo still skips rows whose Tab stop did not move.
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

  // Prefetch the contact, its timeline and its duplicate banner. A pointer
  // that rests 100 ms starts it, and a press starts it at once, since a tap
  // ends before the timer. Each query's stale time stops a second fetch.
  const prefetch = useCallback(() => {
    if (isSelectMode || active) return;
    void queryClient.prefetchQuery(contactQuery(contact.id));
    void queryClient.prefetchQuery(timelineQuery(contact.id));
    void queryClient.prefetchQuery(suggestionQuery(contact.id));
  }, [contact.id, isSelectMode, active, queryClient]);

  const handlePointerEnter = useCallback(() => {
    if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
    prefetchTimer.current = setTimeout(prefetch, 100);
  }, [prefetch]);

  const handlePointerLeave = useCallback(() => {
    if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
  }, []);

  const slide = useSlideNavigate();
  const to = isSelectMode ? "#" : `/contact/${contact.id}${location.search}`;
  const handleClick = (e: React.MouseEvent) => {
    if (isSelectMode) {
      e.preventDefault();
      onToggleSelect(contact.id, e.shiftKey);
      return;
    }
    // Below `lg` the contact slides in over the list.
    if (isPlainClick(e) && canSlide()) {
      e.preventDefault();
      slide(to, "forward");
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

  // The row's name says the score and the follow-up in words, so color is
  // never the only sign: "Name, Company, score 72, strong, follow-up 3 days
  // overdue". An untracked contact has no score words.
  const view = scoreView(contact);
  const rowName = [
    contact.name,
    contact.company || contact.role,
    scoreWords(view, { sentence: true }),
    followUp && followUp.text.charAt(0).toLowerCase() + followUp.text.slice(1),
  ]
    .filter(Boolean)
    .join(", ");
  // Its words are in the row's name and the wrapper's tooltip.
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
      // A checkbox in select mode, so a screen reader hears its state.
      role={isSelectMode ? "checkbox" : undefined}
      aria-checked={isSelectMode ? isSelected : undefined}
      to={to}
      onClick={handleClick}
      tabIndex={tabIndex}
      {...(rovingIndex !== undefined && { [ROVING_INDEX_ATTR]: rovingIndex })}
      {...{ [PROXIMITY_ROW_ATTR]: "" }}
      onKeyDown={onRowKeyDown}
      onFocus={onRowFocus}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerDown={prefetch}
      className={cn(
        listRow(selected),
        // `translate` for `useProximityLift`.
        "proximity-row transition-[translate,color,background-color]",
        compact && "gap-2.5 p-2",
        isSelectMode && "cursor-pointer select-none",
      )}
    >
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

      {/* The row's name says the score, so the ring is hidden from a screen
          reader. The tooltip is for a pointer. */}
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
            {/* Not a heading: no fixed level fits both layouts, and a heading
                per row is many to skip. The link's name already says it. */}
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
          {/* Between 768 and 1023 px the glyph moves to its own slot in the
              right column, so it does not shift with the city's width. */}
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
              "text-xs text-on-surface-variant font-medium flex items-center gap-1.5",
              compact ? "mt-0" : "mt-0.5",
            )}
          >
            {logoUrl && !imgError ? (
              <img
                src={logoUrl}
                alt={`${contact.company} logo`}
                onLoad={keepLoadedImage}
                onError={handleLogoError}
                className="w-4 h-4 shrink-0 rounded-full object-scale-down bg-transparent"
              />
            ) : (
              <Building className="w-3.5 h-3.5 shrink-0 opacity-60" />
            )}
            {/* `truncate` on a flex line clips with no ellipsis. */}
            <span className="truncate">{contact.company}</span>
          </p>
        ) : contact.role ? (
          <p
            className={cn(
              "text-xs text-on-surface-variant flex items-center gap-1.5",
              compact ? "mt-0" : "mt-0.5",
            )}
          >
            <Briefcase className="w-3.5 h-3.5 shrink-0 opacity-60" />
            <span className="truncate">{contact.role}</span>
          </p>
        ) : null}
      </div>

      {/* Tablet-only column: only between 768 and 1023 px is the row wide
          enough. Recency gets it, as the signal a CRM is for. */}
      <div className="hidden md:flex lg:hidden items-center gap-5 shrink-0 pl-4 text-xs text-on-surface-variant">
        {contact.location && (
          <span className="flex items-center gap-1.5 max-w-[14rem] truncate">
            <MapPin className="w-3.5 h-3.5 shrink-0 opacity-60" />
            <span className="truncate">{contact.location}</span>
          </span>
        )}
        {/* A fixed-width slot, even when empty, so the columns line up. */}
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
