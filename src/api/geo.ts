import { apiJson } from "./client";

interface GeoSearchResult {
  query: string;
  lat: number;
  lng: number;
  provider: string;
  cached: boolean;
  /** The place the geocoder matched, for example "Lisbon, Portugal". */
  displayName?: string;
}

export async function searchPlace(
  q: string,
  signal?: AbortSignal,
): Promise<GeoSearchResult> {
  return apiJson<GeoSearchResult>(
    `/geo/search?q=${encodeURIComponent(q.trim())}`,
    { signal },
  );
}
