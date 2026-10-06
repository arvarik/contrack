/**
 * The command palette's button, for a touch screen, which has no ⌘K.
 *
 * Every page header has it (`PageHeader`, the contact's back bar), so a
 * phone opens the palette from any page. Only the Network list had one,
 * so Pulse, Ask, Settings and a contact had no way in. A mouse has the
 * sidebar's button instead. The glyph is the palette's own, not a
 * magnifier: the Network header showed two magnifiers side by side, the
 * palette's and the search field's.
 *
 * @module components/command-palette/PaletteButton
 */
import { Command } from "lucide-react";
import { openCommandPalette } from "../../lib/appEvents";
import { ICON_BTN } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { RailTooltip } from "../ui/RailTooltip";

export const PaletteButton = ({ className }: { className?: string }) => (
  // A touch screen's button, so a long press names it (`RailTooltip`). It
  // sits at a header's right end, so the label opens leftward.
  <RailTooltip
    label="Command palette"
    side="bottom-end"
    className="hidden pointer-coarse:flex shrink-0"
  >
    <button
      type="button"
      onClick={openCommandPalette}
      className={cn(ICON_BTN, className)}
      aria-label="Command palette"
    >
      <Command className="w-5 h-5" aria-hidden="true" />
    </button>
  </RailTooltip>
);
