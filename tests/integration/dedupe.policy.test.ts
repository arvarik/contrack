// =============================================================================
// Integration Tests — one merge policy, on every path that merges
// =============================================================================
// Three paths can merge two contacts with nobody asked: a scan somebody
// starts, the check every import runs, and the check that runs after a
// contact is added by hand. Each used to carry its own numbers. The import
// path scored a shared phone 0.99 where the scan scored it 0.95, and ran at a
// fixed 0.93 whatever the account had chosen in Settings.
//
// So this file asks the same questions of every path. Does the preset reach
// it? Does it score a pair the way the others do? Does it stop at a household
// on one phone line?
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite, ensureLocalOwner } from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { contactService } from "../../server/services/contactService.ts";
import { dedupeService } from "../../server/services/dedupe/index.ts";
import { dedupeQueue } from "../../server/services/dedupe/jobQueue.ts";
import {
  autoMergeThresholdFor,
  PRESET_THRESHOLDS,
  REVIEW_CEILING,
  type MergePreset,
} from "../../server/services/dedupe/policy.ts";
import { setPreferences } from "../../server/services/userPreferencesService.ts";

const app = makeTestApp();
const scope = scopeForOwnerId(ensureLocalOwner());

interface SuggestionRow {
  contactIdA: string;
  contactIdB: string;
  matchType: string;
  confidence: number;
  reasoning: string;
  status: string;
}

function suggestions(): SuggestionRow[] {
  return sqlite
    .prepare(
      `SELECT contactIdA, contactIdB, matchType, confidence, reasoning, status
         FROM dedupe_suggestions WHERE ownerId = ?
        ORDER BY confidence DESC, matchType`,
    )
    .all(scope.ownerId) as SuggestionRow[];
}

