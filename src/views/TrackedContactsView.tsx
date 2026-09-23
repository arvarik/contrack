/**
 * TrackedContactsView: the people you keep up with, and the people you don't.
 *
 * One page, two doors: the Tracked chip's Manage link on the Network page
 * and the Keeping up card on Pulse. Settings, Data lists it too. It is a
 * Network sub-page at `/tracked`, a full page the way `/pulse/duplicates`
 * is, and the sidebar keeps Network lit.
 *
 * From the top:
 *
 * 1. The heading and one sentence.
 * 2. A search box that narrows every group by name, company or role, and
 *    the order: Name, or Recently tracked (by `trackedAt`, newest first,
 *    tracked groups only).
 * 3. The groups, each a section with a heading and a count: At risk,
 *    Fading, Strong, No interactions yet, Not tracked. The first four are
 *    the tracked contacts by `scoreView`. The last is A to Z. Each heading
 *    has an id (`#at-risk`, `#fading`, `#strong`, `#unscored`,
 *    `#not-tracked`) for the Keeping up card's links. An empty group is
 *    left out.
 * 4. A row: the ring, the name as a link, the company, the cadence in words
 *    ("quarterly", or "every 2 months" for a cadence off the four words)
 *    and "3 weeks past due" when it is, and a 44 px toggle named "Untrack
 *    Ada Lovelace" or "Track Ada Lovelace".
 * 5. Select mode, as on the Archived page: Select, Select all in each
 *    group's heading, Done, and a bar with Track, Untrack, a Cadence menu
 *    (the four cadences the app offers: Weekly, Monthly, Quarterly and
 *    Yearly) and the count. The same Undo toasts as the Network bar.
 * 6. Past 200 rows the list is virtualised, the way the Network list is:
 *    the groups flatten into one list of headings and rows.
 * 7. When nobody is tracked, an `EmptyState` says so, and the Not tracked
 *    group under it is the way in.
 *
 * @module views/TrackedContactsView
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarClock,
  CircleSlash,
  Radar,
  Search,
  SearchX,
  Square,
} from "lucide-react";
import { CADENCE_CHOICES, describeCadence } from "../../shared/cadence";
import { scoreView } from "../../shared/scoreBand";
import { useContacts } from "../api";
import { ActionMenu } from "../components/ui/ActionMenu";
import { EmptyState } from "../components/ui/EmptyState";
import { Segmented } from "../components/ui/Segmented";
import { PageHeader } from "../components/layout/PageHeader";
import { ScoreRingAvatar } from "../components/ScoreRingAvatar";
import { useBulkActions } from "../components/bulk/useBulkActions";
import { useSwapFocus } from "../components/bulk/useSwapFocus";
import { usePageTitle } from "../hooks/usePageTitle";
import { useTrackToggle, type TrackableContact } from "../hooks/useTrackToggle";
import { describePastDue, parseServerTime } from "../lib/datetime";
import { NAMES, TRACKED_INTRO } from "../lib/names";
import {
  BAR_BUTTON,
  BAR_LABEL,
  BTN_QUIET,
  CARD,
  ICON_BTN,
  PAGE_TOP,
  PAGE_X,
  SEARCH_INPUT,
  SECTION_HEADING,
  SELECTED_ROW,
  SELECTED_TINT,
} from "../lib/styles";
import { cn } from "../lib/utils";
import type { Contact } from "../types";
import { SelectedCount } from "./contact-list/BulkActionToolbar";

// ═══════════════════════════════════════════════════════════════════════════
// The groups
// ═══════════════════════════════════════════════════════════════════════════

export type TrackedGroupId =
  "at-risk" | "fading" | "strong" | "unscored" | "not-tracked";

export interface TrackedGroup {
  id: TrackedGroupId;
  title: string;
  contacts: Contact[];
}

export type TrackedOrder = "name" | "recent";

export const GROUP_TITLES: Record<TrackedGroupId, string> = {
  "at-risk": "At risk",
  fading: "Fading",
  strong: "Strong",
  unscored: "No interactions yet",
  "not-tracked": "Not tracked",
};

const GROUP_ORDER: readonly TrackedGroupId[] = [
  "at-risk",
  "fading",
  "strong",
  "unscored",
  "not-tracked",
];

/** Past this many rows the list is virtualised. */
const VIRTUAL_ROWS = 200;

/** Which group a contact belongs to: its ring state, by `scoreView`. */
export function groupOf(contact: Contact): TrackedGroupId {
  const view = scoreView(contact);
  if (view.kind === "untracked") return "not-tracked";
  if (view.kind === "unscored") return "unscored";
  return view.band.band;
}

