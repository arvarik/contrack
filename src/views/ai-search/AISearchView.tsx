/**
 * AISearchView — Main AI Search settings sub-view.
 *
 * Displays a selectable list of non-archived contacts with status badges
 * (✨ previously searched, NEW never searched, 🔴 last search errored).
 * Users select contacts, then click "Start enrichment" to begin a batch. The
 * page is named "Contact enrichment" in the UI (`lib/names`). The code keeps
 * the `aiSearch` name of the subsystem behind it.
 */
import React, { useState, useCallback, useMemo } from "react";
import { Sparkles, Search, User, Link, Mail, Hourglass } from "lucide-react";
import { useContacts } from "../../api";
import { useAISearch } from "../../contexts/AISearchContext";
import { ContactRow } from "./components/AISearchContactList";
import { AISearchConfirmModal } from "./components/AISearchConfirmModal";
import { CARD, SECTION_HEADING, SEARCH_INPUT } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { EmptyState } from "../../components/ui/EmptyState";

type DataFilter = "all" | "has_links" | "has_email" | "no_data";

export interface AISearchViewProps {
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  hideHeaderDescription?: boolean;
}

export function AISearchView({
  selectedIds: controlledSelectedIds,
  onSelectionChange: setControlledSelectedIds,
  hideHeaderDescription = false,
}: AISearchViewProps = {}) {
  const { data: contacts = [], isLoading } = useContacts();
  const { startSearch, isStarting, batch, limitMessage, clearLimit } =
    useAISearch();

  const [searchQuery, setSearchQuery] = useState("");
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(
    new Set(),
  );
  const selectedIds = controlledSelectedIds ?? internalSelectedIds;
  const setSelectedIds = setControlledSelectedIds ?? setInternalSelectedIds;
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

  const toggleSelect = useCallback(
    (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      setSelectedIds(next);
    },
    [selectedIds, setSelectedIds],
  );

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredContacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredContacts.map((c) => c.id)));
    }
  }, [selectedIds.size, filteredContacts, setSelectedIds]);

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
        enrichment" heading — repeating it stacked two near-identical headers
        on top of each other and pushed the actual content off a phone screen.
        Only the description that the shell does not carry survives.
      */}
      {!hideHeaderDescription && (
        <p className="text-sm text-on-surface-variant">
          Research contacts on the live web and fill in the gaps in their
          profiles.
        </p>
      )}

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
          <EmptyState
            icon={Sparkles}
            title="No contacts available"
            body="Add contacts to your network to start using contact enrichment."
          />
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
                        "hit-area flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold transition-all",
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
                  className="hit-area text-xs font-bold text-on-primary-wash px-3 py-1 rounded-xl bg-primary/10 hover:bg-primary/15 transition-colors whitespace-nowrap"
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

            {/*
              A refusal that is about timing rather than about the request.
              It stays on the page under the button that caused it, because
              the reader's next move is to wait and press it again, and a
              toast that has already faded cannot tell them how long.
            */}
            {limitMessage && (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-2xl bg-amber-500/10 p-3"
              >
                <Hourglass className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <p className="flex-1 text-xs text-on-surface text-pretty">
                  {limitMessage}
                </p>
              </div>
            )}

            {/* Start button */}
            <button
              onClick={() => {
                clearLimit();
                setShowConfirm(true);
              }}
              disabled={selectedIds.size === 0 || isStarting}
              className="btn-primary w-full"
            >
              <Sparkles className="w-4 h-4" />
              {selectedIds.size > 0
                ? `Start enrichment (${selectedIds.size} selected)`
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
