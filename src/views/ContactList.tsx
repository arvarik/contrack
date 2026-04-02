import React, { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  Search, Plus, Briefcase, Building, Star, Users, Upload, Wand,
  ChevronDown, X, UserPlus, ListPlus,
  // Icon picker icons
  Heart, Crown, Flame, Rocket, Target, Gem, Award, Globe, Zap, Shield,
  Coffee, Music, Camera, BookOpen, TrendingUp, Anchor, Flag, Sparkles, Sun,
} from "lucide-react";
import { useContacts, useCreateContact, useParseContactText, useLists, useCreateList, useReorderLists } from "../api";
import { Modal } from "../components/Modal";
import { ImportModal } from "../components/ImportModal";
import { motion, AnimatePresence } from "motion/react";
import { useCompanyLogo } from "../hooks/useCompanyLogo";
import { HealthRingAvatar } from "../components/HealthRingAvatar";
import { toast } from "sonner";
import { ICON_BTN, SEARCH_INPUT, filterPill, listRow, PAGE_TITLE } from "../lib/styles";
import { cn } from "../lib/utils";

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

  const navigate = useNavigate();
  
  const createContact = useCreateContact();
  const parseContactText = useParseContactText();
  const createList = useCreateList();
  const reorderLists = useReorderLists();

  // Drag-to-reorder state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const handleDragStart = (idx: number) => {
    setDragIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setDragOverIdx(idx);
  };

  const handleDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return; }
    // Reorder the lists array
    const newOrder = [...lists];
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(idx, 0, moved);
    reorderLists.mutate(newOrder.map(l => l.id));
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleCreateContact = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());
    
    // Build the contact payload with nested child arrays
    const emailValue = data.email as string;
    const phoneValue = data.phone as string;

    try {
      await createContact.mutateAsync({
        name: data.name as string,
        role: data.role as string,
        company: data.company as string,
        location: data.location as string,
        avatarUrl: (data.avatarUrl as string) || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(data.name as string)}`,
        // Normalized child arrays
        emails: emailValue ? [{ email: emailValue, label: 'work', isPrimary: true }] : [],
        phones: phoneValue ? [{ phone: phoneValue, label: 'mobile', isPrimary: true }] : [],
        // Pass through any AI-parsed child data
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

  const filteredContacts = useMemo(() => {
    return contacts.filter(contact => {
      const matchesSearch = contact.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
             (contact.company && contact.company.toLowerCase().includes(searchQuery.toLowerCase())) ||
             (contact.role && contact.role.toLowerCase().includes(searchQuery.toLowerCase()));
      
      if (filterMode !== 'all') {
        // filterMode is a list ID
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

  // Close more dropdown on outside click
  useEffect(() => {
    if (!showMoreLists) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setShowMoreLists(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMoreLists]);

  // Close add menu dropdown on outside click
  useEffect(() => {
    if (!showAddMenu) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
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
      ) {
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        const editor = document.querySelector(".ProseMirror") as HTMLElement;
        if (editor) editor.focus();
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        document.getElementById("search-input")?.focus();
        return;
      }

      if (e.key === "n") {
        e.preventDefault();
        setIsModalOpen(true);
        return;
      }

      if (e.key === "v") {
        e.preventDefault();
        setIsSmartPasteOpen(true);
        return;
      }

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
  }, [id, filteredContacts, navigate]);

  // Auto-scroll active item into view
  React.useEffect(() => {
    if (id) {
      const el = document.getElementById(`contact-row-${id}`);
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [id]);

  // Get member count for a list
  const listMemberCount = useCallback((listId: string) => {
    const list = lists.find(l => l.id === listId);
    return list?.memberCount ?? 0;
  }, [lists]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4 bg-surface-container-lowest sticky top-0 z-10 space-y-3">
        <div className="flex justify-between items-center">
          <h2 className={PAGE_TITLE}>Network</h2>
          <div className="flex items-center gap-1.5">
            <button 
              onClick={() => setIsSmartPasteOpen(true)}
              className={ICON_BTN}
              title="Magic Paste (AI)"
            >
              <Wand className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setIsImportOpen(true)}
              className={ICON_BTN}
              title="Import Contacts"
            >
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
                    className="absolute top-full right-0 mt-1 glass-panel rounded-xl shadow-xl z-50 py-1 min-w-[180px]"
                  >
                    <button
                      onClick={() => {
                        setIsModalOpen(true);
                        setShowAddMenu(false);
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-on-surface hover:bg-surface-container-low transition-colors text-left"
                    >
                      <UserPlus className="w-4 h-4 text-primary shrink-0" />
                      Add Contact
                    </button>
                    <button
                      onClick={() => {
                        setIsCreateListOpen(true);
                        setShowAddMenu(false);
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-on-surface hover:bg-surface-container-low transition-colors text-left"
                    >
                      <ListPlus className="w-4 h-4 text-primary shrink-0" />
                      Create List
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
        
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
          <input 
            id="search-input"
            type="text" 
            placeholder="Search... (/)" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchQuery("");
                e.currentTarget.blur();
              }
            }}
            className={SEARCH_INPUT}
          />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1.5 flex-wrap items-center">
          <FilterButton
            label="All"
            icon={<Users className="w-3.5 h-3.5" />}
            count={contacts.length}
            active={filterMode === 'all'}
            onClick={() => setFilterMode('all')}
          />

          {/* Inline list pills (draggable) */}
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

          {/* Overflow dropdown (also draggable targets) */}
          {overflowLists.length > 0 && (
            <div className="relative" ref={moreRef}>
              <button
                onClick={() => setShowMoreLists(!showMoreLists)}
                className={cn(
                  filterPill(overflowLists.some(l => l.id === filterMode)),
                  "gap-1"
                )}
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
                        onClick={() => {
                          setFilterMode(filterMode === list.id ? 'all' : list.id);
                          setShowMoreLists(false);
                        }}
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
      </div>

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
            />
          );
        })}
      </div>

      {/* New Contact Modal */}
      <Modal 
        isOpen={isModalOpen} 
        onClose={() => { 
          setIsModalOpen(false); 
          setParsedData(null); 
        }} 
        title="New Contact"
      >
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

      {/* Smart Paste Modal */}
      <Modal isOpen={isSmartPasteOpen} onClose={() => setIsSmartPasteOpen(false)} title="Smart Paste">
        <div className="space-y-4 pt-2">
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Paste an unstructured bio, email signature, or quick notes block below. The AI will instantly parse the attributes and pre-fill the form.
          </p>
          <textarea 
            autoFocus
            value={smartPasteText}
            onChange={(e) => setSmartPasteText(e.target.value)}
            rows={5}
            className="w-full bg-surface-container border-none rounded-xl p-4 text-sm focus:ring-2 focus:ring-primary font-mono text-on-surface resize-none focus:outline-none"
            placeholder="e.g. Set up a meeting with Julian Thorne (CEO, Nexus). His cell is 555-0198 and email is julian@nexus.design. Based in London."
          />
          <div className="flex justify-end pt-2">
            <button 
              onClick={async () => {
                 try {
                    const res = await parseContactText.mutateAsync(smartPasteText);
                    setParsedData(res);
                    setIsSmartPasteOpen(false);
                    setIsModalOpen(true);
                    toast.success("AI extraction complete");
                 } catch (err) {
                     toast.error("Failed to parse text. Is the API key set?");
                 }
              }}
              disabled={!smartPasteText.trim() || parseContactText.isPending}
              className="bg-primary text-on-primary font-bold py-2.5 px-6 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 text-sm flex items-center gap-2"
            >
              <Wand className="w-4 h-4" />
              {parseContactText.isPending ? 'Extracting...' : 'Extract & Create'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Create List Modal */}
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

      {/* Import Contacts Modal */}
      <ImportModal 
        isOpen={isImportOpen} 
        onClose={() => setIsImportOpen(false)} 
        onSuccess={() => toast.success("Import complete!")} 
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// CreateListModal — Icon picker + name input
// ---------------------------------------------------------------------------

const CreateListModal = ({
  isOpen,
  onClose,
  onCreate,
  isPending,
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
    setName('');
    setIcon('star');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create List">
      <form onSubmit={handleSubmit} className="space-y-6 pt-2">
        {/* Icon Picker */}
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

        {/* Name Input */}
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

        {/* Preview + Submit */}
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
  <button
    onClick={onClick}
    className={filterPill(active)}
  >
    {icon}
    {label}
    <span className={`ml-0.5 text-[10px] ${active ? 'text-primary/70' : 'opacity-50'}`}>
      {count}
    </span>
  </button>
);

// ---------------------------------------------------------------------------
// ContactListItem — Single row in the contact list
// ---------------------------------------------------------------------------

const ContactListItem = ({ contact, active }: { contact: any, active: boolean }) => {
  // Resolve primary email for logo hook — use first email from child array
  const primaryEmail = contact.emails?.[0]?.email || null;
  const logoUrl = useCompanyLogo(primaryEmail);
  const [imgError, setImgError] = useState(false);

  return (
    <Link 
      id={`contact-row-${contact.id}`}
      to={`/contact/${contact.id}`}
      className={listRow(active)}
    >
      <HealthRingAvatar contact={contact} size={48} />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center">
          <h3
            className={`text-sm font-semibold truncate ${active ? 'text-primary' : 'text-on-surface'}`}
          >
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
