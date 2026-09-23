// @vitest-environment jsdom
// =============================================================================
// SearchView — the index's one line under the search box
// =============================================================================
// People search reads the contacts that have been indexed. While some are
// not, the page says so in one slim row under the search box, with the
// action that fixes it, and it says nothing once every contact is indexed.
// There is no coverage card, no hero and no explanation any more. The row is
// the real SearchCoverageBar; only the coverage it reads is set here, and
// `fetch` records what its buttons send.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PreferencesProvider } from "../../src/contexts/PreferencesContext";
import { SessionProvider } from "../../src/contexts/SessionContext";
import { SearchView } from "../../src/views/SearchView";
import type { SearchCoverage } from "../../src/api/search";

const mockCoverage = vi.hoisted(() => ({
  data: null as SearchCoverage | null,
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

vi.mock("../../src/views/search/SearchResultCards", () => ({
  ResultCard: () => null,
  ShimmerCard: () => null,
}));

vi.mock("../../src/components/FloatingContactCard", () => ({
  FloatingContactCard: () => null,
}));

/** Twenty contacts on the built-in model, with the fields a test sets. */
function coverageOf(overrides: Partial<SearchCoverage>): SearchCoverage {
  return {
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
    ...overrides,
  };
}

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

interface Sent {
  url: string;
  method: string;
  body: unknown;
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const refreshes = (sent: Sent[]) =>
  sent.filter((s) => s.url.endsWith("/search/refresh-index"));

/** The row, by the name it is found by. */
const row = () =>
  screen.queryByRole("region", { name: "Semantic search coverage" });

describe("SearchView - the coverage row", () => {
  let queryClient: QueryClient;
  let sent: Sent[];

  beforeEach(() => {
    stubMatchMedia();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    sent = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        sent.push({
          url,
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (url.endsWith("/search/refresh-index")) {
          return Promise.resolve(
            json({
              ok: true,
              queued: 8,
              message: "Queued 8 contact(s) for indexing",
            }),
          );
        }
        if (url.includes("/search/history")) {
          return Promise.resolve(
            json({ entries: [], nextCursor: null, total: 0 }),
          );
        }
        return Promise.resolve(
          json({
            preferences: {
              theme: "system",
              accent: "#006a91",
              listDensity: "comfortable",
              recentLimit: 3,
              askHistoryOpen: false,
            },
            stored: [],
          }),
        );
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const tree = (path: string) => (
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider>
        <SessionProvider>
          <MemoryRouter initialEntries={[path]}>
            <SearchView />
          </MemoryRouter>
        </SessionProvider>
      </PreferencesProvider>
    </QueryClientProvider>
  );

  /** Renders the page. `refresh` renders it again, as a refetch would. */
  const renderComponent = (path = "/search") => {
    const view = render(tree(path));
    return { ...view, refresh: () => view.rerender(tree(path)) };
  };

  it("says how far indexing has got in one row under the search box, and nothing more", async () => {
    mockCoverage.data = coverageOf({
      indexed: 15,
      missing: 5,
      pending: 5,
      coverage: 75,
    });

    renderComponent("/search");

    const region = await screen.findByRole("region", {
      name: "Semantic search coverage",
    });
    expect(within(region).getByText("Indexing 15 of 20…")).toBeTruthy();
    // The built-in model drains its own queue, so there is nothing to press.
    expect(within(region).queryByRole("button")).toBeNull();

    // Directly under the search box, above the suggested questions.
    const input = screen.getByLabelText("Ask anything about your network");
    const suggestions = await screen.findByRole("heading", {
      name: "Try asking",
    });
    expect(
      input.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      region.compareDocumentPosition(suggestions) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // No coverage card, no hero, no explanation and no description.
    expect(
      screen.queryByRole("heading", { name: "Semantic search coverage" }),
    ).toBeNull();
    expect(screen.queryByText("Ask anything")).toBeNull();
    expect(screen.queryByText(/Indexing turns contacts/)).toBeNull();
    expect(
      screen.queryByText("Ask a question about your network in plain words"),
    ).toBeNull();
  });

  it("offers Index missing when contacts wait and nothing runs, and queues them", async () => {
    mockCoverage.data = coverageOf({
      indexed: 12,
      missing: 8,
      coverage: 60,
    });

    renderComponent("/search");

    const region = await screen.findByRole("region", {
      name: "Semantic search coverage",
    });
    expect(within(region).getByText("12 of 20 contacts indexed")).toBeTruthy();
    fireEvent.click(
      within(region).getByRole("button", { name: "Index missing" }),
    );

    await waitFor(() => {
      expect(refreshes(sent)).toHaveLength(1);
      expect(refreshes(sent)[0].body).toEqual({ allowProvider: false });
    });
  });

  it("keeps a pressed Index missing on the row, with its focus, while the queue runs", async () => {
    mockCoverage.data = coverageOf({
      indexed: 12,
      missing: 8,
      coverage: 60,
    });

    const { refresh } = renderComponent("/search");

    const region = await screen.findByRole("region", {
      name: "Semantic search coverage",
    });
    const button = within(region).getByRole("button", {
      name: "Index missing",
    });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(refreshes(sent)).toHaveLength(1));

    // The refetch finds the queue running. A button that left the row, or
    // turned `disabled`, would drop the keyboard onto the body.
    mockCoverage.data = coverageOf({
      indexed: 12,
      missing: 8,
      pending: 8,
      coverage: 60,
      isIndexing: true,
    });
    refresh();

    expect(within(region).getByText("Indexing 12 of 20…")).toBeTruthy();
    const kept = within(region).getByRole("button", { name: "Index missing" });
    expect(kept).toBe(button);
    expect(kept.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(button);
    // A press while the queue runs sends nothing.
    fireEvent.click(kept);
    expect(refreshes(sent)).toHaveLength(1);

    // Indexing finishes: the row leaves, and the keyboard moves to the
    // search box instead of falling onto the body.
    mockCoverage.data = coverageOf({});
    refresh();
    expect(
      screen.queryByRole("region", { name: "Semantic search coverage" }),
    ).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByLabelText("Ask anything about your network"),
    );
  });

  it("asks before a paid provider embeds anything", async () => {
    mockCoverage.data = coverageOf({
      indexed: 12,
      missing: 8,
      pending: 8,
      coverage: 60,
      provider: {
        kind: "provider",
        providerId: "openai",
        model: "text-embedding-3-small",
        isPaid: true,
      },
    });

    renderComponent("/search");

    const region = await screen.findByRole("region", {
      name: "Semantic search coverage",
    });
    // A paid provider's queue waits for a person, so it is not running.
    expect(within(region).getByText("12 of 20 contacts indexed")).toBeTruthy();
    fireEvent.click(
      within(region).getByRole("button", { name: "Index missing" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Confirm provider embeddings refresh",
    });
    expect(
      within(dialog).getByRole("button", { name: "Confirm & refresh" }),
    ).toBeTruthy();
    expect(refreshes(sent)).toHaveLength(0);
  });

  it("counts the failures and reaches the failed tasks from the row", async () => {
    mockCoverage.data = coverageOf({
      indexed: 18,
      missing: 2,
      failed: 2,
      coverage: 90,
      failedItems: [
        {
          contactId: "contact-1",
          name: "Ada Lovelace",
          error: "Model timed out",
          attempts: 3,
          queuedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    });

    renderComponent("/search");

    const region = await screen.findByRole("region", {
      name: "Semantic search coverage",
    });
    expect(region.textContent).toContain(
      "18 of 20 contacts indexed · 2 failed",
    );
    // One endpoint queues the missing and the failed together: one action.
    expect(
      within(region).getByRole("button", { name: "Retry failed" }),
    ).toBeTruthy();
    expect(
      within(region).queryByRole("button", { name: "Index missing" }),
    ).toBeNull();

    fireEvent.click(
      within(region).getByRole("button", { name: "Inspect failed" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Failed search indexing tasks",
    });
    expect(within(dialog).getByText("Ada Lovelace")).toBeTruthy();
    expect(within(dialog).getByText("Model timed out")).toBeTruthy();
  });

  it("says the index is updating while changed contacts are embedded again", async () => {
    mockCoverage.data = coverageOf({ pending: 1, isIndexing: true });

    renderComponent("/search");

    const region = await screen.findByRole("region", {
      name: "Semantic search coverage",
    });
    expect(within(region).getByText("Updating the search index…")).toBeTruthy();
  });

  it("says nothing once every contact is indexed and nothing runs", async () => {
    mockCoverage.data = coverageOf({});

    renderComponent("/search");

    expect(
      await screen.findByRole("heading", { name: "Try asking" }),
    ).toBeTruthy();
    expect(row()).toBeNull();
  });

  it("does not show the row in notes mode", async () => {
    mockCoverage.data = coverageOf({
      indexed: 10,
      missing: 10,
      coverage: 50,
    });

    renderComponent("/search?mode=notes");

    expect(await screen.findByLabelText("Search your notes")).toBeTruthy();
    expect(row()).toBeNull();
  });
});
