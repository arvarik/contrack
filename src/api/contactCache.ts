import type { QueryClient } from "@tanstack/react-query";
import type { Contact } from "../types";

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
