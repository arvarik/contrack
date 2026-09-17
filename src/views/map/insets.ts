/**
 * How much of the map page something else is covering.
 *
 * Two things sit over the map: the contact that opens over it from the
 * right on a wide screen, and the tab bar over its bottom on a phone. The
 * map's centre should be the centre of what a person can see, so both become
 * MapLibre padding. A fly-to then lands its pin in the open part of the map,
 * and a cluster that splits, splits around a point the reader can see.
 *
 * Each cover is found by an attribute, `data-covers-map="right"` on the
 * contact and `data-covers-map="bottom"` on the tab bar, rather than by a
 * width copied from a class name. The width in the class name changes with
 * the breakpoint, and a copy of it here would drift.
 *
 * @module views/map/insets
 */
import type { PaddingOptions } from "maplibre-gl";

/** The attribute a cover carries, with the side it covers as its value. */
export const COVERS_MAP_ATTR = "data-covers-map";

export interface Insets {
  right: number;
  bottom: number;
}

/**
 * Below this much open map, the cover is the whole map, and centring in the
 * rest would centre in a sliver. On a phone the contact covers the map edge
 * to edge, and the pin is centred for the moment the contact closes.
 */
export const MIN_OPEN_PX = 240;

const cover = (covered: number, size: number): number => {
  const overlap = Math.min(Math.max(covered, 0), size);
  return size - overlap >= MIN_OPEN_PX ? overlap : 0;
};

/**
 * The insets for a map of `mapWidth` by `mapHeight` with `panelWidth` of its
 * right edge and `barHeight` of its bottom edge covered.
 *
 * Pure, so the sliver rule is tested without a layout.
 */
export function insetsFor(input: {
  mapWidth: number;
  mapHeight: number;
  panelWidth: number;
  barHeight: number;
}): Insets {
  return {
    right: cover(input.panelWidth, input.mapWidth),
    bottom: cover(input.barHeight, input.mapHeight),
  };
}

/** The insets as the four-sided padding MapLibre takes. */
export function paddingFor(insets: Insets): PaddingOptions {
  return { top: 0, right: insets.right, bottom: insets.bottom, left: 0 };
}

/** True when two paddings ask for the same view. */
export function samePadding(a: PaddingOptions, b: PaddingOptions): boolean {
  return (
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom &&
    a.left === b.left
  );
}

/**
 * Measure the covers over `container`, the map's element.
 *
 * The contact panel is read by `offsetWidth`, which a transform does not
 * change, because the panel slides in and out and is measured mid-slide. It
 * sits flush with the map's right edge, so its width is its overlap. It is
 * counted only while a contact is open: the closing panel is still in the
 * document for the length of its exit animation, and the map should already
 * be moving back.
 *
 * The tab bar is fixed to the bottom of the window, and its overlap is how
 * far the map's bottom edge reaches past its top. A bar that is not
 * displayed measures zero and covers nothing.
 */
export function measureInsets(
  container: HTMLElement,
  options: { contactOpen: boolean },
): Insets {
  const rect = container.getBoundingClientRect();
  const doc = container.ownerDocument;
  const panel = options.contactOpen
    ? doc.querySelector<HTMLElement>(`[${COVERS_MAP_ATTR}="right"]`)
    : null;
  const bar = doc.querySelector<HTMLElement>(`[${COVERS_MAP_ATTR}="bottom"]`);
  const barHeight =
    bar && bar.offsetHeight > 0
      ? rect.bottom - bar.getBoundingClientRect().top
      : 0;
  return insetsFor({
    mapWidth: rect.width,
    mapHeight: rect.height,
    panelWidth: panel?.offsetWidth ?? 0,
    barHeight,
  });
}
