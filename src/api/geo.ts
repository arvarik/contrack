import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlaceSearchResult } from "../../shared/geo";
import { geoRoutes } from "../../shared/contracts/geo";
import { apiJson, jsonBody } from "./client";

export async function searchPlace(
  q: string,
  signal?: AbortSignal,
): Promise<PlaceSearchResult> {
  return apiJson<PlaceSearchResult>(
    `/geo/search?q=${encodeURIComponent(q.trim())}`,
    { signal },
  );
}

/** The not-on-the-map list's key. A place lookup's key starts with "geo" too. */
export const GEO_STATUS_KEY = ["geo", "status"] as const;

/** The contacts with an address and no pin. Every contact write refreshes it. */
export const useGeoStatus = () =>
  useQuery({
    queryKey: GEO_STATUS_KEY,
    queryFn: async ({ signal }) =>
      (await apiJson(geoRoutes.status, "/geo/status", { signal })).contacts,
  });

const LOOKUPS_KEY = ["geo", "lookups"] as const;

/** Whether the server sends addresses to Nominatim. Admins only. */
export const useAddressLookups = () =>
  useQuery({
    queryKey: LOOKUPS_KEY,
    queryFn: ({ signal }) =>
      apiJson(geoRoutes.lookups, "/geo/lookups", { signal }),
  });

/** Turn address lookups off (true) or on (false) for every account. */
export const useSetAddressLookups = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (off: boolean) =>
      apiJson(geoRoutes.setLookups, "/geo/lookups", jsonBody({ off })),
    onSuccess: (state) => {
      qc.setQueryData(LOOKUPS_KEY, state);
      // The not-on-the-map list says why a contact has no pin.
      void qc.invalidateQueries({ queryKey: GEO_STATUS_KEY });
    },
  });
};
