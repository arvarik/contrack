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
import React, {
  Suspense,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { AlertCircle, UserX } from "lucide-react";
import { toast } from "sonner";
import { toastUndoableDelete } from "../../../lib/undoToast";
import { cn } from "../../../lib/utils";
import { CARD } from "../../../lib/styles";

import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAiAllowed } from "../../../hooks/useAiAllowed";

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
import { ApiError } from "../../../api/client";
import type { Contact } from "../../../types";

import { AvatarPickerModal } from "../../../components/AvatarPickerModal";
import {
  Segmented,
  type SegmentedOption,
} from "../../../components/ui/Segmented";
import { EmptyState } from "../../../components/ui/EmptyState";
import { useElementWidthAtLeast } from "../../../hooks/useElementWidth";
import { useFitsHeight } from "../../../hooks/useFitsHeight";
import {
  BackBar,
  ContactIntro,
  ProfileHeader,
  ProfileHeaderSkeleton,
} from "./ProfileHeader";
import { useTrackShortcut } from "./useTrackShortcut";
import { ContactTags } from "./ContactTags";
import { DetailsCard, type DetailRequest } from "./DetailsCard";
import type { ResearchAnchor } from "../../../lib/research";
/**
 * Card-shaped stand-in so switching tabs does not flash an empty pane, and
 * the page's body while the contact loads.
 */
