// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
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
import { MapToolbar } from "../../../../src/views/map/MapToolbar";
import { StatsStrip } from "../../../../src/views/map/StatsStrip";
import { computeMapStats } from "../../../../src/views/map/mapStats";
import { useMapFilter } from "../../../../src/views/map/useMapFilter";
import type { MapContact } from "../../../../shared/geo";

vi.mock("../../../../src/api/geo", () => ({
  searchPlace: vi.fn(),
}));

import { searchPlace } from "../../../../src/api/geo";

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

/**
 * The toolbar over one filter, as the map page has it. With `results`, the
 * bottom line and the list of who is on the map come under it.
 */
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
  results = false,
}: {
  room?: number | null;
  contacts?: MapContact[];
  map?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  layer?: "pins" | "heat";
  onLayerChange?: (next: "pins" | "heat") => void;
  views?: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  onSelectView?: (view: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  onOpenSaveModal?: () => void;
  onStartLasso?: () => void;
  onSelectInView?: () => void;
  results?: boolean;
}) {
  const filter = useMapFilter(contacts);

  return (
    <>
      <MapToolbar
        map={map}
        rawInput={filter.rawInput}
        setRawInput={filter.setRawInput}
        tokenizer={filter.tokenizer}
        effectiveFilters={filter.effectiveFilters}
        totalCount={filter.totalCount}
        matchCount={filter.matchCount}
        hasActiveFilter={filter.hasActiveFilter}
        resolveNearFilters={filter.resolveNearFilters}
        clearFilters={filter.clearFilters}
        layer={layer}
        onLayerChange={onLayerChange}
        onFitAll={() => {}}
        views={views}
        onSelectView={onSelectView}
        onOpenSaveModal={onOpenSaveModal}
        onStartLasso={onStartLasso}
        onSelectInView={onSelectInView}
        room={room}
      />
      {results && (
        <>
          <StatsStrip
            stats={computeMapStats(filter.filteredContacts)}
            overdueOnly={filter.overdueOnly}
            onOverdueOnlyChange={filter.setOverdueOnly}
          />
          <ul aria-label="On the map">
            {filter.filteredContacts.map((contact) => (
              <li key={contact.id}>{contact.name}</li>
            ))}
          </ul>
        </>
      )}
    </>
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

/** The names on the map, in order, from the list `results` adds. */
const shown = () =>
  Array.from(
    screen.getByRole("list", { name: "On the map" }).querySelectorAll("li"),
  ).map((item) => item.textContent);

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
    renderWithProviders(<TestComponent results />, "/map?q=company:Babbage%20");

    await waitFor(() => {
      expect(shown()).toEqual(["Ada Lovelace"]);
    });
  });

  it("shows 0 of N match and allows clearing filters", async () => {
    renderWithProviders(
      <TestComponent results />,
      "/map?q=company:NonExistent%20",
    );

    await waitFor(() => {
      expect(screen.getByText("0 of 2 match")).toBeTruthy();
      expect(shown()).toEqual([]);
    });

    const clearButton = screen.getByRole("button", { name: "Clear filters" });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(shown()).toContain("Ada Lovelace");
      expect(shown()).toContain("Grace Hopper");
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

  it("switches between the two layers, pins and heat", () => {
    const handleLayerChange = vi.fn();

    renderWithProviders(
      <TestComponent layer="pins" onLayerChange={handleLayerChange} />,
    );

    const layers = screen.getByRole("radiogroup", { name: "Map layer" });
    expect(
      Array.from(layers.querySelectorAll('[role="radio"]')).map(
        (option) => option.textContent,
      ),
    ).toEqual(["Pins", "Heat"]);
    fireEvent.click(screen.getByRole("radio", { name: "Heat" }));
    expect(handleLayerChange).toHaveBeenCalledWith("heat");
  });

  it("renders ViewsMenu and allows selecting a saved view", () => {
    const mockViews = [
      {
        id: "view-1",
        name: "London Hub",
        query: "London",
        layer: "heat" as const,
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

/** A day `days` before today, as the date a follow-up is stored with. */
const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// No facet filters by follow-up, so overdue is a filter of its own, pressed
// on the bottom line, and Clear filters clears it with the query.
describe("the overdue filter", () => {
  const people: MapContact[] = [
    { ...mockContacts[0], nextFollowUpAt: daysAgo(2) },
    { ...mockContacts[1], nextFollowUpAt: null },
  ];

  afterEach(() => cleanup());

  it("narrows the map to the overdue, and lets everyone back", () => {
    renderWithProviders(<TestComponent contacts={people} results />);
    expect(shown()).toEqual(["Ada Lovelace", "Grace Hopper"]);

    fireEvent.click(screen.getByRole("button", { name: "1 overdue" }));
    expect(shown()).toEqual(["Ada Lovelace"]);
    expect(
      screen
        .getByRole("button", { name: "1 overdue" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "1 overdue" }));
    expect(shown()).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  it("clears with the query when nobody matches both", () => {
    renderWithProviders(<TestComponent contacts={people} results />);
    fireEvent.click(screen.getByRole("button", { name: "1 overdue" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Filter contacts" }), {
      target: { value: "Hopper" },
    });
    expect(shown()).toEqual([]);
    expect(screen.getByText("0 of 2 match")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(shown()).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(screen.queryByRole("button", { name: /overdue/ })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "1 overdue" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });
});
