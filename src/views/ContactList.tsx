import React, { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  Search, Plus, Briefcase, Building, Star, Users, Upload,
  ChevronDown, X, UserPlus, ListPlus, CheckSquare, Square, Trash2,
  Archive, ListPlus as AddToListIcon, Pencil, Download, CheckCheck,
  Palette, FileText,
  // Icon picker icons
  Heart, Crown, Flame, Rocket, Target, Gem, Award, Globe, Zap, Shield,
  Coffee, Music, Camera, BookOpen, TrendingUp, Anchor, Flag, Sparkles, Sun,
} from "lucide-react";
import {
  useContacts, useCreateContact, useParseContactText, useLists, useCreateList, useReorderLists,
  useBulkDeleteContacts, useBulkUpdateContacts, useBulkAddToList,
} from "../api";
import { Modal } from "../components/Modal";
import { ImportModal } from "../components/ImportModal";
import { BulkEditFieldModal } from "../components/BulkEditFieldModal";
import { VIBE_COLORS } from "../components/ContactDetail/VibePickerPopover";
import { motion, AnimatePresence } from "motion/react";
import { useCompanyLogo } from "../hooks/useCompanyLogo";
import { HealthRingAvatar } from "../components/HealthRingAvatar";
import { toast } from "sonner";
import { ICON_BTN, SEARCH_INPUT, filterPill, listRow, PAGE_TITLE } from "../lib/styles";
import { cn } from "../lib/utils";
import { Contact } from "../types";

// ---------------------------------------------------------------------------
// Icon Registry — maps string keys to Lucide components
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  star: Star, heart: Heart, crown: Crown, flame: Flame, rocket: Rocket,
  target: Target, gem: Gem, award: Award, briefcase: Briefcase, users: Users,
  globe: Globe, zap: Zap, shield: Shield, coffee: Coffee, music: Music,
  camera: Camera, 'book-open': BookOpen, 'trending-up': TrendingUp,
  anchor: Anchor, flag: Flag, sparkles: Sparkles, sun: Sun,
};

const ICON_OPTIONS = Object.keys(ICON_MAP);

const ListIcon = ({ icon, className }: { icon: string; className?: string }) => {
  const Icon = ICON_MAP[icon] || Star;
  return <Icon className={className} />;
};

// ---------------------------------------------------------------------------
// ContactList — Left-pane master view for browsing and filtering contacts
// ---------------------------------------------------------------------------

