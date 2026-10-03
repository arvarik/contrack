import type { QueryClient } from "@tanstack/react-query";
import type { Contact } from "../types";
import { apiJson } from "./client";

/** Refresh contact lists and the views whose counts depend on them. */
export function invalidateContactViews(client: QueryClient): void {
  for (const key of [
    "contacts",
    "lists",
    "list-contacts",
    "actionItems",
    "dashboard",
    "zeroState",
    "trash",
    "relationships",
    "geo",
  ]) {
    void client.invalidateQueries({ queryKey: [key] });
  }
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
 * Write a few fields onto one contact in both caches, before the server has
 * answered, and hand back the way to undo it.
 *
 * The list holds the slim contact and the page holds the full one, so a
 * flag that changes on the page has to change in the list at the same time
 * or the row's ring disagrees with the header's. A write that fails calls
 * the rollback, which puts both caches back as they were.
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
      void client.invalidateQueries({ queryKey: ["geo"] });
      return;
    }
  })();
}
