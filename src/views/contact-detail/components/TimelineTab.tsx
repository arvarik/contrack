/**
 * TimelineTab — The "Timeline" tab content showing the Rich Interaction
 * Composer, file drop zone, and the chronological list of interactions
 * with inline editing, mentions display, and file attachments.
 *
 * Extracted from ContactProfile to keep each section focused and readable.
 */
import React, { Suspense, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Mail,
  Phone,
  FileText,
  Handshake,
  Sparkles,
  UploadCloud,
  Trash2,
  MessageSquare,
  ExternalLink,
  Linkedin,
  Facebook,
  File,
  CalendarCheck,
} from "lucide-react";
import DOMPurify from "dompurify";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";

import type { Interaction } from "../../../types";
import { cn, safeHref } from "../../../lib/utils";
import { TIPTAP_SANITIZE_CONFIG } from "../../../lib/sanitize";
import { EMPTY_STATE } from "../../../lib/styles";
import { ComposerPlaceholder } from "../../../components/ComposerPlaceholder";

/**
 * The composer carries TipTap + ProseMirror, which together are the bulk of
 * the contact detail bundle — and the user cannot type into it during the
 * first paint anyway. Splitting it here means the profile and the timeline
 * render from a much smaller chunk while the editor streams in beside them.
 *
 * The import fires on mount rather than on first click: it is a parallel
 * fetch, not a blocking one, so by the time anyone reaches for the keyboard
 * it has almost always landed — without making the first keystroke wait.
 */
const RichInteractionComposer = React.lazy(() =>
  import("../../../components/RichInteractionComposer").then((m) => ({
    default: m.RichInteractionComposer,
  })),
);
import { InteractionDetailModal } from "./InteractionDetailModal";
import { useCompleteActionItem } from "../../../api";
import type { DropzoneRootProps, DropzoneInputProps } from "react-dropzone";
import { activateOnKey } from "../../../lib/a11y";

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

export interface TimelineTabProps {
  contactId: string;
  timeline: Interaction[];
  timelineLoading: boolean;
  isDragActive: boolean;
  getRootProps: () => DropzoneRootProps;
  getInputProps: () => DropzoneInputProps;

