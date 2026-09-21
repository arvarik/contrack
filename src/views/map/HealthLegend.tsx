import React from "react";
import { NOT_TRACKED_TEXT, SCORE_BANDS } from "../../../shared/scoreBand";

/**
 * HealthLegend — Bottom-right legend chip for the health map layer.
 *
 * Shows the three relationship score bands, Strong, Fading and At risk, with
 * their theme colour tokens and a visible text label each, so colour is never
 * the only signal. A fourth swatch names the neutral ring: a pin nobody
 * tracks has no score and no band.
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
      <div className="flex items-center gap-1.5">
        <span
          className="w-2.5 h-2.5 rounded-full bg-success ring-1 ring-black/10 shrink-0"
          aria-hidden="true"
        />
        <span className="font-medium">{SCORE_BANDS.strong.label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className="w-2.5 h-2.5 rounded-full bg-warning ring-1 ring-black/10 shrink-0"
          aria-hidden="true"
        />
        <span className="font-medium">{SCORE_BANDS.fading.label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className="w-2.5 h-2.5 rounded-full bg-error ring-1 ring-black/10 shrink-0"
          aria-hidden="true"
        />
        <span className="font-medium">{SCORE_BANDS["at-risk"].label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className="w-2.5 h-2.5 rounded-full bg-outline-variant ring-1 ring-black/10 shrink-0"
          aria-hidden="true"
        />
        <span className="font-medium">{NOT_TRACKED_TEXT}</span>
      </div>
    </div>
  );
};
