import { sqlite } from "../../db.ts";
import { log } from "../../utils/logger.ts";
import { queueGeocode } from "./queue.ts";

const STARTUP_DELAY_MS = 2000;

/**
 * Contacts with an address and no pin, across every account.
 *
 * A pin placed by hand is left out by name as well as by fact. It always has
 * coordinates, so the coordinate test alone would skip it, but the rule that
 * the geocoder does not touch a `'manual'` row is better stated in the query
 * than implied by it.
 */
export function contactsAwaitingGeocode(): { id: string; location: string }[] {
  return sqlite
    .prepare(
      // An address is not personal data and the geocode cache is shared by
      // design, so this sweep runs across every account. It writes only
      // lat/lng, which the row already implies.
      // tenant-lint: allow instance sweep
      "SELECT id, location FROM contacts WHERE location IS NOT NULL AND location != '' AND (lat IS NULL OR lng IS NULL) AND (geoSource IS NULL OR geoSource != 'manual')",
    )
    .all() as { id: string; location: string }[];
}

export function startRetroactiveGeocoding(): void {
  setTimeout(() => {
    const ungeocoded = contactsAwaitingGeocode();

    if (ungeocoded.length > 0) {
      log.info(
        "Geocode",
        `Queuing ${ungeocoded.length} contact(s) for startup geocoding (cache will deduplicate)`,
      );
      for (const c of ungeocoded) {
        queueGeocode(c.id, c.location);
      }
    }
  }, STARTUP_DELAY_MS);
}

export { queueGeocode };
