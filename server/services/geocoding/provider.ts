import { isValidLatLng } from "../../../shared/geo.ts";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import { nominatimBaseUrl } from "./switch.ts";

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
 * Canonical anchor queries for broad metro/regional location strings (such as
 * LinkedIn regions) that either fail in Nominatim, match a body of water
 * ("San Francisco Bay Area"), or match a namesake town in another country
 * ("Greater Boston Area" -> Lincolnshire, UK).
 */
const METRO_ANCHORS: Record<string, string> = {
  "new york city metropolitan area": "Manhattan, New York, NY",
  "greater new york city area": "Manhattan, New York, NY",
  "new york metropolitan area": "Manhattan, New York, NY",
  "nyc metropolitan area": "Manhattan, New York, NY",
  "nyc metro area": "Manhattan, New York, NY",
  "nyc metro": "Manhattan, New York, NY",
  nyc: "Manhattan, New York, NY",
  "tri-state area": "Manhattan, New York, NY",
  "tri state area": "Manhattan, New York, NY",
  "san francisco bay area": "San Francisco, CA",
  "sf bay area": "San Francisco, CA",
  "bay area": "San Francisco, CA",
  "silicon valley": "Palo Alto, CA",
  "south bay": "San Jose, CA",
  "east bay": "Oakland, CA",
  "greater boston area": "Boston, MA",
  "greater boston": "Boston, MA",
  "boston metropolitan area": "Boston, MA",
  "greater seattle area": "Seattle, WA",
  "seattle metropolitan area": "Seattle, WA",
  "puget sound": "Seattle, WA",
  "pacific northwest": "Seattle, WA",
  pnw: "Seattle, WA",
  "greater chicago area": "Chicago, IL",
  "chicago metropolitan area": "Chicago, IL",
  chicagoland: "Chicago, IL",
  "greater los angeles area": "Los Angeles, CA",
  "los angeles metropolitan area": "Los Angeles, CA",
  "la metro": "Los Angeles, CA",
  "southern california": "Los Angeles, CA",
  socal: "Los Angeles, CA",
  "northern california": "San Francisco, CA",
  norcal: "San Francisco, CA",
  "washington dc-baltimore area": "Washington, DC",
  "washington d.c.-baltimore area": "Washington, DC",
  "washington dc metro area": "Washington, DC",
  "washington d.c. metro area": "Washington, DC",
  "washington metropolitan area": "Washington, DC",
  "national capital region": "Washington, DC",
  dmv: "Washington, DC",
  "dmv area": "Washington, DC",
  "dallas-fort worth metroplex": "Dallas, TX",
  "dallas/fort worth area": "Dallas, TX",
  "dallas-fort worth area": "Dallas, TX",
  dfw: "Dallas, TX",
  "dfw metroplex": "Dallas, TX",
  "greater houston": "Houston, TX",
  "houston metropolitan area": "Houston, TX",
  "miami-fort lauderdale area": "Miami, FL",
  "south florida metropolitan area": "Miami, FL",
  "south florida": "Miami, FL",
  "minneapolis-st. paul area": "Minneapolis, MN",
  "minneapolis-saint paul area": "Minneapolis, MN",
  "twin cities": "Minneapolis, MN",
  "raleigh-durham-chapel hill area": "Raleigh, NC",
  "raleigh-durham area": "Raleigh, NC",
  "raleigh-durham": "Raleigh, NC",
  "research triangle": "Raleigh, NC",
  "research triangle park": "Raleigh, NC",
  rtp: "Raleigh, NC",
  "greater philadelphia area": "Philadelphia, PA",
  "greater philadelphia": "Philadelphia, PA",
  "delaware valley": "Philadelphia, PA",
  "greater atlanta area": "Atlanta, GA",
  "metro atlanta": "Atlanta, GA",
  "atlanta metropolitan area": "Atlanta, GA",
  "greater denver area": "Denver, CO",
  "denver metropolitan area": "Denver, CO",
  "front range": "Denver, CO",
  "greater phoenix area": "Phoenix, AZ",
  "phoenix metropolitan area": "Phoenix, AZ",
  "valley of the sun": "Phoenix, AZ",
  "greater detroit area": "Detroit, MI",
  "metro detroit": "Detroit, MI",
  "detroit metropolitan area": "Detroit, MI",
  "greater austin area": "Austin, TX",
  "austin metropolitan area": "Austin, TX",
  "tampa bay area": "Tampa, FL",
  "new england": "Boston, MA",
  "greater toronto area": "Toronto, ON, Canada",
  gta: "Toronto, ON, Canada",
  "greater vancouver metropolitan area": "Vancouver, BC, Canada",
  "greater vancouver": "Vancouver, BC, Canada",
  "greater montreal metropolitan area": "Montreal, QC, Canada",
  "greater london area": "London, United Kingdom",
  "greater london": "London, United Kingdom",
  "greater paris metropolitan region": "Paris, France",
  "delhi ncr": "New Delhi, India",
  randstad: "Amsterdam, Netherlands",
};

