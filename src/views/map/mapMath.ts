/**
 * The arithmetic that keeps the world filling the map, whatever the window is.
 *
 * The world is a square: at zoom z it is 512 * 2^z pixels on a side with
 * vector tiles, and Mercator stops at ±85.05° latitude, so there is nothing to
 * draw past it. The minimum zoom is therefore not a constant but a function of
 * the viewport: the smallest z whose world covers the container's larger
 * dimension. A window wider than the world would otherwise show empty
 * background, or wrapped continent copies that carry no pins, which reads as
 * "my contacts are in the ocean".
 *
 * @module views/map/mapMath
 */

/** Vector tiles are 512 px, twice the 256 px of the old raster tiles. */
export const TILE_SIZE = 512;

/** Web Mercator's latitude limit. There is no map past it. */
export const MERCATOR_MAX_LAT = 85.05112878;

/**
 * A hair inside ±180 degrees of longitude.
 *
 * MapLibre wraps a longitude range into one world width, and exactly -180 to
 * 180 wraps to the same number twice. It then reads that as a range of zero
 * width, scales the view by screen width over zero, and every matrix after
 * that is NaN: the map throws on its first resize and draws nothing. Its own
 * code keeps the same hair's width inside the meridian for the same reason.
 */
export const LNG_EPSILON = 1e-9;

/** The full Mercator world as `[west, south, east, north]`. */
export const WORLD_BOUNDS: [number, number, number, number] = [
  -180 + LNG_EPSILON,
  -MERCATOR_MAX_LAT,
  180 - LNG_EPSILON,
  MERCATOR_MAX_LAT,
];

/** The zoom used when the container has no size yet. */
export const FALLBACK_MIN_ZOOM = 2;

/** Past this the whole world stops being reachable on a very large screen. */
export const MAX_MIN_ZOOM = 5;

/**
 * One person on their part of the map.
 *
 * Close enough to read the street grid around the pin, far enough to show
 * the city it belongs to. The mini map on the contact page opens here, and
 * the map page flies here when a contact opens.
 */
export const CONTACT_ZOOM = 11;

/**
 * Smallest zoom whose world covers both container dimensions.
 *
 * MapLibre accepts a fractional zoom, so the result is the exact fit rounded
 * up to two decimals. Rounding up, never down, is what keeps a one pixel band
 * of background from showing at the edge. A zero size, which is a layout that
 * has not settled, returns {@link FALLBACK_MIN_ZOOM}.
 */
export function minZoomFor(width: number, height: number): number {
  if (!width || !height || width < 0 || height < 0) return FALLBACK_MIN_ZOOM;
  const exact = Math.log2(Math.max(width, height) / TILE_SIZE);
  const rounded = Math.ceil(exact * 100) / 100;
  return Math.max(0, Math.min(rounded, MAX_MIN_ZOOM));
}

export { haversineKm } from "../../../shared/geo";

/**
 * True when the bounding box contains the given coordinate point.
 * Supports standard [west, south, east, north] bounds and antimeridian crossing.
 */
export function boundsContain(
  bounds:
    | [west: number, south: number, east: number, north: number]
    | {
        getWest: () => number;
        getSouth: () => number;
        getEast: () => number;
        getNorth: () => number;
      },
  point: { lat: number; lng: number },
): boolean {
  const [west, south, east, north] = Array.isArray(bounds)
    ? bounds
    : [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ];
  if (point.lat < south || point.lat > north) return false;
  if (west <= east) {
    return point.lng >= west && point.lng <= east;
  }
  return point.lng >= west || point.lng <= east;
}
