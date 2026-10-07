/**
 * The Timeline tab: the lazy composer, the file drop target, the empty
 * state, the `?interaction=<id>` link, and `Timeline` itself.
 */
import React, { Suspense, useEffect, useState } from "react";
import { composerChunk } from "../../../components/composerChunk";
import { useSearchParams } from "react-router-dom";
import { MessageSquare, Paperclip, UploadCloud } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import type { Interaction } from "../../../types";
import { ComposerPlaceholder } from "../../../components/ComposerPlaceholder";
import { EmptyState } from "../../../components/ui/EmptyState";
import { useHiddenPendingIds } from "../../../lib/pendingDeletes";
import { BTN_QUIET, DROPZONE_INPUT } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import type { DropzoneRootProps, DropzoneInputProps } from "react-dropzone";
import {
  Timeline,
  type DeleteInteraction,
  type OpenedInteraction,
  type PromoteGhost,
  type UpdateInteraction,
} from "./Timeline";

/**
 * Lazy: TipTap and ProseMirror are the bulk of the contact page bundle. The
 * import starts on mount, in parallel, so it has usually landed before the
 * first keystroke. Later contact pages render it at once (`composerChunk`).
 */
const InteractionComposer = composerChunk.Component;

export interface TimelineTabProps {
  contactId: string;
  /** Narrow layout: the composer shows one line until it takes focus. */
  composerCollapsible?: boolean;
  timeline: Interaction[];
  timelineLoading: boolean;
  isDragActive: boolean;
  getRootProps: () => DropzoneRootProps;
  getInputProps: () => DropzoneInputProps;
  /** Opens the file picker, for a phone or a keyboard, which cannot drop. */
  onAttach: () => void;
  deleteInteraction: DeleteInteraction;
  updateInteraction: UpdateInteraction;
  promoteGhost: PromoteGhost;
}

const TimelineTabInner: React.FC<TimelineTabProps> = ({
  contactId,
  composerCollapsible,
  timeline,
  timelineLoading,
  isDragActive,
  getRootProps,
  getInputProps,
  onAttach,
  deleteInteraction,
  updateInteraction,
  promoteGhost,
}) => {
  const [opened, setOpened] = useState<OpenedInteraction | null>(null);
  // An entry in its undo window does not count against the empty state.
  const hidden = useHiddenPendingIds();
  const hasEntries = timeline.some((item) => !hidden.has(item.id));

  // `?interaction=<id>` from a note search: once the timeline loads, open
  // and scroll to that note if it is there, then drop the parameter so Back
  // and a reload show the plain timeline.
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
    <div className="flex flex-col gap-6 relative" {...getRootProps()}>
      {/* react-dropzone renders this input with no name, so a screen reader
          would read it as "edit, file". */}
      <input
        {...getInputProps()}
        className={DROPZONE_INPUT}
        aria-label="Attach files to this timeline"
      />

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
                Drop a file to attach it
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Suspense
        fallback={<ComposerPlaceholder collapsed={composerCollapsible} />}
      >
        <InteractionComposer
          contactId={contactId}
          collapsible={composerCollapsible}
        />
      </Suspense>
      <button
        type="button"
        onClick={onAttach}
        className={cn(BTN_QUIET, "self-start -mt-3")}
      >
        <Paperclip aria-hidden="true" className="w-4 h-4" />
        Attach a file
      </button>

      {!timelineLoading && !hasEntries && (
        <EmptyState
          icon={MessageSquare}
          title="No interactions yet"
          body="Log a note, a call, a meeting or an email above"
        />
      )}

      {timelineLoading && (
        <div className="text-center p-4 text-on-surface-variant animate-pulse">
          Loading timeline…
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
