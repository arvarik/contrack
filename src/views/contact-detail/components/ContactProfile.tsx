/**
 * ContactProfile — Orchestrator component for the Contact Detail Page (CDP).
 *
 * This is a thin composition layer that wires up React Query mutations,
 * manages shared state (active tab, avatar picker), and delegates rendering
 * to four focused sub-components:
 *
 * - {@link ProfileHeader} — Avatar, name, meta line, tags, the actions
 * - {@link DetailsCard}   — Location, email, phone, birthday, preferences
 * - {@link DossierTab}    — Briefing, AI dossier, experience, education
 * - {@link TimelineTab}   — Interaction composer, timeline entries
 *
 * The page has two layouts, chosen by the width of its own pane, not of the
 * window:
 *
 * 1. Wide (768 px and up): the header, then two columns. Details is a
 *    column on the left that stays in view while it fits. On the right, a
 *    Timeline and Dossier control over the chosen section.
 * 2. Narrow: a short header, then a control for Timeline, Details and
 *    Dossier that sticks under the Back bar. The Timeline tab opens with a
 *    one-line composer above the first entry.
 *
 * The pane, not the window: at 1024 px the sidebar and the 350 px list sit
 * beside the contact, so its pane is about 600 px wide. Two columns there
 * left the timeline about 160 px.
 */
