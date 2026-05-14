import { db } from "../../db.ts";
import * as schema from "../../../src/db/schema.ts";
import { eq } from "drizzle-orm";
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
  if (!location?.trim()) return;

  const key = normalizeLocationKey(location);

  const cached = getCachedGeocode(key);
  if (cached) {
    db.update(schema.contacts)
      .set({ lat: cached.lat, lng: cached.lng })
      .where(eq(schema.contacts.id, contactId))
      .run();
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

function applyCoordinates(
  contactId: string,
  normalizedKey: string,
  lat: number,
  lng: number,
): void {
  db.update(schema.contacts)
    .set({ lat, lng })
    .where(eq(schema.contacts.id, contactId))
    .run();

  const dupes = geocodeQueue.filter((t) => t.normalizedKey === normalizedKey);
  for (const dupe of dupes) {
    db.update(schema.contacts)
      .set({ lat, lng })
      .where(eq(schema.contacts.id, dupe.contactId))
      .run();
  }
  const remaining = geocodeQueue.filter(
    (t) => t.normalizedKey !== normalizedKey,
  );
  geocodeQueue.length = 0;
  geocodeQueue.push(...remaining);
}
