// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
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

  it("cycles through sort modes in memory without writing preference", () => {
    mockPreferences = { listSort: "name" };
    const { result } = renderHook(() =>
      useContactListFilters(sampleContacts as Contact[]),
    );

    expect(result.current.sortBy).toBe("name");
    expect(result.current.sortDir).toBe("asc");

    act(() => {
      result.current.cycleSortMode();
    });
    expect(result.current.sortBy).toBe("name");
    expect(result.current.sortDir).toBe("desc");

    act(() => {
      result.current.cycleSortMode();
    });
    expect(result.current.sortBy).toBe("date");
    expect(result.current.sortDir).toBe("desc");

    act(() => {
      result.current.cycleSortMode();
    });
    expect(result.current.sortBy).toBe("date");
    expect(result.current.sortDir).toBe("asc");

    act(() => {
      result.current.cycleSortMode();
    });
    expect(result.current.sortBy).toBe("score");
    expect(result.current.sortDir).toBe("desc");

    act(() => {
      result.current.cycleSortMode();
    });
    expect(result.current.sortBy).toBe("score");
    expect(result.current.sortDir).toBe("asc");

    act(() => {
      result.current.cycleSortMode();
    });
    expect(result.current.sortBy).toBe("name");
    expect(result.current.sortDir).toBe("asc");
  });
});
