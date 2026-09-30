/**
 * enrichmentFilters: the Enrichment page's two rows of filters, as rules a
 * test can read.
 *
 * ```
 *   Contacts   All · Tracked · Has links · Has email · No data
 *   Research   Any · Not yet · 6+ months ago · Found nothing
 * ```
 *
 * One choice in each row, and a contact shows when it matches both: tracked
 * contacts whose research is six months old, or everyone research found
 * nothing on. The rows answer the two questions a batch starts from, who
 * matters and whose research is missing or old, so a person can pick a batch
 * worth its cost. Each pill counts what it would show beside the other row's
 * choice. The page keeps both choices in its address (`filtersFromParams`),
 * so Back from a contact opened from the list returns to the same list.
 *
 * @module lib/enrichmentFilters
 */
import type { Contact } from "../types";

/** Who: the first row. */
export type ContactFilter =
  "all" | "tracked" | "has_links" | "has_email" | "no_data";

/** How their research stands: the second row. */
export type ResearchFilter = "any" | "not_yet" | "stale" | "found_nothing";

/** The first row's choices, in order. */
const CONTACT_FILTER_IDS: readonly ContactFilter[] = [
  "all",
  "tracked",
  "has_links",
  "has_email",
  "no_data",
];

/** The second row's choices, in order. */
const RESEARCH_FILTER_IDS: readonly ResearchFilter[] = [
  "any",
  "not_yet",
  "stale",
  "found_nothing",
];

/** One choice in each row. */
export interface EnrichmentFilters {
  contacts: ContactFilter;
  research: ResearchFilter;
}

/**
 * The choices a page address names: `?contacts=tracked&research=stale`. The
 * page keeps them there, so Back from a contact opened from the list comes
 * back to the same list. A missing or unknown value is the row's first
 * choice.
 */
export function filtersFromParams(params: URLSearchParams): EnrichmentFilters {
  const contacts = params.get("contacts") as ContactFilter | null;
  const research = params.get("research") as ResearchFilter | null;
  return {
    contacts:
      contacts && CONTACT_FILTER_IDS.includes(contacts) ? contacts : "all",
    research:
      research && RESEARCH_FILTER_IDS.includes(research) ? research : "any",
  };
}

/** The address's parameters with these choices. A row's first choice is left out. */
export function paramsWithFilters(
  params: URLSearchParams,
  next: Partial<EnrichmentFilters>,
): URLSearchParams {
  const out = new URLSearchParams(params);
  if (next.contacts === "all") out.delete("contacts");
  else if (next.contacts) out.set("contacts", next.contacts);
  if (next.research === "any") out.delete("research");
  else if (next.research) out.set("research", next.research);
  return out;
}

/** Research older than this is due again: six months. */
const STALE_AFTER_MS = 183 * 24 * 60 * 60 * 1000;

/** The contact fields the rules read. */
export type FilteredContact = Pick<
  Contact,
  | "isTracked"
  | "emails"
  | "socialLinks"
  | "socialLinkCount"
  | "aiHydratedAt"
  | "researchOutcome"
>;

const linkCount = (contact: FilteredContact) =>
  contact.socialLinkCount ?? contact.socialLinks?.length ?? 0;

const emailCount = (contact: FilteredContact) => contact.emails?.length ?? 0;

/** Whether a contact is one the first row's choice shows. */
export function matchesContactFilter(
  contact: FilteredContact,
  filter: ContactFilter,
): boolean {
  switch (filter) {
    case "tracked":
      return !!contact.isTracked;
    case "has_links":
      return linkCount(contact) > 0;
    case "has_email":
      return emailCount(contact) > 0;
    case "no_data":
      return linkCount(contact) === 0 && emailCount(contact) === 0;
    default:
      return true;
  }
}

/** Whether a contact is one the second row's choice shows. */
export function matchesResearchFilter(
  contact: FilteredContact,
  filter: ResearchFilter,
  now: number = Date.now(),
): boolean {
  switch (filter) {
    case "not_yet":
      return !contact.aiHydratedAt;
    case "stale": {
      if (!contact.aiHydratedAt) return false;
      const at = Date.parse(contact.aiHydratedAt);
      return Number.isFinite(at) && now - at > STALE_AFTER_MS;
    }
    case "found_nothing":
      return contact.researchOutcome === "no-public-info";
    default:
      return true;
  }
}
