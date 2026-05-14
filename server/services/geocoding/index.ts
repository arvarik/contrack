import { sqlite } from "../../db.ts";
import { log } from "../../utils/logger.ts";
import { queueGeocode } from "./queue.ts";

const STARTUP_DELAY_MS = 2000;

export function startRetroactiveGeocoding(): void {
  setTimeout(() => {
    const ungeocoded = sqlite
      .prepare(
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