const CardsFallback = () => (
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

/**
 * Behind a tab the user has to click, so it has no business in the chunk that
 * blocks the first render of a contact.
 */
const DossierTab = React.lazy(() =>
  import("./DossierTab").then((m) => ({ default: m.DossierTab })),
);
import { TimelineTab } from "./TimelineTab";
import { vibeTokens } from "../../../lib/theme";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { DupeBanner } from "./DupeBanner";
import { useMergedRedirect } from "./useMergedRedirect";

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

interface ContactProfileProps {
  contactId: string;
  onClose?: () => void;
  /** The name of the page Back goes to, for the Back button's text. */
  backLabel?: string;
  showNetworkButton?: boolean;
}

/** The page's outer box, the same while it loads and once it has. */
const ROOT =
  "h-full flex flex-col overflow-hidden w-full relative bg-surface md:bg-transparent";

/**
 * The files the timeline takes. One object, not a literal per render: the
 * dropzone's props are memoized on it, and new ones draw the timeline again.
 */
const DROP_ACCEPT = {
  "message/rfc822": [".eml"],
  "image/*": [".png", ".jpg", ".jpeg", ".gif"],
  "application/pdf": [".pdf"],
  "text/*": [".txt", ".csv", ".md"],
};

/** The pane width, in px, from which Details is a column and not a tab. */
const WIDE_CONTACT_MIN_PX = 768;

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
  const { data: contact, error, isFetching, refetch } = useContact(id);
  // A merged contact's old link goes on to the contact it merged into.
  const redirecting = useMergedRedirect(contact, id);
  const { data: timeline = [], isLoading: timelineLoading } = useTimeline(id);
  /**
   * The contact as far as it is known: the full one, or else its row in the
   * list, which has the name, the picture, the role and the company. The row
   * is only read, for the header while the full contact loads, and never
   * stored as the contact.
   */
  const queryClient = useQueryClient();
  const known =
    contact ??
    queryClient
      .getQueryData<Contact[]>(["contacts"])
      ?.find((row) => row.id === id);

  // Dynamic page title — updates as contact data loads
  usePageTitle(known?.name ?? null);

  // `t` tracks or untracks this contact, as the header button does.
  useTrackShortcut(contact);

  // ── Mutations ─────────────────────────────────────────────────────────
  // Their `mutate` and `mutateAsync` keep one identity. The result objects
  // are new on each render, and one in a memoized child's props would draw
  // that child again on every render of this page.
  const { mutate: updateContact, mutateAsync: saveContact } =
    useUpdateContact();
  const { mutate: addAttachment } = useAddAttachment();
  const { mutate: deleteContact } = useDeleteContact();
  const { mutate: restoreContact } = useRestoreContact();
  const { mutateAsync: deleteInteraction } = useDeleteInteraction();
  const { mutate: updateInteraction } = useUpdateInteraction();
  const generateBriefing = useGenerateBriefing();
  const { mutate: promoteGhost, isPending: promoting } = usePromoteGhost();
  const { mutate: archiveContact, isPending: archiving } = useArchiveContact();
  const { mutate: unarchiveContact, isPending: unarchiving } =
    useUnarchiveContact();

  // ── Local state ───────────────────────────────────────────────────────
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  /** The pencil on the avatar, where focus goes back when the picker closes. */
  const avatarEdit = useRef<HTMLButtonElement>(null);
  /**
   * Palette B, "Catch me up", opens the contact with `?brief=1`. The page
   * answers with the Dossier, and the Briefing card at its top scrolls into
   * view and takes focus (`briefRequest`). The flag leaves the address at
   * once, so Back or a reload does not ask for a briefing again.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const briefInUrl = searchParams.get("brief") === "1";
  const [activeTab, setActiveTab] = useState<Section>(
    briefInUrl ? "dossier" : "timeline",
  );
  const [briefRequest, setBriefRequest] = useState<number | null>(null);
  const spendBriefRequest = useCallback(() => setBriefRequest(null), []);
  useEffect(() => {
    if (!briefInUrl) return;
    setActiveTab("dossier");
    setBriefRequest(Date.now());
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("brief");
        return next;
      },
      { replace: true },
    );
  }, [briefInUrl, setSearchParams]);
  /**
   * A detail the Research card asked for, when research found no page: the
   * field it names opens, in Details or in the header. Narrow, Details is a
   * tab, so that tab opens first, and the field opens as it mounts. The field
   * spends the request once it has opened, so a later visit to the tab does
   * not open it again.
   */
  const [detailRequest, setDetailRequest] = useState<DetailRequest | null>(
    null,
  );
  const spendDetailRequest = useCallback(() => setDetailRequest(null), []);

  // ── Layout ────────────────────────────────────────────────────────────
  // Elements from callback refs, so the hooks see them on the render that
  // mounts them, after the loading state.
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [details, setDetails] = useState<HTMLDivElement | null>(null);
  // Only the answer, not the width: a drag of the list's edge resizes this
  // pane on every frame, and the page renders again only when it crosses.
  const wide = useElementWidthAtLeast(root, WIDE_CONTACT_MIN_PX) ?? false;
  const addDetail = useCallback(
    (anchor: ResearchAnchor) => {
      if (!wide && anchor !== "link") setActiveTab("details");
      setDetailRequest({ anchor, key: Date.now() });
    },
    [wide],
  );
  // 16 px above the column and 32 px under it.
  const detailsFit = useFitsHeight(details, scroller, 48);
  /**
   * The section beside Details. Wide, Details is always on screen, so a
   * Details tab chosen on a phone shows the timeline once the pane widens.
   */
  const mainTab: Section = activeTab === "dossier" ? "dossier" : "timeline";

  // ── Dropzone (file uploads & .eml ingestion) ──────────────────────────
  // With AI off, the server saves an .eml with no summary, like any file.
  const aiAllowed = useAiAllowed();
  const onDrop = useCallback(
    (acceptedFiles: globalThis.File[]) => {
      if (acceptedFiles.length > 0 && id) {
        acceptedFiles.forEach((file) => {
          const isEml = file.name.toLowerCase().endsWith(".eml");
          const toastId = toast.loading(
            isEml && aiAllowed
              ? `Summarizing email thread with AI...`
              : `Uploading "${file.name}"...`,
          );

          addAttachment(
            { contactId: id, file },
            {
              onSuccess: (interaction) => {
                toast.dismiss(toastId);
                toast.success(
                  isEml && interaction.content
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
    [id, addAttachment, aiAllowed],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    // react-dropzone 19.2 turned paste-to-upload on by default. This root
    // wraps the note composer, so a screenshot pasted into a note would
    // become an attachment.
    noPaste: true,
    accept: DROP_ACCEPT,
  });

  // ── Event handlers ────────────────────────────────────────────────────
  const handleUpdate = useCallback(
    async (field: string, val: string) => {
      try {
        await saveContact({ id, data: { [field]: val } });
        return true;
      } catch {
        return false;
      }
    },
    [id, saveContact],
  );
  const openAvatarPicker = useCallback(() => setIsAvatarPickerOpen(true), []);

  // Delete confirmation — uses <Modal> instead of native confirm()

  /**
   * Delete and leave, offering undo — the modal that used to sit in front of
   * this said "Permanently delete… This action cannot be undone", which was
   * false: the mutation is a soft delete into Trash, and this handler
   * already offered an Undo toast underneath the dialog that denied one
   * existed. Same trade as the bulk path; see lib/undoToast.
   */
  const name = contact?.name;
  const handleDeleteContact = useCallback(() => {
    if (!id || name === undefined) return;
    deleteContact(id, {
      onSuccess: ({ retentionDays }) => {
        toastUndoableDelete({
          count: 1,
          name,
          retentionDays,
          onUndo: () => {
            restoreContact(id, {
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
  }, [id, name, deleteContact, restoreContact, navigate, onClose]);

  // ── Theme ─────────────────────────────────────────────────────────────
  // The vibe replaces the primary palette for this page only, so it has to be
  // derived for the palette on screen: the light values on a dark page put the
  // brand blue at 2.84:1 against the background. Every accent token follows,
  // the wash ink too: the selected tint and the list chips carry
  // `text-on-primary-wash`, and the app accent's ink on a vibe's wash was the
  // wrong colour.
  const themeStyles = Object.fromEntries(
    Object.entries(vibeTokens(known?.themeColor, mode)).map(
      ([token, value]) => [`--color-${token}`, value],
    ),
  ) as React.CSSProperties;

  // ── Merged, error, and loading ────────────────────────────────────────
  // A merged contact's page is on its way to the contact it merged into,
  // and draws nothing a person could edit in the meantime.
  if (redirecting)
    return (
      <div className={ROOT}>
        <p role="status" className="p-8 text-sm text-on-surface-variant">
          Opening the contact this one merged into
        </p>
      </div>
    );
  // A retry that is out shows the loading page, not the error it may clear.
  if (!contact && error && !isFetching)
    return (
      <div className={ROOT}>
        {onClose && <BackBar onClose={onClose} backLabel={backLabel} />}
        {error instanceof ApiError && error.status === 404 ? (
          <EmptyState icon={UserX} title="Contact not found" />
        ) : (
          <EmptyState
            icon={AlertCircle}
            tone="error"
            title="The contact did not load"
            body="Nothing has changed. Try again in a moment"
            action={{ label: "Retry", onClick: () => void refetch() }}
          />
        )}
      </div>
    );
  // The header from the list's row, and cards for the rest. The duplicate
  // banner mounts here, so its request goes out beside the contact's, and
  // it is in place when the page draws.
  if (!contact)
    return (
      <div ref={setRoot} className={ROOT} style={themeStyles}>
        <ProfileHeaderSkeleton
          contact={known}
          layout={wide ? "wide" : "narrow"}
          onClose={onClose}
          backLabel={backLabel}
        />
        <DupeBanner contactId={id} />
        <div
          className={cn(
            "max-w-6xl mx-auto w-full",
            wide ? "px-8 lg:px-10" : "px-4 pt-4",
          )}
        >
          <CardsFallback />
        </div>
      </div>
    );

  // ═══════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════

  const dossier = (
    <Suspense fallback={<CardsFallback />}>
      <DossierTab
        contact={contact}
        generateBriefing={generateBriefing}
        onAddDetail={addDetail}
        briefRequest={briefRequest}
        onBriefHandled={spendBriefRequest}
      />
    </Suspense>
  );

  return (
    <>
      <div ref={setRoot} className={ROOT} style={themeStyles}>
        {/* `contact-scroller`: index.css keeps the typed line above Save. */}
        <div
          ref={setScroller}
          className="contact-scroller flex-1 min-h-0 overflow-y-auto"
        >
          {/* ── Profile Header ──────────────────────────────────────────── */}
          <ProfileHeader
            contact={contact}
            onUpdate={handleUpdate}
            onDelete={handleDeleteContact}
            onClose={onClose}
            onOpenAvatarPicker={openAvatarPicker}
            avatarEditRef={avatarEdit}
            showNetworkButton={showNetworkButton}
            layout={wide ? "wide" : "narrow"}
            backLabel={backLabel}
            archiveContact={archiveContact}
            unarchiveContact={unarchiveContact}
            archivePending={archiving || unarchiving}
            updateContact={updateContact}
            promoteGhost={promoteGhost}
            promotePending={promoting}
            linkRequest={
              detailRequest?.anchor === "link" ? detailRequest.key : undefined
            }
            onLinkRequestDone={spendDetailRequest}
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
                    detailRequest={detailRequest}
                    onDetailRequestDone={spendDetailRequest}
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
          returnFocusRef={avatarEdit}
        />
      )}
    </>
  );
};
