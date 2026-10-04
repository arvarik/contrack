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
  useLayoutEffect,
} from "react";
import { useMatch, useNavigate, useLocation } from "react-router-dom";
import {
  AlertCircle,
  Search,
  Users,
  Upload,
  UserPlus,
  ListPlus,
  Square,
  Plus,
  FileText,
  SearchX,
  Clock,
  Archive,
  Copy,
  ChevronDown,
  Hash,
  Radar,
  Tag,
  Command,
} from "lucide-react";
import {
  useContacts,
  useLists,
  useCreateList,
  useReorderLists,
  useArchiveContact,
  useUnarchiveContact,
} from "../../api";
import { withUndo } from "../../lib/undoToast";
import {
  measureElement,
  observeElementOffset,
  observeElementRect,
  useVirtualizer,
} from "@tanstack/react-virtual";
import { useListDensity, type ListDensity } from "../../hooks/useListDensity";
import { AlphabetRail, bucketFor } from "./AlphabetRail";
import type { Contact } from "../../types";
import { ContextMenu, useContextMenu } from "../../components/ui/ContextMenu";
import { AnimatePresence } from "motion/react";
import { toast } from "sonner";
import {
  SEARCH_INPUT,
  filterPill,
  ICON_BTN,
  LABEL,
  PAGE_TOP,
} from "../../lib/styles";
import { cn } from "../../lib/utils";
import { PageHeader } from "../../components/layout/PageHeader";
import { usePageTitle } from "../../hooks/usePageTitle";
import {
  restoreScrollAnchor,
  savedScroll,
  SCROLL_ANCHOR_ATTR,
  useScrollRestoration,
} from "../../hooks/useScrollRestoration";
import { WIDE_QUERY } from "../../hooks/useMediaQuery";
import { usePullToRefresh } from "../../hooks/usePullToRefresh";
import { PullIndicator } from "../../components/ui/PullIndicator";
import { EmptyState } from "../../components/ui/EmptyState";
import { CorvidMark } from "../../components/brand/CorvidMark";
import {
  useRecentContacts,
  useRecentContactsLimit,
} from "../../hooks/useRecentContacts";
import { useLongPress } from "../../hooks/useLongPress";
import { useProximityLift } from "../../hooks/useProximityLift";
import { useDebounce } from "../../hooks/useDebounce";
import { LiveStatus } from "../../components/ui/LiveStatus";

