import React, { useMemo, useState } from "react";
import { Search, Users, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { Contact } from "../../../types";
import { useContacts } from "../../../api";
import { ContactMiniCard } from "./shared/ContactMiniCard";
import { SEARCH_INPUT } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { fallbackAvatarUrl } from "../../../lib/avatar";

// =============================================================================
// ContactPicker — Searchable multi-select contact selector
// =============================================================================

interface ContactPickerProps {
  selected: Contact[];
  onSelectionChange: (contacts: Contact[]) => void;
  maxSelection?: number;
}

export const ContactPicker = ({
  selected,
  onSelectionChange,
  maxSelection = 3,
}: ContactPickerProps) => {
  const { data: allContacts = [], isLoading } = useContacts();
  const [query, setQuery] = useState("");

  // Filter out ghosts and archived, then apply search
  const filteredContacts = useMemo(() => {
    const pool = allContacts.filter((c) => !c.isGhost && !c.isArchived);
    if (!query.trim()) return pool;
    const q = query.toLowerCase().trim();
    return pool.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q) ||
        c.role?.toLowerCase().includes(q) ||
        c.emails?.some((e) => e.email.toLowerCase().includes(q)) ||
        c.phones?.some((p) => p.phone.includes(q)),
    );
  }, [allContacts, query]);

  const selectedIds = useMemo(
    () => new Set(selected.map((c) => c.id)),
    [selected],
  );
  const atMax = selected.length >= maxSelection;

  const toggleContact = (contact: Contact) => {
    if (selectedIds.has(contact.id)) {
      onSelectionChange(selected.filter((c) => c.id !== contact.id));
    } else if (!atMax) {
      onSelectionChange([...selected, contact]);
    }
  };

  const removeContact = (id: string) => {
    onSelectionChange(selected.filter((c) => c.id !== id));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Selected chips */}
      <AnimatePresence mode="popLayout">
        {selected.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex flex-wrap gap-2 mb-4 overflow-hidden"
          >
            {selected.map((c) => (
              <motion.div
                key={c.id}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                layout
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-full"
              >
                <img
                  src={c.avatarUrl || fallbackAvatarUrl(c.name)}
                  alt={c.name}
                  className="w-5 h-5 rounded-full object-cover"
                />
                <span className="text-xs font-bold text-primary">{c.name}</span>
                <button
                  onClick={() => removeContact(c.id)}
                  className="p-0.5 rounded-full hover:bg-primary/20 transition-colors"
                >
                  <X className="w-3 h-3 text-primary" />
                </button>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
        <input
          aria-label="Search contacts to merge"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search contacts by name, email, company..."
          className={cn(SEARCH_INPUT)}
          // Search field in a picker the user just opened.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-surface-container-high transition-colors"
          >
            <X className="w-3.5 h-3.5 text-on-surface-variant" />
          </button>
        )}
      </div>

      {/* Selection status */}
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          {filteredContacts.length} contacts
        </span>
        <span
          className={cn(
            "text-[10px] font-bold uppercase tracking-widest",
            atMax ? "text-warning" : "text-on-surface-variant",
          )}
        >
          {selected.length} / {maxSelection} selected
        </span>
      </div>

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto space-y-1 -mx-1 px-1 nice-scrollbar">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-on-surface-variant">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="text-center py-12 text-on-surface-variant text-sm">
            {query ? "No contacts match your search" : "No contacts available"}
          </div>
        ) : (
          filteredContacts.map((contact) => (
            <ContactMiniCard
              key={contact.id}
              contact={contact}
              selected={selectedIds.has(contact.id)}
              onToggle={() => toggleContact(contact)}
              disabled={atMax}
            />
          ))
        )}
      </div>
    </div>
  );
};
