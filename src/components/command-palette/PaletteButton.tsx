/**
 * The command palette's button, for a touch screen, which has no ⌘K.
 *
 * Every page header has it (`PageHeader`, the contact's back bar), so a
 * phone opens the palette from any page. Only the Network list had one,
 * so Pulse, Ask, Settings and a contact had no way in. A mouse and a
 * keyboard do not see it.
 *
 * @module components/command-palette/PaletteButton
 */
import { Search } from "lucide-react";
import { openCommandPalette } from "../../lib/appEvents";
import { ICON_BTN } from "../../lib/styles";
import { cn } from "../../lib/utils";

export const PaletteButton = ({ className }: { className?: string }) => (
  <button
    type="button"
    onClick={openCommandPalette}
    className={cn(ICON_BTN, "hidden pointer-coarse:inline-flex", className)}
    aria-label="Command palette"
    title="Command palette"
  >
    <Search className="w-5 h-5" aria-hidden="true" />
  </button>
);
