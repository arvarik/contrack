// =============================================================================
// Geocoding: the instance switch and the server it asks
// =============================================================================
// Every address the map places is sent to a Nominatim server. Two things stop
// that for the whole instance:
//   - GEOCODING_DISABLED=true (or 1) in the server's environment. It wins:
//     while it is set, Settings cannot turn lookups back on.
//   - the `geocoding.off` app setting, which an admin sets in Settings →
//     Administration → General.
// While lookups are off, no address leaves the server. A contact still gets a
// pin from the shared cache, from an earlier answer, or by hand.
//
// NOMINATIM_URL points the lookups at a self-hosted Nominatim instead of the
// public one. A value that is not an http or https URL turns lookups off, so
// a typo never sends addresses to the public server the operator meant to
// avoid.
// =============================================================================

import { getSetting, setSetting } from "../settingsService.ts";
import { log } from "../../utils/logger.ts";

/** boolean: an admin turned address lookups off for every account. */
export const GEOCODING_OFF_SETTING = "geocoding.off";

const PUBLIC_NOMINATIM = "https://nominatim.openstreetmap.org";

/** What the admin page shows about the switch. */
export interface GeocodingState {
  /** True when no address may leave this instance. */
  off: boolean;
  /** True when GEOCODING_DISABLED set it, so Settings cannot turn it on. */
  lockedByEnv: boolean;
  /** The host lookups go to, such as `nominatim.openstreetmap.org`. */
  host: string | null;
}

/** True when GEOCODING_DISABLED is `true` or `1`, in any case. */
export function geocodingLockedByEnv(): boolean {
  const value = process.env.GEOCODING_DISABLED?.trim().toLowerCase();
  return value === "true" || value === "1";
}

let warnedBadUrl = false;

/**
 * The Nominatim base URL, without a trailing slash: NOMINATIM_URL, or the
 * public server. Null when NOMINATIM_URL is set to something that is not an
 * http or https URL.
 */
export function nominatimBaseUrl(): string | null {
  const raw = process.env.NOMINATIM_URL?.trim();
  if (!raw) return PUBLIC_NOMINATIM;
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString().replace(/\/+$/, "");
    }
  } catch {
    // Reported below.
  }
  if (!warnedBadUrl) {
    warnedBadUrl = true;
    log.warn(
      "Geocode",
      "NOMINATIM_URL is not an http or https URL, so address lookups are off",
    );
  }
  return null;
}

/** True when no address may be sent to Nominatim. */
export function isGeocodingOff(): boolean {
  return (
    geocodingLockedByEnv() ||
    getSetting<boolean>(GEOCODING_OFF_SETTING) === true ||
    nominatimBaseUrl() === null
  );
}

/** Turn address lookups off (true) or back on (false) for every account. */
export function setGeocodingOff(off: boolean): void {
  setSetting(GEOCODING_OFF_SETTING, off);
  log.info(
    "Geocode",
    off
      ? "Address lookups turned off: no address leaves the server"
      : "Address lookups turned back on",
  );
}

/** The switch as the admin page shows it. */
export function geocodingState(): GeocodingState {
  const base = nominatimBaseUrl();
  return {
    off: isGeocodingOff(),
    lockedByEnv: geocodingLockedByEnv(),
    host: base ? new URL(base).host : null,
  };
}
