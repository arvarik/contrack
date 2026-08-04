import React from "react";
import { createPortal } from "react-dom";
import DOMPurify from "dompurify";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  CalendarCheck,
  FileText,
  Calendar,
  Mail,
  Phone,
  Handshake,
  ActivitySquare,
} from "lucide-react";
import { Interaction } from "../../../types";
import type { LucideIcon } from "lucide-react";
import { format } from "date-fns";
import { SECTION_HEADING } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { TIPTAP_SANITIZE_CONFIG } from "../../../lib/sanitize";

interface InteractionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  interaction: Interaction | null;
  onCompleteActionItem: (id: string) => void;
  onUpdateInteraction: (id: string, data: Partial<Interaction>) => void;
}

const TYPE_ICONS: Record<string, LucideIcon> = {
  note: FileText,
  call: Phone,
  meeting: Handshake,
  email: Mail,
  default: ActivitySquare,
};

import { Edit2, Save } from "lucide-react";

export const InteractionDetailModal = ({
  isOpen,
  onClose,
  interaction,
  onCompleteActionItem,
  onUpdateInteraction,
}: InteractionDetailModalProps) => {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editingTitle, setEditingTitle] = React.useState("");
  const [editingContent, setEditingContent] = React.useState("");

  React.useEffect(() => {
    if (isOpen && interaction) {
      setEditingTitle(interaction.title);
      setEditingContent(interaction.content || "");
      setIsEditing(false);
    }
  }, [isOpen, interaction]);

  // Sanitize once per content change instead of on every render.
  const sanitizedContent = React.useMemo(
    () =>
      interaction?.content
        ? DOMPurify.sanitize(interaction.content, TIPTAP_SANITIZE_CONFIG)
        : "",
    [interaction?.content],
  );

  if (!interaction) return null;

  const Icon = TYPE_ICONS[interaction.type.toLowerCase()] || TYPE_ICONS.default;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
            animate={{ opacity: 1, backdropFilter: "blur(8px)" }}
            exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
            className="fixed inset-0 z-50 bg-black/40"
            onClick={onClose}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="bg-surface-container-lowest shadow-2xl rounded-3xl w-full max-w-3xl max-h-[90vh] flex flex-col pointer-events-auto overflow-hidden"
            >
              {/* Header */}
              <div className="px-6 py-5 bg-surface-container-low flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-primary/10">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 ml-3 min-w-0 mr-4">
                    {isEditing ? (
                      <input
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        className="text-lg font-bold text-on-surface w-full bg-surface-container-low border border-primary/50 px-2 py-0.5 rounded outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="Interaction Title"
                      />
                    ) : (
                      <h2 className="text-lg font-bold text-on-surface line-clamp-1">
                        {interaction.title}
                      </h2>
                    )}
                    <p className="text-xs text-on-surface-variant font-medium flex items-center gap-1.5 mt-0.5">
                      <Calendar className="w-3 h-3 opacity-70" />{" "}
                      {format(
                        new Date(interaction.date),
                        "MMMM d, yyyy 'at' h:mm a",
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isEditing ? (
                    <button
                      onClick={() => {
                        onUpdateInteraction(interaction.id, {
                          title: editingTitle.trim() || interaction.title,
                          content: editingContent,
                        });
                        setIsEditing(false);
                      }}
                      className="p-2 rounded-xl bg-primary text-white hover:bg-primary/90 transition-colors flex items-center gap-1.5 text-xs font-bold shadow-sm"
                    >
                      <Save className="w-4 h-4" /> Save
                    </button>
                  ) : (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="p-2 flex items-center gap-1.5 text-xs font-bold rounded-xl hover:bg-surface-container transition-colors text-on-surface-variant hover:text-on-surface"
                    >
                      <Edit2 className="w-4 h-4" /> Edit
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="p-2 rounded-full hover:bg-surface-container transition-colors text-on-surface-variant hover:text-on-surface ml-2"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Feed Content */}
              <div className="p-6 sm:p-8 overflow-y-auto nice-scrollbar bg-surface-container-lowest relative flex flex-col gap-8">
                {/* Content */}
                <div>
                  <span className={cn(SECTION_HEADING, "mb-3 block")}>
                    Transcript & Notes
                  </span>
                  {isEditing ? (
                    <textarea
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      className="w-full min-h-[200px] p-3 text-sm rounded-xl bg-surface-container-low border border-primary/50 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
                      placeholder="Enter transcript or notes..."
                    />
                  ) : interaction.content &&
                    interaction.content !== "<p></p>" ? (
                    <div
                      className="prose prose-sm max-w-none text-on-surface prose-p:my-2 prose-headings:my-3 break-words prose-a:text-primary"
                      dangerouslySetInnerHTML={{
                        __html: sanitizedContent,
                      }}
                    />
                  ) : (
                    <span className="text-sm italic opacity-50">
                      No notes provided.
                    </span>
                  )}
                </div>

                {/* Follow-up */}
                {interaction.actionItems &&
                  interaction.actionItems.length > 0 && (
                    <div>
                      <span className={cn(SECTION_HEADING, "mb-3 block")}>
                        Follow Up
                      </span>
                      <div className="flex flex-col gap-2">
                        {interaction.actionItems.map((action) => (
                          <div
                            key={action.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!action.completedAt) {
                                onCompleteActionItem(action.id);
                              }
                            }}
                            className={cn(
                              "flex flex-col gap-1.5 p-3 rounded-xl border bg-surface-container transition-all",
                              action.completedAt
                                ? "opacity-60 saturate-50 border-surface-container-high cursor-default"
                                : "border-surface-container hover:shadow-sm cursor-pointer hover:border-primary/30 group",
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <button
                                className={cn(
                                  "mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                                  action.completedAt
                                    ? "bg-primary border-primary text-white"
                                    : "border-on-surface-variant/40 bg-surface-container-low group-hover:border-primary/50",
                                )}
                              >
                                {action.completedAt && (
                                  <CalendarCheck className="w-3 h-3" />
                                )}
                              </button>
                              <div className="flex flex-col min-w-0">
                                <span
                                  className={cn(
                                    "text-sm font-bold truncate transition-colors",
                                    action.completedAt
                                      ? "text-on-surface-variant line-through"
                                      : "text-on-surface group-hover:text-primary",
                                  )}
                                >
                                  {action.title}
                                </span>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span
                                    className={cn(
                                      "text-[10px] uppercase font-bold tracking-wider",
                                      action.completedAt
                                        ? "text-on-surface-variant/60"
                                        : "text-error opacity-80",
                                    )}
                                  >
                                    Due{" "}
                                    {format(new Date(action.dueAt), "MMM d")}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
};
