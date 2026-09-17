import { db } from "../../db.ts";
import * as schema from "../../../src/db/schema.ts";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { log } from "../../utils/logger.ts";
import {
  normalizeLocationKey,
  getCachedGeocode,
  isRecentFailure,
  cacheGeocode,
  FAILURE_TTL_DAYS,
} from "./cache.ts";
import { geocodeWithFallback, INTER_REQUEST_DELAY_MS } from "./provider.ts";

interface GeoTask {
  contactId: string;
  location: string;
  normalizedKey: string;
}

const geocodeQueue: GeoTask[] = [];
let isGeocoding = false;

export function queueGeocode(contactId: string, location: string): void {
  // Integration tests set this to keep background fetches off the network.
  if (process.env.DISABLE_BACKGROUND_JOBS === "true") return;
  if (!location?.trim()) return;

  const key = normalizeLocationKey(location);

  const cached = getCachedGeocode(key);
  if (cached) {
    writeGeocoded(contactId, cached.lat, cached.lng);
    log.debug(
      "Geocode",
      `Cache hit for "${location}" → ${cached.lat}, ${cached.lng}`,
    );
    return;
  }

  if (isRecentFailure(key)) {
    log.debug(
      "Geocode",
      `Skipping "${location}" — cached failure, retry in <${FAILURE_TTL_DAYS}d`,
    );
    return;
  }

  const existing = geocodeQueue.find((t) => t.normalizedKey === key);
  if (existing) {
    if (existing.contactId !== contactId) {
      geocodeQueue.push({ contactId, location, normalizedKey: key });
    }
    return;
  }

  geocodeQueue.push({ contactId, location, normalizedKey: key });
  processGeocodeQueue();
}

async function processGeocodeQueue(): Promise<void> {
  if (isGeocoding || geocodeQueue.length === 0) return;
  isGeocoding = true;

  while (geocodeQueue.length > 0) {
    const task = geocodeQueue.shift()!;

    const cached = getCachedGeocode(task.normalizedKey);
    if (cached) {
      applyCoordinates(
        task.contactId,
        task.normalizedKey,
        cached.lat,
        cached.lng,
      );
      continue;
    }

    const result = await geocodeWithFallback(task.location);

    if (result) {
      cacheGeocode(
        task.normalizedKey,
        result.lat,
        result.lng,
        result.provider,
        true,
      );
      applyCoordinates(
        task.contactId,
        task.normalizedKey,
        result.lat,
        result.lng,
      );
      log.info(
        "Geocode",
        `[${result.provider}] "${task.location}" → ${result.lat}, ${result.lng}`,
      );
    } else {
      cacheGeocode(task.normalizedKey, null, null, "none", false);
      log.warn(
        "Geocode",
        `No results for "${task.location}" — cached as failure for ${FAILURE_TTL_DAYS}d`,
      );
    }

    await new Promise((r) => setTimeout(r, INTER_REQUEST_DELAY_MS));
  }

  isGeocoding = false;
}

/**
 * Write what the geocoder found, unless a person placed the pin.
 *
 * A row with `geoSource = 'manual'` is one somebody dragged into place, and
 * the geocoder's answer for the same text does not outrank that. The guard
 * is in the statement itself, so every path through this module honours it,
 * and a task queued before the pin was moved lands on nothing when it drains.
 * A row the geocoder does place is marked `'geocoder'` in the same write.
 */
function writeGeocoded(contactId: string, lat: number, lng: number): void {
  // tenant-lint: allow instance sweep
  db.update(schema.contacts)
    .set({ lat, lng, geoSource: "geocoder" })
    .where(
      and(
        eq(schema.contacts.id, contactId),
        or(
          isNull(schema.contacts.geoSource),
          ne(schema.contacts.geoSource, "manual"),
        ),
      ),
    )
    .run();
}

function applyCoordinates(
  contactId: string,
  normalizedKey: string,
  lat: number,
  lng: number,
): void {
  writeGeocoded(contactId, lat, lng);

  const dupes = geocodeQueue.filter((t) => t.normalizedKey === normalizedKey);
  for (const dupe of dupes) {
    writeGeocoded(dupe.contactId, lat, lng);
  }
  const remaining = geocodeQueue.filter(
    (t) => t.normalizedKey !== normalizedKey,
  );
  geocodeQueue.length = 0;
  geocodeQueue.push(...remaining);
}
