/**
 * TrackedContactsView: the people you keep up with, and the people you don't.
 *
 * A settings page, under Your data, at `/settings/tracked`: the rail stays
 * beside it, the way it does beside every other settings page. It has two
 * more doors, the Tracked chip's Manage link on the Network page and the
 * Keeping up card on Pulse, and the old `/tracked` path leads here too. It
 * scrolls itself, so the virtualised list has its own scroller, and the
 * shell draws its header with Select in the header's actions.
 *
 * From the top:
 *
 * 1. The shell's heading and one sentence.
 * 2. One card with the search box (name, company or role), the order, and
 *    two rows of filter pills, as on the Enrichment page
 *    (`lib/trackedFilters`):
 *
 *    ```
 *    [ Search by name, company or role ]  [Name|Last spoke|Recently tracked]
 *    TRACKING     All 5824 · Tracked 79 · Not tracked 5745
 *    LAST SPOKE   Any · Past month 12 · Past year 80 · Over a year ago 31 · Never
 *    ```
 *
 *    Each pill counts what it would show beside the other row's choice, so
 *    "Not tracked" and "Past month" together are the people most worth
 *    tracking next. The filters and the order live in the address, so Back
 *    from a contact returns to the same list, and a new filter clears the
 *    selection. Name is A to Z, Last spoke is the last interaction, newest
 *    first, and Recently tracked is `trackedAt`, newest first (Not tracked
 *    stays A to Z).
 * 3. The groups, each a section with a heading and a count: At risk,
 *    Fading, Strong, No interactions yet, Not tracked. The first four are
 *    the tracked contacts by `scoreView`. Each heading has an id
 *    (`#at-risk`, `#fading`, `#strong`, `#unscored`, `#not-tracked`) for
 *    the Keeping up card's links. An empty group is left out.
 * 4. A row: the ring, the name as a link, the company, the cadence in words
 *    ("quarterly", or "every 2 months" for a cadence off the four words),
 *    "3 weeks past due" when it is, "spoke 2 months ago" when there is
 *    an interaction, and a 44 px toggle named "Untrack Ada Lovelace" or
 *    "Track Ada Lovelace".
 * 5. Select mode, as on the Archived page: Select, Select all in each
 *    group's heading, Done, and a bar with Track, Untrack, a Cadence menu
 *    (the four cadences the app offers: Weekly, Monthly, Quarterly and
 *    Yearly) and the count. The same Undo toasts as the Network bar.
 * 6. Past 200 rows the list is virtualised, the way the Network list is:
 *    the groups flatten into one list of headings and rows.
 * 7. When nobody is tracked, an `EmptyState` says so, and the Not tracked
 *    group under it is the way in. When the filters leave nobody, an
 *    `EmptyState` offers to clear them.
 *
 * @module views/TrackedContactsView
 */
import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarClock,
  CalendarDays,
  CircleDashed,
  CircleSlash,
  Clock,
  Globe,
  History,
  Radar,
  Search,
  SearchX,
  Square,
  Users,
} from "lucide-react";
import { CADENCE_CHOICES, describeCadence } from "../../shared/cadence";
import { scoreView } from "../../shared/scoreBand";
import { useContacts } from "../api";
import { ActionMenu } from "../components/ui/ActionMenu";
import { EmptyState } from "../components/ui/EmptyState";
import { FilterRow, type FilterPill } from "../components/ui/FilterRow";
import { Segmented } from "../components/ui/Segmented";
import { ScoreRingAvatar } from "../components/ScoreRingAvatar";
import { VIRTUAL_ROWS } from "../components/ui/VirtualRows";
import { useBulkActions } from "../components/bulk/useBulkActions";
import { useSwapFocus } from "../components/bulk/useSwapFocus";
import { useTrackToggle, type TrackableContact } from "../hooks/useTrackToggle";
import {
  describePastDue,
  formatDay,
  formatRelative,
  parseServerTime,
} from "../lib/datetime";
import { NAMES, TRACKED_INTRO } from "../lib/names";
import {
  lastSpokeAt,
  matchesSpokeAt,
  matchesSpokeFilter,
  matchesTrackingFilter,
  paramsWithTrackedView,
  trackedViewFromParams,
  DEFAULT_TRACKED_VIEW,
  type SpokeFilter,
  type TrackedOrder,
  type TrackedView,
  type TrackingFilter,
} from "../lib/trackedFilters";
import {
  BAR_BUTTON,
  BAR_LABEL,
  BTN_QUIET,
  CARD,
  ICON_BTN,
  SEARCH_INPUT,
  SECTION_HEADING,
  SELECTED_ROW,
  SELECTED_TINT,
} from "../lib/styles";
import { cn } from "../lib/utils";
import type { Contact } from "../types";
import { SelectedCount } from "./contact-list/BulkActionToolbar";
import { SettingsHeaderActions } from "./settings/SettingsHeader";
import { SETTINGS_BOX } from "./settings/layout";

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

