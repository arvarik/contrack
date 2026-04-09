/**
 * ContactProfile — Orchestrator component for the Contact Detail Page (CDP).
 *
 * This is a thin composition layer that wires up React Query mutations,
 * manages shared state (active tab, avatar picker), and delegates rendering
 * to four focused sub-components:
 *
 * - {@link ProfileHeader} — Avatar, name, social links, tags, AI briefing
 * - {@link DetailsCard}   — Location, email, phone, birthday, preferences
 * - {@link DossierTab}    — AI dossier, experience, education
 * - {@link TimelineTab}   — Interaction composer, timeline entries
 */
import React, { useState, useCallback } from "react";
import { Modal } from "../../../components/ui/Modal";
import { useNavigate } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { cn } from "../../../lib/utils";
import { CARD } from "../../../lib/styles";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { ArrowLeftRight, CheckCircle2, Loader2, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  useContact, useTimeline, useUpdateContact, useAddAttachment,
  useDeleteContact, useDeleteInteraction, useUpdateInteraction,
  useGenerateBriefing, usePromoteGhost, useArchiveContact, useUnarchiveContact,
  useSuggestionForContact, useDismissSuggestion, useMergeSuggestion,
} from "../../../api";

import { AvatarPickerModal } from "../../../components/AvatarPickerModal";
import { ProfileHeader } from "./ProfileHeader";
import { DetailsCard } from "./DetailsCard";
import { DossierTab } from "./DossierTab";
import { TimelineTab } from "./TimelineTab";
import { VIBE_COLORS } from "./VibePickerPopover";
import { ContactCard } from "../../dedupe/components/shared/ContactCard";

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