/**
 * The five groups, in order, each sorted, with the empty ones left out.
 *
 * `query` narrows every group by name, company or role. `order` sorts the
 * tracked groups by name or by `trackedAt`, newest first. Not tracked is
 * always A to Z: nobody in it has a `trackedAt`.
 */
export function groupContacts(
  contacts: readonly Contact[],
  { query = "", order = "name" }: { query?: string; order?: TrackedOrder } = {},
): TrackedGroup[] {
  const q = query.trim().toLowerCase();
  const matches = (c: Contact) =>
    !q ||
    [c.name, c.company, c.role].some((value) =>
      value?.toLowerCase().includes(q),
    );
  const buckets: Record<TrackedGroupId, Contact[]> = {
    "at-risk": [],
    fading: [],
    strong: [],
    unscored: [],
    "not-tracked": [],
  };
  for (const contact of contacts) {
    if (contact.isArchived || contact.isGhost || !matches(contact)) continue;
    buckets[groupOf(contact)].push(contact);
  }
  const byName = (a: Contact, b: Contact) =>
    (a.name || "").localeCompare(b.name || "");
  const trackedAt = (c: Contact) =>
    parseServerTime(c.trackedAt)?.getTime() ?? 0;
  const byRecent = (a: Contact, b: Contact) =>
    trackedAt(b) - trackedAt(a) || byName(a, b);
  return GROUP_ORDER.map((id) => ({
    id,
    title: GROUP_TITLES[id],
    contacts: buckets[id].sort(
      id === "not-tracked" || order === "name" ? byName : byRecent,
    ),
  })).filter((group) => group.contacts.length > 0);
}

/**
 * "3 weeks past due" for a tracked contact whose clock is past its cadence,
 * else null. The clock is the last interaction, or the moment of tracking
 * when nothing is logged yet, the same rule Pulse's Catch up uses.
 */
