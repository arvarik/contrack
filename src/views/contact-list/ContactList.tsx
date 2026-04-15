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
import React, { useState, useRef, useCallback, useMemo, useDeferredValue, useEffect } from "react";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  Search, Plus, Users, Upload, UserPlus, ListPlus,
  CheckSquare, Square, FileText, Sparkles,
  ArrowDownAZ, ArrowUpAZ, CalendarArrowDown, CalendarArrowUp, Clock,
  Archive, Copy,
} from "lucide-react";
import {
  useContacts, useLists, useCreateList, useReorderLists, useArchiveContact,
  useBulkUpdateContacts,
} from "../../api";
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ContactUpdateData } from "../../types";
import { ContextMenu, useContextMenu } from "../../components/ui/ContextMenu";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { ICON_BTN, SEARCH_INPUT, filterPill, PAGE_TITLE } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useScrollRestoration } from "../../hooks/useScrollRestoration";
import { usePullToRefresh } from "../../hooks/usePullToRefresh";
import { PullIndicator } from "../../components/ui/PullIndicator";
import { useRecentContacts, useRecentContactsLimit } from "../../hooks/useRecentContacts";
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

const FilterButton = ({ label, icon, count, active, onClick }: {
  label: string;
  icon: React.ReactNode;
  count: number;
  active: boolean;
  onClick: () => void;
}) => (
  <button onClick={onClick} className={filterPill(active)} aria-label={`Filter: ${label} (${count})`} aria-pressed={active}>
    {icon}
    {label}
    <span className={`ml-0.5 text-[10px] ${active ? 'text-primary/70' : 'opacity-50'}`}>{count}</span>
  </button>
);

// ---------------------------------------------------------------------------
// ContactRowWrapper — attaches context menu + long-press + recordVisit to a row
// ---------------------------------------------------------------------------

interface ContactRowWrapperProps {
  contact: any;
  active: boolean;
  isFlashing: boolean;
  isSelectMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  handleContextMenu: ReturnType<typeof useContextMenu>['handleContextMenu'];
  recordVisit: (id: string) => void;
  archiveContact: () => Promise<void>;
  navigate: (path: string) => void;
}

const ContactRowWrapper = React.memo(({
  contact,
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
  const contextItems = useMemo(() => [
    {
      id: 'view',
      label: 'View Contact',
      icon: <UserPlus className="w-3.5 h-3.5" />,
      onClick: () => navigate(`/contact/${contact.id}`),
    },
    {
      id: 'copy-email',
      label: contact.emails?.[0]?.email ? `Copy Email` : 'No email',
      icon: <Copy className="w-3.5 h-3.5" />,
      disabled: !contact.emails?.[0]?.email,
      onClick: () => {
        navigator.clipboard.writeText(contact.emails![0].email);
        toast.success('Email copied');
      },
    },
    { id: 'sep1', label: '', separator: true as const },
    {
      id: 'archive',
      label: 'Archive',
      icon: <Archive className="w-3.5 h-3.5" />,
      onClick: archiveContact,
    },
  ], [contact.id, contact.name, contact.emails, navigate, archiveContact]);

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
      onContextMenu={(e) => handleContextMenu(e, contextItems)}
      onClick={() => recordVisit(contact.id)}
      {...longPress}
      className={cn(
        "rounded-xl transition-all duration-300",
        isFlashing && "ring-2 ring-primary/40 shadow-[0_0_12px_rgba(0,158,219,0.2)]"
      )}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '1px 72px' }}
    >
      <ContactListItem
        contact={contact}
        active={active}
        isSelectMode={isSelectMode}
        isSelected={isSelected}
        onToggleSelect={onToggleSelect}
      />
    </div>
  );
});

// ---------------------------------------------------------------------------
// ContactList — Main component
// ---------------------------------------------------------------------------

