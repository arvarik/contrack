import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";

// Nominatim's usage policy allows at most one request a second.
export const INTER_REQUEST_DELAY_MS = 1100;

/** What a lookup got: a place, nothing, or no answer (busy, down or offline). */
export type GeoOutcome =
  | {
      status: "found";
      lat: number;
      lng: number;
      provider: string;
      displayName?: string;
    }
  | { status: "none" }
  | { status: "error" };

/**
 * When the next Nominatim call may start. The queue and the place search both
 * wait for it, so the whole server keeps to one call a second.
 */
let nextTurnAt = 0;

async function takeTurn(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextTurnAt);
  nextTurnAt = at + INTER_REQUEST_DELAY_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/**
 * Resolve an address with Nominatim. Nothing found drops the first comma part
 * and tries the rest, up to four queries. No answer stops at once.
 */
export async function geocodeWithFallback(
  location: string,
): Promise<GeoOutcome> {
  let query = location;
  for (let step = 0; step < 4 && query.length > 0; step++) {
    const outcome = await geocodeSingle(query);
    if (outcome.status !== "none") return outcome;
    const parts = query.split(",");
    if (parts.length <= 1) break;
    query = parts.slice(1).join(",").trim();
  }
  return { status: "none" };
}

async function geocodeSingle(query: string): Promise<GeoOutcome> {
  await takeTurn();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "ContrackCRM/1.0 (personal-crm; geocoder; +https://github.com/arvarik/contrack)",
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      log.warn(
        "Geocode",
        `Nominatim returned HTTP ${res.status} for "${query}"`,
      );
      return { status: "error" };
    }
    const hit = (await res.json())?.[0];
    if (!hit) return { status: "none" };
    return {
      status: "found",
      lat: parseFloat(hit.lat),
      lng: parseFloat(hit.lon),
      provider: "Nominatim",
      displayName: hit.display_name,
    };
  } catch (err: unknown) {
    log.error("Geocode", `API error for "${query}": ${getErrorMessage(err)}`);
    return { status: "error" };
  } finally {
    clearTimeout(timeoutId);
  }
}
