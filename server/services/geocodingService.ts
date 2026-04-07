import { db, sqlite } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { log } from "../utils/logger.ts";

// Private — use queueGeocode() for the only public write path
const geocodeQueue: { contactId: string; location: string }[] = [];
let isGeocoding = false;

export async function processGeocodeQueue(): Promise<void> {
  if (isGeocoding || geocodeQueue.length === 0) return;
  isGeocoding = true;

  while (geocodeQueue.length > 0) {
    const task = geocodeQueue.shift()!;
    let searchStr = task.location;
    let fallbackLevel = 0;
    let found = false;

    const mapboxKey = process.env.MAPBOX_API_KEY;

    while (searchStr.length > 0 && !found && fallbackLevel < 4) {
      try {
        let url = "";
        let requestOptions = {};

        if (mapboxKey) {
          url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchStr)}.json?access_token=${mapboxKey}&limit=1`;
        } else {
          url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(searchStr)}`;
          requestOptions = {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; ContrackCRM geocoder; +https://github.com/contrack)",
              "Accept": "application/json",
              "Accept-Language": "en-US,en;q=0.9",
            },
          };
        }

        const response = await fetch(url, requestOptions);
        const data = await response.json();

        if (mapboxKey && data?.features?.[0]) {
          const [lng, lat] = data.features[0].center;
          db.update(schema.contacts).set({ lat, lng }).where(eq(schema.contacts.id, task.contactId)).run();
          log.info("Geocode", `[Mapbox] "${searchStr}" → ${lat}, ${lng}`);
          found = true;
        } else if (!mapboxKey && data?.[0]) {
          const lat = parseFloat(data[0].lat);
          const lng = parseFloat(data[0].lon);
          db.update(schema.contacts).set({ lat, lng }).where(eq(schema.contacts.id, task.contactId)).run();
          log.info("Geocode", `[Nominatim] "${searchStr}" → ${lat}, ${lng} (original: "${task.location}")`);
          found = true;
        } else {
          // Fallback: drop the first comma-separated chunk to broaden the search
          // Note: Mapbox is highly fuzzy out-of-the-box, but this safeguards catastrophic typos
          const parts = searchStr.split(',');
          if (parts.length > 1) {
            searchStr = parts.slice(1).join(',').trim();
            fallbackLevel++;
            await new Promise(r => setTimeout(r, 1100)); // Rate limit before retry
          } else {
            break;
          }
        }
      } catch (err: any) {
        log.error("Geocode", `Failed for "${searchStr}"`, { error: err.message });
        break;
      }
    }

    if (!found) {
      log.warn("Geocode", `No results for "${task.location}" even after fallbacks`);
    }
    
    // Hard rate limits to protect OSM servers (Mapbox could theoretically spin much faster, 
    // but 1s pauses prevent accidental runaway queues)
    await new Promise(r => setTimeout(r, 1100)); 
  }
  isGeocoding = false;
}

export function queueGeocode(contactId: string, location: string): void {
  if (!location) return;
  geocodeQueue.push({ contactId, location });
  processGeocodeQueue();
}

/** 
 * Retroactively geocode existing contacts that have a location but no coordinates.
 * Call this once at startup.
 */
export function startRetroactiveGeocoding(): void {
  setTimeout(() => {
    const ungeocoded = sqlite.prepare(
      "SELECT id, location FROM contacts WHERE location IS NOT NULL AND location != '' AND (lat IS NULL OR lng IS NULL)"
    ).all() as { id: string; location: string }[];

    if (ungeocoded.length > 0) {
      log.info("Geocode", `Queuing ${ungeocoded.length} existing contact(s) for startup geocoding`);
      for (const c of ungeocoded) {
        queueGeocode(c.id, c.location);
      }
    }
  }, 2000);
}
