/**
 * The card in the hand, folded to its title, where it will land
 * ("Intelligence · 2 of 4") and its grip. A full card under the pointer hid
 * the page. `PulseGrid` renders it in dnd-kit's `DragOverlay`, in a portal,
 * so it floats over every stacking context. A screen reader hears the drag's
 * announcements instead. It uses no dnd-kit hook, as the overlay requires.
 */
import { memo } from "react";
import { GripVertical } from "lucide-react";
import { MetaDot } from "../../../components/ui/MetaDot";
import { cn } from "../../../lib/utils";
import { DRAG_PREVIEW, PULSE_TYPE } from "../lib/pulseStyles";

interface DragPreviewProps {
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
      {/* The grip the person pressed, placed by `DRAG_GRIP_OFFSET`. */}
      <span className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary">
        <GripVertical className="w-4 h-4" />
      </span>
    </div>
  );
});
