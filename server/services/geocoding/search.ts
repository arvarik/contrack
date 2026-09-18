/**
 * Place search service for map navigation.
 *
 * Normalises the query, checks the geocode cache, queries the geocoding
 * provider on a cache miss, and caches the result (including failures).
 *
 * @module server/services/geocoding/search
 */
import {
  cacheGeocode,
  getCachedGeocode,
  isRecentFailure,
  normalizeLocationKey,
} from "./cache.ts";
import { geocodeWithFallback } from "./provider.ts";

export interface PlaceSearchResult {
  query: string;
  lat: number;
  lng: number;
  provider: string;
  cached: boolean;
}

export async function searchPlace(
  q: string,
): Promise<PlaceSearchResult | null> {
  const trimmed = q.trim();
  const key = normalizeLocationKey(trimmed);

  // Check recent failure (< 7 days TTL)
  if (isRecentFailure(key)) {
    return null;
  }

  // Check cache hit
  const cached = getCachedGeocode(key);
  if (cached) {
    return {
      query: trimmed,
      lat: cached.lat,
      lng: cached.lng,
      provider: cached.provider,
      cached: true,
    };
  }

  // Cache miss: geocode with fallback
  const result = await geocodeWithFallback(trimmed);
  if (result) {
    cacheGeocode(key, result.lat, result.lng, result.provider, true);
    return {
      query: trimmed,
      lat: result.lat,
      lng: result.lng,
      provider: result.provider,
      cached: false,
    };
  }

  // Cache the negative result so repeated misses don't hammer Nominatim
  cacheGeocode(key, null, null, "Nominatim", false);
  return null;
}
