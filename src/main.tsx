/**
 * main.tsx — React DOM entry point.
 *
 * Bootstraps the application by mounting the React tree into #root with
 * StrictMode, an ErrorBoundary, and the TanStack React Query provider.
 */
import { StrictMode } from "react";
import { AuthGate } from "./components/auth/AuthGate";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { logCacheEvent } from "./lib/queryConfig";
import { fetchContactsSlim } from "./api/contacts";
import App from "./App.tsx";
import "./index.css";

/**
 * Global React Query configuration.
 *
 * Defaults are tuned for a local-first app where data only changes via
 * the app's own mutations (which do targeted invalidation):
 *
 * - staleTime: 30s   → navigating away and back is instant (no refetch)
 * - gcTime: 10min    → cache survives longer navigations in-memory
 * - retry: 1         → local server failure = server down; don't hammer it
 * - refetchOnWindowFocus: false → alt-tab should not trigger background fetches
 *
 * NOTE: Per React Query rules, query-level staleTime overrides this global
 * (e.g. dashboard uses 2min, map uses 5min, lists use 60s).
 * See src/lib/queryConfig.ts for the full staleTime reference.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// =============================================================================
// Cold-boot Prefetch: Warm the contacts cache before the first render.
// =============================================================================
// The useInstantSearch hook depends on ['contacts'] being populated for 0ms
// client-side filtering. Without this prefetch, the first Cmd+K open after
// a page load has a ~20ms blank gap while the network round-trip completes.
//
// prefetchQuery uses the same queryKey so it shares the cache slot with
// useContacts() — zero duplication, zero extra network requests.
// =============================================================================
queryClient.prefetchQuery({
  queryKey: ["contacts"],
  queryFn: async () => {
    const data = await fetchContactsSlim();
    logCacheEvent({
      type: "prefetch",
      queryKey: "['contacts']",
      meta: { count: data.length, source: "cold-boot" },
    });
    return data;
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthGate>
          <App />
        </AuthGate>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
