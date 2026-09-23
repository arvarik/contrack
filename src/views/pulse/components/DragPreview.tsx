/**
 * DragPreview: the card in the hand while it moves.
 *
 * The drag used to move the card itself, all of it, under the pointer at 60
 * percent opacity: Up next was 800 px of see-through queue over the places
 * a person was trying to see. The preview is the card folded to its face,
 * three facts at most: the title, where the card will land ("Intelligence ·
 * 2 of 4"), and the grip, which sits under the pointer that picked it up.
 * It is lifted by a hairline and a deep shadow, and it never turns or
 * scales, which blurs words.
 *
 * `PulseGrid` renders it inside dnd-kit's `DragOverlay`, in a portal, so it
 * floats over every stacking context. It is a picture: a screen reader hears
 * the drag's announcements instead, and the preview is hidden from it. It
 * uses no dnd-kit hook, as the overlay requires.
 */
import { memo } from "react";
import { GripVertical } from "lucide-react";
import { MetaDot } from "../../../components/ui/MetaDot";
import { cn } from "../../../lib/utils";
import { DRAG_PREVIEW, PULSE_TYPE } from "../lib/pulseStyles";

export interface DragPreviewProps {
  /** The card's title. */
  title: string;
  /** The column the card lands in, by name. */
  column: string;
  /** Its place there, counted from 1, and how many cards the column holds. */
  position: number;
  total: number;
  /** The preview's width in px. */
  width: number;
}

export const DragPreview = memo(function DragPreview({
  title,
  column,
  position,
  total,
  width,
}: DragPreviewProps) {
  return (
    <div
      aria-hidden="true"
      data-drag-preview=""
      className={DRAG_PREVIEW}
      style={{ width }}
    >
      <div className="min-w-0 flex-1">
        <p className={cn(PULSE_TYPE.cardTitle, "truncate")}>{title}</p>
        <p className={cn(PULSE_TYPE.meta, "truncate tabular-nums")}>
          {column} <MetaDot /> {position} of {total}
        </p>
      </div>
      {/* The grip, lit: the same glyph the person pressed, in the same
          32 px box, 16 px from the edge (`DRAG_GRIP_OFFSET`). */}
      <span className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary">
        <GripVertical className="w-4 h-4" />
      </span>
    </div>
  );
});