export type { TrackedOrder };

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

/** Which group a contact belongs to: its ring state, by `scoreView`. */
export function groupOf(contact: Contact): TrackedGroupId {
  const view = scoreView(contact);
  if (view.kind === "untracked") return "not-tracked";
  if (view.kind === "unscored") return "unscored";
  return view.band.band;
}

/** Whether a contact's name, company or role has the query in it. */
export function matchesQuery(
  contact: Pick<Contact, "name" | "company" | "role">,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  return (
    !q ||
    [contact.name, contact.company, contact.role].some((value) =>
      value?.toLowerCase().includes(q),
    )
  );
}

/** The options `groupContacts` takes: the search, the order, the filters. */
export interface GroupOptions {
  query?: string;
  order?: TrackedOrder;
  tracking?: TrackingFilter;
  spoke?: SpokeFilter;
  now?: number;
}

/**
 * The five groups, in order, each sorted, with the empty ones left out.
 *
 * `query` narrows every group by name, company or role, and the two filters
 * (`lib/trackedFilters`) narrow them by tracking and by the last
 * interaction. `order` sorts the groups: by name, by the last interaction
 * (newest first, and never last), or by `trackedAt` (newest first). Not
 * tracked keeps A to Z for `recent`: nobody in it has a `trackedAt`.
 */
