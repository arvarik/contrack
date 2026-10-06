/**
 * The left-pane list of contacts. Search, filters and sort live in
 * `useContactListFilters`, selection in `useMultiSelect`, keys in
 * `useContactListKeyboard` and `useRovingList`, dialogs in `ContactListModals`.
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
  ArrowLeft,
  ArrowRight,
  Search,
  Users,
  Upload,
  User,
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
import { CLIPBOARD_DENIED, copyToClipboard } from "../../lib/clipboard";
import { parseFacetQuery } from "../../../shared/facetQuery";
import { unknownFacetValue } from "../../../shared/searchFacets";
import {
  measureElement,
  observeElementOffset,
  observeElementRect,
  useVirtualizer,
} from "@tanstack/react-virtual";
import { useListDensity, type ListDensity } from "../../hooks/useListDensity";
import { AlphabetRail, bucketFor } from "./AlphabetRail";
import type { Contact, ContactList as ContactListType } from "../../types";
import { ContextMenu, useContextMenu } from "../../components/ui/ContextMenu";
import { AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { filterPill, ICON_BTN, LABEL, PAGE_TOP } from "../../lib/styles";
import { cn, errorText } from "../../lib/utils";
import { PageHeader } from "../../components/layout/PageHeader";
import { usePageTitle } from "../../hooks/usePageTitle";
import {
  restoreScrollAnchor,
  savedScroll,
  SCROLL_ANCHOR_ATTR,
  useScrollRestoration,
} from "../../hooks/useScrollRestoration";
import { useMediaQuery, WIDE_QUERY } from "../../hooks/useMediaQuery";
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
import { RailTooltip } from "../../components/ui/RailTooltip";
import { useSwapFocus } from "../../components/bulk/useSwapFocus";
import { settleSlide } from "../settings/slide";
import { LoadFailed } from "../../components/ui/LoadFailed";
import { SearchField } from "../../components/ui/SearchField";

/**
 * What to try when a search matches no one. An unknown facet value
 * (`tracked:maybe`) gets the values the facet takes.
 */
function searchHint(query: string): string {
  for (const filter of parseFacetQuery(query).filters) {
    const values = unknownFacetValue(filter);
    if (values) return `${filter.field}: takes ${values}`;
  }
  return "Try fewer letters, or search a company or a tag";
}

/** The space under each row of the list, in px: `space-y-2`. */
const ROW_GAP = 8;

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
    // 28 px on screen, a 44 px tap box from hit-area. The sideways-scrolling
    // row carries the padding the box needs.
    className={cn(filterPill(active), "hit-area")}
    aria-label={`Filter: ${label} (${count})`}
    aria-pressed={active}
  >
    {icon}
    {label}
    {/* Variant ink at full strength: at half opacity it measured 2.2 to 1. */}
    <span
      className={cn("ml-0.5 text-[11px]", !active && "text-on-surface-variant")}
    >
      {count}
    </span>
  </button>
);

type OpenMenu = ReturnType<typeof useContextMenu>["handleContextMenu"];

/**
 * A list's chip in the filter row. A mouse drags it to a new place. A finger
 * cannot drag it, so a long press, a right click or the keyboard's menu key
 * opens its menu: Move left and Move right.
 */
const ListChip = ({
  list,
  index,
  count,
  active,
  onToggle,
  onMove,
  openMenu,
  drag,
}: {
  list: ContactListType;
  index: number;
  count: number;
  active: boolean;
  onToggle: () => void;
  onMove: (from: number, to: number) => void;
  openMenu: OpenMenu;
  /** The drag props and look, for a mouse only. */
  drag: React.HTMLAttributes<HTMLDivElement> | null;
}) => {
  const items = [
    {
      id: "left",
      label: "Move left",
      icon: ArrowLeft,
      disabled: index === 0,
      onClick: () => onMove(index, index - 1),
    },
    {
      id: "right",
      label: "Move right",
      icon: ArrowRight,
      disabled: index === count - 1,
      onClick: () => onMove(index, index + 1),
    },
  ];
  // A press is no mouse event, so it passes the point the menu opens at.
  const longPress = useLongPress(({ clientX, clientY }) =>
    openMenu(
      { clientX, clientY, preventDefault: () => {} } as React.MouseEvent,
      items,
    ),
  );
  return (
    <div
      {...longPress}
      {...drag}
      onContextMenu={(e) => openMenu(e, items)}
      className={cn("shrink-0 [-webkit-touch-callout:none]", drag?.className)}
    >
      <FilterButton
        label={list.name}
        icon={<ListIcon icon={list.icon} className="w-3.5 h-3.5" />}
        count={list.memberCount ?? 0}
        active={active}
        onClick={onToggle}
      />
    </div>
  );
};

