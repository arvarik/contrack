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

  it("initializes sortBy with 'score' when listSort preference is 'score'", () => {
    mockPreferences = { listSort: "score" };
    const { result } = renderHook(() =>
      useContactListFilters(sampleContacts as Contact[]),
    );

    expect(result.current.sortBy).toBe("score");
    expect(result.current.sortDir).toBe("desc");
    expect(result.current.filteredContacts.map((c) => c.name)).toEqual([
      "Alice",
      "Charlie",
      "Bob",
    ]);
  });

  it("updates sort choice in memory without writing preference", () => {
    mockPreferences = { listSort: "name" };
    const { result } = renderHook(() =>
      useContactListFilters(sampleContacts as Contact[]),
    );

    expect(result.current.sortBy).toBe("name");
    expect(result.current.sortDir).toBe("asc");
    expect(result.current.currentSort.label).toBe("Name A to Z");

    act(() => {
      result.current.setSortOption("name-desc");
    });
    expect(result.current.sortBy).toBe("name");
    expect(result.current.sortDir).toBe("desc");
    expect(result.current.currentSort.label).toBe("Name Z to A");
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
    expect(result.current.currentSort.label).toBe("Newest first");
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
    expect(result.current.currentSort.label).toBe("Oldest first");
    expect(result.current.filteredContacts.map((c) => c.name)).toEqual([
      "Charlie",
      "Alice",
      "Bob",
    ]);

    act(() => {
      result.current.setSortOption("score-desc");
    });
    expect(result.current.sortBy).toBe("score");
    expect(result.current.sortDir).toBe("desc");
    expect(result.current.currentSort.label).toBe("Score");
    expect(result.current.filteredContacts.map((c) => c.name)).toEqual([
      "Alice",
      "Charlie",
      "Bob",
    ]);

    act(() => {
      result.current.setSortOption("name-asc");
    });
    expect(result.current.sortBy).toBe("name");
    expect(result.current.sortDir).toBe("asc");
    expect(result.current.currentSort.label).toBe("Name A to Z");

    act(() => {
      result.current.setSort("score");
    });
    expect(result.current.sortBy).toBe("score");
    expect(result.current.sortDir).toBe("desc");

    act(() => {
      result.current.setSort("name", "desc");
    });
    expect(result.current.sortBy).toBe("name");
    expect(result.current.sortDir).toBe("desc");
  });

  it("persists sort choice across hook remounts within the same session", () => {
    mockPreferences = { listSort: "name" };
    const { result, unmount } = renderHook(() =>
      useContactListFilters(sampleContacts as Contact[]),
    );

    act(() => {
      result.current.setSortOption("score-desc");
    });
    expect(result.current.currentSort.label).toBe("Score");

    unmount();

    // Re-mount hook (simulating navigating away to Pulse/Settings and back to Network)
    const { result: remounted } = renderHook(() =>
      useContactListFilters(sampleContacts as Contact[]),
    );

    expect(remounted.current.sortBy).toBe("score");
    expect(remounted.current.sortDir).toBe("desc");
    expect(remounted.current.currentSort.label).toBe("Score");
  });
});
