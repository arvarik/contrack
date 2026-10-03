import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiJson, jsonBody } from "./client";
import { STALE_TIMES } from "../lib/queryConfig";
import { UNDO_DURATION_MS } from "../lib/undoToast";
import {
  mapBoundsSchema,
  type MapBounds,
  type MapLayer,
  type MapView,
} from "../../shared/mapViews";

export type { MapBounds, MapLayer, MapView };

/** Throw, before sending, the message the server gives for a box it refuses. */
function validateBounds(bounds: unknown): void {
  const parsed = mapBoundsSchema.safeParse(bounds);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
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

async function deleteMapView(id: string): Promise<{ success: boolean }> {
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

/** Delete a view. The toast's Undo saves it again: name, query, layer and box. */
export function useDeleteMapView() {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["map-views"] });
  return useMutation({
    mutationFn: (view: MapView) => deleteMapView(view.id),
    onSuccess: (_result, { name, query, layer, bounds }) => {
      refresh();
      toast.success(`View "${name}" deleted`, {
        duration: UNDO_DURATION_MS,
        action: {
          label: "Undo",
          onClick: () =>
            createMapView({ name, query, layer, bounds })
              .then(refresh)
              .catch((err: Error) =>
                toast.error(`Could not restore "${name}": ${err.message}`),
              ),
        },
      });
    },
    onError: (err, view) =>
      toast.error(`Could not delete "${view.name}": ${err.message}`),
  });
}
