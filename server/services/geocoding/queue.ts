import { db } from "../../db.ts";
import * as schema from "../../db/schema.ts";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import {
  normalizeLocationKey,
  getCachedGeocode,
  isRecentFailure,
  cacheGeocode,
  FAILURE_TTL_DAYS,
} from "./cache.ts";
import { geocodeWithFallback } from "./provider.ts";
import { isGeocodingOff } from "./switch.ts";

/**
 * No answer: wait 30 s, twice as long for each in a row, up to 15 min. The
 * task stays queued until an answer, so "Waiting for the geocoder" is true.
 */
const RETRY_FIRST_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;

interface GeoTask {
  contactId: string;
  location: string;
  normalizedKey: string;
}

const geocodeQueue: GeoTask[] = [];
let isGeocoding = false;
let noAnswers = 0;

/**
 * Place a contact's pin from the cache, or queue its address for Nominatim.
 *
 * With address lookups off (switch.ts) a cached answer still places the pin,
 * since nothing leaves the server for it, and nothing is queued. The log
 * lines name the contact, never the address.
 */
export function queueGeocode(contactId: string, location: string): void {
  // Integration tests set this to keep background fetches off the network.
  if (process.env.DISABLE_BACKGROUND_JOBS === "true") return;
  if (!location?.trim()) return;

  const key = normalizeLocationKey(location);

  const cached = getCachedGeocode(key);
  if (cached) {
    writeGeocoded(contactId, cached.lat, cached.lng);
    log.debug("Geocode", `Cache hit for contact ${contactId}`);
    return;
  }

  if (isRecentFailure(key)) {
    log.debug(
      "Geocode",
      `Skipping contact ${contactId}: no place found, retry in <${FAILURE_TTL_DAYS}d`,
    );
    return;
  }

  if (isGeocodingOff()) return;

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
  // A throw anywhere below must not leave the flag set, or no address would
  // ever be looked up again until a restart.
  try {
    await drainQueue();
  } catch (err) {
    log.error("Geocode", `The lookup queue stopped: ${getErrorMessage(err)}`);
  } finally {
    isGeocoding = false;
  }
}

async function drainQueue(): Promise<void> {
  while (geocodeQueue.length > 0) {
    // Turned off while addresses waited: they stay on this server.
    if (isGeocodingOff()) {
      log.info(
        "Geocode",
        `Address lookups are off, dropped ${geocodeQueue.length} queued lookup(s)`,
      );
      geocodeQueue.length = 0;
      return;
    }
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

    if (result.status === "error") {
      // No answer is not "nothing found": cache nothing, and ask again later.
      geocodeQueue.push(task);
      const wait = Math.min(RETRY_FIRST_MS * 2 ** noAnswers, RETRY_MAX_MS);
      noAnswers++;
      log.warn(
        "Geocode",
        `No answer for contact ${task.contactId}, next lookup in ${wait / 1000}s`,
      );
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    noAnswers = 0;

    if (result.status === "found") {
      cacheGeocode(
        task.normalizedKey,
        result.lat,
        result.lng,
        result.provider,
        true,
        result.displayName,
      );
      applyCoordinates(
        task.contactId,
        task.normalizedKey,
        result.lat,
        result.lng,
      );
      log.info(
        "Geocode",
        `[${result.provider}] Placed contact ${task.contactId}`,
      );
    } else {
      cacheGeocode(task.normalizedKey, null, null, "none", false);
      log.warn(
        "Geocode",
        `No place found for contact ${task.contactId}, asking again in ${FAILURE_TTL_DAYS}d`,
      );
    }
  }
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
