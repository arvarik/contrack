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

export type Point = { lat: number; lng: number } | [lng: number, lat: number];

function getLngLat(p: Point): [number, number] {
  if (Array.isArray(p)) return [p[0], p[1]];
  return [p.lng, p.lat];
}

/**
 * Ray-casting (even-odd rule) to check if a point is inside a polygon ring.
 * Also returns true if the point lies directly on a polygon vertex.
 */
export function pointInPolygon(point: Point, ring: Point[]): boolean {
  if (ring.length < 3) return false;
  const [px, py] = getLngLat(point);

  // Check if exactly on vertex
  for (let i = 0; i < ring.length; i++) {
    const [vx, vy] = getLngLat(ring[i]);
    if (vx === px && vy === py) return true;
  }

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = getLngLat(ring[i]);
    const [xj, yj] = getLngLat(ring[j]);

    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Calculate the bounding box [west, south, east, north] containing all given points.
 * Returns null if points array is empty.
 * Points across the antimeridian are returned as a wide box spanning the range.
 */
export function boundsOf(
  points: Point[],
): [west: number, south: number, east: number, north: number] | null {
  if (points.length === 0) return null;
  const [firstLng, firstLat] = getLngLat(points[0]);
  let west = firstLng;
  let east = firstLng;
  let south = firstLat;
  let north = firstLat;

  for (let i = 1; i < points.length; i++) {
    const [lng, lat] = getLngLat(points[i]);
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }

  return [west, south, east, north];
}

/**
 * The box around the most points that fit in `span` degrees of longitude,
 * or null for none. Ties go to the western window.
 *
 * "Fit all" asks for it when everyone cannot fit. On a phone the world at
 * the lowest zoom is about twice the screen, and the middle of a network
 * that spans the globe is often an ocean, or Europe with four of thirty
 * people. The stretch that holds the most people is the better picture.
 */
export function densestSpan(
  points: Point[],
  span: number,
): [west: number, south: number, east: number, north: number] | null {
  if (points.length === 0) return null;
  const sorted = points.map(getLngLat).sort((a, b) => a[0] - b[0]);
  let bestStart = 0;
  let bestEnd = 0;
  let start = 0;
  for (let end = 0; end < sorted.length; end++) {
    while (sorted[end][0] - sorted[start][0] > span) start++;
    if (end - start > bestEnd - bestStart) {
      bestStart = start;
      bestEnd = end;
    }
  }
  return boundsOf(sorted.slice(bestStart, bestEnd + 1));
}

/**
 * How many degrees of longitude `width` px shows at `zoom`, on MapLibre's
 * 512 px tiles.
 */
export function degreesAcross(width: number, zoom: number): number {
  return (width / (TILE_SIZE * 2 ** zoom)) * 360;
}
