/**
 * The left pane's width, from `lg` up: the Network list beside the open
 * contact, and the Settings list beside a settings page.
 *
 * The two panes share one width, one handle and one stored value, so moving
 * between Network and Settings leaves the page beside the pane where it was.
 * A person drags the pane's edge (`ResizeHandle`) between 300 and 480 px,
 * around the 350 px it opens at. At 300 the Network header still holds the
 * title and its three actions, the search box holds the sort menu, and a row
 * holds a name, a company and the follow-up glyph. Past 480 a row gains only
 * empty space, and every pixel comes out of the page beside it.
 *
 * The page keeps 560 px, so on a 1024 px window the pane stops at 400 and
 * the page stays the wider of the two. From 1104 px the pane reaches 480.
 *
 * @module components/layout/paneWidth
 */
import { readPaneWidth, type PaneWidthBounds } from "../../hooks/usePaneWidth";

/** The bounds: the width it opens at, the narrowest, the widest, the room kept. */
export const LEFT_PANE_WIDTH: PaneWidthBounds = {
  initial: 350,
  min: 300,
  max: 480,
  keep: 560,
};

/**
 * Everything `ResizeHandle` needs, spread onto it. The key keeps its old
 * name, from when only the Network list could be resized, so a width a
 * person chose then is still theirs.
 */
export const LEFT_PANE = {
  ...LEFT_PANE_WIDTH,
  /** The custom property the pane's `lg:w-(--pane-width)` reads. */
  property: "--pane-width",
  /** This device's width, in `localStorage`. */
  storageKey: "contrack.network.listWidth",
} as const;

/**
 * The width this device keeps, for a placeholder drawn before the pane (a
 * route's loading skeleton), so the pane arrives where the skeleton was.
 *
 * @returns The stored width held inside the bounds, or the default.
 */
export const storedLeftPaneWidth = (): number =>
  readPaneWidth(LEFT_PANE.storageKey, LEFT_PANE_WIDTH);
