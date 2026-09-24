/**
 * The settings page box, and the parts every settings page is made of.
 *
 * The shell draws each page's header above the page, so the header and the
 * page are two elements that have to share one box. Both take their width
 * and their gutters from here, which puts a page's title on the same line as
 * the first card under it.
 *
 * A page is a stack of sections. A section is an optional heading over a
 * card (`SETTINGS_CARD`), and a card holds rows (`SettingRow`) that space
 * themselves apart with no line between them.
 *
 * @module views/settings/layout
 */
import { CARD, PAGE_X, SECTION_HEADING } from "../../lib/styles";
import { cn } from "../../lib/utils";

/** The box the header and the page share: centred, at most 56rem wide. */
export const SETTINGS_BOX = cn(PAGE_X, "w-full max-w-4xl mx-auto");

/**
 * A settings page: the box and a little room under the header. The shell
 * draws the page's end under it: Reset to defaults, and the room for the
 * phone's tab bar.
 */
export const SETTINGS_PAGE = cn(SETTINGS_BOX, "pt-4");

/** A settings card: the card surface, 16 px in on a phone and 24 px from `sm`. */
export const SETTINGS_CARD = cn(CARD, "p-4 sm:p-6");

/** The heading over a card ("Profile", "Who can join"), in line with the card's text. */
export const SETTINGS_SECTION_HEADING = cn(SECTION_HEADING, "px-1 mb-2");

/** The name over a field on a settings card. */
export const SETTINGS_LABEL = "block text-xs font-bold text-on-surface";

/**
 * A text field on a settings card. The highest container tone, so the field
 * reads against the card in both palettes, 44 px tall, and 16 px type on a
 * phone so iOS does not zoom on focus.
 */
export const SETTINGS_INPUT =
  "w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-surface-container-highest text-on-surface text-base sm:text-sm placeholder:text-on-surface-variant disabled:opacity-60 disabled:cursor-not-allowed";
