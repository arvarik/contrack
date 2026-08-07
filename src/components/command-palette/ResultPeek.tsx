/**
 * ResultPeek — Space-hold tooltip for deep profile preview in Cmd+K results.
 *
 * Appears after 200ms of holding the Space key when a search result is focused.
 * Shows enriched metadata that goes beyond what's visible in the result card:
 *   - Relationship score bar (visual gauge)
 *   - Last interaction title + date
 *   - Top 3 tags
 *   - Pending action item count
 *
 * Positioned as a fixed portal card — appears to the right of the palette.
 * Uses data already present in the Contact/SemanticMatch payload (no API calls).
 *
 * @module src/components/command-palette/ResultPeek
 */
import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Activity, Tag, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fallbackAvatarUrl } from "../../lib/avatar";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PeekContact {
  id: string;
  name: string;
  avatarUrl?: string | null;
  role?: string | null;
  company?: string | null;
  relationshipScore?: number | null;
  lastContactedAt?: string | null;
  tags?: Array<{ tag: string }>;
  updatedAt?: string | null;
}

interface ResultPeekProps {
  contact: PeekContact | null;
  visible: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const scoreBarColor = (score: number): string => {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-rose-500";
};

const scoreLabel = (score: number): string => {
  if (score >= 70) return "Strong";
  if (score >= 40) return "Moderate";
  return "At risk";
};

// ─── Component ───────────────────────────────────────────────────────────────

export const ResultPeek = ({ contact, visible }: ResultPeekProps) => {
  return (
    <AnimatePresence>
      {visible && contact && (
        <motion.div
          key="result-peek"
          initial={{ opacity: 0, x: -8, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -4, scale: 0.97 }}
          transition={{ duration: 0.15 }}
          className="fixed top-1/2 -translate-y-1/2 z-[200] pointer-events-none"
          style={{ left: "calc(50% + 280px)" }}
        >
          <div className="w-64 bg-surface-container-highest/95 backdrop-blur-xl rounded-2xl shadow-2xl ring-1 ring-white/10 p-4 flex flex-col gap-3">
            {/* Header */}
            <div className="flex items-center gap-3">
              <img
                src={contact.avatarUrl || fallbackAvatarUrl(contact.name)}
                alt=""
                className="w-10 h-10 rounded-full bg-surface-container-high object-cover shrink-0"
              />
              <div className="min-w-0">
                <div className="font-bold text-sm text-on-surface truncate">
                  {contact.name}
                </div>
                {(contact.role || contact.company) && (
                  <div className="text-xs text-on-surface-variant truncate">
                    {[contact.role, contact.company]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
              </div>
            </div>

            {/* Score Bar */}
            {contact.relationshipScore != null &&
              contact.relationshipScore > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-on-surface-variant flex items-center gap-1">
                      <Activity className="w-3 h-3" />
                      Relationship
                    </span>
                    <span className="font-bold text-on-surface">
                      {contact.relationshipScore} —{" "}
                      {scoreLabel(contact.relationshipScore)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-surface-container rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${scoreBarColor(contact.relationshipScore)}`}
                      style={{
                        width: `${Math.min(100, contact.relationshipScore)}%`,
                      }}
                    />
                  </div>
                </div>
              )}

            {/* Last Contact */}
            {contact.lastContactedAt && (
              <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
                <Clock className="w-3 h-3 shrink-0" />
                <span>
                  Last contact{" "}
                  {(() => {
                    try {
                      return formatDistanceToNow(
                        new Date(contact.lastContactedAt),
                        { addSuffix: true },
                      );
                    } catch {
                      return "unknown";
                    }
                  })()}
                </span>
              </div>
            )}

            {/* Tags */}
            {contact.tags && contact.tags.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold flex items-center gap-1">
                  <Tag className="w-2.5 h-2.5" />
                  Tags
                </span>
                <div className="flex flex-wrap gap-1">
                  {contact.tags.slice(0, 5).map((t) => (
                    <span
                      key={t.tag}
                      className="text-[10px] bg-primary/8 text-primary px-1.5 py-0.5 rounded-md font-medium"
                    >
                      {t.tag}
                    </span>
                  ))}
                  {contact.tags.length > 5 && (
                    <span className="text-[10px] text-on-surface-variant">
                      +{contact.tags.length - 5}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Hint */}
            <div className="text-[9px] text-on-surface-variant text-center mt-1">
              Release Space to dismiss
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
