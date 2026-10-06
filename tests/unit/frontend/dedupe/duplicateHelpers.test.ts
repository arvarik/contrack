// =============================================================================
// The words, the groups and the outcome the duplicate screens show
// =============================================================================
// Possible duplicates says three things about a pair before a person decides:
// how likely it is, why, and what a merge would keep. Each is worked out
// here, away from the screens, so the review list, the contact page's banner
// and the manual merge say the same thing.
// =============================================================================
import { describe, expect, it } from "vitest";
import { matchLevel } from "../../../../src/views/dedupe/utils/level";
import {
  pairCaveat,
  plainReason,
} from "../../../../src/views/dedupe/utils/reason";
import { buildGroups } from "../../../../src/views/dedupe/utils/groups";
import {
  mergeOutcome,
  movesSentence,
  suggestKeeper,
} from "../../../../src/views/dedupe/utils/mergeOutcome";
import type {
  PersistedDedupeSuggestion,
  SuggestedContact,
} from "../../../../src/types";

/** A contact with only what a test names, and empty lists for the rest. */
function person(
  id: string,
  name: string,
  extra: Partial<SuggestedContact> = {},
): SuggestedContact {
  return {
    id,
    name,
    emails: [],
    phones: [],
    socialLinks: [],
    tags: [],
    lists: [],
    sources: [],
    interactionCount: 0,
    ...extra,
  } as unknown as SuggestedContact;
}

function pair(
  id: string,
  a: SuggestedContact,
  b: SuggestedContact,
  confidence: number,
  extra: Partial<PersistedDedupeSuggestion> = {},
): PersistedDedupeSuggestion {
  return {
    id,
    contactIdA: a.id,
    contactIdB: b.id,
    contactA: a,
    contactB: b,
    matchType: "email",
    confidence,
    reasoning: "Same email address",
    caveat: null,
    matchedField: null,
    status: "pending",
    createdAt: "2026-10-05 10:00:00",
    reviewedAt: null,
    reviewedBy: null,
    ...extra,
  };
}

describe("matchLevel", () => {
  it("puts any pair with a caveat under Check carefully, however high it scores", () => {
    expect(matchLevel(0.85, "First names differ: Ada and Ben")).toBe("check");
    expect(matchLevel(0.95, "3 contacts share this phone number")).toBe(
      "check",
    );
  });

  it("splits the rest at 90% and 75%", () => {
    expect(matchLevel(0.92, null)).toBe("very-likely");
    expect(matchLevel(0.88, null)).toBe("likely");
    expect(matchLevel(0.6, null)).toBe("check");
  });
});

describe("plainReason", () => {
  it("keeps the server's plain words and drops a closing period", () => {
    expect(plainReason("fuzzy", "Similar names, same company and city")).toBe(
      "Similar names, same company and city",
    );
    expect(plainReason("ai", "Same person at the same firm.")).toBe(
      "Same person at the same firm",
    );
  });

  it("shows a line stored before the plain words as its match type's words", () => {
    expect(
      plainReason(
        "fuzzy",
        "High name similarity (94%), embedding similarity 94% (score: 81%)",
      ),
    ).toBe("Similar names");
    expect(plainReason("phone", "Shared phone number: +1 212 555 0199")).toBe(
      "Same phone number",
    );
  });
});

describe("pairCaveat", () => {
  it("reads the caveat an old line kept at its end, in the server's new words", () => {
    expect(
      pairCaveat(
        null,
        'Shared phone number. the first names differ ("ada" ↔ "ben"), so review this pair',
      ),
    ).toBe("First names differ: Ada and Ben");
    expect(
      pairCaveat(
        null,
        'Shared email address. one is "jr" and the other "sr", so review this pair',
      ),
    ).toBe("One is Jr. and the other Sr.");
  });

  it("prefers the caveat the server stored", () => {
    expect(pairCaveat("Different companies", "Same name")).toBe(
      "Different companies",
    );
    expect(pairCaveat(null, "Same name")).toBeNull();
  });
});

