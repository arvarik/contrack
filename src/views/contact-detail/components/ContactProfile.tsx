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
import { Loader2 } from "lucide-react";

import {
  useContact, useTimeline, useUpdateContact, useAddAttachment,
  useDeleteContact, useDeleteInteraction, useUpdateInteraction,
  useGenerateBriefing, usePromoteGhost, useArchiveContact, useUnarchiveContact,
} from "../../../api";

import { AvatarPickerModal } from "../../../components/AvatarPickerModal";
import { ProfileHeader } from "./ProfileHeader";
import { DetailsCard } from "./DetailsCard";
import { DossierTab } from "./DossierTab";
import { TimelineTab } from "./TimelineTab";
import { VIBE_COLORS } from "./VibePickerPopover";
import { DupeBanner } from "./DupeBanner";

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

export interface ContactProfileProps {
  contactId: string;
  onClose?: () => void;
  showNetworkButton?: boolean;
}

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
        const toastId = toast.loading(isEml ? `Summarizing email thread with AI...` : `Uploading "${file.name}"...`);

        addAttachment.mutate(
          { contactId: id, file },
          {
            onSuccess: () => {
              toast.dismiss(toastId);
              toast.success(isEml ? `Email imported & summarized!` : `Attached "${file.name}"`);
            },
            onError: (err) => {
              toast.dismiss(toastId);
              toast.error(`Upload failed: ${(err instanceof Error ? err.message : String(err))}`);
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
  } as any);

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
      onError: (err) => toast.error(`Delete failed: ${(err instanceof Error ? err.message : String(err))}`),
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
              className="px-5 py-2.5 rounded-xl text-sm font-bold bg-error text-on-error hover:bg-error/90 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
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
