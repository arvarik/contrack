/**
 * ProfileHeader — Contact identity header with avatar, name, social links,
 * tags, vibe picker, archive toggles, and the "Catch Me Up" AI briefing.
 *
 * Extracted from ContactProfile to keep each section under ~250 lines.
 */
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Briefcase, ArrowLeft, Sparkles, Archive, Tag, X, ArrowUpRight,
  CalendarClock
} from "lucide-react";
import { formatDistanceToNow, isPast, isToday } from "date-fns";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";

import type { Contact } from "../../../types";
import { cn } from "../../../lib/utils";
import {
  LABEL, CARD_TINTED, TAG_PILL, SECTION_HEADING_SPACED,
} from "../../../lib/styles";
import { parseBriefingPoints } from "../../../lib/safeParse";
import { SkeletonText } from "../../../components/ui/AnimatedSkeleton";
import { LocalTimeWeather } from "../../../components/LocalTimeWeather";

import { EditableField } from "./EditableField";
import { PlatformIcon } from "./PlatformIcon";
import { VibePickerPopover, VIBE_COLORS } from "./VibePickerPopover";
import { ContactActionsMenu } from "./ContactActionsMenu";
import { ContactListsSection } from "./ContactListsSection";

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

export interface ProfileHeaderProps {
  contact: Contact;
  onUpdate: (field: string, val: string) => void;
  onDelete: () => void;
  onClose?: () => void;
  onOpenAvatarPicker: () => void;
  showNetworkButton?: boolean;

  // Mutations passed from parent
  generateBriefing: { mutate: (id: string) => void; isPending: boolean };
  archiveContact: { mutate: (id: string, opts?: any) => void; isPending: boolean };
  unarchiveContact: { mutate: (id: string, opts?: any) => void; isPending: boolean };
  updateContact: { mutate: (args: { id: string; data: any }) => void };
  promoteGhost: { mutate: (id: string, opts?: any) => void; isPending: boolean };
}

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

