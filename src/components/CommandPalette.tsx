import React, { useEffect, useState, useMemo } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { useSearchContacts, useCreateContact, useContacts, useAddInteraction } from '../api';
import { useDebounce } from '../hooks/useDebounce';
import { Search, UserPlus, Briefcase, Building, Zap, MessageSquare, Phone, Calendar, Mail } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { KBD, KBD_SM, SECTION_BG } from '../lib/styles';

export const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 200);
  const navigate = useNavigate();
  
  // Data Hooks
  const { data: results = [], isLoading } = useSearchContacts(debouncedSearch);
  const { data: allContacts = [] } = useContacts(); // Locally cached from tanstack setup
  const createContact = useCreateContact();
  const addInteraction = useAddInteraction();

  // Mode Determination
  const isAction = search.trim().startsWith('>');

  // Action Mode Parser Hook
  const actionMatch = useMemo(() => {
    if (!isAction) return null;
    const regex = /^>\s*(note|call|meeting|email)\s+([^:]+):\s*(.*)$/i;
    const match = search.match(regex);
    if (!match) return null;
    
    const [_, type, nameStr, content] = match;
    const typeLower = type.toLowerCase() as 'note' | 'call' | 'meeting' | 'email';
    
    // Fuzzyish match off local cache to avoid round trips
    const targetContact = allContacts.find(c => c.name?.toLowerCase().includes(nameStr.toLowerCase().trim()));
    
    if (targetContact && content.trim()) {
      return { type: typeLower, contact: targetContact, content: content.trim() };
    }
    return null;
  }, [search, allContacts, isAction]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const handleCreateContact = async () => {
    if (!search.trim()) return;
    try {
      const newContact = await createContact.mutateAsync({ name: search.trim(), cadenceDays: 90 });
      navigate(`/contact/${newContact.id}`);
      setOpen(false);
      setSearch('');
      toast.success(`Created contact ${newContact.name}`);
    } catch (e: any) {
      toast.error(`Failed to create contact: ${e.message}`);
    }
  };

  const handleActionExecute = async () => {
    if (!actionMatch) return;
    try {
      let title = "";
      switch (actionMatch.type) {
        case 'note': title = 'Quick Note'; break;
        case 'call': title = 'Phone Call logged'; break;
        case 'meeting': title = 'Meeting summary'; break;
        case 'email': title = 'Email sent'; break;
      }

      await addInteraction.mutateAsync({
        contactId: actionMatch.contact.id,
        data: {
          type: actionMatch.type,
          title: title,
          content: actionMatch.content,
          date: new Date().toISOString()
        }
      });

      setOpen(false);
      setSearch('');
      toast.success(`Logged ${actionMatch.type} for ${actionMatch.contact.name}`);
    } catch (e: any) {
      toast.error(`Failed to log interaction: ${e.message}`);
    }
  };

  const getLogIcon = (type: string) => {
    switch (type) {
      case 'note': return <MessageSquare className="w-4 h-4" />;
      case 'email': return <Mail className="w-4 h-4" />;
      case 'call': return <Phone className="w-4 h-4" />;
      case 'meeting': return <Calendar className="w-4 h-4" />;
      default: return <Zap className="w-4 h-4" />;
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <Command.Dialog 
          open={open} 
          onOpenChange={setOpen}
          label="Global Command Palette"
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 backdrop-blur-md bg-surface/40 transition-all duration-200"
        >
           <motion.div
             initial={{ opacity: 0, scale: 0.95, y: -20 }}
             animate={{ opacity: 1, scale: 1, y: 0 }}
             exit={{ opacity: 0, scale: 0.95, y: -20 }}
             transition={{ duration: 0.15 }}
             className="w-full max-w-2xl glass-panel shadow-2xl rounded-2xl overflow-hidden flex flex-col font-body"
           >
             <div className="flex items-center px-4 py-4 bg-surface-container-low gap-3">
               {isAction ? (
                 <Zap className="w-5 h-5 text-emerald-500 animate-pulse" />
               ) : (
                 <Search className="w-5 h-5 text-on-surface-variant" />
               )}
               <Command.Input 
                 value={search}
                 onValueChange={setSearch}
                 autoFocus
                 placeholder="Search contacts, or type > to run actions..." 
                 className="flex-1 bg-transparent border-none focus:ring-0 text-on-surface placeholder:text-on-surface-variant outline-none text-lg"
               />
               <div className="flex items-center gap-1.5 opacity-50">
                 <kbd className={KBD}>ESC</kbd>
               </div>
             </div>

             <Command.List className="max-h-[350px] overflow-y-auto p-2 scrollbar-hide">
               {isAction && !actionMatch && (
                 <Command.Empty className="py-10 text-center text-sm text-on-surface-variant">
                   <Zap className="w-8 h-8 text-on-surface-variant/30 mx-auto mb-3" />
                   <p className="font-bold text-on-surface">Action Mode Active</p>
                   <p className="mt-1">Syntax: <code className="text-primary bg-primary/10 px-1 rounded"> {">"} [type] [name]: [content]</code></p>
                   <p className="mt-2 text-xs">Types: note, call, meeting, email</p>
                   <p className="mt-1 text-xs text-on-surface-variant">Example: <code>{">"} note Julian: Left a voicemail regarding Q3 targets</code></p>
                 </Command.Empty>
               )}

               {isAction && actionMatch && (
                 <Command.Group heading="Action Engine" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-emerald-500 [&_[cmdk-group-heading]]:tracking-widest">
                   <Command.Item 
                     value={`action_${actionMatch.type}_${actionMatch.contact.id}`}
                     onSelect={handleActionExecute}
                     className="flex items-center gap-4 px-3 py-4 rounded-xl cursor-default select-none bg-emerald-500/10 aria-selected:bg-emerald-500/15 transition-colors text-on-surface"
                   >
                     <div className="w-10 h-10 flex items-center justify-center bg-emerald-500/20 text-emerald-500 rounded-full shrink-0 shadow-lg shadow-emerald-500/10">
                       {getLogIcon(actionMatch.type)}
                     </div>
                     <div className="flex-1 min-w-0 flex flex-col">
                       <span className="font-bold text-sm block truncate">Log {actionMatch.type} for <span className="text-emerald-400">{actionMatch.contact.name}</span></span>
                       <span className="text-sm text-on-surface-variant truncate mt-0.5">
                         "{actionMatch.content}"
                       </span>
                     </div>
                     <div className="shrink-0 opacity-50 px-2 flex items-center justify-center space-x-1">
                        <span className="text-xs">Press</span>
                        <kbd className={KBD}>Enter</kbd>
                     </div>
                   </Command.Item>
                 </Command.Group>
               )}

               {!isAction && (
                 <>
                   <Command.Empty className="py-10 text-center text-sm text-on-surface-variant">
                     {isLoading ? 'Searching...' : 'No results found.'}
                   </Command.Empty>

                   {results.length > 0 && (
                     <Command.Group heading="Contacts" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-on-surface-variant [&_[cmdk-group-heading]]:tracking-widest">
                       {results.map((contact) => (
                         <Command.Item
                           key={contact.id}
                           value={contact.id + contact.name}
                           onSelect={() => {
                             navigate(`/contact/${contact.id}`);
                             setOpen(false);
                             setSearch('');
                           }}
                           className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-default select-none aria-selected:bg-primary/10 aria-selected:text-primary transition-colors text-on-surface"
                         >
                            <img 
                              src={contact.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(contact.name)}`} 
                              alt="" 
                              className="w-8 h-8 rounded-full bg-surface-container-highest object-cover"
                            />
                            <div className="flex-1 min-w-0 flex flex-col">
                              <span className="font-bold text-sm block truncate">{contact.name}</span>
                              {(contact.role || contact.company) && (
                                <span className="text-xs text-on-surface-variant flex items-center gap-2 truncate mt-0.5">
                                  {contact.role && <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" /> {contact.role}</span>}
                                  {contact.company && <span className="flex items-center gap-1"><Building className="w-3 h-3" /> {contact.company}</span>}
                                </span>
                              )}
                            </div>
                         </Command.Item>
                       ))}
                     </Command.Group>
                   )}

                   {search.trim().length > 0 && results.length === 0 && (
                     <Command.Group heading="Actions" className="mt-2 text-on-surface-variant [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-on-surface-variant [&_[cmdk-group-heading]]:tracking-widest">
                       <Command.Item 
                         value={`create_${search}`}
                         onSelect={handleCreateContact}
                         className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-default select-none aria-selected:bg-surface-container-high transition-colors text-on-surface"
                       >
                         <div className="w-8 h-8 flex items-center justify-center bg-surface-container-highest rounded-full">
                           <UserPlus className="w-4 h-4 text-primary" />
                         </div>
                         <span className="text-sm">Create new contact <span className="font-bold whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px] inline-block align-bottom">"{search}"</span></span>
                       </Command.Item>
                     </Command.Group>
                   )}
                 </>
               )}
             </Command.List>

             <div className={`px-4 py-3 ${SECTION_BG} text-[11px] text-on-surface-variant flex items-center justify-between`}>
                <span className="flex items-center gap-2">
                  <Zap className="w-3 h-3 text-emerald-500" /> Action Engine Available
                </span>
                <span className="flex items-center gap-2">Use <kbd className={KBD_SM}>↑</kbd> <kbd className={KBD_SM}>↓</kbd> to navigate</span>
             </div>
           </motion.div>
        </Command.Dialog>
      )}
    </AnimatePresence>
  );
};
