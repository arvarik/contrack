import { useQuery } from "@tanstack/react-query";
import type { NotOnMapContact, PlaceSearchResult } from "../../shared/geo";
import { apiJson } from "./client";

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
      (
        await apiJson<{ contacts: NotOnMapContact[] }>("/geo/status", {
          signal,
        })
      ).contacts,
  });
