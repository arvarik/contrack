/**
 * A saved map view, as the server stores it and the client applies it. The
 * route and the client check a view's box with the one rule below.
 */
import { z } from "zod";

export const MAP_LAYERS = ["pins", "heat"] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

export type MapBounds = [
  west: number,
  south: number,
  east: number,
  north: number,
];

export interface MapView {
  id: string;
  name: string;
  query: string;
  layer: MapLayer;
  bounds: MapBounds;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** One edge of a box, in degrees from -limit to limit. */
const edge = (name: string, limit: number) => {
  const range = `${name} must be between -${limit} and ${limit}`;
  return z
    .number({ error: "Bounds coordinates must be finite numbers" })
    .min(-limit, range)
    .max(limit, range);
};

/**
 * A view's box. `fitBounds` cannot show one whose west edge is not west of
 * its east edge, so that box is refused, as a south edge past the north is.
 */
export const mapBoundsSchema = z
  .tuple(
    [
      edge("West longitude", 180),
      edge("South latitude", 90),
      edge("East longitude", 180),
      edge("North latitude", 90),
    ],
    {
      error:
        "Bounds must be an array of 4 coordinates [west, south, east, north]",
    },
  )
  .refine(
    ([, south, , north]) => south < north,
    "South latitude must be less than north latitude",
  )
  .refine(
    ([west, , east]) => west < east,
    "West longitude must be less than east longitude",
  );
