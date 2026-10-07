/**
 * The bird tilts its head while the AI works: one indicator for the
 * synthesis bar, a contact's enrichment and the briefing card. A bird with
 * its head on one side says "something is thinking about this", which is
 * what those wait for.
 *
 * The glyph, not the full mark, because the chest and the tail smear in a
 * 20 px slot. Only the head moves. Each instance runs at its own pace from
 * its own place in the loop.
 *
 * It names itself "Thinking" by default. Where text beside it already says
 * what is happening, such as "Synthesizing…", pass `decorative`, so a screen
 * reader hears the sentence once. At level "off" it is the static glyph, and
 * every caller also says in words what it waits for.
 */
import { useState, type CSSProperties } from "react";
import { cn } from "../../lib/utils";
import { CorvidMark } from "./CorvidMark";
import { useCorvidLevel } from "../../hooks/useCorvidLevel";

/** The class that runs the head-tilt loop. Matches the keyframe in `index.css`. */
export const THINKING_CLASS = "corvid-thinking";

interface CorvidThinkingProps {
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
