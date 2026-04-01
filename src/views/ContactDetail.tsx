import React, { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { 
  Mail, Phone, FileText, Handshake, Verified, 
  MapPin, Cake, Coffee, Briefcase, ArrowLeft, Sparkles, UploadCloud, File, Trash2, Palette,
  Globe, MessageSquare, Tag, Linkedin, Facebook, Github, Twitter, Instagram, ExternalLink
} from "lucide-react";
import { useContact, useTimeline, useUpdateContact, useAddAttachment, useDeleteContact, useDeleteInteraction } from "../api";
import { useDropzone } from "react-dropzone";
import { generateContactInsights } from "../services/geminiService";
import { motion, AnimatePresence } from "motion/react";
import { LocalContext } from "../components/LocalContext";
import { RichInteractionComposer } from "../components/RichInteractionComposer";
import { AIInsight } from "../types";
import { toast } from "sonner";
import { cn } from "../lib/utils";
import {
  LABEL, LABEL_PRIMARY, SECTION_HEADING, SECTION_HEADING_SPACED,
  CARD, CARD_TINTED, EDITABLE_INPUT, MICRO_BADGE, STATUS_BADGE_SUCCESS,
  TAG_PILL, TIMELINE_CARD, timelineMarker, EMPTY_STATE, DANGER_BTN,
} from "../lib/styles";

// ---------------------------------------------------------------------------
// Vibe Themes
// ---------------------------------------------------------------------------
const VIBE_COLORS = [
  { id: 'brand', primary: '#009EDB', dim: '#007BB0', container: '#D6F1FF' },
  { id: 'emerald', primary: '#10B981', dim: '#059669', container: '#D1FAE5' },
  { id: 'amber', primary: '#F59E0B', dim: '#D97706', container: '#FEF3C7' },
  { id: 'rose', primary: '#F43F5E', dim: '#E11D48', container: '#FFE4E6' },
  { id: 'indigo', primary: '#6366F1', dim: '#4F46E5', container: '#E0E7FF' },
  { id: 'pink', primary: '#EC4899', dim: '#BE185D', container: '#FCE7F3' },
  { id: 'violet', primary: '#8B5CF6', dim: '#6D28D9', container: '#EDE9FE' },
  { id: 'teal', primary: '#14B8A6', dim: '#0F766E', container: '#CCFBF1' }
];

// ---------------------------------------------------------------------------
// Platform Icon Resolver
// ---------------------------------------------------------------------------
const PlatformIcon = ({ platform, className }: { platform: string; className?: string }) => {
  switch (platform.toLowerCase()) {
    case 'linkedin': return <Linkedin className={className} />;
    case 'facebook': return <Facebook className={className} />;
    case 'github': return <Github className={className} />;
    case 'twitter': return <Twitter className={className} />;
    case 'instagram': return <Instagram className={className} />;
    default: return <Globe className={className} />;
  }
};

// ---------------------------------------------------------------------------
// EditableField — Inline edit component for keyboard-first editing
// ---------------------------------------------------------------------------

const EditableField = ({ 
  value, 
  onSave, 
  placeholder, 
  className = "",
}: { 
  value: string | null; 
  onSave: (val: string) => void; 
  placeholder: string;
  className?: string;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [currentVal, setCurrentVal] = useState(value || "");

  useEffect(() => {
    setCurrentVal(value || "");
  }, [value]);

  const handleBlur = () => {
    setIsEditing(false);
    if (currentVal.trim() !== (value || "")) {
      onSave(currentVal.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    }
    if (e.key === 'Escape') {
      setCurrentVal(value || "");
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        autoFocus
        value={currentVal}
        onChange={e => setCurrentVal(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={cn(EDITABLE_INPUT, className)}
        placeholder={placeholder}
      />
    );
  }

  return (
    <span 
      onClick={() => setIsEditing(true)} 
      className={`cursor-text hover:bg-surface-container-high py-0.5 px-2 -ml-2 rounded transition-colors ${!value ? 'text-on-surface-variant opacity-50 italic' : ''} ${className}`}
    >
      {value || placeholder}
    </span>
  );
};


// ---------------------------------------------------------------------------
// ContactDetail — Right-pane master view for a single contact
// ---------------------------------------------------------------------------

export const ContactDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const { data: contact, isLoading: contactLoading } = useContact(id);
  const { data: timeline = [], isLoading: timelineLoading } = useTimeline(id);
  const updateContact = useUpdateContact();
  const addAttachment = useAddAttachment();
  const deleteContact = useDeleteContact();
  const deleteInteraction = useDeleteInteraction();

  const onDrop = React.useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0 && id) {
      addAttachment.mutate(
        { contactId: id, file: acceptedFiles[0] },
        {
          onSuccess: () => toast.success(`Attached "${acceptedFiles[0].name}"`),
          onError: (err) => toast.error(`Upload failed: ${err.message}`),
        }
      );
    }
  }, [id, addAttachment]);
  
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, noClick: true, noKeyboard: true });

  const [insight, setInsight] = useState<AIInsight | null>(null);
  const [generatingInsight, setGeneratingInsight] = useState(false);
  const [showVibePicker, setShowVibePicker] = useState(false);

  const handleGenerateInsight = async () => {
    if (!contact || timeline.length === 0) return;
    setGeneratingInsight(true);
    try {
      const res = await generateContactInsights(contact, timeline);
      setInsight(res);
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to generate AI insight");
    } finally {
      setGeneratingInsight(false);
    }
  };

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

  const handleTogglePremium = () => {
    if (!id) return;
    updateContact.mutate({ id, data: { isPremium: !contact.isPremium } });
  };

  const handleVibeSelect = (vibeId: string) => {
    if (!id) return;
    updateContact.mutate({ id, data: { themeColor: vibeId } });
    setShowVibePicker(false);
  };

  // Resolve primary email/phone from child arrays
  const primaryEmail = contact.emails?.find(e => e.isPrimary)?.email || contact.emails?.[0]?.email || null;
  const primaryPhone = contact.phones?.find(p => p.isPrimary)?.phone || contact.phones?.[0]?.phone || null;
  const additionalEmails = contact.emails?.filter(e => e.email !== primaryEmail) || [];
  const additionalPhones = contact.phones?.filter(p => p.phone !== primaryPhone) || [];

  const currentTheme = VIBE_COLORS.find(v => v.id === contact.themeColor) || VIBE_COLORS[0];
  const themeStyles = {
    '--color-primary': currentTheme.primary,
    '--color-primary-dim': currentTheme.dim,
    '--color-primary-container': currentTheme.container,
  } as React.CSSProperties;

  return (
    <div className="h-full overflow-y-auto w-full relative" style={themeStyles}>
      {/* Mobile Back Button */}
      <div className="sticky top-0 z-30 glass-panel px-4 py-3 lg:hidden flex items-center">
        <Link to="/" className="flex items-center gap-2 text-primary font-bold">
          <ArrowLeft className="w-5 h-5" /> Back
        </Link>
      </div>

      <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-12 pb-32">
        {/* Header Section (Inline Editable) */}
        <section className="flex flex-col md:flex-row items-start md:items-center gap-6">
          <div className="relative shrink-0">
            <div className="w-24 h-24 md:w-32 md:h-32 rounded-3xl overflow-hidden bg-surface-container-highest ring-1 ring-surface-container-highest shadow-xl">
              <motion.img 
                layoutId={`avatar-${contact.id}`}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                alt={contact.name} 
                className="w-full h-full object-cover" 
                src={contact.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(contact.name)}`} 
              />
            </div>
            {contact.isPremium && (
              <div 
                className="absolute -bottom-2 -right-2 signature-gradient text-on-primary w-8 h-8 rounded-full flex items-center justify-center shadow-lg cursor-pointer"
                title="Premium Client (Click to toggle)"
                onClick={handleTogglePremium}
              >
                <Verified className="w-4 h-4" />
              </div>
            )}
            {!contact.isPremium && (
               <div 
                className="absolute -bottom-2 -right-2 bg-surface-container-high text-on-surface-variant w-6 h-6 rounded-full flex items-center justify-center shadow-sm cursor-pointer hover:bg-primary hover:text-on-primary transition-colors"
                title="Mark as Premium"
                onClick={handleTogglePremium}
              >
                <Verified className="w-3 h-3" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <motion.div 
                layoutId={`name-${contact.id}`}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="text-4xl md:text-5xl font-extrabold font-headline tracking-tight text-on-surface truncate flex items-center gap-2"
              >
                <EditableField value={contact.name} onSave={(val) => handleUpdate('name', val)} placeholder="Contact Name" />
                {contact.pronouns && <span className="opacity-40 text-2xl font-medium tracking-normal inline-block align-middle">({contact.pronouns})</span>}
              </motion.div>
              
              <div className="relative shrink-0">
                <button 
                  onClick={() => setShowVibePicker(!showVibePicker)} 
                  className={`p-2 rounded-xl transition-all ${showVibePicker ? 'bg-primary/20 text-primary' : 'text-on-surface-variant hover:bg-surface-container hover:text-primary'}`}
                  title="Change Theme Vibe"
                >
                  <Palette className="w-5 h-5" />
                </button>
                
                <AnimatePresence>
                  {showVibePicker && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: 10 }}
                      className="absolute top-12 left-0 md:left-auto md:right-0 glass-panel rounded-xl shadow-xl p-3 z-50 flex gap-2 w-[164px] flex-wrap"
                    >
                      {VIBE_COLORS.map(vibe => (
                        <button 
                          key={vibe.id} 
                          onClick={() => handleVibeSelect(vibe.id)}
                          style={{ backgroundColor: vibe.primary }}
                          className={`w-6 h-6 rounded-full transition-transform hover:scale-110 shadow-sm ${contact.themeColor === vibe.id ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface-container-lowest' : 'hover:ring-2 hover:ring-on-surface-variant hover:ring-offset-2 hover:ring-offset-surface-container-lowest'}`}
                          title={`Vibe: ${vibe.id}`}
                        />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Headline */}
            {contact.headline && (
              <div className="text-base text-on-surface-variant font-medium mb-1 italic opacity-70">
                {contact.headline}
              </div>
            )}

            <div className="text-lg md:text-xl font-medium text-on-surface-variant flex items-center flex-wrap gap-x-2 mb-2">
              <Briefcase className="w-5 h-5 opacity-50 inline-block mr-1" />
              <EditableField value={contact.role} onSave={(val) => handleUpdate('role', val)} placeholder="Role / Title" />
              <span className="opacity-50">at</span>
              <EditableField value={contact.company} onSave={(val) => handleUpdate('company', val)} placeholder="Company" />
            </div>

            {/* Social Links — Now with platform icons */}
            {contact.socialLinks && contact.socialLinks.length > 0 && (
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {contact.socialLinks.map((sl) => {
                  let displayName = sl.handle || sl.platform;
                  try { displayName = sl.handle || new URL(sl.url).hostname.replace('www.', ''); } catch(e){}
                  return (
                    <a key={sl.id} href={sl.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold bg-surface-container px-2 py-1 rounded text-primary hover:bg-primary hover:text-on-primary transition-colors flex items-center gap-1 shadow-sm">
                      <PlatformIcon platform={sl.platform} className="w-3 h-3" /> {displayName}
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

            {/* Source Provenance Badges */}
            {contact.sources && contact.sources.length > 0 && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {contact.sources.map((src) => (
                  <span key={src.id} className="text-[10px] font-medium bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-full flex items-center gap-1" title={src.connectedOn ? `Connected: ${src.connectedOn}` : undefined}>
                    {src.platform === 'linkedin' && <Linkedin className="w-2.5 h-2.5" />}
                    {src.platform === 'facebook' && <Facebook className="w-2.5 h-2.5" />}
                    {!['linkedin', 'facebook'].includes(src.platform) && <ExternalLink className="w-2.5 h-2.5" />}
                    via {src.platform}
                    {src.connectedOn && <span className="opacity-60 ml-1">· {src.connectedOn}</span>}
                  </span>
                ))}
              </div>
            )}
            
            {/* Local Context — Timezone & Weather */}
            {contact.lat && contact.lng && (
              <div className="mt-3">
                <LocalContext lat={contact.lat} lng={contact.lng} />
              </div>
            )}
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          
          {/* Left Column: Facts & AI */}
          <div className="lg:col-span-4 space-y-6">
            <div className={cn(CARD, "space-y-4")}>
              <h3 className={cn(SECTION_HEADING, "pb-2 mb-4")}>Details</h3>
              
              <div className="flex items-start gap-4 group">
                <MapPin className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className={LABEL}>Location</span>
                  <EditableField value={contact.location} onSave={(val) => handleUpdate('location', val)} placeholder="Add Location..." className="text-sm font-medium" />
                </div>
              </div>

              <div className="flex items-start gap-4 group">
                <Mail className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <span className={LABEL}>Email</span>
                  {primaryEmail ? (
                    <span className="text-sm font-medium text-on-surface">{primaryEmail}</span>
                  ) : (
                    <span className="text-sm font-medium text-on-surface-variant opacity-50 italic">Add Email...</span>
                  )}
                  {additionalEmails.map((e) => (
                    <div key={e.id} className="text-sm text-on-surface-variant truncate flex items-center gap-1">
                      <span className="opacity-50 mr-1 select-none">↳</span>
                      {e.email}
                      {e.label && <span className={MICRO_BADGE}>{e.label}</span>}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-4 group">
                <Phone className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <span className={LABEL}>Phone</span>
                  {primaryPhone ? (
                    <span className="text-sm font-medium text-on-surface">{primaryPhone}</span>
                  ) : (
                    <span className="text-sm font-medium text-on-surface-variant opacity-50 italic">Add Phone...</span>
                  )}
                  {additionalPhones.map((p) => (
                    <div key={p.id} className="text-sm text-on-surface-variant truncate flex items-center gap-1">
                      <span className="opacity-50 mr-1 select-none">↳</span>
                      {p.phone}
                      {p.label && <span className={MICRO_BADGE}>{p.label}</span>}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-4 group">
                <Cake className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className={LABEL}>Birthday</span>
                  <EditableField value={contact.birthday} onSave={(val) => handleUpdate('birthday', val)} placeholder="Add Birthday..." className="text-sm font-medium" />
                </div>
              </div>

              {/* Industry */}
              {contact.industry && (
                <div className="flex items-start gap-4 group">
                  <Globe className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0 flex flex-col">
                    <span className={LABEL}>Industry</span>
                    <EditableField value={contact.industry} onSave={(val) => handleUpdate('industry', val)} placeholder="Add Industry..." className="text-sm font-medium" />
                  </div>
                </div>
              )}

              <div className="flex items-start gap-4 group">
                <Coffee className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className={LABEL}>Preferences</span>
                  <EditableField value={contact.preferences} onSave={(val) => handleUpdate('preferences', val)} placeholder="Coffee, Meeting style..." className="text-sm font-medium" />
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

            {/* AI Insights Block */}
            <div className={CARD_TINTED}>
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <h3 className={cn(SECTION_HEADING, "text-on-primary-container")}>AI Intel</h3>
                </div>
                {!insight && (
                  <button 
                    onClick={handleGenerateInsight}
                    disabled={generatingInsight || timeline.length === 0}
                    className={cn(LABEL_PRIMARY, "hover:underline disabled:opacity-50")}
                  >
                    {generatingInsight ? "Thinking..." : "Generate"}
                  </button>
                )}
              </div>
              
              <AnimatePresence mode="wait">
                {insight ? (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                    <div>
                      <p className={LABEL_PRIMARY}>Next Follow Up</p>
                      <p className="text-lg font-bold text-on-surface">{insight.nextRecommendedContact}</p>
                    </div>
                    <div>
                       <p className={LABEL_PRIMARY}>Health</p>
                       <p className="text-sm font-medium text-on-surface mb-1">{insight.summarySentiment}</p>
                       <p className="text-xs text-on-surface-variant leading-relaxed">{insight.sentimentDescription}</p>
                    </div>
                  </motion.div>
                ) : (
                  <p className="text-xs text-on-surface-variant/70 italic leading-relaxed">
                    Generate an AI briefing based on your timeline of interactions to summarize client health.
                  </p>
                )}
              </AnimatePresence>
            </div>

            {/* Danger Zone */}
            <button onClick={handleDeleteContact} className={DANGER_BTN}>
              <Trash2 className="w-3.5 h-3.5" /> Delete Contact
            </button>
          </div>

          {/* Right Column: Timeline & Composer & Backgrounds */}
          <div {...getRootProps()} className="lg:col-span-8 relative min-h-[500px] flex flex-col gap-6">
            <input {...getInputProps()} />
            
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

            <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-surface-container-high before:to-transparent">
              {timelineLoading && <div className="text-center p-4 text-on-surface-variant animate-pulse">Loading timeline...</div>}
              {!timelineLoading && timeline.length === 0 && (
                <div className={EMPTY_STATE}>
                  <p className="font-medium text-sm">No interactions logged yet.</p>
                  <p className="text-xs mt-1">Use the composer above to log your first note, call, or meeting.</p>
                </div>
              )}
              
              {timeline.map((item) => {
                let Icon = FileText;
                let bgClass = "bg-surface-container";
                let textClass = "text-on-surface";
                
                if (item.type === 'call') { Icon = Phone; bgClass = "bg-blue-500/10"; textClass = "text-blue-500"; }
                if (item.type === 'meeting') { Icon = Handshake; bgClass = "bg-purple-500/10"; textClass = "text-purple-500"; }
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
                      {item.content && (
                        <div 
                          className="prose prose-sm max-w-none text-on-surface-variant leading-relaxed prose-p:my-1 prose-headings:my-2 prose-headings:text-on-surface prose-strong:text-on-surface"
                          dangerouslySetInnerHTML={{ __html: item.content }} 
                        />
                      )}
                      
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
          </div>
        </div>
      </div>
    </div>
  );
};
