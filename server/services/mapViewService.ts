import crypto from "crypto";
import { z } from "zod";
import { sqlite } from "../db.ts";
import type { Scope } from "../tenancy/scope.ts";
import { AppError, NotFoundError } from "../utils/AppError.ts";
import {
  MAP_LAYERS,
  mapBoundsSchema,
  type MapBounds,
  type MapView,
} from "../../shared/mapViews.ts";

/**
 * A view's layer. Health was a third layer until v2: a view saved with it,
 * and a save from a page loaded before v2, open on Pins rather than fail.
 */
const layerSchema = z.preprocess(
  (value) => (value === "health" ? "pins" : value),
  z.enum(MAP_LAYERS),
);

const NAME_RULE = "Name must be between 1 and 60 characters";
const nameSchema = z.string().trim().min(1, NAME_RULE).max(60, NAME_RULE);
const querySchema = z
  .string()
  .trim()
  .max(200, "Query cannot exceed 200 characters");

/** The body of `POST /api/map/views`. */
export const mapViewCreateSchema = z.object({
  name: nameSchema,
  query: querySchema.default(""),
  layer: layerSchema.default("pins"),
  bounds: mapBoundsSchema,
});

/** The body of `PATCH /api/map/views/:id`. Every field is optional. */
export const mapViewUpdateSchema = z
  .object({
    name: nameSchema,
    query: querySchema,
    layer: layerSchema,
    bounds: mapBoundsSchema,
    sortOrder: z.number().int().min(0),
  })
  .partial();

export interface MapViewRow {
  id: string;
  ownerId: string;
  name: string;
  query: string;
  /** As stored, which may be a layer this version no longer draws. */
  layer: string;
  bounds: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

function parseRow(row: MapViewRow): MapView {
  let bounds: MapBounds = [-180, -90, 180, 90];
  try {
    bounds = mapBoundsSchema.parse(JSON.parse(row.bounds));
  } catch {
    // A corrupt box, or one saved before a rule, opens on the whole world.
  }
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    layer: layerSchema.safeParse(row.layer).data ?? "pins",
    bounds,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const mapViewService = {
  listMapViews(scope: Scope): MapView[] {
    const rows = sqlite
      .prepare(
        `SELECT * FROM map_views WHERE ownerId = ? ORDER BY sortOrder ASC, name ASC, createdAt ASC`,
      )
      .all(scope.ownerId) as MapViewRow[];
    return rows.map(parseRow);
  },

  getMapView(scope: Scope, id: string): MapView {
    const row = sqlite
      .prepare(`SELECT * FROM map_views WHERE id = ? AND ownerId = ?`)
      .get(id, scope.ownerId) as MapViewRow | undefined;
    if (!row) {
      throw new NotFoundError("MapView");
    }
    return parseRow(row);
  },

  createMapView(
    scope: Scope,
    input: z.output<typeof mapViewCreateSchema>,
  ): MapView {
    const countRow = sqlite
      .prepare("SELECT COUNT(*) AS n FROM map_views WHERE ownerId = ?")
      .get(scope.ownerId) as { n: number };
    if (countRow.n >= 100) {
      throw new AppError("Maximum 100 saved views reached", 409, {
        code: "TOO_MANY_VIEWS",
      });
    }

    const { name, query, layer, bounds } = input;
    const maxOrder = sqlite
      .prepare(
        "SELECT MAX(sortOrder) as maxOrder FROM map_views WHERE ownerId = ?",
      )
      .get(scope.ownerId) as { maxOrder: number | null };
    const sortOrder = (maxOrder?.maxOrder ?? -1) + 1;
    const id = crypto.randomUUID();
    const boundsJson = JSON.stringify(bounds);

    sqlite
      .prepare(
        `INSERT INTO map_views (id, ownerId, name, query, layer, bounds, sortOrder)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, scope.ownerId, name, query, layer, boundsJson, sortOrder);

    return this.getMapView(scope, id);
  },

  updateMapView(
    scope: Scope,
    id: string,
    patch: z.output<typeof mapViewUpdateSchema>,
  ): MapView {
    // Assert row exists for this owner
    this.getMapView(scope, id);

    const updates: string[] = [];
    const values: unknown[] = [];

    if (patch.name !== undefined) {
      updates.push("name = ?");
      values.push(patch.name);
    }

    if (patch.query !== undefined) {
      updates.push("query = ?");
      values.push(patch.query);
    }

    if (patch.layer !== undefined) {
      updates.push("layer = ?");
      values.push(patch.layer);
    }

    if (patch.bounds !== undefined) {
      updates.push("bounds = ?");
      values.push(JSON.stringify(patch.bounds));
    }

    sqlite.transaction(() => {
      if (updates.length > 0) {
        updates.push("updatedAt = CURRENT_TIMESTAMP");
        values.push(id, scope.ownerId);
        sqlite
          .prepare(
            `UPDATE map_views SET ${updates.join(", ")} WHERE id = ? AND ownerId = ?`,
          )
          .run(...values);
      }
      // `sortOrder` is a place in the list. The view moves there, and the
      // others keep their order around it.
      if (patch.sortOrder !== undefined) {
        const ids = this.listMapViews(scope)
          .map((view) => view.id)
          .filter((other) => other !== id);
        ids.splice(patch.sortOrder, 0, id);
        const place = sqlite.prepare(
          "UPDATE map_views SET sortOrder = ? WHERE id = ? AND ownerId = ?",
        );
        ids.forEach((viewId, i) => place.run(i, viewId, scope.ownerId));
      }
    })();

    return this.getMapView(scope, id);
  },

  deleteMapView(scope: Scope, id: string): { success: boolean } {
    // Assert row exists for this owner
    this.getMapView(scope, id);

    sqlite
      .prepare(`DELETE FROM map_views WHERE id = ? AND ownerId = ?`)
      .run(id, scope.ownerId);

    return { success: true };
  },
};
