import { sqlite } from "../../db.ts";
import { log } from "../../utils/logger.ts";
import { queueGeocode } from "./queue.ts";

const STARTUP_DELAY_MS = 2000;

export function startRetroactiveGeocoding(): void {
  setTimeout(() => {
    const ungeocoded = sqlite
      .prepare(
        // An address is not personal data and the geocode cache is shared by
        // design, so this sweep runs across every account. It writes only
        // lat/lng, which the row already implies.
        // tenant-lint: allow instance sweep
        "SELECT id, location FROM contacts WHERE location IS NOT NULL AND location != '' AND (lat IS NULL OR lng IS NULL)",
      )
      .all() as { id: string; location: string }[];

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
