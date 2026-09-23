// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MapInsightsPane } from "../../src/views/map/MapInsightsPane";
import type { MapStats } from "../../src/views/map/mapStats";
import type { MapContact } from "../../shared/geo";

vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: (options: { count: number }) => ({
      getTotalSize: () => options.count * 64,
      getVirtualItems: () =>
        Array.from({ length: options.count }, (_, index) => ({
          index,
          start: index * 64,
          size: 64,
          end: (index + 1) * 64,
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

describe("MapInsightsPane", () => {
  beforeEach(() => {
    stubMatchMedia(true);
  });
  const mockStats: MapStats = {
    inView: 2,
    matching: 2,
    total: 10,
    atRisk: 1,
    overdue: 0,
    neverContacted: 0,
    avgScore: 75,
    topIndustries: [{ name: "Computing", count: 2 }],
    topCompanies: [{ name: "Babbage & Co", count: 1 }],
    topTags: [{ name: "pioneer", count: 2 }],
    timeZones: [
      { offset: "GMT+1", label: "GMT+1", count: 2, offsetMinutes: 60 },
    ],
  };

  const mockContacts: MapContact[] = [
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

  it("renders when open with data-covers-map='right' and aria-label='Map insights'", () => {
    render(
      <MapInsightsPane
        isOpen={true}
        onToggle={vi.fn()}
        stats={mockStats}
        inViewContacts={mockContacts}
        onApplyFacet={vi.fn()}
        onSelectContact={vi.fn()}
      />,
    );

    const aside = screen.getByRole("complementary", { name: "Map insights" });
    expect(aside).toBeDefined();
    expect(aside.getAttribute("data-covers-map")).toBe("right");
  });

  it("says Overdue in the overdue tone, red as on the strip", () => {
    render(
      <MapInsightsPane
        isOpen={true}
        onToggle={vi.fn()}
        stats={{ ...mockStats, overdue: 2 }}
        inViewContacts={mockContacts}
        onApplyFacet={vi.fn()}
        onSelectContact={vi.fn()}
      />,
    );
    const figure = screen.getByText("Overdue").nextElementSibling!;
    expect(figure.textContent).toBe("2");
    expect(figure.className).toContain("text-error");
    expect(figure.className).not.toContain("text-warning");
  });

  it("calls onApplyFacet when clicking a bar in the Stats tab", () => {
    const onApplyFacet = vi.fn();
    render(
      <MapInsightsPane
        isOpen={true}
        onToggle={vi.fn()}
        stats={mockStats}
        inViewContacts={mockContacts}
        onApplyFacet={onApplyFacet}
        onSelectContact={vi.fn()}
      />,
    );

    const industryBar = screen.getByRole("button", {
      name: "Filter by industry: Computing (2)",
    });
    fireEvent.click(industryBar);
    expect(onApplyFacet).toHaveBeenCalledWith("industry:Computing");

    const companyBar = screen.getByRole("button", {
      name: "Filter by company: Babbage & Co (1)",
    });
    fireEvent.click(companyBar);
    expect(onApplyFacet).toHaveBeenCalledWith('company:"Babbage & Co"');
  });

  it("switches to People tab and calls onSelectContact on click", () => {
    const onSelectContact = vi.fn();
    render(
      <MapInsightsPane
        isOpen={true}
        onToggle={vi.fn()}
        stats={mockStats}
        inViewContacts={mockContacts}
        onApplyFacet={vi.fn()}
        onSelectContact={onSelectContact}
      />,
    );

    const peopleTab = screen.getByRole("tab", { name: /People/ });
    fireEvent.click(peopleTab);

    expect(screen.getByText("Ada Lovelace")).toBeDefined();
    const adaRow = screen.getByRole("button", {
      name: "Ada Lovelace, Babbage & Co",
    });
    fireEvent.click(adaRow);
    expect(onSelectContact).toHaveBeenCalledWith(mockContacts[0]);
  });

  it("calls onToggle(false) when close button is clicked", () => {
    const onToggle = vi.fn();
    render(
      <MapInsightsPane
        isOpen={true}
        onToggle={onToggle}
        stats={mockStats}
        inViewContacts={mockContacts}
        onApplyFacet={vi.fn()}
        onSelectContact={vi.fn()}
      />,
    );

    const closeBtn = screen.getByRole("button", { name: "Close insights" });
    fireEvent.click(closeBtn);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("renders mobile modal sheet when screen is narrow", () => {
    stubMatchMedia(false);
    render(
      <MapInsightsPane
        isOpen={true}
        onToggle={vi.fn()}
        stats={mockStats}
        inViewContacts={mockContacts}
        onApplyFacet={vi.fn()}
        onSelectContact={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Map insights" })).toBeDefined();
  });
});
