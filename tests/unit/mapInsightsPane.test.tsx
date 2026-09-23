// @vitest-environment jsdom
/**
 * The map's insights: the page's side panel from `lg`, a bottom sheet below
 * it, a summary whose bars are filters, and the people in view.
 */
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MapInsightsPane } from "../../src/views/map/MapInsightsPane";
import type { MapStats } from "../../src/views/map/mapStats";
import type { MapContact } from "../../shared/geo";

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
  timeZones: [{ offset: "GMT+1", label: "GMT+1", count: 2, offsetMinutes: 60 }],
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
    // The Insights button discloses it and says its word. The button names
    // the panel, so the heading row holds the view switch, and the heading
    // stays for a screen reader.
    const button = screen.getByRole("button", { name: "Map insights" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe(panel.id);
    expect(button.textContent).toBe("Insights");
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

  it("closes and opens from the one Insights button", () => {
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

  it("filters by a bar in the summary, quoting a value with a space", () => {
    const onApplyFacet = vi.fn();
    renderPane({ onApplyFacet });
    fireEvent.click(
      screen.getByRole("button", { name: "Filter by industry: Computing (2)" }),
    );
    expect(onApplyFacet).toHaveBeenCalledWith("industry:Computing");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Filter by company: Babbage & Co (1)",
      }),
    );
    expect(onApplyFacet).toHaveBeenCalledWith('company:"Babbage & Co"');
    expect(screen.getByText("2 people")).toBeTruthy();
  });

  it("lists the people in view, and flies to the one pressed", () => {
    const onSelectContact = vi.fn();
    renderPane({ onSelectContact });
    fireEvent.click(screen.getByRole("radio", { name: "People" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Ada Lovelace, Babbage & Co" }),
    );
    expect(onSelectContact).toHaveBeenCalledWith(people[0]);
  });

  it("says so when nobody is in view", () => {
    renderPane({
      stats: { ...stats, inView: 0, topIndustries: [], topCompanies: [] },
      inViewContacts: [],
    });
    expect(
      screen.getByRole("heading", { level: 3, name: "No one in view" }),
    ).toBeTruthy();
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
