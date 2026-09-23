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

import { isPastDay } from "./dates";
import { scoreView } from "./scoreBand";

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

/** One row of `GET /api/contacts/map` and the projection of a slim row. */
export interface MapContact {
  id: string;
  name: string;
  company: string | null;
  role?: string | null;
  industry?: string | null;
  location: string | null;
  avatarUrl: string | null;
  themeColor?: string | null;
  lat: number;
  lng: number;
  relationshipScore?: number | null;
  lastContactedAt?: string | null;
  /**
   * A person chose to keep up with this contact. Only a tracked contact has
   * a score, so the health layer and the stats both ask this first. The
   * field is required, so the compiler names every builder of a map row.
   */
  isTracked: boolean;
  nextFollowUpAt?: string | null;
  cadenceDays?: number | null;
  interactionCount?: number;
  tags?: string[];
  lists?: { id: string; name: string }[];
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
  /** The score, left out for a contact with none: untracked, or never met. */
  score?: number;
  /** 1 for a scored contact in the At risk band, and 0 for anybody else. */
  atRisk: number;
  overdue: number;
  weight: number;
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
 * Distance between two coordinates in kilometers using the Haversine formula.
 * Earth radius R = 6371 km.
 */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
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
  now: Date = new Date(),
): ContactFeatureCollection {
  const features: ContactPointFeature[] = [];
  for (const contact of contacts) {
    if (!isValidLatLng(contact.lat, contact.lng)) continue;
    // An untracked contact has no score, and a contact nobody has met yet
    // has none either. Neither one is At risk: the band needs a score.
    const view = scoreView(contact);
    const atRisk =
      view.kind === "scored" && view.band.band === "at-risk" ? 1 : 0;
    // By the calendar day, as the contact page's banner counts. The instant
    // said a follow-up set to "Tomorrow" was late by the evening before.
    const overdue = isPastDay(contact.nextFollowUpAt, now) ? 1 : 0;
    const weight = contact.interactionCount ?? 0;

    const properties: ContactPointProperties = {
      id: contact.id,
      name: contact.name,
      atRisk,
      overdue,
      weight,
    };
    if (view.kind === "scored") properties.score = view.score;
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
