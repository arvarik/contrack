import React, { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Briefcase, MapPin, Mail, Phone, Cake, Globe, Coffee, Heart, Tag,
  Sparkles, Trash2, MessageSquare, ExternalLink, Linkedin, Facebook,
  FileText, File, Handshake, Edit2, ArrowUpRight
} from 'lucide-react';
import { useContact, useTimeline, useUpdateContact, useGenerateBriefing, useDeleteInteraction, useUpdateInteraction } from '../api';
import { parseBriefingPoints } from '../utils/safeParse';
import { cn } from '../lib/utils';
import { CARD, SECTION_HEADING, SECTION_HEADING_SPACED, LABEL, TAG_PILL, CARD_TINTED, STATUS_BADGE_SUCCESS } from '../lib/styles';
import { VIBE_COLORS } from './ContactDetail/VibePickerPopover';
import { LocalContext } from './LocalContext';
import { PlatformIcon } from './ContactDetail/PlatformIcon';
import ReactMarkdown from 'react-markdown';
import DOMPurify from 'dompurify';
import { formatDistanceToNow } from 'date-fns';
import { SkeletonText } from './AnimatedSkeleton';
import { toast } from 'sonner';

// =============================================================================
// FloatingContactCard — Shared overlay for Ask Contrack & Archived Contacts
// =============================================================================
// Opens a detailed contact card in a centered floating overlay.
// Click outside or Escape to dismiss. Renders contact data directly
// (no nested Router) so the host view's URL and state are preserved.
// =============================================================================

interface FloatingContactCardProps {
  contactId: string | null;
  isOpen: boolean;
  onClose: () => void;
  /** If true, shows a "Open in Network" button next to Catch Me Up */
  showNetworkButton?: boolean;
}

