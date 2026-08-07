import React, { useState } from "react";
import {
  X,
  UserPlus,
  Calendar as CalendarIcon,
  ExternalLink,
} from "lucide-react";
import { motion } from "motion/react";
import { DashboardPayload } from "../../api";
import { SECTION_HEADING, CARD_COMPACT } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { format, formatDistanceToNow, isSameDay } from "date-fns";
import { FloatingContactCard } from "../../components/FloatingContactCard";
import { Modal } from "../../components/ui/Modal";

interface NetworkGrowthModalProps {
  isOpen: boolean;
  onClose: () => void;
  timeline: DashboardPayload["networkGrowthTimeline30d"];
  totalCount: number;
}

export const NetworkGrowthModal = ({
  isOpen,
  onClose,
  timeline,
  totalCount,
}: NetworkGrowthModalProps) => {
  const [floatingContactId, setFloatingContactId] = useState<string | null>(
    null,
  );

  if (!timeline) return null;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        {/* Header */}
        <div className="px-6 py-5 bg-surface-container-low flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <UserPlus className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-on-surface">
                Network Growth
              </h2>
              <p className="text-xs text-on-surface-variant font-medium flex items-center gap-1.5 mt-0.5">
                <CalendarIcon className="w-3 h-3 opacity-70" /> 30-Day Pipeline
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-surface-container transition-colors text-on-surface-variant hover:text-on-surface"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feed Content */}
        <div className="p-6 sm:p-8 overflow-y-auto nice-scrollbar bg-surface-container-lowest relative">
          <div className="mb-6 flex items-center gap-2">
            <span className={SECTION_HEADING}>Recently Added Contacts</span>
            <span className="px-2.5 py-0.5 rounded-full bg-surface-container-high text-xs font-mono font-bold text-on-surface-variant">
              {totalCount} Total
            </span>
          </div>

          {timeline.length === 0 ? (
            <div className="text-center py-10 text-on-surface-variant text-sm font-medium bg-surface-container-low rounded-2xl">
              No new contacts met in the last 30 days.
            </div>
          ) : (
            <div className="relative border-l-2 border-surface-container-high ml-4 space-y-8 pb-4">
              {timeline.map((contact, index) => {
                const addedDate = new Date(contact.addedAt);
                const isToday = isSameDay(addedDate, new Date());
                const relativeTime = isToday
                  ? "Today"
                  : formatDistanceToNow(addedDate, { addSuffix: true });

                return (
                  <motion.div
                    key={contact.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + index * 0.05 }}
                    className="relative pl-6 sm:pl-8 group"
                  >
                    {/* Timeline dot */}
                    <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-primary ring-4 ring-surface-container-lowest" />

                    <div className="mb-2">
                      <span className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant">
                        {relativeTime} • {format(addedDate, "MMM d, yyyy")}
                      </span>
                    </div>

                    <button
                      onClick={() => setFloatingContactId(contact.id)}
                      className={cn(
                        CARD_COMPACT,
                        "w-full text-left flex items-center gap-4 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 group/btn bg-surface-container",
                      )}
                    >
                      <div
                        className="w-12 h-12 rounded-full shadow-sm flex items-center justify-center font-bold text-white text-sm bg-cover bg-center shrink-0"
                        style={{
                          backgroundColor: contact.themeColor,
                          backgroundImage: contact.avatarUrl
                            ? `url(${contact.avatarUrl})`
                            : "none",
                        }}
                      >
                        {!contact.avatarUrl &&
                          contact.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-on-surface truncate group-hover/btn:text-primary transition-colors">
                            {contact.name}
                          </h3>
                        </div>
                        {contact.company && (
                          <p className="text-xs font-semibold text-on-surface-variant truncate mt-0.5">
                            {contact.company}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 p-2 text-on-surface-variant opacity-0 group-hover/btn:opacity-100 transition-opacity">
                        <ExternalLink className="w-4 h-4" />
                      </div>
                    </button>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

      <FloatingContactCard
        contactId={floatingContactId}
        isOpen={!!floatingContactId}
        onClose={() => setFloatingContactId(null)}
      />
    </>
  );
};
