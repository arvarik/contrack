import React, { useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Search, Plus, Briefcase, Building, Star, Clock, Users, Upload, Wand } from "lucide-react";
import { useContacts, useCreateContact, useParseContactText } from "../api";
import { Modal } from "../components/Modal";
import { ImportModal } from "../components/ImportModal";
import { motion } from "motion/react";
import { useCompanyLogo } from "../hooks/useCompanyLogo";
import { HealthRingAvatar } from "../components/HealthRingAvatar";
import { toast } from "sonner";
import { ICON_BTN, SEARCH_INPUT, filterPill, listRow, PAGE_TITLE } from "../lib/styles";

// ---------------------------------------------------------------------------
// ContactList — Left-pane master view for browsing and filtering contacts
// ---------------------------------------------------------------------------

export const ContactList = () => {
  const { data: contacts = [], isLoading } = useContacts();
  const { id } = useParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<'all' | 'premium' | 'overdue'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSmartPasteOpen, setIsSmartPasteOpen] = useState(false);
  const [smartPasteText, setSmartPasteText] = useState("");
  const [parsedData, setParsedData] = useState<any>(null);
  
  const navigate = useNavigate();
  
  const createContact = useCreateContact();
  const parseContactText = useParseContactText();

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
        isPremium: data.isPremium === 'on',
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

  const isOverdue = (lastContactedAt: string | null, cadenceDays: number) => {
    if (!lastContactedAt) return true;
    const diffDays = (Date.now() - new Date(lastContactedAt).getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= cadenceDays;
  };

  const filteredContacts = useMemo(() => {
    return contacts.filter(contact => {
      const matchesSearch = contact.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
             (contact.company && contact.company.toLowerCase().includes(searchQuery.toLowerCase())) ||
             (contact.role && contact.role.toLowerCase().includes(searchQuery.toLowerCase()));
      
      if (filterMode === 'premium') return matchesSearch && contact.isPremium;
      if (filterMode === 'overdue') return matchesSearch && isOverdue(contact.lastContactedAt, contact.cadenceDays);
      return matchesSearch;
    });
  }, [contacts, searchQuery, filterMode]);

  /** Counts for filter badge display */
  const premiumCount = useMemo(() => contacts.filter(c => c.isPremium).length, [contacts]);
  const overdueCount = useMemo(() => contacts.filter(c => isOverdue(c.lastContactedAt, c.cadenceDays)).length, [contacts]);

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
            <button 
              onClick={() => setIsModalOpen(true)}
              className="p-2 bg-primary/10 text-primary hover:bg-primary/20 rounded-xl transition-colors"
              title="Add Contact"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
          <input 
            type="text" 
            placeholder="Search..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={SEARCH_INPUT}
          />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1.5">
          <FilterButton
            label="All"
            icon={<Users className="w-3.5 h-3.5" />}
            count={contacts.length}
            active={filterMode === 'all'}
            onClick={() => setFilterMode('all')}
          />
          <FilterButton
            label="Premium"
            icon={<Star className="w-3.5 h-3.5" />}
            count={premiumCount}
            active={filterMode === 'premium'}
            onClick={() => setFilterMode('premium')}
          />
          <FilterButton
            label="Overdue"
            icon={<Clock className="w-3.5 h-3.5" />}
            count={overdueCount}
            active={filterMode === 'overdue'}
            onClick={() => setFilterMode('overdue')}
          />
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
          const overdue = isOverdue(contact.lastContactedAt, contact.cadenceDays);

          return (
            <ContactListItem 
              key={contact.id} 
              contact={contact} 
              active={active} 
              overdue={overdue} 
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

const ContactListItem = ({ contact, active, overdue }: { contact: any, active: boolean, overdue: boolean | "" | 0 | null | undefined }) => {
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
