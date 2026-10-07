/**
 * The parts every settings page is made of. The shell draws a page's header
 * outside the page, so both take their width and gutters from `SETTINGS_BOX`
 * to line the title up with the first card.
 */
import { CARD, PAGE_X, SECTION_HEADING } from "../../lib/styles";
import { cn } from "../../lib/utils";

/** The box the header and the page share: centered, at most 56rem wide. */
export const SETTINGS_BOX = cn(PAGE_X, "w-full max-w-4xl mx-auto");

/** The shell draws the page's end: Reset to defaults and tab bar room. */
export const SETTINGS_PAGE = cn(SETTINGS_BOX, "pt-4");

export const SETTINGS_CARD = cn(CARD, "p-4 sm:p-6");

/** The heading over a card ("Profile", "Who can join"), in line with the card's text. */
export const SETTINGS_SECTION_HEADING = cn(SECTION_HEADING, "px-1 mb-2");

/** A link in a line of text, 44 px tall on a touch screen only. */
export const TOUCH_LINK =
  "pointer-coarse:inline-flex pointer-coarse:items-center pointer-coarse:min-h-[44px]";

export const SETTINGS_LABEL = "block text-xs font-bold text-on-surface";

/**
 * The highest container tone reads against the card in both palettes. The
 * 16 px type on a phone stops iOS from zooming on focus.
 */
export const SETTINGS_INPUT =
  "w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-surface-container-highest text-on-surface text-base sm:text-sm placeholder:text-on-surface-variant disabled:opacity-60 disabled:cursor-not-allowed";
