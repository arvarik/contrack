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

/** The contacts with an address and no pin. Every contact write refreshes it. */
export const useGeoStatus = () =>
  useQuery({
    queryKey: ["geo", "status"],
    queryFn: async ({ signal }) =>
      (
        await apiJson<{ contacts: NotOnMapContact[] }>("/geo/status", {
          signal,
        })
      ).contacts,
  });