import { ContactListItem } from "./ContactListItem";
import { BulkActionToolbar } from "./BulkActionToolbar";
import { ListIcon } from "./CreateListModal";
import { ContactListModals } from "./ContactListModals";
import {
  useContactListFilters,
  hasTag,
  SORT_CHOICES,
  TAG_FILTER_PREFIX,
  TRACKED_FILTER,
} from "./hooks/useContactListFilters";
import { useMultiSelect } from "./hooks/useMultiSelect";
import { useContactListKeyboard } from "./hooks/useContactListKeyboard";
import { useRovingList, type RovingItemProps } from "./useRovingList";
import { useRecent } from "../../contexts/SessionContext";
import { NAMES, TRACKED_INTRO } from "../../lib/names";
import { ActionMenu } from "../../components/ui/ActionMenu";
import { useSwapFocus } from "../../components/bulk/useSwapFocus";
import { openCommandPalette } from "../../lib/appEvents";
import { settleSlide } from "../settings/slide";

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
    {/* On the selected pill the count takes the pill's own ink, which is
        the one that reads on the tint. On the others it is the variant ink
        at full strength: at half opacity it measured 2.2 to 1. */}
    <span
      className={cn("ml-0.5 text-[11px]", !active && "text-on-surface-variant")}
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
          label: "View contact",
          icon: <UserPlus className="w-3.5 h-3.5" />,
          onClick: () => navigate(`/contact/${contact.id}`),
        },
        {
          id: "copy-email",
          label: contact.emails?.[0]?.email ? "Copy email" : "No email",
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
        // needing to be focusable itself. A click in select mode picks the
        // row and opens nothing, so it is no visit: each one used to add a
        // row to Recent and push the list down under the pointer.
        role="presentation"
        onContextMenu={(e) => handleContextMenu(e, contextItems)}
        onClick={isSelectMode ? undefined : () => recordVisit(contact.id)}
        // A press that lasts selects the row (`useLongPress`), so a finger
        // gets no link preview (iOS), no menu, and no selected text.
        {...longPress}
        className={cn(
          "[-webkit-touch-callout:none] pointer-coarse:select-none",
          // The flash arrives and leaves at the slow duration. Its glow is
          // mixed from the primary, so it follows the accent and the palette.
          "rounded-xl transition-all duration-(--dur-slow)",
          isFlashing &&
            "ring-2 ring-primary/40 shadow-[0_0_12px_color-mix(in_srgb,var(--color-primary)_20%,transparent)]",
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
// ContactRows — the scroller: Recent, the virtual rows and the letter rail
// ---------------------------------------------------------------------------

interface ContactRowsProps {
  /** What the scroller shows above Recent: loading, empty states, the count. */
  children: React.ReactNode;
  filteredContacts: Contact[];
  /** The Recent strip, or none while a search, a filter or a load hides it. */
  recentContacts: Contact[];
  openId: string | undefined;
  flashId: string | null;
  isSelectMode: boolean;
  selectedIds: Set<string>;
  toggleSelect: (id: string, extend?: boolean) => void;
  enterSelectMode: () => void;
  handleContextMenu: ContactRowWrapperProps["handleContextMenu"];
  recordVisit: (id: string) => void;
  archiveContact: ContactRowWrapperProps["archiveContact"];
  /** Where the scroll position is saved, and whether to put it back yet. */
  scrollKey: string;
  ready: boolean;
  onRefresh: () => Promise<void>;
  /** The room the bulk bar takes under the last row. */
  barRoom: number;
  showAlphabetRail: boolean;
}

/**
 * The list's scroller, and all that changes as it scrolls.
 *
 * The virtualizer renders the component that holds it on each scroll. In
 * ContactList that was the whole page: the header, its menus, the chips and
 * the dialogs. Here a scroll renders this and the rows it brings in. The
 * page's content above the rows comes as `children`, the same elements on
 * each of these renders, so React skips them.
 */
const ContactRows = ({
  children,
  filteredContacts,
  recentContacts,
  openId,
  flashId,
  isSelectMode,
  selectedIds,
  toggleSelect,
  enterSelectMode,
  handleContextMenu,
  recordVisit,
  archiveContact,
  scrollKey,
  ready,
  onRefresh,
  barRoom,
  showAlphabetRail,
}: ContactRowsProps) => {
  const scrollRef = useScrollRestoration<HTMLDivElement>(scrollKey, ready);
  const {
    containerRef: pullRef,
    isPulling,
    pullProgress,
    isRefreshing,
    pullDistance,
  } = usePullToRefresh(onRefresh, {
    disabled: typeof window !== "undefined" && window.innerWidth >= 768,
  });
  // The rows rise toward the pointer. Nothing renders while it moves.
  useProximityLift(scrollRef);

  // Merge containerRefs — both pullRef and scrollRef point to the same element
  const listScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      (pullRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    },
    [scrollRef, pullRef],
  );

  const { density, metrics } = useListDensity();

  /**
   * The rows' navigate. `useNavigate` gives a new function on each change of
   * path, so opening a contact drew every row again. This one keeps one
   * identity and calls the latest.
   */
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useLayoutEffect(() => {
    navigateRef.current = navigate;
  });
  const navigateRows = useCallback(
    (path: string) => navigateRef.current(path),
    [],
  );

  /**
   * Who the list itself shows. A Recent copy takes the selected look only
   * for a contact missing from it, a ghost or one a filter leaves out, so the
   * open contact is marked somewhere, and in one place.
   */
  const listedIds = useMemo(
    () => new Set(filteredContacts.map((c) => c.id)),
    [filteredContacts],
  );

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
    // A jump to a row stops above the bulk bar, not under it.
    scrollPaddingEnd: barRoom,
    // Only an estimate — rows are measured for real by `measureElement`
    // below — but it must track density or the scrollbar jumps as the user
    // scrolls into rows that have not been measured yet.
    estimateSize: () => metrics.rowHeight,
    overscan: 5, // Render 5 items outside viewport for smooth scrolling
    // The list is built anew on each return to the Network page, and the
    // scroller is put back where it was before paint. The rows start there
    // too, or the first frame drew the top rows out of sight and showed an
    // empty list.
    initialOffset: () => savedScroll(scrollKey),
    // Below `lg` the list is hidden while a contact is open, and a hidden
    // list reads 0 for its height, its offset and each row. The virtualizer
    // then drew no rows, and Back had no row to find. These three keep the
    // last real values while the list is hidden, so the rows it showed stay
    // drawn and in place (see `restoreScrollAnchor` below).
    observeElementRect: (instance, onRect) =>
      observeElementRect(instance, (rect) => {
        if (rect.height > 0) onRect(rect);
      }),
    observeElementOffset: (instance, onOffset) =>
      observeElementOffset(instance, (offset, isScrolling) => {
        if (instance.scrollElement?.clientHeight) onOffset(offset, isScrolling);
      }),
    measureElement: (element, entry, instance) => {
      const size = measureElement(element, entry, instance);
      if (size > 0) return size;
      const index = instance.indexFromElement(element);
      return (
        instance.itemSizeCache.get(instance.options.getItemKey(index)) ??
        instance.options.estimateSize(index)
      );
    },
  });

  React.useLayoutEffect(() => {
    const list = virtualListRef.current;
    const scroller = scrollRef.current;
    // A hidden list reads 0 for every position, and its margin stays.
    if (!list || !scroller || scroller.clientHeight === 0) return;
    const offset =
      list.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    setScrollMargin((previous) =>
      Math.abs(previous - offset) > 1 ? offset : previous,
    );
    // Recomputed whenever the block above the list can change height: the
    // page's content above it, which is new `children` on each render of
    // the page, the Recent rows, their density and the pull.
  }, [children, recentContacts.length, density, pullDistance, scrollRef]);

  // ── Alphabet rail ───────────────────────────────────────────────────
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
  const recentCount = recentContacts.length;
  const rowAt = (index: number) =>
    index < recentCount
      ? { contact: recentContacts[index], elementId: "recent-contact" }
      : {
          contact: filteredContacts[index - recentCount],
          elementId: "contact-row",
        };
  const openIndex = openId
    ? filteredContacts.findIndex((c) => c.id === openId)
    : -1;
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
  const previousId = useRef(openId);
  const { focusIndex } = roving;
  useEffect(() => {
    const wasOpen = previousId.current;
    previousId.current = openId;
    if (!wasOpen || openId) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const index = filteredContacts.findIndex((c) => c.id === lastContactId);
    if (index < 0) return;
    // The row is in view already (the place came back, see below): focus it
    // where it is. `focusIndex` scrolls, and from offsets the virtualizer
    // read before the list came back.
    const row = document.getElementById(`contact-row-${lastContactId}`);
    const scroller = scrollRef.current;
    if (row && scroller) {
      const box = row.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      if (box.top >= view.top && box.bottom <= view.bottom) {
        row.focus({ preventScroll: true });
        return;
      }
    }
    focusIndex(recentCount + index);
  }, [
    openId,
    lastContactId,
    filteredContacts,
    recentCount,
    focusIndex,
    scrollRef,
  ]);

  /**
   * Back to the list on a phone puts the same row at the same place.
   *
   * Below `lg` the list is hidden while a contact is open, and a hidden
   * scroller forgets its offset. The row that was at the top comes back to
   * the top, the same distance from it (`restoreScrollAnchor`). Before
   * paint, so the first frame is the right one, and again a frame later,
   * after the rows have measured. With no row saved (the top showed
   * Recent), or a row not drawn yet, the saved pixel offset comes back
   * first, and the frame after it finds the row.
   */
  const previousOpen = useRef(openId);
  useLayoutEffect(() => {
    const wasOpen = previousOpen.current;
    previousOpen.current = openId;
    const scroller = scrollRef.current;
    if (!wasOpen || openId || !scroller) return;
    if (window.matchMedia?.(WIDE_QUERY).matches) return;
    if (!restoreScrollAnchor(scroller, scrollKey))
      scroller.scrollTop = savedScroll(scrollKey);
    const frame = requestAnimationFrame(() =>
      restoreScrollAnchor(scroller, scrollKey),
    );
    return () => cancelAnimationFrame(frame);
  }, [openId, scrollKey, scrollRef]);

  /**
   * The open contact's row comes into view when the open id changes: a deep
   * link to `/contact/:id`, the palette, a Pulse row. Its tint was off
   * screen. `auto` scrolls the least that shows it, and nothing when it
   * shows already. Once per id, so a person who scrolls away is left there,
   * and not at all when the row was opened from the list itself, which is
   * where the person is looking. A frame late, because the Recent strip's
   * height reaches the virtualizer's margin in the commit after the
   * contacts arrive, and a jump before it lands short.
   */
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!openId) {
      scrolledTo.current = null;
      return;
    }
    if (openIndex < 0 || scrolledTo.current === openId) return;
    if (scrollRef.current?.contains(document.activeElement)) {
      scrolledTo.current = openId;
      return;
    }
    const frame = requestAnimationFrame(() => {
      scrolledTo.current = openId;
      rowVirtualizer.scrollToIndex(openIndex, { align: "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [openId, openIndex, rowVirtualizer, scrollRef]);

  /*
    Contact list.

    The wrapper exists so the alphabet rail can be positioned against the
    *visible* list area. Rendered inside the scroller, an absolutely
    positioned rail resolves its `top-0 bottom-0` against the full scroll
    height and then scrolls away with the content — so it both disappears
    and maps pointer positions against a box thousands of pixels tall.
  */
  return (
    <div className="relative flex-1 min-h-0">
      {/*
        The scroller is right-to-left and its content is left-to-right
        again. That one trick moves the scrollbar to the left edge, away
        from the letter rail on the right: the two used to share the same
        strip, and a thumb aimed at "M" landed on the bar. Only the box
        flips. The `dir="ltr"` child puts every row back the way it reads.
        The thumb shows only while the pointer is over the list or the
        keyboard is in it (`scrollbar-on-hover`), so it does not sit
        against the sidebar all the time.

        With the rail on screen the scroller keeps a 2 rem gutter on the
        right. Rows end before it, so a selected row's tint and the hover
        layer stop short of the letters instead of running under them.

        The top padding is 4 px, the room the first row's focus ring needs,
        and the header's own bottom padding is the rest of the space under
        the chips. Two full paddings left 34 px of nothing above the first
        row, where the rows themselves are 8 px apart.

        While the bulk bar shows, the bottom padding is its room (see
        `measureBar`), and so is the scroll padding a focused row keeps.
      */}
      <div
        ref={listScrollRef}
        id="contact-list"
        dir="rtl"
        {...roving.containerProps}
        className={cn(
          "h-full overflow-y-auto scrollbar-on-hover px-4 pt-1 pb-24 md:pb-4 overscroll-contain outline-none",
          showAlphabetRail && "pr-8",
        )}
        style={
          barRoom
            ? { paddingBottom: barRoom, scrollPaddingBottom: barRoom }
            : undefined
        }
      >
        <div dir="ltr" className="space-y-2">
          {/* Pull-to-refresh indicator — mobile only */}
          <PullIndicator
            isPulling={isPulling}
            isRefreshing={isRefreshing}
            progress={pullProgress}
            pullDistance={pullDistance}
          />

          {children}

          {/* ── Recent contacts strip ─────────────────────────────────────── */}
          {recentCount > 0 && (
            <div>
              <div className="flex items-center gap-1.5 px-1 mb-2">
                <Clock className="w-3 h-3 text-on-surface-variant" />
                <span className={LABEL}>Recent</span>
              </div>
              {/* 8 px apart, like the rows of the list under it. */}
              <div className="space-y-2">
                {recentContacts.map((contact, index) => {
                  const item = roving.getItemProps(index);
                  return (
                    <ContactListItem
                      key={`recent-${contact.id}`}
                      idPrefix="recent-contact"
                      contact={contact}
                      density={density}
                      active={openId === contact.id}
                      isSelectMode={isSelectMode}
                      isSelected={selectedIds.has(contact.id)}
                      showSelection={!listedIds.has(contact.id)}
                      onToggleSelect={toggleSelect}
                      rovingIndex={index}
                      tabIndex={item.tabIndex}
                      onRowKeyDown={item.onKeyDown}
                      onRowFocus={item.onFocus}
                    />
                  );
                })}
              </div>
              {/* Where Recent ends and everyone begins. A hairline said
                    it, and this app divides a surface with words and
                    space, not lines. */}
              <div className="flex items-center gap-1.5 px-1 mt-5">
                <Users className="w-3 h-3 text-on-surface-variant" />
                <span className={LABEL}>All contacts</span>
              </div>
            </div>
          )}

          <div
            ref={virtualListRef}
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualItems.map((virtualItem) => {
              const contact = filteredContacts[virtualItem.index];
              const item = roving.getItemProps(recentCount + virtualItem.index);
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  {...{ [SCROLL_ANCHOR_ATTR]: contact.id }}
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
                    active={openId === contact.id}
                    isFlashing={flashId === contact.id}
                    isSelectMode={isSelectMode}
                    isSelected={selectedIds.has(contact.id)}
                    onToggleSelect={toggleSelect}
                    onEnterSelectMode={enterSelectMode}
                    handleContextMenu={handleContextMenu}
                    recordVisit={recordVisit}
                    archiveContact={archiveContact}
                    navigate={navigateRows}
                    rovingIndex={recentCount + virtualItem.index}
                    tabIndex={item.tabIndex}
                    onRowKeyDown={item.onKeyDown}
                    onRowFocus={item.onFocus}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {showAlphabetRail && (
        <AlphabetRail
          index={bucketIndex}
          activeBucket={activeBucket}
          onJump={jumpToIndex}
        />
      )}
    </div>
  );
};

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
   * was ever marked current — no selected look, no `aria-current` — and the
   * j/k keys, which step from the current row, went to the first contact
   * every time.
   */
  const id = useMatch("/contact/:id")?.params.id;
  const navigate = useNavigate();
  const location = useLocation();

  // ── Extracted hooks ─────────────────────────────────────────────────
  const filters = useContactListFilters(contacts);
  const multiSelect = useMultiSelect(filters.filteredContacts);

  // ── UX hooks ────────────────────────────────────────────────────────
  usePageTitle(NAMES.network.title);
  const scrollKey = `contact-list:${filters.filterMode}:${filters.searchQuery}`;
  const { contextMenu, handleContextMenu, closeContextMenu } = useContextMenu();
  const archiveContact = useArchiveContact();
  const unarchiveContact = useUnarchiveContact();
  const { recentIds, recordVisit } = useRecentContacts();
  const { limit: recentLimit } = useRecentContactsLimit();

  // Stable archive handler — an inline closure here would defeat
  // ContactRowWrapper's React.memo (new function identity every render).
  const archiveContactMutateAsync = archiveContact.mutateAsync;
  const unarchiveContactMutate = unarchiveContact.mutate;
  const handleArchiveContact = useCallback(
    async (contact: { id: string; name: string }) => {
      await archiveContactMutateAsync(contact.id);
      toast.success(
        `Archived "${contact.name}"`,
        withUndo(() =>
          unarchiveContactMutate(contact.id, {
            onError: (err) => toast.error(`Could not undo: ${err.message}`),
          }),
        ),
      );
    },
    [archiveContactMutateAsync, unarchiveContactMutate],
  );

  // ── Visual flash: highlight newly created contact for 2s ────────────
  const [flashId, setFlashId] = useState<string | null>(null);

  // ── Modal visibility state ──────────────────────────────────────────
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSmartPasteOpen, setIsSmartPasteOpen] = useState(false);
  const [isCreateListOpen, setIsCreateListOpen] = useState(false);

  const createList = useCreateList();
  const reorderLists = useReorderLists();

  /**
   * The control that opened New contact or Add from text: the New button,
   * or whatever had focus for the N and V keys. Both dialogs give focus
   * back to it, and so does the form that a successful extraction opens,
   * where the dialog's own memory held the gone Extract button.
   */
  const createOpener = useRef<HTMLElement | null>(null);
  const openCreate = useCallback((open: (value: boolean) => void) => {
    const focused = document.activeElement;
    createOpener.current = focused instanceof HTMLElement ? focused : null;
    open(true);
  }, []);
  const openNewContact = useCallback(
    () => openCreate(setIsModalOpen),
    [openCreate],
  );
  const openSmartPaste = useCallback(
    () => openCreate(setIsSmartPasteOpen),
    [openCreate],
  );

  // Support ?new=1 query param (e.g. from Pulse "New contact" button)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("new") === "1") {
      openNewContact();
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
  }, [location.search, location.pathname, navigate, openNewContact]);

  // ── Keyboard navigation ─────────────────────────────────────────────
  useContactListKeyboard({
    filteredContacts: filters.filteredContacts,
    currentId: id,
    isSelectMode: multiSelect.isSelectMode,
    exitSelectMode: multiSelect.exitSelectMode,
    navigate,
    locationSearch: location.search,
    onNewContact: openNewContact,
    onSmartPaste: openSmartPaste,
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
        onSelect: openNewContact,
      },
      {
        id: "add-from-text",
        label: "Add from text",
        icon: FileText,
        onSelect: openSmartPaste,
      },
      {
        id: "new-list",
        label: "New list",
        icon: ListPlus,
        onSelect: () => setIsCreateListOpen(true),
      },
    ],
    [openNewContact, openSmartPaste],
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
  /** The Tracked chip's count: tracked, and in the list. */
  const trackedContactCount = useMemo(
    () =>
      contacts.filter((c) => c.isTracked && !c.isArchived && !c.isGhost).length,
    [contacts],
  );
  /** The tag a link from the Tags page filters by, and its chip's count. */
  const tagFilter = filterMode.startsWith(TAG_FILTER_PREFIX)
    ? filterMode.slice(TAG_FILTER_PREFIX.length)
    : null;
  const tagContactCount = useMemo(
    () =>
      tagFilter
        ? contacts.filter(
            (c) => !c.isArchived && !c.isGhost && hasTag(c, tagFilter),
          ).length
        : 0,
    [contacts, tagFilter],
  );

  const recentContacts = useMemo(
    () =>
      recentIds
        .map((rid) => contacts.find((c) => c.id === rid && !c.isArchived))
        .filter(Boolean)
        .slice(0, recentLimit) as typeof contacts,
    [recentIds, contacts, recentLimit],
  );

  // ── The bulk bar's room ─────────────────────────────────────────────
  // The bar floats over the end of the list. While it shows, the scroller
  // keeps room under its last row for the bar and a gap, so a full scroll
  // brings every row above it, and a row the keys move to stops above it
  // too. Measured, not a class: the bar wraps to a second row in the
  // narrow pane and on a phone, and sits over the tab bar there.
  const [barRoom, setBarRoom] = useState(0);
  const measureBar = useCallback((bar: HTMLDivElement | null) => {
    if (!bar) return;
    const observer = new ResizeObserver(() =>
      setBarRoom(
        bar.offsetHeight + (parseFloat(getComputedStyle(bar).bottom) || 0) + 8,
      ),
    );
    observer.observe(bar, { box: "border-box" });
    return () => {
      observer.disconnect();
      setBarRoom(0);
    };
  }, []);

  // Select and Done trade places. Focus follows to the one that appears.
  const selectButtonRef = useRef<HTMLButtonElement>(null);
  const doneButtonRef = useRef<HTMLButtonElement>(null);
  useSwapFocus(isSelectMode, doneButtonRef, selectButtonRef);

  // ── The search's count ──────────────────────────────────────────────
  /**
   * How many rows a search leaves, said where the results start: in the
   * slot the Recent strip and "All contacts" take while nobody searches,
   * in the same small label, "12 matches". The eye goes from the box to the
   * first row, and the count sits between them. Inside the box it cost the
   * query its room in a narrow pane, and "3/12" there reads as a find bar
   * that Enter steps through. With no match, the empty state says so.
   *
   * A screen reader hears the count once the typing pauses, not on every
   * letter: the status waits a second (WCAG 4.1.3, status messages).
   */
  const matchCount = filteredContacts.length;
  const showMatchCount = !isLoading && Boolean(searchQuery) && matchCount > 0;
  const searchAnnouncement = useDebounce(
    searchQuery && !isLoading
      ? matchCount === 0
        ? "No contacts found"
        : `${matchCount} ${matchCount === 1 ? "contact" : "contacts"} found`
      : "",
    1000,
  );

  // ── Alphabet rail ───────────────────────────────────────────────────
  // Only meaningful when the list is actually alphabetical, and only worth
  // the screen width once scrolling is a chore.
  const showAlphabetRail =
    sortBy === "name" && !searchQuery && filteredContacts.length >= 15;

  // Back from a contact slides the list in (`views/settings/slide`), and
  // the slide waits for this: the list on screen, its rows back in place.
  // A child's layout effects run first, so the place is back by now.
  useLayoutEffect(() => {
    if (!id) settleSlide(location.pathname);
  }, [id, location.pathname]);

  return (
    // `settings-stage`: below `lg` the list is the picture that slides when
    // a contact opens or closes, as the settings list does.
    <div className="settings-stage flex flex-col h-full overflow-hidden">
      {/*
        The pane is narrow, so it keeps `px-4` where a page has `PAGE_X`, and
        its title starts at the same height as every other page's.

        One h1 per page: the list's title is the page heading on the Network
        page, and a section heading beside an open contact, whose name is the
        h1.

        The title stays the page's name in select mode. The count is the
        first thing in the bulk bar, where it sits beside what it acts on.
      */}
      <PageHeader
        title={NAMES.network.label}
        titleAs={id ? "h2" : "h1"}
        // Select all and Done are 32 px, and the icon buttons they replace
        // are 36. The row keeps 36 px, so select mode moves no row.
        actionsClassName="min-h-9"
        className={cn(
          "px-4 pb-3 bg-surface-container-lowest sticky top-0 z-10",
          PAGE_TOP,
        )}
        actions={
          // Keyed, so Select and Done are new buttons and not the old ones
          // relabelled: focus follows the mode to Done and back to Select
          // (`useSwapFocus`), where it sat on "Select all" and "Import".
          isSelectMode ? (
            <>
              <button
                key="select-all"
                type="button"
                onClick={
                  selectedCount === filteredContacts.length
                    ? clearSelection
                    : selectAll
                }
                className="btn-secondary btn-sm"
              >
                {selectedCount === filteredContacts.length
                  ? "Deselect all"
                  : "Select all"}
              </button>
              <button
                key="done"
                ref={doneButtonRef}
                type="button"
                onClick={exitSelectMode}
                className="btn-secondary btn-sm"
              >
                Done
              </button>
            </>
          ) : (
            <>
              {/*
                Select and Import are icon buttons, and New is the page's
                call to action. Each is named for a screen reader and titled
                for a pointer, so the row costs one word of space per action
                and still says what it does. The gap keeps the three 44 px
                tap boxes apart.

                A touch screen has no ⌘K, so it gets one more button first:
                the command palette, which finds a person and acts on them.
                A mouse and a keyboard do not see it.
              */}
              <button
                key="palette"
                type="button"
                onClick={openCommandPalette}
                className={cn(ICON_BTN, "hidden pointer-coarse:inline-flex")}
                aria-label="Command palette"
                title="Command palette"
              >
                <Command className="w-5 h-5" aria-hidden="true" />
              </button>
              <button
                key="select"
                ref={selectButtonRef}
                type="button"
                onClick={enterSelectMode}
                className={ICON_BTN}
                aria-label="Select"
                title="Select"
              >
                <Square className="w-5 h-5" aria-hidden="true" />
              </button>
              <button
                key="import"
                type="button"
                onClick={() => setIsImportOpen(true)}
                className={ICON_BTN}
                aria-label="Import"
                title="Import"
              >
                <Upload className="w-5 h-5" aria-hidden="true" />
              </button>
              <ActionMenu
                key="new"
                label="New"
                title="New"
                icon={Plus}
                variant="primary"
                items={newMenuItems}
              />
            </>
          )
        }
      >
        <LiveStatus label="Contact search" message={searchAnnouncement} />
        <div className="flex gap-1.5 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
            <input
              aria-label="Search contacts"
              id="search-input"
              type="text"
              enterKeyHint="search"
              placeholder="Search..."
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
          {/* Sort ActionMenu. The trigger shows the order, and its name says
              what the control is: "A to Z" alone does not. */}
          <ActionMenu
            label={`Sort: ${currentSort.label}`}
            title="Sort the list"
            heading="Sort by"
            triggerClassName="px-2.5 py-1.5 shrink-0 gap-1"
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

        {/* Filter chips: All, Tracked, then one per list. A horizontal
            scroll row. It shows with no lists too, because the Tracked chip
            is the way into tracking. In select mode it stays, faded and
            out of reach (`inert`): the selection is of the rows it shows.
            It used to leave, and the header lost 44 px, so a long press
            moved every row up under the finger. */}
        <div
          className={cn(
            "relative transition-opacity",
            isSelectMode && "opacity-40",
          )}
          inert={isSelectMode}
        >
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-surface-container-lowest to-transparent z-10" />
          <div
            id="filter-pills-row"
            // A scroller clips what sits outside its padding box, so the
            // 8 px above and below give each pill's 44 px tap box room,
            // and 4 px at each side give its focus ring room. The negative
            // margins keep the row where it was.
            className="flex gap-1.5 overflow-x-auto scrollbar-hide -my-2 pt-2 pb-2.5 -mx-1 px-1"
          >
            <FilterButton
              label="All"
              icon={<Users className="w-3.5 h-3.5" />}
              count={activeContactCount}
              active={filterMode === "all"}
              onClick={() => setFilterMode("all")}
            />
            {/* A tag, from a tag on the Tags settings page. The chip is
                  there only while it filters, and pressing it shows
                  everyone again, as pressing a pressed list chip does. */}
            {tagFilter && (
              <FilterButton
                label={tagFilter}
                icon={<Hash className="w-3.5 h-3.5" />}
                count={tagContactCount}
                active
                onClick={() => setFilterMode("all")}
              />
            )}
            <FilterButton
              label="Tracked"
              icon={<Radar className="w-3.5 h-3.5" />}
              count={trackedContactCount}
              active={filterMode === TRACKED_FILTER}
              onClick={() =>
                setFilterMode(
                  filterMode === TRACKED_FILTER ? "all" : TRACKED_FILTER,
                )
              }
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
                  // The drop target's dashed line, as on the Lists page. A
                  // solid ring read as keyboard focus.
                  dragOverIdx === idx &&
                    dragIdx !== idx &&
                    "outline-2 outline-dashed outline-primary/60 rounded-xl",
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
      </PageHeader>
      <ContactRows
        filteredContacts={filteredContacts}
        recentContacts={
          // Recent shows on the plain list: not while loading, searching or
          // filtering.
          !isLoading && !searchQuery && filterMode === "all"
            ? recentContacts
            : []
        }
        openId={id}
        flashId={flashId}
        isSelectMode={isSelectMode}
        selectedIds={selectedIds}
        toggleSelect={toggleSelect}
        enterSelectMode={enterSelectMode}
        handleContextMenu={handleContextMenu}
        recordVisit={recordVisit}
        archiveContact={handleArchiveContact}
        scrollKey={scrollKey}
        ready={!isLoading}
        onRefresh={async () => {
          await refetch();
        }}
        barRoom={barRoom}
        showAlphabetRail={showAlphabetRail}
      >
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
          A failed load. The connection banner speaks only when the server
          cannot be reached, so a 500 left the list blank.
        */}
        {!isLoading && isError && activeContactCount === 0 && (
          <EmptyState
            icon={AlertCircle}
            tone="error"
            title="Your contacts did not load"
            body="Nothing has changed. Try again in a moment"
            action={{ label: "Retry", onClick: () => void refetch() }}
            level={id ? 3 : 2}
          />
        )}

        {/*
          Empty state: 0 contacts total (onboarding).

          Gated on `!isError` because a failed fetch also produces zero
          contacts, and telling someone their network is empty when the
          server merely went away is the most alarming thing this app could
          say. The error state above says what happened instead.
        */}
        {/*
          Import leads. Nobody builds a personal CRM by typing four hundred
          people in by hand: they arrive with an export from Apple, Google
          or LinkedIn. Adding one by hand stays on the header's + button.
        */}
        {!isLoading && !isError && activeContactCount === 0 && (
          <EmptyState
            illustration={<CorvidMark size={64} className="text-primary/60" />}
            title="Your network is empty"
            body="Bring in the people you already have, or add one by hand"
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
              body="Try fewer letters, or search a company or a tag"
              action={{
                label: "Clear search",
                onClick: () => setSearchQuery(""),
              }}
              level={id ? 3 : 2}
            />
          ) : filterMode === TRACKED_FILTER ? (
            <EmptyState
              icon={Radar}
              title="Nobody is tracked yet"
              body={TRACKED_INTRO}
              action={{
                label: "Choose people",
                onClick: () => navigate("/settings/tracked"),
              }}
              level={id ? 3 : 2}
            />
          ) : tagFilter ? (
            <EmptyState
              icon={Tag}
              title={`Nobody has the tag "${tagFilter}"`}
              action={{
                label: "Show everyone",
                onClick: () => setFilterMode("all"),
              }}
              level={id ? 3 : 2}
            />
          ) : (
            <EmptyState
              icon={ListPlus}
              title="No contacts in this list"
              body="Add people from their contact page, or select several and choose List"
              level={id ? 3 : 2}
            />
          ))}

        {/* The search's count, where the results start. */}
        {showMatchCount && (
          <div className="flex items-center gap-1.5 px-1">
            <Search
              className="w-3 h-3 text-on-surface-variant"
              aria-hidden="true"
            />
            <span className={cn(LABEL, "tabular-nums")}>
              {matchCount} {matchCount === 1 ? "match" : "matches"}
            </span>
          </div>
        )}
      </ContactRows>
      {/* Context menu — portal-rendered, shared across all rows */}
      <ContextMenu {...contextMenu} onClose={closeContextMenu} />
      <AnimatePresence>
        {isSelectMode && (
          <BulkActionToolbar
            ref={measureBar}
            selectedCount={selectedCount}
            isPending={isPending}
            onTrack={multiSelect.handleBulkTrack}
            selectionTracked={multiSelect.selectionTracked}
            onArchive={multiSelect.handleBulkArchive}
            onAddToList={() => multiSelect.setIsAddToListOpen(true)}
            onEditField={() => multiSelect.setIsBulkEditOpen(true)}
            onColorChange={multiSelect.handleBulkColorChange}
            onExportCSV={multiSelect.handleExportCSV}
            onDelete={multiSelect.handleBulkDelete}
          />
        )}
      </AnimatePresence>
      {/* ── All Modals ───────────────────────────────────────────────── */}
      <ContactListModals
        selectedCount={selectedCount}
        isAddToListOpen={multiSelect.isAddToListOpen}
        onCloseAddToList={() => multiSelect.setIsAddToListOpen(false)}
        lists={lists}
        onBulkAddToList={multiSelect.handleBulkAddToList}
        isBulkAddToListPending={multiSelect.isBulkAddToListPending}
        isBulkEditOpen={multiSelect.isBulkEditOpen}
        onCloseBulkEdit={() => multiSelect.setIsBulkEditOpen(false)}
        onBulkEditApply={multiSelect.handleBulkEditApply}
        isBulkEditPending={multiSelect.isBulkEditPending}
        returnFocusRef={createOpener}
        isModalOpen={isModalOpen}
        onCloseModal={() => setIsModalOpen(false)}
        onContactCreated={(newId) => {
          setFlashId(newId);
          setTimeout(() => setFlashId(null), 2000);
        }}
        isSmartPasteOpen={isSmartPasteOpen}
        // Closing "Add from text" only closes it. The form opens when the
        // text was read, filled in with what it found.
        onCloseSmartPaste={() => setIsSmartPasteOpen(false)}
        onSmartPasteExtracted={() => {
          setIsSmartPasteOpen(false);
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
