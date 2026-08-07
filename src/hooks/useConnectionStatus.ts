/**
 * useConnectionStatus — one answer to "is Contrack reachable?".
 *
 * Before this existed, losing the server produced three different stories at
 * once: Pulse said "System Disconnected", the contact list rendered its
 * onboarding empty state ("Your network is empty" — alarming and false in a
 * CRM), and the detail view showed an error boundary. Each view was guessing
 * locally from its own failed query.
 *
 * The state is derived rather than stored, from two sources:
 *
 *   - `navigator.onLine`, which catches the browser knowing it is offline.
 *     It is famously unreliable in the positive direction (it reports true for
 *     a captive portal) so it is only ever trusted when it says *false*.
 *   - Any query in the cache currently failing with {@link NetworkError},
 *     which is the honest signal: we tried, and the transport failed.
 *
 * @module hooks/useConnectionStatus
 */
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isNetworkError } from "../api/client";

export type ConnectionStatus =
  /** Everything is fine. */
  | "online"
  /** The browser says there is no network at all. */
  | "offline"
  /** There is a network, but the Contrack server is not answering. */
  | "unreachable";

export interface Connection {
  status: ConnectionStatus;
  /** Convenience: anything other than "online". */
  isDown: boolean;
  /** Retry every failed query. */
  retry: () => void;
  /** True while a retry is in flight, so the UI can show progress. */
  isRetrying: boolean;
}

export function useConnectionStatus(): Connection {
  const queryClient = useQueryClient();
  const [isOffline, setIsOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false,
  );
  const [isUnreachable, setIsUnreachable] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  // Browser-level connectivity.
  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  // Server-level reachability, read off the query cache.
  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const sync = () => {
      setIsUnreachable(
        cache.getAll().some((query) => isNetworkError(query.state.error)),
      );
    };
    sync();
    return cache.subscribe(sync);
  }, [queryClient]);

  const retry = useCallback(() => {
    setIsRetrying(true);
    // `type: "all"` so paused and inactive queries are retried too — after a
    // laptop wakes up, the query the user is staring at is often not the one
    // that failed first.
    void queryClient
      .refetchQueries({ type: "all" })
      .finally(() => setIsRetrying(false));
  }, [queryClient]);

  const status: ConnectionStatus = isOffline
    ? "offline"
    : isUnreachable
      ? "unreachable"
      : "online";

  return { status, isDown: status !== "online", retry, isRetrying };
}
