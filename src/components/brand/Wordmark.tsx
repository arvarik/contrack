/**
 * Wordmark: the mark and the name, side by side.
 *
 * For a surface wide enough to carry the word: a page header, an about
 * card, a printed export. The rail and the tab strip use the mark alone.
 * The mark takes `text-primary` and follows the accent; the word is set in
 * the headline face on `text-on-surface`, like every other heading.
 */
import React from "react";
import { cn } from "../../lib/utils";
import { CorvidMark } from "./CorvidMark";

export interface WordmarkProps {
  /** The mark's height, in CSS pixels. The word scales with it. */
  size?: number;
  className?: string;
}

export const Wordmark = ({ size = 28, className }: WordmarkProps) => (
  <span className={cn("inline-flex items-center gap-2 select-none", className)}>
    <CorvidMark size={size} className="text-primary shrink-0" />
    <span
      className="font-headline font-extrabold tracking-tight text-on-surface leading-none"
      style={{ fontSize: Math.round(size * 0.7) }}
    >
      Contrack
    </span>
  </span>
);
