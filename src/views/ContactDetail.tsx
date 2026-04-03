import React, { useState, useEffect } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { 
  Mail, Phone, FileText, Handshake, MapPin, Cake, Briefcase, ArrowLeft, 
  Sparkles, UploadCloud, Trash2, Globe, MessageSquare, ExternalLink, Linkedin, Facebook, Tag, X, Coffee, File, Archive, Heart, Edit2
} from "lucide-react";
import ReactMarkdown from 'react-markdown';
import { useContact, useTimeline, useUpdateContact, useAddAttachment, useDeleteContact, useDeleteInteraction, useGenerateBriefing, usePromoteGhost, useArchiveContact, useUnarchiveContact } from "../api";
import { AvatarPickerModal } from "../components/AvatarPickerModal";
import { formatDistanceToNow } from "date-fns";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "motion/react";
import { LocalContext } from "../components/LocalContext";
import { RichInteractionComposer } from "../components/RichInteractionComposer";

import { toast } from "sonner";
import { cn } from "../lib/utils";
import {
  LABEL, LABEL_PRIMARY, SECTION_HEADING, SECTION_HEADING_SPACED,
  CARD, CARD_TINTED, STATUS_BADGE_SUCCESS, TAG_PILL, EMPTY_STATE,
} from "../lib/styles";

import { PlatformIcon } from '../components/ContactDetail/PlatformIcon';
import { EditableField } from '../components/ContactDetail/EditableField';
import { IndustryField } from '../components/ContactDetail/IndustryField';
import { BirthdayField } from '../components/ContactDetail/BirthdayField';
import { MultiValueField, EMAIL_LABELS, PHONE_LABELS, ADDR_LABELS } from '../components/ContactDetail/MultiValueField';
import { ContactActionsMenu } from '../components/ContactDetail/ContactActionsMenu';
import { VibePickerPopover, VIBE_COLORS } from '../components/ContactDetail/VibePickerPopover';
import { ContactListsSection } from '../components/ContactDetail/ContactListsSection';

// ---------------------------------------------------------------------------
// ContactDetail — Right-pane master view for a single contact
// ---------------------------------------------------------------------------

