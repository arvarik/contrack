// =============================================================================
// The merge policy, one rule at a time
// =============================================================================
// `tests/eval/dedupe.eval.test.ts` measures what the policy does to a whole
// corpus. This checks each rule on its own, with the two contacts written out,
// so a failure names the rule rather than moving a number.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  ANCHOR_CONFIDENCE,
  CARRIER_PENALTY,
  DEFAULT_AUTO_MERGE_THRESHOLD,
  NAME_CONFIDENCE,
  PRESET_THRESHOLDS,
  REVIEW_CEILING,
  WEAKEST_CLAIM,
  carriersOf,
  countValues,
  firstNamesContradict,
  generationsContradict,
  namesContradict,
  thresholdForPreset,
  weaken,
  weighAnchor,
  weighClaim,
  weighName,
  withCaveat,
} from "../../server/services/dedupe/policy.ts";
import { normalizeContact } from "../../server/services/dedupe/normalization.ts";
import { generationOf } from "../../server/utils/nlp/names.ts";
import { THRESHOLD_AI } from "../../server/services/dedupe/scoring.ts";

/** A normalized contact from a name and, optionally, a company. */
function person(
  name: string,
  extra: { company?: string; emails?: string[]; phones?: string[] } = {},
) {
  // Tags and interests are passed empty rather than left out: absent, the
  // normalizer reads them from the database, and the unit project has none.
  return normalizeContact(
    { id: name, name, company: extra.company ?? null },
    (extra.emails ?? []).map((email) => ({ email })),
    (extra.phones ?? []).map((phone) => ({ phone })),
    [],
    [],
    [],
  );
}

describe("the threshold", () => {
  it("has one preset table, and the default is the balanced one", () => {
    expect(PRESET_THRESHOLDS).toEqual({
      aggressive: 0.88,
      default: 0.93,
      conservative: 0.97,
    });
    expect(DEFAULT_AUTO_MERGE_THRESHOLD).toBe(0.93);
    expect(thresholdForPreset("conservative")).toBe(0.97);
    expect(thresholdForPreset("aggressive")).toBe(0.88);
  });

  it("caps a contradicted pair below every preset and above the review floor", () => {
    // Otherwise the aggressive preset would merge a household.
    for (const threshold of Object.values(PRESET_THRESHOLDS)) {
      expect(REVIEW_CEILING).toBeLessThan(threshold);
    }
    expect(REVIEW_CEILING).toBeGreaterThan(THRESHOLD_AI);
    expect(WEAKEST_CLAIM).toBe(THRESHOLD_AI);
  });
});

describe("firstNamesContradict", () => {
  const agree: [string, string, string][] = [
    ["the same name", "Ada Twin", "Ada Twin"],
    ["a nickname", "Robert Hale", "Bob Hale"],
    ["a short form the table knows", "Susanna Adeyemi", "Sue Adeyemi"],
    ["an initial", "J. Whitfield", "James Whitfield"],
    ["an initial with no dot", "J Whitfield", "James Whitfield"],
    ["a prefix of three letters", "Abhishek Varadarajan", "Abhi Varadarajan"],
    ["a dropped letter", "Charles Hatherleigh", "Chrles Hatherleigh"],
    ["a dropped letter in a short name", "Adam Ellis", "Adm Ellis"],
    ["a transposed pair", "Jonathan Reyes", "Jonahtan Reyes"],
    ["the same sound", "Jon Alder", "John Alder"],
    ["a married name", "Priya Menon", "Priya Menon-Whitmore"],
    ["a middle name added", "Anton Kovacs", "Anton Peter Kovacs"],
    ["a one-token record that is the surname", "Ciccone", "Madonna Ciccone"],
    ["a missing first name", "Kovacs", "Anton Kovacs"],
  ];
  for (const [what, a, b] of agree) {
    it(`does not fire on ${what}`, () => {
      expect(firstNamesContradict(person(a), person(b))).toBe(false);
      expect(firstNamesContradict(person(b), person(a))).toBe(false);
    });
  }

  const disagree: [string, string, string][] = [
    ["two different first names", "Ada Twin", "Ben Twin"],
    ["a couple on one surname", "Noor Haddad", "Sami Haddad"],
    ["an initial that does not start the name", "M. Twin", "Ada Twin"],
    ["two short names that share two letters", "Mark Ellis", "Mary Ellis"],
    ["two one-token names", "Mom", "Dad"],
  ];
  for (const [what, a, b] of disagree) {
    it(`fires on ${what}`, () => {
      expect(firstNamesContradict(person(a), person(b))).toBe(true);
      expect(firstNamesContradict(person(b), person(a))).toBe(true);
    });
  }
});