export function pastDue(
  contact: Pick<
    Contact,
    "isTracked" | "cadenceDays" | "lastContactedAt" | "trackedAt"
  >,
  now = Date.now(),
): string | null {
  if (!contact.isTracked || !(contact.cadenceDays > 0)) return null;
  const clock = parseServerTime(contact.lastContactedAt ?? contact.trackedAt);
  if (!clock) return null;
  const daysSince = Math.floor((now - clock.getTime()) / 86_400_000);
  const overshoot = daysSince - contact.cadenceDays;
  return overshoot > 0 ? describePastDue(overshoot) : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// A row
// ═══════════════════════════════════════════════════════════════════════════

interface RowProps {
  contact: Contact;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onFlip: (contact: TrackableContact) => void;
  flipPending: boolean;
}

const TrackedRow = React.memo(function TrackedRow({
  contact,
  selectMode,
  selected,
  onToggleSelect,
  onFlip,
  flipPending,
}: RowProps) {
  const tracked = contact.isTracked;
  const due = pastDue(contact);
  const facts: React.ReactNode[] = [];
  if (contact.company) facts.push(<span key="company">{contact.company}</span>);
  if (tracked) {
    facts.push(
      <span key="cadence">
        {describeCadence(contact.cadenceDays, { sentence: true })}
      </span>,
    );
  }
  if (due) facts.push(<span key="due">{due}</span>);

  // In select mode the checkbox is the control: a real one, named for the
  // contact, with the 44 px box from `hit-area`. The row itself is not a
  // button, so the name inside it stays a link.
  return (
    <div
      data-contact-id={contact.id}
      className={cn(
        "state-layer flex items-center gap-3 px-3 py-2 rounded-xl transition-colors",
        selectMode && selected && SELECTED_ROW,
      )}
    >
      {selectMode && (
        // The label carries the 44 px box: an input draws no pseudo-element.
        <label className="hit-area flex items-center justify-center w-6 h-6 shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(contact.id)}
            aria-label={`Select ${contact.name}`}
            className="w-5 h-5 accent-primary rounded-md"
          />
        </label>
      )}

      {/* The row is not a control, so the ring keeps its own name. */}
      <ScoreRingAvatar contact={contact} size={40} ring="list" />

      <div className="flex-1 min-w-0">
        {/* A selected row's name takes the primary ink: the tint alone is
            about 1.06 to 1. */}
        <Link
          to={`/contact/${contact.id}`}
          className={cn(
            "hit-area font-semibold text-sm hover:underline rounded truncate block w-fit max-w-full",
            selectMode && selected ? "text-on-primary-wash" : "text-on-surface",
          )}
        >
          {contact.name}
        </Link>
        {/* The facts, a middle dot between two. Each dot sits in the gap
            before its fact, and the line clips what falls outside it, so a
            fact that wraps takes its dot out of sight: no line ends, or
            starts, with a dot. The dot is decoration, and a screen reader
            skips it. */}
        {facts.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 overflow-hidden text-xs text-on-surface-variant">
            {facts.map((fact, index) => (
              <span key={index} className="relative">
                <span aria-hidden="true" className="absolute -left-2">
                  ·
                </span>
                {fact}
              </span>
            ))}
          </p>
        )}
      </div>

      {!selectMode && (
        <button
          type="button"
          aria-label={`${tracked ? "Untrack" : "Track"} ${contact.name}`}
          title={tracked ? "Untrack" : "Track"}
          disabled={flipPending}
          onClick={() => onFlip(contact)}
          className={cn(
            ICON_BTN,
            "shrink-0 disabled:opacity-50",
            // A toggle that is on wears the selected tint, and keeps its ink
            // on hover so it does not read as off.
            tracked && cn(SELECTED_TINT, "hover:text-on-primary-wash"),
          )}
        >
          <Radar className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// A group heading
// ═══════════════════════════════════════════════════════════════════════════

const GroupHeading = ({
  group,
  selectMode,
  allSelected,
  onSelectAll,
}: {
  group: TrackedGroup;
  selectMode: boolean;
  allSelected: boolean;
  onSelectAll: (group: TrackedGroup) => void;
}) => (
  <div className="px-4 py-3 bg-surface-container-low flex items-center justify-between gap-3">
    <h2
      id={group.id}
      className={cn(SECTION_HEADING, "flex items-center gap-2 scroll-mt-4")}
    >
      {group.title}
      {/* The heading's own ink: at 70 percent it measured 3.0 to 1. */}
      <span className="tabular-nums">{group.contacts.length}</span>
    </h2>
    {selectMode && (
      <button
        type="button"
        onClick={() => onSelectAll(group)}
        className={BTN_QUIET}
      >
        {allSelected ? "Deselect all" : "Select all"}
      </button>
    )}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// The bar
// ═══════════════════════════════════════════════════════════════════════════

const BarButton = ({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(BAR_BUTTON, "text-primary disabled:opacity-40")}
  >
    {icon}
    <span className={BAR_LABEL}>{label}</span>
  </button>
);

// ═══════════════════════════════════════════════════════════════════════════
// The page
// ═══════════════════════════════════════════════════════════════════════════

type Item =
  { kind: "heading"; group: TrackedGroup } | { kind: "row"; contact: Contact };

export const TrackedContactsView = () => {
  usePageTitle(NAMES.tracked.title);
  const location = useLocation();
  const { data: contacts = [], isLoading } = useContacts();

  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<TrackedOrder>("name");

  const groups = useMemo(
    () => groupContacts(contacts, { query, order }),
    [contacts, query, order],
  );
  const visible = useMemo(
    () => groups.flatMap((group) => group.contacts),
    [groups],
  );
  const trackedCount = useMemo(
    () =>
      contacts.filter((c) => c.isTracked && !c.isArchived && !c.isGhost).length,
    [contacts],
  );
  const nobodyTracked = !isLoading && trackedCount === 0;

  // ── One contact at a time ─────────────────────────────────────────────
  const { toggle: flip, isPending: flipPending } = useTrackToggle();

  // ── Select mode ───────────────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectGroup = useCallback((group: TrackedGroup) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const all = group.contacts.every((c) => prev.has(c.id));
      for (const c of group.contacts) {
        if (all) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });
  }, []);
  // Select and Done trade places. Focus follows to the one that appears.
  const selectButtonRef = useRef<HTMLButtonElement>(null);
  const doneButtonRef = useRef<HTMLButtonElement>(null);
  useSwapFocus(selectMode, doneButtonRef, selectButtonRef);
  const bulk = useBulkActions({
    selectedIds,
    contacts: visible,
    onComplete: exitSelectMode,
  });
  const { handleBulkCadence } = bulk;
  const selectedCount = selectedIds.size;
  // The bar's room: its height, its sticky offset and a gap. While the bar
  // shows, the scroller keeps it as scroll padding, so a checkbox that Tab
  // reaches stops above the bar, not under it. Measured, as in ContactList:
  // the offset changes at `md`.
  const [barRoom, setBarRoom] = useState(0);
  const measureBar = useCallback((bar: HTMLDivElement | null) => {
    if (!bar) return;
    const measure = () =>
      setBarRoom(
        bar.offsetHeight + (parseFloat(getComputedStyle(bar).bottom) || 0) + 8,
      );
    measure();
    if (typeof ResizeObserver === "undefined") return () => setBarRoom(0);
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      setBarRoom(0);
    };
  }, []);
  /** Nobody picked, or a change on its way: the bar's buttons wait. */
  const nothingToAct = bulk.isPending || selectedCount === 0;

  // The four cadences, one word each. A cadence off the list (60 or 180
  // days, saved before 2.0) stays on the rows that have it, and is not
  // offered here: one choice for many people is one of the four.
  const cadenceItems = useMemo(
    () =>
      CADENCE_CHOICES.map((choice) => ({
        id: String(choice.days),
        label: choice.label,
        onSelect: () => handleBulkCadence(choice.days),
      })),
    [handleBulkCadence],
  );

  // ── The rows, flat, for the virtualised list ──────────────────────────
  const items = useMemo(
    (): Item[] =>
      groups.flatMap((group): Item[] => [
        { kind: "heading", group },
        ...group.contacts.map((contact): Item => ({ kind: "row", contact })),
      ]),
    [groups],
  );
  const virtual = visible.length > VIRTUAL_ROWS;

  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const virtualizer = useVirtualizer({
    count: virtual ? items.length : 0,
    getScrollElement: () => scrollRef.current,
    scrollMargin,
    estimateSize: (index) => (items[index]?.kind === "heading" ? 48 : 60),
    overscan: 8,
  });
  // How far the list starts below the top of the scroller, so a jump to a
  // heading lands on it. See ContactList for the same measurement.
  useLayoutEffect(() => {
    const list = listRef.current;
    const scroller = scrollRef.current;
    if (!list || !scroller) return;
    const offset =
      list.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    setScrollMargin((previous) =>
      Math.abs(previous - offset) > 1 ? offset : previous,
    );
  }, [virtual, isLoading, nobodyTracked, selectMode]);

  // ── A hash link lands on its group ────────────────────────────────────
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    const hash = location.hash.replace(/^#/, "");
    if (!hash || isLoading || scrolledTo.current === location.hash) return;
    if (virtual) {
      const index = items.findIndex(
        (item) => item.kind === "heading" && item.group.id === hash,
      );
      if (index < 0) return;
      virtualizer.scrollToIndex(index, { align: "start" });
    } else {
      const heading = document.getElementById(hash);
      if (!heading) return;
      heading.scrollIntoView({ block: "start" });
    }
    scrolledTo.current = location.hash;
  }, [location.hash, isLoading, virtual, items, virtualizer]);

  const selectedInGroup = (group: TrackedGroup) =>
    group.contacts.length > 0 &&
    group.contacts.every((c) => selectedIds.has(c.id));

  const row = (contact: Contact) => (
    <TrackedRow
      key={contact.id}
      contact={contact}
      selectMode={selectMode}
      selected={selectedIds.has(contact.id)}
      onToggleSelect={toggleSelect}
      onFlip={flip}
      flipPending={flipPending}
    />
  );

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto"
      style={barRoom ? { scrollPaddingBottom: barRoom } : undefined}
    >
      <div
        className={cn(
          PAGE_X,
          PAGE_TOP,
          "max-w-4xl mx-auto pb-24 md:pb-6 space-y-5",
        )}
      >
        {/* Select sits with the title, as on the Network list. In the row
            below it wrapped to a line of its own on a phone, under the
            full-width order control. */}
        <PageHeader
          title={NAMES.tracked.title}
          description={TRACKED_INTRO}
          actions={
            selectMode ? (
              // The count is in the bar, once.
              <button
                key="done"
                ref={doneButtonRef}
                type="button"
                onClick={exitSelectMode}
                className="btn-secondary btn-sm"
              >
                Done
              </button>
            ) : (
              <button
                key="select"
                ref={selectButtonRef}
                type="button"
                onClick={() => setSelectMode(true)}
                disabled={visible.length === 0}
                className={cn(ICON_BTN, "disabled:opacity-40")}
                aria-label="Select"
                title="Select"
              >
                <Square className="w-5 h-5" aria-hidden="true" />
              </button>
            )
          }
        />

        {/* Search and the order */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[12rem]">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant"
            />
            <input
              type="search"
              aria-label="Search tracked contacts"
              placeholder="Search by name, company or role"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={SEARCH_INPUT}
            />
          </div>
          <Segmented
            label="Order"
            value={order}
            onChange={setOrder}
            options={[
              { value: "name", label: "Name" },
              { value: "recent", label: "Recently tracked" },
            ]}
          />
        </div>

        {isLoading && (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 rounded-xl animate-pulse"
              >
                <div className="w-10 h-10 rounded-full bg-surface-container-high shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-surface-container-high rounded-full w-2/5" />
                  <div className="h-3 bg-surface-container rounded-full w-1/4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Nobody tracked: the way in is the Not tracked group under it. */}
        {nobodyTracked && !query && (
          <EmptyState
            icon={Radar}
            title="Nobody is tracked yet"
            body={TRACKED_INTRO}
          />
        )}

        {!isLoading && query && visible.length === 0 && (
          <EmptyState
            icon={SearchX}
            title={`Nobody matches "${query}"`}
            body="Try fewer letters, or search a company or a role."
            action={{ label: "Clear search", onClick: () => setQuery("") }}
          />
        )}

        {!isLoading && !virtual && (
          <div className="space-y-5">
            {groups.map((group) => (
              <section
                key={group.id}
                aria-labelledby={group.id}
                className={cn(CARD, "p-0 overflow-hidden")}
              >
                <GroupHeading
                  group={group}
                  selectMode={selectMode}
                  allSelected={selectedInGroup(group)}
                  onSelectAll={selectGroup}
                />
                <div className="p-2 space-y-0.5">{group.contacts.map(row)}</div>
              </section>
            ))}
          </div>
        )}

        {/* Past 200 rows: one flat list of headings and rows, virtualised. */}
        {!isLoading && virtual && (
          <div
            ref={listRef}
            className={cn(CARD, "p-2")}
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const item = items[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start - scrollMargin}px)`,
                  }}
                >
                  {item.kind === "heading" ? (
                    <div className="-mx-2 rounded-t-xl overflow-hidden">
                      <GroupHeading
                        group={item.group}
                        selectMode={selectMode}
                        allSelected={selectedInGroup(item.group)}
                        onSelectAll={selectGroup}
                      />
                    </div>
                  ) : (
                    row(item.contact)
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* The bar: the count, Track, Untrack and the cadence. It is the
            column's last child and sticks to the bottom of the scroller, so
            it is exactly as wide as the cards above it, beside the rail at
            every width. Fixed to the window, it was centred on the window
            instead: past the cards on a desktop, and over the rail's
            Settings gear at 768 px. The column's bottom padding is the gap
            it sticks at, so the last row scrolls clear of it. */}
        <AnimatePresence>
          {selectMode && (
            <motion.div
              ref={measureBar}
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ type: "spring", damping: 22, stiffness: 300 }}
              className="sticky bottom-24 md:bottom-6 z-40"
            >
              <div
                role="toolbar"
                aria-label="Bulk actions"
                className="bg-surface-container-lowest/98 backdrop-blur-xl ring-1 ring-outline-variant/40 rounded-2xl shadow-2xl px-3 py-2 flex items-center gap-1 overflow-x-auto scrollbar-hide"
              >
                <SelectedCount count={selectedCount} />
                <div className="flex-1" />
                <BarButton
                  icon={<Radar className="w-4 h-4" aria-hidden="true" />}
                  label="Track"
                  onClick={() => bulk.handleBulkTrack(true)}
                  disabled={nothingToAct}
                />
                <BarButton
                  icon={<CircleSlash className="w-4 h-4" aria-hidden="true" />}
                  label="Untrack"
                  onClick={() => bulk.handleBulkTrack(false)}
                  disabled={nothingToAct}
                />
                {/* Disabled with the other two. The menu cannot be, so a
                    button with its look stands in while nobody is picked. */}
                {nothingToAct ? (
                  <BarButton
                    icon={
                      <CalendarClock className="w-4 h-4" aria-hidden="true" />
                    }
                    label="Cadence"
                    onClick={() => undefined}
                    disabled
                  />
                ) : (
                  <ActionMenu
                    label="Cadence"
                    title="One cadence for the selection"
                    heading="Keep up"
                    items={cadenceItems}
                    // The bar button's look and the primary ink, at rest and
                    // on hover, so the three buttons in the bar look alike.
                    triggerClassName={cn(
                      BAR_BUTTON,
                      "text-primary hover:text-primary",
                    )}
                    triggerContent={
                      <span className="flex flex-col items-center gap-0.5">
                        <CalendarClock className="w-4 h-4" aria-hidden="true" />
                        <span className={BAR_LABEL}>Cadence</span>
                      </span>
                    }
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default TrackedContactsView;
