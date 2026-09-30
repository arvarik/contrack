/**
 * AISearchView — Main AI Search settings sub-view.
 *
 * Displays the research depth, Standard or Deep, with what each does and,
 * when research runs on Gemini, where the figures were measured, what a
 * contact takes and costs. Then a selectable list of non-archived
 * contacts with status badges (✨ previously searched, "No page" when the
 * last research found none, NEW never searched, 🔴 last search errored).
 * Two rows of filters narrow the list, one for who and one for how their
 * research stands (`lib/enrichmentFilters`), each pill with its count. Users
 * choose the depth, select contacts, and see the batch's time and cost under
 * "Start enrichment" before they press it. The page is named "Contact
 * enrichment" in the UI (`lib/names`). The code keeps the `aiSearch` name of
 * the subsystem behind it.
 */
import { useState, useCallback, useDeferredValue, useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  CircleDashed,
  Globe,
  History,
  Hourglass,
  Link,
  Mail,
  Radar,
  Search,
  SearchX,
  Sparkles,
  User,
} from "lucide-react";
import { useContacts } from "../../api";
import { useAISearch } from "../../contexts/AISearchContext";
import { ContactRow } from "./components/AISearchContactList";
import { AISearchConfirmModal } from "./components/AISearchConfirmModal";
import { DepthCostTip } from "./DepthCostTip";
import { CARD, SECTION_HEADING, SEARCH_INPUT } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { EmptyState } from "../../components/ui/EmptyState";
import { ChoiceGroup, type Choice } from "../../components/ui/ChoiceGroup";
import { FilterRow, type FilterPill } from "../../components/ui/FilterRow";
import { VirtualRows } from "../../components/ui/VirtualRows";
import {
  batchEstimate,
  DEPTH_ORDER,
  DEPTH_WORDS,
  perContact,
} from "../../lib/researchDepth";
import {
  filtersFromParams,
  matchesContactFilter,
  matchesResearchFilter,
  paramsWithFilters,
  type ContactFilter,
  type EnrichmentFilters,
  type ResearchFilter,
} from "../../lib/enrichmentFilters";
import { NAMES } from "../../lib/names";
import type { ResearchDepth } from "../../../shared/researchDepth";

/**
 * The two depths as tiles: what each does, and its time and cost when the
 * measured figures describe this research (`depthFiguresApply`).
 */
const depthChoices = (figures: boolean): readonly Choice<ResearchDepth>[] =>
  DEPTH_ORDER.map((depth) => ({
    value: depth,
    label: DEPTH_WORDS[depth].name,
    hint: DEPTH_WORDS[depth].does,
    ...(figures && { detail: perContact(depth) }),
  }));

/** Who: every contact, the tracked ones, or by what the records have. */
const CONTACT_FILTERS: readonly FilterPill<ContactFilter>[] = [
  { id: "all", label: "All", icon: <User className="w-3 h-3" /> },
  { id: "tracked", label: "Tracked", icon: <Radar className="w-3 h-3" /> },
  { id: "has_links", label: "Has links", icon: <Link className="w-3 h-3" /> },
  { id: "has_email", label: "Has email", icon: <Mail className="w-3 h-3" /> },
  { id: "no_data", label: "No data", icon: <Search className="w-3 h-3" /> },
];

/** How their research stands: never run, old, or found no page. */
const RESEARCH_FILTERS: readonly FilterPill<ResearchFilter>[] = [
  { id: "any", label: "Any", icon: <Globe className="w-3 h-3" /> },
  {
    id: "not_yet",
    label: "Not yet",
    icon: <CircleDashed className="w-3 h-3" />,
  },
  {
    id: "stale",
    label: "6+ months ago",
    icon: <History className="w-3 h-3" />,
  },
  {
    id: "found_nothing",
    label: "Found nothing",
    icon: <SearchX className="w-3 h-3" />,
  },
];

interface AISearchViewProps {
  hideHeaderDescription?: boolean;
}

