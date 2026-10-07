/**
 * The "Contact enrichment" page (`lib/names`). The code keeps the `aiSearch`
 * name. Pick a depth, filter and select contacts, and see the batch's time and
 * cost before the start. The web search engine is a setting on the card above
 * (`EngineChoice`). The measured figures describe Gemini's own search only, so
 * they show for it alone (`depthFiguresApply`).
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
import { CARD, SECTION_HEADING } from "../../lib/styles";
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
import { ENGINE_HINT, engineName } from "../../lib/webSearchEngine";
import type { ResearchDepth } from "../../../shared/researchDepth";
import { SearchField } from "../../components/ui/SearchField";

/** The depth tiles. Time and cost show only when the measured figures apply. */
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
    webSearchProvider,
    runsEngine,
  } = useAISearch();
  const choices = useMemo(
    () => depthChoices(depthFiguresApply),
    [depthFiguresApply],
  );

  const [searchQuery, setSearchQuery] = useState("");
  // The list follows a deferred copy, so typing stays instant.
  const deferredQuery = useDeferredValue(searchQuery);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  // The filters live in the address, so Back from a contact returns to the
  // same list. The search text stays in state: the router applies an address
  // in a transition, which can drop typed text.
  const [params, setParams] = useSearchParams();
  const { contacts: contactFilter, research: researchFilter } =
    filtersFromParams(params);
  const setFilters = (next: Partial<EnrichmentFilters>) =>
    setParams((prev) => paramsWithFilters(prev, next), { replace: true });
  const filtered = contactFilter !== "all" || researchFilter !== "any";
  // Back on the contact page returns to this list.
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

  // Archived and ghost contacts are never researched.
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

  // Each pill counts what it would show, given the other row's choice.
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
      {/* No title or box: the Settings shell draws the heading, and
          EnrichmentPage draws the page box. */}
      {!hideHeaderDescription && (
        <p className="text-sm text-on-surface-variant">
          Research contacts on the live web and fill in the gaps in their
          profiles
        </p>
      )}

      {isLoading && (
        <div className="flex justify-center p-8">
          <div className="animate-pulse w-6 h-6 rounded-full bg-primary/20" />
        </div>
      )}

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

      {!isLoading &&
        (filteredContacts.length > 0 || searchQuery || filtered) && (
          <>
            {/* Depth comes first, with its price, so a batch's cost is no
                surprise. */}
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
                  Depth
                </h3>
                <DepthCostTip />
              </div>
              <ChoiceGroup
                label="Depth"
                value={depth}
                options={choices}
                onChange={setDepth}
                className="sm:grid-cols-2"
              />
            </section>

            <div className={cn(CARD, "p-0 overflow-hidden")}>
              <div className="px-4 py-2.5 bg-surface-container-low space-y-2">
                <SearchField
                  aria-label="Filter contacts"
                  placeholder="Filter contacts…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onClear={() => setSearchQuery("")}
                  clearLabel="Clear filter text"
                />

                {/* A contact shows when it matches both rows. */}
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

              {/* The rows scroll in their own box, so Start stays near.
                  `VirtualRows` draws only the rows in view: all 5,824 took
                  44 s to open the page. */}
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

            {/* A timing refusal stays under the button: the next move is to
                wait and press again, and a faded toast cannot say how long. */}
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
            {/* The batch estimate, before the press. */}
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

      <AISearchConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirmStart}
        selectedContacts={selectedContacts}
        isStarting={isStarting}
        depth={depth}
        showEstimate={depthFiguresApply}
        searchWith={
          runsEngine && runsEngine !== "provider"
            ? {
                name: engineName(runsEngine, webSearchProvider),
                does: ENGINE_HINT[runsEngine],
              }
            : undefined
        }
      />
    </div>
  );
}
