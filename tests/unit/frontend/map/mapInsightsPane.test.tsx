// @vitest-environment jsdom
/**
 * The map's insights: the page's side panel from `lg`, a bottom sheet below
 * it, a summary whose bars are filters, and the people in view.
 */
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MapInsightsPane } from "../../../../src/views/map/MapInsightsPane";
import type { MapStats } from "../../../../src/views/map/mapStats";
import type { MapContact } from "../../../../shared/geo";

vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: (options: { count: number }) => ({
      getTotalSize: () => options.count * 56,
      getVirtualItems: () =>
        Array.from({ length: options.count }, (_, index) => ({
          index,
          start: index * 56,
          size: 56,
          end: (index + 1) * 56,
          key: index,
        })),
      scrollToOffset: vi.fn(),
    }),
  };
});

function stubMatchMedia(wide = true) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: wide && query.includes("min-width"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}

const stats: MapStats = {
  inView: 2,
  matching: 2,
  overdue: 0,
  topIndustries: [{ name: "Computing", count: 2 }],
  topCompanies: [{ name: "Babbage & Co", count: 1 }],
  topTags: [{ name: "pioneer", count: 2 }],
  timeZones: [{ label: "GMT+1", count: 2, offsetMinutes: 60 }],
};

const people: MapContact[] = [
  {
    id: "c1",
    name: "Ada Lovelace",
    company: "Babbage & Co",
    role: "Analyst",
    location: "London, UK",
    avatarUrl: null,
    isTracked: true,
    lat: 51.5074,
    lng: -0.1278,
    relationshipScore: 85,
    lastContactedAt: "2026-06-01T12:00:00.000Z",
    tags: ["pioneer"],
    lists: [],
  },
  {
    id: "c2",
    name: "Alan Turing",
    company: "Codebreakers Ltd",
    role: "Cryptanalyst",
    location: "London, UK",
    avatarUrl: null,
    isTracked: true,
    lat: 52.0,
    lng: -0.7,
    relationshipScore: 35,
    tags: ["pioneer"],
    lists: [],
  },
];

const renderPane = (
  props: Partial<ComponentProps<typeof MapInsightsPane>> = {},
) =>
  render(
    <MapInsightsPane
      isOpen
      onToggle={vi.fn()}
      stats={stats}
      inViewContacts={people}
      onApplyFacet={vi.fn()}
      onSelectContact={vi.fn()}
      {...props}
    />,
  );

beforeEach(() => stubMatchMedia(true));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MapInsightsPane", () => {
  it("is the side panel from lg, covering the map only while it is open", () => {
    const { rerender } = renderPane();
    const panel = screen.getByRole("complementary", { name: "Map insights" });
    expect(panel.getAttribute("data-covers-map")).toBe("right");
    // The insights button, the glyph alone, discloses it. The heading row
    // holds the view switch, and the heading stays for a screen reader.
    const button = screen.getByRole("button", { name: "Map insights" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe(panel.id);
    expect(button.textContent).toBe("");
    const heading = screen.getByRole("heading", { name: "Map insights" });
    expect(heading.className).toContain("sr-only");
    expect(
      heading.parentElement?.contains(
        screen.getByRole("radiogroup", { name: "Insights view" }),
      ),
    ).toBe(true);

    rerender(
      <MapInsightsPane
        isOpen={false}
        onToggle={vi.fn()}
        stats={stats}
        inViewContacts={people}
        onApplyFacet={vi.fn()}
        onSelectContact={vi.fn()}
      />,
    );
    // Closed, it is inert and covers nothing, so the map keeps its width.
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(panel.hasAttribute("data-covers-map")).toBe(false);
  });

  it("closes and opens from the one insights button", () => {
    const onToggle = vi.fn();
    const { unmount } = renderPane({ onToggle });
    expect(screen.queryByRole("button", { name: /hide/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Map insights" }));
    expect(onToggle).toHaveBeenLastCalledWith(false);
    unmount();
    renderPane({ onToggle, isOpen: false });
    fireEvent.click(screen.getByRole("button", { name: "Map insights" }));
    expect(onToggle).toHaveBeenLastCalledWith(true);
  });

  it("filters by a bar, quoting a value with a space, and a bar that is on removes its pill", () => {
    const onApplyFacet = vi.fn();
    const onRemoveFacet = vi.fn();
    // The pill as typed, in its own case, is still the bar's.
    renderPane({
      onApplyFacet,
      onRemoveFacet,
      activeFilters: [{ field: "industry", value: "computing" }],
    });
    const company = screen.getByRole("button", {
      name: "Filter by company: Babbage & Co (1)",
    });
    expect(company.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(company);
    expect(onApplyFacet).toHaveBeenCalledWith('company:"Babbage & Co"');

    const industry = screen.getByRole("button", {
      name: "Filter by industry: Computing (2)",
    });
    expect(industry.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(industry);
    expect(onRemoveFacet).toHaveBeenCalledWith(0);
    expect(onApplyFacet).toHaveBeenCalledTimes(1);
    expect(screen.getByText("2 people")).toBeTruthy();
  });

  it("lists the overdue first and then by name, points at a pin, and flies to the one pressed", () => {
    const onSelectContact = vi.fn();
    const onHighlightContact = vi.fn();
    const rowan: MapContact = {
      id: "c3",
      name: "Rowan Vale",
      company: "Northwind Partners",
      location: "Reading, UK",
      avatarUrl: null,
      isTracked: true,
      lat: 51.45,
      lng: -0.97,
      nextFollowUpAt: "2020-01-15",
    };
    renderPane({
      onSelectContact,
      onHighlightContact,
      inViewContacts: [people[1], rowan, people[0]],
    });
    fireEvent.click(screen.getByRole("radio", { name: "People" }));
    const list = screen.getByRole("list", { name: "People in view" });
    const rows = within(list).getAllByRole("button");
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Rowan Vale, Northwind Partners, overdue",
      "Ada Lovelace, Babbage & Co",
      "Alan Turing, Codebreakers Ltd",
    ]);

    fireEvent.mouseEnter(rows[0]);
    expect(onHighlightContact).toHaveBeenLastCalledWith("c3");
    fireEvent.mouseLeave(list);
    expect(onHighlightContact).toHaveBeenLastCalledWith(null);
    fireEvent.click(rows[1]);
    expect(onSelectContact).toHaveBeenCalledWith(people[0]);
  });

  it("says why nobody is in view", () => {
    const nobody = { ...stats, inView: 0, matching: 0 };
    for (const [empty, words] of [
      ["loading", "Loading contacts…"],
      ["failed", "Could not load contacts"],
      ["none", "No one is on the map yetAdd a location to a contact"],
      [undefined, "No one in viewZoom out or clear the filters"],
    ] as const) {
      renderPane({ stats: nobody, inViewContacts: [], empty });
      expect(screen.getByRole("complementary").textContent).toContain(words);
      cleanup();
    }
  });

  it("opens in a bottom sheet below lg", () => {
    stubMatchMedia(false);
    renderPane();
    expect(screen.getByRole("dialog", { name: "Map insights" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Filter by tag: pioneer (2)" }),
    ).toBeTruthy();
  });
});
