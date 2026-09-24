// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useContactListFilters } from "../../src/views/contact-list/hooks/useContactListFilters";
import type { Contact } from "../../src/types";

let mockPreferences = {
  listSort: "name",
};

vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    preferences: mockPreferences,
    setPreference: vi.fn(),
  }),
}));

const mockSearchParams = new URLSearchParams();
const mockSetSearchParams = vi.fn();
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
}));

const sampleContacts: Partial<Contact>[] = [
  {
    id: "c1",
    name: "Charlie",
    relationshipScore: 80,
    addedAt: "2025-01-01T00:00:00.000Z",
  },
  {
    id: "c2",
    name: "Alice",
    relationshipScore: 95,
    addedAt: "2025-02-01T00:00:00.000Z",
  },
  {
    id: "c3",
    name: "Bob",
    relationshipScore: 40,
    addedAt: "2025-03-01T00:00:00.000Z",
  },
];

describe("useContactListFilters", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockSearchParams.delete("list");
    mockSearchParams.delete("tag");
    mockSetSearchParams.mockClear();
  });

  // A tag on the Tags settings page links to `/?tag=<tag>`. It is one more
  // filter mode: the whole tag, in any case, and any other chip replaces it.
  it("keeps the contacts with the tag a link names, the whole tag in any case", () => {
    mockPreferences = { listSort: "name" };
    mockSearchParams.set("tag", "close friend");
    const people = [
      { ...sampleContacts[0], tags: [{ id: "t1", tag: "Close Friend" }] },
      { ...sampleContacts[1], tags: [{ id: "t2", tag: "close friends" }] },
      { ...sampleContacts[2], tags: [] },
    ];
    const { result } = renderHook(() =>
      useContactListFilters(people as Contact[]),
    );

    expect(result.current.filterMode).toBe("tag:close friend");
    expect(result.current.filteredContacts.map((c) => c.name)).toEqual([
      "Charlie",
    ]);

    act(() => result.current.setFilterMode("all"));
    const update = mockSetSearchParams.mock.calls.at(-1)![0] as (
      prev: URLSearchParams,
    ) => Record<string, string>;
    expect(update(new URLSearchParams("tag=close+friend"))).toEqual({});
  });

  it("writes a tag filter to `?tag=`, and a list chip clears it", () => {
    mockPreferences = { listSort: "name" };
    const { result } = renderHook(() =>
      useContactListFilters(sampleContacts as Contact[]),
    );
    act(() => result.current.setFilterMode("tag:investor"));
    let update = mockSetSearchParams.mock.calls.at(-1)![0] as (
      prev: URLSearchParams,
    ) => Record<string, string>;
    expect(update(new URLSearchParams("q=ada"))).toEqual({
      tag: "investor",
      q: "ada",
    });
    act(() => result.current.setFilterMode("l1"));
    update = mockSetSearchParams.mock.calls.at(-1)![0] as typeof update;
    expect(update(new URLSearchParams("tag=investor"))).toEqual({ list: "l1" });
  });

  // The Tracked chip is `?list=tracked`. It is not a list: it keeps the
  // contacts a person tracks, whatever lists they are in.
  it("keeps only the tracked contacts under the Tracked chip", () => {
    mockPreferences = { listSort: "name" };
    mockSearchParams.set("list", "tracked");
    const people = [
      { ...sampleContacts[0], isTracked: true, lists: [] },
      { ...sampleContacts[1], isTracked: false, lists: [{ id: "l1" }] },
      { ...sampleContacts[2], isTracked: true, lists: [{ id: "l1" }] },
    ];
    const { result } = renderHook(() =>
      useContactListFilters(people as Contact[]),
    );

    expect(result.current.filterMode).toBe("tracked");
    expect(result.current.filteredContacts.map((c) => c.name)).toEqual([
      "Bob",
      "Charlie",
    ]);
  });

  // A link to the list carries a facet. The Inbox links to
  // `/?q=tracked:no` and `/?q=missing:company`, and the Composition legend
  // to `/?q=industry:Technology`. The list used to score the facet as a
  // name and match nobody.
  it("applies a facet from the query, and scores the free text that is left", () => {
    mockPreferences = { listSort: "name" };
    const people = [
      {
        ...sampleContacts[0],
        isTracked: true,
        company: "Acme",
        industry: "Technology",
      },
      {
        ...sampleContacts[1],
        isTracked: false,
        company: null,
        industry: "Technology",
      },
      {
        ...sampleContacts[2],
        isTracked: false,
        company: "Bobcorp",
        industry: "Farming",
      },
    ];
    const { result } = renderHook(() =>
      useContactListFilters(people as Contact[]),
    );
    const names = () => result.current.filteredContacts.map((c) => c.name);

    act(() => result.current.setSearchQuery("tracked:no"));
    expect(names()).toEqual(["Alice", "Bob"]);

    act(() => result.current.setSearchQuery("missing:company"));
    expect(names()).toEqual(["Alice"]);

    act(() => result.current.setSearchQuery("industry:Technology"));
    expect(names()).toEqual(["Alice", "Charlie"]);

    // The facet narrows, the words rank.
    act(() => result.current.setSearchQuery("tracked:no bob"));
    expect(names()).toEqual(["Bob"]);

    // A facet with a value the parser rejects is words, and matches nobody.
    act(() => result.current.setSearchQuery("score:abc"));
    expect(names()).toEqual([]);
  });

  it("initializes sortBy with 'name' when listSort preference is 'name'", () => {
    mockPreferences = { listSort: "name" };
    const { result } = renderHook(() =>
      useContactListFilters(sampleContacts as Contact[]),
    );

    expect(result.current.sortBy).toBe("name");
    expect(result.current.sortDir).toBe("asc");
    expect(result.current.filteredContacts.map((c) => c.name)).toEqual([
      "Alice",
      "Bob",
      "Charlie",
    ]);
  });

  it("initializes sortBy with 'date' when listSort preference is 'recent'", () => {
    mockPreferences = { listSort: "recent" };
    const { result } = renderHook(() =>
      useContactListFilters(sampleContacts as Contact[]),
    );

    expect(result.current.sortBy).toBe("date");
    expect(result.current.sortDir).toBe("desc");
    expect(result.current.filteredContacts.map((c) => c.name)).toEqual([
      "Bob",
      "Alice",
      "Charlie",
    ]);
  });

  // The menu sorts by name or by the day a contact was added, and nothing
  // else. A "score" left in storage by an older release is not one of them,
  // so the list falls back to the name order rather than to no order.
  it("falls back to the name order for a listSort it no longer knows", () => {
    mockPreferences = { listSort: "score" as unknown as "name" };
    const { result } = renderHook(() =>
      useContactListFilters(sampleContacts as Contact[]),
    );

    expect(result.current.sortBy).toBe("name");
    expect(result.current.sortDir).toBe("asc");
    expect(result.current.currentSort.label).toBe("A to Z");
    expect(result.current.filteredContacts.map((c) => c.name)).toEqual([
      "Alice",
      "Bob",
      "Charlie",
    ]);
  });

  it("updates sort choice in memory without writing preference", () => {
    mockPreferences = { listSort: "name" };
    const { result } = renderHook(() =>
      useContactListFilters(sampleContacts as Contact[]),
    );

    expect(result.current.sortBy).toBe("name");
    expect(result.current.sortDir).toBe("asc");
    expect(result.current.currentSort.label).toBe("A to Z");

    act(() => {
      result.current.setSortOption("name-desc");
    });
    expect(result.current.sortBy).toBe("name");
    expect(result.current.sortDir).toBe("desc");
    expect(result.current.currentSort.label).toBe("Z to A");
    expect(result.current.filteredContacts.map((c) => c.name)).toEqual([
      "Charlie",
      "Bob",
      "Alice",
    ]);

    act(() => {
      result.current.setSortOption("date-desc");
    });
    expect(result.current.sortBy).toBe("date");
    expect(result.current.sortDir).toBe("desc");
    expect(result.current.currentSort.label).toBe("Newest");
    expect(result.current.filteredContacts.map((c) => c.name)).toEqual([
      "Bob",
      "Alice",
      "Charlie",
    ]);

    act(() => {
      result.current.setSortOption("date-asc");
    });
    expect(result.current.sortBy).toBe("date");
    expect(result.current.sortDir).toBe("asc");
    expect(result.current.currentSort.label).toBe("Oldest");
    expect(result.current.filteredContacts.map((c) => c.name)).toEqual([
      "Charlie",
      "Alice",
      "Bob",
    ]);

    act(() => {
      result.current.setSortOption("name-asc");
    });
    expect(result.current.sortBy).toBe("name");
    expect(result.current.sortDir).toBe("asc");
    expect(result.current.currentSort.label).toBe("A to Z");
  });

  it("persists sort choice across hook remounts within the same session", () => {
    mockPreferences = { listSort: "name" };
    const { result, unmount } = renderHook(() =>
      useContactListFilters(sampleContacts as Contact[]),
    );

    act(() => {
      result.current.setSortOption("date-asc");
    });
    expect(result.current.currentSort.label).toBe("Oldest");

    unmount();

    // Re-mount hook (simulating navigating away to Pulse/Settings and back to Network)
    const { result: remounted } = renderHook(() =>
      useContactListFilters(sampleContacts as Contact[]),
    );

    expect(remounted.current.sortBy).toBe("date");
    expect(remounted.current.sortDir).toBe("asc");
    expect(remounted.current.currentSort.label).toBe("Oldest");
  });
});
