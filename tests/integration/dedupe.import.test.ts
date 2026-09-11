// =============================================================================
// Integration Tests — one scan after a bulk import
// =============================================================================
// The import used to check each new contact on its own, and each of those
// checks normalized the whole account and built a whole pass context. An
// import of `n` contacts into a corpus of `m` did about `n × m` work, and
// almost all of it was the same work done again.
//
// Two things have to hold for the replacement to be worth having.
//
// 1. IT COSTS ONE PASS. The corpus is normalized once per import, whatever
//    the size of the import. This is asserted by counting, not by timing, so
//    it cannot pass on a fast machine and fail on a slow one. The wall clock
//    test at the end is a second opinion with a deliberately loose bound.
//
// 2. IT FINDS THE SAME DUPLICATES. A rearrangement of the work that quietly
//    changed what counts as a duplicate would be a much worse bug than the
//    slowness it fixed. Each matcher has a case below, at the confidence it
//    is supposed to carry.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// Counting wrappers around the two corpus-wide loads. Both stay real: what is
// being measured is how often they are called, and a stub would measure the
// stub.
const calls = vi.hoisted(() => ({ normalizeContacts: 0, buildPassContext: 0 }));

vi.mock(
  "../../server/services/dedupe/normalization.ts",
  async (importActual) => {
    const actual =
      await importActual<
        typeof import("../../server/services/dedupe/normalization.ts")
      >();
    return {
      ...actual,
      normalizeContacts: (
        ...args: Parameters<typeof actual.normalizeContacts>
      ) => {
        calls.normalizeContacts++;
        return actual.normalizeContacts(...args);
      },
    };
  },
);

vi.mock("../../server/services/dedupe/context.ts", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../../server/services/dedupe/context.ts")
    >();
  return {
    ...actual,
    buildPassContext: (...args: Parameters<typeof actual.buildPassContext>) => {
      calls.buildPassContext++;
      return actual.buildPassContext(...args);
    },
  };
});

const { makeTestApp } = await import("./helpers.ts");
const { sqlite, ensureLocalOwner } = await import("../../server/db.ts");
const { scopeForOwnerId } = await import("../../server/tenancy/scope.ts");
const { contactService } =
  await import("../../server/services/contactService.ts");
const { dedupeService } = await import("../../server/services/dedupe/index.ts");

const app = makeTestApp();
const scope = scopeForOwnerId(ensureLocalOwner());

interface SuggestionRow {
  contactIdA: string;
  contactIdB: string;
  matchType: string;
  confidence: number;
  status: string;
}

function suggestions(): SuggestionRow[] {
  return sqlite
    .prepare(
      `SELECT contactIdA, contactIdB, matchType, confidence, status
         FROM dedupe_suggestions WHERE ownerId = ?
        ORDER BY confidence DESC, matchType`,
    )
    .all(scope.ownerId) as SuggestionRow[];
}

function canonicalIdOf(contactId: string): string | null {
  const row = sqlite
    .prepare("SELECT canonicalId FROM contacts WHERE id = ?")
    .get(contactId) as { canonicalId: string | null } | undefined;
  return row?.canonicalId ?? null;
}

/** Write contacts the way an import does, and return their ids. */
async function seed(
  contacts: Parameters<typeof contactService.bulkCreateContacts>[1],
): Promise<string[]> {
  const { createdIds } = await contactService.bulkCreateContacts(
    scope,
    contacts,
  );
  return createdIds;
}

/** Empty every table this file writes to, between tests. */
function reset(): void {
  sqlite.exec("DELETE FROM dedupe_suggestions");
  sqlite.exec("DELETE FROM dedupe_exclusions");
  sqlite.exec("DELETE FROM dedupe_merge_log");
  sqlite.exec("DELETE FROM contacts");
  calls.normalizeContacts = 0;
  calls.buildPassContext = 0;
}

beforeEach(() => reset());

