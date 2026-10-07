/**
 * How much of the map page something else covers: the contact panel and the
 * open insights panel on the right, and the phone tab bar at the bottom. Each
 * becomes MapLibre padding, so a fly-to or a cluster split centers on the
 * part of the map a person can see.
 *
 * Covers are found by `data-covers-map`, not by a width copied from a class
 * name, because that width changes with the breakpoint and a copy would drift.
 */
import type { PaddingOptions } from "maplibre-gl";

/** The attribute a cover carries, with the side it covers as its value. */
export const COVERS_MAP_ATTR = "data-covers-map";

export interface Insets {
  right: number;
  bottom: number;
}

/**
 * Below this much open map, the cover counts as the whole map, so nothing
 * centers in a sliver. On a phone the pin centers for when the contact closes.
 */
export const MIN_OPEN_PX = 240;

/**
 * The narrowest window where an open contact leaves {@link MIN_OPEN_PX} of
 * map beside it: the 64 px rail, the contact's 860 px from `lg` (App.tsx)
 * and 240 px. Below it the contact covers the map, so "Open in map" shows
 * the pin and its card instead (`LocationMiniMap`).
 */
export const SIDE_BY_SIDE_QUERY = "(min-width: 1164px)";

const cover = (covered: number, size: number): number => {
  const overlap = Math.min(Math.max(covered, 0), size);
  return size - overlap >= MIN_OPEN_PX ? overlap : 0;
};

/** Pure, so the sliver rule is tested without a layout. */
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

export function paddingFor(insets: Insets): PaddingOptions {
  return { top: 0, right: insets.right, bottom: insets.bottom, left: 0 };
}

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
 * How much of the map's width a right-hand cover takes, in px. It reads the
 * layout box (`offsetLeft`), which a transform does not move, because the
 * contact is measured mid-slide. With no offset parent (no layout) the cover
 * sits flush with the map's right edge.
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
 * Measure the covers over `container`, the map's element. The contact counts
 * only while one is open: a closing panel stays in the document for its exit
 * animation, and the map should already move back. The insights panel has
 * the attribute only while it is open. A hidden tab bar measures zero.
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
 * The part of the map that nothing covers, as `[west, south, east, north]`,
 * so "N in view" counts only people a person can see, and "All in view"
 * selects only them. The map never rotates, so the clear rectangle is a box of
 * longitude and latitude.
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

/** The attribute on the toolbar ("top") and on the bottom line ("bottom"). */
const MAP_CHROME_ATTR = "data-map-chrome";

/**
 * Where a card may open: the map less its covers, its toolbar and its bottom
 * line, 8 px clear. A contact that is closing still counts as a cover.
 */
export function cardPadding(container: HTMLElement): PaddingOptions {
  const rect = container.getBoundingClientRect();
  const { right, bottom } = measureInsets(container, { contactOpen: true });
  const edges = { top: 0, bottom };
  for (const el of container.ownerDocument.querySelectorAll<HTMLElement>(
    `[${MAP_CHROME_ATTR}]`,
  )) {
    const box = el.getBoundingClientRect();
    if (box.height === 0) continue;
    if (el.getAttribute(MAP_CHROME_ATTR) === "top")
      edges.top = Math.max(edges.top, box.bottom - rect.top);
    else edges.bottom = Math.max(edges.bottom, rect.bottom - box.top);
  }
  return {
    top: edges.top + 8,
    right: right + 8,
    bottom: edges.bottom + 8,
    left: 8,
  };
}
