// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PreferencesProvider } from "../../src/contexts/PreferencesContext";
import { SessionProvider } from "../../src/contexts/SessionContext";
import { SearchView } from "../../src/views/SearchView";
import type { SearchCoverage } from "../../src/api/search";

const mockCoverage = vi.hoisted(() => ({
  data: {
    total: 20,
    indexed: 15,
    missing: 5,
    pending: 5,
    failed: 0,
    coverage: 75,
    isIndexing: false,
    provider: {
      kind: "builtin" as const,
      providerId: null,
      model: null,
      isPaid: false,
    },
    failedItems: [],
  } as SearchCoverage | null,
}));

vi.mock("../../src/api", async () => {
  const actual = await import("../../src/api/search");
  return {
    useSemanticSearch: () => ({
      data: null,
      submittedQuery: "",
      isPending: false,
      isSuccess: false,
      isError: false,
      error: null,
      phase: "idle",
      run: vi.fn(),
      rerun: vi.fn(),
      mutate: vi.fn(),
      reset: vi.fn(),
    }),
    useSearchCoverage: () => ({
      data: mockCoverage.data,
      isLoading: false,
    }),
    useRefreshSearchIndex: actual.useRefreshSearchIndex,
  };
});

vi.mock("../../src/views/search/SearchCoverageBar", () => ({
  SearchCoverageBar: ({ compact }: { compact?: boolean }) => (
    <div
      data-testid={
        compact ? "search-coverage-bar-compact" : "search-coverage-bar-full"
      }
    >
      Search Coverage Bar Mock ({compact ? "compact" : "full"})
    </div>
  ),
}));

vi.mock("../../src/views/search/SearchResultCards", () => ({
  ResultCard: () => null,
  ShimmerCard: () => null,
}));

vi.mock("../../src/components/FloatingContactCard", () => ({
  FloatingContactCard: () => null,
}));

function stubMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("min-width"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

describe("SearchView - Search coverage empty state", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    stubMatchMedia();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            preferences: {
              theme: "system",
              accent: "#006a91",
              listDensity: "comfortable",
              recentLimit: 3,
              askHistoryOpen: false,
            },
            stored: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const renderComponent = (path = "/search") =>
    render(
      <QueryClientProvider client={queryClient}>
        <PreferencesProvider>
          <SessionProvider>
            <MemoryRouter initialEntries={[path]}>
              <SearchView />
            </MemoryRouter>
          </SessionProvider>
        </PreferencesProvider>
      </QueryClientProvider>,
    );

  it("shows SearchCoverageBar and explanation sentence when coverage < 100% in people mode", async () => {
    mockCoverage.data = {
      total: 20,
      indexed: 15,
      missing: 5,
      pending: 5,
      failed: 0,
      coverage: 75,
      isIndexing: false,
      provider: {
        kind: "builtin",
        providerId: null,
        model: null,
        isPaid: false,
      },
      failedItems: [],
    };

    renderComponent("/search");

    expect(await screen.findByText("Ask anything")).toBeTruthy();
    expect(
      screen.getByText(
        "Indexing turns contacts into searchable concepts so you can find people by meaning rather than exact words.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("search-coverage-bar-full")).toBeTruthy();
    expect(screen.getByTestId("search-coverage-bar-compact")).toBeTruthy();
  });

  it("hides SearchCoverageBar and explanation when coverage is 100%", async () => {
    mockCoverage.data = {
      total: 20,
      indexed: 20,
      missing: 0,
      pending: 0,
      failed: 0,
      coverage: 100,
      isIndexing: false,
      provider: {
        kind: "builtin",
        providerId: null,
        model: null,
        isPaid: false,
      },
      failedItems: [],
    };

    renderComponent("/search");

    expect(await screen.findByText("Ask anything")).toBeTruthy();
    expect(
      screen.queryByText(
        "Indexing turns contacts into searchable concepts so you can find people by meaning rather than exact words.",
      ),
    ).toBeNull();
    expect(screen.queryByTestId("search-coverage-bar-full")).toBeNull();
    // Compact bar in header stays
    expect(screen.getByTestId("search-coverage-bar-compact")).toBeTruthy();
  });

  it("does not render coverage card in notes search mode", async () => {
    mockCoverage.data = {
      total: 20,
      indexed: 10,
      missing: 10,
      pending: 0,
      failed: 0,
      coverage: 50,
      isIndexing: false,
      provider: {
        kind: "builtin",
        providerId: null,
        model: null,
        isPaid: false,
      },
      failedItems: [],
    };

    renderComponent("/search?mode=notes");

    expect(
      screen.queryByText(
        "Indexing turns contacts into searchable concepts so you can find people by meaning rather than exact words.",
      ),
    ).toBeNull();
    expect(screen.queryByTestId("search-coverage-bar-full")).toBeNull();
  });
});