describe("dedupeService.runImportScan, the cost", () => {
  it("normalizes the corpus once for an import of one", async () => {
    await seed([{ name: "Existing Person" }]);
    const imported = await seed([{ name: "New Person" }]);
    calls.normalizeContacts = 0;

    await dedupeService.runImportScan(scope, imported, "test");

    expect(calls.normalizeContacts).toBe(1);
  });

  it("normalizes the corpus once for an import of forty", async () => {
    await seed(
      Array.from({ length: 60 }, (_, i) => ({ name: `Existing ${i}` })),
    );
    const imported = await seed(
      Array.from({ length: 40 }, (_, i) => ({ name: `Imported ${i}` })),
    );
    calls.normalizeContacts = 0;

    await dedupeService.runImportScan(scope, imported, "test");

    // The number that matters. Forty before this change.
    expect(calls.normalizeContacts).toBe(1);
  });

  it("never builds a scan pass context", async () => {
    await seed([{ name: "Existing Person" }]);
    const imported = await seed(
      Array.from({ length: 10 }, (_, i) => ({ name: `Imported ${i}` })),
    );
    calls.buildPassContext = 0;

    await dedupeService.runImportScan(scope, imported, "test");

    // `buildPassContext` loads and normalizes the account twice over, and the
    // per-contact check called it once per contact for one map out of it.
    expect(calls.buildPassContext).toBe(0);
  });

  it("does nothing at all for an empty import", async () => {
    await seed([{ name: "Existing Person" }]);
    calls.normalizeContacts = 0;

    const result = await dedupeService.runImportScan(scope, [], "test");

    expect(calls.normalizeContacts).toBe(0);
    expect(result).toEqual({
      autoMerged: 0,
      pending: 0,
      matchedIds: new Set(),
    });
  });
});

