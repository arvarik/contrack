/**
 * A contact's picture, with a ring for the relationship score. Three states,
 * from `scoreView` in `shared/scoreBand.ts`:
 *
 * 1. `untracked`: no ring. The picture fills the box.
 * 2. `unscored`: tracked, nothing logged. The faint track with no arc.
 * 3. `scored`: an arc of the score's percent, clockwise from the top, in the
 *    band's tone.
 *
 * The ring is an image named in words ("Score 72, strong"), also its
 * tooltip. It is 2 px in a list and 3.5 px in the contact header. The gray
 * disc behind the picture is for the drawn fallback only.
 */
import React, { useState } from "react";

import { describeScore, scoreView } from "../../shared/scoreBand";
import { fallbackAvatarUrl, isGeneratedAvatar } from "../lib/avatar";
import { cn } from "../lib/utils";
import { keepLoadedImage } from "../lib/keptImages";

/** The ring's stroke width for each place an avatar appears, in px. */
export const RING_WIDTH = { list: 2, header: 3.5 } as const;

export interface ScoreRingAvatarProps {
  contact: {
    name: string;
    avatarUrl?: string | null;
    /**
     * False draws the picture alone. Required, so every caller must pass it.
     */
    isTracked: boolean;
    relationshipScore?: number | null;
    lastContactedAt?: string | null;
  };
  /** The outer size, ring included, in px. */
  size?: number;
  /** `list` draws a 2 px ring and `header` a 3.5 px ring. */
  ring?: keyof typeof RING_WIDTH;
  /**
   * True when something beside the avatar already says the score. The ring
   * is then hidden from a screen reader and has no tooltip.
   */
  decorative?: boolean;
}

export const ScoreRingAvatar: React.FC<ScoreRingAvatarProps> = ({
  contact,
  size = 48,
  ring = "list",
  decorative = false,
}) => {
  const strokeWidth = RING_WIDTH[ring];
  const radius = size / 2 - strokeWidth;
  const circumference = 2 * Math.PI * radius;

  const view = scoreView(contact);
  const tracked = view.kind !== "untracked";
  const score = view.kind === "scored" ? view.score : null;
  const words = tracked ? describeScore(score) : null;

  // The picture sits inside the ring with a gap of one and a half strokes.
  // Without a ring it takes the whole box.
  const picture = tracked ? size - strokeWidth * 4 : size;
  const photo = !isGeneratedAvatar(contact.avatarUrl);
  const src = contact.avatarUrl || fallbackAvatarUrl(contact.name);
  // A picture that did not load, such as every avatar while the server is
  // down: the first letter on the plain circle, not a broken image.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const broken = brokenSrc === src;

  return (
    <div
      className="relative shrink-0 flex items-center justify-center"
      style={{ width: size, height: size }}
      data-score-band={view.kind === "scored" ? view.band.band : view.kind}
      {...(decorative || !words
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": words, title: words })}
    >
      {tracked && (
        <svg
          width={size}
          height={size}
          aria-hidden="true"
          className="absolute inset-0 -rotate-90 pointer-events-none"
        >
          {/* The track: the whole circle, so a short arc reads as a ring. */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-surface-container-highest)"
            strokeWidth={strokeWidth}
          />
          {view.kind === "scored" && view.score > 0 && (
            <circle
              data-ring-arc
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={`var(--color-${view.band.token})`}
              strokeWidth={strokeWidth}
              // Butt ends, so the drawn length is the score and not the score
              // plus two round caps.
              strokeLinecap="butt"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - view.score / 100)}
            />
          )}
        </svg>
      )}

      <div
        className={cn(
          "absolute m-auto overflow-hidden rounded-full flex items-center justify-center shrink-0",
          (!photo || broken) && "bg-surface-container-highest",
        )}
        style={{ width: picture, height: picture }}
      >
        {/* The name is printed beside it, so the picture says nothing more.
            A loaded picture is kept, so a rebuilt list paints it at once
            (`keptImages`). */}
        {broken ? (
          <span
            aria-hidden="true"
            className="font-headline font-bold text-on-surface-variant"
            style={{ fontSize: Math.max(11, picture * 0.4) }}
          >
            {contact.name.trim().charAt(0).toUpperCase()}
          </span>
        ) : (
          <img
            src={src}
            alt=""
            onLoad={keepLoadedImage}
            onError={() => setBrokenSrc(src)}
            className="w-full h-full object-cover shrink-0"
          />
        )}
      </div>
    </div>
  );
};
