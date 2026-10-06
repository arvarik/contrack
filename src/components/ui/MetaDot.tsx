/**
 * The middle dot between items on a line of facts ("Sydney · 2:45 AM ·
 * 13°C"), at the letters' middle height and skipped by a screen reader. The
 * caller puts it between items only. A line that can wrap uses `DotLine`.
 */
import type { Key, ReactNode } from "react";
import { cn } from "../../lib/utils";

export const MetaDot = () => <span aria-hidden="true">·</span>;

/**
 * A line of items with a dot between two, which wraps with no dot at the
 * start or the end of a line.
 *
 * 1. Each item, the first too, starts with its dot in a box 1em wide, and
 *    the line breaks only between items. So a line never ends on a dot, and
 *    each line starts with a box.
 * 2. The items sit 1em and their 4 px gap to the left of the line's box,
 *    and the box clips that strip: the box at the start of each line is out
 *    of sight, and its text lines up with the page.
 * 3. The clip reaches past the other three edges, and 8 px past the left,
 *    so tap boxes and focus rings stay whole. A menu opens in the top
 *    layer (`usePanelPlacement`), which no clip reaches.
 */
export const DotLine = ({
  items,
  className,
}: {
  items: { key: Key; node: ReactNode }[];
  className?: string;
}) => (
  <div
    className={cn("[clip-path:inset(-1rem_-1rem_-1rem_-0.5rem)]", className)}
  >
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 -ml-[calc(1em+0.25rem)]">
      {items.map(({ key, node }) => (
        <span
          key={key}
          className="inline-flex items-center gap-x-1 min-w-0 max-w-full"
        >
          <span aria-hidden="true" className="w-[1em] shrink-0 text-center">
            ·
          </span>
          {node}
        </span>
      ))}
    </div>
  </div>
);
