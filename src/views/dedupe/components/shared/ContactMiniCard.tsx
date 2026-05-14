import React from "react";
import type { Contact } from "../../../../types";
import { cn } from "../../../../lib/utils";
import { fallbackAvatarUrl } from "../../../../lib/avatar";

// =============================================================================
// ContactMiniCard — Compact contact card for the picker
// =============================================================================

export interface ContactMiniCardProps {
  key?: React.Key;
  contact: Contact;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export const ContactMiniCard = ({
  contact,
  selected,
  onToggle,
  disabled,
}: ContactMiniCardProps) => (
  <button
    onClick={onToggle}
    disabled={disabled && !selected}
    className={cn(
      "w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left",
      selected
        ? "bg-primary/8 ring-2 ring-primary"
        : disabled
          ? "opacity-40 cursor-not-allowed"
          : "hover:bg-surface-container-low",
    )}
  >
    <img
      src={contact.avatarUrl || fallbackAvatarUrl(contact.name)}
      alt={contact.name}
      className="w-10 h-10 rounded-full object-cover bg-surface-container-high shrink-0"
    />
    <div className="min-w-0 flex-1">
      <div className="text-sm font-bold truncate">{contact.name}</div>
      <div className="text-xs text-on-surface-variant truncate">
        {[contact.role, contact.company].filter(Boolean).join(" · ") ||
          [contact.emails?.[0]?.email, contact.phones?.[0]?.phone]
            .filter(Boolean)
            .join(" · ") ||
          "No details"}
      </div>
    </div>
    <div
      className={cn(
        "w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all",
        selected
          ? "border-primary bg-primary"
          : "border-surface-container-high",
      )}
    >
      {selected && (
        <svg
          className="w-3 h-3 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        </svg>
      )}
    </div>
  </button>
);
