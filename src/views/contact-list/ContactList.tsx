/**
 * ContactList — Left-pane master view for browsing and filtering contacts.
 *
 * This is a thin composition shell that wires together:
 * - {@link useContactListFilters} — Search, filter, sort logic
 * - {@link useMultiSelect} — Multi-select state and bulk actions
 * - {@link useContactListKeyboard} — Keyboard navigation (j/k/↑/↓)
 * - {@link useRovingList} — The list as one Tab stop, arrows inside it
 * - {@link ContactListModals} — All modal dialogs (create, import, bulk ops)
 *
 * The component itself handles only layout rendering and UX hooks
 * (scroll restoration, pull-to-refresh, context menus, drag-to-reorder).
 */
import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import { useMatch, useNavigate, useLocation } from "react-router-dom";
import {
  Search,
  Users,
  Upload,
  UserPlus,
  ListPlus,
  Square,
  FileText,
  SearchX,
  Clock,
  Archive,
  Copy,
  ChevronDown,
} from "lucide-react";
import {
  useContacts,
  useLists,
  useCreateList,
  useReorderLists,
  useArchiveContact,
  useBulkUpdateContacts,
} from "../../api";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useListDensity, type ListDensity } from "../../hooks/useListDensity";
import { AlphabetRail, bucketFor } from "./AlphabetRail";
import type { Contact, ContactUpdateData } from "../../types";
import { ContextMenu, useContextMenu } from "../../components/ui/ContextMenu";
import { AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { SEARCH_INPUT, filterPill, PAGE_TITLE } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useScrollRestoration } from "../../hooks/useScrollRestoration";
import { usePullToRefresh } from "../../hooks/usePullToRefresh";
import { PullIndicator } from "../../components/ui/PullIndicator";
import { EmptyState } from "../../components/ui/EmptyState";
import { CorvidMark } from "../../components/brand/CorvidMark";
import {
  useRecentContacts,
  useRecentContactsLimit,
} from "../../hooks/useRecentContacts";
import { useLongPress } from "../../hooks/useLongPress";

import { ContactListItem } from "./ContactListItem";
import { BulkActionToolbar } from "./BulkActionToolbar";
import { ListIcon } from "./CreateListModal";
import { ContactListModals } from "./ContactListModals";
import {
  useContactListFilters,
  SORT_CHOICES,
} from "./hooks/useContactListFilters";
import { useMultiSelect } from "./hooks/useMultiSelect";
import { useContactListKeyboard } from "./hooks/useContactListKeyboard";
import { useRovingList, type RovingItemProps } from "./useRovingList";
import { useRecent } from "../../contexts/SessionContext";
import { NAMES } from "../../lib/names";
import { ActionMenu } from "../../components/ui/ActionMenu";
import {
  OPEN_IMPORT_EVENT,
  OPEN_NEW_CONTACT_EVENT,
  OPEN_SMART_PASTE_EVENT,
} from "../../lib/appEvents";

// ---------------------------------------------------------------------------
// FilterButton — Pill-style filter tab for the contact list header
// ---------------------------------------------------------------------------