describe("generationsContradict", () => {
  it("reads the suffix the tokenizer strips", () => {
    expect(generationOf("Robert Hale Jr.")).toBe("jr");
    expect(generationOf("Robert Hale, Sr")).toBe("sr");
    expect(generationOf("Robert Hale III")).toBe("iii");
    expect(generationOf("Robert Hale 2nd")).toBe("ii");
    expect(generationOf("Robert Hale")).toBeNull();
    // Only a trailing token. A one-token name is not a suffix.
    expect(generationOf("Jr")).toBeNull();
  });

  it("fires only when both sides carry a suffix and they differ", () => {
    const sr = person("Robert Hale Sr.");
    const jr = person("Robert Hale Jr.");
    const plain = person("Robert Hale");
    const jrAgain = person("Robert Hale, Jr");
    expect(sr.nameNorm).toBe(jr.nameNorm);
    expect(generationsContradict(sr, jr)).toBe(true);
    expect(generationsContradict(sr, plain)).toBe(false);
    expect(generationsContradict(jr, jrAgain)).toBe(false);
    expect(namesContradict(sr, jr)).toBe(true);
    expect(namesContradict(person("Ada Twin"), person("Ben Twin"))).toBe(true);
    expect(namesContradict(plain, jrAgain)).toBe(false);
  });
});

describe("weaken and weighClaim", () => {
  it("costs three points per contact beyond the pair", () => {
    expect(weaken(0.95, 2, false)).toBe(0.95);
    expect(weaken(0.95, 3, false)).toBe(0.92);
    expect(weaken(0.95, 4, false)).toBe(0.89);
    expect(weaken(0.98, 3, false)).toBe(0.95);
    expect(CARRIER_PENALTY).toBe(0.03);
  });

  it("caps a contradicted match at the review ceiling", () => {
    expect(weaken(0.98, 2, true)).toBe(REVIEW_CEILING);
    expect(weaken(0.95, 2, true)).toBe(REVIEW_CEILING);
    // Already below the ceiling: the cap does not raise it.
    expect(weaken(0.8, 2, true)).toBe(0.8);
    // Both rules at once: the penalty first, then the cap.
    expect(weaken(0.98, 7, true)).toBe(0.83);
  });

  it("floors a whole claim at the review band, and a weight at nothing", () => {
    // Twenty carriers of one address is still a reason to ask.
    expect(weighClaim(0.98, 20, false)).toBe(WEAKEST_CLAIM);
    // A weight is a part of a score and may go to zero.
    expect(weaken(0.6, 30, false)).toBe(0);
  });

  it("does not raise anything", () => {
    for (const base of [0.98, 0.95, 0.93, 0.9]) {
      for (const carriers of [2, 3, 5]) {
        for (const contradicted of [false, true]) {
          expect(weighClaim(base, carriers, contradicted)).toBeLessThanOrEqual(
            base,
          );
        }
      }
    }
  });
});