export const ContactList = () => {
  const mountStart = useRef(performance.now());
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(`[Perf] ContactList mounted in ${(performance.now() - mountStart.current).toFixed(2)}ms`);
    }
  }, []);

  const { data: contacts = [], isLoading, refetch } = useContacts();

  useEffect(() => {
    if (!isLoading && contacts.length > 0 && import.meta.env.DEV) {
      console.log(`[Perf] ContactList data ready: items=${contacts.length}, time from mount=${(performance.now() - mountStart.current).toFixed(2)}ms`);
    }
  }, [isLoading, contacts.length]);

  const { data: lists = [] } = useLists();
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // ── Extracted hooks ─────────────────────────────────────────────────
  const filters = useContactListFilters(contacts);
  const multiSelect = useMultiSelect(filters.filteredContacts);
  const bulkUpdate = useBulkUpdateContacts();

  // ── UX hooks ────────────────────────────────────────────────────────
  usePageTitle('Network');
  const scrollRef = useScrollRestoration<HTMLDivElement>('contact-list');
  const { containerRef: pullRef, isPulling, pullProgress, isRefreshing, pullDistance } = usePullToRefresh(
    async () => { await refetch(); },
    { disabled: typeof window !== 'undefined' && window.innerWidth >= 768 }
  );
  const { contextMenu, handleContextMenu, closeContextMenu } = useContextMenu();
  const archiveContact = useArchiveContact();
  const { recentIds, recordVisit } = useRecentContacts();
  const { limit: recentLimit } = useRecentContactsLimit();

  // ── Visual flash: highlight newly created contact for 2s ────────────
  const [flashId, setFlashId] = useState<string | null>(null);

  // Merge containerRefs — both pullRef and scrollRef point to the same element
  const listScrollRef = useCallback((el: HTMLDivElement | null) => {
    (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    (pullRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  }, [scrollRef, pullRef]);

  // ── Modal visibility state ──────────────────────────────────────────
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSmartPasteOpen, setIsSmartPasteOpen] = useState(false);
  const [isCreateListOpen, setIsCreateListOpen] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isAddToListOpen, setIsAddToListOpen] = useState(false);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [isBulkDeleteConfirm, setIsBulkDeleteConfirm] = useState(false);

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
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return; }
    const newOrder = [...lists];
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(idx, 0, moved);
    reorderLists.mutate(newOrder.map(l => l.id));
    setDragIdx(null); setDragOverIdx(null);
  };
  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  // ── Shorthand refs ──────────────────────────────────────────────────
  const { filteredContacts, inputValue, searchQuery, setSearchQuery, filterMode, setFilterMode, sortBy, sortDir, cycleSortMode } = filters;
  const { isSelectMode, selectedIds, selectedCount, toggleSelect, enterSelectMode, exitSelectMode, selectAll, isPending } = multiSelect;

  // ── Virtualization ──────────────────────────────────────────────────
  const rowVirtualizer = useVirtualizer({
    count: filteredContacts.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72, // Estimated height of a row + gap (64px + 8px)
    overscan: 5, // Render 5 items outside viewport for smooth scrolling
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">      <div className="p-4 bg-surface-container-lowest sticky top-0 z-10 space-y-3">
        <div className="flex justify-between items-center">
          <h2 className={PAGE_TITLE}>Network</h2>
          <div className="flex items-center gap-1.5">
            {/* Multi-select toggle */}
            <button
              onClick={isSelectMode ? exitSelectMode : enterSelectMode}
              className={cn(
                ICON_BTN,
                isSelectMode && "text-primary bg-primary/10"
              )}
              title={isSelectMode ? "Exit Select Mode" : "Multi-Select"}
            >
              {isSelectMode ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
            </button>

            {!isSelectMode && (
              <>
                <button onClick={() => setIsImportOpen(true)} className={ICON_BTN} title="Import Contacts" aria-label="Import contacts">
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
                          onClick={() => { setIsModalOpen(true); setShowAddMenu(false); }}
                          className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-on-surface hover:bg-surface-container-low transition-colors text-left"
                        >
                          <UserPlus className="w-4 h-4 text-primary shrink-0" />
                          Add Contact
                        </button>
                        <button
                          onClick={() => { setIsSmartPasteOpen(true); setShowAddMenu(false); }}
                          className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-on-surface hover:bg-surface-container-low transition-colors text-left"
                        >
                          <FileText className="w-4 h-4 text-primary shrink-0" />
                          Add from Text
                          <span className="ml-auto text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">AI</span>
                        </button>
                        <button
                          onClick={() => { setIsCreateListOpen(true); setShowAddMenu(false); }}
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
                onClick={selectedCount === filteredContacts.length ? () => multiSelect.selectAll() : selectAll}
                className="text-xs font-bold text-primary px-3 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 transition-colors whitespace-nowrap"
              >
                {selectedCount === filteredContacts.length ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-1.5 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
            <input
              id="search-input"
              type="text"
              placeholder={isSelectMode ? `${selectedCount} selected — search to filter` : "Search..."}
              value={inputValue}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setSearchQuery(""); e.currentTarget.blur(); }
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
            title={`Sort: ${sortBy === 'name' ? 'Name' : 'Date Added'} ${sortDir === 'asc' ? '↑' : '↓'}`}
            aria-label={`Sort by ${sortBy === 'name' ? 'name' : 'date added'}, ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
          >
            {sortBy === 'name'
              ? (sortDir === 'asc' ? <ArrowDownAZ className="w-4 h-4" /> : <ArrowUpAZ className="w-4 h-4" />)
              : (sortDir === 'desc' ? <CalendarArrowDown className="w-4 h-4" /> : <CalendarArrowUp className="w-4 h-4" />)
            }
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
                count={contacts.filter(c => !c.isArchived).length}
                active={filterMode === 'all'}
                onClick={() => setFilterMode('all')}
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
                    dragOverIdx === idx && dragIdx !== idx && "ring-2 ring-primary/40 rounded-xl",
                    dragIdx === idx && "opacity-40"
                  )}
                >
                  <FilterButton
                    label={list.name}
                    icon={<ListIcon icon={list.icon} className="w-3.5 h-3.5" />}
                    count={list.memberCount ?? 0}
                    active={filterMode === list.id}
                    onClick={() => setFilterMode(filterMode === list.id ? 'all' : list.id)}
                  />
                </div>
              ))}
              <div className="shrink-0 w-6" aria-hidden />
            </div>
          </div>
        )}
      </div>

      {/* Contact list */}
      <div
        ref={listScrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-2 pb-24 md:pb-4 scrollbar-hide"
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
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl animate-pulse" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="w-10 h-10 rounded-full bg-surface-container-high shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="h-3.5 bg-surface-container-high rounded-full w-3/5" />
                  <div className="h-3 bg-surface-container rounded-full w-2/5" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state: 0 contacts total (onboarding) */}
        {!isLoading && contacts.filter(c => !c.isArchived).length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-4 p-6">
            <div className="w-16 h-16 rounded-2xl bg-primary/8 flex items-center justify-center">
              <Users className="w-8 h-8 text-primary/60" />
            </div>
            <div>
              <p className="font-bold text-base">Your network is empty</p>
              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed max-w-[200px] mx-auto">
                Add your first contact to get started
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-[200px]">
              <button
                onClick={() => setIsModalOpen(true)}
                className="btn-primary flex items-center justify-center gap-2 text-sm py-2.5"
              >
                <UserPlus className="w-4 h-4" />
                Add Contact  <kbd className="hidden sm:inline text-[10px] bg-white/20 px-1.5 py-0.5 rounded-md font-mono">N</kbd>
              </button>
              <button
                onClick={() => setIsSmartPasteOpen(true)}
                className="btn-secondary flex items-center justify-center gap-2 text-sm py-2.5"
              >
                <Sparkles className="w-4 h-4" />
                Smart Paste  <kbd className="hidden sm:inline text-[10px] bg-surface-container-high px-1.5 py-0.5 rounded-md font-mono">V</kbd>
              </button>
            </div>
          </div>
        )}

        {/* Empty state: search/filter has no results */}
        {!isLoading && contacts.filter(c => !c.isArchived).length > 0 && filteredContacts.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-center gap-3 p-6">
            <Search className="w-8 h-8 text-on-surface-variant/30" />
            <div>
              <p className="font-bold text-sm">
                {searchQuery ? `No results for "${searchQuery}"` : 'No contacts in this list'}
              </p>
              {searchQuery && (
                <p className="text-xs text-on-surface-variant mt-1">Try the AI search for deeper results</p>
              )}
            </div>
            {searchQuery && (
              <button
                onClick={() => navigate(`/search?q=${encodeURIComponent(searchQuery)}`)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Search with AI
              </button>
            )}
          </div>
        )}

        {/* ── Recent contacts strip ─────────────────────────────────────── */}
        {!isLoading && !searchQuery && filterMode === 'all' && recentIds.length > 0 && (
          (() => {
            const recentContacts = recentIds
              .map(rid => contacts.find(c => c.id === rid && !c.isArchived))
              .filter(Boolean)
              .slice(0, recentLimit) as typeof contacts;
            if (recentContacts.length === 0) return null;
            return (
              <div className="mb-3">
                <div className="flex items-center gap-1.5 px-1 mb-1.5">
                  <Clock className="w-3 h-3 text-on-surface-variant/50" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/50">Recent</span>
                </div>
                <div className="space-y-1">
                  {recentContacts.map(contact => (
                    <ContactListItem
                      key={`recent-${contact.id}`}
                      contact={contact}
                      active={id === contact.id}
                      isSelectMode={isSelectMode}
                      isSelected={selectedIds.has(contact.id)}
                      onToggleSelect={toggleSelect}
                    />
                  ))}
                </div>
                <div className="mt-3 mb-1 h-px bg-surface-container-high mx-1" />
              </div>
            );
          })()
        )}

        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const contact = filteredContacts[virtualItem.index];
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                  paddingBottom: '8px', // Replaces space-y-2
                }}
              >
                <ContactRowWrapper
                  contact={contact}
                  active={id === contact.id}
                  isFlashing={flashId === contact.id}
                  isSelectMode={isSelectMode}
                  isSelected={selectedIds.has(contact.id)}
                  onToggleSelect={toggleSelect}
                  handleContextMenu={handleContextMenu}
                  recordVisit={recordVisit}
                  archiveContact={async () => {
                    await archiveContact.mutateAsync(contact.id);
                    toast.success(`Archived "${contact.name}"`);
                  }}
                  navigate={navigate}
                />
              </div>
            );
          })}
        </div>

        {/* Context menu — portal-rendered, shared across all rows */}
        <ContextMenu {...contextMenu} onClose={closeContextMenu} />
      </div>

      <AnimatePresence>
        {isSelectMode && selectedCount > 0 && (
          <BulkActionToolbar
            selectedCount={selectedCount}
            isPending={isPending}
            onArchive={multiSelect.handleBulkArchive}
            onAddToList={() => setIsAddToListOpen(true)}
            onEditField={() => setIsBulkEditOpen(true)}
            onColorChange={multiSelect.handleBulkColorChange}
            onExportCSV={multiSelect.handleExportCSV}
            onDelete={() => setIsBulkDeleteConfirm(true)}
          />
        )}
      </AnimatePresence>

      {/* ── All Modals ───────────────────────────────────────────────── */}
      <ContactListModals
        isBulkDeleteConfirm={isBulkDeleteConfirm}
        onCloseBulkDelete={() => setIsBulkDeleteConfirm(false)}
        selectedCount={selectedCount}
        onBulkDelete={() => {
          multiSelect.handleBulkDelete();
          setIsBulkDeleteConfirm(false);
        }}
        isBulkDeletePending={false}
        isAddToListOpen={isAddToListOpen}
        onCloseAddToList={() => setIsAddToListOpen(false)}
        lists={lists}
        onBulkAddToList={(listId) => {
          multiSelect.handleBulkAddToList(listId);
          setIsAddToListOpen(false);
        }}
        isBulkAddToListPending={false}
        isBulkEditOpen={isBulkEditOpen}
        onCloseBulkEdit={() => setIsBulkEditOpen(false)}
        onBulkEditApply={(field, value) => {
          const ids = Array.from(selectedIds);
          bulkUpdate.mutate({ ids, data: { [field]: value } as ContactUpdateData }, {
            onSuccess: ({ count }) => {
              toast.success(`Updated ${count} contact${count !== 1 ? 's' : ''}`);
              setIsBulkEditOpen(false);
              exitSelectMode();
            },
            onError: (err) => toast.error(`Update failed: ${(err instanceof Error ? err.message : String(err))}`),
          });
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
