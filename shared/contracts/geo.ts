// =============================================================================
// Contracts: geo
// =============================================================================
// The account's contacts that have an address and no pin yet, and the
// instance's address lookup switch. The place search and the map views are
// still on the UNCONTRACTED list.
// =============================================================================

import { z } from "zod";
import { route } from "./route.ts";

const notOnMapContactSchema = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    company: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    /** The address text the geocoder reads. */
    location: z.string(),
    isTracked: z.boolean(),
    lat: z.null(),
    lng: z.null(),
    /**
     * No answer from the geocoder yet, it found no place, or address lookups
     * are off on the instance.
     */
    reason: z.enum(["pending", "not-found", "off"]),
  })
  .meta({ id: "NotOnMapContact" });

/** The instance's address lookup switch, as the admin page shows it. */
const lookupsSchema = z
  .strictObject({
    /** True when no address is sent to Nominatim. */
    off: z.boolean(),
    /** True when GEOCODING_DISABLED holds lookups off. */
    lockedByEnv: z.boolean(),
    /** The Nominatim host lookups go to, or null when NOMINATIM_URL is bad. */
    host: z.string().nullable(),
  })
  .meta({ id: "AddressLookups" });

export const geoRoutes = {
  status: route({
    method: "GET",
    path: "/api/geo/status",
    summary: "The contacts with an address and no pin, and why each has none",
    response: z.strictObject({ contacts: z.array(notOnMapContactSchema) }),
  }),
  lookups: route({
    method: "GET",
    path: "/api/geo/lookups",
    summary: "Whether the server sends addresses to Nominatim (admin)",
    response: lookupsSchema,
  }),
  setLookups: route({
    method: "PUT",
    path: "/api/geo/lookups",
    summary: "Turn address lookups off or on for every account (admin)",
    body: z.strictObject({ off: z.boolean() }),
    response: lookupsSchema,
  }),
};

export type NotOnMapContact = z.infer<typeof notOnMapContactSchema>;
