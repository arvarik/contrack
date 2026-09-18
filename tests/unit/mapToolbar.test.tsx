// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MapToolbar } from "../../src/views/map/MapToolbar";
import { useMapFilter } from "../../src/views/map/useMapFilter";
import type { MapContact } from "../../shared/geo";

vi.mock("../../src/api/geo", () => ({
  searchPlace: vi.fn(),
}));

import { searchPlace } from "../../src/api/geo";

const mockContacts: MapContact[] = [
  {
    id: "contact-1",
    name: "Ada Lovelace",
    company: "Babbage & Co",
    role: "Analyst",
    location: "London, UK",
    lat: 51.5074,
    lng: -0.1278,
    relationshipScore: 85,
    tags: ["Computing"],
    lists: [{ id: "list-1", name: "Pioneers" }],
    avatarUrl: null,
    themeColor: "indigo",
    lastContactedAt: null,
    nextFollowUpAt: null,
    cadenceDays: 30,
    interactionCount: 5,
  },
  {
    id: "contact-2",
    name: "Grace Hopper",
    company: "US Navy",
    role: "Rear Admiral",
    location: "Arlington, VA",
    lat: 38.8799,
    lng: -77.1067,
    relationshipScore: 90,
    tags: ["Computing", "Military"],
    lists: [{ id: "list-2", name: "Leaders" }],
    avatarUrl: null,
    themeColor: "emerald",
    lastContactedAt: null,
    nextFollowUpAt: null,
    cadenceDays: 30,
    interactionCount: 12,
  },
];

function TestComponent({
  contacts = mockContacts,
  map = null,
}: {
  contacts?: MapContact[];
  map?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}) {
  const filter = useMapFilter(contacts);

  return (
    <MapToolbar
      contacts={contacts}
      map={map}
      rawInput={filter.rawInput}
      setRawInput={filter.setRawInput}
      tokenizer={filter.tokenizer}
      effectiveFilters={filter.effectiveFilters}
      filteredContacts={filter.filteredContacts}
      totalCount={filter.totalCount}
      matchCount={filter.matchCount}
      hasActiveFilter={filter.hasActiveFilter}
      resolveNearFilters={filter.resolveNearFilters}
      clearFilters={filter.clearFilters}
    />
  );
}

function renderWithProviders(ui: React.ReactElement, initialPath = "/map") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/map" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MapToolbar and useMapFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders filter input and Fit all button", () => {
    renderWithProviders(<TestComponent />);

    expect(
      screen.getByRole("textbox", { name: "Filter contacts" }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Fit all" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Go to place" })).toBeTruthy();
  });

  it("filters contacts by company facet token", async () => {
    function FilterTester() {
      const filter = useMapFilter(mockContacts);
      return (
        <div>
          <MapToolbar
            contacts={mockContacts}
            map={null}
            rawInput={filter.rawInput}
            setRawInput={filter.setRawInput}
            tokenizer={filter.tokenizer}
            effectiveFilters={filter.effectiveFilters}
            filteredContacts={filter.filteredContacts}
            totalCount={filter.totalCount}
            matchCount={filter.matchCount}
            hasActiveFilter={filter.hasActiveFilter}
            resolveNearFilters={filter.resolveNearFilters}
            clearFilters={filter.clearFilters}
          />
          <div data-testid="matches">
            {filter.filteredContacts.map((c) => c.name).join(", ")}
          </div>
        </div>
      );
    }

    renderWithProviders(<FilterTester />, "/map?q=company:Babbage%20");

    await waitFor(() => {
      expect(screen.getByTestId("matches").textContent).toBe("Ada Lovelace");
    });
  });

  it("shows 0 of N match and allows clearing filters", async () => {
    function FilterTester() {
      const filter = useMapFilter(mockContacts);
      return (
        <div>
          <MapToolbar
            contacts={mockContacts}
            map={null}
            rawInput={filter.rawInput}
            setRawInput={filter.setRawInput}
            tokenizer={filter.tokenizer}
            effectiveFilters={filter.effectiveFilters}
            filteredContacts={filter.filteredContacts}
            totalCount={filter.totalCount}
            matchCount={filter.matchCount}
            hasActiveFilter={filter.hasActiveFilter}
            resolveNearFilters={filter.resolveNearFilters}
            clearFilters={filter.clearFilters}
          />
          <div data-testid="matches">
            {filter.filteredContacts.map((c) => c.name).join(", ")}
          </div>
        </div>
      );
    }

    renderWithProviders(<FilterTester />, "/map?q=company:NonExistent%20");

    await waitFor(() => {
      expect(screen.getByText("0 of 2 match")).toBeTruthy();
      expect(screen.getByTestId("matches").textContent).toBe("");
    });

    const clearButton = screen.getByRole("button", { name: "Clear filters" });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(screen.getByTestId("matches").textContent).toContain(
        "Ada Lovelace",
      );
      expect(screen.getByTestId("matches").textContent).toContain(
        "Grace Hopper",
      );
    });
  });

  it("switches to Go to place search and flies map on submit", async () => {
    const mockMap = {
      getContainer: () => document.createElement("div"),
      getZoom: () => 3,
      getPadding: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
      flyTo: vi.fn(),
      jumpTo: vi.fn(),
      fitBounds: vi.fn(),
    };

    vi.mocked(searchPlace).mockResolvedValueOnce({
      query: "Paris",
      lat: 48.8566,
      lng: 2.3522,
      provider: "Nominatim",
      cached: false,
    });

    renderWithProviders(<TestComponent map={mockMap} />);

    // Click "Go to" button
    const gotoBtn = screen.getByRole("button", { name: "Go to place" });
    fireEvent.click(gotoBtn);

    const placeInput = screen.getByRole("textbox", { name: "Go to place" });
    expect(placeInput).toBeTruthy();

    fireEvent.change(placeInput, { target: { value: "Paris" } });
    fireEvent.keyDown(placeInput, { key: "Enter" });

    await waitFor(() => {
      expect(searchPlace).toHaveBeenCalledWith("Paris");
      expect(mockMap.flyTo).toHaveBeenCalledWith(
        expect.objectContaining({
          center: [2.3522, 48.8566],
          zoom: 10,
        }),
      );
    });
  });

  it("shows inline error when place search returns no result", async () => {
    const mockMap = {
      getContainer: () => document.createElement("div"),
      getZoom: () => 3,
      getPadding: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
      flyTo: vi.fn(),
      jumpTo: vi.fn(),
      fitBounds: vi.fn(),
    };

    vi.mocked(searchPlace).mockRejectedValueOnce(
      new Error("Nothing found for that place"),
    );

    renderWithProviders(<TestComponent map={mockMap} />);

    // Click "Go to" button
    fireEvent.click(screen.getByRole("button", { name: "Go to place" }));

    const placeInput = screen.getByRole("textbox", { name: "Go to place" });
    fireEvent.change(placeInput, { target: { value: "AtlantisNotFound" } });
    fireEvent.keyDown(placeInput, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Nothing found for that place",
      );
    });
  });
});
