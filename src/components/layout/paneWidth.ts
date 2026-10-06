/**
 * The left pane's width from `lg`, shared by the Network list and the
 * Settings list: one width, one handle, one stored value.
 *
 * 300 to 480 px, opening at 350. At 300 the Network header and a row still
 * fit. Past 480 a row gains only empty space. The page keeps 560 px, so on a
 * 1024 px window the pane stops at 400.
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
 * Everything `ResizeHandle` needs, spread onto it. The storage key names
 * the Network list, so widths already stored under it stay valid.
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