export const ContactList = () => {
  const { data: contacts = [], isLoading } = useContacts();
  const { data: lists = [] } = useLists();
  const { id } = useParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSmartPasteOpen, setIsSmartPasteOpen] = useState(false);
  const [smartPasteText, setSmartPasteText] = useState("");
  const [parsedData, setParsedData] = useState<any>(null);
  const [isCreateListOpen, setIsCreateListOpen] = useState(false);
  const [showMoreLists, setShowMoreLists] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // ── Multi-select state ──────────────────────────────────────────────────
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAddToListOpen, setIsAddToListOpen] = useState(false);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [isBulkDeleteConfirm, setIsBulkDeleteConfirm] = useState(false);
  const [showBulkColorPicker, setShowBulkColorPicker] = useState(false);
  const bulkColorPickerRef = React.useRef<HTMLDivElement>(null);

  const bulkDelete = useBulkDeleteContacts();
  const bulkUpdate = useBulkUpdateContacts();
  const bulkAddToList = useBulkAddToList();

  const navigate = useNavigate();

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
    setShowBulkColorPicker(false);
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
      await createContact.mutateAsync({
        name: data.name as string,
        role: data.role as string,
        company: data.company as string,
        location: data.location as string,
        avatarUrl: (data.avatarUrl as string) || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(data.name as string)}&mouth=default,smile,serious`,
        emails: emailValue ? [{ email: emailValue, label: 'work', isPrimary: true }] : [],
        phones: phoneValue ? [{ phone: phoneValue, label: 'mobile', isPrimary: true }] : [],
        ...(parsedData?.socialLinks ? { socialLinks: parsedData.socialLinks } : {}),
        ...(parsedData?.education ? { education: parsedData.education } : {}),
        ...(parsedData?.experience ? { experience: parsedData.experience } : {}),
      } as any);
      setIsModalOpen(false);
      setParsedData(null);
      setSmartPasteText("");
      toast.success(`Created "${data.name}"`);
    } catch (err: any) {
      toast.error(`Failed to create contact: ${err.message}`);
    }
  };

  // Exclude archived contacts from the network view
  const filteredContacts = useMemo(() => {
    return contacts.filter(contact => {
      if (contact.isArchived) return false;

      const matchesSearch = contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (contact.company && contact.company.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (contact.role && contact.role.toLowerCase().includes(searchQuery.toLowerCase()));

      if (filterMode !== 'all') {
        return matchesSearch && contact.lists?.some(l => l.id === filterMode);
      }
      return matchesSearch;
    });
  }, [contacts, searchQuery, filterMode]);

  // Smart overflow: show at most 10 list pills inline, rest in dropdown
  const MAX_INLINE_LISTS = 10;
  const inlineLists = lists.slice(0, MAX_INLINE_LISTS);
  const overflowLists = lists.slice(MAX_INLINE_LISTS);
  const moreRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMoreLists) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setShowMoreLists(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMoreLists]);

  useEffect(() => {
    if (!showAddMenu) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setShowAddMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAddMenu]);

  // Handle Keyboard Navigation
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) return;

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
        navigate(`/contact/${filteredContacts[nextIndex].id}`);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        if (filteredContacts.length === 0) return;
        const currentIndex = filteredContacts.findIndex(c => c.id === id);
        const prevIndex = currentIndex === -1 ? 0 : Math.max(currentIndex - 1, 0);
        navigate(`/contact/${filteredContacts[prevIndex].id}`);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [id, filteredContacts, navigate, isSelectMode]);

  // Auto-scroll active item into view
  React.useEffect(() => {
    if (id) {
      const el = document.getElementById(`contact-row-${id}`);
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [id]);

  // Close color picker on outside click
  React.useEffect(() => {
    if (!showBulkColorPicker) return;
    const handler = (e: MouseEvent) => {
      if (bulkColorPickerRef.current && !bulkColorPickerRef.current.contains(e.target as Node)) {
        setShowBulkColorPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showBulkColorPicker]);

  const listMemberCount = useCallback((listId: string) => {
    const list = lists.find(l => l.id === listId);
    return list?.memberCount ?? 0;
  }, [lists]);

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
    bulkUpdate.mutate({ ids, data: { isArchived: true } as any }, {
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
    bulkUpdate.mutate({ ids, data: { themeColor: vibeId } as any }, {
      onSuccess: ({ count }) => {
        toast.success(`Updated color for ${count} contact${count !== 1 ? 's' : ''}`);
        setShowBulkColorPicker(false);
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
    navigator.clipboard.writeText(csv);
    toast.success(`Copied ${selected.length} contact${selected.length !== 1 ? 's' : ''} as CSV`);
    exitSelectMode();
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
                <button onClick={() => setIsImportOpen(true)} className={ICON_BTN} title="Import Contacts">
                  <Upload className="w-5 h-5" />
                </button>
                <div className="relative" ref={addMenuRef}>
                  <button
                    onClick={() => setShowAddMenu(!showAddMenu)}
                    className="p-2 bg-primary/10 text-primary hover:bg-primary/20 rounded-xl transition-colors"
                    title="Add New..."
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                  <AnimatePresence>
                    {showAddMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: 4, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.95 }}
                        className="absolute top-full right-0 mt-1 glass-panel rounded-xl shadow-xl z-50 py-1 min-w-[190px]"
                      >
                        <button
                          onClick={() => { setIsModalOpen(true); setShowAddMenu(false); }}
                          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-on-surface hover:bg-surface-container-low transition-colors text-left"
                        >
                          <UserPlus className="w-4 h-4 text-primary shrink-0" />
                          Add Contact
                        </button>
                        <button
                          onClick={() => { setIsSmartPasteOpen(true); setShowAddMenu(false); }}
                          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-on-surface hover:bg-surface-container-low transition-colors text-left"
                        >
                          <FileText className="w-4 h-4 text-primary shrink-0" />
                          Add from Text
                          <span className="ml-auto text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">AI</span>
                        </button>
                        <button
                          onClick={() => { setIsCreateListOpen(true); setShowAddMenu(false); }}
                          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-on-surface hover:bg-surface-container-low transition-colors text-left"
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

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
          <input
            id="search-input"
            type="text"
            placeholder={isSelectMode ? `${selectedCount} selected — search to filter` : "Search... (/)"}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setSearchQuery(""); e.currentTarget.blur(); }
            }}
            className={SEARCH_INPUT}
          />
        </div>

        {/* Filter tabs — hidden in select mode to reduce noise */}
        {!isSelectMode && (
          <div className="flex gap-1.5 flex-wrap items-center">
            <FilterButton
              label="All"
              icon={<Users className="w-3.5 h-3.5" />}
              count={contacts.filter(c => !c.isArchived).length}
              active={filterMode === 'all'}
              onClick={() => setFilterMode('all')}
            />
            {inlineLists.map((list, idx) => (
              <div
                key={list.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={() => handleDrop(idx)}
                onDragEnd={handleDragEnd}
                className={cn(
                  "transition-all cursor-grab active:cursor-grabbing",
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
            {overflowLists.length > 0 && (
              <div className="relative" ref={moreRef}>
                <button
                  onClick={() => setShowMoreLists(!showMoreLists)}
                  className={cn(filterPill(overflowLists.some(l => l.id === filterMode)), "gap-1")}
                >
                  <ChevronDown className="w-3 h-3" />
                  More
                </button>
                <AnimatePresence>
                  {showMoreLists && (
                    <motion.div
                      initial={{ opacity: 0, y: 4, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.95 }}
                      className="absolute top-full right-0 mt-1 glass-panel rounded-xl shadow-xl z-50 py-1 min-w-[180px]"
                    >
                      {overflowLists.map(list => (
                        <button
                          key={list.id}
                          onClick={() => { setFilterMode(filterMode === list.id ? 'all' : list.id); setShowMoreLists(false); }}
                          className={cn(
                            "flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors text-left",
                            filterMode === list.id
                              ? "bg-primary/10 text-primary font-bold"
                              : "text-on-surface hover:bg-surface-container-low"
                          )}
                        >
                          <ListIcon icon={list.icon} className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{list.name}</span>
                          <span className="ml-auto text-[10px] opacity-50">{list.memberCount ?? 0}</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 pb-24 md:pb-4 scrollbar-hide">
        {isLoading && (
          <div className="flex justify-center p-8"><div className="animate-pulse w-6 h-6 rounded-full bg-primary/20" /></div>
        )}
        {!isLoading && filteredContacts.length === 0 && (
          <div className="text-center p-8 text-on-surface-variant">
            <p className="text-sm font-medium">No contacts match your filters.</p>
          </div>
        )}
        {filteredContacts.map(contact => {
          const active = id === contact.id;
          return (
            <ContactListItem
              key={contact.id}
              contact={contact}
              active={active}
              isSelectMode={isSelectMode}
              isSelected={selectedIds.has(contact.id)}
              onToggleSelect={toggleSelect}
            />
          );
        })}
      </div>

      {/* ── Bulk Action Bottom Toolbar ─────────────────────────────────── */}
      <AnimatePresence>
        {isSelectMode && selectedCount > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 300 }}
            className="fixed md:absolute bottom-24 md:bottom-0 left-0 right-0 z-[60] md:z-40 px-3 pb-2 md:pb-4"
          >
            <div className="glass-panel rounded-2xl shadow-2xl px-3 py-2.5 flex items-center justify-between gap-1">
              {/* Selected count */}
              <span className="text-xs font-bold text-on-surface shrink-0 min-w-[4rem]">
                <span className="text-primary">{selectedCount}</span>
                <span className="text-on-surface-variant"> sel.</span>
              </span>

              {/* Divider */}
              <div className="w-px h-5 bg-surface-container-high" />

              {/* Action buttons — tightly packed, icon-first, short label */}
              <BulkActionBtn
                icon={<Archive className="w-4 h-4" />}
                label="Archive"
                onClick={handleBulkArchive}
                disabled={bulkUpdate.isPending}
                className="text-amber-500 hover:bg-amber-500/10"
              />
              <BulkActionBtn
                icon={<AddToListIcon className="w-4 h-4" />}
                label="List"
                onClick={() => setIsAddToListOpen(true)}
                disabled={false}
                className="text-primary hover:bg-primary/10"
              />
              <BulkActionBtn
                icon={<Pencil className="w-4 h-4" />}
                label="Field"
                onClick={() => setIsBulkEditOpen(true)}
                disabled={false}
                className="text-primary hover:bg-primary/10"
              />

              {/* Bulk Color Picker */}
              <div className="relative shrink-0" ref={bulkColorPickerRef}>
                <button
                  onClick={() => setShowBulkColorPicker(v => !v)}
                  title="Change Color"
                  className={cn(
                    "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-colors shrink-0",
                    showBulkColorPicker
                      ? "text-primary bg-primary/10"
                      : "text-on-surface-variant hover:bg-surface-container-high"
                  )}
                >
                  <Palette className="w-4 h-4" />
                  <span className="text-[8px] font-bold uppercase tracking-wider opacity-80 whitespace-nowrap">Color</span>
                </button>

                <AnimatePresence>
                  {showBulkColorPicker && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9, y: 6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: 6 }}
                      className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 glass-panel rounded-xl shadow-xl p-3 z-50 grid grid-cols-4 gap-2 w-[120px] place-items-center"
                    >
                      {VIBE_COLORS.map(vibe => (
                        <button
                          key={vibe.id}
                          onClick={() => handleBulkColorChange(vibe.id)}
                          disabled={bulkUpdate.isPending}
                          style={{ backgroundColor: vibe.primary }}
                          title={vibe.id}
                          className="w-6 h-6 rounded-full transition-transform hover:scale-110 shadow-sm hover:ring-2 hover:ring-white/50 hover:ring-offset-1 hover:ring-offset-surface disabled:opacity-50"
                        />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <BulkActionBtn
                icon={<Download className="w-4 h-4" />}
                label="CSV"
                onClick={handleExportCSV}
                disabled={false}
                className="text-on-surface-variant hover:bg-surface-container-high"
              />

              {/* Divider */}
              <div className="w-px h-5 bg-surface-container-high" />

              <BulkActionBtn
                icon={<Trash2 className="w-4 h-4" />}
                label="Delete"
                onClick={() => setIsBulkDeleteConfirm(true)}
                disabled={bulkDelete.isPending}
                className="text-rose-500 hover:bg-rose-500/10"
              />
            </div>
          </motion.div>
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
          bulkUpdate.mutate({ ids, data: { [field]: value } as any }, {
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
            <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Full Name *</label>
            <input required name="name" type="text" defaultValue={parsedData?.name || ''} className={`w-full border-none rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary ${parsedData?.name ? 'bg-primary/10 ring-2 ring-primary/50 shadow-[0_0_15px_rgba(0,158,219,0.3)] animate-pulse' : 'bg-surface-container'}`} placeholder="Jane Doe" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Role</label>
              <input name="role" type="text" defaultValue={parsedData?.role || ''} className={`w-full border-none rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary ${parsedData?.role ? 'bg-primary/10 ring-2 ring-primary/50 shadow-[0_0_15px_rgba(0,158,219,0.3)] animate-pulse' : 'bg-surface-container'}`} placeholder="CEO" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Company</label>
              <input name="company" type="text" defaultValue={parsedData?.company || ''} className={`w-full border-none rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary ${parsedData?.company ? 'bg-primary/10 ring-2 ring-primary/50 shadow-[0_0_15px_rgba(0,158,219,0.3)] animate-pulse' : 'bg-surface-container'}`} placeholder="Acme Corp" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Email</label>
              <input name="email" type="email" defaultValue={parsedData?.emails?.[0]?.email || parsedData?.email || ''} className={`w-full border-none rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary ${(parsedData?.emails?.[0]?.email || parsedData?.email) ? 'bg-primary/10 ring-2 ring-primary/50 shadow-[0_0_15px_rgba(0,158,219,0.3)] animate-pulse' : 'bg-surface-container'}`} placeholder="jane@example.com" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Phone</label>
              <input name="phone" type="tel" defaultValue={parsedData?.phones?.[0]?.phone || parsedData?.phone || ''} className={`w-full border-none rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary ${(parsedData?.phones?.[0]?.phone || parsedData?.phone) ? 'bg-primary/10 ring-2 ring-primary/50 shadow-[0_0_15px_rgba(0,158,219,0.3)] animate-pulse' : 'bg-surface-container'}`} placeholder="+1 (555) 000-0000" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Location</label>
            <input name="location" type="text" defaultValue={parsedData?.location || ''} className={`w-full border-none rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary ${parsedData?.location ? 'bg-primary/10 ring-2 ring-primary/50 shadow-[0_0_15px_rgba(0,158,219,0.3)] animate-pulse' : 'bg-surface-container'}`} placeholder="San Francisco, CA" />
          </div>
          <div className="pt-4">
            <button type="submit" disabled={createContact.isPending} className="w-full bg-primary text-on-primary font-bold py-3 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 text-sm focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface-container-low">
              {createContact.isPending ? 'Saving...' : 'Save Contact'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Add from Text Modal ───────────────────────────────────────────── */}
      <Modal isOpen={isSmartPasteOpen} onClose={() => setIsSmartPasteOpen(false)} title="Add from Text">
        <div className="space-y-4 pt-2">
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

// ---------------------------------------------------------------------------
// BulkActionBtn — compact icon+label button for the bottom toolbar
// ---------------------------------------------------------------------------

const BulkActionBtn = ({
  icon, label, onClick, disabled, className,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
  className?: string;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={label}
    className={cn(
      "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-colors disabled:opacity-40 shrink-0",
      className
    )}
  >
    {icon}
    <span className="text-[8px] font-bold uppercase tracking-wider opacity-80 whitespace-nowrap">{label}</span>
  </button>
);

// ---------------------------------------------------------------------------
// CreateListModal — Icon picker + name input
// ---------------------------------------------------------------------------

const CreateListModal = ({
  isOpen, onClose, onCreate, isPending,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, icon: string) => void;
  isPending: boolean;
}) => {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('star');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim(), icon);
    setName(''); setIcon('star');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create List">
      <form onSubmit={handleSubmit} className="space-y-6 pt-2">
        <div>
          <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-widest mb-3">
            Choose an Icon
          </label>
          <div className="grid grid-cols-7 gap-2">
            {ICON_OPTIONS.map(key => {
              const active = icon === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIcon(key)}
                  className={cn(
                    "p-2.5 rounded-xl transition-all flex items-center justify-center",
                    active
                      ? "bg-primary/15 text-primary ring-2 ring-primary/30 shadow-sm scale-110"
                      : "text-on-surface-variant hover:text-primary hover:bg-surface-container-low"
                  )}
                  title={key}
                >
                  <ListIcon icon={key} className="w-5 h-5" />
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">
            List Name
          </label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. VIP Clients, Investors, Friends"
            className="w-full bg-surface-container border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-between pt-2">
          {name.trim() && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2 text-sm text-primary font-bold"
            >
              <ListIcon icon={icon} className="w-4 h-4" />
              {name.trim()}
            </motion.div>
          )}
          <button
            type="submit"
            disabled={!name.trim() || isPending}
            className="ml-auto bg-primary text-on-primary font-bold py-2.5 px-6 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 text-sm"
          >
            {isPending ? 'Creating...' : 'Create List'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

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
  <button onClick={onClick} className={filterPill(active)}>
    {icon}
    {label}
    <span className={`ml-0.5 text-[10px] ${active ? 'text-primary/70' : 'opacity-50'}`}>{count}</span>
  </button>
);

// ---------------------------------------------------------------------------
// ContactListItem — Single row in the contact list
// ---------------------------------------------------------------------------

const ContactListItem = ({
  contact,
  active,
  isSelectMode,
  isSelected,
  onToggleSelect,
}: {
  contact: Contact;
  active: boolean;
  isSelectMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}) => {
  const primaryEmail = contact.emails?.[0]?.email || null;
  const logoUrl = useCompanyLogo(primaryEmail);
  const [imgError, setImgError] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    if (isSelectMode) {
      e.preventDefault();
      onToggleSelect(contact.id);
    }
  };

  return (
    <Link
      id={`contact-row-${contact.id}`}
      to={isSelectMode ? '#' : `/contact/${contact.id}`}
      onClick={handleClick}
      className={cn(
        listRow(active && !isSelectMode),
        isSelectMode && "cursor-pointer select-none",
        isSelectMode && isSelected && "bg-primary/8 ring-2 ring-primary scale-[1.01]",
      )}
    >
      {/* Checkbox overlay in select mode */}
      <AnimatePresence>
        {isSelectMode && (
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            className="shrink-0"
          >
            <div className={cn(
              "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all",
              isSelected
                ? "bg-primary border-primary"
                : "border-on-surface-variant/40 bg-surface-container-low"
            )}>
              {isSelected && <CheckCheck className="w-3 h-3 text-white" />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <HealthRingAvatar contact={contact} size={48} />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center">
          <h3 className={`text-sm font-semibold truncate ${(active && !isSelectMode) || (isSelectMode && isSelected) ? 'text-primary' : 'text-on-surface'}`}>
            {contact.name}
          </h3>
        </div>
        {contact.company ? (
          <p className="text-xs text-on-surface-variant truncate font-medium flex items-center gap-1.5 mt-0.5">
            {logoUrl && !imgError ? (
              <img
                src={logoUrl}
                alt={`${contact.company} logo`}
                onError={() => setImgError(true)}
                className="w-4 h-4 rounded-full object-contain bg-surface-container-highest"
              />
            ) : (
              <Building className="w-3.5 h-3.5 opacity-60" />
            )}
            {contact.company}
          </p>
        ) : contact.role ? (
          <p className="text-xs text-on-surface-variant truncate flex items-center gap-1.5 mt-0.5">
            <Briefcase className="w-3.5 h-3.5 opacity-60" />
            {contact.role}
          </p>
        ) : null}
      </div>
    </Link>
  );
};
