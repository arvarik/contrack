import {
  queryOptions,
  type InvalidateQueryFilters,
  type QueryClient,
} from "@tanstack/react-query";
import type { Contact } from "../types";
import { STALE_TIMES } from "../lib/queryConfig";
import { contactRoutes } from "../../shared/contracts/contacts";
import { apiJson } from "./client";
import { GEO_STATUS_KEY } from "./geo";

/** One contact, as the contact page reads it. */
export const contactQuery = (id: string) =>
  queryOptions({
    queryKey: ["contacts", id],
    queryFn: async ({ signal }): Promise<Contact> =>
      (await apiJson(contactRoutes.get, `/contacts/${id}`, {
        signal,
      })) as Contact,
    staleTime: STALE_TIMES.contactDetail,
  });

/**
 * The views built from many contacts. Only those on screen refetch. The
 * dashboard keys are exact: the daily insight under it can cost an AI call.
 */
const DERIVED_VIEWS: InvalidateQueryFilters[] = [
  { queryKey: ["lists"] },
  { queryKey: ["list-contacts"] },
  { queryKey: ["actionItems"] },
  { queryKey: ["dashboard"], exact: true },
  { queryKey: ["dashboard", "activity"], exact: true },
  { queryKey: ["zeroState"] },
  { queryKey: GEO_STATUS_KEY },
];

function invalidateDerivedViews(client: QueryClient): void {
  for (const filters of DERIVED_VIEWS) void client.invalidateQueries(filters);
}

/**
 * Refresh every contact query and the views built from them. For a write
 * that adds, removes or merges contacts, or changes many at once.
 */
export function invalidateContactViews(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ["contacts"] });
  void client.invalidateQueries({ queryKey: ["trash"] });
  invalidateDerivedViews(client);
}

/** Put the server's copy of a contact on its page and in its list row. */
export function storeContact(client: QueryClient, contact: Contact): void {
  client.setQueryData(["contacts", contact.id], contact);
  client.setQueryData<Contact[]>(["contacts"], (old) =>
    old?.map((c) => (c.id === contact.id ? { ...c, ...contact } : c)),
  );
}

/**
 * Refreshes after a write to one contact without refetching the list: the
 * server's copy goes into its row. With only an id, the contact is read
 * first. If that read fails, every contact query refreshes.
 */
export async function refreshContact(
  client: QueryClient,
  contact: Contact | string,
): Promise<void> {
  const id = typeof contact === "string" ? contact : contact.id;
  const fresh =
    typeof contact === "string"
      ? await client
          .fetchQuery({ ...contactQuery(id), staleTime: 0 })
          .catch(() => null)
      : contact;
  if (fresh) {
    storeContact(client, fresh);
    void client.invalidateQueries({ queryKey: ["contacts", id, "score"] });
  } else {
    void client.invalidateQueries({ queryKey: ["contacts"] });
  }
  invalidateDerivedViews(client);
}

const writes = new Map<string, Promise<unknown>>();

/** Preserve edit order for one contact. A failed edit does not prevent the next edit. */
export function writeContactInOrder<T>(
  id: string,
  write: () => Promise<T>,
): Promise<T> {
  const previous = writes.get(id) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(write);
  writes.set(id, result);
  const clear = () => {
    if (writes.get(id) === result) writes.delete(id);
  };
  void result.then(clear, clear);
  return result;
}

/**
 * Writes a few fields onto one contact in both caches (the list's slim copy
 * and the page's full one) before the server answers, and returns the
 * rollback for a failed write.
 */
export function patchContactCaches(
  client: QueryClient,
  id: string,
  patch: Partial<Contact>,
): () => void {
  const list = client.getQueryData<Contact[]>(["contacts"]);
  const one = client.getQueryData<Contact>(["contacts", id]);
  client.setQueryData<Contact[]>(["contacts"], (old) =>
    old?.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  );
  client.setQueryData<Contact>(["contacts", id], (old) =>
    old ? { ...old, ...patch } : old,
  );
  return () => {
    client.setQueryData(["contacts"], list);
    client.setQueryData(["contacts", id], one);
  };
}

/** The waits between the looks: 2 s after the write, and again at 6 s. */
const PIN_CHECKS_MS = [2_000, 4_000];

/**
 * Ask again for a contact whose pin the geocoder may still place or move, and
 * write the new pin into both caches when it lands.
 */
export function followPin(client: QueryClient, contact: Contact): void {
  const { id, lat, lng, location, addresses } = contact;
  if (!location?.trim() && !addresses?.some((a) => a.address.trim())) return;
  void (async () => {
    for (const wait of PIN_CHECKS_MS) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      const fresh = await apiJson<Contact>(
        `/contacts/${encodeURIComponent(id)}`,
      ).catch(() => null);
      if (!fresh) return;
      if (fresh.lat === lat && fresh.lng === lng) continue;
      patchContactCaches(client, id, {
        lat: fresh.lat,
        lng: fresh.lng,
        geoSource: fresh.geoSource,
      });
      void client.invalidateQueries({ queryKey: GEO_STATUS_KEY });
      return;
    }
  })();
}
