import { useDeferredValue, useMemo, useState } from "react";
import { Users, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { Contact } from "../../../types";
import { useContacts } from "../../../api";
import { ContactMiniCard } from "./shared/ContactMiniCard";
import { LABEL, SELECTED_TINT } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { fallbackAvatarUrl } from "../../../lib/avatar";
import { VirtualRows } from "../../../components/ui/VirtualRows";
import { roomAtTop } from "../utils/stickyRoom";
import { useRovingFocus } from "../../search/useRovingFocus";
import { SearchField } from "../../../components/ui/SearchField";

// A searchable multi-select of contacts. The list is virtualized
// (`VirtualRows`): 5,824 plain rows took 44 s to show. The search filters
// on a deferred query, so typing stays quick.
//
// The list is one Tab stop (`useRovingFocus`): ↓ in the search goes to the
// first contact. The search does not autofocus: the tab that shows it is
// chosen with arrows, and the box would take the next arrow.

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
  const deferredQuery = useDeferredValue(query);

  const filteredContacts = useMemo(() => {
    const pool = allContacts.filter((c) => !c.isGhost && !c.isArchived);
    if (!deferredQuery.trim()) return pool;
    const q = deferredQuery.toLowerCase().trim();
    return pool.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q) ||
        c.role?.toLowerCase().includes(q) ||
        c.emails?.some((e) => e.email.toLowerCase().includes(q)) ||
        c.phones?.some((p) => p.phone.includes(q)),
    );
  }, [allContacts, deferredQuery]);

  const selectedIds = useMemo(
    () => new Set(selected.map((c) => c.id)),
    [selected],
  );
  const atMax = selected.length >= maxSelection;
  const roving = useRovingFocus(filteredContacts.length);

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
    <div className="flex flex-col">
      {/* Sticks to the top of the page's one scroller, so the picks and the
          search stay in reach far down the list. */}
      <div ref={roomAtTop} className="sticky top-0 z-10 py-4 bg-surface">
        <AnimatePresence mode="popLayout">
          {selected.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              // Padding inside the animation's clip keeps the 44 px tap boxes.
              className="flex flex-wrap gap-2 -mx-2 -mt-2 mb-2 p-2 overflow-hidden"
            >
              {selected.map((c) => (
                <motion.div
                  key={c.id}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  layout
                  className={cn(
                    "inline-flex items-center gap-2 px-3 py-1.5 rounded-md",
                    SELECTED_TINT,
                  )}
                >
                  <img
                    src={c.avatarUrl || fallbackAvatarUrl(c.name)}
                    alt=""
                    className="w-5 h-5 rounded-full object-cover"
                  />
                  <span className="text-xs font-bold">{c.name}</span>
                  <button
                    onClick={() => removeContact(c.id)}
                    aria-label={`Remove ${c.name}`}
                    className="hit-area state-layer p-0.5 rounded-full"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <SearchField
          aria-label="Search contacts to merge"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown") return;
            e.preventDefault();
            roving.focusAt(0);
          }}
          placeholder="Search contacts by name, email, company…"
          onClear={() => setQuery("")}
        />
      </div>

      <div className="flex items-center justify-between mb-3 px-1">
        <span className={cn(LABEL, "flex items-center gap-1.5")}>
          <Users className="w-3.5 h-3.5" />
          {filteredContacts.length} contacts
        </span>
        <span className={cn(LABEL, atMax && "text-warning")}>
          {selected.length} / {maxSelection} selected
        </span>
      </div>

      {/* Full height, scrolled by the page: an inner scroller showed two
          rows at 900 px. */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-on-surface-variant">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : filteredContacts.length === 0 ? (
        <div className="text-center py-12 text-on-surface-variant text-sm">
          {query ? "No contacts match your search" : "No contacts available"}
        </div>
      ) : (
        <div ref={roving.listRef}>
          <VirtualRows
            items={filteredContacts}
            getKey={(contact) => contact.id}
            estimateSize={64}
            gap={4}
            renderRow={(contact, index) => (
              <ContactMiniCard
                contact={contact}
                selected={selectedIds.has(contact.id)}
                onToggle={() => toggleContact(contact)}
                disabled={atMax}
                itemProps={roving.itemProps(index)}
              />
            )}
          />
        </div>
      )}
    </div>
  );
};
