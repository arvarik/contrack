/**
 * ContactListItem — A single row in the contact list.
 *
 * Performance:
 * - Wrapped in React.memo with a structural comparator to prevent cascade
 *   rerenders when unrelated ContactList state (flashId, contextMenu, etc.) changes.
 * - Prefetches the contact detail query on pointer enter (100ms debounce) so
 *   by the time the user clicks, the detail pane loads instantly from cache.
 */
import React, { useState, useRef, useCallback } from "react";
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
import { HealthRingAvatar } from "../../components/HealthRingAvatar";
import { useCompanyLogo } from "../../hooks/useCompanyLogo";
import { listRow } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { Contact } from "../../types";
import { DENSITY_METRICS, type ListDensity } from "../../hooks/useListDensity";
import { MapPin } from "lucide-react";

import { isPast, isToday, formatDistanceToNowStrict } from "date-fns";

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

const API_BASE = "/api";

// ---------------------------------------------------------------------------
// ContactListItem — memoized row component
// ---------------------------------------------------------------------------

interface ContactListItemProps {
  contact: Contact;
  /** Comfortable keeps the roomy default; compact roughly doubles rows/screen. */
  density: ListDensity;
  active: boolean;
  isSelectMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}

const ContactListItemInner = ({
  contact,
  density,
  active,
  isSelectMode,
  isSelected,
  onToggleSelect,
}: ContactListItemProps) => {
  const primaryEmail = contact.emails?.[0]?.email || null;
  const logoInfo = useCompanyLogo(primaryEmail, contact.company);
  const logoUrl = logoInfo?.url;
  const [imgError, setImgError] = useState(false);
  const queryClient = useQueryClient();
  const location = useLocation();
  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Computed values ────────────────────────────────────────────────────────

  let urgentColor = "";
  if (contact.nextFollowUpAt) {
    const due = new Date(contact.nextFollowUpAt);
    if (isPast(due) || isToday(due)) {
      urgentColor = "text-error";
    } else {
      urgentColor = "text-primary opacity-80";
    }
  }

  // ── Hover prefetch ─────────────────────────────────────────────────────────
  // Prefetch the full contact detail after 100ms hover so clicking is instant.

  const handlePointerEnter = useCallback(() => {
    if (isSelectMode || active) return; // already loaded or irrelevant in select mode
    prefetchTimer.current = setTimeout(() => {
      queryClient.prefetchQuery({
        queryKey: ["contacts", contact.id],
        queryFn: () =>
          fetch(`${API_BASE}/contacts/${contact.id}`).then((r) => {
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
      onToggleSelect(contact.id);
    }
  };

  const handleLogoError = () => {
    setImgError(true);
  };

  const compact = density === "compact";
  const metrics = DENSITY_METRICS[density];

  return (
    <Link
      id={`contact-row-${contact.id}`}
      to={isSelectMode ? "#" : `/contact/${contact.id}${location.search}`}
      onClick={handleClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      className={cn(
        listRow(active && !isSelectMode),
        // Compact trims the padding, not the information: the same name and
        // company are shown, just in less vertical space.
        compact && "gap-2.5 p-2",
        isSelectMode && "cursor-pointer select-none",
        isSelectMode &&
          isSelected &&
          "bg-primary/8 outline-2 outline-primary -outline-offset-2",
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
                "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all",
                isSelected
                  ? "bg-primary border-primary"
                  : "border-on-surface-variant/40 bg-surface-container-low",
              )}
            >
              {isSelected && <CheckCheck className="w-3 h-3 text-white" />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <HealthRingAvatar contact={contact} size={metrics.avatarSize} />

      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-1.5 min-w-0">
            <h3
              className={`text-sm font-semibold truncate ${(active && !isSelectMode) || (isSelectMode && isSelected) ? "text-primary" : "text-on-surface"}`}
            >
              {contact.name}
            </h3>
            {contact.isGhost ? (
              <span title="Ghost Contact" className="shrink-0 flex">
                <Sparkles className="w-3.5 h-3.5 text-primary opacity-80" />
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 pl-2">
            {contact.nextFollowUpAt && (
              <CalendarClock className={cn("w-3.5 h-3.5", urgentColor)} />
            )}
          </div>
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
        <span
          className="w-14 text-right tabular-nums"
          title={
            contact.lastContactedAt
              ? `Last contacted ${new Date(contact.lastContactedAt).toLocaleDateString()}`
              : "No logged interactions yet"
          }
        >
          {shortRecency(contact.lastContactedAt)}
        </span>
      </div>
    </Link>
  );
};

/**
 * Custom memo comparator — only re-render when props that affect display change.
 * This prevents cascade rerenders when ContactList state (flashId, contextMenu,
 * drag state, etc.) changes without touching this contact's data.
 */
const areEqual = (
  prev: ContactListItemProps,
  next: ContactListItemProps,
): boolean => {
  return (
    prev.contact.id === next.contact.id &&
    prev.contact.updatedAt === next.contact.updatedAt &&
    prev.contact.name === next.contact.name &&
    prev.contact.company === next.contact.company &&
    prev.contact.avatarUrl === next.contact.avatarUrl &&
    prev.contact.nextFollowUpAt === next.contact.nextFollowUpAt &&
    prev.contact.relationshipScore === next.contact.relationshipScore &&
    // Rendered by the tablet-band metadata column.
    prev.contact.location === next.contact.location &&
    prev.contact.lastContactedAt === next.contact.lastContactedAt &&
    prev.contact.themeColor === next.contact.themeColor &&
    prev.contact.role === next.contact.role &&
    prev.contact.isGhost === next.contact.isGhost &&
    prev.density === next.density &&
    prev.active === next.active &&
    prev.isSelectMode === next.isSelectMode &&
    prev.isSelected === next.isSelected
  );
};

export const ContactListItem = React.memo(ContactListItemInner, areEqual);
