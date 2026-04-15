/**
 * ProfileHeader — Contact identity header with avatar, name, social links,
 * tags, vibe picker, archive toggles, and the "Catch Me Up" AI briefing.
 *
 * Extracted from ContactProfile to keep each section under ~250 lines.
 */
import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Briefcase, ArrowLeft, Sparkles, Archive, X, ArrowUpRight,
  CalendarClock, MoreVertical, Copy, Trash2
} from "lucide-react";
import { formatDistanceToNow, isPast, isToday } from "date-fns";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";

import type { Contact, ContactUpdateData } from "../../../types";
import { cn } from "../../../lib/utils";
import {
  LABEL, CARD_TINTED, SECTION_HEADING_SPACED,
} from "../../../lib/styles";
import { LocalTimeWeather } from "../../../components/LocalTimeWeather";

import { EditableField } from "./EditableField";
import { PlatformIcon, PLATFORM_COLORS, hasKnownIcon } from "./PlatformIcon";
import { VibePickerPopover, VIBE_COLORS } from "./VibePickerPopover";
import { ContactActionsMenu } from "./ContactActionsMenu";
import { ContactListsSection } from "./ContactListsSection";
import { CatchMeUpFab } from "./CatchMeUpFab";
import { fallbackAvatarUrl } from '../../../lib/avatar';

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
  archiveContact: { mutate: (id: string, opts?: { onSuccess?: () => void; onError?: (err: Error) => void }) => void; isPending: boolean };
  unarchiveContact: { mutate: (id: string, opts?: { onSuccess?: () => void; onError?: (err: Error) => void }) => void; isPending: boolean };
  updateContact: { mutate: (args: { id: string; data: ContactUpdateData }) => void };
  promoteGhost: { mutate: (id: string, opts?: { onSuccess?: () => void; onError?: (err: Error) => void }) => void; isPending: boolean };
}

// ═══════════════════════════════════════════════════════════════════════════
// SocialLinkPill — Individual link pill with hover action menu
// ═══════════════════════════════════════════════════════════════════════════

const SocialLinkPill: React.FC<{
  sl: { id: string; platform: string; url: string; handle?: string };
  displayName: string;
  platformColor: string;
  isKnown: boolean;
  onDelete: () => void;
}> = ({ sl, displayName, platformColor, isKnown, onDelete }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <div className="relative group/pill flex" ref={menuRef}>
      <a
        href={sl.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-sm font-bold bg-surface-container hover:bg-surface-container-high pl-3 pr-1.5 py-1.5 rounded-xl shadow-sm transition-all hover:shadow-md"
      >
        <PlatformIcon
          platform={sl.platform}
          url={sl.url}
          className={cn("w-4 h-4", platformColor)}
          useFavicon={!isKnown}
        />
        <span className="text-on-surface-variant group-hover/pill:text-on-surface transition-colors">
          {displayName}
        </span>
        {/* Spacer for the action button that appears on hover */}
        <span className="w-0 group-hover/pill:w-5 transition-all duration-200 overflow-hidden shrink-0" />
      </a>

      {/* Action trigger — fades in on hover */}
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(v => !v); }}
        className={cn(
          "absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded-lg transition-all duration-200",
          "text-on-surface-variant/50 hover:text-on-surface hover:bg-surface-container-highest",
          menuOpen ? "opacity-100" : "opacity-0 group-hover/pill:opacity-100",
        )}
        aria-label="Link actions"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 glass-panel rounded-xl shadow-xl overflow-hidden min-w-[140px] animate-in fade-in slide-in-from-top-1 duration-150">
          <button
            onClick={(e) => {
              e.preventDefault();
              navigator.clipboard.writeText(sl.url);
              toast.success('Link copied');
              setMenuOpen(false);
            }}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-on-surface hover:bg-surface-container-low transition-colors text-left"
          >
            <Copy className="w-3.5 h-3.5 text-primary" />
            Copy link
          </button>
          <button
            onClick={(e) => {
              e.preventDefault();
              onDelete();
              setMenuOpen(false);
            }}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-rose-500 hover:bg-rose-500/8 transition-colors text-left"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete link
          </button>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// LinkedIn slug cleanup — strips auto-generated numeric suffixes for display
