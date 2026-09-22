/**
 * The settings page box.
 *
 * The shell draws each page's header above the page's own scroll area, so
 * the header and the page are two elements that have to share one box. Both
 * take their width and their gutters from here, which puts a page's title on
 * the same line as the first card under it.
 *
 * @module views/settings/layout
 */
import { PAGE_X } from "../../lib/styles";
import { cn } from "../../lib/utils";

/** The box the header and the page share: centred, at most 56rem wide. */
export const SETTINGS_BOX = cn(PAGE_X, "w-full max-w-4xl mx-auto");

/**
 * A settings page: the box, a little room under the header, and room at the
 * end for the phone's tab bar.
 */
export const SETTINGS_PAGE = cn(SETTINGS_BOX, "pt-4 pb-28 md:pb-10");
