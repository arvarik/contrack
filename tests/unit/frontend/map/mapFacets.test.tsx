// @vitest-environment jsdom
// =============================================================================
// The map's filter, on rows built the way the map builds them
// =============================================================================
// The rows come from `toMapContacts`, a projection of the slim contact cache,
// and the query arrives through the address the way a link or a saved view
// gives it: with no space after its last facet.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toMapContacts } from "../../../../src/api/contacts";
import { useMapFilter } from "../../../../src/views/map/useMapFilter";

vi.mock("../../../../src/api/geo", () => ({
  searchPlace: vi.fn(async () => ({ lat: 51.5, lng: -0.12 })),
}));
import { searchPlace } from "../../../../src/api/geo";

afterEach(cleanup);

const DAY = 24 * 60 * 60 * 1000;
const iso = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * DAY).toISOString();

/** A slim row with the fields the projection reads. */
function slimRow(fields: {
  id: string;
  industry: string;
  updatedAt: string;
  emails: { email: string }[];
  phones: { phone: string }[];
  tags?: { tag: string }[];
  lat?: number;
}) {
  return {
    name: fields.id,
    company: null,
    role: null,
    location: null,
    avatarUrl: null,
    themeColor: "brand",
    lat: 51.5,
    lng: -0.12,
    isGhost: false,
    isArchived: false,
    isTracked: false,
    relationshipScore: null,
    lastContactedAt: null,
    nextFollowUpAt: null,
    cadenceDays: 30,
    interactionCount: 0,
    tags: [],
    lists: [],
    ...fields,
  };
}

// Built once, so the hook sees the same array on every render.
const rows = toMapContacts([
  slimRow({
    id: "vc",
    industry: "Venture Capital",
    updatedAt: iso(3),
    emails: [{ email: "ada@example.com" }],
    phones: [],
    tags: [{ tag: "design" }],
  }),
  slimRow({
    id: "fintech",
    industry: "Fintech",
    updatedAt: iso(400),
    emails: [],
    phones: [{ phone: "+44 20 7946 0000" }],
    tags: [{ tag: "design-lead" }],
    lat: 40.7,
  }),
] as never);

/** The filter over `rows`, opened at `/map?q=<query>`, and the address. */
function renderFilter(query = "", more = "") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[`/map?q=${encodeURIComponent(query)}${more}`]}
      >
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(
    () => ({ filter: useMapFilter(rows), search: useLocation().search }),
    { wrapper },
  ).result;
}

const ids = (result: ReturnType<typeof renderFilter>) =>
  result.current.filter.filteredContacts.map((contact) => contact.id);

describe("the map's filter", () => {
  it("carries the fields the facets read into each map row", () => {
    const [vc] = rows;
    expect(vc.updatedAt).toBeTruthy();
    expect(vc.emails).toEqual([{ email: "ada@example.com" }]);
    expect(vc.phones).toEqual([]);
  });

  // A saved view stores its query trimmed, and its last facet read as text.
  it("reads the last facet of a link or a saved view as a pill", () => {
    expect(ids(renderFilter('industry:"Venture Capital"'))).toEqual(["vc"]);
    expect(ids(renderFilter("updated:<1m"))).toEqual(["vc"]);
    expect(ids(renderFilter("updated:>6m"))).toEqual(["fintech"]);
    expect(ids(renderFilter("missing:email"))).toEqual(["fintech"]);
    expect(ids(renderFilter("missing:phone"))).toEqual(["vc"]);
  });

  it("keeps the pills, the text and the address in step", async () => {
    const result = renderFilter("tag:design-lead");
    // A bar's facet that begins a longer pill is a facet of its own.
    act(() =>
      result.current.filter.addFacet({ field: "tag", value: "design" }),
    );
    act(() =>
      result.current.filter.addFacet({ field: "tag", value: "design" }),
    );
    expect(result.current.filter.rawInput).toBe("tag:design-lead tag:design ");
    await waitFor(() =>
      expect(result.current.search).toBe("?q=tag%3Adesign-lead+tag%3Adesign"),
    );

    act(() => result.current.filter.removeFacet(0));
    expect(result.current.filter.rawInput.trim()).toBe("tag:design");

    act(() => result.current.filter.setRawInput("tag:design tag:vc zzz"));
    act(() => result.current.filter.clearFilters());
    expect(result.current.filter.parsed.filters).toEqual([]);
    expect(ids(result)).toEqual(["vc", "fintech"]);
    await waitFor(() => expect(result.current.search).toBe(""));
  });

  it("keeps only the people Ask sent, until that filter is removed", async () => {
    const result = renderFilter("", "&people=fintech,gone");
    expect(ids(result)).toEqual(["fintech"]);
    expect(result.current.filter.hasActiveFilter).toBe(true);
    act(() => result.current.filter.clearPeople());
    await waitFor(() => expect(ids(result)).toEqual(["vc", "fintech"]));
    expect(result.current.search).not.toContain("people");
  });

  it("looks up a near: place once, as soon as its pill forms", async () => {
    const result = renderFilter();
    act(() =>
      result.current.filter.setRawInput("near:London near:london/5km "),
    );
    expect(result.current.filter.effectiveFilters[0].resolving).toBe(true);
    await waitFor(() => expect(ids(result)).toEqual(["vc"]));
    expect(searchPlace).toHaveBeenCalledTimes(1);
  });
});