describe("dedupeService.runImportScan, what it finds", () => {
  it("auto-merges an imported contact that shares an email address", async () => {
    const [existing] = await seed([
      { name: "Margaret Ellington", emails: ["peggy@example.com"] },
    ]);
    const [imported] = await seed([
      { name: "Peggy Ellington", emails: ["peggy@example.com"] },
    ]);

    const result = await dedupeService.runImportScan(scope, [imported], "test");

    expect(result.autoMerged).toBe(1);
    expect(result.pending).toBe(0);
    expect(result.matchedIds).toEqual(new Set([imported]));

    const rows = suggestions();
    expect(rows).toHaveLength(1);
    expect(rows[0].matchType).toBe("email");
    expect(rows[0].confidence).toBeCloseTo(0.99, 5);
    expect(rows[0].status).toBe("auto_merged");

    // One of the two now points at the other. Which one is whichever carries
    // more, and that is the merge service's decision, not this one's.
    const merged = [existing, imported].filter((id) => canonicalIdOf(id));
    expect(merged).toHaveLength(1);
  });

  it("auto-merges an imported contact that shares a phone number", async () => {
    await seed([{ name: "Robert Castellanos", phones: ["+34 555 867 5309"] }]);
    const [imported] = await seed([
      { name: "Bob Castellanos", phones: ["555-867-5309"] },
    ]);

    const result = await dedupeService.runImportScan(scope, [imported], "test");

    expect(result.autoMerged).toBe(1);
    const rows = suggestions();
    expect(rows[0].matchType).toBe("phone");
    expect(rows[0].confidence).toBeCloseTo(0.99, 5);
  });

  it("suggests an exact name match rather than merging it", async () => {
    await seed([{ name: "Jonathan Smith", company: "Northwind" }]);
    const [imported] = await seed([
      { name: "Jonathan Smith", company: "Ferrous Works" },
    ]);

    const result = await dedupeService.runImportScan(scope, [imported], "test");

    // 0.92 is under the 0.93 auto-merge threshold on purpose: two people can
    // share a name, and merging them would lose one of them.
    expect(result.autoMerged).toBe(0);
    expect(result.pending).toBe(1);
    const rows = suggestions();
    expect(rows[0].matchType).toBe("name");
    expect(rows[0].confidence).toBeCloseTo(0.92, 5);
    expect(rows[0].status).toBe("pending");
    expect(canonicalIdOf(imported)).toBeNull();
  });

  it("suggests a nickname match", async () => {
    await seed([{ name: "Robert Nakamura" }]);
    const [imported] = await seed([{ name: "Bob Nakamura" }]);

    const result = await dedupeService.runImportScan(scope, [imported], "test");

    expect(result.pending).toBe(1);
    const rows = suggestions();
    expect(rows[0].matchType).toBe("nickname");
    expect(rows[0].confidence).toBeCloseTo(0.88, 5);
  });

  it("finds two duplicates inside the same import", async () => {
    const imported = await seed([
      { name: "Elena Vasquez", emails: ["elena@example.com"] },
      { name: "Elena Vazquez", emails: ["elena@example.com"] },
    ]);

    const result = await dedupeService.runImportScan(scope, imported, "test");

    // A spreadsheet with the same person on two rows is the ordinary case,
    // and the pair is reported once rather than once from each end.
    expect(result.autoMerged).toBe(1);
    expect(suggestions()).toHaveLength(1);
    expect(result.matchedIds).toEqual(new Set(imported));
  });

  it("leaves a pair the account has already separated alone", async () => {
    const [existing] = await seed([{ name: "Jonathan Smith" }]);
    const [imported] = await seed([{ name: "Jonathan Smith" }]);
    const [a, b] =
      existing < imported ? [existing, imported] : [imported, existing];
    sqlite
      .prepare(
        `INSERT INTO dedupe_exclusions (contactIdA, contactIdB, ownerId)
         VALUES (?, ?, ?)`,
      )
      .run(a, b, scope.ownerId);

    const result = await dedupeService.runImportScan(scope, [imported], "test");

    expect(result.pending).toBe(0);
    expect(suggestions()).toHaveLength(0);
  });

  it("reports nothing for an import with no duplicates in it", async () => {
    await seed([{ name: "Hanna Virtanen" }, { name: "Diego Ferreira" }]);
    const imported = await seed([
      { name: "Grace Okonkwo" },
      { name: "Felix Bergstrom" },
    ]);

    const result = await dedupeService.runImportScan(scope, imported, "test");

    expect(result).toEqual({
      autoMerged: 0,
      pending: 0,
      matchedIds: new Set(),
    });
    expect(suggestions()).toHaveLength(0);
  });

  it("points every merge at the survivor rather than building a chain", async () => {
    const [existing] = await seed([
      { name: "Ravi Krishnan", emails: ["ravi@example.com"] },
    ]);
    const imported = await seed([
      { name: "Ravi Krishnan", emails: ["ravi@example.com"] },
      { name: "R Krishnan", emails: ["ravi@example.com"] },
    ]);
    const all = [existing, ...imported];

    const result = await dedupeService.runImportScan(scope, imported, "test");

    // Three rows for one person collapse to one, and the other two point
    // straight at it. A chain, where one merged contact points at another
    // merged contact, has no reader: every screen follows a single hop.
    expect(result.autoMerged).toBe(2);
    const survivors = all.filter((id) => canonicalIdOf(id) === null);
    expect(survivors).toHaveLength(1);
    for (const id of all.filter((c) => c !== survivors[0])) {
      expect(canonicalIdOf(id)).toBe(survivors[0]);
    }
  });

  it("never suggests a contact that was merged away earlier in the same import", async () => {
    await seed([{ name: "Elena Vasquez", emails: ["elena@example.com"] }]);
    // The first imported row merges with the existing one on the shared
    // email. The second matches both of them by name, at a confidence that
    // makes a suggestion rather than a merge — and a suggestion naming the
    // contact that just disappeared is a row in somebody's review queue that
    // offers to merge a contact with nothing.
    const imported = await seed([
      { name: "Elena Vasquez", emails: ["elena@example.com"] },
      { name: "Elena Vasquez" },
    ]);

    await dedupeService.runImportScan(scope, imported, "test");

    const pending = suggestions().filter((row) => row.status === "pending");
    expect(pending.length).toBeGreaterThan(0);
    for (const row of pending) {
      expect(canonicalIdOf(row.contactIdA)).toBeNull();
      expect(canonicalIdOf(row.contactIdB)).toBeNull();
    }
  });

  it("writes one suggestion for a pair, not one from each end", async () => {
    // Two rows, same name, nothing else. The name match is under the
    // auto-merge threshold, so neither contact disappears and both are still
    // candidates when the second one is checked. Whichever is reached first
    // claims the pair.
    const imported = await seed([
      { name: "Tomas Lindqvist" },
      { name: "Tomas Lindqvist" },
    ]);

    const result = await dedupeService.runImportScan(scope, imported, "test");

    expect(result.pending).toBe(1);
    expect(suggestions()).toHaveLength(1);
  });
});

