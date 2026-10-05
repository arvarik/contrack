// @vitest-environment jsdom
// The palette's rules that no browser test pins down: the mode, the page
// match, where an insight leads, and how recent searches read and record.
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  aiResultsHeading,
  getMode,
  insightPath,
} from "../../../../src/components/command-palette/utils";
import { matchesDestination } from "../../../../src/components/command-palette/ZeroStateView";
import { useSearchHistory } from "../../../../src/hooks/useSearchHistory";
import type { HistoryEntry } from "../../../../shared/searchHistory";

describe("the palette's rules", () => {
  it("reads the mode from the first character typed", () => {
    expect(["jane", "  ?who", " >note", "what?"].map(getMode)).toEqual([
      "normal",
      "ai",
      "action",
      "normal",
    ]);
  });

  it("says how many a cut AI list holds", () => {
    expect(aiResultsHeading(false, 30, 1501)).toBe("AI answer · 30 of 1,501");
    expect(aiResultsHeading(true, 3, 3)).toBe("Not verified by AI");
    // Without AI set up, rules answered: no "AI" in the heading.
    expect(aiResultsHeading(false, 3, 3, false)).toBe("Answer");
  });

  it("matches a page by the start of each word, with enough letters", () => {
    expect(matchesDestination("PUL", "Pulse")).toBe(true);
    expect(matchesDestination("backup", "Settings Export", ["backup"])).toBe(
      true,
    );
    expect(matchesDestination("port", "Settings Export")).toBe(false);
    expect(matchesDestination("p", "Pulse")).toBe(false);
    expect(matchesDestination("ex", "Settings Export", [], 3)).toBe(false);
  });

  it("sends an insight to the page that counts it, or the contact it names", () => {
    const contact = { id: "c-9", name: "Ada", avatarUrl: null };
    expect(insightPath({ type: "action_items", label: "", count: 2 })).toBe(
      "/pulse",
    );
    expect(insightPath({ type: "dedupe", label: "", count: 1 })).toBe(
      "/pulse/duplicates",
    );
    expect(insightPath({ type: "ghost", label: "", contact })).toBe(
      "/contact/c-9",
    );
    expect(insightPath({ type: "ghost", label: "" })).toBeNull();
  });
});

describe("useSearchHistory", () => {
  const entry = (mode: HistoryEntry["mode"], query: string): HistoryEntry => ({
    id: query,
    ownerId: "o",
    mode,
    query,
    normalizedQuery: query,
    resultCount: 0,
    resultIds: [],
    fallback: false,
    pinned: false,
    runCount: 1,
    createdAt: "2026-09-17T12:00:00Z",
    lastRunAt: "2026-09-17T12:00:00Z",
  });
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  const posted: unknown[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    posted.length = 0;
  });

  const renderHistory = () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.method !== "POST") {
          const entries = [
            entry("people", "who knows rust"),
            entry("notes", "q3 sync"),
            entry("palette", "jane"),
          ];
          return json({ entries, nextCursor: null, total: 3 });
        }
        posted.push(JSON.parse(String(init.body)));
        return json({ entry: entry("palette", "x") });
      }),
    );
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return renderHook(() => useSearchHistory(), {
      wrapper: ({ children }) =>
        React.createElement(QueryClientProvider, { client }, children),
    });
  };

  it("shows a people question with its ?, and a notes search as it is", async () => {
    const { result } = renderHistory();
    await waitFor(() => expect(result.current.entries).toHaveLength(3));
    expect(result.current.entries.map((e) => [e.mode, e.query])).toEqual([
      ["ai", "? who knows rust"],
      ["notes", "q3 sync"],
      ["normal", "jane"],
    ]);
  });

  it("records a ? question as a people search, without its ?", async () => {
    const { result } = renderHistory();
    act(() => {
      result.current.addEntry("? who writes go", "ai");
      result.current.addEntry("tag:vc jane", "normal");
    });
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted).toEqual([
      { query: "who writes go", mode: "people" },
      { query: "tag:vc jane", mode: "palette" },
    ]);
  });
});
