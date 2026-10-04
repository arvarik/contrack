// =============================================================================
// Contracts: geo
// =============================================================================
// The account's contacts that have an address and no pin yet. The place
// search and the map views are still on the UNCONTRACTED list.
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
    /** No answer from the geocoder yet, or it found no place. */
    reason: z.enum(["pending", "not-found"]),
  })
  .meta({ id: "NotOnMapContact" });

export const geoRoutes = {
  status: route({
    method: "GET",
    path: "/api/geo/status",
    summary: "The contacts with an address and no pin, and why each has none",
    response: z.strictObject({ contacts: z.array(notOnMapContactSchema) }),
  }),
};

export type NotOnMapContact = z.infer<typeof notOnMapContactSchema>;
