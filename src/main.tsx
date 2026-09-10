import { MotionConfig } from "motion/react";
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
import { retryApiQuery } from "./api/client";
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
      retry: retryApiQuery,
      refetchOnWindowFocus: false,
    },
  },
});

// =============================================================================
// The contacts prefetch used to run here, at module load.
// =============================================================================
// It warms the ['contacts'] cache that useInstantSearch reads, so the first
// Cmd+K after a page load has no blank gap. It ran before React rendered a
// single element, which on a gated instance meant the first request of every
// page load was a 401 — announced on the window to a listener that had not
// mounted yet, and answered by the gate a moment later with the same question
// asked properly.
//
// It now lives in AuthGate and runs the moment the gate opens. Same warm
// cache, one round trip later, and no request is made as nobody.
// =============================================================================

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthGate>
          <MotionConfig reducedMotion="user">
            <App />
          </MotionConfig>
        </AuthGate>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
