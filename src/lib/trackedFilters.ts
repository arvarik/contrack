/**
 * The Tracked contacts page's two rows of filters and its order, as rules a
 * test can read.
 *
 * ```
 *   Tracking     All · Tracked · Not tracked
 *   Last spoke   Any · Past month · Past year · Over a year ago · Never
 *   Order        Name · Last spoke · Recently tracked
 * ```
 *
 * A contact shows when it matches both rows' choices. Each pill counts what
 * it would show beside the other row's choice. The choices live in the page
 * address, so Back from a contact returns to the same list. "Last spoke"
 * reads `lastContactedAt`, the last logged interaction.
 */
import { parseServerTime } from "./datetime";
import type { Contact } from "../types";

/** Whether a person is tracked: the first row. */
export type TrackingFilter = "all" | "tracked" | "not_tracked";

/** When you last spoke: the second row. */
export type SpokeFilter = "any" | "month" | "year" | "older" | "never";

/**
 * The list's order. `name` is A to Z, `spoke` is the last interaction,
 * newest first, and `recent` is the moment of tracking, newest first.
 */
export type TrackedOrder = "name" | "spoke" | "recent";

const TRACKING_FILTER_IDS: readonly TrackingFilter[] = [
  "all",
  "tracked",
  "not_tracked",
];

const SPOKE_FILTER_IDS: readonly SpokeFilter[] = [
  "any",
  "month",
  "year",
  "older",
  "never",
];

const TRACKED_ORDER_IDS: readonly TrackedOrder[] = ["name", "spoke", "recent"];

/** The page's three choices. */
export interface TrackedView {
  tracking: TrackingFilter;
  spoke: SpokeFilter;
  order: TrackedOrder;
}

/** The choices when the address names none. */
export const DEFAULT_TRACKED_VIEW: TrackedView = {
  tracking: "all",
  spoke: "any",
  order: "name",
};

const pick = <T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T => (value && allowed.includes(value as T) ? (value as T) : fallback);

/**
 * The choices a page address names: `?tracking=not_tracked&spoke=month`.
 * A missing or unknown value is its row's first choice.
 */
export function trackedViewFromParams(params: URLSearchParams): TrackedView {
  return {
    tracking: pick(params.get("tracking"), TRACKING_FILTER_IDS, "all"),
    spoke: pick(params.get("spoke"), SPOKE_FILTER_IDS, "any"),
    order: pick(params.get("order"), TRACKED_ORDER_IDS, "name"),
  };
}

/** The address's parameters with these choices. A first choice is left out. */
export function paramsWithTrackedView(
  params: URLSearchParams,
  next: Partial<TrackedView>,
): URLSearchParams {
  const out = new URLSearchParams(params);
  for (const key of ["tracking", "spoke", "order"] as const) {
    const value = next[key];
    if (value === undefined) continue;
    if (value === DEFAULT_TRACKED_VIEW[key]) out.delete(key);
    else out.set(key, value);
  }
  return out;
}

const DAY_MS = 86_400_000;

/** "Past month" is the last 30 days. */
const MONTH_DAYS = 30;

/** "Past year" is the last 365 days, and "Over a year ago" is before it. */
const YEAR_DAYS = 365;

/** The contact fields the rules read. */
type FilteredContact = Pick<Contact, "isTracked" | "lastContactedAt">;

/** The last interaction as epoch milliseconds, or null when there is none. */
export function lastSpokeAt(contact: Pick<Contact, "lastContactedAt">) {
  return parseServerTime(contact.lastContactedAt)?.getTime() ?? null;
}

/** Whether a contact is one the first row's choice shows. */
export function matchesTrackingFilter(
  contact: FilteredContact,
  filter: TrackingFilter,
): boolean {
  switch (filter) {
    case "tracked":
      return !!contact.isTracked;
    case "not_tracked":
      return !contact.isTracked;
    default:
      return true;
  }
}

/** Whether a contact is one the second row's choice shows. */
export function matchesSpokeFilter(
  contact: FilteredContact,
  filter: SpokeFilter,
  now: number = Date.now(),
): boolean {
  return matchesSpokeAt(lastSpokeAt(contact), filter, now);
}

/**
 * `matchesSpokeFilter` from a last interaction already read, as epoch
 * milliseconds or null. The page counts five pills for each contact, and
 * reads the date once for all five.
 */
export function matchesSpokeAt(
  at: number | null,
  filter: SpokeFilter,
  now: number = Date.now(),
): boolean {
  if (filter === "any") return true;
  if (filter === "never") return at === null;
  if (at === null) return false;
  const days = (now - at) / DAY_MS;
  switch (filter) {
    case "month":
      return days <= MONTH_DAYS;
    case "year":
      return days <= YEAR_DAYS;
    case "older":
      return days > YEAR_DAYS;
    default:
      return true;
  }
}
