/**
 * The contact page. It wires the queries and mutations, holds the shared
 * state, and renders ProfileHeader, DetailsCard, DossierTab and TimelineTab.
 *
 * The layout follows the width of its own pane, not the window: at 1024 px
 * the sidebar and the 350 px list leave the pane about 600 px, where two
 * columns leave the timeline about 160 px. Wide (768 px and up), Details is a
 * column beside a Timeline and Dossier control. Narrow, one control for all
 * three sections sticks under the Back bar.
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
import { UserX } from "lucide-react";
import { toast } from "sonner";
import { toastUndoableDelete } from "../../../lib/undoToast";
import { cn, errorText } from "../../../lib/utils";
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
/** Card-shaped stand-in, so a tab switch or the first load shows no empty pane. */
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

/** Lazy: it sits behind a tab, so it stays out of the contact's first chunk. */
const DossierTab = React.lazy(() =>
  import("./DossierTab").then((m) => ({ default: m.DossierTab })),
);
import { TimelineTab } from "./TimelineTab";
import { vibeTokens } from "../../../lib/theme";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { DupeBanner } from "./DupeBanner";
import { useMergedRedirect } from "./useMergedRedirect";
import { LoadFailed } from "../../../components/ui/LoadFailed";

interface ContactProfileProps {
  contactId: string;
  onClose?: () => void;
  /** The name of the page Back goes to, for the Back button's text. */
  backLabel?: string;
  showNetworkButton?: boolean;
  /**
   * Runs after a delete instead of going to Network: the card over Ask or
   * Archived closes, and the person stays where they were, Undo included.
   */
  onDeleted?: () => void;
}

/** The page's outer box, the same while it loads and once it has. */
const ROOT =
  "h-full flex flex-col overflow-hidden w-full relative bg-surface md:bg-transparent";

