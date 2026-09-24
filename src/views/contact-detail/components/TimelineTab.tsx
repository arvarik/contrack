/**
 * TimelineTab: the "Timeline" tab of a contact. It holds the composer, the
 * file drop zone, the empty state, and the timeline itself.
 *
 * The entries, their menus and the delete with undo live in `Timeline`. This
 * file keeps what belongs to the tab: the drop target, the lazy composer, and
 * the `?interaction=<id>` link that opens one entry.
 *
 * Extracted from ContactProfile to keep each section focused and readable.
 */
import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MessageSquare, UploadCloud } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import type { Interaction } from "../../../types";
import { ComposerPlaceholder } from "../../../components/ComposerPlaceholder";
import { EmptyState } from "../../../components/ui/EmptyState";
import { useHiddenInteractionIds } from "../../../lib/pendingDeletes";
import type { DropzoneRootProps, DropzoneInputProps } from "react-dropzone";
import {
  Timeline,
  type DeleteInteractionMutation,
  type OpenedInteraction,
  type PromoteGhostMutation,
  type UpdateInteractionMutation,
} from "./Timeline";

/**
 * The composer carries TipTap + ProseMirror, which together are the bulk of
 * the contact detail bundle, and the user cannot type into it during the
 * first paint anyway. Splitting it here means the profile and the timeline
 * render from a much smaller chunk while the editor streams in beside them.
 *
 * The import fires on mount rather than on first click. It is a parallel
 * fetch, not a blocking one, so by the time anyone reaches for the keyboard
 * it has almost always landed, without making the first keystroke wait.
 */
const InteractionComposer = React.lazy(() =>
  import("../../../components/InteractionComposer").then((m) => ({
    default: m.InteractionComposer,
  })),
);

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

export interface TimelineTabProps {
  contactId: string;
  /** True after "Log interaction", until the composer has taken focus. */
  composerFocusRequested?: boolean;
  onComposerFocused?: () => void;
  /**
   * True in the narrow contact layout. The composer shows one line until it
   * takes focus.
   */
  composerCollapsible?: boolean;
  timeline: Interaction[];
  timelineLoading: boolean;
  isDragActive: boolean;
  getRootProps: () => DropzoneRootProps;
  getInputProps: () => DropzoneInputProps;

  // Mutations passed from parent
  deleteInteraction: DeleteInteractionMutation;
  updateInteraction: UpdateInteractionMutation;
  promoteGhost: PromoteGhostMutation;
}

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

const TimelineTabInner: React.FC<TimelineTabProps> = ({
  contactId,
  composerFocusRequested = false,
  onComposerFocused,
  composerCollapsible,
  timeline,
  timelineLoading,
  isDragActive,
  getRootProps,
  getInputProps,
  deleteInteraction,
  updateInteraction,
  promoteGhost,
}) => {
  const [opened, setOpened] = useState<OpenedInteraction | null>(null);
  // An entry in its undo window is gone for the reader, so it does not count
  // against the empty state.
  const hidden = useHiddenInteractionIds();
  const hasEntries = timeline.some((item) => !hidden.has(item.id));

  // A note search lands here with `?interaction=<id>`: open that note and
  // scroll to it, then drop the parameter so Back and a reload show the plain
  // timeline. Waits for the timeline to load, and does nothing if the note
  // is not on it, which is what happens after the note is deleted.
  const [searchParams, setSearchParams] = useSearchParams();
  const wantedInteraction = searchParams.get("interaction");
  useEffect(() => {
    if (!wantedInteraction || timelineLoading) return;
    const item = timeline.find(
      (entry) => entry.id === wantedInteraction && !hidden.has(entry.id),
    );
    if (item) {
      setOpened({ interaction: item, editing: false });
      requestAnimationFrame(() => {
        document
          .getElementById(`interaction-${item.id}`)
          ?.scrollIntoView({ block: "center" });
      });
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("interaction");
        return next;
      },
      { replace: true },
    );
  }, [wantedInteraction, timeline, timelineLoading, hidden, setSearchParams]);

  return (
    <div
      className="flex flex-col gap-6 relative timeline-enter"
      {...getRootProps()}
    >
      {/*
        The drop target's own file input. react-dropzone renders it without a
        name, and it is the one form control on the timeline a screen reader
        would otherwise reach as "edit, file".
      */}
      <input {...getInputProps()} aria-label="Attach files to this timeline" />

      {/* Drop Zone Overlay */}
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
              <p className="text-2xl font-bold font-headline text-on-surface">
                Drop file to attach...
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Suspense fallback={<ComposerPlaceholder />}>
        <InteractionComposer
          contactId={contactId}
          focusRequested={composerFocusRequested}
          onFocusHandled={onComposerFocused}
          collapsible={composerCollapsible}
        />
      </Suspense>

      {/* Empty State */}
      {!timelineLoading && !hasEntries && (
        <EmptyState
          icon={MessageSquare}
          title="No interactions yet"
          body="Log a note, a call, a meeting or an email above"
        />
      )}

      {timelineLoading && (
        <div className="text-center p-4 text-on-surface-variant animate-pulse">
          Loading timeline...
        </div>
      )}

      <Timeline
        contactId={contactId}
        timeline={timeline}
        opened={opened}
        onOpenedChange={setOpened}
        deleteInteraction={deleteInteraction}
        updateInteraction={updateInteraction}
        promoteGhost={promoteGhost}
      />
    </div>
  );
};

export const TimelineTab = React.memo(TimelineTabInner);
