/**
 * MetaDot: the middle dot between two items on one line of facts.
 *
 * "Sydney · 2:45 AM · 13°C" under a contact's name, and "3 overdue ·
 * 1 birthday this week" under Pulse's title. The dot sits at the height of
 * the letters' middle, not on the line like a period, and it is decoration:
 * a screen reader skips it. A line that a screen reader reads as one run of
 * text, such as Pulse's, passes `pause`, and the reader hears a comma where
 * the dot is.
 *
 * The caller puts the dot between items, never first or last, and keeps it
 * with the item after it, so a line that wraps never ends on a dot.
 *
 * @module components/ui/MetaDot
 */
import React from "react";

export interface MetaDotProps {
  /** A comma for a screen reader, for a line it reads as one sentence. */
  pause?: boolean;
}

export const MetaDot = ({ pause = false }: MetaDotProps) => (
  <>
    <span aria-hidden="true">·</span>
    {pause && <span className="sr-only">, </span>}
  </>
);