describe("weighAnchor and weighName", () => {
  it("leaves an owned identifier between agreeing names alone", () => {
    const a = person("Robert Hale", { emails: ["r@example.com"] });
    const b = person("Bob Hale", { emails: ["r@example.com"] });
    expect(weighAnchor("email", a, b, 2)).toEqual({
      confidence: ANCHOR_CONFIDENCE.email,
      caveat: null,
    });
    expect(weighAnchor("phone", a, b, 2).confidence).toBe(
      ANCHOR_CONFIDENCE.phone,
    );
    expect(
      withCaveat("Shared email address", weighAnchor("email", a, b, 2)),
    ).toBe("Shared email address");
  });

  it("says why a household on one line is not a duplicate", () => {
    const a = person("Ada Twin", { phones: ["+1 555 0142"] });
    const b = person("Ben Twin", { phones: ["+1 555 0142"] });
    const weighed = weighAnchor("phone", a, b, 2);
    expect(weighed.confidence).toBe(REVIEW_CEILING);
    expect(weighed.caveat).toBe(
      'the first names differ ("ada" ↔ "ben"), so review this pair',
    );
    expect(withCaveat("Shared phone number: +1 555 0142", weighed)).toBe(
      'Shared phone number: +1 555 0142. the first names differ ("ada" ↔ "ben"), so review this pair',
    );
  });

  it("says why a father and a son are not a duplicate", () => {
    const weighed = weighAnchor(
      "phone",
      person("Robert Hale Sr."),
      person("Robert Hale Jr."),
      2,
    );
    expect(weighed.confidence).toBe(REVIEW_CEILING);
    expect(weighed.caveat).toBe(
      'one is "jr" and the other "sr", so review this pair',
    );
  });

  it("counts the carriers, and names both reasons when both apply", () => {
    const a = person("Ada Twin", { phones: ["+1 555 0142"] });
    const b = person("Ben Twin", { phones: ["+1 555 0142"] });
    const shared = weighAnchor("phone", a, b, 3);
    expect(shared.confidence).toBe(REVIEW_CEILING);
    expect(shared.caveat).toBe(
      '3 contacts carry this number, and the first names differ ("ada" ↔ "ben"), so review this pair',
    );

    const same = weighAnchor("phone", a, person("A. Twin"), 3);
    expect(same.confidence).toBe(0.92);
    expect(same.caveat).toBe(
      "3 contacts carry this number, so review this pair",
    );
  });

  it("weighs a name by how many contacts carry it", () => {
    expect(weighName(NAME_CONFIDENCE.nameCompany, 2)).toEqual({
      confidence: 0.95,
      caveat: null,
    });
    expect(weighName(NAME_CONFIDENCE.nameCompany, 3)).toEqual({
      confidence: 0.92,
      caveat: "3 contacts carry this name, so review this pair",
    });
    expect(weighName(NAME_CONFIDENCE.name, 2).confidence).toBe(0.9);
  });
});

describe("countValues and carriersOf", () => {
  it("counts active contacts per value, each contact once", () => {
    const frequency = countValues([
      person("Ada Twin", {
        emails: ["Home@Example.com", "home@example.com"],
        phones: ["+1 415 555 0142"],
      }),
      person("Ben Twin", { phones: ["(415) 555-0142", "415-555-0142"] }),
      person("Cal Twin", { phones: ["415 555 0142"] }),
      person("Ada Twin"),
    ]);
    expect(frequency.emails.get("home@example.com")).toBe(1);
    expect(frequency.phones.get("4155550142")).toBe(3);
    expect(frequency.names.get("ada twin")).toBe(2);
    expect(frequency.names.get("ben twin")).toBe(1);
  });

  it("answers two for a value nobody counted", () => {
    const frequency = countValues([]);
    expect(carriersOf(frequency.phones, ["5550142"])).toBe(2);
    expect(carriersOf(undefined, ["5550142"])).toBe(2);
    expect(carriersOf(undefined, [])).toBe(2);
  });

  it("takes the widest sharing among several shared values", () => {
    const phones = new Map([
      ["1111111", 2],
      ["2222222", 5],
    ]);
    expect(carriersOf(phones, ["1111111", "2222222"])).toBe(5);
  });
});
