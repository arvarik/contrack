/**
 * ScoreRingAvatar: a contact's picture inside a ring that shows the
 * relationship score.
 *
 * The ring used to be the contact's colour (`themeColor`), and people read a
 * red ring as trouble. It now says one thing, the score:
 *
 * 1. The arc length is the score. A score of 72 draws 72 percent of the
 *    circle, clockwise from the top, over a faint full track.
 * 2. The arc colour is the band from `shared/scoreBand.ts`: Strong in the
 *    success colour, Fading in warning, At risk in error.
 * 3. A contact with no logged interaction has no score to show. The track
 *    shows with no arc, and the words say "No interactions yet".
 * 4. Colour is never the only sign. The ring is an image named by the score
 *    in words ("Score 72, strong"), and the same words are its tooltip.
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

import { contactScore, bandInfo, describeScore } from "../../shared/scoreBand";
import { fallbackAvatarUrl, isGeneratedAvatar } from "../lib/avatar";
import { cn } from "../lib/utils";

/** The ring's stroke width for each place an avatar appears, in px. */
export const RING_WIDTH = { list: 2, header: 3.5 } as const;

export interface ScoreRingAvatarProps {
  contact: {
    name: string;
    avatarUrl?: string | null;
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

  const score = contactScore(contact);
  const words = describeScore(score);
  const token = score === null ? null : bandInfo(score).token;

  // The picture sits inside the ring with a gap of one and a half strokes.
  const picture = size - strokeWidth * 4;
  const photo = !isGeneratedAvatar(contact.avatarUrl);

  return (
    <div
      className={cn(
        "relative shrink-0 flex items-center justify-center",
        className,
      )}
      style={{ width: size, height: size }}
      data-score-band={score === null ? "none" : bandInfo(score).band}
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": words, title: words })}
    >
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
        {token && score !== null && score > 0 && (
          <circle
            data-ring-arc
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={`var(--color-${token})`}
            strokeWidth={strokeWidth}
            // Butt ends, so the drawn length is the score and not the score
            // plus two round caps.
            strokeLinecap="butt"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - score / 100)}
          />
        )}
      </svg>

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
