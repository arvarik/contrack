import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";

export const INTER_REQUEST_DELAY_MS = 1100;

export interface GeoResult {
  lat: number;
  lng: number;
  provider: string;
}

export async function geocodeWithFallback(location: string): Promise<GeoResult | null> {
  let searchStr = location;
  const mapboxKey = process.env.MAPBOX_API_KEY;
  const provider = mapboxKey ? "Mapbox" : "Nominatim";

  for (let fallback = 0; fallback < 4 && searchStr.length > 0; fallback++) {
    try {
      const result = await geocodeSingle(searchStr, mapboxKey);
      if (result) return { ...result, provider };

      const parts = searchStr.split(',');
      if (parts.length <= 1) break;
      searchStr = parts.slice(1).join(',').trim();

      if (fallback < 3) {
        await new Promise(r => setTimeout(r, INTER_REQUEST_DELAY_MS));
      }
    } catch (err: unknown) {
      log.error("Geocode", `API error for "${searchStr}": ${getErrorMessage(err)}`);
      break; 
    }
  }

  return null;
}

async function geocodeSingle(query: string, mapboxKey?: string): Promise<{ lat: number; lng: number } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000); 

  try {
    if (mapboxKey) {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxKey}&limit=1`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        log.warn("Geocode", `Mapbox returned HTTP ${res.status} for "${query}"`);
        return null;
      }
      const data = await res.json();
      if (data?.features?.[0]) {
        const [lng, lat] = data.features[0].center;
        return { lat, lng };
      }
    } else {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "ContrackCRM/1.0 (personal-crm; geocoder; +https://github.com/contrack)",
          "Accept": "application/json",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      if (!res.ok) {
        log.warn("Geocode", `Nominatim returned HTTP ${res.status} for "${query}"`);
        return null;
      }
      const data = await res.json();
      if (data?.[0]) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
  return null;
}
