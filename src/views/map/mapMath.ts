/**
 * Map arithmetic. The world is a square of 512 * 2^z px at zoom z, so the
 * minimum zoom depends on the viewport: the smallest z whose world covers the
 * container. A window wider than the world shows empty background, or wrapped
 * copies with no pins, which reads as "my contacts are in the ocean".
 */

/** Vector tiles are 512 px, not the 256 px of raster tiles. */
export const TILE_SIZE = 512;

/** Web Mercator's latitude limit. There is no map past it. */
export const MERCATOR_MAX_LAT = 85.05112878;

/**
 * A hair inside ±180 degrees. MapLibre wraps exactly -180 to 180 into a range
 * of zero width, every matrix becomes NaN, and the map throws on its first
 * resize and draws nothing.
 */
const LNG_EPSILON = 1e-9;

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
 * The zoom for one person: the street grid around the pin and its city. The
 * mini map opens here, and the map page flies here when a contact opens.
 */
export const CONTACT_ZOOM = 11;

/**
 * Smallest zoom whose world covers both container dimensions, rounded up to
 * two decimals: rounding down shows a one pixel band of background. A zero
 * size (an unsettled layout) returns {@link FALLBACK_MIN_ZOOM}.
 */
export function minZoomFor(width: number, height: number): number {
  if (!width || !height || width < 0 || height < 0) return FALLBACK_MIN_ZOOM;
  const exact = Math.log2(Math.max(width, height) / TILE_SIZE);
  const rounded = Math.ceil(exact * 100) / 100;
  return Math.max(0, Math.min(rounded, MAX_MIN_ZOOM));
}

/** True when the bounds contain the point, also across the antimeridian. */
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

/** Even-odd ray casting. A point on a vertex counts as inside. */
export function pointInPolygon(point: Point, ring: Point[]): boolean {
  if (ring.length < 3) return false;
  const [px, py] = getLngLat(point);

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
 * The box around all points, or null for none. Points on both sides of the
 * antimeridian give a wide box, not one that crosses it.
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
 * The box around the most points that fit in `span` degrees of longitude, or
 * null for none. Ties go west. "Fit all" uses it when everyone cannot fit (on
 * a phone), because the middle of a global network is often an ocean.
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

/** How many degrees of longitude `width` px shows at `zoom`. */
export function degreesAcross(width: number, zoom: number): number {
  return (width / (TILE_SIZE * 2 ** zoom)) * 360;
}
