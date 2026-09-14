// =============================================================================
// Unit & Bounded Search Tests — Approximate Name Matching
// =============================================================================

import { beforeEach, describe, expect, it } from "vitest";
import { sqlite, ensureLocalOwner } from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import {
  findApproximateNameMatches,
  APPROXIMATE_NAME_THRESHOLD,
} from "../../server/services/search/approximateName.ts";
import { lexicalSearch } from "../../server/services/search/lexical.ts";
import { doubleMetaphone } from "../../server/utils/nlp/phonetics.ts";
import { searchService } from "../../server/services/searchService.ts";

let ownerId: string;
const scope = () => scopeForOwnerId(ownerId);

function insertContact(
  id: string,
  name: string,
  extra: {
    ownerId?: string;
    role?: string;
    isGhost?: number;
    isArchived?: number;
    canonicalId?: string | null;
    deletedAt?: string | null;
  } = {},
) {
  const owner = extra.ownerId ?? ownerId;
  const phonetic = doubleMetaphone(name).primary;
  sqlite
    .prepare(
      `INSERT INTO contacts (id, name, phoneticHash, ownerId, role, isGhost, isArchived, canonicalId, deletedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      name,
      phonetic,
      owner,
      extra.role ?? null,
      extra.isGhost ?? 0,
      extra.isArchived ?? 0,
      extra.canonicalId ?? null,
      extra.deletedAt ?? null,
    );
}

beforeEach(() => {
  ownerId = ensureLocalOwner();
  sqlite.prepare("DELETE FROM contacts").run();
});

describe("approximateName service", () => {
  it("finds approximate matches for single-character typos and transpositions", () => {
    insertContact("c1", "Jonathan Smith");
    insertContact("c2", "Bartholomew Quigley");

    // Single-character vowel substitution
    const res1 = findApproximateNameMatches(scope(), "Jonathon Smyth");
    expect(res1).toHaveLength(1);
    expect(res1[0].contactId).toBe("c1");
    expect(res1[0].approximate).toBe(true);
    expect(res1[0].matchType).toBe("approximate");
    expect(res1[0].score).toBeGreaterThan(0.9);

    // Adjacent character transposition ("Quigley" vs "Quigely")
    const res2 = findApproximateNameMatches(scope(), "Bartholomew Quigely");
    expect(res2).toHaveLength(1);
    expect(res2[0].contactId).toBe("c2");
    expect(res2[0].score).toBeGreaterThan(0.9);
  });

  it("finds phonetic variants (e.g. Gaelic and Anglicized names)", () => {
    insertContact("c1", "Siobhan Murphy");
    insertContact("c2", "Aoife Gallagher");

    const res1 = findApproximateNameMatches(scope(), "Shivaun Murphey");
    expect(res1).toHaveLength(1);
    expect(res1[0].contactId).toBe("c1");
    expect(res1[0].score).toBeGreaterThan(APPROXIMATE_NAME_THRESHOLD);

    const res2 = findApproximateNameMatches(scope(), "Eefa Gallacher");
    expect(res2).toHaveLength(1);
    expect(res2[0].contactId).toBe("c2");
    expect(res2[0].score).toBeGreaterThan(APPROXIMATE_NAME_THRESHOLD);
  });

  it("handles names with apostrophes and hyphens", () => {
    insertContact("c1", "Padraig O'Callaghan");

    const res = findApproximateNameMatches(scope(), "Porrig O'Callahan");
    expect(res).toHaveLength(1);
    expect(res[0].contactId).toBe("c1");
  });

  it("respects limit and excludeIds arguments", () => {
    insertContact("c1", "Katherine O'Connell");
    insertContact("c2", "Katherine Ashworth");

    // Excluding c1 returns only c2
    const res1 = findApproximateNameMatches(
      scope(),
      "Katharine Oconnel",
      10,
      null,
      new Set(["c1"]),
    );
    expect(res1.some((r) => r.contactId === "c1")).toBe(false);

    // Limit 1 returns only top match
    const res2 = findApproximateNameMatches(scope(), "Katharine Oconnel", 1);
    expect(res2).toHaveLength(1);
    expect(res2[0].contactId).toBe("c1");
  });

  it("respects allowedIds filter", () => {
    insertContact("c1", "Jonathan Smith");
    insertContact("c2", "Jonathan Taylor");

    const res = findApproximateNameMatches(
      scope(),
      "Jonathon",
      10,
      new Set(["c2"]),
    );
    expect(res).toHaveLength(1);
    expect(res[0].contactId).toBe("c2");
  });

  it("excludes inactive, ghost, archived, merged, and deleted contacts", () => {
    insertContact("active", "Jonathan Smith");
    insertContact("archived", "Jonathon Smyth", { isArchived: 1 });
    insertContact("ghost", "Jonathon Smyth", { isGhost: 1 });
    insertContact("merged", "Jonathon Smyth", { canonicalId: "active" });
    insertContact("deleted", "Jonathon Smyth", {
      deletedAt: new Date().toISOString(),
    });

    const res = findApproximateNameMatches(scope(), "Jonathon Smyth");
    expect(res).toHaveLength(1);
    expect(res[0].contactId).toBe("active");
  });

  it("enforces tenant isolation across scopes", () => {
    const otherOwnerId = "00000000-0000-0000-0000-000000000099";
    sqlite
      .prepare(
        "INSERT INTO users (id, email, username, passwordHash) VALUES (?, ?, ?, ?)",
      )
      .run(otherOwnerId, "other@test.com", "otheruser", "hash");

    insertContact("c_local", "Jonathan Smith", { ownerId });
    insertContact("c_other", "Jonathan Smith", { ownerId: otherOwnerId });

    const res = findApproximateNameMatches(scope(), "Jonathon Smyth");
    expect(res.map((r) => r.contactId)).toEqual(["c_local"]);
  });

  it("discards matches below similarity threshold", () => {
    insertContact("c1", "Alexander Hamilton");

    // Unrelated query produces 0 matches
    const res = findApproximateNameMatches(scope(), "Zoltan Varga");
    expect(res).toEqual([]);
  });
});

describe("lexicalSearch with approximate fallback", () => {
  it("keeps exact matches strictly first and labels approximate matches", () => {
    insertContact("exact", "John Smith");
    insertContact("typo", "Jonathan Smyth");

    // Query "John Smith": "exact" is an exact FTS match
    const resExact = lexicalSearch(scope(), "John Smith");
    expect(resExact[0].contactId).toBe("exact");
    expect(resExact[0].approximate).toBeFalsy();

    // Query "Jonathon Smyth": "typo" has 0 exact matches, returns typo match as approximate
    const resTypo = lexicalSearch(scope(), "Jonathon Smyth");
    expect(resTypo[0].contactId).toBe("typo");
    expect(resTypo[0].approximate).toBe(true);
    expect(resTypo[0].matchType).toBe("approximate");
  });

  it("hydrates searchFts matches with approximate and matchType properties", () => {
    insertContact("c1", "Jonathan Smith");

    const results = searchService.searchFts(scope(), "Jonathon Smyth");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("c1");
    expect(results[0].name).toBe("Jonathan Smith");
    expect(results[0].approximate).toBe(true);
    expect(results[0].matchType).toBe("approximate");
  });
});
