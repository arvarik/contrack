/**
 * An undo window in front of a write the server cannot undo: deleting an
 * interaction (a hard delete, attachment included) or completing a follow-up
 * on Pulse. `startPendingDelete` hides the entry and shows a toast with Undo.
 * Undo sends nothing. When the toast closes, or a fallback timer runs out,
 * the request goes out once, and a failure shows the entry again.
 *
 * The ids live in this module, not in component state, so a refetch during
 * the window stays hidden and leaving the page does not cancel the delete.
 * A closing page sends every waiting delete on `pagehide`, with `keepalive`.
 */
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { apiFetch } from "../api/client";

/** How long Undo stays on screen. The same as `lib/undoToast.ts`. */
const UNDO_WINDOW_MS = 10_000;

/**
 * The latest end of the window, if the toast never reports its close. Sonner
 * pauses a toast under the pointer and in a hidden tab, so twice the window
 * gives a person who hovers time to reach Undo.
 */
export const FALLBACK_MS = UNDO_WINDOW_MS * 2;

interface PendingDelete {
  /** `waiting` in the undo window, `sending` after it, `deleted` at the end. */
  status: "waiting" | "sending" | "deleted";
  /** Sends the DELETE through the caller's mutation. */
  send: () => Promise<unknown>;
  timer?: ReturnType<typeof setTimeout>;
  toastId?: string | number;
  errorMessage?: string;
  flushUrl?: string;
  flushMethod?: string;
}

/**
 * Every delete of this session, by id. A finished delete stays, so the entry
 * does not flash back before the timeline refetch lands.
 */
const entries = new Map<string, PendingDelete>();
const listeners = new Set<() => void>();
/** A new set on each change, so `useSyncExternalStore` sees a new snapshot. */
let hiddenIds: ReadonlySet<string> = new Set();
let listening = false;

function publish(): void {
  hiddenIds = new Set(entries.keys());
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getHiddenIds(): ReadonlySet<string> {
  return hiddenIds;
}

/**
 * The ids that must not be shown: in the undo window, being sent, or
 * deleted in this session.
 */
export function useHiddenPendingIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getHiddenIds, getHiddenIds);
}

/** True while `entry` is still the store's entry for `id`. */
const isCurrent = (id: string, entry: PendingDelete) =>
  entries.get(id) === entry;

/**
 * Close the entry's toast. The id is checked first, because a call with no id
 * closes every toast on the page.
 */
function dismissToast(entry: PendingDelete): void {
  if (entry.toastId !== undefined) toast.dismiss(entry.toastId);
}

/** Send one delete and record how it ends. */
function send(
  id: string,
  entry: PendingDelete,
  request: () => Promise<unknown>,
): void {
  entry.status = "sending";
  clearTimeout(entry.timer);
  // The executor runs at once, so the request starts in this call. A send
  // that throws becomes a rejection, and the entry shows again.
  new Promise((resolve) => resolve(request())).then(
    () => {
      entry.status = "deleted";
    },
    () => {
      if (!isCurrent(id, entry)) return;
      entries.delete(id);
      publish();
      toast.error(
        entry.errorMessage ??
          "Could not delete the interaction. It is back on the timeline",
      );
    },
  );
}

/** The window is over: send the delete, unless Undo or an earlier end came first. */
function endWindow(id: string, entry: PendingDelete): void {
  if (!isCurrent(id, entry) || entry.status !== "waiting") return;
  send(id, entry, entry.send);
}

/** Undo: forget the delete. Nothing was sent, so nothing needs to be put back. */
function undo(id: string, entry: PendingDelete): void {
  if (!isCurrent(id, entry) || entry.status !== "waiting") return;
  clearTimeout(entry.timer);
  entries.delete(id);
  publish();
}

/**
 * Send every delete that is still in its undo window.
 *
 * Runs on `pagehide`. A request of a closing page is canceled unless it uses
 * `keepalive`, so this path calls the API directly and not the mutation.
 */
function flushPendingDeletes(): void {
  for (const [id, entry] of entries) {
    if (entry.status !== "waiting") continue;
    const url = entry.flushUrl ?? `/interactions/${encodeURIComponent(id)}`;
    send(id, entry, () =>
      apiFetch(url, {
        method: entry.flushMethod ?? "DELETE",
        keepalive: true,
      }),
    );
    // A page kept in the back-forward cache can come back. Its toast must
    // not offer an Undo that no longer works.
    dismissToast(entry);
  }
}

interface PendingDeleteOptions {
  /** The interaction or item to delete. */
  id: string;
  /** Sends the DELETE. Resolves when the server deleted the row. */
  send: () => Promise<unknown>;
  /** Optional toast message. Defaults to "Interaction deleted". */
  message?: string;
  /** Optional error toast message. */
  errorMessage?: string;
  /** Optional endpoint URL for pagehide keepalive delete. Defaults to `/interactions/${id}`. */
  flushUrl?: string;
  /** Optional method of that request. Defaults to DELETE. */
  flushMethod?: string;
}

/**
 * Hide an item now, and delete it on the server when Undo is no longer
 * offered.
 */
export function startPendingDelete({
  id,
  send: request,
  message = "Interaction deleted",
  errorMessage,
  flushUrl,
  flushMethod,
}: PendingDeleteOptions): void {
  if (entries.has(id)) return;
  if (!listening && typeof window !== "undefined") {
    window.addEventListener("pagehide", flushPendingDeletes);
    listening = true;
  }

  const entry: PendingDelete = {
    status: "waiting",
    send: request,
    errorMessage,
    flushUrl,
    flushMethod,
  };
  entries.set(id, entry);
  // Each callback holds this entry. A late callback of an old toast then
  // cannot end the window of a newer delete of the same id.
  const end = () => endWindow(id, entry);
  entry.toastId = toast.success(message, {
    duration: UNDO_WINDOW_MS,
    action: { label: "Undo", onClick: () => undo(id, entry) },
    onAutoClose: end,
    onDismiss: end,
  });
  entry.timer = setTimeout(() => {
    end();
    dismissToast(entry);
  }, FALLBACK_MS);
  publish();
}

/** Forget every delete without sending it. For tests only. */
export function resetPendingDeletes(): void {
  entries.forEach((entry) => clearTimeout(entry.timer));
  entries.clear();
  publish();
}
