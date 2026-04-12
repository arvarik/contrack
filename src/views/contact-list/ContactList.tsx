import React, { useMemo, useState, useRef, useEffect, useCallback, useDeferredValue } from "react";
import { isTypingTarget } from "../../lib/keyboard";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import {
  Search, Plus, Users, Upload, ChevronDown, UserPlus, ListPlus,
  CheckSquare, Square, FileText, Sparkles, Trash2, Archive, Copy, Clock,
  ArrowDownAZ, ArrowUpAZ, CalendarArrowDown, CalendarArrowUp,
} from "lucide-react";
import {
  useContacts, useCreateContact, useParseContactText, useLists,
  useCreateList, useReorderLists, useBulkDeleteContacts,
  useBulkUpdateContacts, useBulkAddToList, useArchiveContact,
} from "../../api";
import type { ContactUpdateData } from "../../types";
import { Modal } from "../../components/ui/Modal";
import { ImportModal } from "../../components/ImportModal";
import { BulkEditFieldModal } from "../../components/BulkEditFieldModal";
import { SkeletonText, AnimatedSkeleton } from "../../components/ui/AnimatedSkeleton";
import { ContextMenu, useContextMenu } from "../../components/ui/ContextMenu";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { ICON_BTN, SEARCH_INPUT, filterPill, PAGE_TITLE, FORM_INPUT, FORM_LABEL, formInputHighlight } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useScrollRestoration } from "../../hooks/useScrollRestoration";
import { usePullToRefresh } from "../../hooks/usePullToRefresh";
import { PullIndicator } from "../../components/ui/PullIndicator";
import { useRecentContacts } from "../../hooks/useRecentContacts";
import { useRecentContactsLimit } from "../../hooks/useRecentContacts";
import { useLongPress } from "../../hooks/useLongPress";

import { ContactListItem } from "./ContactListItem";
import { BulkActionToolbar } from "./BulkActionToolbar";
import { CreateListModal, ListIcon } from "./CreateListModal";
import { fallbackAvatarUrl } from '../../lib/avatar';

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
  contactId: string;
  isFlashing: boolean;
  contextItems: Parameters<ReturnType<typeof useContextMenu>['handleContextMenu']>[1];
  handleContextMenu: ReturnType<typeof useContextMenu>['handleContextMenu'];
  recordVisit: (id: string) => void;
  navigate: (path: string) => void;
  children: React.ReactNode;
}

