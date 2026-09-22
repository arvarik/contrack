/**
 * AISearchContactList — Selectable contact list with status badges.
 *
 * Extracted from AISearchView for maintainability and testability.
 * Each row shows: checkbox, avatar, name/role, and a status badge.
 *
 * Status badge logic:
 * - ✨ + date: previously searched (aiHydratedAt is non-null)
 * - New: never searched (gray pill)
 * - 🔴 Error: last batch errored for this contact
 */
import React from "react";
import { Sparkles, CheckCheck, AlertCircle } from "lucide-react";
import { ScoreRingAvatar } from "../../../components/ScoreRingAvatar";
import { scoreView, scoreWords } from "../../../../shared/scoreBand";
import { formatDay } from "../../../lib/datetime";
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
}

export function ContactRow({
  contact,
  isSelected,
  hasError,
  onToggle,
}: ContactRowProps) {
  const words = scoreWords(scoreView(contact));
  return (
    <div
      onKeyDown={activateOnKey(onToggle)}
      tabIndex={0}
      role="button"
      onClick={onToggle}
      // A checked row is a selected row: the tint and the bar.
      className={cn(
        "state-layer flex items-center gap-4 px-6 py-3.5 cursor-pointer transition-colors",
        isSelected && SELECTED_ROW,
      )}
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

      {/* Info */}
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-sm text-on-surface truncate block text-left">
          {contact.name}
        </span>
        {(contact.role || contact.company) && (
          <p className="text-xs text-on-surface-variant mt-0.5 truncate">
            {[contact.role, contact.company].filter(Boolean).join(" · ")}
          </p>
        )}
        {words && <span className="sr-only">{words}</span>}
      </div>

      {/* Status badge */}
      <StatusBadge contact={contact} hasError={hasError} />
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

export function StatusBadge({ contact, hasError }: StatusBadgeProps) {
  if (hasError) {
    return (
      <span className={cn(TONE_WASH.error, BADGE, "flex items-center gap-1")}>
        <AlertCircle className="w-3 h-3" />
        Error
      </span>
    );
  }

  if (contact.aiHydratedAt) {
    const label = formatDay(contact.aiHydratedAt);
    return (
      <span className={cn(TONE_WASH.primary, BADGE, "flex items-center gap-1")}>
        <Sparkles className="w-3 h-3" />
        {label}
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
