// @vitest-environment jsdom
// =============================================================================
// The map's facets, on rows built the way the map builds them
// =============================================================================
// The map filters its own rows with `matchesFacet`, and those rows come from
// `toMapContacts`, a projection of the slim contact cache. Three facets read
// nothing on screen when the projection leaves their field out: `updated:`
// matched nobody, and `missing:email` and `missing:phone` matched everybody.
// A quoted value from an insight bar, `industry:"Venture Capital"`, was cut
// at its space by the tokenizer, so the map showed 0 matches.
//
// The query arrives through the address, with the trailing space the insight
// bars write, and the rows go through the real projection.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { toMapContacts } from "../../../../src/api/contacts";
import { useMapFilter } from "../../../../src/views/map/useMapFilter";

vi.mock("../../../../src/api/geo", () => ({ searchPlace: vi.fn() }));

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
  }),
  slimRow({
    id: "fintech",
    industry: "Fintech",
    updatedAt: iso(400),
    emails: [],
    phones: [{ phone: "+44 20 7946 0000" }],
  }),
] as never);

/** The ids the map shows for the query in its address. */
function matchesFor(query: string): string[] {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[`/map?q=${encodeURIComponent(query)}`]}>
      {children}
    </MemoryRouter>
  );
  const { result } = renderHook(() => useMapFilter(rows), { wrapper });
  return result.current.filteredContacts.map((contact) => contact.id);
}

describe("the map's facets", () => {
  it("carries the fields the facets read into each map row", () => {
    const [vc] = rows;
    expect(vc.updatedAt).toBeTruthy();
    expect(vc.emails).toEqual([{ email: "ada@example.com" }]);
    expect(vc.phones).toEqual([]);
  });

  it("finds an insight bar's quoted value with a space", () => {
    expect(matchesFor('industry:"Venture Capital" ')).toEqual(["vc"]);
  });

  it("reads updated: from the row's last change", () => {
    expect(matchesFor("updated:<1m ")).toEqual(["vc"]);
    expect(matchesFor("updated:>6m ")).toEqual(["fintech"]);
  });

  it("finds only the people with no email or no phone", () => {
    expect(matchesFor("missing:email ")).toEqual(["fintech"]);
    expect(matchesFor("missing:phone ")).toEqual(["vc"]);
  });
});
