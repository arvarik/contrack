/**
 * main.tsx — React DOM entry point.
 *
 * Bootstraps the application by mounting the React tree into #root with
 * StrictMode, an ErrorBoundary, and the TanStack React Query provider.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import App from './App.tsx';
import './index.css';

/**
 * Global React Query configuration.
 *
 * Defaults are tuned for a local-first app where data only changes via
 * the app's own mutations (which do targeted invalidation):
 *
 * - staleTime: 30s   → navigating away and back is instant (no refetch)
 * - gcTime: 5min     → cache survives short navigations fully in-memory
 * - retry: 1         → local server failure = server down; don't hammer it
 * - refetchOnWindowFocus: false → alt-tab should not trigger background fetches
 *
 * NOTE: Per React Query rules, query-level staleTime overrides this global
 * (e.g. dashboard uses 2hr, dedupe uses 30s, actionItems uses 5min).
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
