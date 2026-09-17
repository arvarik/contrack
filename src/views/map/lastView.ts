/**
 * Where the map was when the reader left it.
 *
 * A map that opens on the whole world every time makes a person find their
 * own city again on every visit. The page map writes its view when a move
 * ends and opens on that view the next time, on this browser, across
 * reloads. `localStorage` is the right store for it: the view is a fact
 * about this screen and this person's last look, not a setting of the
 * account, and a read from it is synchronous, so the view is a creation prop
 * of the map and nothing animates into it (see the header of
 * `ContactMap.tsx`).
 *
 * A value that is not a view, from an older build or a hand edit, reads as
 * no view at all, and the map opens on its default.
 *
 * @module views/map/lastView
 */
import { MERCATOR_MAX_LAT } from "./mapMath";

export const LAST_VIEW_KEY = "contrack.map.lastView";

/** MapLibre's own zoom ceiling. */
const MAX_ZOOM = 24;

export interface MapViewState {
  longitude: number;
  latitude: number;
  zoom: number;
}

/** The two methods this module uses: `localStorage`, or a stand-in in a test. */
export interface ViewStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `localStorage`, or null where reading it throws (a locked-down browser). */
function defaultStore(): ViewStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

/** True for a view the map can open on. */
export function isMapViewState(value: unknown): value is MapViewState {
  if (!value || typeof value !== "object") return false;
  const view = value as Record<string, unknown>;
  return (
    inRange(view.longitude, -180, 180) &&
    inRange(view.latitude, -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT) &&
    inRange(view.zoom, 0, MAX_ZOOM)
  );
}

/** The last view written, or null when there is none worth opening on. */
export function readLastView(
  store: ViewStore | null = defaultStore(),
): MapViewState | null {
  if (!store) return null;
  try {
    const raw = store.getItem(LAST_VIEW_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isMapViewState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Remember a view. Six decimals of a degree is a tenth of a metre, and two
 * of zoom is finer than a wheel step, so the string stays short and the
 * reopened map is the same map.
 */
export function writeLastView(
  view: MapViewState,
  store: ViewStore | null = defaultStore(),
): void {
  if (!store || !isMapViewState(view)) return;
  const compact: MapViewState = {
    longitude: Number(view.longitude.toFixed(6)),
    latitude: Number(view.latitude.toFixed(6)),
    zoom: Number(view.zoom.toFixed(2)),
  };
  try {
    store.setItem(LAST_VIEW_KEY, JSON.stringify(compact));
  } catch {
    // A full or read-only store. The map still works, it only forgets.
  }
}
