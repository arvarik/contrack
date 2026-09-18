// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  getMode,
  stripModePrefix,
} from "../../src/components/command-palette/utils";
import { useSearchHistory } from "../../src/hooks/useSearchHistory";
import { resetLastRecorded } from "../../src/api/searchHistory";
import type { HistoryEntry } from "../../shared/searchHistory";

describe("getMode", () => {
  it("returns 'normal' for plain search text", () => {
    expect(getMode("jane doe")).toBe("normal");
    expect(getMode("")).toBe("normal");
  });

  it("returns 'ai' when the query starts with ?", () => {
    expect(getMode("?who do I know in London")).toBe("ai");
  });

  it("returns 'action' when the query starts with >", () => {
    expect(getMode(">archive")).toBe("action");
  });

  it("ignores leading whitespace before the prefix", () => {
    expect(getMode("   ?query")).toBe("ai");
    expect(getMode("   >action")).toBe("action");
    expect(getMode("   plain")).toBe("normal");
  });

  it("treats a prefix character mid-string as normal", () => {
    expect(getMode("what?")).toBe("normal");
    expect(getMode("a > b")).toBe("normal");
  });
});

describe("stripModePrefix", () => {
  it("strips the ? prefix", () => {
    expect(stripModePrefix("? who is jane")).toBe("who is jane");
  });

  it("strips the > prefix", () => {
    expect(stripModePrefix(">archive contact")).toBe("archive contact");
  });

  it("leaves plain queries untouched (trimmed)", () => {
    expect(stripModePrefix("  jane doe  ")).toBe("jane doe");
  });
});