describe("buildGroups", () => {
  const a = person("a", "Ada Quill");
  const b = person("b", "A. Quill");
  const c = person("c", "Ada Q.");
  const d = person("d", "Tobias Wren");
  const e = person("e", "T. Wren");

  it("joins pairs that share a contact into one group", () => {
    const groups = buildGroups([
      pair("ab", a, b, 0.95),
      pair("bc", b, c, 0.8),
      pair("de", d, e, 0.9),
    ]);
    expect(groups.map((g) => g.contacts.length).sort()).toEqual([2, 3]);
  });

  it("rates a group by the weakest link it needs, not its strongest", () => {
    const [group] = buildGroups([
      pair("ab", a, b, 0.98),
      pair("bc", b, c, 0.8),
    ]);
    expect(group.confidence).toBe(0.8);
    expect(group.level).toBe("likely");
    expect(group.lead.id).toBe("ab");
  });

  it("makes a group with any caveat Check carefully, and sorts it last", () => {
    const groups = buildGroups([
      pair("ab", a, b, 0.86, { caveat: "First names differ: Ada and Ben" }),
      pair("de", d, e, 0.8),
    ]);
    expect(groups.map((g) => g.level)).toEqual(["likely", "check"]);
    expect(groups[1].caveats).toEqual(["First names differ: Ada and Ben"]);
  });
});

describe("mergeOutcome", () => {
  it("names each value the kept contact replaces, and each it takes from an empty field", () => {
    const keeper = person("k", "Elena Marchetti", { company: "Fabrikam" });
    const other = person("o", "Elena Marchetti", {
      company: "Contoso",
      role: "Investor",
    });
    const { notKept, filled } = mergeOutcome(keeper, [other]);
    expect(notKept.map((l) => [l.label, l.value])).toEqual([
      ["Company", "Contoso"],
    ]);
    expect(filled.map((l) => [l.label, l.value])).toEqual([
      ["Role", "Investor"],
    ]);
  });

  it("fills a field from the first contact that has it, and drops the later ones' values", () => {
    const keeper = person("k", "Ada Quill");
    const first = person("1", "A. Quill", { company: "Northwind" });
    const second = person("2", "Ada Q.", { company: "Contoso" });
    const { notKept, filled } = mergeOutcome(keeper, [first, second]);
    expect(filled[0]).toMatchObject({ value: "Northwind", from: "A. Quill" });
    expect(notKept.find((l) => l.field === "company")?.value).toBe("Contoso");
  });

  it("counts only what the kept contact does not have yet", () => {
    const keeper = person("k", "Ada Quill", {
      emails: [{ email: "ada@northwind.test" }],
      phones: [{ phone: "+1 415 555 0142" }],
    } as Partial<SuggestedContact>);
    const other = person("o", "A. Quill", {
      emails: [{ email: "ADA@northwind.test" }, { email: "ada@home.test" }],
      phones: [{ phone: "(415) 555-0142" }],
      interactionCount: 3,
      openFollowUpCount: 1,
    } as Partial<SuggestedContact>);
    const { moves } = mergeOutcome(keeper, [other]);
    expect(moves).toMatchObject({
      emails: 1,
      phones: 0,
      notes: 3,
      followUps: 1,
    });
    expect(movesSentence(moves)).toBe("3 notes, 1 follow-up and 1 email");
  });
});

describe("suggestKeeper", () => {
  it("keeps the contact with the uploaded photo, then the most complete one", () => {
    const plain = person("p", "Ada Quill", {
      company: "Northwind",
      about: "x",
    });
    const photo = person("f", "A. Quill", {
      avatarUrl: "/uploads/avatars/ada.png",
    });
    expect(suggestKeeper([plain, photo]).id).toBe("f");
    expect(suggestKeeper([person("e", "Empty"), plain]).id).toBe("p");
  });
});