const NON_PLACE_TERMS = new Set([
  "remote",
  "work from home",
  "wfh",
  "wfa",
  "anywhere",
  "global",
  "worldwide",
  "n/a",
  "unknown",
  "tbd",
]);

/**
 * Clean a raw location string for geocoding: strip work-mode qualifiers, map
 * known metropolitan/regional phrases to their canonical anchor city, and strip
 * generic "Greater ... Area" / "... Metropolitan Area" wrappers.
 */
export function cleanLocationQuery(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(
      /\s*[(["']?\b(?:remote|hybrid|on-?site|relocating)\b[)\]"']?\s*/gi,
      " ",
    )
    .replace(/^(?:based\s+in|located\s+in)\s+/i, "")
    .replace(/^[-–—,:|/]+\s*|\s*[-–—,:|/]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const lower = cleaned.toLowerCase();
  if (!lower || NON_PLACE_TERMS.has(lower)) return "";
  if (METRO_ANCHORS[lower]) return METRO_ANCHORS[lower];

  const firstComma = lower.split(",")[0].trim();
  if (METRO_ANCHORS[firstComma]) return METRO_ANCHORS[firstComma];

  const stripped = cleaned
    .replace(/^(?:the\s+)?(?:greater|metro)\s+/i, "")
    .replace(
      /\s+(?:metropolitan\s+(?:area|region)|metro\s+(?:area|region)|metroplex|bay\s+area|metro|area|region|vicinity|environs)(?=\s*(?:,|$))/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

  const strippedLower = stripped.toLowerCase();
  if (METRO_ANCHORS[strippedLower]) return METRO_ANCHORS[strippedLower];

  return stripped || cleaned;
}

function buildGeocodeCandidates(location: string): string[] {
  const primary = cleanLocationQuery(location);
  if (!primary) return [];

  const candidates: string[] = [];
  const push = (q: string) => {
    const trimmed = q.trim();
    if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed);
  };

  push(primary);

  // If the leading place segment is a hyphenated or slash-separated compound
  // metro (e.g. "Champaign-Urbana, IL" or "San Francisco / Oakland, CA"), try
  // the primary city before the separator if the compound name returns nothing.
  const commaParts = primary.split(",");
  const firstSegment = commaParts[0].trim();
  const compoundMatch = firstSegment.match(/^([^/-]+?)\s*[/-]\s*.+$/);
  if (compoundMatch) {
    const leadCity = compoundMatch[1].trim();
    const rest = commaParts.slice(1).join(",").trim();
    if (leadCity.length >= 2) {
      push(rest ? `${leadCity}, ${rest}` : leadCity);
    }
  }

  let current = primary;
  while (candidates.length < 4) {
    const parts = current.split(",");
    if (parts.length <= 1) break;
    current = parts.slice(1).join(",").trim();
    push(current);
  }

  return candidates.slice(0, 4);
}

/**
 * Resolve an address with Nominatim (NOMINATIM_URL, or the public server).
 * Normalizes metro/regional strings first, and if nothing is found, tries
 * broader fallbacks up to four queries. No answer stops at once. The log names
 * no address.
 */
export async function geocodeWithFallback(
  location: string,
): Promise<GeoOutcome> {
  const candidates = buildGeocodeCandidates(location);
  for (const query of candidates) {
    const outcome = await geocodeSingle(query);
    if (outcome.status !== "none") return outcome;
  }
  return { status: "none" };
}

async function geocodeSingle(query: string): Promise<GeoOutcome> {
  const base = nominatimBaseUrl();
  if (!base) return { status: "error" };
  await takeTurn();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const url = `${base}/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
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
      log.warn("Geocode", `Nominatim answered HTTP ${res.status}`);
      return { status: "error" };
    }
    const hit = (await res.json())?.[0];
    if (!hit) return { status: "none" };
    const lat = parseFloat(hit.lat);
    const lng = parseFloat(hit.lon);
    if (!isValidLatLng(lat, lng) || (lat === 0 && lng === 0)) {
      return { status: "none" };
    }
    return {
      status: "found",
      lat,
      lng,
      provider: "Nominatim",
      displayName: hit.display_name,
    };
  } catch (err: unknown) {
    log.error("Geocode", `Nominatim did not answer: ${getErrorMessage(err)}`);
    return { status: "error" };
  } finally {
    clearTimeout(timeoutId);
  }
}
