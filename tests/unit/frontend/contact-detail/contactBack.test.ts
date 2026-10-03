// =============================================================================
// Unit: where the contact page's Back goes
// =============================================================================
// A page that opens a contact from its own list names itself as Back. The
// Enrichment page does, with its filters in the address. Anything else goes
// by the route: the archived list, the map with its filter, or the network.
// =============================================================================

import { describe, expect, it } from "vitest";
import { backTarget } from "../../../../src/views/contact-detail/backTarget";
import { NAMES } from "../../../../src/lib/names";

const enrichment = {
  to: "/settings/enrichment?research=found_nothing",
  label: NAMES.enrichment.label,
};

describe("the contact page's Back", () => {
  it("returns to the page that opened the contact, when that page names itself", () => {
    expect(backTarget("/contact/c1", { back: enrichment })).toEqual(enrichment);
  });

  it("takes only a path inside the app", () => {
    for (const to of [
      "https://example.com",
      "//example.com",
      "/\\example.com",
      "javascript:alert(1)",
    ])
      expect(
        backTarget("/contact/c1", { back: { to, label: "Elsewhere" } }),
      ).toEqual({ to: "/", label: NAMES.network.label });
    expect(
      backTarget("/contact/c1", { back: { to: 7, label: "Seven" } }),
    ).toEqual({
      to: "/",
      label: NAMES.network.label,
    });
  });

  it("otherwise goes by the route", () => {
    expect(backTarget("/map/contact/c1", null, "?q=tag%3Avc")).toEqual({
      to: "/map?q=tag%3Avc",
      label: NAMES.map.label,
    });
    expect(backTarget("/settings/archived/contact/c1", undefined)).toEqual({
      to: "/settings/archived",
      label: "Archived contacts",
    });
    expect(backTarget("/contact/c1", {})).toEqual({
      to: "/",
      label: NAMES.network.label,
    });
  });
});
