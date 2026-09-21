/**
 * ScoreRingAvatar: a contact's picture, with a ring when there is a score to
 * show.
 *
 * The ring says one thing, and it is the relationship score. A score belongs
 * only to a contact somebody tracks, so the ring has three states. They come
 * from `scoreView` in `shared/scoreBand.ts`, which every surface reads:
 *
 * 1. `untracked`: nobody chose to keep up with this contact. No ring and no
 *    track. The picture fills the whole box, so a list of untracked people
 *    reads as a list of faces and not as a wall of empty circles.
 * 2. `unscored`: tracked, with nothing logged yet. The faint track shows with
 *    no arc, and the words say "No interactions yet".
 * 3. `scored`: the arc length is the score. A score of 72 draws 72 percent of
 *    the circle, clockwise from the top, over the track. The arc colour is
 *    the band: Strong in the success colour, Fading in warning, At risk in
 *    error.
 *
 * Colour is never the only sign. The ring is an image named by the score in
 * words ("Score 72, strong"), and the same words are its tooltip.
 *
 * The ring is 2 px in a list and 3.5 px in the contact header. A photo shows
 * on no tint: the grey disc behind the picture is only for the drawn
 * fallback, which has transparent corners.
 *
 * The contact's colour stays on the contact page as its accent, and nowhere
 * else.
 *
 * @module components/ScoreRingAvatar
 */
import React from "react";

import { describeScore, scoreView } from "../../shared/scoreBand";
import { fallbackAvatarUrl, isGeneratedAvatar } from "../lib/avatar";
import { cn } from "../lib/utils";

/** The ring's stroke width for each place an avatar appears, in px. */
export const RING_WIDTH = { list: 2, header: 3.5 } as const;

export interface ScoreRingAvatarProps {
  contact: {
    name: string;
    avatarUrl?: string | null;
    /**
     * A person chose to keep up with this contact. False draws the picture
     * alone. The field is required, so the compiler names every caller that
     * has to pass the flag.
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
   * True when something beside the avatar already says the score, such as a
   * list row whose own name carries it. The ring is then hidden from a screen
   * reader and has no tooltip, so the score is not said twice.
   */
  decorative?: boolean;
  className?: string;
}

export const ScoreRingAvatar: React.FC<ScoreRingAvatarProps> = ({
  contact,
  size = 48,
  ring = "list",
  decorative = false,
  className,
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

  return (
    <div
      className={cn(
        "relative shrink-0 flex items-center justify-center",
        className,
      )}
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
          {/* The track: the whole circle, so an empty or short arc still reads
              as a ring with room left in it. */}
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
          !photo && "bg-surface-container-highest",
        )}
        style={{ width: picture, height: picture }}
      >
        {/* The name is always printed beside the picture, so the picture
            itself says nothing more. */}
        <img
          src={contact.avatarUrl || fallbackAvatarUrl(contact.name)}
          alt=""
          className="w-full h-full object-cover shrink-0"
        />
      </div>
    </div>
  );
};
