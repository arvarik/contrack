import type { QueryClient } from "@tanstack/react-query";

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