// A row with its context menu, long press and recordVisit.
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
          icon: User,
          onClick: () => navigate(`/contact/${contact.id}`),
        },
        {
          id: "copy-email",
          label: contact.emails?.[0]?.email ? "Copy email" : "No email",
          icon: Copy,
          disabled: !contact.emails?.[0]?.email,
          onClick: () =>
            copyToClipboard(contact.emails![0].email).then(
              () => toast.success("Email copied"),
              () => toast.error(CLIPBOARD_DENIED),
            ),
        },
        { id: "sep1", label: "", separator: true as const },
        {
          id: "archive",
          label: "Archive",
          icon: Archive,
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
        // Presentational: Enter on the <Link> inside bubbles a click here, so
        // keyboard users record a visit too. A click in select mode is no
        // visit, or it would add to Recent and push the list under the pointer.
        role="presentation"
        onContextMenu={(e) => handleContextMenu(e, contextItems)}
        onClick={isSelectMode ? undefined : () => recordVisit(contact.id)}
        // A long press selects the row, so a finger gets no link preview
        // (iOS), no menu and no selected text.
        {...longPress}
        className={cn(
          "[-webkit-touch-callout:none] pointer-coarse:select-none",
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
 * The scroller: Recent, the virtual rows and the letter rail. The virtualizer
 * renders its holder on each scroll, so it lives here and not in the page.
 * The content above the rows comes as `children`, which React skips.
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
  } = usePullToRefresh(onRefresh);
  // The rows rise toward the pointer. Nothing renders while it moves.
  useProximityLift(scrollRef);

  const listScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      (pullRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    },
    [scrollRef, pullRef],
  );

  const { density, metrics } = useListDensity();

  // `useNavigate` changes on each path change and would redraw every row.
  // This one keeps one identity and calls the latest.
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useLayoutEffect(() => {
    navigateRef.current = navigate;
  });
  const navigateRows = useCallback(
    (path: string) => navigateRef.current(path),
    [],
  );

  // A Recent copy takes the selected look only for a contact missing from the
  // list, so the open contact is marked in exactly one place.
  const listedIds = useMemo(
    () => new Set(filteredContacts.map((c) => c.id)),
    [filteredContacts],
  );

  // How far the virtual list starts below the top of the scroller (Recent
  // and the pull indicator sit above it). Without it `scrollToIndex` lands
  // short by that height.
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
    // An estimate that tracks density, or the scrollbar jumps into unmeasured
    // rows. It includes `ROW_GAP`, or each first measure above the view moves
    // the list 8 px (on iOS, a beat after Back).
    estimateSize: () => metrics.rowHeight + ROW_GAP,
    overscan: 5,
    // The scroller is restored before paint, so the rows start there too, or
    // the first frame shows an empty list.
    initialOffset: () => savedScroll(scrollKey),
    // Below `lg` the list is hidden while a contact is open, and a hidden
    // list reads 0 for every size. These three keep the last real values, so
    // the rows stay drawn and Back finds its row (`restoreScrollAnchor`).
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
    // Each dependency can change the height above the list. `children` is new
    // on each render of the page, so this runs on each render.
  }, [children, recentContacts.length, density, pullDistance, scrollRef]);

  /** Bucket → index of its first contact. */
  const bucketIndex = useMemo(() => {
    const map = new Map<string, number>();
    if (!showAlphabetRail) return map;
    filteredContacts.forEach((contact, i) => {
      const bucket = bucketFor(contact.name);
      if (!map.has(bucket)) map.set(bucket, i);
    });
    return map;
  }, [filteredContacts, showAlphabetRail]);

  // The letter at the top of the view, from the virtualizer's first visible
  // item, so it cannot drift from what is rendered.
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
      // By index, never by offset: unmeasured offsets are estimates.
      rowVirtualizer.scrollToIndex(index, { align: "start" });
    },
    [rowVirtualizer],
  );

  // Recent and the full list are one list to the keyboard, Recent first.
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

  // Back from a contact focuses the row it was opened from. On a narrow
  // screen the contact's removal drops focus to the document. Only when focus
  // was lost: a sidebar link that navigated here keeps its own.
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
    // A row already in view is focused in place: `focusIndex` would scroll
    // from offsets read while the list was hidden.
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

  // Below `lg` a hidden scroller forgets its offset, so Back puts the top row
  // back at the top (`restoreScrollAnchor`): before paint, and again a frame
  // later once rows have measured. With no anchor row, the saved pixel
  // offset comes back first.
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

  // A new open id from outside the list (a deep link, the palette) scrolls
  // its row into view, once per id. A frame late: the Recent strip's height
  // reaches `scrollMargin` a commit after the contacts, and an earlier jump
  // lands short.
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

  // The wrapper places the rail against the visible area. Inside the
  // scroller it would size to the full scroll height and scroll away.
  return (
    <div className="relative flex-1 min-h-0">
      {/*
        `dir="rtl"` moves the scrollbar to the left edge, away from the
        letter rail, and the `dir="ltr"` child puts the rows back. With the
        rail on, a 2 rem right gutter keeps row tints off the letters. The
        4 px top padding is room for the first row's focus ring. While the
        bulk bar shows, the bottom padding is its room (`measureBar`).
      */}
      <div
        ref={listScrollRef}
        id="contact-list"
        dir="rtl"
        {...roving.containerProps}
        className={cn(
          "h-full overflow-y-auto scrollbar-on-hover px-4 pt-1 pb-24 md:pb-4 overscroll-contain outline-none",
          // No rail in a short window (`AlphabetRail`), so no gutter for it.
          showAlphabetRail && "pr-8 [@media(max-height:499px)]:pr-4",
        )}
        style={
          barRoom
            ? { paddingBottom: barRoom, scrollPaddingBottom: barRoom }
            : undefined
        }
      >
        <div dir="ltr" className="space-y-2">
          <PullIndicator
            isPulling={isPulling}
            isRefreshing={isRefreshing}
            progress={pullProgress}
            pullDistance={pullDistance}
          />

          {children}

          {recentCount > 0 && (
            <div>
              <div className="flex items-center gap-1.5 px-1 mb-2">
                <Clock className="w-3 h-3 text-on-surface-variant" />
                <span className={LABEL}>Recent</span>
              </div>
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
              {/* The app divides a surface with words and space, not lines. */}
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
                    paddingBottom: ROW_GAP,
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
          bottomRoom={barRoom}
        />
      )}
    </div>
  );
};

