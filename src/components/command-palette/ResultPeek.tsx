/**
 * ResultPeek — Shift-hold tooltip for deep profile preview in Cmd+K results.
 *
 * Appears after 200ms of holding Shift when a search result is focused.
 * Shows enriched metadata that goes beyond what's visible in the result card:
 *   - Relationship score bar (visual gauge)
 *   - Last interaction title + date
 *   - Top 3 tags
 *   - Pending action item count
 *
 * A portal on `document.body`, fixed to the right of the palette. Inside the
 * palette's panel it was clipped: the panel's backdrop filter and its entry
 * transform make it the containing block of anything `fixed` in it, and its
 * `overflow: hidden` cut the card to its last 56 px.
 * Uses data already present in the Contact/SemanticMatch payload (no API calls).
 *
 * @module src/components/command-palette/ResultPeek
 */
import React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { Activity, Tag, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { NOT_TRACKED_TEXT, scoreView } from "../../../shared/scoreBand";
import { TONE_DOT } from "../../lib/styles";
import { fallbackAvatarUrl } from "../../lib/avatar";
import { DURATION, EASE } from "../../lib/motion";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PeekContact {
  id: string;
  name: string;
  avatarUrl?: string | null;
  role?: string | null;
  company?: string | null;
  isTracked: boolean;
  relationshipScore?: number | null;
  lastContactedAt?: string | null;
  tags?: Array<{ tag: string }>;
  updatedAt?: string | null;
}

interface ResultPeekProps {
  contact: PeekContact | null;
  visible: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const ResultPeek = ({ contact, visible }: ResultPeekProps) => {
  // The same reader as the ring, so the peek and the ring always agree. A
  // contact nobody tracks has no bar, and neither has one with nothing
  // logged yet. The bar takes its band's tone (`SCORE_BANDS`), the token the
  // ring strokes with, so the two agree on the colour too.
  const view = contact ? scoreView(contact) : null;
  return createPortal(
    <AnimatePresence>
      {visible && contact && (
        <motion.div
          key="result-peek"
          initial={{ opacity: 0, x: -8, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -4, scale: 0.97 }}
          transition={{ duration: DURATION.fast, ease: EASE }}
          aria-hidden="true"
          className="fixed top-1/2 -translate-y-1/2 z-[200] pointer-events-none"
          // Beside the palette (672 px wide, centred) with an 8 px gap, and
          // over its right edge in a window too narrow for both.
          style={{ left: "min(calc(50% + 344px), calc(100% - 17rem))" }}
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
            {view?.kind === "scored" && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-on-surface-variant flex items-center gap-1">
                    <Activity className="w-3 h-3" />
                    Relationship
                  </span>
                  <span className="font-bold text-on-surface">
                    {view.score}, {view.band.label}
                  </span>
                </div>
                <div className="h-1.5 bg-surface-container rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${TONE_DOT[view.band.token]}`}
                    style={{ width: `${view.score}%` }}
                  />
                </div>
              </div>
            )}

            {/* No bar for a contact nobody tracks. The peek says why, so the
                reader does not read the missing bar as a bad score. */}
            {view?.kind === "untracked" && (
              <div className="flex items-center gap-1 text-[11px] text-on-surface-variant">
                <Activity className="w-3 h-3" />
                {NOT_TRACKED_TEXT}
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
                <span className="text-[11px] uppercase tracking-[0.08em] text-on-surface-variant font-bold flex items-center gap-1">
                  <Tag className="w-2.5 h-2.5" />
                  Tags
                </span>
                <div className="flex flex-wrap gap-1">
                  {contact.tags.slice(0, 5).map((t) => (
                    <span
                      key={t.tag}
                      className="text-[11px] bg-primary/8 text-primary px-1.5 py-0.5 rounded-md font-medium"
                    >
                      {t.tag}
                    </span>
                  ))}
                  {contact.tags.length > 5 && (
                    <span className="text-[11px] text-on-surface-variant">
                      +{contact.tags.length - 5}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Hint */}
            <div className="text-[11px] text-on-surface-variant text-center mt-1">
              Release Shift to dismiss
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
