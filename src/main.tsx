/** The entry point: mounts the app into #root with its providers. */
// First, before any module builds a zod schema. See zodConfig.ts.
import "./lib/zodConfig";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { AuthGate } from "./components/auth/AuthGate";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { retryApiQuery } from "./api/client";
import App from "./App.tsx";
import "./index.css";

/**
 * Mutations invalidate what they touch, so there is no refetch on window
 * focus. Work that runs in the background (connector syncs, research batches,
 * imports) arrives by polling, each query with its own `refetchInterval`. A
 * query's own staleTime overrides this one (src/lib/queryConfig.ts).
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

// The contacts prefetch runs in AuthGate, beside its first /status and when
// the gate opens, not here: the gate is what ignores a 401 before it opens.
import { usePreferences } from "./contexts/PreferencesContext";

function MotionPreference({ children }: { children: React.ReactNode }) {
  const { preferences } = usePreferences();
  return (
    <MotionConfig
      reducedMotion={preferences.motion === "reduced" ? "always" : "user"}
    >
      {children}
    </MotionConfig>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthGate>
          <MotionPreference>
            <App />
          </MotionPreference>
        </AuthGate>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
