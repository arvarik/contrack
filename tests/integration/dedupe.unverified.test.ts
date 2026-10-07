// Integration: a pair no model checks.
// The checks after an import and after a contact is added never ask a model,
// so they keep only vector neighbors at 0.75 or more, at 0.7 of the score, as
// a scan without a provider does. Otherwise one import fills the review with
// people who share only an employer and a first name.
//
// The vector store is stubbed: integration runs with no embedder, and what is
// under test is what the check does with a neighbor, not the KNN.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { neighbors } = vi.hoisted(() => ({
  /** A contact's id to the neighbors its KNN answers with. */
  neighbors: new Map<string, { contactId: string; distance: number }[]>(),
}));

vi.mock("../../server/services/dedupe/embeddings.ts", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../../server/services/dedupe/embeddings.ts")
    >();
  return {
    ...actual,
    isEmbeddingAvailable: () => true,
    getEmbedding: (id: string) =>
      neighbors.has(id) ? new Float32Array([1]) : null,
    findNearestNeighbors: (
      _scope: unknown,
      _vector: unknown,
      _limit: unknown,
      excludeId?: string,
    ) => neighbors.get(excludeId ?? "") ?? [],
  };
});

import { makeTestApp } from "./helpers.ts";
import { sqlite, ensureLocalOwner } from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { contactService } from "../../server/services/contactService.ts";
import { dedupeService } from "../../server/services/dedupe/index.ts";

makeTestApp();
const scope = scopeForOwnerId(ensureLocalOwner());

/** The distance whose similarity is `similarity`: cosine is 1 - d² / 2. */
const distanceFor = (similarity: number) => Math.sqrt(2 * (1 - similarity));

async function seedPair(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  similarity: number,
): Promise<[string, string]> {
  const { createdIds } = await contactService.bulkCreateContacts(scope, [
    a,
    b,
  ] as Parameters<typeof contactService.bulkCreateContacts>[1]);
  const [idA, idB] = createdIds;
  neighbors.set(idB, [{ contactId: idA, distance: distanceFor(similarity) }]);
  return [idA, idB];
}

function suggestions() {
  return sqlite
    .prepare(
      `SELECT matchType, confidence, reasoning, caveat, status
         FROM dedupe_suggestions WHERE ownerId = ?`,
    )
    .all(scope.ownerId) as {
    matchType: string;
    confidence: number;
    reasoning: string;
    caveat: string | null;
    status: string;
  }[];
}

beforeEach(() => {
  neighbors.clear();
  sqlite.exec("DELETE FROM dedupe_suggestions");
  sqlite.exec("DELETE FROM dedupe_merge_log");
  sqlite.exec("DELETE FROM contacts");
});

describe("the check after a contact is added", () => {
  it("drops two people who share only a first name and an employer", async () => {
    // Profiles that read alike, one employer, one first name. This scored
    // 0.74 and waited in the review at that.
    const [, added] = await seedPair(
      { name: "Andrew Pike", company: "Northwind" },
      { name: "Andrew Lowell", company: "Northwind" },
      0.94,
    );

    await dedupeService.incrementalDedupeCheck(added, "test");

    expect(suggestions()).toEqual([]);
  });

  it("keeps a close pair, weighed down, for a person to decide", async () => {
    const [, added] = await seedPair(
      { name: "Jonathan Smyth", company: "Litware", location: "Denver, CO" },
      { name: "Jonathon Smith", company: "Litware", location: "Denver" },
      0.94,
    );

    await dedupeService.incrementalDedupeCheck(added, "test");

    const [row] = suggestions();
    expect(row).toMatchObject({
      matchType: "fuzzy",
      status: "pending",
      reasoning:
        "Similar names, same company and city, profiles that read alike",
      caveat: null,
    });
    // 0.7 of its score: below every preset, so it never merges unasked.
    expect(row.confidence).toBeLessThan(0.75);
    expect(row.confidence).toBeGreaterThan(0.5);
  });
});

describe("the check after an import", () => {
  it("applies the same floor", async () => {
    const [, imported] = await seedPair(
      { name: "Andrew Pike", company: "Northwind" },
      { name: "Andrew Lowell", company: "Northwind" },
      0.94,
    );

    const result = await dedupeService.runImportScan(scope, [imported], "test");

    expect(result.pending).toBe(0);
    expect(suggestions()).toEqual([]);
  });
});