export const ContactList = () => {
  const { data: contacts = [], isLoading, isError, refetch } = useContacts();

  const { data: lists = [] } = useLists();
  // The list mounts on the catch-all route, so `useParams` has no `:id`.
  const id = useMatch("/contact/:id")?.params.id;
  const navigate = useNavigate();
  const location = useLocation();

  const filters = useContactListFilters(contacts);
  const multiSelect = useMultiSelect(filters.filteredContacts);

  usePageTitle(NAMES.network.title);
  const scrollKey = `contact-list:${filters.filterMode}:${filters.searchQuery}`;
  const { contextMenu, handleContextMenu, closeContextMenu } = useContextMenu();
  const archiveContact = useArchiveContact();
  const unarchiveContact = useUnarchiveContact();
  const { recentIds, recordVisit } = useRecentContacts();
  const { limit: recentLimit } = useRecentContactsLimit();

  // Stable, so ContactRowWrapper's React.memo holds.
  const archiveContactMutateAsync = archiveContact.mutateAsync;
  const unarchiveContactMutate = unarchiveContact.mutate;
  const handleArchiveContact = useCallback(
    async (contact: { id: string; name: string }) => {
      await archiveContactMutateAsync(contact.id);
      toast.success(
        `Archived ${contact.name}`,
        withUndo(() =>
          unarchiveContactMutate(contact.id, {
            onError: (err) => toast.error(`Could not undo: ${errorText(err)}`),
          }),
        ),
      );
    },
    [archiveContactMutateAsync, unarchiveContactMutate],
  );

  // A new contact's row flashes for 2 s.
  const [flashId, setFlashId] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSmartPasteOpen, setIsSmartPasteOpen] = useState(false);
  const [isCreateListOpen, setIsCreateListOpen] = useState(false);

  const createList = useCreateList();
  const reorderLists = useReorderLists();

  // The control that opened New contact or Add from text. Both dialogs, and
  // the form an extraction opens, return focus here: the dialog's own memory
  // would hold the removed Extract button.
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

  // `?new=1` opens New contact (from Pulse).
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

  // Reorder lists: a mouse drags a chip, its menu moves it.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const finePointer = useMediaQuery("(pointer: fine)");

  const moveList = (from: number, to: number) => {
    const order = lists.map((l) => l.id);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    reorderLists.mutate(order);
  };
  const endDrag = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };
  const dragProps = (idx: number): React.HTMLAttributes<HTMLDivElement> => ({
    draggable: true,
    onDragStart: () => setDragIdx(idx),
    onDragOver: (e) => {
      e.preventDefault();
      if (dragIdx !== null && dragIdx !== idx) setDragOverIdx(idx);
    },
    onDrop: () => {
      if (dragIdx !== null && dragIdx !== idx) moveList(dragIdx, idx);
      endDrag();
    },
    onDragEnd: endDrag,
    className: cn(
      "transition-all cursor-grab active:cursor-grabbing",
      // Dashed: a solid ring reads as keyboard focus.
      dragOverIdx === idx &&
        dragIdx !== idx &&
        "outline-2 outline-dashed outline-primary/60 rounded-xl",
      dragIdx === idx && "opacity-40",
    ),
  });

  // The right fade shows only while more chips sit past the edge. A wheel
  // scrolls the row sideways, since the row hides its scrollbar.
  const pillsRef = useRef<HTMLDivElement>(null);
  const [moreRight, setMoreRight] = useState(false);
  const measurePills = useCallback(() => {
    const row = pillsRef.current;
    if (row)
      setMoreRight(row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
  }, []);
  useLayoutEffect(measurePills, [measurePills, lists, filters.filterMode]);
  useEffect(() => {
    const row = pillsRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measurePills);
    observer.observe(row);
    return () => observer.disconnect();
  }, [measurePills]);

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

  // Cmd/Ctrl+A selects the filtered contacts, only in select mode and outside
  // a field, where it would otherwise select text.
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

  // The room the floating bulk bar takes under the last row, so every row
  // can scroll above it. Measured: the bar wraps in a narrow pane and sits
  // over the tab bar on a phone.
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

  // The search's count shows above the first result, not in the box, where
  // it takes the query's room and reads as a find bar. A screen reader hears
  // it once typing pauses for a second (WCAG 4.1.3).
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

  // Only for an alphabetical list long enough to need it.
  const showAlphabetRail =
    sortBy === "name" && !searchQuery && filteredContacts.length >= 15;

  // The Back slide (`views/settings/slide`) waits for the rows to be back in
  // place. A child's layout effects run first, so they are.
  useLayoutEffect(() => {
    if (!id) settleSlide(location.pathname);
  }, [id, location.pathname]);

  return (
    // `settings-stage`: below `lg` the list slides when a contact opens or
    // closes.
    <div className="settings-stage flex flex-col h-full overflow-hidden">
      {/* One h1 per page: beside an open contact, its name is the h1. */}
      <PageHeader
        title={NAMES.network.label}
        titleAs={id ? "h2" : "h1"}
        // Keeps the 36 px of the icon buttons, so select mode's 32 px buttons
        // move no row.
        actionsClassName="min-h-9"
        className={cn(
          "px-4 pb-3 bg-surface-container-lowest sticky top-0 z-10",
          PAGE_TOP,
        )}
        actions={
          // Keyed, so focus follows the mode to Done and back to Select
          // (`useSwapFocus`) and does not stay on a relabeled button.
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
              <RailTooltip key="select" label="Select" side="bottom">
                <button
                  ref={selectButtonRef}
                  type="button"
                  onClick={enterSelectMode}
                  className={ICON_BTN}
                  aria-label="Select"
                >
                  <Square className="w-5 h-5" aria-hidden="true" />
                </button>
              </RailTooltip>
              <RailTooltip key="import" label="Import" side="bottom">
                <button
                  type="button"
                  onClick={() => setIsImportOpen(true)}
                  className={ICON_BTN}
                  aria-label="Import"
                >
                  <Upload className="w-5 h-5" aria-hidden="true" />
                </button>
              </RailTooltip>
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
          <SearchField
            className="flex-1"
            aria-label="Search contacts"
            id="search-input"
            type="text"
            enterKeyHint="search"
            placeholder="Search…"
            value={inputValue}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchQuery("");
                e.currentTarget.blur();
              } else if (e.key === "ArrowDown" && !e.altKey) {
                // ↓ goes to the current row, or to the list while that row
                // is scrolled out, which hands focus on to the row.
                const list = document.getElementById("contact-list");
                const row =
                  list?.querySelector<HTMLElement>('[tabindex="0"]') ??
                  (list?.tabIndex === 0 ? list : null);
                if (!row) return;
                e.preventDefault();
                row.focus();
              }
            }}
            onClear={() => setSearchQuery("")}
          />
          {/* The label names the control: "A to Z" alone does not. */}
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

        {/* Filter chips: All, Tracked, then one per list. The row shows with no
            lists too, because the Tracked chip is the way into tracking. In
            select mode the chips stay, faded and `inert`: removing them
            shrinks the header 44 px and moves every row under the finger. */}
        <div
          className={cn(
            "relative transition-opacity",
            isSelectMode && "opacity-40",
          )}
          inert={isSelectMode}
        >
          {moreRight && (
            <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-surface-container-lowest to-transparent z-10" />
          )}
          <div
            id="filter-pills-row"
            ref={pillsRef}
            onScroll={measurePills}
            onWheel={(e) => {
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX))
                e.currentTarget.scrollLeft += e.deltaY;
            }}
            // A scroller clips outside its padding box: the padding is room
            // for the 44 px tap boxes and focus rings, and the negative
            // margins cancel it.
            className="flex gap-1.5 overflow-x-auto scrollbar-hide -my-2 pt-2 pb-2.5 -mx-1 px-1"
          >
            <FilterButton
              label="All"
              icon={<Users className="w-3.5 h-3.5" />}
              count={activeContactCount}
              active={filterMode === "all"}
              onClick={() => setFilterMode("all")}
            />
            {/* A tag from the Tags page, shown only while it filters. */}
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
              <ListChip
                key={list.id}
                list={list}
                index={idx}
                count={lists.length}
                active={filterMode === list.id}
                onToggle={() =>
                  setFilterMode(filterMode === list.id ? "all" : list.id)
                }
                onMove={moveList}
                openMenu={handleContextMenu}
                drag={finePointer ? dragProps(idx) : null}
              />
            ))}
            <div className="shrink-0 w-6" aria-hidden />
          </div>
        </div>
      </PageHeader>
      <ContactRows
        filteredContacts={filteredContacts}
        recentContacts={
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

        {/* The connection banner says nothing about a 500. */}
        {!isLoading && isError && activeContactCount === 0 && (
          <LoadFailed
            what="your contacts"
            onRetry={() => void refetch()}
            level={id ? 3 : 2}
          />
        )}

        {/* No contacts at all. Not on error: a failed fetch is not an empty
            network. Import leads, since people arrive with an export. */}
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

        {!isLoading &&
          activeContactCount > 0 &&
          filteredContacts.length === 0 &&
          (searchQuery ? (
            <EmptyState
              icon={SearchX}
              title={`No one matches "${searchQuery}"`}
              body={searchHint(searchQuery)}
              action={{
                label: "Clear search",
                onClick: () => setSearchQuery(""),
              }}
              level={id ? 3 : 2}
            />
          ) : filterMode === TRACKED_FILTER ? (
            <EmptyState
              icon={Radar}
              title="No one is tracked yet"
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
              title={`No one has the tag "${tagFilter}"`}
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
      {/* One context menu, shared by all rows. */}
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
        bulkReturnFocusRef={selectButtonRef}
        isModalOpen={isModalOpen}
        onCloseModal={() => setIsModalOpen(false)}
        onContactCreated={(newId) => {
          setFlashId(newId);
          setTimeout(() => setFlashId(null), 2000);
        }}
        isSmartPasteOpen={isSmartPasteOpen}
        // The form opens only after an extraction, filled in.
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
            toast.error(`Could not create the list: ${errorText(err)}`);
          }
        }}
        isCreateListPending={createList.isPending}
        isImportOpen={isImportOpen}
        onCloseImport={() => setIsImportOpen(false)}
      />
    </div>
  );
};