  // Mutations passed from parent
  deleteInteraction: {
    mutate: (
      args: { id: string; contactId: string },
      opts?: { onSuccess?: () => void; onError?: (err: Error) => void },
    ) => void;
  };
  updateInteraction: {
    mutate: (args: {
      id: string;
      contactId: string;
      data: { title?: string; content?: string | null };
    }) => void;
  };
  promoteGhost: {
    mutate: (id: string, opts?: { onSuccess?: () => void }) => void;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Returns the icon component and color classes for a given interaction type. */
function getInteractionStyle(type: string) {
  let Icon = FileText;
  let bgClass = "bg-surface-container";
  let textClass = "text-on-surface";

  if (type === "call") {
    Icon = Phone;
    bgClass = "bg-blue-500/10";
    textClass = "text-info";
  }
  if (type === "meeting") {
    Icon = Handshake;
    bgClass = "bg-emerald-500/10";
    textClass = "text-success";
  }
  if (type === "email") {
    Icon = Mail;
    bgClass = "bg-green-500/10";
    textClass = "text-success";
  }
  if (type === "note") {
    bgClass = "bg-primary/10";
    textClass = "text-primary";
  }
  if (type === "message" || type === "sms") {
    Icon = MessageSquare;
    bgClass = "bg-teal-500/10";
    textClass = "text-success";
  }
  if (type === "linkedin") {
    Icon = Linkedin;
    bgClass = "bg-blue-600/10";
    textClass = "text-info";
  }
  if (type === "facebook") {
    Icon = Facebook;
    bgClass = "bg-blue-500/10";
    textClass = "text-info";
  }
  if (type === "import") {
    Icon = ExternalLink;
    bgClass = "bg-amber-500/10";
    textClass = "text-warning";
  }

  return { Icon, bgClass, textClass };
}

interface ParsedMention {
  contactId: string;
  name: string;
  isGhost?: boolean;
}

/** Safely parse the JSON mentions string. Returns null if empty/invalid. */
function parseMentions(raw: string | null | undefined): ParsedMention[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed;
  } catch (err) {
    console.warn("[TimelineTab] Failed to parse mentions JSON:", err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// InteractionContent — memoized, sanitized rich-text preview for one entry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Memoized so DOMPurify.sanitize doesn't re-run for every timeline entry on
 * each parent render — it only runs when the entry's HTML actually changes.
 */
const InteractionContent = React.memo(({ html }: { html: string }) => {
  const sanitized = useMemo(
    () => DOMPurify.sanitize(html, TIPTAP_SANITIZE_CONFIG),
    [html],
  );
  return (
    <div
      className="prose prose-sm max-w-none text-on-surface-variant leading-relaxed prose-p:my-1 prose-headings:my-2 prose-headings:text-on-surface prose-strong:text-on-surface line-clamp-3 pointer-events-none"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

const TimelineTabInner: React.FC<TimelineTabProps> = ({
  contactId,
  timeline,
  timelineLoading,
  isDragActive,
  getRootProps,
  getInputProps,
  deleteInteraction,
  updateInteraction,
  promoteGhost,
}) => {
  const navigate = useNavigate();
  const [selectedInteraction, setSelectedInteraction] =
    useState<Interaction | null>(null);
  const completeActionItem = useCompleteActionItem();

  const handleDeleteInteraction = (interactionId: string) => {
    deleteInteraction.mutate(
      { id: interactionId, contactId },
      {
        onSuccess: () => toast.success("Interaction deleted"),
        onError: (err: Error) =>
          toast.error(
            `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
      },
    );
  };

  return (
    <div
      className="flex flex-col gap-6 relative timeline-enter"
      {...getRootProps()}
    >
      <input {...getInputProps()} />

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
        <RichInteractionComposer contactId={contactId} />
      </Suspense>

      {/* Empty State */}
      {!timelineLoading && timeline.length === 0 && (
        <div className={EMPTY_STATE}>
          <p className="font-medium text-sm">No interactions logged yet.</p>
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-surface-container-high before:to-transparent">
        {timelineLoading && (
          <div className="text-center p-4 text-on-surface-variant animate-pulse">
            Loading timeline...
          </div>
        )}

        {timeline.map((item: Interaction, index: number) => {
          const { Icon, bgClass, textClass } = getInteractionStyle(item.type);

          return (
            <div
              key={item.id}
              className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active timeline-entry"
              style={{ animationDelay: `${index * 40}ms` }}
            >
              {/* Icon marker */}
              <div
                className={`flex items-center justify-center w-10 h-10 rounded-full border-4 border-surface shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm ${bgClass} ${textClass} z-10 mx-auto absolute left-0 md:left-1/2 -translate-x-0`}
              >
                <Icon className="w-4 h-4" />
              </div>

              {/* Content Box */}
              <div
                onKeyDown={activateOnKey(() => setSelectedInteraction(item))}
                tabIndex={0}
                role="button"
                className="w-[calc(100%-3rem)] md:w-[calc(50%-2.5rem)] ml-auto md:ml-0 p-5 rounded-2xl bg-surface-container-lowest shadow-sm hover:shadow-md transition-shadow relative group/card cursor-pointer"
                onClick={() => setSelectedInteraction(item)}
              >
                <div className="flex justify-between items-center mb-2">
                  <h4 className="font-extrabold text-on-surface">
                    {item.title}
                  </h4>
                  <div className="flex items-center gap-2 shrink-0">
                    <time className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">
                      {new Date(item.date).toLocaleDateString()}
                    </time>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteInteraction(item.id);
                      }}
                      className="opacity-0 group-hover/card:opacity-60 hover:!opacity-100 text-error p-1 rounded transition-opacity"
                      title="Delete interaction"
                      aria-label="Delete interaction"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Via mention badge */}
                {item.isViaName && (
                  <div
                    tabIndex={0}
                    role="button"
                    className="mb-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container border border-surface-container-highest/20 opacity-70 hover:opacity-100 transition-opacity cursor-pointer text-[11px] uppercase tracking-wide text-on-surface-variant font-bold"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/contact/${item.isViaId}`);
                    }}
                    onKeyDown={activateOnKey(() =>
                      navigate(`/contact/${item.isViaId}`),
                    )}
                    title="Navigate to Original Interaction"
                  >
                    <ExternalLink className="w-3 h-3 text-primary" /> via{" "}
                    {item.isViaName}
                  </div>
                )}

                {item.content ? (
                  <InteractionContent html={item.content} />
                ) : null}

                {/* Ghost Mentions */}
                {(() => {
                  const mentions = parseMentions(item.mentions);
                  if (!mentions) return null;
                  return (
                    <div className="mt-4 pt-3 flex flex-wrap gap-2 items-center">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mr-2 flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-primary opacity-60" />{" "}
                        Mentioned:
                      </span>
                      {mentions.map(
                        (
                          mention: {
                            contactId: string;
                            name: string;
                            isGhost?: boolean;
                          },
                          idx: number,
                        ) => {
                          if (mention.isGhost) {
                            return (
                              <button
                                key={idx}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  promoteGhost.mutate(mention.contactId, {
                                    onSuccess: () =>
                                      navigate(`/contact/${mention.contactId}`),
                                  });
                                }}
                                title={`Promote ${mention.name} to Contact`}
                                className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-surface-container-low border border-dashed border-primary hover:bg-surface-container transition-all group/ghost"
                              >
                                <div className="w-5 h-5 rounded-full bg-surface-container-highest flex items-center justify-center text-[10px] font-bold text-on-surface-variant opacity-70 group-hover/ghost:opacity-100 transition-opacity">
                                  {mention.name.charAt(0)}
                                </div>
                                <div className="text-xs font-semibold text-on-surface-variant group-hover/ghost:text-on-surface text-left leading-tight pr-1 opacity-80 group-hover/ghost:opacity-100 transition-opacity">
                                  {mention.name}
                                </div>
                              </button>
                            );
                          }
                          return (
                            <Link
                              key={idx}
                              to={`/contact/${mention.contactId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-surface-container-lowest shadow-sm hover:shadow transition-shadow border border-transparent"
                            >
                              <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
                                {mention.name.charAt(0)}
                              </div>
                              <span className="text-xs font-semibold text-on-surface line-clamp-1">
                                {mention.name}
                              </span>
                            </Link>
                          );
                        },
                      )}
                    </div>
                  );
                })()}

                {/* File Attachment */}
                {item.fileUrl && (
                  <div className="mt-3">
                    {item.fileType?.startsWith("image/") ? (
                      <img
                        src={item.fileUrl}
                        alt={item.fileName || "Attachment"}
                        className="max-w-full rounded-xl shadow-sm object-cover max-h-64"
                      />
                    ) : (
                      <a
                        href={safeHref(item.fileUrl)}
                        download
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-3 p-3 rounded-xl bg-surface-container-low hover:bg-surface-container-high transition-colors w-fit max-w-full overflow-hidden"
                      >
                        <File className="w-8 h-8 text-primary shrink-0 opacity-80" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-on-surface truncate">
                            {item.fileName}
                          </p>
                          <p className="text-xs text-on-surface-variant uppercase tracking-widest font-bold mt-0.5">
                            {item.fileType?.split("/")[1] || "FILE"}
                          </p>
                        </div>
                      </a>
                    )}
                  </div>
                )}

                {/* Follow-up */}
                {item.actionItems && item.actionItems.length > 0 && (
                  <div className="mt-4 pt-3 flex flex-wrap gap-2 items-center border-t border-surface-container/50">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mr-2 flex items-center gap-1">
                      Follow Up:
                    </span>
                    {item.actionItems.map(
                      (
                        action: NonNullable<Interaction["actionItems"]>[number],
                      ) => (
                        <div
                          key={action.id}
                          className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all text-xs font-semibold select-none",
                            action.completedAt
                              ? "bg-surface-container text-on-surface-variant border-surface-container-high line-through opacity-60"
                              : "bg-surface-container-lowest text-on-surface border-surface-container-high shadow-sm",
                          )}
                        >
                          {action.completedAt && (
                            <CalendarCheck className="w-3 h-3 text-on-surface-variant opacity-60" />
                          )}
                          {action.title}
                        </div>
                      ),
                    )}
                  </div>
                )}

                {/* Duration */}
                {item.duration && (
                  <p className="text-xs text-on-surface-variant mt-3 font-medium flex items-center gap-1 opacity-70">
                    Duration: {item.duration}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <InteractionDetailModal
        isOpen={!!selectedInteraction}
        onClose={() => setSelectedInteraction(null)}
        interaction={selectedInteraction}
        onCompleteActionItem={(id) => completeActionItem.mutate(id)}
        onUpdateInteraction={(id, data) =>
          updateInteraction.mutate({ id, contactId, data })
        }
      />
    </div>
  );
};

export const TimelineTab = React.memo(TimelineTabInner);