export const FloatingContactCard: React.FC<FloatingContactCardProps> = ({
  contactId,
  isOpen,
  onClose,
  showNetworkButton = false,
}) => {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  return (
    <AnimatePresence>
      {isOpen && contactId && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: 'spring', damping: 28, stiffness: 380, mass: 0.8 }}
            className="fixed inset-4 md:inset-8 lg:inset-12 xl:inset-x-[10%] xl:inset-y-8 z-[101] flex flex-col overflow-hidden rounded-3xl bg-surface shadow-2xl ring-1 ring-surface-container-highest/50"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-50 p-2 bg-surface-container-low hover:bg-surface-container-high rounded-full transition-colors shadow-sm"
              title="Close"
            >
              <X className="w-5 h-5 text-on-surface-variant" />
            </button>

            <div className="flex-1 min-h-0 overflow-hidden">
              <FloatingContactContent contactId={contactId} showNetworkButton={showNetworkButton} onClose={onClose} />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

// =============================================================================
// FloatingContactContent — Full faithfully-synced CDP for the floating card
// =============================================================================

const FloatingContactContent: React.FC<{
  contactId: string;
  showNetworkButton: boolean;
  onClose: () => void;
}> = ({ contactId, showNetworkButton, onClose }) => {
  const navigate = useNavigate();
  const { data: contact, isLoading } = useContact(contactId);
  const { data: timeline = [], isLoading: timelineLoading } = useTimeline(contactId);
  const generateBriefing = useGenerateBriefing();
  const updateContact = useUpdateContact();
  const deleteInteraction = useDeleteInteraction();
  const updateInteraction = useUpdateInteraction();

  const [activeTab, setActiveTab] = useState<'timeline' | 'dossier'>('timeline');
  const [isEditingDossier, setIsEditingDossier] = useState(false);
  const [dossierText, setDossierText] = useState('');
  const [editingInteractionId, setEditingInteractionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingContent, setEditingContent] = useState('');

  const isBriefingValid = React.useMemo(() => {
    if (!contact?.aiBriefing || !contact?.aiBriefingAt) return false;
    const diff = new Date().getTime() - new Date(contact.aiBriefingAt).getTime();
    return diff < 3 * 24 * 60 * 60 * 1000;
  }, [contact?.aiBriefing, contact?.aiBriefingAt]);

  const clearBriefing = React.useCallback(() => {
    if (!contact) return;
    updateContact.mutate({ id: contact.id, data: { aiBriefing: null, aiBriefingAt: null } as any });
  }, [contact, updateContact]);

  const handleDeleteInteraction = (interactionId: string) => {
    deleteInteraction.mutate(
      { id: interactionId, contactId },
      {
        onSuccess: () => toast.success("Interaction deleted"),
        onError: (err) => toast.error(`Delete failed: ${err.message}`),
      }
    );
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-full text-primary animate-pulse font-headline text-lg">
      Loading...
    </div>
  );
  if (!contact) return <div className="p-12 text-center text-on-surface-variant">Contact not found.</div>;

  const currentTheme = VIBE_COLORS.find(v => v.id === contact.themeColor) || VIBE_COLORS[0];
  const themeStyles = {
    '--color-primary': currentTheme.primary,
    '--color-primary-dim': currentTheme.dim,
    '--color-primary-container': currentTheme.container,
  } as React.CSSProperties;

  return (
    <div className="h-full flex flex-col overflow-hidden" style={themeStyles}>
      <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden lg:flex lg:flex-col scrollbar-hide">

        {/* ── Header Section (shrink-0 on desktop) ─────────────────────── */}
        <div className="p-6 md:p-8 lg:px-10 lg:pt-8 lg:pb-6 max-w-6xl mx-auto w-full relative lg:shrink-0">
          <section className="flex flex-col md:flex-row items-start gap-6 md:gap-8">
            {/* Avatar */}
            <div className="shrink-0">
              <div className="w-20 h-20 md:w-28 md:h-28 rounded-3xl overflow-hidden bg-surface-container-highest ring-1 ring-surface-container-highest shadow-xl">
                <img
                  alt={contact.name}
                  className="w-full h-full object-cover"
                  src={contact.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(contact.name)}&mouth=default,smile,serious`}
                />
              </div>
            </div>

            {/* Info Column */}
            <div className="flex-1 min-w-0">
              <h2 className="text-3xl md:text-4xl font-extrabold font-headline tracking-tight text-on-surface">
                {contact.name}
                {contact.pronouns && <span className="opacity-40 text-xl font-medium tracking-normal ml-2">({contact.pronouns})</span>}
              </h2>

              {contact.headline && (
                <p className="text-base text-on-surface-variant font-medium mt-1 italic opacity-70">{contact.headline}</p>
              )}

              {contact.aiSummary && (
                <div className="flex items-start gap-2 bg-primary/10 rounded-xl p-3 mt-2 max-w-fit">
                  <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <span className="text-sm text-primary font-medium leading-relaxed italic">{contact.aiSummary}</span>
                </div>
              )}

              <div className="text-lg md:text-xl font-medium text-on-surface-variant flex items-center flex-wrap gap-x-2 mt-2">
                <Briefcase className="w-5 h-5 opacity-50" />
                <span>{contact.role || 'No role'}</span>
                <span className="opacity-50">at</span>
                <span>{contact.company || 'No company'}</span>
              </div>

              {/* Context & Links Row — synced with CDP */}
              {((contact.lat && contact.lng) || (contact.socialLinks && contact.socialLinks.length > 0)) && (
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {contact.lat && contact.lng && (
                    <LocalContext lat={contact.lat} lng={contact.lng} />
                  )}
                  {contact.socialLinks?.map((sl) => {
                    let displayName = sl.handle || sl.platform;
                    try { displayName = sl.handle || new URL(sl.url).hostname.replace('www.', ''); } catch(e){}
                    return (
                      <a key={sl.id} href={sl.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-sm font-bold text-on-surface-variant bg-surface-container hover:bg-surface-container-high px-3 py-1.5 rounded-xl shadow-sm transition-colors">
                        <PlatformIcon platform={sl.platform} className="w-4 h-4" />
                        <span>{displayName}</span>
                      </a>
                    );
                  })}
                </div>
              )}

              {/* Tags */}
              {contact.tags && contact.tags.length > 0 && (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {contact.tags.map(t => (
                    <span key={t.id} className={cn(TAG_PILL, "flex items-center gap-1")}>
                      <Tag className="w-2.5 h-2.5" /> {t.tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Catch Me Up + Open in Network */}
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => generateBriefing.mutate(contact.id)}
                  disabled={generateBriefing.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-xl font-bold hover:opacity-90 transition-opacity text-sm shadow-sm"
                >
                  🪄 {generateBriefing.isPending ? 'Generating...' : 'Catch Me Up'}
                </button>

                {showNetworkButton && (
                  <button
                    onClick={() => {
                      onClose();
                      navigate(`/contact/${contact.id}`);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-xl font-bold hover:bg-primary/20 transition-colors text-sm"
                  >
                    <ArrowUpRight className="w-4 h-4" />
                    Open in Network
                  </button>
                )}

                <AnimatePresence>
                  {isBriefingValid && !generateBriefing.isPending && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden mt-3 w-full"
                    >
                      <div className={cn(CARD_TINTED, "text-sm text-on-surface relative")}>
                        <button onClick={clearBriefing} className="absolute top-4 right-4 p-1 rounded-full hover:bg-surface-container-highest transition-colors opacity-50 hover:opacity-100" title="Dismiss Briefing">
                          <X className="w-4 h-4 text-on-surface" />
                        </button>
                        <h4 className="text-xs font-bold uppercase tracking-widest text-primary mb-3 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5"/> Executive Briefing</h4>
                        <ul className="space-y-2.5 pr-6">
                          {parseBriefingPoints(contact.aiBriefing).map((point: string, idx: number) => (
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
                      className="overflow-hidden mt-3 w-full"
                    >
                      <div className={cn(CARD_TINTED, "text-sm space-y-4")}>
                        <h4 className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5"/> Synthesizing Context...</h4>
                        <SkeletonText lines={3} className="h-4" />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </section>
        </div>

        {/* ── Two-column Grid (flex-1 on desktop) ─────────────────────── */}
        <div className="lg:flex-1 lg:min-h-0 max-w-6xl mx-auto w-full px-6 md:px-8 lg:px-10">
          <div className="grid grid-cols-1 lg:grid-cols-24 gap-6 lg:gap-8 items-start lg:h-full pb-12 lg:pb-0">

            {/* Left Column: Details */}
            <div className="lg:col-span-9 space-y-6 lg:overflow-y-auto lg:h-full lg:pb-8 scrollbar-hide">
              <div className={cn(CARD, "space-y-4")}>
                <h3 className={cn(SECTION_HEADING, "pb-2 mb-4")}>Details</h3>

                {contact.location && (
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-primary mt-1 shrink-0" />
                    <div>
                      <span className={LABEL}>Location</span>
                      <p className="text-sm text-on-surface mt-0.5">{contact.location}</p>
                    </div>
                  </div>
                )}

                {contact.emails && contact.emails.length > 0 && (
                  <div className="flex items-start gap-3">
                    <Mail className="w-4 h-4 text-primary mt-1 shrink-0" />
                    <div>
                      <span className={LABEL}>Email</span>
                      {contact.emails.map(e => (
                        <p key={e.id} className="text-sm text-on-surface mt-0.5 break-all">{e.email}</p>
                      ))}
                    </div>
                  </div>
                )}

                {contact.phones && contact.phones.length > 0 && (
                  <div className="flex items-start gap-3">
                    <Phone className="w-4 h-4 text-primary mt-1 shrink-0" />
                    <div>
                      <span className={LABEL}>Phone</span>
                      {contact.phones.map(p => (
                        <p key={p.id} className="text-sm text-on-surface mt-0.5">{p.phone}</p>
                      ))}
                    </div>
                  </div>
                )}

                {contact.birthday && (
                  <div className="flex items-start gap-3">
                    <Cake className="w-4 h-4 text-primary mt-1 shrink-0" />
                    <div>
                      <span className={LABEL}>Birthday</span>
                      <p className="text-sm text-on-surface mt-0.5">{contact.birthday}</p>
                    </div>
                  </div>
                )}

                {contact.industry && (
                  <div className="flex items-start gap-3">
                    <Globe className="w-4 h-4 text-primary mt-1 shrink-0" />
                    <div>
                      <span className={LABEL}>Industry</span>
                      <p className="text-sm text-on-surface mt-0.5">{contact.industry}</p>
                    </div>
                  </div>
                )}

                {contact.preferences && (
                  <div className="flex items-start gap-3">
                    <Coffee className="w-4 h-4 text-primary mt-1 shrink-0" />
                    <div>
                      <span className={LABEL}>Preferences</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {contact.preferences.split(',').map((s: string) => s.trim()).filter(Boolean).map((pref: string, idx: number) => (
                          <span key={idx} className="text-xs font-bold py-1 px-2.5 rounded-full bg-surface-container text-on-surface-variant">{pref}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {contact.interests && contact.interests.length > 0 && (
                  <div className="flex items-start gap-3">
                    <Heart className="w-4 h-4 text-primary mt-1 shrink-0" />
                    <div>
                      <span className={LABEL}>Interests</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {contact.interests.map((interest: any) => (
                          <span key={interest.id} className={cn(
                            "text-xs font-bold py-1 px-2.5 rounded-full",
                            interest.isAiGenerated ? "bg-primary/10 text-primary" : "bg-surface-container text-on-surface-variant"
                          )}>
                            {!!interest.isAiGenerated && <Sparkles className="w-3 h-3 opacity-70 inline mr-1" />}
                            {interest.interest}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Timeline & Dossier */}
            <div className="lg:col-span-15 flex flex-col gap-6 lg:overflow-y-auto lg:h-full lg:pb-8 scrollbar-hide">

              {/* Tab Controller */}
              <div className="flex items-center gap-2 p-1.5 bg-surface-container-low rounded-xl shadow-sm relative z-20 w-fit">
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

              {activeTab === 'timeline' && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6">

                  {!timelineLoading && timeline.length === 0 && (
                    <div className="text-center p-6 bg-surface-container-low rounded-2xl text-on-surface-variant text-sm">
                      No interactions logged yet.
                    </div>
                  )}

                  {timelineLoading && <div className="text-center p-4 text-on-surface-variant animate-pulse text-sm">Loading timeline...</div>}

                  {/* Timeline visualization — synced with CDP */}
                  <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-surface-container-high before:to-transparent">
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
                              {editingInteractionId === item.id ? (
                                <input
                                  value={editingTitle}
                                  onChange={e => setEditingTitle(e.target.value)}
                                  onBlur={() => {
                                    if (editingTitle.trim() && editingTitle !== item.title) {
                                      updateInteraction.mutate({ id: item.id, contactId, data: { title: editingTitle.trim(), content: editingContent } });
                                    }
                                    setEditingInteractionId(null);
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                    if (e.key === 'Escape') setEditingInteractionId(null);
                                  }}
                                  autoFocus
                                  className="font-extrabold text-on-surface bg-transparent border-b-2 border-primary focus:outline-none flex-1 mr-2"
                                />
                              ) : (
                                <h4
                                  className="font-extrabold text-on-surface cursor-text"
                                  onDoubleClick={() => {
                                    setEditingInteractionId(item.id);
                                    setEditingTitle(item.title);
                                    setEditingContent(item.content || '');
                                  }}
                                  title="Double-click to edit"
                                >
                                  {item.title}
                                </h4>
                              )}
                              <div className="flex items-center gap-2 shrink-0">
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
                              <div className="mb-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container border border-surface-container-highest/20 opacity-70 hover:opacity-100 transition-opacity text-[11px] uppercase tracking-wide text-on-surface-variant font-bold">
                                <ExternalLink className="w-3 h-3 text-primary" /> via {item.isViaName}
                              </div>
                            )}

                            {editingInteractionId === item.id ? (
                              <textarea
                                value={editingContent}
                                onChange={e => setEditingContent(e.target.value)}
                                onBlur={() => {
                                  updateInteraction.mutate({ id: item.id, contactId, data: { title: editingTitle.trim() || item.title, content: editingContent } });
                                  setEditingInteractionId(null);
                                }}
                                onKeyDown={e => {
                                  if (e.key === 'Escape') setEditingInteractionId(null);
                                }}
                                className="w-full min-h-[60px] p-2 bg-surface-container-low rounded-lg border border-surface-container-highest focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm text-on-surface-variant resize-y"
                                placeholder="Add content..."
                              />
                            ) : item.content ? (
                              <div
                                className="prose prose-sm max-w-none text-on-surface-variant leading-relaxed prose-p:my-1 prose-headings:my-2 prose-headings:text-on-surface prose-strong:text-on-surface cursor-text"
                                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(item.content) }}
                                onDoubleClick={() => {
                                  setEditingInteractionId(item.id);
                                  setEditingTitle(item.title);
                                  setEditingContent(item.content || '');
                                }}
                                title="Double-click to edit"
                              />
                            ) : null}

                            {/* Mentions */}
                            {item.mentions && (() => {
                              try {
                                const parsed = JSON.parse(item.mentions);
                                if (!Array.isArray(parsed) || parsed.length === 0) return null;
                                return (
                                  <div className="mt-4 pt-3 flex flex-wrap gap-2 items-center">
                                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mr-2 flex items-center gap-1"><Sparkles className="w-3 h-3 text-primary opacity-60"/> Mentioned:</span>
                                    {parsed.map((mention: any, idx: number) => (
                                      <span key={idx} className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-surface-container-lowest shadow-sm text-xs font-semibold text-on-surface">
                                        <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
                                          {mention.name?.charAt(0)}
                                        </div>
                                        {mention.name}
                                      </span>
                                    ))}
                                  </div>
                                );
                              } catch(e) { return null; }
                            })()}

                            {/* File attachments */}
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

              {activeTab === 'dossier' && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6">
                  {/* AI Dossier */}
                  {(contact.aiBackground || isEditingDossier) && (
                    <div className={cn(CARD, "bg-surface-container-lowest relative overflow-hidden group")}>
                      <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
                      <div className="flex justify-between items-center mb-4">
                        <h3 className={cn(SECTION_HEADING_SPACED, "text-primary flex items-center gap-2")}><Sparkles className="w-4 h-4" /> AI Dossier</h3>
                        {!isEditingDossier && (
                          <button onClick={() => { setDossierText(contact.aiBackground || ''); setIsEditingDossier(true); }} className="opacity-0 group-hover:opacity-100 text-on-surface-variant hover:text-primary transition-opacity p-1 bg-surface-container-low rounded-md shadow-sm">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {isEditingDossier ? (
                        <div className="flex flex-col gap-3">
                          <textarea
                            value={dossierText}
                            onChange={e => setDossierText(e.target.value)}
                            className="w-full min-h-[300px] p-4 bg-surface-container-low rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm font-mono text-on-surface resize-y"
                            autoFocus
                          />
                          <div className="flex justify-end gap-2 mt-1">
                            <button onClick={() => setIsEditingDossier(false)} className="px-4 py-1.5 rounded-full text-xs font-bold text-on-surface-variant hover:bg-surface-container transition-colors">Cancel</button>
                            <button onClick={() => { updateContact.mutate({ id: contactId, data: { aiBackground: dossierText } as any }); setIsEditingDossier(false); }} className="px-4 py-1.5 rounded-full text-xs font-bold bg-primary text-on-primary shadow shadow-primary/20 hover:shadow-md hover:shadow-primary/30 transition-all">Save Dossier</button>
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

                  {/* AI Attributes */}
                  {contact.attributes && contact.attributes.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {contact.attributes.map((attr: any) => (
                        <div key={attr.id} className="bg-surface-container-lowest rounded-xl p-4 shadow-sm">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-primary block mb-1">{attr.name}</span>
                          <span className="text-sm text-on-surface leading-relaxed font-medium block">{attr.value}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* About */}
                  {contact.about && (
                    <div className={cn(CARD, "relative overflow-hidden group")}>
                      <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
                      <h3 className={SECTION_HEADING_SPACED}><Sparkles className="w-4 h-4 text-primary" /> About</h3>
                      <p className="whitespace-pre-wrap text-on-surface-variant text-sm leading-relaxed">{contact.about}</p>
                    </div>
                  )}

                  {/* Experience */}
                  {contact.experience && contact.experience.length > 0 && (
                    <div className="bg-surface-container-lowest rounded-2xl shadow-sm p-6">
                      <h3 className={cn(SECTION_HEADING_SPACED, "mb-5")}><Briefcase className="w-4 h-4" /> Experience Overview</h3>
                      <div className="space-y-5">
                        {contact.experience.map(exp => (
                          <div key={exp.id} className="flex gap-4">
                            <div className="icon-container">
                              <Briefcase className="w-4 h-4 text-primary" />
                            </div>
                            <div>
                              <p className="font-bold text-on-surface flex items-center gap-2">
                                {exp.role}
                                {exp.isCurrent && <span className={STATUS_BADGE_SUCCESS}>Current</span>}
                              </p>
                              <p className="text-sm text-primary font-bold">{exp.company}</p>
                              <p className="text-xs text-on-surface-variant mb-1 font-medium">
                                {exp.startDate}{exp.endDate ? ` — ${exp.endDate}` : exp.isCurrent ? ' — Present' : ''}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Education */}
                  {contact.education && contact.education.length > 0 && (
                    <div className="bg-surface-container-lowest rounded-2xl shadow-sm p-6">
                      <h3 className={cn(SECTION_HEADING_SPACED, "mb-5")}><FileText className="w-4 h-4" /> Education</h3>
                      <div className="space-y-5">
                        {contact.education.map(edu => (
                          <div key={edu.id} className="flex gap-4">
                            <div className="icon-container">
                              <FileText className="w-4 h-4 text-primary" />
                            </div>
                            <div>
                              <p className="font-bold text-on-surface">{edu.school}</p>
                              <p className="text-sm text-on-surface-variant">{edu.degree}{edu.fieldOfStudy ? ` · ${edu.fieldOfStudy}` : ''}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!contact.aiBackground && !contact.about && (!contact.experience || contact.experience.length === 0) && (!contact.education || contact.education.length === 0) && (!contact.attributes || contact.attributes.length === 0) && (
                    <div className="text-center p-6 bg-surface-container-low rounded-2xl text-on-surface-variant text-sm">
                      No dossier data available.
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
