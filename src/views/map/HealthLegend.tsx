import React from "react";
import { NOT_TRACKED_TEXT, SCORE_BANDS } from "../../../shared/scoreBand";
import { TONE_DOT, type Tone } from "../../lib/styles";
import { cn } from "../../lib/utils";

/** The legend's three bands, each a dot in its tone. */
const BANDS: { label: string; tone: Tone }[] = [
  { label: SCORE_BANDS.strong.label, tone: SCORE_BANDS.strong.token },
  { label: SCORE_BANDS.fading.label, tone: SCORE_BANDS.fading.token },
  { label: SCORE_BANDS["at-risk"].label, tone: SCORE_BANDS["at-risk"].token },
];

/**
 * HealthLegend — Legend chip for the health map layer. The map page puts it
 * over the stats strip in its bottom-left corner. It sat at the bottom right,
 * where the insights pane covered it on a desktop and the tab bar on a phone.
 *
 * Shows the three relationship score bands, Strong, Fading and At risk, with
 * their tone dots and a visible text label each, so colour is never the only
 * signal. The fourth mark names the pin with no score, a pin nobody tracks:
 * a hollow ring in the variant ink, the ring those pins wear. A filled dot
 * in the hairline tone measured about 1.5 to 1 on the glass, and looked like
 * a fourth band.
 *
 * It wraps onto a second line when an open contact leaves it little room.
 *
 * @module views/map/HealthLegend
 */
export const HealthLegend: React.FC = () => {
  return (
    <div
      role="group"
      aria-label="Health legend"
      className="glass-panel rounded-2xl px-3 py-1.5 border border-outline-variant/30 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface shadow-md pointer-events-none select-none"
    >
      {BANDS.map(({ label, tone }) => (
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
      <div className="flex items-center gap-1.5">
        <span
          className="w-2.5 h-2.5 rounded-full border-2 border-on-surface-variant shrink-0"
          aria-hidden="true"
        />
        <span className="font-medium">{NOT_TRACKED_TEXT}</span>
      </div>
    </div>
  );
};
