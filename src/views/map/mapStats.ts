/**
 * mapStats — client-side reduction over contacts in the map viewport.
 *
 * Visible means inside `bounds` (or all if bounds is null) and passing any active filter.
 * Pure computation with no DOM dependency so it can run anywhere (even a Web Worker).
 *
 * @module views/map/mapStats
 */
import tzlookup from "tz-lookup";
import { isPastDay } from "../../../shared/dates";
import { type MapContact, isValidLatLng } from "../../../shared/geo";
import { scoreView } from "../../../shared/scoreBand";
import { boundsContain } from "./mapMath";

export interface TopBucket {
  name: string;
  count: number;
}

export interface TimeZoneBucket {
  offset: string;
  label: string;
  count: number;
  offsetMinutes: number;
}

export interface MapStats {
  /** Contacts in view (inside map bounds and passing filter). */
  inView: number;
  /** Total contacts matching the filter query. */
  matching: number;
  /** Total contacts in dataset before filtering. */
  total: number;
  /**
   * In-view contacts in the At risk band (a score under 40). Only a tracked
   * contact has a score, so an untracked pin counts for nobody.
   */
  atRisk: number;
  /** In-view contacts whose next follow-up's day is before today. */
  overdue: number;
  /** In-view contacts who have never been contacted. */
  neverContacted: number;
  /** The mean score of the in-view contacts that have one, or null for none. */
  avgScore: number | null;
  /** Top 5 industries in view, sorted by count descending then name ascending. */
  topIndustries: TopBucket[];
  /** Top 5 companies in view, sorted by count descending then name ascending. */
  topCompanies: TopBucket[];
  /** Top 5 tags in view, sorted by count descending then name ascending. */
  topTags: TopBucket[];
  /** Time zones for in-view contacts, bucketed by UTC offset. */
  timeZones: TimeZoneBucket[];
}

export type MapBounds =
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

function topFive(counts: Map<string, number>): TopBucket[] {
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5);
}

/**
 * Filter contacts to those within the viewport bounds.
 */
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

/**
 * Pure reduction over contacts computing viewport statistics.
 *
 * @param contacts Contacts matching current filter (or all placed contacts).
 * @param bounds Viewport bounding box (null means treat all placed contacts as in view).
 * @param now Current clock time for overdue / time zone calculations.
 * @param totalCount Optional total contact count before filtering (defaults to contacts.length).
 */
export function computeMapStats(
  contacts: readonly MapContact[],
  bounds?: MapBounds | null,
  now: Date = new Date(),
  totalCount?: number,
): MapStats {
  const total = totalCount ?? contacts.length;
  const matching = contacts.length;

  const inViewContacts = getInViewContacts(contacts, bounds);
  const inView = inViewContacts.length;
  if (inView === 0) {
    return {
      inView: 0,
      matching,
      total,
      atRisk: 0,
      overdue: 0,
      neverContacted: 0,
      avgScore: null,
      topIndustries: [],
      topCompanies: [],
      topTags: [],
      timeZones: [],
    };
  }

  let atRisk = 0;
  let overdue = 0;
  let neverContacted = 0;
  let scoreSum = 0;
  let scoredCount = 0;

  const industryCounts = new Map<string, number>();
  const companyCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const tzBuckets = new Map<
    string,
    { count: number; offsetMinutes: number; label: string }
  >();

  for (const c of inViewContacts) {
    // The score and the band. A contact nobody tracks has no score, and one
    // nobody has met yet has none either. Neither counts as At risk and
    // neither moves the average: the pane used to count both, so a fresh
    // import read as an address book in trouble.
    const view = scoreView(c);
    if (view.kind === "scored") {
      scoreSum += view.score;
      scoredCount++;
      if (view.band.band === "at-risk") {
        atRisk++;
      }
    }

    // Overdue: the follow-up's day is before today, as the contact page's
    // banner counts it. Compared as instants, a follow-up set to "Tomorrow"
    // was one overdue by 6 PM in Los Angeles.
    if (isPastDay(c.nextFollowUpAt, now)) overdue++;

    // Never contacted
    if (
      !c.lastContactedAt &&
      (!c.interactionCount || c.interactionCount === 0)
    ) {
      neverContacted++;
    }

    // Industry
    if (c.industry && c.industry.trim()) {
      const ind = c.industry.trim();
      industryCounts.set(ind, (industryCounts.get(ind) ?? 0) + 1);
    }

    // Company
    if (c.company && c.company.trim()) {
      const comp = c.company.trim();
      companyCounts.set(comp, (companyCounts.get(comp) ?? 0) + 1);
    }

    // Tags
    if (c.tags && Array.isArray(c.tags)) {
      for (const tag of c.tags) {
        const t = (
          typeof tag === "string" ? tag : (tag as { tag: string }).tag
        )?.trim();
        if (t) {
          tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
        }
      }
    }

    // Timezone
    if (isValidLatLng(c.lat, c.lng)) {
      try {
        const tz = tzlookup(c.lat as number, c.lng as number);
        if (tz) {
          const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            timeZoneName: "shortOffset",
          }).formatToParts(now);
          const tzPart =
            parts.find((p) => p.type === "timeZoneName")?.value || "GMT";
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
      } catch {
        // Ignore tz-lookup errors for ocean/boundary points
      }
    }
  }

  const avgScore = scoredCount > 0 ? Math.round(scoreSum / scoredCount) : null;

  const timeZones: TimeZoneBucket[] = Array.from(tzBuckets.entries())
    .map(([offset, data]) => ({
      offset,
      label: data.label,
      count: data.count,
      offsetMinutes: data.offsetMinutes,
    }))
    .sort((a, b) => b.count - a.count || a.offsetMinutes - b.offsetMinutes);

  return {
    inView,
    matching,
    total,
    atRisk,
    overdue,
    neverContacted,
    avgScore,
    topIndustries: topFive(industryCounts),
    topCompanies: topFive(companyCounts),
    topTags: topFive(tagCounts),
    timeZones,
  };
}
