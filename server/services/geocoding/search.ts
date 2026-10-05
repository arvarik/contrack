/**
 * Place search for the map: the geocode cache first, then Nominatim. Nothing
 * found is cached for 7 days. No answer is not cached, and is a 503. With
 * address lookups off (switch.ts) only the cache answers.
 */
import type { PlaceSearchResult } from "../../../shared/geo.ts";
import { AppError } from "../../utils/AppError.ts";
import {
  cacheGeocode,
  getCachedGeocode,
  isRecentFailure,
  normalizeLocationKey,
} from "./cache.ts";
import { geocodeWithFallback } from "./provider.ts";
import { isGeocodingOff } from "./switch.ts";

export async function searchPlace(
  q: string,
): Promise<PlaceSearchResult | null> {
  const trimmed = q.trim();
  const key = normalizeLocationKey(trimmed);

  if (isRecentFailure(key)) return null;

  const cached = getCachedGeocode(key);
  if (cached) return { query: trimmed, ...cached, cached: true };

  if (isGeocodingOff()) {
    throw new AppError(
      "Address lookups are off on this instance. Place the pin by hand",
      503,
      { code: "GEOCODING_OFF" },
    );
  }

  const result = await geocodeWithFallback(trimmed);
  if (result.status === "error") {
    throw new AppError(
      "Place search is busy or unavailable. Try again in a moment",
      503,
      { code: "GEOCODER_UNAVAILABLE" },
    );
  }
  if (result.status === "none") {
    cacheGeocode(key, null, null, "Nominatim", false);
    return null;
  }

  const { lat, lng, provider, displayName } = result;
  cacheGeocode(key, lat, lng, provider, true, displayName);
  return { query: trimmed, lat, lng, provider, displayName, cached: false };
}