import React, { Suspense, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { toastUndoableDelete } from "../../../lib/undoToast";
import { cn } from "../../../lib/utils";
import { CARD } from "../../../lib/styles";

import { usePageTitle } from "../../../hooks/usePageTitle";

import {
  useContact,
  useTimeline,
  useUpdateContact,
  useAddAttachment,
  useDeleteContact,
  useRestoreContact,
  useDeleteInteraction,
  useUpdateInteraction,
  useGenerateBriefing,
  usePromoteGhost,
  useArchiveContact,
  useUnarchiveContact,
} from "../../../api";

import { AvatarPickerModal } from "../../../components/AvatarPickerModal";
import {
  Segmented,
  type SegmentedOption,
} from "../../../components/ui/Segmented";
import { useElementWidthAtLeast } from "../../../hooks/useElementWidth";
import { useFitsHeight } from "../../../hooks/useFitsHeight";
import { ContactIntro, ProfileHeader } from "./ProfileHeader";
import { useTrackShortcut } from "./useTrackShortcut";
import { ContactTags } from "./ContactTags";
import { DetailsCard } from "./DetailsCard";
/**
 * Behind a tab the user has to click, so it has no business in the chunk that
 * blocks the first render of a contact.
 */
/** Card-shaped stand-in so switching tabs does not flash an empty pane. */
const DossierFallback = () => (
  <div className="space-y-6" aria-busy="true">
    {[0, 1].map((i) => (
      <div key={i} className={cn(CARD, "space-y-3")}>
        <div className="h-3 w-28 bg-surface-container-high/60 rounded-full animate-pulse" />
        <div className="h-4 w-3/4 bg-surface-container/50 rounded-full animate-pulse" />
        <div className="h-4 w-1/2 bg-surface-container/50 rounded-full animate-pulse" />
      </div>
    ))}
  </div>
);

const DossierTab = React.lazy(() =>
  import("./DossierTab").then((m) => ({ default: m.DossierTab })),
);
import { TimelineTab } from "./TimelineTab";
import { vibeTokens } from "../../../lib/theme";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { DupeBanner } from "./DupeBanner";

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

export interface ContactProfileProps {
  contactId: string;
  onClose?: () => void;
  /** The name of the page Back goes to, for the Back button's text. */
  backLabel?: string;
  showNetworkButton?: boolean;
}

/** The pane width, in px, from which Details is a column and not a tab. */
export const WIDE_CONTACT_MIN_PX = 768;

type Section = "timeline" | "details" | "dossier";

/** The name of the section control in both layouts. */
const SECTIONS_LABEL = "Contact sections";

const WIDE_TABS: readonly SegmentedOption<Section>[] = [
  { value: "timeline", label: "Timeline" },
  { value: "dossier", label: "Dossier" },
];

const NARROW_TABS: readonly SegmentedOption<Section>[] = [
  { value: "timeline", label: "Timeline" },
  { value: "details", label: "Details" },
  { value: "dossier", label: "Dossier" },
];

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

export const ContactProfile = ({
  contactId: id,
  onClose,
  backLabel,
  showNetworkButton = false,
}: ContactProfileProps) => {
  const navigate = useNavigate();
  const { mode } = usePreferences();

  // ── Data queries ──────────────────────────────────────────────────────
  const { data: contact, isLoading: contactLoading } = useContact(id);
  const { data: timeline = [], isLoading: timelineLoading } = useTimeline(id);

  // Dynamic page title — updates as contact data loads
  usePageTitle(contact?.name ?? null);

  // `t` tracks or untracks this contact, as the header button does.
  useTrackShortcut(contact);

  // ── Mutations ─────────────────────────────────────────────────────────
  const updateContact = useUpdateContact();
  const addAttachment = useAddAttachment();
  const deleteContact = useDeleteContact();
  const restoreContact = useRestoreContact();
  const deleteInteraction = useDeleteInteraction();
  const updateInteraction = useUpdateInteraction();
  const generateBriefing = useGenerateBriefing();
  const promoteGhost = usePromoteGhost();
  const archiveContact = useArchiveContact();
  const unarchiveContact = useUnarchiveContact();

  // ── Local state ───────────────────────────────────────────────────────
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Section>("timeline");

  // ── Layout ────────────────────────────────────────────────────────────
  // Elements from callback refs, so the hooks see them on the render that
  // mounts them, after the loading state.
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [details, setDetails] = useState<HTMLDivElement | null>(null);
  // Only the answer, not the width: a drag of the list's edge resizes this
  // pane on every frame, and the page renders again only when it crosses.
  const wide = useElementWidthAtLeast(root, WIDE_CONTACT_MIN_PX) ?? false;
  // 16 px above the column and 32 px under it.
  const detailsFit = useFitsHeight(details, scroller, 48);
  /**
   * The section beside Details. Wide, Details is always on screen, so a
   * Details tab chosen on a phone shows the timeline once the pane widens.
   */
  const mainTab: Section = activeTab === "dossier" ? "dossier" : "timeline";

  // ── Dropzone (file uploads & .eml ingestion) ──────────────────────────
  const onDrop = useCallback(
    (acceptedFiles: globalThis.File[]) => {
      if (acceptedFiles.length > 0 && id) {
        acceptedFiles.forEach((file) => {
          const isEml = file.name.toLowerCase().endsWith(".eml");
          const toastId = toast.loading(
            isEml
              ? `Summarizing email thread with AI...`
              : `Uploading "${file.name}"...`,
          );

          addAttachment.mutate(
            { contactId: id, file },
            {
              onSuccess: () => {
                toast.dismiss(toastId);
                toast.success(
                  isEml
                    ? `Email imported & summarized!`
                    : `Attached "${file.name}"`,
                );
              },
              onError: (err) => {
                toast.dismiss(toastId);
                toast.error(
                  `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
                );
              },
            },
          );
        });
      }
    },
    [id, addAttachment],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    accept: {
      "message/rfc822": [".eml"],
      "image/*": [".png", ".jpg", ".jpeg", ".gif"],
      "application/pdf": [".pdf"],
      "text/*": [".txt", ".csv", ".md"],
    },
  });

  // ── Event handlers ────────────────────────────────────────────────────
  const handleUpdate = async (field: string, val: string) => {
    try {
      await updateContact.mutateAsync({ id, data: { [field]: val } });
      return true;
    } catch {
      return false;
    }
  };

  // Delete confirmation — uses <Modal> instead of native confirm()

  /**
   * Delete and leave, offering undo — the modal that used to sit in front of
   * this said "Permanently delete… This action cannot be undone", which was
   * false: the mutation is a soft delete into a 30-day Trash, and this handler
   * already offered an Undo toast underneath the dialog that denied one
   * existed. Same trade as the bulk path; see lib/undoToast.
   */
  const handleDeleteContact = () => {
    if (!id || !contact) return;
    const name = contact.name;
    deleteContact.mutate(id, {
      onSuccess: () => {
        toastUndoableDelete({
          count: 1,
          name,
          onUndo: () => {
            restoreContact.mutate(id, {
              onSuccess: () => navigate(`/contact/${id}`),
              onError: (err) =>
                toast.error(
                  `Could not restore: ${err instanceof Error ? err.message : String(err)}`,
                ),
            });
          },
        });
        navigate("/");
        if (onClose) onClose();
      },
      onError: (err) =>
        toast.error(
          `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
    });
  };

  // ── Loading / empty states ────────────────────────────────────────────
  if (contactLoading)
    return (
      <div className="p-12 text-center text-on-surface-variant animate-pulse font-headline">
        Loading contact...
      </div>
    );
  if (!contact)
    return <div className="p-12 text-center">Contact not found.</div>;

  // ── Theme ─────────────────────────────────────────────────────────────
  // The vibe replaces the primary palette for this page only, so it has to be
  // derived for the palette on screen: the light values on a dark page put the
  // brand blue at 2.84:1 against the background. Every accent token follows,
  // the wash ink too: the selected tint and the list chips carry
  // `text-on-primary-wash`, and the app accent's ink on a vibe's wash was the
  // wrong colour.
  const themeStyles = Object.fromEntries(
    Object.entries(vibeTokens(contact.themeColor, mode)).map(
      ([token, value]) => [`--color-${token}`, value],
    ),
  ) as React.CSSProperties;

  // ═══════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════

  const dossier = (
    <Suspense fallback={<DossierFallback />}>
      <DossierTab contact={contact} generateBriefing={generateBriefing} />
    </Suspense>
  );

  return (
    <>
      <div
        ref={setRoot}
        className="h-full flex flex-col overflow-hidden w-full relative bg-surface md:bg-transparent"
        style={themeStyles}
      >
        <div ref={setScroller} className="flex-1 min-h-0 overflow-y-auto">
          {/* ── Profile Header ──────────────────────────────────────────── */}
          <ProfileHeader
            contact={contact}
            onUpdate={handleUpdate}
            onDelete={handleDeleteContact}
            onClose={onClose}
            onOpenAvatarPicker={() => setIsAvatarPickerOpen(true)}
            showNetworkButton={showNetworkButton}
            layout={wide ? "wide" : "narrow"}
            backLabel={backLabel}
            archiveContact={archiveContact}
            unarchiveContact={unarchiveContact}
            updateContact={updateContact}
            promoteGhost={promoteGhost}
          />

          {/* ── Dupe Suggestion Banner ──────────────────────────────────── */}
          <DupeBanner contactId={id} />

          {/* ── Narrow: the sections as tabs, stuck under the Back bar ──── */}
          {!wide && (
            <div
              className={cn(
                "sticky z-20 bg-surface px-4 py-2 shadow-[0_1px_0_var(--color-surface-container-high)]",
                // The Back bar is 56 px and shows below `lg`.
                onClose ? "top-14 lg:top-0" : "top-0",
              )}
            >
              <Segmented
                options={NARROW_TABS}
                value={activeTab}
                onChange={setActiveTab}
                label={SECTIONS_LABEL}
                className="w-full sm:w-full"
              />
            </div>
          )}

          {/*
            One grid for both layouts, with the same two children in the same
            places, so a width that crosses 768 px changes classes and does
            not remount the timeline and its composer.
          */}
          <div
            className={cn(
              "max-w-6xl mx-auto w-full",
              wide ? "px-8 lg:px-10" : "px-4 pt-4",
            )}
          >
            <div
              className={cn(
                "grid items-start relative",
                wide
                  ? "grid-cols-[minmax(300px,2fr)_5fr] gap-8"
                  : "grid-cols-1 gap-6",
              )}
            >
              {/* Details: a column beside the timeline, or a tab */}
              {(wide || activeTab === "details") && (
                <div
                  ref={setDetails}
                  className={cn(
                    "min-w-0 space-y-6",
                    wide ? "pb-8" : "pb-32",
                    // Sticky only while the column fits the view. A taller
                    // column scrolls with the page, so its last field is in
                    // reach.
                    wide &&
                      detailsFit &&
                      (onClose ? "sticky top-18 lg:top-4" : "sticky top-4"),
                  )}
                >
                  {!wide && (
                    <>
                      <ContactIntro contact={contact} onUpdate={handleUpdate} />
                      <ContactTags
                        contact={contact}
                        updateContact={updateContact}
                      />
                    </>
                  )}
                  <DetailsCard
                    contact={contact}
                    contactId={id}
                    onUpdate={handleUpdate}
                    updateContact={updateContact}
                  />
                </div>
              )}

              {/* Timeline or Dossier */}
              {(wide || activeTab !== "details") && (
                <div className="min-w-0 relative min-h-[300px] flex flex-col gap-6 pb-32">
                  {wide && (
                    <Segmented
                      options={WIDE_TABS}
                      value={mainTab}
                      onChange={setActiveTab}
                      label={SECTIONS_LABEL}
                      className="w-auto self-start"
                    />
                  )}

                  {mainTab === "dossier" ? (
                    dossier
                  ) : (
                    <TimelineTab
                      contactId={id}
                      composerCollapsible={!wide}
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
              )}
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
        />
      )}
    </>
  );
};