/**
 * One object, not a literal per render: the dropzone memoizes its props on
 * it, and new props draw the timeline again.
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

export const ContactProfile = ({
  contactId: id,
  onClose,
  backLabel,
  showNetworkButton = false,
  onDeleted,
}: ContactProfileProps) => {
  const navigate = useNavigate();
  const { mode } = usePreferences();

  const { data: contact, error, isFetching, refetch } = useContact(id);
  // A merged contact's old link goes on to the contact it merged into.
  const redirecting = useMergedRedirect(contact, id, isFetching);
  const { data: timeline = [], isLoading: timelineLoading } = useTimeline(id);
  // The full contact, or else its row in the list. The row only fills the
  // header while the full contact loads, and is never stored as the contact.
  const queryClient = useQueryClient();
  const known =
    contact ??
    queryClient
      .getQueryData<Contact[]>(["contacts"])
      ?.find((row) => row.id === id);

  usePageTitle(known?.name ?? null);

  // `t` tracks or untracks this contact, as the header button does.
  useTrackShortcut(contact);

  // Only `mutate` and `mutateAsync` keep one identity. A result object is new
  // each render, and in a memoized child's props it redraws that child.
  const { mutate: updateContact, mutateAsync: saveContact } =
    useUpdateContact();
  const { mutate: addAttachment } = useAddAttachment();
  const { mutate: deleteContact } = useDeleteContact();
  const { mutate: restoreContact } = useRestoreContact();
  const { mutateAsync: deleteInteraction } = useDeleteInteraction();
  const { mutateAsync: updateInteraction } = useUpdateInteraction();
  const generateBriefing = useGenerateBriefing();
  const { mutate: promoteGhost, isPending: promoting } = usePromoteGhost();
  const { mutate: archiveContact, isPending: archiving } = useArchiveContact();
  const { mutate: unarchiveContact, isPending: unarchiving } =
    useUnarchiveContact();

  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  /** The pencil on the avatar, where focus goes back when the picker closes. */
  const avatarEdit = useRef<HTMLButtonElement>(null);
  // `?brief=1` (the palette's "Catch me up") opens the Dossier and focuses its
  // Briefing card. The flag leaves the URL at once, so Back or a reload does
  // not ask for a briefing again.
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
  // A field the Research card asks to open when research found no page.
  // Narrow, the Details tab opens first. The field spends the request once
  // open, so a later visit to the tab does not open it again.
  const [detailRequest, setDetailRequest] = useState<DetailRequest | null>(
    null,
  );
  const spendDetailRequest = useCallback(() => setDetailRequest(null), []);

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
  // Wide, Details is always on screen, so a Details tab chosen narrow shows
  // the timeline once the pane widens.
  const mainTab: Section = activeTab === "dossier" ? "dossier" : "timeline";

  // With AI off, the server saves an .eml with no summary, like any file.
  const aiAllowed = useAiAllowed();
  const onDrop = useCallback(
    (acceptedFiles: globalThis.File[]) => {
      if (acceptedFiles.length > 0 && id) {
        acceptedFiles.forEach((file) => {
          const isEml = file.name.toLowerCase().endsWith(".eml");
          const toastId = toast.loading(
            isEml && aiAllowed
              ? `Summarizing the email with AI…`
              : `Uploading "${file.name}"…`,
          );

          addAttachment(
            { contactId: id, file },
            {
              onSuccess: (interaction) => {
                toast.dismiss(toastId);
                toast.success(
                  isEml && interaction.content
                    ? `Email attached and summarized`
                    : `Attached "${file.name}"`,
                );
              },
              onError: (err) => {
                toast.dismiss(toastId);
                toast.error(
                  `Could not attach "${file.name}": ${errorText(err)}`,
                );
              },
            },
          );
        });
      }
    },
    [id, addAttachment, aiAllowed],
  );

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    open: chooseFiles,
  } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    // react-dropzone 19.2 uploads on paste by default. This root wraps the
    // note composer, so a screenshot pasted into a note becomes a file.
    noPaste: true,
    accept: DROP_ACCEPT,
  });

  // A failed save returns its error, so a field shows the server's reason
  // ("Name is required"), not only "Save failed".
  const handleUpdate = useCallback(
    async (field: string, val: string) => {
      try {
        await saveContact({ id, data: { [field]: val } });
        return true;
      } catch (err) {
        return err instanceof Error ? err : false;
      }
    },
    [id, saveContact],
  );
  const openAvatarPicker = useCallback(() => setIsAvatarPickerOpen(true), []);

  // No confirm dialog: the delete is a soft delete into Trash, and an Undo
  // toast takes it back. The bulk path makes the same trade (lib/undoToast).
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
              // On its own page, Undo opens the contact again. Over another
              // page, the person stays on that page.
              onSuccess: onDeleted
                ? undefined
                : () => navigate(`/contact/${id}`),
              onError: (err) =>
                toast.error(`Could not restore: ${errorText(err)}`),
            });
          },
        });
        if (onDeleted) return onDeleted();
        navigate("/");
        if (onClose) onClose();
      },
      onError: (err) => toast.error(`Could not delete: ${errorText(err)}`),
    });
  }, [id, name, deleteContact, restoreContact, navigate, onClose, onDeleted]);

  // The vibe replaces the primary palette on this page, derived for the mode
  // on screen: light values on a dark page put the brand blue at 2.84:1.
  // Every accent token follows, `text-on-primary-wash` too.
  const themeStyles = Object.fromEntries(
    Object.entries(vibeTokens(known?.themeColor, mode)).map(
      ([token, value]) => [`--color-${token}`, value],
    ),
  ) as React.CSSProperties;

  // A merged contact draws nothing editable while it redirects.
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
          <LoadFailed what="the contact" onRetry={() => void refetch()} />
        )}
      </div>
    );
  // The duplicate banner mounts while loading, so its request goes out
  // beside the contact's.
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

          <DupeBanner contactId={id} />

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

          {/* One grid for both layouts, so crossing 768 px does not remount
              the timeline and its composer. */}
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
                    // Sticky only while it fits the view, so the last field
                    // of a taller column stays in reach.
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
                      onAttach={chooseFiles}
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
