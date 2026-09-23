/**
 * How much of the map page something else is covering.
 *
 * Three things sit over the map: the contact that opens over it from the
 * right on a wide screen, the open insights panel, and the tab bar over its
 * bottom on a phone. The map's centre should be the centre of what a person
 * can see, so each becomes MapLibre padding. A fly-to then lands its pin in
 * the open part of the map, and a cluster that splits, splits around a point
 * the reader can see.
 *
 * Each cover is found by an attribute, `data-covers-map="right"` on the
 * contact and on the open panel and `data-covers-map="bottom"` on the tab
 * bar, rather than by a width copied from a class name. The width in the
 * class name changes with the breakpoint, and a copy of it here would drift.
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

/** The insights panel's name. It covers the map too, but it is not a contact. */
const INSIGHTS_LABEL = "Map insights";

/**
 * How much of the map's width a right-hand cover takes, in px, wherever it
 * is in its slide.
 *
 * The cover is placed by its layout box, `offsetLeft` from its offset
 * parent, which a transform does not move: the contact slides in and out
 * and is measured mid-slide. What it covers is the part of its box over
 * the map, which is its whole width while both run to the window's edge.
 * With no offset parent (a document with no layout) it is taken to sit
 * flush with the map's right edge.
 */
function coveredWidth(panel: HTMLElement, map: DOMRect): number {
  const width = panel.offsetWidth;
  if (width <= 0) return 0;
  const parent = panel.offsetParent;
  if (!(parent instanceof HTMLElement)) return width;
  const left =
    parent.getBoundingClientRect().left + parent.clientLeft + panel.offsetLeft;
  return Math.min(Math.max(map.right - left, 0), width);
}

/**
 * How much of `container`'s width an open contact leaves uncovered, in px,
 * or null when no contact covers it. The map's toolbar and its bottom-left
 * corner fit in it, and step aside when it is under `MIN_OPEN_PX`.
 */
export function measureOpenWidth(container: HTMLElement): number | null {
  const rect = container.getBoundingClientRect();
  const widths = Array.from(
    container.ownerDocument.querySelectorAll<HTMLElement>(
      `[${COVERS_MAP_ATTR}="right"]`,
    ),
  )
    .filter((panel) => panel.getAttribute("aria-label") !== INSIGHTS_LABEL)
    .filter((panel) => panel.offsetWidth > 0)
    .map((panel) => coveredWidth(panel, rect));
  if (widths.length === 0) return null;
  return Math.max(0, rect.width - Math.max(...widths));
}

/**
 * Measure the covers over `container`, the map's element.
 *
 * A right-hand cover is read by its layout box (`coveredWidth`), which a
 * transform does not change, because the contact slides in and out and is
 * measured mid-slide. The contact is counted only while one is open: the
 * closing panel is still in the document for the length of its exit
 * animation, and the map should already be moving back. The insights panel
 * carries the attribute only while it is open.
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
  const rightCovers = Array.from(
    doc.querySelectorAll<HTMLElement>(`[${COVERS_MAP_ATTR}="right"]`),
  );
  const rightWidths = rightCovers.map((panel) =>
    options.contactOpen || panel.getAttribute("aria-label") === INSIGHTS_LABEL
      ? coveredWidth(panel, rect)
      : 0,
  );
  const maxRight = rightWidths.length > 0 ? Math.max(0, ...rightWidths) : 0;

  const bar = doc.querySelector<HTMLElement>(`[${COVERS_MAP_ATTR}="bottom"]`);
  const barHeight =
    bar && bar.offsetHeight > 0
      ? rect.bottom - bar.getBoundingClientRect().top
      : 0;
  return insetsFor({
    mapWidth: rect.width,
    mapHeight: rect.height,
    panelWidth: maxRight,
    barHeight,
  });
}

/**
 * The part of the map that nothing covers, as `[west, south, east, north]`.
 * "N in view" counts the people a person can see: at 1440 px the open
 * insights panel lay over Tokyo and Sydney, and the line still counted them.
 * The map is never rotated, so the clear rectangle is a box of longitude and
 * latitude.
 */
export function clearBounds(
  map: {
    getContainer: () => HTMLElement;
    unproject: (point: [number, number]) => { lng: number; lat: number };
  },
  options: { contactOpen: boolean },
): [west: number, south: number, east: number, north: number] {
  const container = map.getContainer();
  const { right, bottom } = measureInsets(container, options);
  const southWest = map.unproject([0, container.clientHeight - bottom]);
  const northEast = map.unproject([container.clientWidth - right, 0]);
  return [southWest.lng, southWest.lat, northEast.lng, northEast.lat];
}
