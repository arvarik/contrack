// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
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
  GEO_STATUS_KEY: ["geo", "status"],
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { info: vi.fn() }) }));

import { toast } from "sonner";
import { searchPlace } from "../../../../src/api/geo";
import { NetworkError } from "../../../../src/api/client";

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
 * The toolbar over one filter, as the map page has it, with the bottom line
 * and the list of who is on the map under it.
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
}) {
  const filter = useMapFilter(contacts);
  return (
    <>
      <MapToolbar
        map={map}
        filter={filter}
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

/** The names on the map, in order. */
const shown = () =>
  Array.from(
    screen.getByRole("list", { name: "On the map" }).querySelectorAll("li"),
  ).map((item) => item.textContent);

const input = () => screen.getByRole("textbox", { name: "Filter contacts" });

/** A day `days` before today, as the date a follow-up is stored with. */
const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** A map that records where it was sent. */
const fakeMap = () => ({
  getContainer: () => document.createElement("div"),
  flyTo: vi.fn(),
  jumpTo: vi.fn(),
});

describe("MapToolbar and useMapFilter", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  // An open contact covered the end of the toolbar at 1440 px, and left a
  // strip of 100 px at 1024 px with the toolbar cut off in it.
  it("keeps inside the map an open contact leaves, and steps aside for a sliver", () => {
    renderWithProviders(<TestComponent room={516} />);
    expect(
      (input().closest(".glass-panel") as HTMLElement).style.maxWidth,
    ).toBe("484px");
    cleanup();
    renderWithProviders(<TestComponent room={100} />);
    expect(
      screen.queryByRole("textbox", { name: "Filter contacts" }),
    ).toBeNull();
  });

  it("narrows to the overdue, and offers Clear all while any filter is on, which clears them all", () => {
    const people = [
      { ...mockContacts[0], nextFollowUpAt: daysAgo(2) },
      mockContacts[1],
    ];
    renderWithProviders(<TestComponent contacts={people} />);
    const clearAll = () =>
      screen.queryByRole("button", { name: "Clear all filters" });
    expect(clearAll()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1 overdue" }));
    expect(shown()).toEqual(["Ada Lovelace"]);
    expect(clearAll()).toBeTruthy();
    fireEvent.change(input(), {
      target: { value: "company:Babbage tag:Military " },
    });
    expect(shown()).toEqual([]);
    expect(screen.getByText("0 of 2 match")).toBeTruthy();

    fireEvent.click(clearAll()!);
    expect(input()).toHaveProperty("value", "");
    expect(shown()).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(
      screen
        .getByRole("button", { name: "1 overdue" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(clearAll()).toBeNull();

    fireEvent.change(input(), {
      target: { value: "company:Babbage tag:Computing " },
    });
    expect(shown()).toEqual(["Ada Lovelace"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear filter text" }));
    expect(shown()).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  // Every failure read "Nothing found for that place", a dead server too.
  it("flies to a place it finds and names it, and says why it found none", async () => {
    const map = fakeMap();
    vi.mocked(searchPlace)
      .mockResolvedValueOnce({
        query: "Paris",
        lat: 48.8566,
        lng: 2.3522,
        provider: "Nominatim",
        cached: false,
        displayName: "Paris, France",
      })
      .mockRejectedValueOnce(new NetworkError());
    renderWithProviders(<TestComponent map={map} />);

    for (const place of ["Paris", "Lisbon"]) {
      if (!screen.queryByRole("textbox", { name: "Go to place" }))
        fireEvent.click(screen.getByRole("button", { name: "Go to place" }));
      const box = screen.getByRole("textbox", { name: "Go to place" });
      fireEvent.change(box, { target: { value: place } });
      fireEvent.keyDown(box, { key: "Enter" });
      await waitFor(() => expect(searchPlace).toHaveBeenCalledWith(place));
    }
    expect(map.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [2.3522, 48.8566], zoom: 10 }),
    );
    expect(toast).toHaveBeenCalledWith("Showing Paris, France");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Can't reach the Contrack server",
      ),
    );
  });

  it("switches between the two layers, pins and heat", () => {
    const handleLayerChange = vi.fn();
    renderWithProviders(<TestComponent onLayerChange={handleLayerChange} />);
    const layers = screen.getByRole("radiogroup", { name: "Map layer" });
    expect(
      Array.from(layers.querySelectorAll('[role="radio"]')).map(
        (option) => option.textContent,
      ),
    ).toEqual(["Pins", "Heat"]);
    fireEvent.click(screen.getByRole("radio", { name: "Heat" }));
    expect(handleLayerChange).toHaveBeenCalledWith("heat");
  });

  it("chooses a saved view from the Views menu", () => {
    const view = {
      id: "view-1",
      name: "London Hub",
      query: "London",
      layer: "heat" as const,
      bounds: [-0.5, 51.3, 0.2, 51.7] as [number, number, number, number],
      sortOrder: 0,
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    };
    const handleSelectView = vi.fn();
    renderWithProviders(
      <TestComponent
        views={[view]}
        onSelectView={handleSelectView}
        onOpenSaveModal={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Saved views" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "London Hub" }));
    expect(handleSelectView).toHaveBeenCalledWith(view);
  });

  // The Select menu is an `ActionMenu`: a menu button that opens a named
  // menu, and choosing an item closes it before the item runs. All in view
  // comes first, the one way without a pointer, and box and lasso show only
  // under one.
  it("opens the Select menu and runs all-in-view and lasso from its items", () => {
    const handleLasso = vi.fn();
    const handleInView = vi.fn();
    const { unmount } = renderWithProviders(
      <TestComponent
        onStartLasso={handleLasso}
        onSelectInView={handleInView}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Select contacts" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(trigger);
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "All in view",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "All in view" }));
    expect(handleInView).toHaveBeenCalledTimes(1);
    unmount();

    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(pointer: fine)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderWithProviders(<TestComponent onStartLasso={handleLasso} />);
    fireEvent.click(screen.getByRole("button", { name: "Select contacts" }));
    expect(screen.getByRole("menuitem", { name: /Box select/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Lasso select/ }));
    expect(handleLasso).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    vi.unstubAllGlobals();
  });
});