export const ContactDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isMapActive = location.pathname.startsWith('/map');
  
  const { data: contact, isLoading: contactLoading } = useContact(id);
  const { data: timeline = [], isLoading: timelineLoading } = useTimeline(id);
  const updateContact = useUpdateContact();
  const addAttachment = useAddAttachment();
  const deleteContact = useDeleteContact();
  const deleteInteraction = useDeleteInteraction();
  const generateBriefing = useGenerateBriefing();
  const promoteGhost = usePromoteGhost();
  const archiveContact = useArchiveContact();
  const unarchiveContact = useUnarchiveContact();

  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);

  const onDrop = React.useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0 && id) {
      const isEml = acceptedFiles[0].name.toLowerCase().endsWith('.eml');
      const toastId = isEml ? toast.loading(`Summarizing email thread with Gemini...`) : undefined;
      
      addAttachment.mutate(
        { contactId: id, file: acceptedFiles[0] },
        {
          onSuccess: () => {
            if (toastId) toast.dismiss(toastId);
            toast.success(isEml ? `Email imported & summarized!` : `Attached "${acceptedFiles[0].name}"`);
          },
          onError: (err) => {
            if (toastId) toast.dismiss(toastId);
            toast.error(`Upload failed: ${err.message}`);
          },
        }
      );
    }
  }, [id, addAttachment]);
  
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    accept: {
      'message/rfc822': ['.eml'],
      'image/*': ['.png', '.jpg', '.jpeg', '.gif'],
      'application/pdf': ['.pdf'],
      'text/*': ['.txt', '.csv', '.md']
    }
  });


  const [showVibePicker, setShowVibePicker] = useState(false);
  const [activeTab, setActiveTab] = useState<'timeline' | 'dossier'>('timeline');
  const [newInterest, setNewInterest] = useState('');
  const [newPreference, setNewPreference] = useState('');
  const [isEditingDossier, setIsEditingDossier] = useState(false);
  const [dossierText, setDossierText] = useState('');

  const handleAddInterest = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newInterest.trim() && contact) {
      e.preventDefault();
      const updated = [...(contact.interests || []), { id: Math.random().toString(), interest: newInterest.trim(), isAiGenerated: false }];
      updateContact.mutate({ id: id!, data: { interests: updated } as any });
      setNewInterest('');
    }
  };

  const handleRemoveInterest = (interestId: string) => {
    if (!contact) return;
    const updated = (contact.interests || []).filter((i: any) => i.id !== interestId);
    updateContact.mutate({ id: id!, data: { interests: updated } as any });
  };

  const isBriefingValid = React.useMemo(() => {
    if (!contact?.aiBriefing || !contact?.aiBriefingAt) return false;
    const diff = new Date().getTime() - new Date(contact.aiBriefingAt).getTime();
    return diff < 3 * 24 * 60 * 60 * 1000;
  }, [contact?.aiBriefing, contact?.aiBriefingAt]);

  const clearBriefing = React.useCallback(() => {
    if (!contact) return;
    updateContact.mutate({ id: contact.id, data: { aiBriefing: null, aiBriefingAt: null } as any });
  }, [contact, updateContact]);



  const handleDeleteContact = () => {
    if (!id || !contact) return;
    if (!confirm(`Permanently delete ${contact.name}? This cannot be undone.`)) return;
    deleteContact.mutate(id, {
      onSuccess: () => {
        toast.success(`Deleted ${contact.name}`);
        navigate("/");
      },
      onError: (err) => toast.error(`Delete failed: ${err.message}`),
    });
  };

  const handleDeleteInteraction = (interactionId: string) => {
    if (!id) return;
    deleteInteraction.mutate(
      { id: interactionId, contactId: id },
      {
        onSuccess: () => toast.success("Interaction deleted"),
        onError: (err) => toast.error(`Delete failed: ${err.message}`),
      }
    );
  };

  if (contactLoading) return <div className="p-12 text-center text-on-surface-variant animate-pulse font-headline">Loading contact...</div>;
  if (!contact) return <div className="p-12 text-center">Contact not found.</div>;

  const handleUpdate = (field: string, val: string) => {
    if (!id) return;
    updateContact.mutate({ id, data: { [field]: val } });
  };



  const handleVibeSelect = (vibeId: string) => {
    if (!id) return;
    updateContact.mutate({ id, data: { themeColor: vibeId } });
    setShowVibePicker(false);
  };

  // Primary email/phone — used in external references (e.g. mailto links added in future)
  const primaryEmail = contact.emails?.find(e => e.isPrimary)?.email ?? contact.emails?.[0]?.email ?? null;
  const primaryPhone = contact.phones?.find(p => p.isPrimary)?.phone ?? contact.phones?.[0]?.phone ?? null;
  // Suppress unused-variable warnings — kept for external consumers / future mailto/tel links
  void primaryEmail; void primaryPhone;

  const currentTheme = VIBE_COLORS.find(v => v.id === contact.themeColor) || VIBE_COLORS[0];
  const themeStyles = {
    '--color-primary': currentTheme.primary,
    '--color-primary-dim': currentTheme.dim,
    '--color-primary-container': currentTheme.container,
  } as React.CSSProperties;

  return (
    <>
    <div className="h-full overflow-y-auto w-full relative" style={themeStyles}>
      {/* Mobile Back Button */}
      <div className="sticky top-0 z-30 glass-panel px-4 py-3 lg:hidden flex items-center">
        <Link to="/" className="flex items-center gap-2 text-primary font-bold">
          <ArrowLeft className="w-5 h-5" /> Back
        </Link>
      </div>

      <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-12 pb-32 relative">
        {isMapActive && (
           <button onClick={() => navigate('/map')} className="hidden md:flex absolute top-2 right-2 md:top-4 md:right-4 p-2.5 bg-surface hover:bg-surface-container-high rounded-full z-50 shadow-sm border border-surface-container-highest transition-colors" title="Close Details">
             <X className="w-5 h-5 text-on-surface-variant" />
           </button>
        )}
        {/* Header Section (Inline Editable) */}
        <section className="flex flex-col md:flex-row items-start md:items-center gap-6">
          <div className="relative shrink-0 group/avatar">
            {/* Avatar image */}
            <div className="w-24 h-24 md:w-32 md:h-32 rounded-3xl overflow-hidden bg-surface-container-highest ring-1 ring-surface-container-highest shadow-xl">
              <img
                alt={contact.name}
                className="w-full h-full object-cover"
                src={contact.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(contact.name)}&mouth=default,smile,serious`}
              />
            </div>

            {/* Pencil edit overlay — appears on hover */}
            <button
              onClick={() => setIsAvatarPickerOpen(true)}
              title="Edit Avatar"
              className="absolute inset-0 rounded-3xl bg-black/40 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity cursor-pointer"
            >
              <div className="bg-white/20 backdrop-blur-sm rounded-full p-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                </svg>
              </div>
            </button>
            {/* Archived badge — overlaid on avatar */}
            {!!contact.isArchived && (
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-amber-500/90 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full shadow-sm whitespace-nowrap">
                <Archive className="w-2.5 h-2.5" />
                Archived
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <div className="text-4xl md:text-5xl font-extrabold font-headline tracking-tight text-on-surface truncate flex items-center gap-2">
                <EditableField value={contact.name} onSave={(val) => handleUpdate('name', val)} placeholder="Contact Name" />
                {contact.pronouns && <span className="opacity-40 text-2xl font-medium tracking-normal inline-block align-middle">({contact.pronouns})</span>}
              </div>
              
              <VibePickerPopover
                showVibePicker={showVibePicker}
                setShowVibePicker={setShowVibePicker}
                currentVibeId={contact.themeColor}
                onSelect={handleVibeSelect}
              />

              {/* Archive toggle button */}
              <button
                onClick={() => {
                  if (!id) return;
                  if (contact.isArchived) {
                    unarchiveContact.mutate(id, {
                      onSuccess: () => toast.success(`${contact.name} restored to network`),
                      onError: (err) => toast.error(`Failed: ${err.message}`),
                    });
                  } else {
                    archiveContact.mutate(id, {
                      onSuccess: () => toast.success(`${contact.name} archived`),
                      onError: (err) => toast.error(`Failed: ${err.message}`),
                    });
                  }
                }}
                disabled={archiveContact.isPending || unarchiveContact.isPending}
                title={contact.isArchived ? 'Unarchive Contact' : 'Archive Contact'}
                className={cn(
                  "p-2 rounded-xl transition-all flex items-center justify-center",
                  contact.isArchived
                    ? "text-amber-500 bg-amber-500/15 hover:bg-amber-500/25"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-amber-500"
                )}
              >
                <Archive className="w-5 h-5" />
              </button>
              
              <ContactActionsMenu contact={contact} onDelete={handleDeleteContact} />
            </div>

            {/* Headline */}
            {contact.headline && (
              <div className="text-base text-on-surface-variant font-medium mb-1 italic opacity-70">
                {contact.headline}
              </div>
            )}

            {/* aiSummary Banner */}
            {contact.aiSummary && (
              <div className="flex items-start gap-2 bg-primary/10 rounded-xl p-3 mb-3 border border-primary/20 max-w-fit">
                <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div className="text-sm text-primary font-medium leading-relaxed italic">
                  {contact.aiSummary}
                </div>
              </div>
            )}

            <div className="text-lg md:text-xl font-medium text-on-surface-variant flex items-center flex-wrap gap-x-2 mb-2">
              <Briefcase className="w-5 h-5 opacity-50 inline-block mr-1" />
              <EditableField value={contact.role} onSave={(val) => handleUpdate('role', val)} placeholder="Role / Title" />
              <span className="opacity-50">at</span>
              <EditableField value={contact.company} onSave={(val) => handleUpdate('company', val)} placeholder="Company" />
              {/* Lists — inline to the right of role/company */}
              <ContactListsSection contactId={contact.id} contactLists={contact.lists || []} />
            </div>

            {/* Context & Links Row */}
            {((contact.lat && contact.lng) || (contact.socialLinks && contact.socialLinks.length > 0)) && (
              <div className="flex flex-wrap items-center gap-2 mt-4 mb-2">
                {/* Local Context */}
                {contact.lat && contact.lng && (
                  <LocalContext lat={contact.lat} lng={contact.lng} />
                )}
                
                {/* Social Link Pills */}
                {contact.socialLinks?.map((sl) => {
                  let displayName = sl.handle || sl.platform;
                  try { displayName = sl.handle || new URL(sl.url).hostname.replace('www.', ''); } catch(e){}
                  return (
                    <a key={sl.id} href={sl.url} target="_blank" rel="noopener noreferrer" 
                       className="flex items-center gap-1.5 text-sm font-bold text-on-surface-variant bg-surface-container hover:bg-surface-container-high px-3 py-1.5 rounded-xl shadow-sm transition-colors">
                      <PlatformIcon platform={sl.platform} className="w-4 h-4" /> 
                      <span>{displayName}</span>
                    </a>
                  )
                })}
              </div>
            )}

            {/* Tags */}
            {contact.tags && contact.tags.length > 0 && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {contact.tags.map((t) => (
                  <span key={t.id} className={cn(TAG_PILL, "flex items-center gap-1")}>
                    <Tag className="w-2.5 h-2.5" /> {t.tag}
                  </span>
                ))}
              </div>
            )}


            {/* Catch Me Up AI Briefing */}
            <div className="mt-4">
              <button 
                onClick={() => generateBriefing.mutate(contact.id)}
                disabled={generateBriefing.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-xl font-bold hover:opacity-90 transition-opacity text-sm shadow-sm"
              >
                🪄 {generateBriefing.isPending ? 'Generating...' : 'Catch Me Up'}
              </button>
              
              <AnimatePresence>
                {isBriefingValid && !generateBriefing.isPending && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden mt-3"
                  >
                    <div className={cn(CARD_TINTED, "text-sm text-on-surface relative")}>
                      <button onClick={clearBriefing} className="absolute top-4 right-4 p-1 rounded-full hover:bg-surface-container-highest transition-colors opacity-50 hover:opacity-100" title="Dismiss Briefing">
                        <X className="w-4 h-4 text-on-surface" />
                      </button>
                      <h4 className="text-xs font-bold uppercase tracking-widest text-primary mb-3 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5"/> Executive Briefing</h4>
                      <ul className="space-y-2.5 pr-6">
                        {JSON.parse(contact!.aiBriefing!).map((point: string, idx: number) => (
                          <li key={idx} className="flex gap-2">
                            <span className="text-on-surface-variant font-bold max-w-fit flex-shrink-0 mt-0.5">•</span> 
                            <span className="leading-relaxed">{point}</span>
                          </li>
                        ))}
                      </ul>
                      {contact.aiBriefingAt && (
                        <p className="text-[10px] text-on-surface-variant mt-4 opacity-70">Generated {formatDistanceToNow(new Date(contact.aiBriefingAt), {addSuffix: true})}</p>
                      )}
                    </div>
                  </motion.div>
                )}
                {generateBriefing.isPending && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden mt-3"
                  >
                    <div className={cn(CARD_TINTED, "text-sm space-y-4")}>
                      <h4 className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5"/> Synthesizing Context...</h4>
                      <div className="space-y-3">
                        <div className="h-4 bg-surface-container-highest rounded animate-pulse w-3/4"></div>
                        <div className="h-4 bg-surface-container-highest rounded animate-pulse w-full"></div>
                        <div className="h-4 bg-surface-container-highest rounded animate-pulse w-5/6"></div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-24 gap-10 items-start">
          
          {/* Left Column: Facts & AI */}
          <div className="lg:col-span-9 space-y-6">
            <div className={cn(CARD, "space-y-4")}>
              <h3 className={cn(SECTION_HEADING, "pb-2 mb-4")}>Details</h3>
              
              <div className="flex items-start gap-4 group">
                <MapPin className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <span className={LABEL}>Location</span>
                  <MultiValueField
                    items={(contact.addresses && contact.addresses.length > 0) 
                      ? contact.addresses.map((a: any) => ({ id: a.id, value: a.address, label: a.label || 'home' }))
                      : contact.location ? [{ id: 'legacy-init', value: contact.location, label: 'home' }] : []
                    }
                    onSave={updated =>
                      updateContact.mutate({ id: id!, data: { addresses: updated.map((a, i) => ({ address: a.value, label: a.label || 'home', isPrimary: i === 0 })) } as any })
                    }
                    labelOptions={ADDR_LABELS}
                    emptyPlaceholder="Add Location..."
                    inputPlaceholder="San Francisco, CA"
                  />
                </div>
              </div>

              <div className="flex items-start gap-4 group">
                <Mail className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <span className={LABEL}>Email</span>
                  <MultiValueField
                    items={(contact.emails ?? []).map(e => ({ id: e.id, value: e.email, label: e.label || 'personal' }))}
                    onSave={updated =>
                      updateContact.mutate({ id: id!, data: { emails: updated.map((e, i) => ({ email: e.value, label: e.label, isPrimary: i === 0 })) } as any })
                    }
                    labelOptions={EMAIL_LABELS}
                    emptyPlaceholder="Add Email..."
                    inputPlaceholder="email@example.com"
                  />
                </div>
              </div>

              <div className="flex items-start gap-4 group">
                <Phone className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <span className={LABEL}>Phone</span>
                  <MultiValueField
                    items={(contact.phones ?? []).map(p => ({ id: p.id, value: p.phone, label: p.label || 'mobile' }))}
                    onSave={updated =>
                      updateContact.mutate({ id: id!, data: { phones: updated.map((p, i) => ({ phone: p.value, label: p.label, isPrimary: i === 0 })) } as any })
                    }
                    labelOptions={PHONE_LABELS}
                    emptyPlaceholder="Add Phone..."
                    inputPlaceholder="+1 (555) 000-0000"
                  />
                </div>
              </div>

              <div className="flex items-start gap-4 group">
                <Cake className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className={LABEL}>Birthday</span>
                  <BirthdayField value={contact.birthday} onSave={(val) => handleUpdate('birthday', val)} />
                </div>
              </div>

              {/* Industry */}
              <div className="flex items-start gap-4 group">
                <Globe className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className={LABEL}>Industry</span>
                  <IndustryField value={contact.industry} onSave={(val) => handleUpdate('industry', val)} />
                </div>
              </div>

              <div className="flex items-start gap-4 group">
                <Coffee className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className={LABEL}>Preferences</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {contact.preferences && contact.preferences.trim() ? (
                      contact.preferences.split(',').map((s: string) => s.trim()).filter(Boolean).map((pref: string, idx: number) => (
                        <div key={idx} className="group/pill w-fit flex items-center gap-1.5 text-xs font-bold py-1 px-2.5 rounded-full bg-surface-container text-on-surface-variant transition-all overflow-hidden">
                          <span className="whitespace-normal break-words">{pref}</span>
                          <button 
                            onClick={() => {
                              const newPrefs = contact.preferences!.split(',').map((s: string) => s.trim()).filter(Boolean);
                              newPrefs.splice(idx, 1);
                              handleUpdate('preferences', newPrefs.join(', '));
                            }}
                            className="w-4 h-4 rounded-full text-on-surface-variant/40 hover:text-red-500 hover:bg-red-500/10 flex items-center justify-center transition-colors shrink-0 -mr-1"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ))
                    ) : (
                       <span className="text-sm font-medium text-on-surface-variant opacity-50 italic">No preferences logged</span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={newPreference}
                    onChange={(e) => setNewPreference(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newPreference.trim()) {
                        e.preventDefault();
                        const current = contact.preferences ? contact.preferences.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
                        current.push(newPreference.trim());
                        handleUpdate('preferences', current.join(', '));
                        setNewPreference('');
                      }
                    }}
                    placeholder="Add Preference"
                    className="mt-2 text-xs bg-transparent border-b border-surface-container-highest focus:border-primary outline-none py-1 placeholder-on-surface-variant/50 text-on-surface w-full max-w-[200px] transition-colors"
                  />
                </div>
              </div>

              {/* Interests */}
              <div className="flex items-start gap-4 group">
                <Heart className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className={LABEL}>Interests</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {contact.interests && contact.interests.length > 0 ? (
                      contact.interests.map((interest: any) => (
                        <div key={interest.id} className={cn(
                          "group/pill w-fit flex items-center gap-1.5 text-xs font-bold py-1 px-2.5 rounded-full transition-all overflow-hidden",
                          interest.isAiGenerated ? "bg-primary/10 text-primary border border-primary/20" : "bg-surface-container text-on-surface-variant border border-transparent"
                        )}>
                          {interest.isAiGenerated && <Sparkles className="w-3 h-3 opacity-70 shrink-0" />}
                          <span className="whitespace-normal break-words">{interest.interest}</span>
                          <button 
                            onClick={() => handleRemoveInterest(interest.id)}
                            className="w-4 h-4 rounded-full text-on-surface-variant/40 hover:text-red-500 hover:bg-red-500/10 flex items-center justify-center transition-colors shrink-0 -mr-1"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <span className="text-sm font-medium text-on-surface-variant opacity-50 italic">No interests logged</span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={newInterest}
                    onChange={(e) => setNewInterest(e.target.value)}
                    onKeyDown={handleAddInterest}
                    placeholder="Add Interest"
                    className="mt-2 text-xs bg-transparent border-b border-surface-container-highest focus:border-primary outline-none py-1 placeholder-on-surface-variant/50 text-on-surface w-full max-w-[200px] transition-colors"
                  />
                </div>
              </div>
              
              {contact.nextFollowUpAt && (
                 <div className="flex items-start gap-4 group mt-6 pt-4">
                   <Sparkles className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                   <div className="flex-1 min-w-0 flex flex-col">
                     <span className={LABEL_PRIMARY}>Next Follow Up</span>
                     <span className="text-sm font-bold text-on-surface">{new Date(contact.nextFollowUpAt).toLocaleString()}</span>
                   </div>
                 </div>
              )}
            </div>



          </div>

          {/* Right Column: Timeline & Composer & Backgrounds */}
          <div {...getRootProps()} className="lg:col-span-15 relative min-h-[500px] flex flex-col gap-6">
            <input {...getInputProps()} />

            {/* Tab Controller */}
            <div className="flex items-center gap-2 p-1.5 bg-surface-container-low rounded-xl border border-surface-container-highest shadow-sm relative z-20 w-fit">
              <button 
                onClick={() => setActiveTab('timeline')} 
                className={cn("px-6 py-2 rounded-lg font-bold text-sm transition-all", activeTab === 'timeline' ? "bg-surface shadow-sm text-primary" : "text-on-surface-variant hover:text-on-surface")}
              >
                Timeline
              </button>
              <button 
                onClick={() => setActiveTab('dossier')} 
                className={cn("px-6 py-2 rounded-lg font-bold text-sm transition-all", activeTab === 'dossier' ? "bg-surface shadow-sm text-primary" : "text-on-surface-variant hover:text-on-surface")}
              >
                Dossier
              </button>
            </div>

            {activeTab === 'dossier' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6">
                {/* AI Dossier / aiBackground */}
                {(contact.aiBackground || isEditingDossier) && (
                  <div className={cn(CARD, "bg-surface-container-lowest border-primary/20 relative overflow-hidden group")}>
                    <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
                    <div className="flex justify-between items-center mb-4">
                      <h3 className={cn(SECTION_HEADING_SPACED, "text-primary flex items-center gap-2")}><Sparkles className="w-4 h-4" /> AI Dossier</h3>
                      {!isEditingDossier && (
                        <button onClick={() => { setDossierText(contact.aiBackground || ''); setIsEditingDossier(true); }} className="opacity-0 group-hover:opacity-100 text-on-surface-variant hover:text-primary transition-opacity p-1 bg-surface-container-low rounded-md shadow-sm border border-surface-container-highest">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {isEditingDossier ? (
                      <div className="flex flex-col gap-3">
                        <textarea 
                          value={dossierText} 
                          onChange={e => setDossierText(e.target.value)} 
                          className="w-full min-h-[300px] p-4 bg-surface-container-low rounded-xl border border-surface-container-highest focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm font-mono text-on-surface resize-y"
                          autoFocus
                        />
                        <div className="flex justify-end gap-2 mt-1">
                          <button onClick={() => setIsEditingDossier(false)} className="px-4 py-1.5 rounded-full text-xs font-bold text-on-surface-variant hover:bg-surface-container transition-colors">Cancel</button>
                          <button onClick={() => { updateContact.mutate({ id: id!, data: { aiBackground: dossierText } as any }); setIsEditingDossier(false); }} className="px-4 py-1.5 rounded-full text-xs font-bold bg-primary text-on-primary shadow shadow-primary/20 hover:shadow-md hover:shadow-primary/30 transition-all">Save Dossier</button>
                        </div>
                      </div>
                    ) : (
                      <div 
                        onDoubleClick={() => { setDossierText(contact.aiBackground || ''); setIsEditingDossier(true); }}
                        className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-a:text-primary cursor-text"
                        title="Double click to edit"
                      >
                        <ReactMarkdown>{contact.aiBackground!}</ReactMarkdown>
                      </div>
                    )}
                    {!isEditingDossier && contact.aiHydratedAt && (
                       <p className="text-[10px] text-on-surface-variant mt-4 opacity-70">
                         Sourced via web hydration on {new Date(contact.aiHydratedAt).toLocaleDateString()}
                       </p>
                    )}
                  </div>
                )}
            
            {/* AI Custom Attributes */}
            {contact.attributes && contact.attributes.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {contact.attributes.map((attr: any) => (
                  <div key={attr.id} className="bg-surface-container-lowest rounded-xl p-4 border border-surface-container-highest shadow-sm">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-primary block mb-1">{attr.name}</span>
                    <span className="text-sm text-on-surface leading-relaxed font-medium block">{attr.value}</span>
                  </div>
                ))}
              </div>
            )}
            
            {contact.about && (
              <div className={cn(CARD, "relative overflow-hidden group")}>
                <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
                <h3 className={SECTION_HEADING_SPACED}><Sparkles className="w-4 h-4 text-primary" /> About</h3>
                <p className="whitespace-pre-wrap text-on-surface-variant text-sm leading-relaxed max-h-32 overflow-hidden relative after:absolute after:bottom-0 after:left-0 after:w-full after:h-12 after:bg-gradient-to-t after:from-surface-container-lowest hover:max-h-full hover:after:opacity-0 transition-all">
                  {contact.about}
                </p>
                <div className="text-center opacity-100 group-hover:opacity-0 text-[10px] uppercase font-bold text-primary mt-1 transition-opacity">Hover to expand</div>
              </div>
            )}

            {((contact.experience?.length ?? 0) > 0 || (contact.education?.length ?? 0) > 0) && (
              <div className="bg-surface-container-lowest rounded-2xl shadow-sm overflow-hidden">
                {contact.experience && contact.experience.length > 0 && (
                  <div className="p-6 last:border-0 bg-surface-container-lowest">
                    <h3 className={cn(SECTION_HEADING_SPACED, "mb-5")}><Briefcase className="w-4 h-4" /> Experience Overview</h3>
                    <div className="space-y-5">
                      {contact.experience.map((exp) => (
                        <div key={exp.id} className="flex gap-4">
                          <div className="icon-container">
                             <Briefcase className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-bold text-on-surface flex items-center gap-2">
                              {exp.role}
                              {exp.isCurrent && (
                                <span className={STATUS_BADGE_SUCCESS}>Current</span>
                              )}
                            </p>
                            <p className="text-sm text-primary font-bold">{exp.company}</p>
                            <p className="text-xs text-on-surface-variant mb-1 font-medium">
                              {exp.startDate}{exp.endDate ? ` – ${exp.endDate}` : exp.isCurrent ? ' – Present' : ''}
                              {exp.location && <span className="ml-2 opacity-60">· {exp.location}</span>}
                            </p>
                            {exp.description && <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-2 hover:line-clamp-none mt-1">{exp.description}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {contact.education && contact.education.length > 0 && (
                  <div className="p-6">
                    <h3 className={cn(SECTION_HEADING_SPACED, "mb-5")}><FileText className="w-4 h-4" /> Education</h3>
                    <div className="space-y-4">
                      {contact.education.map((edu) => (
                        <div key={edu.id} className="flex gap-4">
                          <div className="w-2 h-2 rounded-full ring-4 ring-primary/20 bg-primary mt-1.5 shrink-0" />
                          <div>
                            <p className="font-bold text-on-surface">{edu.school}</p>
                            <p className="text-sm text-on-surface-variant font-medium">
                              {edu.degree}
                              {edu.fieldOfStudy && <span className="opacity-70"> · {edu.fieldOfStudy}</span>}
                            </p>
                            {(edu.startDate || edu.endDate) && (
                              <p className="text-xs text-on-surface-variant opacity-70 mt-0.5">
                                {edu.startDate}{edu.endDate ? ` – ${edu.endDate}` : ''}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            </motion.div>
          )}

          {activeTab === 'timeline' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 relative">
              <AnimatePresence>
              {isDragActive && (
                <motion.div 
                  initial={{ opacity: 0 }} 
                  animate={{ opacity: 1 }} 
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-50 bg-surface-container-lowest/80 backdrop-blur-sm rounded-3xl flex items-center justify-center border-4 border-dashed border-primary"
                >
                  <div className="text-center">
                     <UploadCloud className="w-20 h-20 text-primary mx-auto mb-4 animate-bounce" />
                     <p className="text-2xl font-bold font-headline text-on-surface">Drop file to attach...</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <RichInteractionComposer contactId={id!} />

            {!timelineLoading && timeline.length === 0 && (
              <div className={EMPTY_STATE}>
                <p className="font-medium text-sm">No interactions logged yet.</p>
              </div>
            )}

            <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-surface-container-high before:to-transparent">
              {timelineLoading && <div className="text-center p-4 text-on-surface-variant animate-pulse">Loading timeline...</div>}
              
              {timeline.map((item) => {
                let Icon = FileText;
                let bgClass = "bg-surface-container";
                let textClass = "text-on-surface";
                
                if (item.type === 'call') { Icon = Phone; bgClass = "bg-blue-500/10"; textClass = "text-blue-500"; }
                if (item.type === 'meeting') { Icon = Handshake; bgClass = "bg-emerald-500/10"; textClass = "text-emerald-600"; }
                if (item.type === 'email') { Icon = Mail; bgClass = "bg-green-500/10"; textClass = "text-green-500"; }
                if (item.type === 'note') { bgClass = "bg-primary/10"; textClass = "text-primary"; }
                if (item.type === 'message' || item.type === 'sms') { Icon = MessageSquare; bgClass = "bg-teal-500/10"; textClass = "text-teal-500"; }
                if (item.type === 'linkedin') { Icon = Linkedin; bgClass = "bg-blue-600/10"; textClass = "text-blue-600"; }
                if (item.type === 'facebook') { Icon = Facebook; bgClass = "bg-blue-500/10"; textClass = "text-blue-500"; }
                if (item.type === 'import') { Icon = ExternalLink; bgClass = "bg-amber-500/10"; textClass = "text-amber-500"; }

                return (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={item.id} 
                    className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active"
                  >
                    {/* Icon marker */}
                    <div className={`flex items-center justify-center w-10 h-10 rounded-full border-4 border-surface shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm ${bgClass} ${textClass} z-10 mx-auto absolute left-0 md:left-1/2 -translate-x-0`}>
                      <Icon className="w-4 h-4" />
                    </div>

                    {/* Content Box */}
                    <div className="w-[calc(100%-3rem)] md:w-[calc(50%-2.5rem)] ml-auto md:ml-0 p-5 rounded-2xl bg-surface-container-lowest shadow-sm hover:shadow-md transition-shadow relative group/card">
                      <div className="flex justify-between items-center mb-2">
                        <h4 className="font-extrabold text-on-surface">{item.title}</h4>
                        <div className="flex items-center gap-2">
                          <time className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">{new Date(item.date).toLocaleDateString()}</time>
                          <button
                            onClick={() => handleDeleteInteraction(item.id)}
                            className="opacity-0 group-hover/card:opacity-60 hover:!opacity-100 text-red-500 p-1 rounded transition-opacity"
                            title="Delete interaction"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      
                      {item.isViaName && (
                        <div 
                           className="mb-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container border border-surface-container-highest/20 opacity-70 hover:opacity-100 transition-opacity cursor-pointer text-[11px] uppercase tracking-wide text-on-surface-variant font-bold" 
                           onClick={() => navigate(`/contact/${item.isViaId}`)}
                           title="Navigate to Original Interaction"
                        >
                           <ExternalLink className="w-3 h-3 text-primary" /> via {item.isViaName}
                        </div>
                      )}

                      {item.content && (
                        <div 
                          className="prose prose-sm max-w-none text-on-surface-variant leading-relaxed prose-p:my-1 prose-headings:my-2 prose-headings:text-on-surface prose-strong:text-on-surface"
                          dangerouslySetInnerHTML={{ __html: item.content }} 
                        />
                      )}
                      
                      {/* Ghost Mentions Extraction */}
                      {item.mentions && (() => {
                        try {
                          const parsed = JSON.parse(item.mentions);
                          if (!Array.isArray(parsed) || parsed.length === 0) return null;
                          return (
                            <div className="mt-4 pt-3 flex flex-wrap gap-2 items-center">
                              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mr-2 flex items-center gap-1"><Sparkles className="w-3 h-3 text-primary opacity-60"/> Mentioned:</span>
                              {parsed.map((mention: any, idx: number) => {
                                if (mention.isGhost) {
                                  return (
                                    <button 
                                      key={idx}
                                      onClick={() => promoteGhost.mutate(mention.contactId, {
                                        onSuccess: () => navigate(`/contact/${mention.contactId}`)
                                      })}
                                      title={`Promote ${mention.name} to Contact`}
                                      className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-surface-container-low border hover:bg-surface-container transition-all group/ghost"
                                      style={{ borderStyle: 'dashed', borderWidth: '1px', borderColor: 'var(--color-primary)' }}
                                    >
                                      <div className="w-5 h-5 rounded-full bg-surface-container-highest flex items-center justify-center text-[10px] font-bold text-on-surface-variant opacity-70 group-hover/ghost:opacity-100 transition-opacity">
                                        {mention.name.charAt(0)}
                                      </div>
                                      <div className="text-xs font-semibold text-on-surface-variant group-hover/ghost:text-on-surface text-left leading-tight pr-1 opacity-80 group-hover/ghost:opacity-100 transition-opacity">
                                        {mention.name}
                                      </div>
                                    </button>
                                  );
                                }
                                return (
                                  <Link 
                                    key={idx}
                                    to={`/contact/${mention.contactId}`}
                                    className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-surface-container-lowest shadow-sm hover:shadow transition-shadow border border-transparent"
                                  >
                                    <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
                                      {mention.name.charAt(0)}
                                    </div>
                                    <span className="text-xs font-semibold text-on-surface line-clamp-1">{mention.name}</span>
                                  </Link>
                                );
                              })}
                            </div>
                          );
                        } catch(e) { return null; }
                      })()}
                      
                      {item.fileUrl && (
                        <div className="mt-3">
                          {item.fileType?.startsWith('image/') ? (
                            <img src={item.fileUrl} alt={item.fileName || 'Attachment'} className="max-w-full rounded-xl shadow-sm object-cover max-h-64" />
                          ) : (
                            <a href={item.fileUrl} download className="flex items-center gap-3 p-3 rounded-xl bg-surface-container-low hover:bg-surface-container-high transition-colors w-fit max-w-full overflow-hidden">
                              <File className="w-8 h-8 text-primary shrink-0 opacity-80" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-on-surface truncate">{item.fileName}</p>
                                <p className="text-xs text-on-surface-variant uppercase tracking-widest font-bold mt-0.5">{item.fileType?.split('/')[1] || 'FILE'}</p>
                              </div>
                            </a>
                          )}
                        </div>
                      )}

                      {item.duration && (
                        <p className="text-xs text-on-surface-variant mt-3 font-medium flex items-center gap-1 opacity-70">
                           Duration: {item.duration}
                        </p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
            </motion.div>
          )}

          </div>
        </div>
      </div>
    </div>

    {/* ── Avatar Picker Modal ───────────────────────────────────────────── */}
    {id && (
      <AvatarPickerModal
        isOpen={isAvatarPickerOpen}
        onClose={() => setIsAvatarPickerOpen(false)}
        contactId={id}
        contactName={contact.name}
        currentAvatarUrl={contact.avatarUrl}
      />
    )}
    </>
  );
};