export interface ContactProfileProps {
  contactId: string;
  onClose?: () => void;
  showNetworkButton?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// DupeBanner — Point-of-action banner for pending duplicate suggestions
// ═══════════════════════════════════════════════════════════════════════════

const DupeBanner = ({ contactId, contactName }: { contactId: string; contactName: string }) => {
  const { data: suggestion, isLoading } = useSuggestionForContact(contactId);
  const dismiss = useDismissSuggestion();
  const merge = useMergeSuggestion();
  const [dismissed, setDismissed] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [swapped, setSwapped] = useState(false);

  if (isLoading || !suggestion || dismissed) return null;

  const currentContact = suggestion.contactIdA === contactId
    ? suggestion.contactA
    : suggestion.contactB;

  const otherContact = suggestion.contactIdA === contactId
    ? suggestion.contactB
    : suggestion.contactA;

  if (!otherContact || !currentContact) return null;

  // By default, the current contact is primary (user came to this page)
  const primary = swapped ? otherContact : currentContact;
  const duplicate = swapped ? currentContact : otherContact;

  const handleDismiss = async () => {
    try {
      await dismiss.mutateAsync(suggestion.id);
      setDismissed(true);
      toast('Marked as different people');
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    }
  };

  const handleMerge = async () => {
    try {
      await merge.mutateAsync({ suggestionId: suggestion.id, primaryId: primary.id });
      setDismissed(true); // Hide banner after merge
      toast.success(`Merged into ${primary.name}`);
    } catch (err: any) {
      toast.error(`Merge failed: ${err.message}`);
    }
  };

  return (
    <div className="max-w-6xl mx-auto w-full px-6 md:px-8 lg:px-10 mt-2 mb-4">
      {/* Collapsed banner */}
      <div className="flex items-center gap-3 bg-primary/5 rounded-xl px-4 py-3">
        <span className="text-primary text-base">✨</span>
        <p className="flex-1 text-sm text-on-surface">
          We found another contact that looks like{' '}
          <span className="font-bold">{otherContact.name || 'someone'}</span>.
        </p>
        <button
          onClick={() => setShowReview(v => !v)}
          className="shrink-0 px-3 py-1.5 text-xs font-bold text-on-primary bg-primary rounded-full hover:shadow-md hover:shadow-primary/20 transition-all"
        >
          {showReview ? 'Hide' : 'Review Match'}
        </button>
        <button
          onClick={handleDismiss}
          disabled={dismiss.isPending}
          className="shrink-0 px-3 py-1.5 text-xs font-bold text-on-surface-variant bg-surface-container-low hover:bg-surface-container-high rounded-full transition-colors disabled:opacity-50"
        >
          Not the same
        </button>
      </div>

      {/* Expandable inline review panel */}
      <AnimatePresence>
        {showReview && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="pt-4 space-y-4">
              {/* AI Reasoning */}
              {suggestion.reasoning && (
                <div className="flex items-start gap-2.5 bg-primary/5 rounded-xl p-3">
                  <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <p className="text-sm text-on-surface leading-relaxed">{suggestion.reasoning}</p>
                </div>
              )}

              {/* Side-by-side comparison */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 relative">
                <div className="min-w-0">
                  <ContactCard
                    contact={primary}
                    label="Primary (Keeper)"
                    labelColor="text-emerald-600 bg-emerald-500/10"
                    other={duplicate}
                    isPrimary
                  />
                </div>
                <button
                  onClick={() => setSwapped(s => !s)}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 p-2 bg-surface rounded-full shadow-lg hover:shadow-xl hover:scale-110 transition-all hidden lg:flex items-center justify-center"
                  title="Swap primary / duplicate"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 text-on-surface-variant hover:text-primary transition-colors" />
                </button>
                <div className="min-w-0">
                  <ContactCard
                    contact={duplicate}
                    label="Duplicate (Merges In)"
                    labelColor="text-amber-600 bg-amber-500/10"
                    other={primary}
                    onSetPrimary={() => setSwapped(s => !s)}
                  />
                </div>
              </div>

              {/* Mobile swap button */}
              <button
                onClick={() => setSwapped(s => !s)}
                className="lg:hidden w-full flex items-center justify-center gap-2 py-2 bg-surface-container-low rounded-xl text-xs font-bold text-on-surface-variant hover:text-primary transition-colors"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                Swap Primary / Duplicate
              </button>

              {/* Action buttons */}
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={handleDismiss}
                  disabled={dismiss.isPending}
                  className="flex items-center gap-2 px-5 py-2.5 bg-surface-container-low hover:bg-rose-500/8 rounded-xl text-sm font-bold text-on-surface-variant hover:text-rose-600 transition-all disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                  Keep Separate
                </button>
                <button
                  onClick={handleMerge}
                  disabled={merge.isPending}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary rounded-xl text-sm font-bold hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-50"
                >
                  {merge.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Merge Contacts
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

export const ContactProfile = ({ contactId: id, onClose, showNetworkButton = false }: ContactProfileProps) => {
  const navigate = useNavigate();

  // ── Data queries ──────────────────────────────────────────────────────
  const { data: contact, isLoading: contactLoading } = useContact(id);
  const { data: timeline = [], isLoading: timelineLoading } = useTimeline(id);

  // Dynamic page title — updates as contact data loads
  usePageTitle(contact?.name ?? null);

  // ── Mutations ─────────────────────────────────────────────────────────
  const updateContact = useUpdateContact();
  const addAttachment = useAddAttachment();
  const deleteContact = useDeleteContact();
  const deleteInteraction = useDeleteInteraction();
  const updateInteraction = useUpdateInteraction();
  const generateBriefing = useGenerateBriefing();
  const promoteGhost = usePromoteGhost();
  const archiveContact = useArchiveContact();
  const unarchiveContact = useUnarchiveContact();

  // ── Local state ───────────────────────────────────────────────────────
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'timeline' | 'dossier'>('timeline');

  // ── Dropzone (file uploads & .eml ingestion) ──────────────────────────
  const onDrop = useCallback((acceptedFiles: globalThis.File[]) => {
    if (acceptedFiles.length > 0 && id) {
      acceptedFiles.forEach(file => {
        const isEml = file.name.toLowerCase().endsWith('.eml');
        const toastId = toast.loading(isEml ? `Summarizing email thread with Gemini...` : `Uploading "${file.name}"...`);

        addAttachment.mutate(
          { contactId: id, file },
          {
            onSuccess: () => {
              toast.dismiss(toastId);
              toast.success(isEml ? `Email imported & summarized!` : `Attached "${file.name}"`);
            },
            onError: (err) => {
              toast.dismiss(toastId);
              toast.error(`Upload failed: ${err.message}`);
            },
          }
        );
      });
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

  // ── Event handlers ────────────────────────────────────────────────────
  const handleUpdate = (field: string, val: string) => {
    if (!id) return;
    updateContact.mutate({ id, data: { [field]: val } });
  };

  // Delete confirmation — uses <Modal> instead of native confirm()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDeleteContact = () => {
    if (!id || !contact) return;
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    if (!id || !contact) return;
    deleteContact.mutate(id, {
      onSuccess: () => {
        setShowDeleteConfirm(false);
        toast.success(`Deleted ${contact.name}`);
        navigate("/");
        if (onClose) onClose();
      },
      onError: (err) => toast.error(`Delete failed: ${err.message}`),
    });
  };

  // ── Loading / empty states ────────────────────────────────────────────
  if (contactLoading) return <div className="p-12 text-center text-on-surface-variant animate-pulse font-headline">Loading contact...</div>;
  if (!contact) return <div className="p-12 text-center">Contact not found.</div>;

  // ── Theme ─────────────────────────────────────────────────────────────
  const currentTheme = VIBE_COLORS.find(v => v.id === contact.themeColor) || VIBE_COLORS[0];
  const themeStyles = {
    '--color-primary': currentTheme.primary,
    '--color-primary-dim': currentTheme.dim,
    '--color-primary-container': currentTheme.container,
  } as React.CSSProperties;

  // ═══════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <>
    <div className="h-full flex flex-col overflow-hidden w-full relative bg-surface md:bg-transparent" style={themeStyles}>
      <div className="flex-1 min-h-0 overflow-y-auto">

        {/* ── Profile Header ──────────────────────────────────────────── */}
        <ProfileHeader
          contact={contact}
          onUpdate={handleUpdate}
          onDelete={handleDeleteContact}
          onClose={onClose}
          onOpenAvatarPicker={() => setIsAvatarPickerOpen(true)}
          showNetworkButton={showNetworkButton}
          generateBriefing={generateBriefing}
          archiveContact={archiveContact}
          unarchiveContact={unarchiveContact}
          updateContact={updateContact}
          promoteGhost={promoteGhost}
        />

        {/* ── Dupe Suggestion Banner ──────────────────────────────────── */}
        <DupeBanner contactId={id} contactName={contact.name} />

        {/* ── Two-Column Layout ───────────────────────────────────────── */}
        <div className="max-w-6xl mx-auto w-full px-6 md:px-8 lg:px-10">
          <div className="grid grid-cols-1 lg:grid-cols-24 gap-6 lg:gap-8 items-start pb-32 lg:pb-0 mt-8 lg:mt-0 relative">
            
            {/* Left Column: Facts */}
            <div className="lg:col-span-9 space-y-6 lg:sticky lg:top-8 lg:pb-8">
              <DetailsCard
                contact={contact}
                contactId={id}
                onUpdate={handleUpdate}
                updateContact={updateContact}
              />
            </div>

            {/* Right Column: Timeline / Dossier */}
            <div className="lg:col-span-15 relative min-h-[300px] flex flex-col gap-6 lg:pb-32">
              
              {/* Tab Switcher */}
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
                <DossierTab
                  contact={contact}
                  contactId={id}
                  updateContact={updateContact}
                />
              )}

              {activeTab === 'timeline' && (
                <TimelineTab
                  contactId={id}
                  timeline={timeline}
                  timelineLoading={timelineLoading}
                  isDragActive={isDragActive}
                  getRootProps={getRootProps}
                  getInputProps={getInputProps}
                  deleteInteraction={deleteInteraction}
                  updateInteraction={updateInteraction}
                  promoteGhost={promoteGhost}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* ── Avatar Picker Modal ────────────────────────────────────────── */}
    {id && (
      <AvatarPickerModal
        isOpen={isAvatarPickerOpen}
        onClose={() => setIsAvatarPickerOpen(false)}
        contactId={id}
        contactName={contact.name}
        currentAvatarUrl={contact.avatarUrl}
      />
    )}

    {/* ── Delete Confirmation Modal ─────────────────────────────────────── */}
    {contact && (
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Delete Contact"
      >
        <div className="space-y-6">
          <p className="text-on-surface-variant text-sm leading-relaxed">
            Permanently delete <span className="font-bold text-on-surface">{contact.name}</span>?
            This action cannot be undone — all interactions, notes, and attachments
            will be lost.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-5 py-2.5 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container-high transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              disabled={deleteContact.isPending}
              className="px-5 py-2.5 rounded-xl text-sm font-bold bg-error text-white hover:bg-error/90 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
            >
              {deleteContact.isPending ? 'Deleting…' : 'Delete Forever'}
            </button>
          </div>
        </div>
      </Modal>
    )}

    </>
  );
};
