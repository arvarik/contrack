/**
 * AISearchContactList — Selectable contact list with status badges.
 *
 * Extracted from AISearchView for maintainability and testability.
 * Each row shows: checkbox, avatar, name/role, a status badge, and a link
 * that opens the contact. The link sits beside the row's toggle, not in it,
 * so the two are separate controls with their own names.
 *
 * Status badge logic:
 * - "No page" + date: the last research found no page about this person
 * - ✨ + date: previously searched (aiHydratedAt is non-null), the date
 *   short on a phone ("Jan 20", "Dec 2025")
 * - New: never searched (gray pill)
 * - 🔴 Error: last batch errored for this contact
 */
import React from "react";
import { Link } from "react-router-dom";
import {
  Sparkles,
  CheckCheck,
  AlertCircle,
  ChevronRight,
  SearchX,
} from "lucide-react";
import { ScoreRingAvatar } from "../../../components/ScoreRingAvatar";
import { scoreView, scoreWords } from "../../../../shared/scoreBand";
import { formatDay, formatShortDay } from "../../../lib/datetime";
import { SELECTED_ROW, TONE_WASH } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import type { Contact } from "../../../types";
import { activateOnKey } from "../../../lib/a11y";

// ---------------------------------------------------------------------------
// Contact Row
// ---------------------------------------------------------------------------

interface ContactRowProps {
  key?: React.Key;
  contact: Contact;
  isSelected: boolean;
  hasError: boolean;
  onToggle: () => void;
  /**
   * The link's state for the contact page, such as where its Back goes:
   * the Enrichment page hands its own filtered list.
   */
  openState?: unknown;
}

export function ContactRow({
  contact,
  isSelected,
  hasError,
  onToggle,
  openState,
}: ContactRowProps) {
  const words = scoreWords(scoreView(contact));
  return (
    // A checked row is a selected row: the tint, under both controls.
    <div
      className={cn(
        "flex items-center transition-colors",
        isSelected && SELECTED_ROW,
      )}
    >
      <div
        onKeyDown={activateOnKey(onToggle)}
        tabIndex={0}
        role="button"
        onClick={onToggle}
        // Tighter on a phone, where the name needs the width beside the
        // badge and the link.
        className="state-layer flex min-w-0 flex-1 items-center gap-3 py-3.5 pl-4 pr-1 cursor-pointer sm:gap-4 sm:pl-6 sm:pr-2"
      >
        {/* Checkbox */}
        <div
          className={cn(
            "w-5 h-5 rounded-md flex items-center justify-center transition-colors shrink-0",
            isSelected
              ? "bg-primary"
              : "bg-surface-container-low ring-1 ring-inset ring-on-surface-variant/20",
          )}
        >
          {isSelected && <CheckCheck className="w-3 h-3 text-on-primary" />}
        </div>

        {/* Avatar. The row is a button named by its text, and a named ring
          here would put the score before the person's name. So the ring is
          decorative, the tooltip sits on this wrapper, and the score words
          follow the name below. */}
        <div
          className="relative shrink-0"
          title={words ?? undefined}
          aria-hidden="true"
        >
          <ScoreRingAvatar contact={contact} size={40} ring="list" decorative />
        </div>

        {/* Info. The name and the line under it wrap: on a phone the row
            cut both to a few letters. */}
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm text-on-surface break-words block text-left">
            {contact.name}
          </span>
          {(contact.role || contact.company) && (
            <p className="text-xs text-on-surface-variant mt-0.5 break-words">
              {[contact.role, contact.company].filter(Boolean).join(" · ")}
            </p>
          )}
          {words && <span className="sr-only">{words}</span>}
        </div>

        {/* Status badge */}
        <StatusBadge contact={contact} hasError={hasError} />
      </div>
      {/* Opens the contact, for a detail that helps research find them. */}
      <Link
        to={`/contact/${contact.id}`}
        state={openState}
        aria-label={`Open ${contact.name}`}
        title={`Open ${contact.name}`}
        className="hit-area state-layer mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-full text-on-surface-variant sm:mr-3"
      >
        <ChevronRight aria-hidden="true" className="h-4 w-4" />
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

/** The badge at the end of a row, on its tone's wash. */
const BADGE = "text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0";

interface StatusBadgeProps {
  contact: Contact;
  hasError: boolean;
}

function StatusBadge({ contact, hasError }: StatusBadgeProps) {
  if (hasError) {
    return (
      <span className={cn(TONE_WASH.error, BADGE, "flex items-center gap-1")}>
        <AlertCircle className="w-3 h-3" />
        Error
      </span>
    );
  }

  // The last research searched and found no page about this person: the
  // "Found nothing" filter's rows, which want a detail more before a retry.
  if (contact.aiHydratedAt && contact.researchOutcome === "no-public-info") {
    return (
      <span className={cn(TONE_WASH.neutral, BADGE, "flex items-center gap-1")}>
        <SearchX className="w-3 h-3" />
        No page
        {/* The date, from `sm`: on a phone it would cut the name short. */}
        <span className="hidden sm:inline">
          {" "}
          · {formatDay(contact.aiHydratedAt)}
        </span>
      </span>
    );
  }

  if (contact.aiHydratedAt) {
    return (
      <span className={cn(TONE_WASH.primary, BADGE, "flex items-center gap-1")}>
        <Sparkles className="w-3 h-3" />
        {/* A phone gets the short date, so the role line keeps its width. */}
        <span className="sm:hidden">
          {formatShortDay(contact.aiHydratedAt)}
        </span>
        <span className="hidden sm:inline">
          {formatDay(contact.aiHydratedAt)}
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(TONE_WASH.neutral, BADGE, "uppercase tracking-[0.08em]")}
    >
      New
    </span>
  );
}