//
// LinkedIn auto-generates slugs like "alex-sadler-07993773" when a user
// hasn't set a custom vanity URL. The suffix is alphanumeric (hex/numeric)
// and typically 5-10 characters. We strip it for cleaner display while
// keeping the actual URL unchanged.
//
// Heuristic:
//   1. The slug must contain at least one hyphen (multi-part = name segments)
//   2. The last segment must be ≥5 chars (avoids stripping real name initials like "-c")
//   3. The last segment must contain at least one digit (names rarely do)
//
// Examples:
//   "alex-sadler-07993773"      → "alex-sadler"
//   "alexander-glavin-17b821a8" → "alexander-glavin"
//   "yuxuan-jonathan-c-027b18156" → "yuxuan-jonathan-c"
//   "young-lee-78ab07111"       → "young-lee"
//   "aayush1196"                → "aayush1196"    (no hyphens → no change)
//   "wangxi05104"               → "wangxi05104"   (no hyphens → no change)
// ═══════════════════════════════════════════════════════════════════════════

function cleanLinkedInSlug(slug: string): string {
  const lastDash = slug.lastIndexOf('-');
  if (lastDash === -1) return slug; // no hyphens → custom username, leave untouched

  const suffix = slug.slice(lastDash + 1);

  // Only strip if the suffix is ≥5 chars and contains at least one digit
  if (suffix.length >= 5 && /\d/.test(suffix) && /^[a-z0-9]+$/i.test(suffix)) {
    return slug.slice(0, lastDash);
  }

  return slug;
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
          className="w-full bg-error/15 px-6 py-3 flex items-center justify-center gap-2 shadow-sm"
        >
          <CalendarClock className="w-4 h-4 text-error shrink-0" />
          <span className="text-sm font-bold text-error truncate">
            Pending Follow-Up Alert
          </span>
        </motion.div>
      )}

      <div className="p-6 md:p-8 lg:px-10 lg:pt-8 lg:pb-6 max-w-6xl mx-auto w-full relative lg:shrink-0">
        <section className="flex flex-col md:flex-row items-start gap-6">
          {/* Avatar */}
          <div className="relative shrink-0 group/avatar">
            <div className="w-24 h-24 md:w-32 md:h-32 rounded-3xl overflow-hidden bg-surface-container-highest ring-1 ring-surface-container-highest shadow-xl">
              <img
                alt={contact.name}
                className="w-full h-full object-cover"
                src={contact.avatarUrl || fallbackAvatarUrl(contact.name)}
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
                      onError: (err: Error) => toast.error(`Failed: ${(err instanceof Error ? err.message : String(err))}`),
                    });
                  } else {
                    archiveContact.mutate(contact.id, {
                      onSuccess: () => toast.success(`${contact.name} archived`),
                      onError: (err: Error) => toast.error(`Failed: ${(err instanceof Error ? err.message : String(err))}`),
                    });
                  }
                }}
                disabled={archiveContact.isPending || unarchiveContact.isPending}
                title={contact.isArchived ? 'Unarchive Contact' : 'Archive Contact'}
                aria-label={contact.isArchived ? 'Unarchive contact' : 'Archive contact'}
                aria-pressed={!!contact.isArchived}
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

            {contact.headline && (() => {
              // Suppress headline if it's just "{role} at {company}" — that's already shown below
              const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
              const headlineNorm = normalize(contact.headline);
              const roleCompanyNorm = normalize(`${contact.role || ''} at ${contact.company || ''}`);
              const roleAtCompany2 = normalize(`${contact.role || ''} ${contact.company || ''}`);
              const isDuplicate =
                headlineNorm === roleCompanyNorm ||
                headlineNorm === roleAtCompany2 ||
                (contact.role && headlineNorm === normalize(contact.role)) ||
                (contact.company && headlineNorm === normalize(contact.company));
              if (isDuplicate) return null;
              return (
                <div className="text-base text-on-surface-variant font-medium mb-1 italic opacity-70">
                  <EditableField
                    value={contact.headline}
                    onSave={(val) => onUpdate('headline', val)}
                    placeholder="Add headline"
                  />
                </div>
              );
            })()}

            {contact.aiSummary && (
              <div className="flex items-start gap-2 bg-primary/10 rounded-xl p-3 mb-3 max-w-fit">
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
              <CatchMeUpFab contact={contact} generateBriefing={generateBriefing} />
            </div>

            {/* Social Links */}
            {((contact.lat && contact.lng) || (contact.socialLinks && contact.socialLinks.length > 0) || contact.website) && (
              <div className="flex flex-wrap items-center gap-2 mt-4 mb-2">
                {contact.lat && contact.lng && (
                  <LocalTimeWeather lat={contact.lat} lng={contact.lng} />
                )}
                {contact.socialLinks?.map((sl) => {
                  const platformKey = sl.platform?.toLowerCase() || 'other';
                  const platformColor = PLATFORM_COLORS[platformKey] || 'text-on-surface-variant';
                  const isKnown = hasKnownIcon(platformKey);

                  // Build display name: prefer handle, then platform label, then hostname
                  let displayName = sl.handle || sl.platform;
                  if (!sl.handle && sl.url) {
                    try { displayName = new URL(sl.url).hostname.replace('www.', ''); } catch {}
                  }
                  // Capitalize platform name for known ones
                  if (!sl.handle && isKnown) {
                    displayName = sl.platform.charAt(0).toUpperCase() + sl.platform.slice(1);
                  }

                  // Clean up LinkedIn auto-generated suffixes for display
                  if (platformKey === 'linkedin' && sl.handle) {
                    displayName = cleanLinkedInSlug(sl.handle);
                  } else if (platformKey === 'linkedin' && sl.url) {
                    // Extract slug from LinkedIn URL and clean it
                    try {
                      const url = new URL(sl.url);
                      const pathParts = url.pathname.replace(/\/+$/, '').split('/');
                      const slug = pathParts[pathParts.length - 1];
                      if (slug && slug !== 'in') {
                        displayName = cleanLinkedInSlug(slug);
                      }
                    } catch {}
                  }

                  return (
                    <SocialLinkPill
                      key={sl.id}
                      sl={sl}
                      displayName={displayName}
                      platformColor={platformColor}
                      isKnown={isKnown}
                      onDelete={() => {
                        const before = contact.socialLinks || [];
                        const after = before.filter(s => s.id !== sl.id);
                        updateContact.mutate({ id: contact.id, data: { socialLinks: after.map(s => ({ platform: s.platform, url: s.url, handle: s.handle })) } });
                        toast('Link removed', {
                          duration: 7000,
                          action: {
                            label: 'Undo',
                            onClick: () => updateContact.mutate({ id: contact.id, data: { socialLinks: before.map(s => ({ platform: s.platform, url: s.url, handle: s.handle })) } }),
                          },
                        });
                      }}
                    />
                  );
                })}
                {/* Show website if not already in social links */}
                {contact.website && !contact.socialLinks?.some(sl => sl.url === contact.website) && (
                  <a
                    href={contact.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-1.5 text-sm font-bold bg-surface-container hover:bg-surface-container-high px-3 py-1.5 rounded-xl shadow-sm transition-all hover:shadow-md"
                  >
                    <PlatformIcon
                      platform="website"
                      url={contact.website}
                      className="w-4 h-4 text-on-surface-variant"
                      useFavicon
                    />
                    <span className="text-on-surface-variant group-hover:text-on-surface transition-colors">
                      {(() => { try { return new URL(contact.website).hostname.replace('www.', ''); } catch { return 'Website'; } })()}
                    </span>
                  </a>
                )}
              </div>
            )}

            {contact.tags && contact.tags.length > 0 && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {contact.tags.map((t) => (
                  <div key={t.id} className="group/pill flex items-center gap-1 text-xs font-bold py-1 px-2.5 rounded-full bg-primary/10 text-primary border border-primary/20 transition-all overflow-hidden">
                    <Sparkles className="w-2.5 h-2.5 opacity-60 shrink-0" />
                    <span className="whitespace-normal break-words">{t.tag}</span>
                    <button
                      onClick={() => {
                        const before = contact.tags || [];
                        const after = before.filter(tag => tag.id !== t.id);
                        updateContact.mutate({ id: contact.id, data: { tags: after.map(tag => ({ tag: tag.tag })) } });
                        toast('Tag removed', {
                          duration: 7000,
                          action: {
                            label: 'Undo',
                            onClick: () => updateContact.mutate({ id: contact.id, data: { tags: before.map(tag => ({ tag: tag.tag })) } }),
                          },
                        });
                      }}
                      className="w-4 h-4 rounded-full text-primary/40 hover:text-red-500 hover:bg-red-500/10 flex items-center justify-center transition-colors shrink-0 -mr-1"
                      aria-label={`Remove tag ${t.tag}`}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Actions Row */}
            {/* Actions Row */}
            {showNetworkButton && (
              <div className="mt-4 flex items-center gap-3 flex-wrap">
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
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
};
