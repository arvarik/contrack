/**
 * The map's data, shared by the server that sends it and the client that
 * draws it.
 *
 * `GET /api/contacts/map` returns one row per placed contact. The route keeps
 * that row shape, and the client turns the rows into a GeoJSON
 * FeatureCollection here, because MapLibre clusters a GeoJSON source and
 * nothing else. A row whose coordinates cannot be drawn is dropped at this
 * boundary, so the map never receives one.
 *
 * @module shared/geo
 */

/**
 * The basemap style URL for each palette, as `GET /api/auth/status` reports
 * it in `map`. An absolute `https://` URL or a root-relative path.
 */
export interface MapStyleUrls {
  light: string;
  dark: string;
}

/**
 * Who placed a contact's pin. `"geocoder"` read it from the address,
 * `"manual"` is a person who dragged it, and null is a pin nobody has placed
 * yet, or one that arrived with the coordinates already set.
 */
export type GeoSource = "geocoder" | "manual" | null;

/** One row of `GET /api/contacts/map`. */
export interface MapContact {
  id: string;
  name: string;
  company: string | null;
  avatarUrl: string | null;
  location: string | null;
  lat: number;
  lng: number;
  geoSource?: GeoSource;
}

/**
 * The properties of one contact point in the map source.
 *
 * Absent fields are left out rather than set to null: the source is
 * serialised into MapLibre's worker, and a missing key reads the same on
 * both sides.
 */
export interface ContactPointProperties {
  id: string;
  name: string;
  company?: string;
  avatarUrl?: string;
  location?: string;
}

export interface ContactPointFeature {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: ContactPointProperties;
}

export interface ContactFeatureCollection {
  type: "FeatureCollection";
  features: ContactPointFeature[];
}

/** True when both values are finite and inside the WGS 84 ranges. */
export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Build the map source from the route's rows.
 *
 * GeoJSON orders a position longitude first. The contact id is the feature
 * id and the `id` property, because MapLibre keeps properties through
 * clustering and does not keep a string feature id.
 */
export function toFeatureCollection(
  contacts: readonly MapContact[],
): ContactFeatureCollection {
  const features: ContactPointFeature[] = [];
  for (const contact of contacts) {
    if (!isValidLatLng(contact.lat, contact.lng)) continue;
    const properties: ContactPointProperties = {
      id: contact.id,
      name: contact.name,
    };
    if (contact.company) properties.company = contact.company;
    if (contact.avatarUrl) properties.avatarUrl = contact.avatarUrl;
    if (contact.location) properties.location = contact.location;
    features.push({
      type: "Feature",
      id: contact.id,
      geometry: { type: "Point", coordinates: [contact.lng, contact.lat] },
      properties,
    });
  }
  return { type: "FeatureCollection", features };
}
