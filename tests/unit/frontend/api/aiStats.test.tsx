// @vitest-environment jsdom
// "Load older activity" appends the next page of the AI activity feed below
// the rows on screen. It does not replace them.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FEED_PAGE_SIZE, useAIStatsFeed } from "../../../../src/api/aiStats";

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * One client per file: `renderHook`'s wrapper is a component, so a
 * QueryClient built in its body is new on every render and drops the cache.
 * Retries are off so no test waits out a backoff.
 */
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

/** One row, identified by its page and position. */
function row(id: string) {
  return {
    id,
    operation: "briefing",
    model: "mock",
    tokenCount: 10,
    latencyMs: 5,
    cached: false,
    createdAt: "2026-09-11T00:00:00.000Z",
  };
}

/**
 * A server that answers with `total` rows, `FEED_PAGE_SIZE` at a time, and
 * returns the URLs it was asked for, so a test can check the offsets.
 */
function stubFeed(total: number) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const offset = Number(
        new URL(url, "http://x").searchParams.get("offset"),
      );
      const limit = Number(new URL(url, "http://x").searchParams.get("limit"));
      const items = Array.from(
        { length: Math.max(0, Math.min(limit, total - offset)) },
        (_, i) => row(`row-${offset + i}`),
      );
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items,
            pagination: {
              offset,
              limit,
              totalCount: total,
              hasMore: offset + items.length < total,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }),
  );
  return asked;
}

describe("useAIStatsFeed", () => {
  it("returns the first page on its own", async () => {
    stubFeed(FEED_PAGE_SIZE * 3);

    const { result } = renderHook(() => useAIStatsFeed(), { wrapper });

    await waitFor(() =>
      expect(result.current.items).toHaveLength(FEED_PAGE_SIZE),
    );
    expect(result.current.totalCount).toBe(FEED_PAGE_SIZE * 3);
    expect(result.current.hasNextPage).toBe(true);
  });

  it("adds the next page to the one on screen instead of replacing it", async () => {
    stubFeed(FEED_PAGE_SIZE * 3);
    const { result } = renderHook(() => useAIStatsFeed(), { wrapper });
    await waitFor(() =>
      expect(result.current.items).toHaveLength(FEED_PAGE_SIZE),
    );

    await result.current.fetchNextPage();

    // The whole story in two assertions: twice as many rows, and the first
    // row is still the first row.
    await waitFor(() =>
      expect(result.current.items).toHaveLength(FEED_PAGE_SIZE * 2),
    );
    expect(result.current.items[0].id).toBe("row-0");
    expect(result.current.items[FEED_PAGE_SIZE].id).toBe(
      `row-${FEED_PAGE_SIZE}`,
    );
  });

  it("keeps every page as it goes, in order", async () => {
    stubFeed(FEED_PAGE_SIZE * 3);
    const { result } = renderHook(() => useAIStatsFeed(), { wrapper });
    await waitFor(() =>
      expect(result.current.items).toHaveLength(FEED_PAGE_SIZE),
    );

    await result.current.fetchNextPage();
    await waitFor(() =>
      expect(result.current.items).toHaveLength(FEED_PAGE_SIZE * 2),
    );
    await result.current.fetchNextPage();

    await waitFor(() =>
      expect(result.current.items).toHaveLength(FEED_PAGE_SIZE * 3),
    );
    const ids = result.current.items.map((item) => item.id);
    expect(ids).toEqual(ids.slice().sort((a, b) => idNumber(a) - idNumber(b)));
    expect(result.current.hasNextPage).toBe(false);
  });

  it("asks for each page once, at the offset after the last one", async () => {
    const asked = stubFeed(FEED_PAGE_SIZE * 3);
    const { result } = renderHook(() => useAIStatsFeed(), { wrapper });
    await waitFor(() =>
      expect(result.current.items).toHaveLength(FEED_PAGE_SIZE),
    );

    await result.current.fetchNextPage();
    await waitFor(() =>
      expect(result.current.items).toHaveLength(FEED_PAGE_SIZE * 2),
    );

    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain("offset=0");
    expect(asked[1]).toContain(`offset=${FEED_PAGE_SIZE}`);
  });

  it("stops offering more when the last page is short", async () => {
    // A feed whose total is not a multiple of the page size. `hasMore` has to
    // come from the server's own answer rather than from a full page.
    stubFeed(FEED_PAGE_SIZE + 3);
    const { result } = renderHook(() => useAIStatsFeed(), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    await result.current.fetchNextPage();

    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(result.current.items).toHaveLength(FEED_PAGE_SIZE + 3);
  });

  it("starts again when a filter changes", async () => {
    const asked = stubFeed(FEED_PAGE_SIZE * 3);
    const { result, rerender } = renderHook(
      (props: { cached?: "true" | "false" }) => useAIStatsFeed(props),
      { wrapper, initialProps: {} },
    );
    await waitFor(() =>
      expect(result.current.items).toHaveLength(FEED_PAGE_SIZE),
    );
    await result.current.fetchNextPage();
    await waitFor(() =>
      expect(result.current.items).toHaveLength(FEED_PAGE_SIZE * 2),
    );

    rerender({ cached: "true" });

    // A different filter is a different query, so the accumulated pages are
    // not carried into it, and the view has no offset of its own to reset.
    await waitFor(() =>
      expect(result.current.items).toHaveLength(FEED_PAGE_SIZE),
    );
    expect(asked[asked.length - 1]).toContain("cached=true");
    expect(asked[asked.length - 1]).toContain("offset=0");
  });

  it("carries the scope into the request", async () => {
    const asked = stubFeed(FEED_PAGE_SIZE);

    const { result } = renderHook(() => useAIStatsFeed({ scope: "all" }), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.items).toHaveLength(FEED_PAGE_SIZE),
    );
    expect(asked[0]).toContain("scope=all");
  });

  it("reports an empty feed as empty rather than as loading for ever", async () => {
    stubFeed(0);

    const { result } = renderHook(() => useAIStatsFeed(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.hasNextPage).toBe(false);
  });
});

/** `row-12` → 12. Used to assert the pages arrived in order. */
function idNumber(id: string): number {
  return Number(id.replace("row-", ""));
}