export function groupContacts(
  contacts: readonly Contact[],
  {
    query = "",
    order = "name",
    tracking = "all",
    spoke = "any",
    now = Date.now(),
  }: GroupOptions = {},
): TrackedGroup[] {
  const matches = (c: Contact) =>
    matchesQuery(c, query) &&
    matchesTrackingFilter(c, tracking) &&
    matchesSpokeFilter(c, spoke, now);
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
  // Each date is read once, not once per comparison: a sort of 5,824
  // contacts compares about 150,000 times.
  const spokeAt = new Map<string, number>();
  if (order === "spoke") {
    for (const id of GROUP_ORDER) {
      for (const c of buckets[id]) {
        spokeAt.set(c.id, lastSpokeAt(c) ?? Number.NEGATIVE_INFINITY);
      }
    }
  }
  const bySpoke = (a: Contact, b: Contact) =>
    spokeAt.get(b.id)! - spokeAt.get(a.id)! || byName(a, b);
  const sorter = (id: TrackedGroupId) =>
    order === "spoke"
      ? bySpoke
      : order === "recent" && id !== "not-tracked"
        ? byRecent
        : byName;
  return GROUP_ORDER.map((id) => ({
    id,
    title: GROUP_TITLES[id],
    contacts: buckets[id].sort(sorter(id)),
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
): string | null {
  const now = Date.now();
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
  /** The link's state for the contact page: Back returns to this list. */
  openState?: unknown;
}

const TrackedRow = React.memo(function TrackedRow({
  contact,
  selectMode,
  selected,
  onToggleSelect,
  onFlip,
  flipPending,
  openState,
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
  // When you last spoke, "spoke 3 weeks ago" or "spoke last week": the
  // fact that decides whom to track next. A row with no interaction says
  // nothing, so a list of 5,000 new people is not 5,000 lines of "never".
  if (contact.lastContactedAt) {
    facts.push(
      <span key="spoke" title={formatDay(contact.lastContactedAt)}>
        spoke {formatRelative(contact.lastContactedAt)}
      </span>,
    );
  }

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
          state={openState}
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

/** Who: everyone, the tracked people, or the rest. */
const TRACKING_PILLS: readonly FilterPill<TrackingFilter>[] = [
  { id: "all", label: "All", icon: <Users className="w-3 h-3" /> },
  { id: "tracked", label: "Tracked", icon: <Radar className="w-3 h-3" /> },
  {
    id: "not_tracked",
    label: "Not tracked",
    icon: <CircleSlash className="w-3 h-3" />,
  },
];

/** When you last spoke, by the last logged interaction. */
const SPOKE_PILLS: readonly FilterPill<SpokeFilter>[] = [
  { id: "any", label: "Any", icon: <Globe className="w-3 h-3" /> },
  { id: "month", label: "Past month", icon: <Clock className="w-3 h-3" /> },
  {
    id: "year",
    label: "Past year",
    icon: <CalendarDays className="w-3 h-3" />,
  },
  {
    id: "older",
    label: "Over a year ago",
    icon: <History className="w-3 h-3" />,
  },
  { id: "never", label: "Never", icon: <CircleDashed className="w-3 h-3" /> },
];

export const TrackedContactsView = () => {
  const location = useLocation();
  const { data: contacts = [], isLoading } = useContacts();

  const [query, setQuery] = useState("");
  // The list follows a deferred copy of the box, so each letter shows at
  // once and the groups catch up a moment later.
  const deferredQuery = useDeferredValue(query);
  // The two filters and the order live in the page's address, so Back from
  // a contact opened from the list comes back to the same list.
  const [params, setParams] = useSearchParams();
  const { tracking, spoke, order } = trackedViewFromParams(params);
  const filtered =
    tracking !== DEFAULT_TRACKED_VIEW.tracking ||
    spoke !== DEFAULT_TRACKED_VIEW.spoke;
  const setView = (next: Partial<TrackedView>) =>
    setParams((prev) => paramsWithTrackedView(prev, next), { replace: true });

  const groups = useMemo(
    () =>
      groupContacts(contacts, { query: deferredQuery, order, tracking, spoke }),
    [contacts, deferredQuery, order, tracking, spoke],
  );

  // What each pill would show beside the other row's choice and the search.
  const counts = useMemo(() => {
    const now = Date.now();
    const trackingCounts = new Map<TrackingFilter, number>();
    const spokeCounts = new Map<SpokeFilter, number>();
    for (const c of contacts) {
      if (c.isArchived || c.isGhost || !matchesQuery(c, deferredQuery)) {
        continue;
      }
      const at = lastSpokeAt(c);
      const spokeMatch = matchesSpokeAt(at, spoke, now);
      const trackingMatch = matchesTrackingFilter(c, tracking);
      for (const pill of TRACKING_PILLS) {
        if (spokeMatch && matchesTrackingFilter(c, pill.id)) {
          trackingCounts.set(pill.id, (trackingCounts.get(pill.id) ?? 0) + 1);
        }
      }
      for (const pill of SPOKE_PILLS) {
        if (trackingMatch && matchesSpokeAt(at, pill.id, now)) {
          spokeCounts.set(pill.id, (spokeCounts.get(pill.id) ?? 0) + 1);
        }
      }
    }
    return { trackingCounts, spokeCounts };
  }, [contacts, deferredQuery, tracking, spoke]);

  // What a row's link hands the contact page: Back returns to this list,
  // with its filters, and says so.
  const openState = useMemo(
    () => ({
      back: {
        to: `${location.pathname}${location.search}`,
        label: NAMES.tracked.label,
      },
    }),
    [location.pathname, location.search],
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
  // A new filter is a new list, and a selection kept from the old one would
  // change people the person can no longer see.
  const chooseTracking = (next: TrackingFilter) => {
    setView({ tracking: next });
    setSelectedIds(new Set());
  };
  const chooseSpoke = (next: SpokeFilter) => {
    setView({ spoke: next });
    setSelectedIds(new Set());
  };
  const clearFilters = () => {
    setView({
      tracking: DEFAULT_TRACKED_VIEW.tracking,
      spoke: DEFAULT_TRACKED_VIEW.spoke,
    });
    setSelectedIds(new Set());
  };
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
  // Off until the list is long enough to need it. An enabled virtualizer
  // takes over the scroller when it attaches and puts it back at its own
  // offset, which sent a hash link's group (`#fading`) back to the top
  // when the page opened with the contacts already loaded.
  const virtualizer = useVirtualizer({
    enabled: virtual,
    count: virtual ? items.length : 0,
    getScrollElement: () => scrollRef.current,
    scrollMargin,
    estimateSize: (index) => (items[index]?.kind === "heading" ? 48 : 60),
    // The room under the last row, which the card's padding cannot give a
    // list of placed rows.
    paddingEnd: 8,
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
      openState={openState}
    />
  );

  return (
    // The page's scroller keeps its bar's lane, as the shell's does, so the
    // cards sit under the title whether or not the page scrolls.
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto [scrollbar-gutter:stable]"
      style={barRoom ? { scrollPaddingBottom: barRoom } : undefined}
    >
      {/* Select sits with the title, in the header's actions, as on the
          Network list. In the row below it wrapped to a line of its own on
          a phone, under the full-width order control. */}
      <SettingsHeaderActions>
        {selectMode ? (
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
        )}
      </SettingsHeaderActions>

      <div className={cn(SETTINGS_BOX, "pt-4 pb-24 md:pb-6 space-y-5")}>
        {/* The search, the order, and two rows of filters, each pill with
            the number it would show, as on the Enrichment page. */}
        <div className={cn(CARD, "p-4 space-y-3")}>
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
              onChange={(next) => setView({ order: next })}
              options={[
                { value: "name", label: "Name" },
                { value: "spoke", label: "Last spoke" },
                { value: "recent", label: "Recently tracked" },
              ]}
            />
          </div>
          <FilterRow
            idPrefix="tracked-filter"
            label="Tracking"
            pills={TRACKING_PILLS}
            value={tracking}
            counts={counts.trackingCounts}
            onChange={chooseTracking}
          />
          <FilterRow
            idPrefix="tracked-filter"
            label="Last spoke"
            pills={SPOKE_PILLS}
            value={spoke}
            counts={counts.spokeCounts}
            onChange={chooseSpoke}
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

        {/* Nobody tracked: the way in is the Not tracked group under it.
            With Tracked chosen that group is filtered out, so the button
            brings it back. */}
        {nobodyTracked && !query && tracking !== "not_tracked" && (
          <EmptyState
            icon={Radar}
            title="Nobody is tracked yet"
            body={TRACKED_INTRO}
            action={
              tracking === "tracked"
                ? {
                    label: "Show people to track",
                    onClick: () => chooseTracking("not_tracked"),
                  }
                : undefined
            }
          />
        )}

        {!isLoading &&
          visible.length === 0 &&
          (query || filtered) &&
          !(nobodyTracked && tracking === "tracked" && !query) && (
            <EmptyState
              icon={SearchX}
              title={
                query
                  ? `Nobody matches "${query}"`
                  : "Nobody matches these filters"
              }
              body={
                query
                  ? "Try fewer letters, or search a company or a role"
                  : "Try another choice in either row"
              }
              action={
                query
                  ? { label: "Clear search", onClick: () => setQuery("") }
                  : { label: "Clear filters", onClick: clearFilters }
              }
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
                  // A heading spans the card, as it does on a group's own
                  // card, and a row sits 8 px in from each side. A child
                  // placed this way ignores the card's padding.
                  style={{
                    position: "absolute",
                    top: 0,
                    left: item.kind === "heading" ? 0 : 8,
                    width:
                      item.kind === "heading" ? "100%" : "calc(100% - 16px)",
                    transform: `translateY(${virtualItem.start - scrollMargin}px)`,
                  }}
                >
                  {item.kind === "heading" ? (
                    <div
                      className={cn(
                        "overflow-hidden",
                        virtualItem.index === 0 && "rounded-t-2xl",
                      )}
                    >
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