describe("POST /api/contacts/bulk with a stream", () => {
  /** The terminal `done` event of an SSE import. */
  async function streamImport(body: object[]): Promise<{
    imported: number;
    autoMerged: number;
    needsReview: number;
    newUnique: number;
  }> {
    const res = await request(app)
      .post("/api/contacts/bulk")
      .set("Accept", "text/event-stream")
      .send(body);
    expect(res.status).toBe(200);
    const summary = res.text
      .split("\n\n")
      .filter(Boolean)
      .map((chunk) => JSON.parse(chunk.replace(/^data: /, "")))
      .find((event) => event.done);
    return summary.summary;
  }

  it("reports the duplicates the shared scan found", async () => {
    await seed([{ name: "Margaret Ellington", emails: ["peggy@example.com"] }]);

    const summary = await streamImport([
      { name: "Peggy Ellington", emails: ["peggy@example.com"] },
      { name: "Somebody Else" },
    ]);

    expect(summary).toEqual({
      imported: 2,
      autoMerged: 1,
      needsReview: 0,
      newUnique: 1,
    });
  });

  it("finds a nickname, which the matching it used to carry could not", async () => {
    await seed([{ name: "Robert Nakamura" }]);

    // The streaming branch had its own two hundred and fifty lines of
    // matching: exact name, email, phone, and nothing else. The same import
    // through the JSON branch found this and the stream did not, so what
    // counted as a duplicate depended on the Accept header.
    const summary = await streamImport([{ name: "Bob Nakamura" }]);

    expect(summary.needsReview).toBe(1);
    expect(suggestions()[0].matchType).toBe("nickname");
  });

  it("asks about two people with the same name instead of merging them", async () => {
    const [existing] = await seed([
      { name: "David Lee", company: "Northwind Logistics" },
    ]);

    const summary = await streamImport([
      { name: "David Lee", company: "Meridian Health Trust" },
    ]);

    // A DELIBERATE CHANGE. The matching this branch used to carry scored an
    // exact name match at 0.95 and merged it, on the reasoning that a name
    // that already exists is "almost certainly a duplicate". Two people can
    // share a name, and a merge is how one of them stops existing. The other
    // import path has always scored it 0.92 and asked, and now both do.
    expect(summary.autoMerged).toBe(0);
    expect(summary.needsReview).toBe(1);
    expect(canonicalIdOf(existing)).toBeNull();
    expect(suggestions()[0].confidence).toBeCloseTo(0.92, 5);
  });
});

describe("dedupeService.runImportScan, the wall clock", () => {
  it("imports one hundred contacts into a corpus of four hundred in under five seconds", async () => {
    await seed(
      Array.from({ length: 400 }, (_, i) => ({
        name: `Existing Person ${i}`,
        company: `Company ${i % 40}`,
        emails: [`existing${i}@example.com`],
      })),
    );
    const imported = await seed(
      Array.from({ length: 100 }, (_, i) => ({
        name: `Imported Person ${i}`,
        company: `Company ${i % 40}`,
        emails: [`imported${i}@example.com`],
      })),
    );
    calls.normalizeContacts = 0;

    const started = Date.now();
    await dedupeService.runImportScan(scope, imported, "test");
    const elapsed = Date.now() - started;

    // The bound is loose on purpose. What it is really guarding is the shape:
    // one hundred normalizations of a five hundred contact corpus is seconds
    // of work, and one is milliseconds, so a return to the per-contact loop
    // would fail this by a wide margin rather than by a hair. A slow machine
    // does not get near it.
    expect(calls.normalizeContacts).toBe(1);
    expect(elapsed).toBeLessThan(5_000);
  }, 60_000);
});
