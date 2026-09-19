import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiJson, jsonBody } from "./client";
import { STALE_TIMES } from "../lib/queryConfig";

export type MapLayer = "pins" | "heat" | "health";
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

export function validateBounds(bounds: unknown): asserts bounds is MapBounds {
  if (!Array.isArray(bounds) || bounds.length !== 4) {
    throw new Error(
      "Bounds must be an array of 4 coordinates [west, south, east, north]",
    );
  }
  if (!bounds.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new Error("Bounds coordinates must be finite numbers");
  }
  const [west, south, east, north] = bounds as [number, number, number, number];
  if (west < -180 || west > 180) {
    throw new Error("West longitude must be between -180 and 180");
  }
  if (east < -180 || east > 180) {
    throw new Error("East longitude must be between -180 and 180");
  }
  if (south < -90 || south > 90) {
    throw new Error("South latitude must be between -90 and 90");
  }
  if (north < -90 || north > 90) {
    throw new Error("North latitude must be between -90 and 90");
  }
  if (south >= north) {
    throw new Error("South latitude must be less than north latitude");
  }
}

export async function fetchMapViews(signal?: AbortSignal): Promise<MapView[]> {
  const res = await apiJson<{ views: MapView[] }>("/map/views", { signal });
  return res.views;
}

export async function createMapView(data: {
  name: string;
  query?: string;
  layer?: MapLayer;
  bounds: MapBounds;
}): Promise<MapView> {
  validateBounds(data.bounds);
  return apiJson<MapView>("/map/views", {
    method: "POST",
    ...jsonBody(data),
  });
}

export async function updateMapView(
  id: string,
  data: {
    name?: string;
    query?: string;
    layer?: MapLayer;
    bounds?: MapBounds;
    sortOrder?: number;
  },
): Promise<MapView> {
  if (data.bounds !== undefined) {
    validateBounds(data.bounds);
  }
  return apiJson<MapView>(`/map/views/${id}`, {
    method: "PATCH",
    ...jsonBody(data),
  });
}

export async function deleteMapView(id: string): Promise<{ success: boolean }> {
  return apiJson<{ success: boolean }>(`/map/views/${id}`, {
    method: "DELETE",
  });
}

export function useMapViews() {
  return useQuery({
    queryKey: ["map-views"],
    queryFn: ({ signal }) => fetchMapViews(signal),
    staleTime: STALE_TIMES.mapViews,
  });
}

export function useCreateMapView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMapView,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["map-views"] });
    },
  });
}

export function useUpdateMapView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: {
        name?: string;
        query?: string;
        layer?: MapLayer;
        bounds?: MapBounds;
        sortOrder?: number;
      };
    }) => updateMapView(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["map-views"] });
    },
  });
}

export function useDeleteMapView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMapView,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["map-views"] });
    },
  });
}
