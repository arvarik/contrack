import { sqlite } from "../../db.ts";
import { log } from "../../utils/logger.ts";
import type { NotOnMapContact } from "../../../shared/geo.ts";
import type { Scope } from "../../tenancy/scope.ts";
import { isRecentFailure, normalizeLocationKey } from "./cache.ts";
import { queueGeocode } from "./queue.ts";

const STARTUP_DELAY_MS = 2000;

/** A contact's first address with text, in the order its page lists them. */
export const PRIMARY_ADDRESS_SQL = `(SELECT address FROM contact_addresses
  WHERE contactId = contacts.id AND address != ''
  ORDER BY isPrimary DESC, sortOrder ASC LIMIT 1)`;

/**
 * The text the geocoder reads for a contact: the primary address first, then
 * `location`. Every path that queues a lookup reads it here.
 */
export function geocodeText(
  primaryAddress: string | null,
  location: string | null,
): string | null {
  return [primaryAddress, location].find((text) => text?.trim()) ?? null;
}

interface AddressRow {
  id: string;
  location: string | null;
  primaryAddress: string | null;
}

/**
 * Contacts with address text and no pin, across every account, for the
 * startup sweep. A pin placed by hand is left out by name.
 */
export function contactsAwaitingGeocode(): { id: string; text: string }[] {
  const rows = sqlite
    .prepare(
      // The geocode cache is shared by design, and the sweep writes only lat/lng.
      // tenant-lint: allow instance sweep
      `SELECT id, location, ${PRIMARY_ADDRESS_SQL} AS primaryAddress FROM contacts
        WHERE (lat IS NULL OR lng IS NULL) AND (geoSource IS NULL OR geoSource != 'manual')`,
    )
    .all() as AddressRow[];
  return rows.flatMap(({ id, primaryAddress, location }) => {
    const text = geocodeText(primaryAddress, location);
    return text ? [{ id, text }] : [];
  });
}

type StatusRow = AddressRow &
  Pick<NotOnMapContact, "name" | "company" | "avatarUrl"> & {
    isTracked: number;
  };

/** The caller's contacts with address text and no pin, and why each has none. */
export function notOnMap(scope: Scope): NotOnMapContact[] {
  const rows = sqlite
    .prepare(
      `SELECT id, name, company, avatarUrl, location, isTracked,
              ${PRIMARY_ADDRESS_SQL} AS primaryAddress
         FROM contacts
        WHERE ownerId = ? AND (lat IS NULL OR lng IS NULL)
          AND (isArchived = 0 OR isArchived IS NULL) AND deletedAt IS NULL
          AND (isGhost = 0 OR isGhost IS NULL) AND canonicalId IS NULL
        ORDER BY name COLLATE NOCASE`,
    )
    .all(scope.ownerId) as StatusRow[];
  return rows.flatMap((row): NotOnMapContact[] => {
    const text = geocodeText(row.primaryAddress, row.location);
    if (!text) return [];
    const failed = isRecentFailure(normalizeLocationKey(text));
    return [
      {
        id: row.id,
        name: row.name,
        company: row.company,
        avatarUrl: row.avatarUrl,
        location: text,
        isTracked: !!row.isTracked,
        lat: null,
        lng: null,
        reason: failed ? "not-found" : "pending",
      },
    ];
  });
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
        queueGeocode(c.id, c.text);
      }
    }
  }, STARTUP_DELAY_MS);
}

export { queueGeocode };
