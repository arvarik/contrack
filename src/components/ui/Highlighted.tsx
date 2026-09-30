/**
 * Text with the words a search matched marked. Each match is a plain
 * `mark`: the base layer paints the highlighter and the ink (`index.css`).
 *
 * The ranges are [start, end) offsets into `text`, sorted. A range that
 * overlaps the one before it, or runs past the text, is skipped.
 *
 * @module components/ui/Highlighted
 */
import React from "react";
import type { HighlightRange } from "../../types";

export const Highlighted = ({
  text,
  ranges,
}: {
  text: string;
  ranges: readonly HighlightRange[];
}) => {
  if (!ranges.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], i) => {
    if (start < cursor || end <= start || end > text.length) return;
    if (start > cursor)
      parts.push(
        <React.Fragment key={`t${i}`}>
          {text.slice(cursor, start)}
        </React.Fragment>,
      );
    parts.push(<mark key={`m${i}`}>{text.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < text.length)
    parts.push(
      <React.Fragment key="tail">{text.slice(cursor)}</React.Fragment>,
    );
  return <>{parts}</>;
};
