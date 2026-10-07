// @vitest-environment jsdom
// The Enrichment list with thousands of contacts draws only the rows in view
// of its own box, while the count, the filters, Select all and the batch
// still cover every contact. tests/e2e/long-lists.spec.ts covers the real
// virtualizer. This file checks that a filter reads every contact. jsdom has
// no layout, so the virtualizer asks for the first ten rows.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Contact } from "../../../../src/types";

vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: (options: { count: number; enabled?: boolean }) => {
      const count = options.enabled ? options.count : 0;
      return {
        getTotalSize: () => count * 68,
        getVirtualItems: () =>
          Array.from({ length: Math.min(count, 10) }, (_, index) => ({
            index,
            key: index,
            start: index * 68,
            size: 68,
            end: (index + 1) * 68,
          })),
        measureElement: () => undefined,
      };
    },
  };
});

// The box that scrolls the rows, which jsdom cannot find from the classes.
vi.mock("../../../../src/lib/scrollParent", () => ({
  scrollParent: (element: HTMLElement) => element.parentElement,
}));

const aiSearch = vi.hoisted(() => ({
  startSearch: vi.fn(),
  isStarting: false,
  batch: null,
  limitMessage: null,
  clearLimit: vi.fn(),
  depthFiguresApply: false,
}));
vi.mock("../../../../src/contexts/AISearchContext", () => ({
  useAISearch: () => aiSearch,
  useOptionalAISearch: () => aiSearch,
}));

const contacts = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../../../../src/api", () => ({
  useContacts: () => ({ data: contacts.list, isLoading: false }),
}));

import { AISearchView } from "../../../../src/views/ai-search/AISearchView";

const people = (count: number): Contact[] =>
  Array.from(
    { length: count },
    (_, i) =>
      ({
        id: `p${i}`,
        name: `Person ${i}`,
        company: null,
        role: null,
        avatarUrl: null,
        isGhost: false,
        isArchived: false,
        isTracked: i < 20,
        emails: [],
        socialLinks: [],
        aiHydratedAt: null,
      }) as unknown as Contact,
  );

afterEach(() => {
  cleanup();
  aiSearch.startSearch.mockClear();
});

describe("the Enrichment list, long", () => {
  it("filters the whole list, not only the rows drawn", () => {
    contacts.list = people(450);
    render(
      <MemoryRouter>
        <AISearchView />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Tracked/ }));
    expect(screen.getByText(/^20 contacts$/)).toBeTruthy();
    // A short list is drawn whole.
    expect(screen.getAllByRole("link", { name: /^Open Person/ })).toHaveLength(
      20,
    );
  });
});