const ContactRowWrapper = ({
  contactId,
  isFlashing,
  contextItems,
  handleContextMenu,
  recordVisit,
  navigate,
  children,
}: ContactRowWrapperProps) => {
  const longPress = useLongPress(({ clientX, clientY }) => {
    // Create a synthetic mouse event so handleContextMenu can position correctly
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
      onClick={() => recordVisit(contactId)}
      {...longPress}
      className={cn(
        "rounded-xl transition-all duration-300",
        isFlashing && "ring-2 ring-primary/40 shadow-[0_0_12px_rgba(0,158,219,0.2)]"
      )}
    >
      {children}
    </div>
  );
};

// ---------------------------------------------------------------------------
// ContactList — Left-pane master view for browsing and filtering contacts
// ---------------------------------------------------------------------------

export const ContactList = () => {
  const { data: contacts = [], isLoading, refetch } = useContacts();
  const { data: lists = [] } = useLists();
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL-persisted state: both filter and search survive back-navigation
  const filterMode = searchParams.get('list') ?? 'all';

  // ── Search input: local state + debounced URL sync ──────────────────────
  // The input is controlled by fast local state to prevent character-dropping.
  // URL params are updated after a 200ms debounce for permalink persistence.
  // The expensive contact filter uses useDeferredValue so it never blocks typing.
  const [inputValue, setInputValue] = useState(() => searchParams.get('q') ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync URL → local state when user navigates back/forward
  useEffect(() => {
    const urlQ = searchParams.get('q') ?? '';
    // Only sync if the URL was changed externally (back/forward nav),
    // not by our own debounced setSearchParams.
    setInputValue(prev => prev === urlQ ? prev : urlQ);
  }, [searchParams]);

  // Debounce local state → URL params (200ms)
  const syncQueryToUrl = useCallback((val: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        if (val) next.set('q', val); else next.delete('q');
        return next;
      }, { replace: true });
    }, 200);
  }, [setSearchParams]);

  const setSearchQuery = useCallback((val: string) => {
    setInputValue(val);       // Instant — no lag
    syncQueryToUrl(val);      // Debounced — URL persistence
  }, [syncQueryToUrl]);

  // The actual query used for filtering — deferred so heavy filter work
  // doesn't block the input's render cycle on a 400+ contact list.
  const searchQuery = useDeferredValue(inputValue);

  const setFilterMode = (mode: string) => {
    const params: Record<string, string> = {};
    if (mode !== 'all') params.list = mode;
    if (inputValue) params.q = inputValue;
    setSearchParams(params, { replace: true });
  };

  // UX hooks
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


  // Visual flash: highlight a newly created contact for 2s
  const [flashId, setFlashId] = useState<string | null>(null);

  // Merge containerRefs — both pullRef and scrollRef point to the same element
  const listScrollRef = useCallback((el: HTMLDivElement | null) => {
    (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    (pullRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  }, [scrollRef, pullRef]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSmartPasteOpen, setIsSmartPasteOpen] = useState(false);
  const [smartPasteText, setSmartPasteText] = useState("");
  const [parsedData, setParsedData] = useState<any>(null);
  const [isCreateListOpen, setIsCreateListOpen] = useState(false);
  const [showMoreLists, setShowMoreLists] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // ── Sort state ──────────────────────────────────────────────────────────
  type SortField = 'name' | 'date';
  type SortDir = 'asc' | 'desc';
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const cycleSortMode = useCallback(() => {
    if (sortBy === 'name' && sortDir === 'asc') { setSortDir('desc'); }
    else if (sortBy === 'name' && sortDir === 'desc') { setSortBy('date'); setSortDir('desc'); }
    else if (sortBy === 'date' && sortDir === 'desc') { setSortDir('asc'); }
    else { setSortBy('name'); setSortDir('asc'); }
  }, [sortBy, sortDir]);

  // ── Multi-select state ──────────────────────────────────────────────────
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAddToListOpen, setIsAddToListOpen] = useState(false);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [isBulkDeleteConfirm, setIsBulkDeleteConfirm] = useState(false);

  const bulkDelete = useBulkDeleteContacts();
  const bulkUpdate = useBulkUpdateContacts();
  const bulkAddToList = useBulkAddToList();


  const createContact = useCreateContact();
  const parseContactText = useParseContactText();
  const createList = useCreateList();
  const reorderLists = useReorderLists();

  // Drag-to-reorder state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

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

  // ── Select mode helpers ─────────────────────────────────────────────────
  const enterSelectMode = () => {
    setIsSelectMode(true);
    setSelectedIds(new Set());
  };
  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  };
  const toggleSelect = useCallback((contactId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(contactId) ? next.delete(contactId) : next.add(contactId);
      return next;
    });
  }, []);
  const selectAll = () => {
    setSelectedIds(new Set(filteredContacts.map(c => c.id)));
  };

  const handleCreateContact = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());
    const emailValue = data.email as string;
    const phoneValue = data.phone as string;
    try {
      const newContact = await createContact.mutateAsync({
        name: data.name as string,
        role: data.role as string,
        company: data.company as string,
        location: data.location as string,
        avatarUrl: (data.avatarUrl as string) || fallbackAvatarUrl(data.name as string),
        emails: emailValue ? [{ email: emailValue, label: 'work', isPrimary: true }] : [],
        phones: phoneValue ? [{ phone: phoneValue, label: 'mobile', isPrimary: true }] : [],
        ...(parsedData?.socialLinks ? { socialLinks: parsedData.socialLinks } : {}),
        ...(parsedData?.education ? { education: parsedData.education } : {}),
        ...(parsedData?.experience ? { experience: parsedData.experience } : {}),
      });
      setIsModalOpen(false);
      setParsedData(null);
      setSmartPasteText("");
      toast.success(`Created "${data.name}"`);
      // Visual flash: highlight the new row for 2 seconds
      if (newContact?.id) {
        setFlashId(newContact.id);
        setTimeout(() => setFlashId(null), 2000);
      }
    } catch (err: any) {
      toast.error(`Failed to create contact: ${err.message}`);
    }
  };

  // Exclude archived contacts from the network view and apply smart search
  const filteredContacts = useMemo(() => {
    let result = contacts.filter(contact => !contact.isArchived);

    // 1. Apply List Filter
    if (filterMode !== 'all') {
      result = result.filter(contact => contact.lists?.some(l => l.id === filterMode));
    }

    // 2. Apply Smart Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const normalizePhone = (p: string) => p.replace(/\D/g, '');
      const cleanPhoneQuery = normalizePhone(q);
      
      const scorableContacts = result.map(contact => {
        let score = 0;
        
        // --- High Priority (Name) ---
        const nameMatch = contact.name.toLowerCase();
        if (nameMatch === q) { score += 100; }
        else if (nameMatch.startsWith(q)) { score += 50; }
        else if (nameMatch.includes(q)) { score += 30; }

        // --- Medium Priority (Company, Role, Location, Industry) ---
        if (contact.company && contact.company.toLowerCase().includes(q)) score += 10;
        if (contact.role && contact.role.toLowerCase().includes(q)) score += 10;
        if (contact.location && contact.location.toLowerCase().includes(q)) score += 10;
        if (contact.industry && contact.industry.toLowerCase().includes(q)) score += 10;

        // --- Details match (Tags, Emails, Phones) ---
        if (contact.tags && contact.tags.some(t => t.tag.toLowerCase().includes(q))) score += 10;
        if (contact.emails && contact.emails.some(e => e.email.toLowerCase().includes(q))) score += 10;
        
        // Phone numbers — normalize both the query and stored numbers to digits only,
        // then check in both directions to handle country code mismatches
        // (e.g. query "+15551234567" should match stored "(555) 123-4567")
        if (cleanPhoneQuery && contact.phones) {
          const phoneMatch = contact.phones.some(p => {
            const normalized = normalizePhone(p.phone);
            return normalized.includes(cleanPhoneQuery) || cleanPhoneQuery.includes(normalized);
          });
          if (phoneMatch) score += 10;
        }

        return { contact, score };
      });

      // Filter out zero scores and sort by descending score (name first)
      result = scorableContacts
        .filter(c => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(c => c.contact);
    }

    // 3. Apply Sort (only when not actively searching — search has its own score sort)
    if (!searchQuery.trim()) {
      result.sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'name') {
          cmp = (a.name || '').localeCompare(b.name || '');
        } else {
          // Date added — newer first by default (desc)
          const da = new Date(a.addedAt || 0).getTime();
          const db = new Date(b.addedAt || 0).getTime();
          cmp = da - db;
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return result;
  }, [contacts, searchQuery, filterMode, sortBy, sortDir]);

  // Smart overflow: show at most 10 list pills inline, rest in dropdown
  const MAX_INLINE_LISTS = 10;
  const inlineLists = lists.slice(0, MAX_INLINE_LISTS);
  const overflowLists = lists.slice(MAX_INLINE_LISTS);
  const moreRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useClickOutside(moreRef, () => setShowMoreLists(false), showMoreLists);
  useClickOutside(addMenuRef, () => setShowAddMenu(false), showAddMenu);

  // Handle Keyboard Navigation
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;

      if (e.key === "Escape" && isSelectMode) { exitSelectMode(); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const editor = document.querySelector(".ProseMirror") as HTMLElement;
        if (editor) editor.focus();
        return;
      }
      if (e.key === "/") { e.preventDefault(); document.getElementById("search-input")?.focus(); return; }
      if (e.key === "n") { e.preventDefault(); setIsModalOpen(true); return; }
      if (e.key === "v") { e.preventDefault(); setIsSmartPasteOpen(true); return; }

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        if (filteredContacts.length === 0) return;
        const currentIndex = filteredContacts.findIndex(c => c.id === id);
        const nextIndex = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, filteredContacts.length - 1);
        navigate(`/contact/${filteredContacts[nextIndex].id}${location.search}`);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        if (filteredContacts.length === 0) return;
        const currentIndex = filteredContacts.findIndex(c => c.id === id);
        const prevIndex = currentIndex === -1 ? 0 : Math.max(currentIndex - 1, 0);
        navigate(`/contact/${filteredContacts[prevIndex].id}${location.search}`);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [id, filteredContacts, navigate, isSelectMode, location.search]);

  // Auto-scroll active item into view
  React.useEffect(() => {
    if (id) {
      const el = document.getElementById(`contact-row-${id}`);
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [id]);

  // ── Bulk action handlers ────────────────────────────────────────────────
  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    bulkDelete.mutate(ids, {
      onSuccess: ({ count }) => {
        toast.success(`Deleted ${count} contact${count !== 1 ? 's' : ''}`);
        exitSelectMode();
        setIsBulkDeleteConfirm(false);
      },
      onError: (err) => toast.error(`Delete failed: ${err.message}`),
    });
  };

  const handleBulkArchive = () => {
    const ids = Array.from(selectedIds);
    bulkUpdate.mutate({ ids, data: { isArchived: true } }, {
      onSuccess: ({ count }) => {
        toast.success(`Archived ${count} contact${count !== 1 ? 's' : ''}`);
        exitSelectMode();
      },
      onError: (err) => toast.error(`Archive failed: ${err.message}`),
    });
  };

  const handleBulkAddToList = (listId: string) => {
    const contactIds = Array.from(selectedIds);
    bulkAddToList.mutate({ listId, contactIds }, {
      onSuccess: ({ count }) => {
        toast.success(`Added ${count} contact${count !== 1 ? 's' : ''} to list`);
        setIsAddToListOpen(false);
        exitSelectMode();
      },
      onError: (err) => toast.error(`Failed: ${err.message}`),
    });
  };

  // ── Bulk colour change ─────────────────────────────────────────────────
  const handleBulkColorChange = (vibeId: string) => {
    const ids = Array.from(selectedIds);
    bulkUpdate.mutate({ ids, data: { themeColor: vibeId } }, {
      onSuccess: ({ count }) => {
        toast.success(`Updated color for ${count} contact${count !== 1 ? 's' : ''}`);
        exitSelectMode();
      },
      onError: (err) => toast.error(`Color update failed: ${err.message}`),
    });
  };

  const handleExportCSV = () => {
    const selected = filteredContacts.filter(c => selectedIds.has(c.id));
    const header = 'Name,Role,Company,Location,Email,Phone';
    const rows = selected.map(c => [
      c.name,
      c.role || '',
      c.company || '',
      c.location || '',
      c.emails?.[0]?.email || '',
      c.phones?.[0]?.phone || '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [header, ...rows].join('\n');

    const copyToClipboard = (text: string): Promise<void> => {
      // Try modern async Clipboard API first
      if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text);
      }
      // Fallback: legacy execCommand approach (works in all browsers)
      return new Promise((resolve, reject) => {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
        document.body.appendChild(el);
        el.focus();
        el.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(el);
        ok ? resolve() : reject(new Error('execCommand copy failed'));
      });
    };

    copyToClipboard(csv)
      .then(() => {
        toast.success(`Copied ${selected.length} contact${selected.length !== 1 ? 's' : ''} as CSV`);
        exitSelectMode();
      })
      .catch(() => {
        toast.error('Clipboard access denied — please allow clipboard permissions and try again.');
      });
  };

  const selectedCount = selectedIds.size;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4 bg-surface-container-lowest sticky top-0 z-10 space-y-3">
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
                onClick={selectedCount === filteredContacts.length ? () => setSelectedIds(new Set()) : selectAll}
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
            {/* Gradient fade-out to signal more pills to the right */}
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
              {/* Right padding so last pill isn't clipped by gradient */}
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

        {/* ── Recent contacts strip ──────────────────────────────────────────
           Only shown when no search/filter is active AND we have visit history.
           Uses the same contacts array (already loaded) — zero extra fetches.
        */}
        {!isLoading && !searchQuery && filterMode === 'all' && recentIds.length > 0 && (
          (() => {
            const recentContacts = recentIds
              .map(rid => contacts.find(c => c.id === rid && !c.isArchived))
              .filter(Boolean)
              .slice(0, recentLimit) as typeof contacts;  // honour user preference
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

        {filteredContacts.map(contact => {
          const active = id === contact.id;
          const isFlashing = flashId === contact.id;

          // Build context menu items for this contact
          const contextItems = [
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
              onClick: async () => {
                await archiveContact.mutateAsync(contact.id);
                toast.success(`Archived "${contact.name}"`);
              },
            },
          ];

          return (
            <ContactRowWrapper
              key={contact.id}
              contactId={contact.id}
              isFlashing={isFlashing}
              contextItems={contextItems}
              handleContextMenu={handleContextMenu}
              recordVisit={recordVisit}
              navigate={navigate}
            >
              <ContactListItem
                contact={contact}
                active={active}
                isSelectMode={isSelectMode}
                isSelected={selectedIds.has(contact.id)}
                onToggleSelect={toggleSelect}
              />
            </ContactRowWrapper>
          );
        })}

        {/* Context menu — portal-rendered, shared across all rows */}
        <ContextMenu {...contextMenu} onClose={closeContextMenu} />
      </div>

      <AnimatePresence>
        {isSelectMode && selectedCount > 0 && (
          <BulkActionToolbar
            selectedCount={selectedCount}
            isPending={bulkUpdate.isPending || bulkDelete.isPending || bulkAddToList.isPending}
            onArchive={handleBulkArchive}
            onAddToList={() => setIsAddToListOpen(true)}
            onEditField={() => setIsBulkEditOpen(true)}
            onColorChange={handleBulkColorChange}
            onExportCSV={handleExportCSV}
            onDelete={() => setIsBulkDeleteConfirm(true)}
          />
        )}
      </AnimatePresence>

      {/* ── Bulk Delete Confirm Modal ────────────────────────────────────── */}
      <Modal isOpen={isBulkDeleteConfirm} onClose={() => setIsBulkDeleteConfirm(false)} title="Delete Contacts">
        <div className="space-y-4 pt-2">
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Permanently delete <span className="font-bold text-on-surface">{selectedCount}</span> contact{selectedCount !== 1 ? 's' : ''}?
            This will remove all their interactions and data. <span className="text-rose-500 font-bold">This cannot be undone.</span>
          </p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setIsBulkDeleteConfirm(false)}
              className="flex-1 py-2.5 rounded-xl bg-surface-container font-bold text-sm text-on-surface hover:bg-surface-container-high transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDelete.isPending}
              className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white font-bold text-sm hover:bg-rose-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              {bulkDelete.isPending ? 'Deleting...' : `Delete ${selectedCount}`}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Add to List Modal ──────────────────────────────────────────── */}
      <Modal isOpen={isAddToListOpen} onClose={() => setIsAddToListOpen(false)} title="Add to List">
        <div className="space-y-2 pt-2">
          <p className="text-xs text-on-surface-variant mb-4">
            Choose a list to add the {selectedCount} selected contact{selectedCount !== 1 ? 's' : ''} to:
          </p>
          {lists.length === 0 && (
            <p className="text-sm text-on-surface-variant text-center py-4">No lists yet. Create one first.</p>
          )}
          {lists.map(list => (
            <button
              key={list.id}
              onClick={() => handleBulkAddToList(list.id)}
              disabled={bulkAddToList.isPending}
              className="flex items-center gap-3 w-full px-4 py-3 rounded-xl bg-surface-container hover:bg-surface-container-high transition-colors text-left disabled:opacity-50"
            >
              <span className="text-primary"><ListIcon icon={list.icon} className="w-4 h-4" /></span>
              <span className="font-semibold text-sm text-on-surface">{list.name}</span>
              <span className="ml-auto text-xs text-on-surface-variant opacity-60">{list.memberCount ?? 0} members</span>
            </button>
          ))}
        </div>
      </Modal>

      {/* ── Bulk Edit Field Modal ─────────────────────────────────────── */}
      <BulkEditFieldModal
        isOpen={isBulkEditOpen}
        onClose={() => setIsBulkEditOpen(false)}
        selectedCount={selectedCount}
        onApply={(field, value) => {
          const ids = Array.from(selectedIds);
          bulkUpdate.mutate({ ids, data: { [field]: value } as ContactUpdateData }, {
            onSuccess: ({ count }) => {
              toast.success(`Updated ${count} contact${count !== 1 ? 's' : ''}`);
              setIsBulkEditOpen(false);
              exitSelectMode();
            },
            onError: (err) => toast.error(`Update failed: ${err.message}`),
          });
        }}
        isPending={bulkUpdate.isPending}
      />

      {/* ── New Contact Modal ──────────────────────────────────────────── */}
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setParsedData(null); }} title="New Contact">
        <form onSubmit={handleCreateContact} className="space-y-4 pt-2">
          <div>
            <label className={FORM_LABEL}>Full Name *</label>
            <input required name="name" type="text" defaultValue={parsedData?.name || ''} className={cn(FORM_INPUT, formInputHighlight(!!parsedData?.name))} placeholder="Jane Doe" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={FORM_LABEL}>Role</label>
              <input name="role" type="text" defaultValue={parsedData?.role || ''} className={cn(FORM_INPUT, formInputHighlight(!!parsedData?.role))} placeholder="CEO" />
            </div>
            <div>
              <label className={FORM_LABEL}>Company</label>
              <input name="company" type="text" defaultValue={parsedData?.company || ''} className={cn(FORM_INPUT, formInputHighlight(!!parsedData?.company))} placeholder="Acme Corp" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={FORM_LABEL}>Email</label>
              <input name="email" type="email" defaultValue={parsedData?.emails?.[0]?.email || parsedData?.email || ''} className={cn(FORM_INPUT, formInputHighlight(!!(parsedData?.emails?.[0]?.email || parsedData?.email)))} placeholder="jane@example.com" />
            </div>
            <div>
              <label className={FORM_LABEL}>Phone</label>
              <input name="phone" type="tel" defaultValue={parsedData?.phones?.[0]?.phone || parsedData?.phone || ''} className={cn(FORM_INPUT, formInputHighlight(!!(parsedData?.phones?.[0]?.phone || parsedData?.phone)))} placeholder="+1 (555) 000-0000" />
            </div>
          </div>
          <div>
            <label className={FORM_LABEL}>Location</label>
            <input name="location" type="text" defaultValue={parsedData?.location || ''} className={cn(FORM_INPUT, formInputHighlight(!!parsedData?.location))} placeholder="San Francisco, CA" />
          </div>
          <div className="pt-4">
            <button type="submit" disabled={createContact.isPending} className="w-full bg-primary text-on-primary font-bold py-3 rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 text-sm shadow-sm">
              {createContact.isPending ? 'Saving...' : 'Save Contact'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Add from Text Modal ───────────────────────────────────────────── */}
      <Modal isOpen={isSmartPasteOpen} onClose={() => setIsSmartPasteOpen(false)} title="Add from Text">
        <div className="space-y-4 pt-2">
          {parseContactText.isPending ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 pt-2">
              <div className="flex items-center gap-2 text-primary text-sm font-bold pb-2">
                <Sparkles className="w-4 h-4" /> Extracting details with AI...
              </div>
              <div className="space-y-4">
                <AnimatedSkeleton className="h-10 w-full rounded-lg" delay={0} />
                <div className="grid grid-cols-2 gap-4">
                  <AnimatedSkeleton className="h-10 rounded-lg" delay={0.1} />
                  <AnimatedSkeleton className="h-10 rounded-lg" delay={0.2} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <AnimatedSkeleton className="h-10 rounded-lg" delay={0.3} />
                  <AnimatedSkeleton className="h-10 rounded-lg" delay={0.4} />
                </div>
              </div>
            </motion.div>
          ) : (
            <>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                Paste anything — an email signature, a LinkedIn bio, a text snippet, or rough notes — and AI will pull out the contact details for you.
              </p>
              <textarea
                autoFocus
                value={smartPasteText}
                onChange={(e) => setSmartPasteText(e.target.value)}
                rows={5}
                className="w-full bg-surface-container border-none rounded-xl p-4 text-sm focus:ring-2 focus:ring-primary font-mono text-on-surface resize-none focus:outline-none"
                placeholder={`Examples:\n• "Jane Kim | VP Eng @ Stripe | jane@stripe.com | based in NYC"\n• A copied LinkedIn summary\n• A forwarded email signature`}
              />
            </>
          )}
          <div className="flex justify-end pt-2">
            <button
              onClick={async () => {
                try {
                  const res = await parseContactText.mutateAsync(smartPasteText);
                  setParsedData(res);
                  setIsSmartPasteOpen(false);
                  setIsModalOpen(true);
                  toast.success("Contact details extracted — review and save");
                } catch (err) {
                  toast.error("Extraction failed. Is your API key configured?");
                }
              }}
              disabled={!smartPasteText.trim() || parseContactText.isPending}
              className="bg-primary text-on-primary font-bold py-2.5 px-6 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 text-sm flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              {parseContactText.isPending ? 'Extracting…' : 'Extract Contact'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Create List Modal ────────────────────────────────────────────── */}
      <CreateListModal
        isOpen={isCreateListOpen}
        onClose={() => setIsCreateListOpen(false)}
        onCreate={async (name, icon) => {
          try {
            await createList.mutateAsync({ name, icon });
            setIsCreateListOpen(false);
            toast.success(`Created list "${name}"`);
          } catch (err: any) {
            toast.error(`Failed to create list: ${err.message}`);
          }
        }}
        isPending={createList.isPending}
      />

      {/* ── Import Contacts Modal ────────────────────────────────────────── */}
      <ImportModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} onSuccess={() => toast.success("Import complete!")} />
    </div>
  );
};
