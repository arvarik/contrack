/** Statistics for the contacts in the map's viewport. Pure, with no DOM. */
import tzlookup from "@photostructure/tz-lookup";
import { isPastDay } from "../../../shared/dates";
import { type MapContact, isValidLatLng } from "../../../shared/geo";
import { boundsContain } from "./mapMath";

/** Why nobody is on the map: the contacts load, failed to load, or have no place. */
export type MapEmpty = "loading" | "failed" | "none";

export interface TopBucket {
  name: string;
  count: number;
}

interface TimeZoneBucket {
  label: string;
  count: number;
  offsetMinutes: number;
}

export interface MapStats {
  /** Contacts in view (inside map bounds and passing filter). */
  inView: number;
  /** Contacts matching the filter, in view or not. */
  matching: number;
  /** In-view contacts whose next follow-up's day is before today. */
  overdue: number;
  /** Top 5 in view by count, then name. The same for companies and tags. */
  topIndustries: TopBucket[];
  topCompanies: TopBucket[];
  topTags: TopBucket[];
  /** Time zones for in-view contacts, bucketed by UTC offset. */
  timeZones: TimeZoneBucket[];
}

type MapBounds =
  | [west: number, south: number, east: number, north: number]
  | {
      getWest: () => number;
      getSouth: () => number;
      getEast: () => number;
      getNorth: () => number;
    };

function parseOffsetMinutes(tzPart: string): number {
  const match = tzPart.match(/^GMT([+-])(\d+)(?::(\d+))?$/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = parseInt(match[2], 10);
  const mins = match[3] ? parseInt(match[3], 10) : 0;
  return sign * (hours * 60 + mins);
}

/**
 * A zone's UTC offset at `now`, such as "GMT-4", cached per zone in `labels`.
 * One `Intl.DateTimeFormat` per contact took about 130 ms for 5,800 people.
 */
function offsetLabel(zone: string, now: Date, labels: Map<string, string>) {
  let label = labels.get(zone);
  if (label === undefined) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(now);
    label = parts.find((p) => p.type === "timeZoneName")?.value || "GMT";
    labels.set(zone, label);
  }
  return label;
}

const tzGridCache = new Map<string, string | null>();

function lookupTimeZone(lat: number, lng: number): string | null {
  const key = `${Math.round(lat * 100)},${Math.round(lng * 100)}`;
  const cached = tzGridCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const tz = tzlookup(lat, lng) || null;
    tzGridCache.set(key, tz);
    return tz;
  } catch {
    // Ignore tz-lookup errors for ocean/boundary points
    tzGridCache.set(key, null);
    return null;
  }
}

function addBucket(
  buckets: Map<string, TopBucket>,
  raw: string | null | undefined,
): void {
  const name = raw?.trim();
  if (!name) return;
  const key = name.toLowerCase();
  const existing = buckets.get(key);
  if (existing) {
    existing.count++;
  } else {
    buckets.set(key, { name, count: 1 });
  }
}

function topFive(buckets: Map<string, TopBucket>): TopBucket[] {
  return Array.from(buckets.values())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5);
}

/** Contacts with a valid place inside `bounds`, or every placed one. */
export function getInViewContacts(
  contacts: readonly MapContact[],
  bounds?: MapBounds | null,
): MapContact[] {
  return contacts.filter((c) => {
    if (!isValidLatLng(c.lat, c.lng)) return false;
    if (!bounds) return true;
    return boundsContain(bounds, {
      lat: c.lat as number,
      lng: c.lng as number,
    });
  });
}

/** `contacts` already match the filter. Null `bounds` puts all in view. */
export function computeMapStats(
  contacts: readonly MapContact[],
  bounds?: MapBounds | null,
  now: Date = new Date(),
  precomputedInView?: readonly MapContact[],
): MapStats {
  const matching = contacts.length;

  const inViewContacts =
    precomputedInView ?? getInViewContacts(contacts, bounds);
  const inView = inViewContacts.length;
  if (inView === 0) {
    return {
      inView: 0,
      matching,
      overdue: 0,
      topIndustries: [],
      topCompanies: [],
      topTags: [],
      timeZones: [],
    };
  }

  let overdue = 0;

  const industryCounts = new Map<string, TopBucket>();
  const companyCounts = new Map<string, TopBucket>();
  const tagCounts = new Map<string, TopBucket>();
  const tzBuckets = new Map<
    string,
    { count: number; offsetMinutes: number; label: string }
  >();
  const offsetLabels = new Map<string, string>();

  for (const c of inViewContacts) {
    // By day, as the contact page's banner counts it. As instants, a follow-up
    // set to "Tomorrow" is overdue by 6 PM in Los Angeles.
    if (isPastDay(c.nextFollowUpAt, now)) overdue++;

    addBucket(industryCounts, c.industry);
    addBucket(companyCounts, c.company);

    if (c.tags && Array.isArray(c.tags)) {
      for (const tag of c.tags) {
        const t = typeof tag === "string" ? tag : (tag as { tag: string }).tag;
        addBucket(tagCounts, t);
      }
    }

    if (isValidLatLng(c.lat, c.lng)) {
      const tz = lookupTimeZone(c.lat as number, c.lng as number);
      if (tz) {
        const tzPart = offsetLabel(tz, now, offsetLabels);
        const current = tzBuckets.get(tzPart);
        if (current) {
          current.count++;
        } else {
          tzBuckets.set(tzPart, {
            count: 1,
            offsetMinutes: parseOffsetMinutes(tzPart),
            label: tzPart,
          });
        }
      }
    }
  }

  const timeZones: TimeZoneBucket[] = Array.from(tzBuckets.values())
    .map((data) => ({
      label: data.label,
      count: data.count,
      offsetMinutes: data.offsetMinutes,
    }))
    .sort((a, b) => b.count - a.count || a.offsetMinutes - b.offsetMinutes);

  return {
    inView,
    matching,
    overdue,
    topIndustries: topFive(industryCounts),
    topCompanies: topFive(companyCounts),
    topTags: topFive(tagCounts),
    timeZones,
  };
}