export const ProfileHeader: React.FC<ProfileHeaderProps> = ({
  contact,
  onUpdate,
  onDelete,
  onClose,
  onOpenAvatarPicker,
  showNetworkButton = false,
  generateBriefing,
  archiveContact,
  unarchiveContact,
  updateContact,
  promoteGhost,
}) => {
  const navigate = useNavigate();
  const [showVibePicker, setShowVibePicker] = useState(false);

  const isBriefingValid = React.useMemo(() => {
    if (!contact.aiBriefing || !contact.aiBriefingAt) return false;
    const diff = Date.now() - new Date(contact.aiBriefingAt).getTime();
    return diff < 3 * 24 * 60 * 60 * 1000; // 3 days
  }, [contact.aiBriefing, contact.aiBriefingAt]);

  const clearBriefing = React.useCallback(() => {
    updateContact.mutate({ id: contact.id, data: { aiBriefing: null, aiBriefingAt: null } as any });
  }, [contact.id, updateContact]);

  const handleVibeSelect = (vibeId: string) => {
    updateContact.mutate({ id: contact.id, data: { themeColor: vibeId } });
    setShowVibePicker(false);
  };

  return (
    <>
      {/* Mobile Back Button */}
      {onClose && (
        <div className="sticky top-0 z-30 glass-panel px-4 py-3 lg:hidden flex items-center shrink-0">
          <button onClick={onClose} className="flex items-center gap-2 text-primary font-bold px-3 py-1.5 -ml-3 rounded-xl hover:bg-primary/10 active:bg-primary/15 transition-colors">
            <ArrowLeft className="w-5 h-5" /> Back
          </button>
        </div>
      )}

      {/* URGENCY BANNER */}
      {contact.nextFollowUpAt && (isPast(new Date(contact.nextFollowUpAt)) || isToday(new Date(contact.nextFollowUpAt))) && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full bg-error/10 border-b border-error/20 px-6 py-3 flex items-center justify-center gap-2 shadow-sm"
        >
          <CalendarClock className="w-4 h-4 text-error shrink-0" />
          <span className="text-sm font-bold text-error truncate">
            Pending Follow-Up Alert
          </span>
        </motion.div>
      )}

      <div className="p-6 md:p-8 lg:px-10 lg:pt-8 lg:pb-6 max-w-6xl mx-auto w-full relative lg:shrink-0">
        <section className="flex flex-col md:flex-row items-start md:items-center gap-6">
          {/* Avatar */}
          <div className="relative shrink-0 group/avatar">
            <div className="w-24 h-24 md:w-32 md:h-32 rounded-3xl overflow-hidden bg-surface-container-highest ring-1 ring-surface-container-highest shadow-xl">
              <img
                alt={contact.name}
                className="w-full h-full object-cover"
                src={contact.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(contact.name)}&mouth=default,smile,serious`}
              />
            </div>
            <button
              onClick={onOpenAvatarPicker}
              title="Edit Avatar"
              className="absolute inset-0 rounded-3xl bg-black/40 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity cursor-pointer z-10"
            >
              <div className="bg-white/20 backdrop-blur-sm rounded-full p-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                </svg>
              </div>
            </button>
            {!!contact.isArchived && (
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-amber-500/90 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full shadow-sm whitespace-nowrap z-20">
                <Archive className="w-2.5 h-2.5" />
                Archived
              </div>
            )}
            {contact.isGhost ? (
              <div className="absolute -top-3 -right-3 flex items-center justify-center w-8 h-8 rounded-full bg-surface-container-highest border-2 border-surface-container-lowest shadow-sm z-20 group/ghosticon cursor-help">
                <Sparkles className="w-4 h-4 text-primary opacity-80 group-hover/ghosticon:opacity-100 transition-opacity" />
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 bg-surface text-on-surface text-xs font-medium p-2.5 rounded-xl shadow-lg border border-surface-container opacity-0 pointer-events-none group-hover/ghosticon:opacity-100 transition-all z-50 text-center leading-relaxed">
                  <strong className="block text-primary mb-0.5">Ghost Profile</strong>
                  Created automatically from a mention. Waiting to be populated.
                </div>
              </div>
            ) : null}
          </div>

          {/* Identity */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <div className="text-4xl md:text-5xl font-extrabold font-headline tracking-tight text-on-surface flex flex-wrap items-center gap-x-2 gap-y-1 pb-2 pt-1">
                <EditableField value={contact.name} onSave={(val) => onUpdate('name', val)} placeholder="Contact Name" />
                {contact.pronouns && <span className="opacity-40 text-2xl font-medium tracking-normal inline-block align-middle pb-1">({contact.pronouns})</span>}
              </div>
              
              <VibePickerPopover
                showVibePicker={showVibePicker}
                setShowVibePicker={setShowVibePicker}
                currentVibeId={contact.themeColor}
                onSelect={handleVibeSelect}
              />

              {!!contact.isGhost && (
                <button
                  onClick={() => {
                    promoteGhost.mutate(contact.id, {
                      onSuccess: () => toast.success(`${contact.name} promoted to network!`)
                    });
                  }}
                  disabled={promoteGhost.isPending}
                  className="px-3 py-1.5 rounded-xl bg-primary text-white font-bold text-xs shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all flex items-center gap-1.5 ml-2"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {promoteGhost.isPending ? 'Promoting...' : 'Promote to Contact'}
                </button>
              )}

              <button
                onClick={() => {
                  if (contact.isArchived) {
                    unarchiveContact.mutate(contact.id, {
                      onSuccess: () => toast.success(`${contact.name} restored to network`),
                      onError: (err: Error) => toast.error(`Failed: ${err.message}`),
                    });
                  } else {
                    archiveContact.mutate(contact.id, {
                      onSuccess: () => toast.success(`${contact.name} archived`),
                      onError: (err: Error) => toast.error(`Failed: ${err.message}`),
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
              
              <ContactActionsMenu contact={contact} onDelete={onDelete} />
            </div>

            {contact.headline && (
              <div className="text-base text-on-surface-variant font-medium mb-1 italic opacity-70">
                {contact.headline}
              </div>
            )}

            {contact.aiSummary && (
              <div className="flex items-start gap-2 bg-primary/10 rounded-xl p-3 mb-3 border border-primary/20 max-w-fit">
                <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div className="text-sm text-primary font-medium leading-relaxed italic">
                  {contact.aiSummary}
                </div>
              </div>
            )}

            <div className="text-lg md:text-xl font-medium text-on-surface-variant flex items-center flex-wrap gap-x-2 mb-2">
              <Briefcase className="w-5 h-5 opacity-50 inline-block" />
              <EditableField value={contact.role} onSave={(val) => onUpdate('role', val)} placeholder="Role / Title" />
              <span className="opacity-50">at</span>
              <EditableField value={contact.company} onSave={(val) => onUpdate('company', val)} placeholder="Company" />
              <ContactListsSection contactId={contact.id} contactLists={contact.lists || []} />
            </div>

            {/* Social Links */}
            {((contact.lat && contact.lng) || (contact.socialLinks && contact.socialLinks.length > 0)) && (
              <div className="flex flex-wrap items-center gap-2 mt-4 mb-2">
                {contact.lat && contact.lng && (
                  <LocalTimeWeather lat={contact.lat} lng={contact.lng} />
                )}
                {contact.socialLinks?.map((sl) => {
                  let displayName = sl.handle || sl.platform;
                  try { displayName = sl.handle || new URL(sl.url).hostname.replace('www.', ''); } catch {}
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
                {contact.tags.map((t) => (
                  <span key={t.id} className={cn(TAG_PILL, "flex items-center gap-1")}>
                    <Tag className="w-2.5 h-2.5" /> {t.tag}
                  </span>
                ))}
              </div>
            )}

            {/* Actions Row */}
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
                    if (onClose) onClose();
                    navigate(`/contact/${contact.id}`);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-xl font-bold hover:bg-primary/20 transition-colors text-sm"
                >
                  <ArrowUpRight className="w-4 h-4" />
                  Open in Network
                </button>
              )}
              
              {/* Briefing Display */}
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
                        {parseBriefingPoints(contact.aiBriefing!).map((point: string, idx: number) => (
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
    </>
  );
};