describe("useSearchHistory", () => {
  let queryClient: QueryClient;
  const postedBodies: Record<string, unknown>[] = [];
  const deletedUrls: string[] = [];

  const mockEntries: HistoryEntry[] = [
    {
      id: "1",
      ownerId: "owner-1",
      mode: "people",
      query: "who knows quantum",
      normalizedQuery: "who knows quantum",
      resultCount: 5,
      resultIds: [],
      fallback: false,
      pinned: false,
      runCount: 1,
      createdAt: "2026-09-17T12:00:00.000Z",
      lastRunAt: "2026-09-17T12:00:00.000Z",
    },
    {
      id: "2",
      ownerId: "owner-1",
      mode: "palette",
      query: "jane doe",
      normalizedQuery: "jane doe",
      resultCount: 1,
      resultIds: [],
      fallback: false,
      pinned: false,
      runCount: 2,
      createdAt: "2026-09-17T11:00:00.000Z",
      lastRunAt: "2026-09-17T11:00:00.000Z",
    },
  ];

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    postedBodies.length = 0;
    deletedUrls.length = 0;
    resetLastRecorded();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = String(url);
        const method = init?.method ?? "GET";

        if (urlStr.includes("/search/history") && method === "GET") {
          return new Response(
            JSON.stringify({
              entries: mockEntries,
              nextCursor: null,
              total: mockEntries.length,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        if (urlStr.includes("/search/history") && method === "POST") {
          const body = init?.body ? JSON.parse(String(init.body)) : {};
          postedBodies.push(body);
          return new Response(
            JSON.stringify({
              entry: {
                id: "3",
                ownerId: "owner-1",
                mode: body.mode,
                query: body.query,
                normalizedQuery: body.query.toLowerCase(),
                resultCount: null,
                resultIds: [],
                fallback: false,
                pinned: false,
                runCount: 1,
                createdAt: new Date().toISOString(),
                lastRunAt: new Date().toISOString(),
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        if (urlStr.includes("/search/history") && method === "DELETE") {
          deletedUrls.push(urlStr);
          return new Response(JSON.stringify({ deleted: 2 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        return new Response("{}", { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  it("reads top entries from the API into recentDisplay and entries", async () => {
    const { result } = renderHook(() => useSearchHistory(), { wrapper });

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });

    // People entry is formatted with ? prefix and ai mode for command palette
    expect(result.current.entries[0]).toMatchObject({
      query: "? who knows quantum",
      mode: "ai",
    });
    // Palette entry is normal mode
    expect(result.current.entries[1]).toMatchObject({
      query: "jane doe",
      mode: "normal",
    });

    expect(result.current.recentDisplay).toHaveLength(2);
  });

  it("addEntry calls useRecordSearch with prefix stripped for AI queries", async () => {
    const { result } = renderHook(() => useSearchHistory(), { wrapper });

    act(() => {
      result.current.addEntry("? who writes rust", "ai");
    });

    await waitFor(() => {
      expect(postedBodies).toHaveLength(1);
    });
    expect(postedBodies[0]).toEqual({
      query: "who writes rust",
      mode: "people",
    });
  });

  it("addEntry calls useRecordSearch with palette mode for normal and action queries", async () => {
    const { result } = renderHook(() => useSearchHistory(), { wrapper });

    act(() => {
      result.current.addEntry("bob smith", "normal");
    });

    await waitFor(() => {
      expect(postedBodies).toHaveLength(1);
    });
    expect(postedBodies[0]).toEqual({
      query: "bob smith",
      mode: "palette",
    });

    act(() => {
      result.current.addEntry(">archive contact", "action");
    });

    await waitFor(() => {
      expect(postedBodies).toHaveLength(2);
    });
    expect(postedBodies[1]).toEqual({
      query: ">archive contact",
      mode: "palette",
    });
  });

  it("navigateHistory steps through history and restores stashed input", async () => {
    const { result } = renderHook(() => useSearchHistory(), { wrapper });

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });

    let navResult: string | null = null;
    act(() => {
      navResult = result.current.navigateHistory("up", "typed query");
    });
    expect(navResult).toBe("? who knows quantum");
    expect(result.current.historyIndex).toBe(0);

    act(() => {
      navResult = result.current.navigateHistory("up", "typed query");
    });
    expect(navResult).toBe("jane doe");
    expect(result.current.historyIndex).toBe(1);

    act(() => {
      navResult = result.current.navigateHistory("up", "typed query");
    });
    expect(navResult).toBeNull();

    act(() => {
      navResult = result.current.navigateHistory("down", "typed query");
    });
    expect(navResult).toBe("? who knows quantum");
    expect(result.current.historyIndex).toBe(0);

    act(() => {
      navResult = result.current.navigateHistory("down", "typed query");
    });
    expect(navResult).toBe("typed query");
    expect(result.current.historyIndex).toBe(-1);

    act(() => {
      navResult = result.current.navigateHistory("down", "typed query");
    });
    expect(navResult).toBeNull();
  });

  it("resetNavigation clears index and stashed input", async () => {
    const { result } = renderHook(() => useSearchHistory(), { wrapper });

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });

    act(() => {
      result.current.navigateHistory("up", "typed query");
    });
    expect(result.current.historyIndex).toBe(0);

    act(() => {
      result.current.resetNavigation();
    });
    expect(result.current.historyIndex).toBe(-1);
  });

  it("clearHistory calls clear mutation and resets navigation index", async () => {
    const { result } = renderHook(() => useSearchHistory(), { wrapper });

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });

    act(() => {
      result.current.navigateHistory("up", "typed query");
    });
    expect(result.current.historyIndex).toBe(0);

    act(() => {
      result.current.clearHistory();
    });

    await waitFor(() => {
      expect(deletedUrls.length).toBeGreaterThanOrEqual(1);
    });
    expect(result.current.historyIndex).toBe(-1);
  });

  it("getLastQuery returns last query within 30 seconds and null after expiry", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSearchHistory(), { wrapper });

    act(() => {
      result.current.addEntry("? recent question", "ai");
    });

    expect(result.current.getLastQuery()).toEqual({
      query: "? recent question",
      mode: "ai",
    });

    act(() => {
      vi.advanceTimersByTime(31_000);
    });

    expect(result.current.getLastQuery()).toBeNull();
  });

  it("handles note mode entries without adding ? prefix", async () => {
    const noteEntry: HistoryEntry = {
      id: "3",
      ownerId: "owner-1",
      mode: "notes",
      query: "meeting with Alice",
      normalizedQuery: "meeting with alice",
      resultCount: 2,
      resultIds: [],
      fallback: false,
      pinned: false,
      runCount: 1,
      createdAt: "2026-09-17T13:00:00.000Z",
      lastRunAt: "2026-09-17T13:00:00.000Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            entries: [noteEntry],
            nextCursor: null,
            total: 1,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }),
    );

    const { result } = renderHook(() => useSearchHistory(), { wrapper });

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });

    expect(result.current.entries[0]).toMatchObject({
      id: "3",
      query: "meeting with Alice",
      mode: "notes",
    });
  });
});

describe("ZeroStateView", () => {
  it("renders history entries with mode icons and propagates mode to onSelectHistory", async () => {
    const { render, screen, fireEvent } =
      await import("@testing-library/react");
    const { Command } = await import("cmdk");
    const { ZeroStateView } =
      await import("../../src/components/command-palette/ZeroStateView");

    const onSelectHistory = vi.fn();
    const historyEntries = [
      {
        id: "1",
        query: "? quantum computing",
        mode: "ai" as const,
        timestamp: Date.now(),
      },
      {
        id: "2",
        query: "quarterly sync",
        mode: "notes" as const,
        timestamp: Date.now() - 1000,
      },
    ];

    render(
      React.createElement(
        Command,
        null,
        React.createElement(ZeroStateView, {
          recentContacts: [],
          historyEntries,
          insights: [],
          onSelectContact: vi.fn(),
          onSelectHistory,
          onSelectInsight: vi.fn(),
          onNavigate: vi.fn(),
        }),
      ),
    );

    // Strips ? prefix in display
    expect(screen.getByText("quantum computing")).toBeDefined();
    expect(screen.getByText("quarterly sync")).toBeDefined();

    // Selecting the notes entry passes "quarterly sync" and "notes"
    fireEvent.click(screen.getByText("quarterly sync"));
    expect(onSelectHistory).toHaveBeenCalledWith("quarterly sync", "notes");
  });
});
