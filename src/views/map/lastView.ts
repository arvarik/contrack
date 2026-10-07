/**
 * Where the map was when the reader left it, so the next visit opens there.
 * It lives in `localStorage`: the view belongs to this screen, not the
 * account, and a synchronous read makes it a creation prop of the map, so
 * nothing animates into it. A value that is not a valid view reads as none.
 */
import { MERCATOR_MAX_LAT } from "./mapMath";

export const LAST_VIEW_KEY = "contrack.map.lastView";

/** MapLibre's own zoom ceiling. */
const MAX_ZOOM = 24;

interface MapViewState {
  longitude: number;
  latitude: number;
  zoom: number;
}

/** `localStorage`, or null where reading it throws (a locked-down browser). */
function viewStore(): Storage | null {
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

function isMapViewState(value: unknown): value is MapViewState {
  if (!value || typeof value !== "object") return false;
  const view = value as Record<string, unknown>;
  return (
    inRange(view.longitude, -180, 180) &&
    inRange(view.latitude, -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT) &&
    inRange(view.zoom, 0, MAX_ZOOM)
  );
}

export function readLastView(): MapViewState | null {
  const store = viewStore();
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
 * Six decimals of a degree is a tenth of a meter, and two of zoom is finer
 * than a wheel step.
 */
export function writeLastView(view: MapViewState): void {
  const store = viewStore();
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

/** Forget the view, at sign-out: it shows where the map was looking. */
export function clearLastView(): void {
  try {
    viewStore()?.removeItem(LAST_VIEW_KEY);
  } catch {
    // A read-only store keeps it.
  }
}
