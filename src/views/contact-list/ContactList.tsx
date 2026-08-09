/**
 * ContactList — Left-pane master view for browsing and filtering contacts.
 *
 * This is a thin composition shell that wires together:
 * - {@link useContactListFilters} — Search, filter, sort logic
 * - {@link useMultiSelect} — Multi-select state and bulk actions
 * - {@link useContactListKeyboard} — Keyboard navigation (j/k/↑/↓)
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
import { useClickOutside } from "../../hooks/useClickOutside";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  Search,
  Plus,
  Users,
  Upload,
  UserPlus,
  ListPlus,
  CheckSquare,
  Square,
  FileText,
  Sparkles,
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarArrowDown,
  CalendarArrowUp,
  Clock,
  Archive,
  Copy,
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
import {
  DENSITY_METRICS,
  useListDensity,
  type ListDensity,
} from "../../hooks/useListDensity";
import { AlphabetJumpButtons, AlphabetRail, bucketFor } from "./AlphabetRail";
import type { Contact, ContactUpdateData } from "../../types";
import { ContextMenu, useContextMenu } from "../../components/ui/ContextMenu";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import {
  ICON_BTN,
  SEARCH_INPUT,
  filterPill,
  PAGE_TITLE,
} from "../../lib/styles";
import { cn } from "../../lib/utils";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useScrollRestoration } from "../../hooks/useScrollRestoration";
import { usePullToRefresh } from "../../hooks/usePullToRefresh";
import { PullIndicator } from "../../components/ui/PullIndicator";
import {
  useRecentContacts,
  useRecentContactsLimit,
} from "../../hooks/useRecentContacts";
import { useLongPress } from "../../hooks/useLongPress";

import { ContactListItem } from "./ContactListItem";
import { BulkActionToolbar } from "./BulkActionToolbar";
import { ListIcon } from "./CreateListModal";
import { ContactListModals } from "./ContactListModals";
import { useContactListFilters } from "./hooks/useContactListFilters";
import { useMultiSelect } from "./hooks/useMultiSelect";
import { useContactListKeyboard } from "./hooks/useContactListKeyboard";

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
    className={filterPill(active)}
    aria-label={`Filter: ${label} (${count})`}
    aria-pressed={active}
  >
    {icon}
    {label}
    <span
      className={`ml-0.5 text-[10px] ${active ? "text-primary" : "opacity-50"}`}
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
  handleContextMenu: ReturnType<typeof useContextMenu>["handleContextMenu"];
  recordVisit: (id: string) => void;
  archiveContact: (contact: { id: string; name: string }) => Promise<void>;
  navigate: (path: string) => void;
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
    handleContextMenu,
    recordVisit,
    archiveContact,
    navigate,
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

    const longPress = useLongPress(({ clientX, clientY }) => {
      const syntheticEvent = {
        preventDefault: () => {},
        clientX,
        clientY,
      } as unknown as React.MouseEvent;
      handleContextMenu(syntheticEvent, contextItems);
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
        style={{
          contentVisibility: "auto",
          // Must track the real row height, or `content-visibility` reserves
          // the wrong space for off-screen rows and the scrollbar lurches.
          containIntrinsicSize: `1px ${DENSITY_METRICS[density].rowHeight}px`,
        }}
      >
        <ContactListItem
          contact={contact}
          density={density}
          active={active}
          isSelectMode={isSelectMode}
          isSelected={isSelected}
          onToggleSelect={onToggleSelect}
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
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // ── Extracted hooks ─────────────────────────────────────────────────
  const filters = useContactListFilters(contacts);
  const multiSelect = useMultiSelect(filters.filteredContacts);
  const bulkUpdate = useBulkUpdateContacts();

  // ── UX hooks ────────────────────────────────────────────────────────
  usePageTitle("Network");
  const scrollRef = useScrollRestoration<HTMLDivElement>("contact-list");
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
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isAddToListOpen, setIsAddToListOpen] = useState(false);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);

  const createList = useCreateList();
  const reorderLists = useReorderLists();

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
  const addMenuRef = useRef<HTMLDivElement>(null);

  useClickOutside(addMenuRef, () => setShowAddMenu(false), showAddMenu);

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
    sortDir,
    cycleSortMode,
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
  }, [recentContacts.length, recentLimit, density, searchQuery, scrollRef]);

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
        const first = virtualItems[0];
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {" "}
      <div className="p-4 bg-surface-container-lowest sticky top-0 z-10 space-y-3">
        <div className="flex justify-between items-center">
          <h2 className={PAGE_TITLE}>Network</h2>
          <div className="flex items-center gap-1.5">
            {/* Multi-select toggle */}
            <button
              onClick={isSelectMode ? exitSelectMode : enterSelectMode}
              className={cn(
                ICON_BTN,
                isSelectMode && "text-primary bg-primary/10",
              )}
              title={isSelectMode ? "Exit Select Mode" : "Multi-Select"}
            >
              {isSelectMode ? (
                <CheckSquare className="w-5 h-5" />
              ) : (
                <Square className="w-5 h-5" />
              )}
            </button>

            {!isSelectMode && (
              <>
                <button
                  onClick={() => setIsImportOpen(true)}
                  className={ICON_BTN}
                  title="Import Contacts"
                  aria-label="Import contacts"
                >
                  <Upload className="w-5 h-5" />
                </button>
                <div className="relative" ref={addMenuRef}>
                  <button
                    onClick={() => setShowAddMenu(!showAddMenu)}
                    className="p-2 bg-primary/10 text-primary hover:bg-primary/20 rounded-xl transition-colors"
                    title="Add New..."
                    aria-label="Add new contact or list"
                    aria-expanded={showAddMenu}
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                  <AnimatePresence>
                    {showAddMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: 4, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.95 }}
                        className="absolute top-full right-0 mt-1 glass-panel rounded-xl shadow-xl z-50 overflow-hidden min-w-[190px]"
                      >
                        <button
                          onClick={() => {
                            setIsModalOpen(true);
                            setShowAddMenu(false);
                          }}
                          className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-on-surface hover:bg-surface-container-low transition-colors text-left"
                        >
                          <UserPlus className="w-4 h-4 text-primary shrink-0" />
                          Add Contact
                        </button>
                        <button
                          onClick={() => {
                            setIsSmartPasteOpen(true);
                            setShowAddMenu(false);
                          }}
                          className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-on-surface hover:bg-surface-container-low transition-colors text-left"
                        >
                          <FileText className="w-4 h-4 text-primary shrink-0" />
                          Add from Text
                          <span className="ml-auto text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                            AI
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            setIsCreateListOpen(true);
                            setShowAddMenu(false);
                          }}
                          className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-on-surface hover:bg-surface-container-low transition-colors text-left"
                        >
                          <ListPlus className="w-4 h-4 text-primary shrink-0" />
                          Create List
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            )}

            {/* Select mode: select all / deselect count badge */}
            {isSelectMode && (
              <button
                onClick={
                  selectedCount === filteredContacts.length
                    ? clearSelection
                    : selectAll
                }
                className="text-xs font-bold text-primary px-3 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 transition-colors whitespace-nowrap"
              >
                {selectedCount === filteredContacts.length
                  ? "Deselect All"
                  : "Select All"}
              </button>
            )}
          </div>
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
                className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          {/* Sort toggle */}
          <button
            onClick={cycleSortMode}
            className={cn(
              "p-2 rounded-xl transition-all shrink-0 flex items-center justify-center group relative",
              "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high",
            )}
            title={`Sort: ${sortBy === "name" ? "Name" : "Date Added"} ${sortDir === "asc" ? "↑" : "↓"}`}
            aria-label={`Sort by ${sortBy === "name" ? "name" : "date added"}, ${sortDir === "asc" ? "ascending" : "descending"}`}
          >
            {sortBy === "name" ? (
              sortDir === "asc" ? (
                <ArrowDownAZ className="w-4 h-4" />
              ) : (
                <ArrowUpAZ className="w-4 h-4" />
              )
            ) : sortDir === "desc" ? (
              <CalendarArrowDown className="w-4 h-4" />
            ) : (
              <CalendarArrowUp className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Filter tabs — horizontal scroll row, hidden in select mode */}
        {!isSelectMode && (
          <div className="relative">
            <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-surface-container-lowest to-transparent z-10" />
            <div
              id="filter-pills-row"
              className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5"
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
          className="h-full overflow-y-auto p-4 space-y-2 pb-24 md:pb-4 scrollbar-hide"
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
          {!isLoading && !isError && activeContactCount === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-center gap-4 p-6">
              <div className="w-16 h-16 rounded-2xl bg-primary/8 flex items-center justify-center">
                <Users className="w-8 h-8 text-primary" />
              </div>
              <div>
                <p className="font-bold text-base">Your network is empty</p>
                <p className="text-xs text-on-surface-variant mt-1 leading-relaxed max-w-[240px] mx-auto text-pretty">
                  Bring in the contacts you already have, or start one at a
                  time.
                </p>
              </div>
              {/*
                Import leads. Nobody builds a personal CRM by typing four
                hundred people in by hand — they arrive with an export from
                Apple, Google or LinkedIn, and the first screen either meets
                that or wastes their time. "Add contact" was the primary
                action here, which quietly framed the product as a place to
                do data entry.
              */}
              <div className="flex flex-col gap-2 w-full max-w-[220px]">
                <button
                  onClick={() => setIsImportOpen(true)}
                  className="btn-primary flex items-center justify-center gap-2 text-sm py-2.5"
                >
                  <Upload className="w-4 h-4" />
                  Import contacts
                </button>
                <button
                  onClick={() => setIsSmartPasteOpen(true)}
                  className="btn-secondary flex items-center justify-center gap-2 text-sm py-2.5"
                >
                  <Sparkles className="w-4 h-4" />
                  Smart Paste{" "}
                  <kbd className="hidden sm:inline text-[10px] bg-surface-container-high px-1.5 py-0.5 rounded-md font-mono">
                    V
                  </kbd>
                </button>
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="flex items-center justify-center gap-2 text-sm py-2 text-on-surface-variant hover:text-on-surface transition-colors font-bold"
                >
                  <UserPlus className="w-4 h-4" />
                  Add one by hand{" "}
                  <kbd className="hidden sm:inline text-[10px] bg-surface-container-high px-1.5 py-0.5 rounded-md font-mono">
                    N
                  </kbd>
                </button>
              </div>
              <p className="text-[11px] text-on-surface-variant max-w-[240px] text-pretty">
                Apple, Google and LinkedIn exports all work — Contrack merges
                duplicates across them for you.
              </p>
            </div>
          )}

          {/* Empty state: search/filter has no results */}
          {!isLoading &&
            activeContactCount > 0 &&
            filteredContacts.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 text-center gap-3 p-6">
                <Search className="w-8 h-8 text-on-surface-variant/30" />
                <div>
                  <p className="font-bold text-sm">
                    {searchQuery
                      ? `No results for "${searchQuery}"`
                      : "No contacts in this list"}
                  </p>
                  {searchQuery && (
                    <p className="text-xs text-on-surface-variant mt-1">
                      Try the AI search for deeper results
                    </p>
                  )}
                </div>
                {searchQuery && (
                  <button
                    onClick={() =>
                      navigate(`/search?q=${encodeURIComponent(searchQuery)}`)
                    }
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Search with AI
                  </button>
                )}
              </div>
            )}

          {/* ── Recent contacts strip ─────────────────────────────────────── */}
          {!isLoading &&
            !searchQuery &&
            filterMode === "all" &&
            recentContacts.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-1.5 px-1 mb-1.5">
                  <Clock className="w-3 h-3 text-on-surface-variant" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                    Recent
                  </span>
                </div>
                <div className="space-y-1">
                  {recentContacts.map((contact) => (
                    <ContactListItem
                      key={`recent-${contact.id}`}
                      contact={contact}
                      density={density}
                      active={id === contact.id}
                      isSelectMode={isSelectMode}
                      isSelected={selectedIds.has(contact.id)}
                      onToggleSelect={toggleSelect}
                    />
                  ))}
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
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
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
                    handleContextMenu={handleContextMenu}
                    recordVisit={recordVisit}
                    archiveContact={handleArchiveContact}
                    navigate={navigate}
                  />
                </div>
              );
            })}
          </div>

          {/* Context menu — portal-rendered, shared across all rows */}
          <ContextMenu {...contextMenu} onClose={closeContextMenu} />
        </div>

        {showAlphabetRail && (
          <>
            {/*
              Where-am-I marker for pointer users.

              The rail already highlights the active letter, but at 9px inside
              a 24px strip that is a hint you have to go looking for — fine on
              a phone where your thumb is already on it, close to invisible on
              a wide screen where the rail is a sliver at the far edge. This is
              the same information at a size you notice without trying.

              Deliberately one floating marker rather than inline headers per
              section: headers would mean interleaving header rows into the
              virtualizer's flat list, which re-indexes every row and breaks
              the bucket→index map the rail jumps by. Same orientation, none of
              that risk.
            */}
            <div
              aria-hidden="true"
              className={cn(
                "hidden md:flex absolute top-2 left-4 z-10 pointer-events-none",
                "items-center justify-center w-8 h-8 rounded-xl",
                "bg-surface-container-high/85 backdrop-blur-sm shadow-sm",
                "text-sm font-extrabold text-on-surface-variant",
                "transition-opacity duration-150",
                activeBucket ? "opacity-100" : "opacity-0",
              )}
            >
              {activeBucket ?? ""}
            </div>

            <AlphabetRail
              index={bucketIndex}
              activeBucket={activeBucket}
              onJump={jumpToIndex}
            />
            <AlphabetJumpButtons index={bucketIndex} onJump={jumpToIndex} />
          </>
        )}
      </div>
      <AnimatePresence>
        {isSelectMode && selectedCount > 0 && (
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
