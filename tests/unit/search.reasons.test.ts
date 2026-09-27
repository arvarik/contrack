// =============================================================================
// Unit tests: server-built reasons for Ask Contrack matches (buildReason)
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  buildReason,
  type ReasonContact,
} from "../../server/services/search/reasons.ts";

const now = new Date("2026-09-26T12:00:00Z");
const contact: ReasonContact = {
  role: "Product Manager",
  company: "Northwind Logistics",
  location: "Lisbon, Portugal",
  industry: "Logistics",
  headline: "Builds delivery software",
  lastContactedAt: "2026-05-20T10:00:00.000Z",
};

describe("buildReason: one part per proven field", () => {
  it.each([
    [[{ field: "company" }], "Works at Northwind Logistics."],
    [[{ field: "location" }], "Based in Lisbon, Portugal."],
    [[{ field: "industry" }], "Works in Logistics."],
    [[{ field: "role" }], "Product Manager."],
    [[{ field: "tag", value: "investor" }], "Tagged investor."],
    [[{ field: "interest", value: "beekeeping" }], "Interested in beekeeping."],
    [[{ field: "headline", value: "delivery software" }], "Delivery software."],
    [
      [{ field: "about", value: "beekeeping" }],
      "Profile mentions “beekeeping”.",
    ],
    [
      [{ field: "preferences", value: "early mornings" }],
      "Profile mentions “early mornings”.",
    ],
  ] as const)("%j", (evidence, reason) => {
    expect(buildReason(contact, [...evidence], now)).toBe(reason);
  });

  it("merges a role and a company, then adds the place", () => {
    expect(
      buildReason(
        contact,
        [{ field: "role" }, { field: "company" }, { field: "location" }],
        now,
      ),
    ).toBe(
      "Product Manager at Northwind Logistics, based in Lisbon, Portugal.",
    );
  });

  it("uses the role the filter read from a headline", () => {
    expect(
      buildReason(
        { ...contact, role: null },
        [{ field: "role", value: "Venture investor" }],
        now,
      ),
    ).toBe("Venture investor.");
  });

  it("joins at most two parts, in the order given", () => {
    expect(
      buildReason(
        contact,
        [
          { field: "interest", value: "rock climbing" },
          { field: "location" },
          { field: "industry" },
        ],
        now,
      ),
    ).toBe("Interested in rock climbing, based in Lisbon, Portugal.");
  });

  it("uses a field once", () => {
    expect(
      buildReason(contact, [{ field: "location" }, { field: "location" }], now),
    ).toBe("Based in Lisbon, Portugal.");
  });

  it("does not double the full stop", () => {
    expect(
      buildReason(
        { location: "Washington, D.C." },
        [{ field: "location" }],
        now,
      ),
    ).toBe("Based in Washington, D.C.");
  });

  it("cuts a long value", () => {
    const reason = buildReason(
      contact,
      [{ field: "about", value: "x".repeat(200) }],
      now,
    );
    expect(reason).toMatch(/^Profile mentions “x+…”\.$/);
    expect(reason!.length).toBeLessThan(110);
  });
});

describe("buildReason: empty fields", () => {
  it("skips a proven field that is empty on the contact", () => {
    expect(
      buildReason(
        { ...contact, location: "  " },
        [{ field: "location" }, { field: "company" }],
        now,
      ),
    ).toBe("Works at Northwind Logistics.");
  });

  it("says nothing when nothing is left", () => {
    expect(buildReason({}, [{ field: "location" }], now)).toBeNull();
    expect(buildReason(contact, [], now)).toBeNull();
    expect(buildReason(contact, [{ field: "tag" }], now)).toBeNull();
  });
});

describe("buildReason: the temporal wording", () => {
  it("says how long ago the last contact was", () => {
    expect(buildReason(contact, [{ field: "lastContact" }], now)).toBe(
      "Last contact 4 months ago.",
    );
    expect(
      buildReason(
        { lastContactedAt: "2024-01-02T00:00:00Z" },
        [{ field: "lastContact" }],
        now,
      ),
    ).toBe("Last contact 2 years ago.");
    expect(
      buildReason(
        { lastContactedAt: "2026-09-16T12:00:00Z" },
        [{ field: "lastContact" }],
        now,
      ),
    ).toBe("Last contact 10 days ago.");
  });

  it("reads a SQLite datetime as UTC", () => {
    expect(
      buildReason(
        { lastContactedAt: "2026-06-26 12:00:00" },
        [{ field: "lastContact" }],
        now,
      ),
    ).toBe("Last contact 3 months ago.");
  });

  it("says no contact was logged for a contact never contacted", () => {
    expect(
      buildReason(
        { ...contact, lastContactedAt: null },
        [{ field: "lastContact" }],
        now,
      ),
    ).toBe("No contact logged.");
  });

  it("follows another part in lower case", () => {
    expect(
      buildReason(contact, [{ field: "role" }, { field: "lastContact" }], now),
    ).toBe("Product Manager, last contact 4 months ago.");
    expect(
      buildReason(
        { ...contact, lastContactedAt: null },
        [{ field: "location" }, { field: "lastContact" }],
        now,
      ),
    ).toBe("Based in Lisbon, Portugal, no contact logged.");
  });
});
