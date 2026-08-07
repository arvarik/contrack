/**
 * AISearchView — Main AI Search settings sub-view.
 *
 * Displays a selectable list of non-archived contacts with status badges
 * (✨ previously searched, NEW never searched, 🔴 last search errored).
 * Users select contacts, then click "Start AI Search" to begin a batch.
 */
import React, { useState, useCallback, useMemo } from "react";
import { Sparkles, Search, User, Link, Mail } from "lucide-react";
import { useContacts } from "../../api";
import { useAISearch } from "../../contexts/AISearchContext";
import { ContactRow } from "./components/AISearchContactList";
import { AISearchConfirmModal } from "./components/AISearchConfirmModal";
import {
  CARD,
  SECTION_HEADING,
  SEARCH_INPUT,
  EMPTY_STATE,
} from "../../lib/styles";
import { cn } from "../../lib/utils";

type DataFilter = "all" | "has_links" | "has_email" | "no_data";

export function AISearchView() {
  const { data: contacts = [], isLoading } = useContacts();
  const { startSearch, isStarting, batch } = useAISearch();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [dataFilter, setDataFilter] = useState<DataFilter>("all");

  // Filter out archived and ghost contacts; apply search + data filter
  const filteredContacts = useMemo(() => {
    let list = contacts.filter((c) => !c.isArchived && !c.isGhost);

    // Data filter
    if (dataFilter === "has_links") {
      list = list.filter(
        (c) => (c.socialLinkCount ?? c.socialLinks?.length ?? 0) > 0,
      );
    } else if (dataFilter === "has_email") {
      list = list.filter((c) => c.emails && c.emails.length > 0);
    } else if (dataFilter === "no_data") {
      list = list.filter(
        (c) =>
          (!c.emails || c.emails.length === 0) &&
          (c.socialLinkCount ?? c.socialLinks?.length ?? 0) === 0,
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.company || "").toLowerCase().includes(q) ||
          (c.role || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [contacts, searchQuery, dataFilter]);

  // Track which contacts errored in the current/last batch
  const erroredContactIds = useMemo(() => {
    if (!batch) return new Set<string>();
    return new Set(
      batch.jobs.filter((j) => j.status === "error").map((j) => j.contactId),
    );
  }, [batch]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredContacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredContacts.map((c) => c.id)));
    }
  }, [selectedIds.size, filteredContacts]);

  const selectedContacts = useMemo(
    () => contacts.filter((c) => selectedIds.has(c.id)),
    [contacts, selectedIds],
  );

  const handleConfirmStart = () => {
    const ids = Array.from(selectedIds);
    startSearch(ids);
    setShowConfirm(false);
    setSelectedIds(new Set());
  };

  const FILTERS: { id: DataFilter; label: string; icon: React.ReactNode }[] = [
    { id: "all", label: "All", icon: <User className="w-3 h-3" /> },
    { id: "has_links", label: "Has Links", icon: <Link className="w-3 h-3" /> },
    { id: "has_email", label: "Has Email", icon: <Mail className="w-3 h-3" /> },
    { id: "no_data", label: "No Data", icon: <Search className="w-3 h-3" /> },
  ];

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4 pb-20">
      {/*
        No title block here. This view is only ever mounted inside the
        Settings shell, which already renders the icon and "Contact
        Enrichment" heading — repeating it stacked two near-identical headers
        on top of each other and pushed the actual content off a phone screen.
        Only the description that the shell does not carry survives.
      */}
      <p className="text-sm text-on-surface-variant">
        Research contacts on the live web and fill in the gaps in their
        profiles.
      </p>

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center p-8">
          <div className="animate-pulse w-6 h-6 rounded-full bg-primary/20" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading &&
        filteredContacts.length === 0 &&
        !searchQuery &&
        dataFilter === "all" && (
          <div className={cn(EMPTY_STATE, "flex flex-col items-center py-12")}>
            <Sparkles className="w-10 h-10 text-on-surface-variant/30 mb-4" />
            <p className="font-semibold text-sm">No contacts available</p>
            <p className="text-xs mt-1 text-on-surface-variant">
              Add contacts to your network to start using AI Search.
            </p>
          </div>
        )}

      {/* Contact list */}
      {!isLoading &&
        (filteredContacts.length > 0 ||
          searchQuery ||
          dataFilter !== "all") && (
          <>
            <div className={cn(CARD, "p-0 overflow-hidden")}>
              {/* Search bar + filters */}
              <div className="px-4 py-2.5 bg-surface-container-low space-y-2">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                  <input
                    aria-label="Filter contacts"
                    type="text"
                    placeholder="Filter contacts…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={SEARCH_INPUT}
                  />
                </div>

                {/* Data filter pills */}
                <div className="flex gap-1.5 flex-wrap">
                  {FILTERS.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        setDataFilter(f.id);
                        setSelectedIds(new Set());
                      }}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold transition-all",
                        dataFilter === f.id
                          ? "bg-primary text-on-primary shadow-sm"
                          : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
                      )}
                    >
                      {f.icon}
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Count + select all */}
              <div className="px-5 py-2 flex items-center justify-between bg-surface-container-lowest border-t border-surface-container">
                <span
                  className={cn(SECTION_HEADING, "flex items-center gap-2")}
                >
                  <User className="w-3.5 h-3.5" />
                  {filteredContacts.length} contact
                  {filteredContacts.length !== 1 ? "s" : ""}
                </span>
                <button
                  onClick={toggleSelectAll}
                  className="text-xs font-bold text-primary px-3 py-1 rounded-xl bg-primary/10 hover:bg-primary/15 transition-colors whitespace-nowrap"
                >
                  {selectedIds.size === filteredContacts.length &&
                  filteredContacts.length > 0
                    ? "Deselect All"
                    : "Select All"}
                </button>
              </div>

              {/* Contact rows — reduced max height to avoid scrolling on 14" */}
              <div className="max-h-[360px] overflow-y-auto nice-scrollbar">
                {filteredContacts.length === 0 &&
                  (searchQuery || dataFilter !== "all") && (
                    <div className="px-6 py-6 text-center text-sm text-on-surface-variant">
                      No contacts match the current filter
                    </div>
                  )}
                {filteredContacts.map((contact) => (
                  <ContactRow
                    key={contact.id}
                    contact={contact}
                    isSelected={selectedIds.has(contact.id)}
                    hasError={erroredContactIds.has(contact.id)}
                    onToggle={() => toggleSelect(contact.id)}
                  />
                ))}
              </div>
            </div>

            {/* Start button */}
            <button
              onClick={() => setShowConfirm(true)}
              disabled={selectedIds.size === 0 || isStarting}
              className={cn(
                "w-full py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all",
                selectedIds.size > 0
                  ? "btn-primary shadow-lg hover:shadow-xl"
                  : "bg-surface-container-high text-on-surface-variant cursor-not-allowed",
              )}
            >
              <Sparkles className="w-4 h-4" />
              {selectedIds.size > 0
                ? `Start AI Search (${selectedIds.size} selected)`
                : "Select contacts to search"}
            </button>
          </>
        )}

      {/* Confirm modal */}
      <AISearchConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirmStart}
        selectedContacts={selectedContacts}
        isStarting={isStarting}
      />
    </div>
  );
}