export function AISearchView({
  hideHeaderDescription = false,
}: AISearchViewProps = {}) {
  const { data: contacts = [], isLoading } = useContacts();
  const {
    startSearch,
    isStarting,
    batch,
    limitMessage,
    clearLimit,
    depthFiguresApply,
  } = useAISearch();
  const choices = useMemo(
    () => depthChoices(depthFiguresApply),
    [depthFiguresApply],
  );

  const [searchQuery, setSearchQuery] = useState("");
  // The list follows a deferred copy of the box, so a letter shows in the
  // box at once and the list and its counts catch up a moment later.
  const deferredQuery = useDeferredValue(searchQuery);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  // The two choices live in the page's address, so Back from a contact
  // opened from the list comes back to the same list. The search box stays
  // in the component: the router applies an address in a transition, and a
  // text field bound to one can drop what was typed.
  const [params, setParams] = useSearchParams();
  const { contacts: contactFilter, research: researchFilter } =
    filtersFromParams(params);
  const setFilters = (next: Partial<EnrichmentFilters>) =>
    setParams((prev) => paramsWithFilters(prev, next), { replace: true });
  const filtered = contactFilter !== "all" || researchFilter !== "any";
  // What a row's link hands the contact page: Back returns here, to this
  // list, and says so.
  const location = useLocation();
  const openState = useMemo(
    () => ({
      back: {
        to: `${location.pathname}${location.search}`,
        label: NAMES.enrichment.label,
      },
    }),
    [location.pathname, location.search],
  );
  // Standard each time the page opens: a costlier run is a choice made for
  // this batch, not one that sticks.
  const [depth, setDepth] = useState<ResearchDepth>("standard");

  // Archived and ghost contacts are never researched; the search box
  // narrows the rest before either row of filters does.
  const searchedContacts = useMemo(() => {
    const list = contacts.filter((c) => !c.isArchived && !c.isGhost);
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.company || "").toLowerCase().includes(q) ||
        (c.role || "").toLowerCase().includes(q),
    );
  }, [contacts, deferredQuery]);

  const filteredContacts = useMemo(() => {
    const now = Date.now();
    return searchedContacts.filter(
      (c) =>
        matchesContactFilter(c, contactFilter) &&
        matchesResearchFilter(c, researchFilter, now),
    );
  }, [searchedContacts, contactFilter, researchFilter]);

  // What each pill would show, beside the other row's choice: a pill says
  // how many it holds before it is pressed.
  const counts = useMemo(() => {
    const now = Date.now();
    const contactCounts = new Map<ContactFilter, number>();
    const researchCounts = new Map<ResearchFilter, number>();
    for (const pill of CONTACT_FILTERS)
      contactCounts.set(
        pill.id,
        searchedContacts.filter(
          (c) =>
            matchesContactFilter(c, pill.id) &&
            matchesResearchFilter(c, researchFilter, now),
        ).length,
      );
    for (const pill of RESEARCH_FILTERS)
      researchCounts.set(
        pill.id,
        searchedContacts.filter(
          (c) =>
            matchesContactFilter(c, contactFilter) &&
            matchesResearchFilter(c, pill.id, now),
        ).length,
      );
    return { contactCounts, researchCounts };
  }, [searchedContacts, contactFilter, researchFilter]);

  // A new filter is a new list, and a selection kept from the old one
  // would start contacts the person can no longer see.
  const chooseContactFilter = (filter: ContactFilter) => {
    setFilters({ contacts: filter });
    setSelectedIds(new Set());
  };
  const chooseResearchFilter = (filter: ResearchFilter) => {
    setFilters({ research: filter });
    setSelectedIds(new Set());
  };

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
    startSearch(ids, { depth });
    setShowConfirm(false);
    setSelectedIds(new Set());
  };

  return (
    <div className="space-y-4">
      {/*
        No title block here. This view is only ever mounted inside the
        Settings shell, which already renders the icon and "Contact
        enrichment" heading — repeating it stacked two near-identical headers
        on top of each other and pushed the actual content off a phone screen.
        Only the description that the shell does not carry survives.

        No box either: the page that mounts it (EnrichmentPage) draws the
        settings page box, and a second one here set its cards 8 to 16 px
        off the page title.
      */}
      {!hideHeaderDescription && (
        <p className="text-sm text-on-surface-variant">
          Research contacts on the live web and fill in the gaps in their
          profiles
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
        !filtered && (
          <EmptyState
            icon={Sparkles}
            title="No contacts available"
            body="Add contacts to your network to start using contact enrichment"
          />
        )}

      {/* Contact list */}
      {!isLoading &&
        (filteredContacts.length > 0 || searchQuery || filtered) && (
          <>
            {/* How deep: named, described and priced before anything is
                chosen, so the cost of a batch is no surprise. */}
            <section
              aria-labelledby="research-depth-heading"
              className={cn(CARD, "space-y-3")}
            >
              <div className="flex items-center gap-1">
                <h3
                  id="research-depth-heading"
                  className={cn(SECTION_HEADING, "flex items-center gap-2")}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Research depth
                </h3>
                <DepthCostTip />
              </div>
              <ChoiceGroup
                label="Research depth"
                value={depth}
                options={choices}
                onChange={setDepth}
                className="sm:grid-cols-2"
              />
            </section>

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

                {/*
                  Two rows of filter pills, one choice in each, and a contact
                  shows when it matches both. The active pill is the selected
                  tint, like every filter pill, not a filled button, and each
                  pill counts what it would show.
                */}
                <FilterRow
                  idPrefix="enrichment-filter"
                  label="Contacts"
                  pills={CONTACT_FILTERS}
                  value={contactFilter}
                  counts={counts.contactCounts}
                  onChange={chooseContactFilter}
                />
                <FilterRow
                  idPrefix="enrichment-filter"
                  label="Research"
                  pills={RESEARCH_FILTERS}
                  value={researchFilter}
                  counts={counts.researchCounts}
                  onChange={chooseResearchFilter}
                />
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
                  className="hit-area state-layer text-xs font-bold text-on-primary-wash px-3 py-1 rounded-xl bg-primary/10 transition-colors whitespace-nowrap"
                >
                  {selectedIds.size === filteredContacts.length &&
                  filteredContacts.length > 0
                    ? "Deselect all"
                    : "Select all"}
                </button>
              </div>

              {/* Contact rows, in a box of their own that scrolls, so the
                  Start button stays near. Only the rows in view are drawn
                  (`VirtualRows`): all 5,824 took 44 s to open the page. */}
              <div className="max-h-[360px] overflow-y-auto">
                {filteredContacts.length === 0 && (searchQuery || filtered) && (
                  <div className="px-6 py-6 text-center text-sm text-on-surface-variant space-y-2">
                    <p>No contacts match the current filter</p>
                    {filtered && (
                      <button
                        type="button"
                        onClick={() => {
                          setFilters({ contacts: "all", research: "any" });
                          setSelectedIds(new Set());
                        }}
                        className="hit-area state-layer rounded-lg px-2 py-0.5 text-sm font-semibold text-primary"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                )}
                <VirtualRows
                  items={filteredContacts}
                  getKey={(contact) => contact.id}
                  estimateSize={68}
                  renderRow={(contact) => (
                    <ContactRow
                      contact={contact}
                      isSelected={selectedIds.has(contact.id)}
                      hasError={erroredContactIds.has(contact.id)}
                      onToggle={() => toggleSelect(contact.id)}
                      openState={openState}
                    />
                  )}
                />
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
                className="flex items-start gap-2.5 rounded-2xl bg-warning/10 p-3"
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
            {/* What the batch will take, before the press, at the depth
                chosen above: the confirmation says it again. */}
            {selectedIds.size > 0 && depthFiguresApply && (
              <p
                aria-live="polite"
                className="-mt-2 text-center text-xs text-on-surface-variant tabular-nums"
              >
                {DEPTH_WORDS[depth].name} ·{" "}
                {batchEstimate(depth, selectedIds.size)}
              </p>
            )}
          </>
        )}

      {/* Confirm modal */}
      <AISearchConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirmStart}
        selectedContacts={selectedContacts}
        isStarting={isStarting}
        depth={depth}
        showEstimate={depthFiguresApply}
      />
    </div>
  );
}