/** Whether any of the contacts ended up merged into another. */
function anyMerged(ids: string[]): boolean {
  const rows = sqlite
    .prepare(
      `SELECT canonicalId FROM contacts WHERE id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids) as { canonicalId: string | null }[];
  return rows.some((r) => r.canonicalId !== null);
}

async function seed(
  contacts: Parameters<typeof contactService.bulkCreateContacts>[1],
): Promise<string[]> {
  const { createdIds } = await contactService.bulkCreateContacts(
    scope,
    contacts,
  );
  return createdIds;
}

function choose(preset: MergePreset): void {
  setPreferences(scope.ownerId, { dedupePreset: preset });
}

/** A quick scan through the service. No threshold named unless given. */
async function scan(threshold?: number): Promise<void> {
  const created = dedupeQueue.createScan(scope, "quick");
  await dedupeService.runScan(
    scope,
    created.scanId,
    "quick",
    "test",
    threshold,
  );
}

/** A quick scan through the API, the way the browser starts one. */
async function scanThroughApi(body: Record<string, unknown>): Promise<void> {
  const started = await request(app).post("/api/dedupe/scan").send(body);
  expect(started.status).toBe(200);
  const finished = await request(app)
    .get("/api/dedupe/status")
    .query({ scanId: started.body.scanId });
  expect(finished.body.phase).toBe("complete");
}

function reset(): void {
  dedupeQueue.__resetForTests();
  sqlite.exec("DELETE FROM dedupe_suggestions");
  sqlite.exec("DELETE FROM dedupe_exclusions");
  sqlite.exec("DELETE FROM dedupe_merge_log");
  sqlite.exec("DELETE FROM contacts");
  choose("default");
}

beforeEach(() => reset());
afterEach(() => choose("default"));

// ---------------------------------------------------------------------------
// The preset reaches every path
// ---------------------------------------------------------------------------

describe("the account's preset is the threshold", () => {
  it("resolves from the stored preference, and defaults to balanced", () => {
    expect(autoMergeThresholdFor(scope)).toBe(PRESET_THRESHOLDS.default);
    choose("conservative");
    expect(autoMergeThresholdFor(scope)).toBe(0.97);
    choose("aggressive");
    expect(autoMergeThresholdFor(scope)).toBe(0.88);
  });

  it("reaches the import", async () => {
    // A shared phone number scores 0.95: enough for the balanced preset and
    // not for the cautious one. The import used to run at 0.93 whatever the
    // account had chosen.
    await seed([{ name: "Robert Castellanos", phones: ["+34 555 867 5309"] }]);
    const [imported] = await seed([
      { name: "Bob Castellanos", phones: ["555-867-5309"] },
    ]);

    choose("conservative");
    const cautious = await dedupeService.runImportScan(
      scope,
      [imported],
      "test",
    );
    expect(cautious.autoMerged).toBe(0);
    expect(cautious.pending).toBe(1);
    expect(suggestions()[0]).toMatchObject({
      matchType: "phone",
      status: "pending",
    });
    expect(suggestions()[0].confidence).toBeCloseTo(0.95, 5);

    sqlite.exec("DELETE FROM dedupe_suggestions");
    choose("default");
    const balanced = await dedupeService.runImportScan(
      scope,
      [imported],
      "test",
    );
    expect(balanced.autoMerged).toBe(1);
    expect(suggestions()[0].status).toBe("auto_merged");
  });

  it("reaches the eager preset in an import too", async () => {
    // A nickname pair scores 0.88, which only the eager preset merges.
    await seed([{ name: "Robert Nakamura" }]);
    const [imported] = await seed([{ name: "Bob Nakamura" }]);

    choose("aggressive");
    const result = await dedupeService.runImportScan(scope, [imported], "test");
    expect(result.autoMerged).toBe(1);
    expect(suggestions()[0]).toMatchObject({
      matchType: "nickname",
      status: "auto_merged",
    });
  });

  it("reaches a scan that names no threshold", async () => {
    const ids = await seed([
      { name: "Robert Castellanos", phones: ["+34 555 867 5309"] },
      { name: "Bob Castellanos", phones: ["555-867-5309"] },
    ]);

    choose("conservative");
    await scan();
    expect(anyMerged(ids)).toBe(false);
    expect(suggestions()[0].status).toBe("pending");

    choose("default");
    await scan();
    expect(anyMerged(ids)).toBe(true);
  });

  it("reaches a scan started through the API, and a request can override it", async () => {
    const ids = await seed([
      { name: "Robert Castellanos", phones: ["+34 555 867 5309"] },
      { name: "Bob Castellanos", phones: ["555-867-5309"] },
    ]);

    // The browser sends the mode and nothing else now.
    choose("conservative");
    await scanThroughApi({ mode: "quick" });
    expect(anyMerged(ids)).toBe(false);

    // A client that names a number for one scan still gets it.
    await scanThroughApi({ mode: "quick", autoMergeThreshold: 0.93 });
    expect(anyMerged(ids)).toBe(true);
  });

  it("reaches the check that runs after a contact is added by hand", async () => {
    const [existing] = await seed([
      { name: "Robert Castellanos", phones: ["+34 555 867 5309"] },
    ]);
    const [added] = await seed([
      { name: "Bob Castellanos", phones: ["555-867-5309"] },
    ]);

    choose("conservative");
    await dedupeService.incrementalDedupeCheck(added, "test");
    expect(anyMerged([existing, added])).toBe(false);
    expect(suggestions()[0].status).toBe("pending");

    sqlite.exec("DELETE FROM dedupe_suggestions");
    choose("default");
    await dedupeService.incrementalDedupeCheck(added, "test");
    expect(anyMerged([existing, added])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The two paths score a pair the same way
// ---------------------------------------------------------------------------

describe("the import and the scan agree on what a match is worth", () => {
  /** Six pairs, one per rule, in a corpus with nothing else in it. */
  async function seedOneOfEach(): Promise<{
    existing: string[];
    imported: string[];
  }> {
    const existing = await seed([
      { name: "Elena Vasquez", emails: ["elena@example.com"] },
      { name: "Robert Castellanos", phones: ["+34 555 867 5309"] },
      { name: "Jonathan Smith", company: "Northwind" },
      { name: "David Lee", company: "Meridian Health" },
      {
        name: "Tobias Lindholm",
        sources: [{ platform: "linkedin" }],
        _sourcePlatform: "linkedin",
      },
      { name: "Margaret Osei" },
    ]);
    const imported = await seed([
      { name: "Elena Vazquez", emails: ["elena@example.com"] },
      { name: "Bob Castellanos", phones: ["555-867-5309"] },
      { name: "Jonathan Smith", company: "Northwind" },
      { name: "David Lee", company: "Ferrous Works" },
      {
        name: "Tobias Lindholm",
        sources: [{ platform: "apple" }],
        _sourcePlatform: "apple",
      },
      { name: "Maggie Osei" },
    ]);
    return { existing, imported };
  }

  function byPair(): Map<string, { matchType: string; confidence: number }> {
    const out = new Map<string, { matchType: string; confidence: number }>();
    for (const row of suggestions()) {
      const key = [row.contactIdA, row.contactIdB].sort().join("|");
      out.set(key, { matchType: row.matchType, confidence: row.confidence });
    }
    return out;
  }

  it("produces the same type and the same confidence for each pair", async () => {
    // Above every confidence in the table, so nothing merges and every pair
    // stays a row to compare. The cautious preset would not do: a shared
    // address is 0.98 and the preset is 0.97.
    const { imported } = await seedOneOfEach();

    await dedupeService.runImportScan(scope, imported, "test", {
      autoMergeThreshold: 0.99,
    });
    const fromImport = byPair();
    expect(fromImport.size).toBe(6);

    sqlite.exec("DELETE FROM dedupe_suggestions");
    await scan(0.99);
    const fromScan = byPair();

    expect([...fromScan.entries()].sort()).toEqual(
      [...fromImport.entries()].sort(),
    );

    const confidences = [...fromImport.values()]
      .map((v) => `${v.matchType}:${v.confidence}`)
      .sort();
    expect(confidences).toEqual([
      "cross_source:0.92",
      "email:0.98",
      "name:0.9",
      "name_company:0.95",
      "nickname:0.88",
      "phone:0.95",
    ]);
  });
});

// ---------------------------------------------------------------------------
// What weakens a match
// ---------------------------------------------------------------------------

describe("a shared number between two different first names", () => {
  it("is reviewed in an import, with the reason written on it", async () => {
    await seed([{ name: "Ada Twin", phones: ["+1 555 0142"] }]);
    const [imported] = await seed([
      { name: "Ben Twin", phones: ["+1 555 0142"] },
    ]);

    const result = await dedupeService.runImportScan(scope, [imported], "test");

    expect(result.autoMerged).toBe(0);
    expect(result.pending).toBe(1);
    const [row] = suggestions();
    expect(row.matchType).toBe("phone");
    expect(row.confidence).toBeCloseTo(REVIEW_CEILING, 5);
    expect(row.reasoning).toBe(
      'Shared phone number. the first names differ ("ada" ↔ "ben"), so review this pair',
    );
  });

  it("is reviewed in a scan, under every preset", async () => {
    const ids = await seed([
      { name: "Ada Twin", phones: ["+1 555 0142"] },
      { name: "Ben Twin", phones: ["+1 555 0142"] },
    ]);

    for (const preset of ["aggressive", "default", "conservative"] as const) {
      choose(preset);
      await scan();
      expect(anyMerged(ids), preset).toBe(false);
      const [row] = suggestions();
      expect(row.status, preset).toBe("pending");
      expect(row.confidence, preset).toBeCloseTo(REVIEW_CEILING, 5);
      expect(row.reasoning).toContain('the first names differ ("ada" ↔ "ben")');
    }
  });

  it("still merges when the names agree by initial or nickname", async () => {
    const [ada] = await seed([{ name: "Ada Twin", phones: ["+1 555 0142"] }]);
    const [initial] = await seed([
      { name: "A. Twin", phones: ["+1 555 0142"] },
    ]);

    const result = await dedupeService.runImportScan(scope, [initial], "test");
    expect(result.autoMerged).toBe(1);
    expect(anyMerged([ada, initial])).toBe(true);
    expect(suggestions()[0].confidence).toBeCloseTo(0.95, 5);
  });

  it("applies to a shared address as well", async () => {
    const ids = await seed([
      { name: "Noor Haddad", emails: ["noor.and.sami@example.net"] },
      { name: "Sami Haddad", emails: ["noor.and.sami@example.net"] },
    ]);

    await scan();

    expect(anyMerged(ids)).toBe(false);
    const [row] = suggestions();
    expect(row.matchType).toBe("email");
    expect(row.confidence).toBeCloseTo(REVIEW_CEILING, 5);
  });
});

describe("a father and a son", () => {
  it("are never merged on a shared number, and the suffix is the reason", async () => {
    const ids = await seed([
      { name: "Robert Hale Sr.", company: "Hale & Sons", phones: ["555 0100"] },
      { name: "Robert Hale Jr.", company: "Hale & Sons", phones: ["555 0100"] },
    ]);

    await scan();

    expect(anyMerged(ids)).toBe(false);
    const [row] = suggestions();
    expect(row.confidence).toBeCloseTo(REVIEW_CEILING, 5);
    expect(row.reasoning).toContain('one is "jr" and the other "sr"');
  });

  it("are not an exact name match on the import path either", async () => {
    // Both normalize to "robert hale" and the import path used to claim
    // that as one name at one company, which is auto-merge territory.
    const [senior] = await seed([
      { name: "Robert Hale Sr.", company: "Hale & Sons" },
    ]);
    const [junior] = await seed([
      { name: "Robert Hale Jr.", company: "Hale & Sons" },
    ]);

    const result = await dedupeService.runImportScan(scope, [junior], "test");

    expect(result.autoMerged).toBe(0);
    expect(anyMerged([senior, junior])).toBe(false);
  });

  it("asks, rather than merging, when only one side carries a suffix", async () => {
    const [plain] = await seed([
      { name: "Arthur Pemberton", company: "Pemberton Trust" },
    ]);
    const [third] = await seed([
      { name: "Arthur Pemberton III", company: "Pemberton Trust" },
    ]);

    const result = await dedupeService.runImportScan(scope, [third], "test");

    expect(result.autoMerged).toBe(0);
    expect(result.pending).toBe(1);
    expect(anyMerged([plain, third])).toBe(false);
    expect(suggestions()[0].matchType).toBe("name");
    expect(suggestions()[0].confidence).toBeCloseTo(0.9, 5);
  });
});

describe("a value many contacts carry", () => {
  it("weakens a shared number by three points per extra carrier, on both paths", async () => {
    // A household of three on one landline, with three names that do not
    // disagree with each other. Nothing but the count says "shared line".
    const [a, b] = await seed([
      { name: "Ada Twin", phones: ["+1 555 0142"] },
      { name: "A. Twin", phones: ["+1 555 0142"] },
    ]);
    const [c] = await seed([{ name: "Ada Twin", phones: ["+1 555 0142"] }]);

    const result = await dedupeService.runImportScan(scope, [c], "test");
    expect(result.autoMerged).toBe(0);
    expect(result.pending).toBe(2);
    for (const row of suggestions()) {
      expect(row.confidence).toBeCloseTo(0.92, 5);
      expect(row.reasoning).toContain("3 contacts carry this number");
    }
    expect(anyMerged([a, b, c])).toBe(false);

    sqlite.exec("DELETE FROM dedupe_suggestions");
    await scan();
    expect(anyMerged([a, b, c])).toBe(false);
    expect(suggestions()).toHaveLength(3);
    for (const row of suggestions()) {
      expect(row.confidence).toBeCloseTo(0.92, 5);
    }
  });

  it("lets three records of one address still merge under the balanced preset", async () => {
    // One person exported three times is the ordinary case for an address,
    // and 0.98 less 0.03 clears 0.93.
    await seed([{ name: "Ravi Krishnan", emails: ["ravi@example.com"] }]);
    const imported = await seed([
      { name: "Ravi Krishnan", emails: ["ravi@example.com"] },
      { name: "R Krishnan", emails: ["ravi@example.com"] },
    ]);

    const result = await dedupeService.runImportScan(scope, imported, "test");

    expect(result.autoMerged).toBe(2);
    for (const row of suggestions()) {
      expect(row.confidence).toBeCloseTo(0.95, 5);
      expect(row.reasoning).toContain("3 contacts carry this address");
    }
  });

  it("weakens a common name at one company below the balanced preset", async () => {
    const ids = await seed([
      { name: "John Smith", company: "Northwind" },
      { name: "John Smith", company: "Northwind" },
      { name: "John Smith", company: "Northwind" },
    ]);

    await scan();

    expect(anyMerged(ids)).toBe(false);
    expect(suggestions()).toHaveLength(3);
    for (const row of suggestions()) {
      expect(row.matchType).toBe("name_company");
      expect(row.confidence).toBeCloseTo(0.92, 5);
      expect(row.reasoning).toContain("3 contacts carry this name");
    }
  });
});
