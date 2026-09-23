// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
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
    isTracked: true,
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
    isTracked: true,
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
  layer = "pins",
  onLayerChange = () => {},
  views,
  onSelectView,
  onOpenSaveModal,
  onStartLasso,
  onSelectInView,
  room,
}: {
  room?: number | null;
  contacts?: MapContact[];
  map?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  layer?: "pins" | "heat" | "health";
  onLayerChange?: (next: "pins" | "heat" | "health") => void;
  views?: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  onSelectView?: (view: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  onOpenSaveModal?: () => void;
  onStartLasso?: () => void;
  onSelectInView?: () => void;
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
      layer={layer}
      onLayerChange={onLayerChange}
      views={views}
      onSelectView={onSelectView}
      onOpenSaveModal={onOpenSaveModal}
      onStartLasso={onStartLasso}
      onSelectInView={onSelectInView}
      room={room}
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

  // An open contact covered the end of the toolbar at 1440 px, and left a
  // strip of 100 px at 1024 px with the toolbar cut off in it.
  it("keeps inside the map an open contact leaves, 16 px clear of it", () => {
    renderWithProviders(<TestComponent room={516} />);
    const card = screen
      .getByRole("textbox", { name: "Filter contacts" })
      .closest(".glass-panel") as HTMLElement;
    expect(card.style.maxWidth).toBe("484px");
    cleanup();
    renderWithProviders(<TestComponent room={1200} />);
    expect(
      (
        screen
          .getByRole("textbox", { name: "Filter contacts" })
          .closest(".glass-panel") as HTMLElement
      ).style.maxWidth,
    ).toBe("520px");
  });

  it("steps aside when the open contact leaves only a sliver", () => {
    renderWithProviders(<TestComponent room={100} />);
    expect(
      screen.queryByRole("textbox", { name: "Filter contacts" }),
    ).toBeNull();
    expect(screen.queryAllByRole("button", { name: "Fit all" })).toHaveLength(
      0,
    );
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
            layer="pins"
            onLayerChange={() => {}}
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
            layer="pins"
            onLayerChange={() => {}}
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

  describe("client-side validateBounds", () => {
    it("accepts valid bounds within [-180, 180] and [-90, 90] with south < north", async () => {
      const { validateBounds } = await import("../../src/api/mapViews");
      expect(() => validateBounds([-180, -90, 180, 90])).not.toThrow();
      expect(() => validateBounds([-0.2, 51.4, 0.0, 51.6])).not.toThrow();
      expect(() => validateBounds([0, 0, 10, 10])).not.toThrow();
    });

    it("rejects invalid bounds coordinates and order", async () => {
      const { validateBounds } = await import("../../src/api/mapViews");
      expect(() => validateBounds(null)).toThrow(/array of 4 coordinates/);
      expect(() => validateBounds([1, 2, 3])).toThrow(/array of 4 coordinates/);
      expect(() => validateBounds(["-180", -90, 180, 90])).toThrow(
        /finite numbers/,
      );
      expect(() => validateBounds([-185, 0, 10, 10])).toThrow(/West longitude/);
      expect(() => validateBounds([0, 0, 185, 10])).toThrow(/East longitude/);
      expect(() => validateBounds([0, -95, 10, 10])).toThrow(/South latitude/);
      expect(() => validateBounds([0, 0, 10, 95])).toThrow(/North latitude/);
      expect(() => validateBounds([0, 50, 10, 40])).toThrow(
        /South latitude must be less than north latitude/,
      );
    });
  });

  it("switches map layers via the segmented control", () => {
    const handleLayerChange = vi.fn();

    renderWithProviders(
      <TestComponent layer="pins" onLayerChange={handleLayerChange} />,
    );

    const healthOption = screen.getByRole("radio", { name: "Health" });
    expect(healthOption).toBeTruthy();
    fireEvent.click(healthOption);
    expect(handleLayerChange).toHaveBeenCalledWith("health");
  });

  it("renders ViewsMenu and allows selecting a saved view", () => {
    const mockViews = [
      {
        id: "view-1",
        name: "London Hub",
        query: "London",
        layer: "health" as const,
        bounds: [-0.5, 51.3, 0.2, 51.7] as [number, number, number, number],
        sortOrder: 0,
        createdAt: "2026-09-19T00:00:00.000Z",
        updatedAt: "2026-09-19T00:00:00.000Z",
      },
    ];
    const handleSelectView = vi.fn();

    renderWithProviders(
      <TestComponent
        views={mockViews}
        onSelectView={handleSelectView}
        onOpenSaveModal={() => {}}
      />,
    );

    const viewsButton = screen.getByRole("button", { name: "Saved views" });
    fireEvent.click(viewsButton);

    const londonItem = screen.getByRole("menuitem", { name: "London Hub" });
    expect(londonItem).toBeTruthy();
    fireEvent.click(londonItem);
    expect(handleSelectView).toHaveBeenCalledWith(mockViews[0]);
  });

  // The Select menu is an `ActionMenu`: a menu button that opens a named
  // menu, and choosing an item closes it before the item runs.
  it("opens the Select menu and runs lasso and all-in-view from its items", () => {
    const handleLasso = vi.fn();
    const handleInView = vi.fn();

    renderWithProviders(
      <TestComponent
        onStartLasso={handleLasso}
        onSelectInView={handleInView}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Select contacts" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "Select contacts" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Box select" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Lasso select" }));
    expect(handleLasso).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "All in view" }));
    expect(handleInView).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
