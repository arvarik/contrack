import crypto from "crypto";
import { sqlite } from "../db.ts";
import type { Scope } from "../tenancy/scope.ts";
import { AppError, NotFoundError, ValidationError } from "../utils/AppError.ts";

export type MapLayer = "pins" | "heat" | "health";
export type MapBounds = [
  west: number,
  south: number,
  east: number,
  north: number,
];

export interface MapViewRow {
  id: string;
  ownerId: string;
  name: string;
  query: string;
  layer: MapLayer;
  bounds: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

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

export function validateBounds(bounds: unknown): asserts bounds is MapBounds {
  if (!Array.isArray(bounds) || bounds.length !== 4) {
    throw new ValidationError(
      "Bounds must be an array of 4 coordinates [west, south, east, north]",
    );
  }
  if (!bounds.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new ValidationError("Bounds coordinates must be finite numbers");
  }
  const [west, south, east, north] = bounds as [number, number, number, number];
  if (west < -180 || west > 180) {
    throw new ValidationError("West longitude must be between -180 and 180");
  }
  if (east < -180 || east > 180) {
    throw new ValidationError("East longitude must be between -180 and 180");
  }
  if (south < -90 || south > 90) {
    throw new ValidationError("South latitude must be between -90 and 90");
  }
  if (north < -90 || north > 90) {
    throw new ValidationError("North latitude must be between -90 and 90");
  }
  if (south >= north) {
    throw new ValidationError(
      "South latitude must be less than north latitude",
    );
  }
}

function parseRow(row: MapViewRow): MapView {
  let bounds: MapBounds = [-180, -90, 180, 90];
  try {
    const parsed = JSON.parse(row.bounds);
    validateBounds(parsed);
    bounds = parsed;
  } catch {
    // Fallback to global bounds if corrupt
  }
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    layer: row.layer,
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
    input: {
      name: string;
      query?: string;
      layer?: string;
      bounds: unknown;
    },
  ): MapView {
    const countRow = sqlite
      .prepare("SELECT COUNT(*) AS n FROM map_views WHERE ownerId = ?")
      .get(scope.ownerId) as { n: number };
    if (countRow.n >= 100) {
      throw new AppError("Maximum 100 saved views reached", 409, {
        code: "TOO_MANY_VIEWS",
      });
    }

    const name = (input.name ?? "").trim();
    if (!name || name.length > 60) {
      throw new ValidationError("Name must be between 1 and 60 characters");
    }

    const query = (input.query ?? "").trim();
    if (query.length > 200) {
      throw new ValidationError("Query cannot exceed 200 characters");
    }

    const layer = (input.layer ?? "pins") as MapLayer;
    if (!["pins", "heat", "health"].includes(layer)) {
      throw new ValidationError("Layer must be pins, heat, or health");
    }

    validateBounds(input.bounds);

    const maxOrder = sqlite
      .prepare(
        "SELECT MAX(sortOrder) as maxOrder FROM map_views WHERE ownerId = ?",
      )
      .get(scope.ownerId) as { maxOrder: number | null };
    const sortOrder = (maxOrder?.maxOrder ?? -1) + 1;
    const id = crypto.randomUUID();
    const boundsJson = JSON.stringify(input.bounds);

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
    patch: {
      name?: string;
      query?: string;
      layer?: string;
      bounds?: unknown;
      sortOrder?: number;
    },
  ): MapView {
    // Assert row exists for this owner
    this.getMapView(scope, id);

    const updates: string[] = [];
    const values: unknown[] = [];

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name || name.length > 60) {
        throw new ValidationError("Name must be between 1 and 60 characters");
      }
      updates.push("name = ?");
      values.push(name);
    }

    if (patch.query !== undefined) {
      const query = patch.query.trim();
      if (query.length > 200) {
        throw new ValidationError("Query cannot exceed 200 characters");
      }
      updates.push("query = ?");
      values.push(query);
    }

    if (patch.layer !== undefined) {
      const layer = patch.layer as MapLayer;
      if (!["pins", "heat", "health"].includes(layer)) {
        throw new ValidationError("Layer must be pins, heat, or health");
      }
      updates.push("layer = ?");
      values.push(layer);
    }

    if (patch.bounds !== undefined) {
      validateBounds(patch.bounds);
      updates.push("bounds = ?");
      values.push(JSON.stringify(patch.bounds));
    }

    if (patch.sortOrder !== undefined) {
      if (
        typeof patch.sortOrder !== "number" ||
        !Number.isInteger(patch.sortOrder) ||
        patch.sortOrder < 0
      ) {
        throw new ValidationError("sortOrder must be a non-negative integer");
      }
      updates.push("sortOrder = ?");
      values.push(patch.sortOrder);
    }

    if (updates.length > 0) {
      updates.push("updatedAt = CURRENT_TIMESTAMP");
      values.push(id, scope.ownerId);
      sqlite
        .prepare(
          `UPDATE map_views SET ${updates.join(", ")} WHERE id = ? AND ownerId = ?`,
        )
        .run(...values);
    }

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