const FilterButton = ({
  label,
  icon,
  count,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    // 28 px on screen, a 44 px tap box from hit-area. The row it sits in
    // scrolls sideways, so the row carries the padding the box needs.
    className={cn(filterPill(active), "hit-area")}
    aria-label={`Filter: ${label} (${count})`}
    aria-pressed={active}
  >
    {icon}
    {label}
    <span
      className={`ml-0.5 text-[11px] ${active ? "text-primary" : "opacity-50"}`}
    >
      {count}
    </span>
  </button>
);

// ---------------------------------------------------------------------------
// ContactRowWrapper — attaches context menu + long-press + recordVisit to a row
// ---------------------------------------------------------------------------

interface ContactRowWrapperProps {
  contact: Contact;
  density: ListDensity;
  active: boolean;
  isFlashing: boolean;
  isSelectMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onEnterSelectMode: () => void;
  handleContextMenu: ReturnType<typeof useContextMenu>["handleContextMenu"];
  recordVisit: (id: string) => void;
  archiveContact: (contact: { id: string; name: string }) => Promise<void>;
  navigate: (path: string) => void;
  rovingIndex: number;
  tabIndex: RovingItemProps["tabIndex"];
  onRowKeyDown: RovingItemProps["onKeyDown"];
  onRowFocus: RovingItemProps["onFocus"];
}

const ContactRowWrapper = React.memo(
  ({
    contact,
    density,
    active,
    isFlashing,
    isSelectMode,
    isSelected,
    onToggleSelect,
    onEnterSelectMode,
    handleContextMenu,
    recordVisit,
    archiveContact,
    navigate,
    rovingIndex,
    tabIndex,
    onRowKeyDown,
    onRowFocus,
  }: ContactRowWrapperProps) => {
    const contextItems = useMemo(
      () => [
        {
          id: "view",
          label: "View Contact",
          icon: <UserPlus className="w-3.5 h-3.5" />,
          onClick: () => navigate(`/contact/${contact.id}`),
        },
        {
          id: "copy-email",
          label: contact.emails?.[0]?.email ? `Copy Email` : "No email",
          icon: <Copy className="w-3.5 h-3.5" />,
          disabled: !contact.emails?.[0]?.email,
          onClick: () => {
            navigator.clipboard.writeText(contact.emails![0].email);
            toast.success("Email copied");
          },
        },
        { id: "sep1", label: "", separator: true as const },
        {
          id: "archive",
          label: "Archive",
          icon: <Archive className="w-3.5 h-3.5" />,
          onClick: () => archiveContact({ id: contact.id, name: contact.name }),
        },
      ],
      [contact.id, contact.name, contact.emails, navigate, archiveContact],
    );

    const longPress = useLongPress(() => {
      if (!isSelectMode) {
        onEnterSelectMode();
      }
      onToggleSelect(contact.id);
    });

    return (
      <div
        // Presentational: the interactive element is the <Link> inside
        // ContactListItem. Enter on that link fires a click that bubbles to
        // this handler, so keyboard users record a visit without this wrapper
        // needing to be focusable itself.
        role="presentation"
        onContextMenu={(e) => handleContextMenu(e, contextItems)}
        onClick={() => recordVisit(contact.id)}
        {...longPress}
        className={cn(
          "rounded-xl transition-all duration-300",
          isFlashing &&
            "ring-2 ring-primary/40 shadow-[0_0_12px_rgba(0,113,156,0.2)]",
        )}
      >
        <ContactListItem
          contact={contact}
          density={density}
          active={active}
          isSelectMode={isSelectMode}
          isSelected={isSelected}
          onToggleSelect={onToggleSelect}
          rovingIndex={rovingIndex}
          tabIndex={tabIndex}
          onRowKeyDown={onRowKeyDown}
          onRowFocus={onRowFocus}
        />
      </div>
    );
  },
);

// ---------------------------------------------------------------------------
// ContactList — Main component
// ---------------------------------------------------------------------------

export const ContactList = () => {
  const { data: contacts = [], isLoading, isError, refetch } = useContacts();

  const { data: lists = [] } = useLists();
  /**
   * The open contact, read from the address.
   *
   * The list is mounted on the catch-all route (`path="*"`), so `useParams`
   * had no `:id` to give it and this was always undefined. That meant no row
   * was ever marked current — no ring, no `aria-current` — and the j/k keys,
   * which step from the current row, went to the first contact every time.
   */
  const id = useMatch("/contact/:id")?.params.id;
  const navigate = useNavigate();
  const location = useLocation();

  // ── Extracted hooks ─────────────────────────────────────────────────
  const filters = useContactListFilters(contacts);
  const multiSelect = useMultiSelect(filters.filteredContacts);
  const bulkUpdate = useBulkUpdateContacts();

  // ── UX hooks ────────────────────────────────────────────────────────
  usePageTitle(NAMES.network.title);
  const scrollRef = useScrollRestoration<HTMLDivElement>(
    `contact-list:${filters.filterMode}:${filters.searchQuery}`,
    !isLoading,
  );
  const {
    containerRef: pullRef,
    isPulling,
    pullProgress,
    isRefreshing,
    pullDistance,
  } = usePullToRefresh(
    async () => {
      await refetch();
    },
    { disabled: typeof window !== "undefined" && window.innerWidth >= 768 },
  );
  const { contextMenu, handleContextMenu, closeContextMenu } = useContextMenu();
  const archiveContact = useArchiveContact();
  const { recentIds, recordVisit } = useRecentContacts();
  const { limit: recentLimit } = useRecentContactsLimit();

  // Stable archive handler — an inline closure here would defeat
  // ContactRowWrapper's React.memo (new function identity every render).
  const archiveContactMutateAsync = archiveContact.mutateAsync;
  const handleArchiveContact = useCallback(
    async (contact: { id: string; name: string }) => {
      await archiveContactMutateAsync(contact.id);
      toast.success(`Archived "${contact.name}"`);
    },
    [archiveContactMutateAsync],
  );

  // ── Visual flash: highlight newly created contact for 2s ────────────
  const [flashId, setFlashId] = useState<string | null>(null);

  // Merge containerRefs — both pullRef and scrollRef point to the same element
  const listScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      (pullRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    },
    [scrollRef, pullRef],
  );

  // ── Modal visibility state ──────────────────────────────────────────
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSmartPasteOpen, setIsSmartPasteOpen] = useState(false);
  const [isCreateListOpen, setIsCreateListOpen] = useState(false);
  const [isAddToListOpen, setIsAddToListOpen] = useState(false);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);

  const createList = useCreateList();
  const reorderLists = useReorderLists();

  // Listen to window events from StartPanel or other components
  useEffect(() => {
    const onOpenNew = () => setIsModalOpen(true);
    const onOpenImport = () => setIsImportOpen(true);
    const onOpenSmartPaste = () => setIsSmartPasteOpen(true);
    window.addEventListener(OPEN_NEW_CONTACT_EVENT, onOpenNew);
    window.addEventListener(OPEN_IMPORT_EVENT, onOpenImport);
    window.addEventListener(OPEN_SMART_PASTE_EVENT, onOpenSmartPaste);
    return () => {
      window.removeEventListener(OPEN_NEW_CONTACT_EVENT, onOpenNew);
      window.removeEventListener(OPEN_IMPORT_EVENT, onOpenImport);
      window.removeEventListener(OPEN_SMART_PASTE_EVENT, onOpenSmartPaste);
    };
  }, []);

  // Support ?new=1 query param (e.g. from Pulse "New contact" button)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("new") === "1") {
      setIsModalOpen(true);
      params.delete("new");
      const newSearch = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: newSearch ? `?${newSearch}` : "",
        },
        { replace: true },
      );
    }
  }, [location.search, location.pathname, navigate]);

  // ── Keyboard navigation ─────────────────────────────────────────────
  useContactListKeyboard({
    filteredContacts: filters.filteredContacts,
    currentId: id,
    isSelectMode: multiSelect.isSelectMode,
    exitSelectMode: multiSelect.exitSelectMode,
    navigate: (path: string) => navigate(path),
    locationSearch: location.search,
    onNewContact: () => setIsModalOpen(true),
    onSmartPaste: () => setIsSmartPasteOpen(true),
  });

  // ── Drag-to-reorder lists ───────────────────────────────────────────
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setDragOverIdx(idx);
  };
  const handleDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }
    const newOrder = [...lists];
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(idx, 0, moved);
    reorderLists.mutate(newOrder.map((l) => l.id));
    setDragIdx(null);
    setDragOverIdx(null);
  };
  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  // ── Shorthand refs ──────────────────────────────────────────────────
  const {
    filteredContacts,
    inputValue,
    searchQuery,
    setSearchQuery,
    filterMode,
    setFilterMode,
    sortBy,
    currentSort,
    setSortOption,
  } = filters;
  const {
    isSelectMode,
    selectedIds,
    selectedCount,
    toggleSelect,
    enterSelectMode,
    exitSelectMode,
    clearSelection,
    selectAll,
    isPending,
  } = multiSelect;

  const sortMenuItems = useMemo(
    () =>
      SORT_CHOICES.map((choice) => ({
        id: choice.id,
        label: choice.label,
        checked: currentSort.id === choice.id,
        onSelect: () => setSortOption(choice.id),
      })),
    [currentSort.id, setSortOption],
  );

  const newMenuItems = useMemo(
    () => [
      {
        id: "new-contact",
        label: "New contact",
        icon: UserPlus,
        onSelect: () => setIsModalOpen(true),
      },
      {
        id: "add-from-text",
        label: "Add from text",
        icon: FileText,
        onSelect: () => setIsSmartPasteOpen(true),
      },
      {
        id: "new-list",
        label: "New list",
        icon: ListPlus,
        onSelect: () => setIsCreateListOpen(true),
      },
    ],
    [],
  );

  /**
   * Cmd/Ctrl+A selects every visible contact while in select mode.
   *
   * Only while selecting, and only when focus is not in a field: outside those
   * two conditions Cmd+A means "select all text", and stealing that is the
   * kind of shortcut hijack that makes an app feel hostile. Selects the
   * *filtered* set, matching what the "Select all" button already does.
   */
  useEffect(() => {
    if (!isSelectMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "a" || !(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
      ) {
        return;
      }
      event.preventDefault();
      selectAll();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSelectMode, selectAll]);

  // ── Derived data (hoisted out of JSX to avoid recomputing per render) ──
  const activeContactCount = useMemo(
    () => contacts.filter((c) => !c.isArchived).length,
    [contacts],
  );

  const recentContacts = useMemo(
    () =>
      recentIds
        .map((rid) => contacts.find((c) => c.id === rid && !c.isArchived))
        .filter(Boolean)
        .slice(0, recentLimit) as typeof contacts,
    [recentIds, contacts, recentLimit],
  );

  // ── Density ─────────────────────────────────────────────────────────
  const { density, metrics } = useListDensity();

  // ── Virtualization ──────────────────────────────────────────────────
  /**
   * How far the virtual list starts below the top of the scroll container.
   *
   * The "Recent" block and the pull-to-refresh indicator live inside the same
   * scroller, above the virtual list. Without telling the virtualizer about
   * that gap, its offsets are correct *relative to its own container* — so
   * rows render in the right place — but `scrollToIndex` computes a scrollTop
   * as if the list began at the top of the scroller, and every jump lands
   * short by exactly the height of whatever is above it. That is invisible
   * until something actually jumps, which is why the alphabet rail is what
   * surfaced it.
   */
  const virtualListRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const rowVirtualizer = useVirtualizer({
    count: filteredContacts.length,
    getItemKey: React.useCallback(
      (index) => filteredContacts[index].id,
      [filteredContacts],
    ),
    getScrollElement: () => scrollRef.current,
    scrollMargin,
    // Only an estimate — rows are measured for real by `measureElement`
    // below — but it must track density or the scrollbar jumps as the user
    // scrolls into rows that have not been measured yet.
    estimateSize: () => metrics.rowHeight,
    overscan: 5, // Render 5 items outside viewport for smooth scrolling
  });

  React.useLayoutEffect(() => {
    const list = virtualListRef.current;
    const scroller = scrollRef.current;
    if (!list || !scroller) return;
    const offset =
      list.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    setScrollMargin((previous) =>
      Math.abs(previous - offset) > 1 ? offset : previous,
    );
    // Recomputed whenever the block above the list can change height: the
    // Recent row count, its preference, the density of those rows, and
    // whether a search collapses the section entirely.
  }, [
    recentContacts.length,
    recentLimit,
    density,
    searchQuery,
    filterMode,
    isLoading,
    pullDistance,
    scrollRef,
  ]);

  // ── Alphabet rail ───────────────────────────────────────────────────
  // Only meaningful when the list is actually alphabetical, and only worth
  // the screen width once scrolling is a chore.
  const showAlphabetRail =
    sortBy === "name" && !searchQuery && filteredContacts.length >= 15;

  /** Bucket → index of its first contact. Rebuilt only when the list changes. */
  const bucketIndex = useMemo(() => {
    const map = new Map<string, number>();
    if (!showAlphabetRail) return map;
    filteredContacts.forEach((contact, i) => {
      const bucket = bucketFor(contact.name);
      if (!map.has(bucket)) map.set(bucket, i);
    });
    return map;
  }, [filteredContacts, showAlphabetRail]);

  /**
   * Which letter is at the top of the viewport, for the rail's highlight.
   *
   * Derived from the virtualizer's own first visible item rather than from a
   * scroll listener, so it cannot drift out of step with what is rendered.
   */
  const virtualItems = rowVirtualizer.getVirtualItems();
  const activeBucket = showAlphabetRail
    ? (() => {
        const first = virtualItems.find(
          (item) => item.end > (rowVirtualizer.scrollOffset ?? 0),
        );
        const contact = first ? filteredContacts[first.index] : undefined;
        return contact ? bucketFor(contact.name) : null;
      })()
    : null;

  const jumpToIndex = useCallback(
    (index: number) => {
      // By index, never by offset: offsets for unmeasured rows are estimates,
      // and jumping to one lands in the wrong place.
      rowVirtualizer.scrollToIndex(index, { align: "start" });
    },
    [rowVirtualizer],
  );

  // ── Roving Tab stop ─────────────────────────────────────────────────
  // The Recent rows and the full list are one list to the keyboard: Recent
  // first, then everyone. Arrow Down from the last recent contact carries on
  // into the list rather than stopping at an invisible seam.
  const recentCount =
    !isLoading && !searchQuery && filterMode === "all"
      ? recentContacts.length
      : 0;
  const rowAt = (index: number) =>
    index < recentCount
      ? { contact: recentContacts[index], elementId: "recent-contact" }
      : {
          contact: filteredContacts[index - recentCount],
          elementId: "contact-row",
        };
  const openIndex = id ? filteredContacts.findIndex((c) => c.id === id) : -1;
  const roving = useRovingList({
    count: recentCount + filteredContacts.length,
    selectedIndex: openIndex >= 0 ? recentCount + openIndex : -1,
    getLabel: (index) => rowAt(index).contact?.name ?? "",
    getElement: (index) => {
      const { contact, elementId } = rowAt(index);
      return contact
        ? document.getElementById(`${elementId}-${contact.id}`)
        : null;
    },
    scrollToIndex: (index) => {
      if (index < recentCount) {
        document
          .getElementById(`recent-contact-${recentContacts[index].id}`)
          ?.scrollIntoView({ block: "nearest" });
      } else {
        rowVirtualizer.scrollToIndex(index - recentCount, { align: "auto" });
      }
    },
    isRendered: (index) =>
      index < recentCount ||
      virtualItems.some((item) => item.index === index - recentCount),
  });

  /**
   * Back from a contact puts focus on the row it was opened from.
   *
   * On a phone, and on a tablet in portrait, the list and the contact take
   * turns on screen. Leaving the contact removes the element that had focus,
   * so focus fell to the document and the next Tab started from the top of
   * the page. Only when focus really was lost: a sidebar link that navigated
   * here keeps its own focus.
   */
  const { lastContactId } = useRecent();
  const previousId = useRef(id);
  const { focusIndex } = roving;
  useEffect(() => {
    const wasOpen = previousId.current;
    previousId.current = id;
    if (!wasOpen || id) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const index = filteredContacts.findIndex((c) => c.id === lastContactId);
    if (index >= 0) focusIndex(recentCount + index);
  }, [id, lastContactId, filteredContacts, recentCount, focusIndex]);

  // One h1 per page: the list's title is the page heading on the Network
  // page, and a section heading beside an open contact, whose name is the h1.
  const TitleTag = id ? "h2" : "h1";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {" "}
      <div className="p-4 bg-surface-container-lowest sticky top-0 z-10 space-y-3">
        <div className="flex justify-between items-center">
          {isSelectMode ? (
            <>
              <TitleTag className={PAGE_TITLE}>
                {selectedCount} selected
              </TitleTag>
              <div className="flex items-center gap-2">
                <button
                  onClick={
                    selectedCount === filteredContacts.length
                      ? clearSelection
                      : selectAll
                  }
                  className="hit-area text-xs md:text-sm font-bold text-on-primary-wash px-3 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 transition-colors whitespace-nowrap"
                >
                  {selectedCount === filteredContacts.length
                    ? "Deselect all"
                    : "Select all"}
                </button>
                <button
                  onClick={exitSelectMode}
                  className="hit-area text-xs md:text-sm font-medium text-on-surface px-3 py-1.5 rounded-xl bg-surface-container-high hover:bg-surface-container-highest transition-colors whitespace-nowrap"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <TitleTag className={PAGE_TITLE}>{NAMES.network.label}</TitleTag>
              <div className="flex items-center gap-2">
                <button
                  onClick={enterSelectMode}
                  className="hit-area flex items-center justify-center gap-1.5 rounded-xl transition-colors font-medium text-xs md:text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high p-2 md:px-3 md:py-1.5"
                  aria-label="Select"
                >
                  <Square className="w-4 h-4 md:hidden" aria-hidden="true" />
                  <span className="hidden md:inline">Select</span>
                </button>
                <button
                  onClick={() => setIsImportOpen(true)}
                  className="hit-area flex items-center justify-center gap-1.5 rounded-xl transition-colors font-medium text-xs md:text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high p-2 md:px-3 md:py-1.5"
                  aria-label="Import"
                >
                  <Upload className="w-4 h-4 md:hidden" aria-hidden="true" />
                  <span className="hidden md:inline">Import</span>
                </button>
                <ActionMenu
                  label="+ New"
                  triggerClassName="hit-area px-2.5 py-1.5 md:px-3 md:py-1.5 bg-primary/10 text-on-primary-wash hover:bg-primary/20 rounded-xl transition-colors font-bold text-xs md:text-sm"
                  triggerContent={
                    <span className="inline-flex items-center gap-1">
                      + New{" "}
                      <ChevronDown
                        className="w-3.5 h-3.5 opacity-70"
                        aria-hidden="true"
                      />
                    </span>
                  }
                  items={newMenuItems}
                />
              </div>
            </>
          )}
        </div>

        <div className="flex gap-1.5 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
            <input
              aria-label="Search contacts"
              id="search-input"
              type="text"
              placeholder={
                isSelectMode
                  ? `${selectedCount} selected — search to filter`
                  : "Search..."
              }
              value={inputValue}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchQuery("");
                  e.currentTarget.blur();
                }
              }}
              className={SEARCH_INPUT}
            />
            {inputValue && (
              <button
                onClick={() => setSearchQuery("")}
                className="hit-area absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          {/* Sort ActionMenu */}
          <ActionMenu
            label={currentSort.label}
            triggerClassName="hit-area px-2.5 py-1.5 rounded-xl transition-all shrink-0 flex items-center justify-center gap-1 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
            triggerContent={
              <span className="flex items-center gap-1 text-xs md:text-sm font-medium">
                <span className="truncate max-w-[120px] sm:max-w-[160px]">
                  {currentSort.label}
                </span>
                <ChevronDown
                  className="w-3.5 h-3.5 opacity-70 shrink-0"
                  aria-hidden="true"
                />
              </span>
            }
            align="end"
            items={sortMenuItems}
          />
        </div>

        {/* Filter tabs — horizontal scroll row, hidden in select mode, only when at least one list exists */}
        {!isSelectMode && lists.length > 0 && (
          <div className="relative">
            <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-surface-container-lowest to-transparent z-10" />
            <div
              id="filter-pills-row"
              // A scroller clips what sits outside its padding box, so the
              // 8 px above and below give each pill's 44 px tap box room.
              // The negative margins keep the row where it was.
              className="flex gap-1.5 overflow-x-auto scrollbar-hide -my-2 pt-2 pb-2.5"
            >
              <FilterButton
                label="All"
                icon={<Users className="w-3.5 h-3.5" />}
                count={activeContactCount}
                active={filterMode === "all"}
                onClick={() => setFilterMode("all")}
              />
              {lists.map((list, idx) => (
                <div
                  key={list.id}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={() => handleDrop(idx)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    "transition-all cursor-grab active:cursor-grabbing shrink-0",
                    dragOverIdx === idx &&
                      dragIdx !== idx &&
                      "ring-2 ring-primary/40 rounded-xl",
                    dragIdx === idx && "opacity-40",
                  )}
                >
                  <FilterButton
                    label={list.name}
                    icon={<ListIcon icon={list.icon} className="w-3.5 h-3.5" />}
                    count={list.memberCount ?? 0}
                    active={filterMode === list.id}
                    onClick={() =>
                      setFilterMode(filterMode === list.id ? "all" : list.id)
                    }
                  />
                </div>
              ))}
              <div className="shrink-0 w-6" aria-hidden />
            </div>
          </div>
        )}
      </div>
      {/*
        Contact list.

        The wrapper exists so the alphabet rail can be positioned against the
        *visible* list area. Rendered inside the scroller, an absolutely
        positioned rail resolves its `top-0 bottom-0` against the full scroll
        height and then scrolls away with the content — so it both disappears
        and maps pointer positions against a box thousands of pixels tall.
      */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={listScrollRef}
          id="contact-list"
          {...roving.containerProps}
          className="h-full overflow-y-auto p-4 space-y-2 pb-24 md:pb-4 overscroll-contain outline-none"
        >
          {/* Pull-to-refresh indicator — mobile only */}
          <PullIndicator
            isPulling={isPulling}
            isRefreshing={isRefreshing}
            progress={pullProgress}
            pullDistance={pullDistance}
          />

          {isLoading && (
            <div className="px-2 py-3 space-y-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-xl animate-pulse"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="w-10 h-10 rounded-full bg-surface-container-high shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="h-3.5 bg-surface-container-high rounded-full w-3/5" />
                    <div className="h-3 bg-surface-container rounded-full w-2/5" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/*
          Empty state: 0 contacts total (onboarding).

          Gated on `!isError` because a failed fetch also produces zero
          contacts, and telling someone their network is empty when the server
          merely went away is the most alarming thing this app could say. The
          ConnectionBanner explains that case instead.
        */}
          {/*
            Import leads. Nobody builds a personal CRM by typing four hundred
            people in by hand: they arrive with an export from Apple, Google
            or LinkedIn. Adding one by hand stays on the header's + button.
          */}
          {!isLoading && !isError && activeContactCount === 0 && (
            <EmptyState
              illustration={
                <CorvidMark size={64} className="text-primary/60" />
              }
              title="Your network is empty"
              body="Bring in the people you already have, or add one by hand."
              action={{
                label: "Import",
                icon: Upload,
                onClick: () => setIsImportOpen(true),
              }}
              level={id ? 3 : 2}
            />
          )}

          {/* Empty state: search/filter has no results */}
          {!isLoading &&
            activeContactCount > 0 &&
            filteredContacts.length === 0 &&
            (searchQuery ? (
              <EmptyState
                icon={SearchX}
                title={`Nobody matches "${searchQuery}"`}
                body="Try fewer letters, or search a company or a tag."
                action={{
                  label: "Clear search",
                  onClick: () => setSearchQuery(""),
                }}
                level={id ? 3 : 2}
              />
            ) : (
              <EmptyState
                icon={ListPlus}
                title="No contacts in this list"
                body="Add people from their contact page, or select several and choose List."
                level={id ? 3 : 2}
              />
            ))}

          {/* ── Recent contacts strip ─────────────────────────────────────── */}
          {!isLoading &&
            !searchQuery &&
            filterMode === "all" &&
            recentContacts.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-1.5 px-1 mb-1.5">
                  <Clock className="w-3 h-3 text-on-surface-variant" />
                  <span className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                    Recent
                  </span>
                </div>
                <div className="space-y-1">
                  {recentContacts.map((contact, index) => {
                    const item = roving.getItemProps(index);
                    return (
                      <ContactListItem
                        key={`recent-${contact.id}`}
                        idPrefix="recent-contact"
                        contact={contact}
                        density={density}
                        active={id === contact.id}
                        isSelectMode={isSelectMode}
                        isSelected={selectedIds.has(contact.id)}
                        onToggleSelect={toggleSelect}
                        rovingIndex={index}
                        tabIndex={item.tabIndex}
                        onRowKeyDown={item.onKeyDown}
                        onRowFocus={item.onFocus}
                      />
                    );
                  })}
                </div>
                <div className="mt-3 mb-1 h-px bg-surface-container-high mx-1" />
              </div>
            )}

          <div
            ref={virtualListRef}
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
              // Keep rows clear of the rail rather than letting it sit on top of
              // a truncated name.
              paddingRight: showAlphabetRail ? "1.5rem" : undefined,
            }}
          >
            {virtualItems.map((virtualItem) => {
              const contact = filteredContacts[virtualItem.index];
              const item = roving.getItemProps(recentCount + virtualItem.index);
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: showAlphabetRail ? "calc(100% - 1.5rem)" : "100%",
                    transform: `translateY(${virtualItem.start - scrollMargin}px)`,
                    paddingBottom: "8px", // Replaces space-y-2
                  }}
                >
                  <ContactRowWrapper
                    contact={contact}
                    density={density}
                    active={id === contact.id}
                    isFlashing={flashId === contact.id}
                    isSelectMode={isSelectMode}
                    isSelected={selectedIds.has(contact.id)}
                    onToggleSelect={toggleSelect}
                    onEnterSelectMode={enterSelectMode}
                    handleContextMenu={handleContextMenu}
                    recordVisit={recordVisit}
                    archiveContact={handleArchiveContact}
                    navigate={navigate}
                    rovingIndex={recentCount + virtualItem.index}
                    tabIndex={item.tabIndex}
                    onRowKeyDown={item.onKeyDown}
                    onRowFocus={item.onFocus}
                  />
                </div>
              );
            })}
          </div>

          {/* Context menu — portal-rendered, shared across all rows */}
          <ContextMenu {...contextMenu} onClose={closeContextMenu} />
        </div>

        {showAlphabetRail && (
          <AlphabetRail
            index={bucketIndex}
            activeBucket={activeBucket}
            onJump={jumpToIndex}
          />
        )}
      </div>
      <AnimatePresence>
        {isSelectMode && (
          <BulkActionToolbar
            isPending={isPending}
            onArchive={multiSelect.handleBulkArchive}
            onAddToList={() => setIsAddToListOpen(true)}
            onEditField={() => setIsBulkEditOpen(true)}
            onColorChange={multiSelect.handleBulkColorChange}
            onExportCSV={multiSelect.handleExportCSV}
            onDelete={multiSelect.handleBulkDelete}
          />
        )}
      </AnimatePresence>
      {/* ── All Modals ───────────────────────────────────────────────── */}
      <ContactListModals
        selectedCount={selectedCount}
        isAddToListOpen={isAddToListOpen}
        onCloseAddToList={() => setIsAddToListOpen(false)}
        lists={lists}
        onBulkAddToList={(listId) => {
          multiSelect.handleBulkAddToList(listId);
          setIsAddToListOpen(false);
        }}
        isBulkAddToListPending={multiSelect.isBulkAddToListPending}
        isBulkEditOpen={isBulkEditOpen}
        onCloseBulkEdit={() => setIsBulkEditOpen(false)}
        onBulkEditApply={(field, value) => {
          const ids = Array.from(selectedIds) as string[];
          bulkUpdate.mutate(
            { ids, data: { [field]: value } as ContactUpdateData },
            {
              onSuccess: ({ count }) => {
                toast.success(
                  `Updated ${count} contact${count !== 1 ? "s" : ""}`,
                );
                setIsBulkEditOpen(false);
                exitSelectMode();
              },
              onError: (err) =>
                toast.error(
                  `Update failed: ${err instanceof Error ? err.message : String(err)}`,
                ),
            },
          );
        }}
        isBulkEditPending={bulkUpdate.isPending}
        isModalOpen={isModalOpen}
        onCloseModal={() => setIsModalOpen(false)}
        onContactCreated={(newId) => {
          setFlashId(newId);
          setTimeout(() => setFlashId(null), 2000);
        }}
        isSmartPasteOpen={isSmartPasteOpen}
        onCloseSmartPaste={() => {
          setIsSmartPasteOpen(false);
          // NOTE: After smart paste extracts data, the modal component internally
          // opens the New Contact modal via its shared parsedData state.
          setIsModalOpen(true);
        }}
        isCreateListOpen={isCreateListOpen}
        onCloseCreateList={() => setIsCreateListOpen(false)}
        onCreateList={async (name, icon) => {
          try {
            await createList.mutateAsync({ name, icon });
            setIsCreateListOpen(false);
            toast.success(`Created list "${name}"`);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            toast.error(`Failed to create list: ${message}`);
          }
        }}
        isCreateListPending={createList.isPending}
        isImportOpen={isImportOpen}
        onCloseImport={() => setIsImportOpen(false)}
      />
    </div>
  );
};
