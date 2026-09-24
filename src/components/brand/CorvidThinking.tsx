/**
 * CorvidThinking — the bird tilts its head while the AI works.
 *
 * One indicator, in three places that each had their own: the synthesis bar's
 * spinner, the refresh icon that spun while a contact enriched, and the
 * briefing card's pending state. A spinner says "something is happening"; a
 * bird with its head on one side says "something is thinking about this",
 * which is the truer description of what those three are waiting for.
 *
 * The glyph rather than the full mark, because this is a 20 px slot and the
 * chest and the tail smear at that size. It is the same drawing either way.
 * Only the head moves: it cocks, looks up, and dips as if at something, while
 * the ring and the wing hold still. Each instance runs at its own pace from
 * its own place in the loop.
 *
 * It names itself "Thinking" by default, so replacing a silent spinner with a
 * picture adds a word rather than a mystery. Where the surface already says
 * what is happening in text, such as "Synthesizing…" next to it, pass
 * `decorative` and the bird stays out of the accessibility tree: a screen
 * reader should hear the sentence once.
 *
 * At level "off" it is the static glyph. Nothing about the waiting is lost:
 * every caller shows or says what it is waiting for in words as well.
 */
import { useState, type CSSProperties } from "react";
import { cn } from "../../lib/utils";
import { CorvidMark } from "./CorvidMark";
import { useCorvidLevel } from "../../hooks/useCorvidLevel";

/** The class that runs the head-tilt loop. Matches the keyframe in `index.css`. */
export const THINKING_CLASS = "corvid-thinking";

export interface CorvidThinkingProps {
  /** Rendered width and height, in CSS pixels. */
  size?: number;
  /** `true` keeps it out of the accessibility tree, where text says it too. */
  decorative?: boolean;
  className?: string;
}

export const CorvidThinking = ({
  size = 20,
  decorative = false,
  className,
}: CorvidThinkingProps) => {
  const level = useCorvidLevel();
  // Each bird keeps its own time, so two thinking at once never nod in step.
  const [rhythm] = useState(() => ({
    period: 2.1 + Math.random() * 0.9,
    offset: -Math.random() * 2.4,
  }));

  return (
    <CorvidMark
      variant="glyph"
      size={size}
      decorative={decorative}
      label="Thinking"
      className={cn(level !== "off" && THINKING_CLASS, className)}
      style={
        {
          "--corvid-think": `${rhythm.period.toFixed(2)}s`,
          "--corvid-think-offset": `${rhythm.offset.toFixed(2)}s`,
        } as CSSProperties
      }
    />
  );
};
