import React from "react";
import { NOT_TRACKED_TEXT, SCORE_BANDS } from "../../../shared/scoreBand";
import { TONE_DOT, type Tone } from "../../lib/styles";
import { cn } from "../../lib/utils";

/** The legend's entries: the three bands, then the ring of a pin nobody tracks. */
const ENTRIES: { label: string; tone: Tone }[] = [
  { label: SCORE_BANDS.strong.label, tone: SCORE_BANDS.strong.token },
  { label: SCORE_BANDS.fading.label, tone: SCORE_BANDS.fading.token },
  { label: SCORE_BANDS["at-risk"].label, tone: SCORE_BANDS["at-risk"].token },
  { label: NOT_TRACKED_TEXT, tone: "neutral" },
];

/**
 * HealthLegend — Bottom-right legend chip for the health map layer.
 *
 * Shows the three relationship score bands, Strong, Fading and At risk, with
 * their tone dots and a visible text label each, so colour is never the only
 * signal. A fourth dot names the neutral ring: a pin nobody tracks has no
 * score and no band.
 *
 * @module views/map/HealthLegend
 */
export const HealthLegend: React.FC = () => {
  return (
    <div
      role="group"
      aria-label="Health legend"
      className="absolute bottom-4 right-14 z-10 glass-panel rounded-2xl px-3 py-1.5 border border-outline-variant/30 flex items-center gap-3 text-xs text-on-surface shadow-md pointer-events-none select-none"
    >
      {ENTRIES.map(({ label, tone }) => (
        <div key={label} className="flex items-center gap-1.5">
          <span
            className={cn(
              "w-2.5 h-2.5 rounded-full ring-1 ring-black/10 shrink-0",
              TONE_DOT[tone],
            )}
            aria-hidden="true"
          />
          <span className="font-medium">{label}</span>
        </div>
      ))}
    </div>
  );
};
