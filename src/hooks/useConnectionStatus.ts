/**
 * One answer to "is Contrack reachable?" for the whole app, so no view
 * guesses from its own failed query. Derived, not stored, from two sources:
 *
 *   - `navigator.onLine`, trusted only when it says false, because it says
 *     true behind a captive portal.
 *   - Any cached query failing with {@link NetworkError}: the transport
 *     failed.
 */
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isNetworkError } from "../api/client";

type ConnectionStatus =
  /** Everything is fine. */
  | "online"
  /** The browser says there is no network at all. */
  | "offline"
  /** There is a network, but the Contrack server is not answering. */
  | "unreachable";

interface Connection {
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
