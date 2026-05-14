/**
 * AISearchContactList — Selectable contact list with status badges.
 *
 * Extracted from AISearchView for maintainability and testability.
 * Each row shows: checkbox, avatar, name/role, and a status badge.
 *
 * Status badge logic:
 * - ✨ + date: previously searched (aiHydratedAt is non-null)
 * - NEW: never searched (gray pill)
 * - 🔴 Error: last batch errored for this contact
 */
import React from "react";
import { Sparkles, CheckCheck, AlertCircle } from "lucide-react";
import { HealthRingAvatar } from "../../../components/HealthRingAvatar";
import { cn } from "../../../lib/utils";
import type { Contact } from "../../../types";

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
  return (
    <div
      onClick={onToggle}
      className={cn(
        "flex items-center gap-4 px-6 py-3.5 cursor-pointer transition-colors group",
        isSelected && "bg-primary/8",
        !isSelected && "hover:bg-surface-container-low",
      )}
    >
      {/* Checkbox */}
      <div
        className={cn(
          "w-5 h-5 rounded-md flex items-center justify-center transition-all shrink-0",
          isSelected
            ? "bg-primary shadow-sm"
            : "bg-surface-container-low ring-1 ring-inset ring-on-surface-variant/20",
        )}
      >
        {isSelected && <CheckCheck className="w-3 h-3 text-white" />}
      </div>

      {/* Avatar */}
      <div className="relative shrink-0">
        <HealthRingAvatar contact={contact} size={40} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-sm text-on-surface group-hover:text-primary transition-colors truncate block text-left">
          {contact.name}
        </span>
        {(contact.role || contact.company) && (
          <p className="text-xs text-on-surface-variant mt-0.5 truncate">
            {[contact.role, contact.company].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {/* Status badge */}
      <StatusBadge contact={contact} hasError={hasError} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

interface StatusBadgeProps {
  contact: Contact;
  hasError: boolean;
}

export function StatusBadge({ contact, hasError }: StatusBadgeProps) {
  if (hasError) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-full shrink-0">
        <AlertCircle className="w-3 h-3" />
        Error
      </span>
    );
  }

  if (contact.aiHydratedAt) {
    const date = new Date(contact.aiHydratedAt);
    const label = date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
        <Sparkles className="w-3 h-3" />
        {label}
      </span>
    );
  }

  return (
    <span className="text-[10px] font-bold text-on-surface-variant bg-surface-container-low px-2 py-0.5 rounded-full shrink-0">
      NEW
    </span>
  );
}
