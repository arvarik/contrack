/**
 * The Network list's width beside the open contact, from `lg` up.
 *
 * A person drags the list's edge (`ResizeHandle`) between 300 and 480 px,
 * around the 350 px it always had. At 300 the header still holds the title
 * and its three actions, the search box holds the sort menu, and a row
 * holds a name, a company and the follow-up glyph. Past 480 a row gains
 * only empty space, and every pixel comes out of the contact.
 *
 * The contact keeps 560 px, so on a 1024 px window the list stops at 400 and
 * the contact stays the wider of the two. From 1104 px the list reaches 480.
 */
import type { PaneWidthBounds } from "../../hooks/usePaneWidth";

export const LIST_WIDTH: PaneWidthBounds = {
  initial: 350,
  min: 300,
  max: 480,
  keep: 560,
};

/** This device's width, in `localStorage`. */
export const LIST_WIDTH_KEY = "contrack.network.listWidth";

/** The custom property the list pane's `lg:w-(--list-width)` reads. */
export const LIST_WIDTH_PROPERTY = "--list-width";
