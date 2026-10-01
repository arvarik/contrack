// =============================================================================
// Integration: int8 search vectors
// =============================================================================
// `search_embeddings` stores each component as one signed byte, at one scale
// for the whole table. The boot migration turns a float table into int8
// without re-embedding anything, and it must keep every row, the partition
// key and the three status columns. The KNN must still find the same
// neighbours, up to rounding. The scale must be set once, from all the
// vectors of the first write, and start over with a new model.
// =============================================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const { makeTestApp } = await import("./helpers.ts");
const { sqlite, rebuildVecTable, vecTableDdl, VEC_METADATA_SQL } =
  await import("../../server/db.ts");
const {
  findSearchNeighbors,
  rebuildSearchEmbeddingTable,
  searchVectorScale,
  upsertSearchEmbeddings,
} = await import("../../server/services/search/vectorIndex.ts");
const { VECTOR_SCALE_KEY, floatsOf, quantize, scaleFor } =
  await import("../../server/services/search/vectorScale.ts");
const { clearSettingsCache, deleteSetting } =
  await import("../../server/services/settingsService.ts");
const { createActor, resetAccounts } = await import("./tenancy/helpers.ts");
const { loadFixture } = await import("../eval/harness.ts");
const { scopeForOwnerId } = await import("../../server/tenancy/scope.ts");

const app = makeTestApp();
let owner: string;
let otherOwner: string;

beforeAll(async () => {
  resetAccounts();
  owner = (await createActor(app, { username: "vectorsowner" })).user.id;
  otherOwner = (await createActor(app, { username: "vectorsother" })).user.id;
});

afterAll(() => resetAccounts());

beforeEach(() => {
  sqlite.prepare("DELETE FROM search_embeddings").run();
  sqlite.prepare("DELETE FROM contacts").run();
  deleteSetting(VECTOR_SCALE_KEY);
});

/** A contact row, with no vector yet. */
function contact(
  id: string,
  ownerId = owner,
  state: Partial<{
    isGhost: number;
    isArchived: number;
    deletedAt: string;
    canonicalId: string;
  }> = {},
): void {
  sqlite
    .prepare(
      `INSERT INTO contacts (id, name, ownerId, isGhost, isArchived, deletedAt, canonicalId)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      `Person ${id}`,
      ownerId,
      state.isGhost ?? 0,
      state.isArchived ?? 0,
      state.deletedAt ?? null,
      state.canonicalId ?? null,
    );
}

/** A deterministic vector with components between -0.3 and 0.3. */
function spread(seed: number): Float32Array {
  const v = new Float32Array(384);
  for (let i = 0; i < 384; i++) v[i] = Math.sin(seed * 7.1 + i * 0.37) * 0.3;
  return v;
}

describe("the boot migration from float", () => {
  /** search_embeddings as it was before int8: the same shape, FLOAT[384]. */
  function floatTable(): void {
    sqlite.exec("DROP TABLE search_embeddings");
    sqlite.exec(vecTableDdl("search_embeddings", 384, "float"));
  }

  afterAll(() => {
    // Put the table every other test expects back.
    sqlite.exec("DROP TABLE IF EXISTS search_embeddings");
    rebuildSearchEmbeddingTable(384);
  });

  it("keeps every row, the partition key and the status columns", () => {
    floatTable();
    contact("active");
    contact("archived", owner, { isArchived: 1 });
    contact("trashed", owner, { deletedAt: "2026-01-01T00:00:00.000Z" });
    contact("ghost", owner, { isGhost: 1 });
    contact("merged", owner, { canonicalId: "active" });
    contact("theirs", otherOwner);
    const ids = ["active", "archived", "trashed", "ghost", "merged", "theirs"];
    const floats = new Map(ids.map((id, i) => [id, spread(i + 1)]));
    const insert = sqlite.prepare(
      `INSERT INTO search_embeddings (contactId, ownerId, isGhost, isArchived, active, embedding)
       SELECT c.id, c.ownerId, ${VEC_METADATA_SQL}, ? FROM contacts c WHERE c.id = ?`,
    );
    for (const [id, vector] of floats)
      insert.run(Buffer.from(vector.buffer), id);

    const result = rebuildVecTable("search_embeddings");

    const scale = scaleFor(floats.values())!;
    expect(result).toEqual({
      copied: 6,
      dropped: 0,
      dimension: 384,
      element: "int8",
      scale,
    });
    const ddl = (
      sqlite
        .prepare(
          "SELECT sql FROM sqlite_master WHERE name = 'search_embeddings'",
        )
        .get() as { sql: string }
    ).sql;
    expect(ddl).toContain("ownerId TEXT PARTITION KEY");
    for (const column of ["isGhost", "isArchived", "active"])
      expect(ddl).toMatch(new RegExp(`\\b${column}\\s+INTEGER`));
    expect(ddl).toContain("embedding INT8[384]");

    // Every row, under its owner, with its status.
    expect(
      sqlite
        .prepare(
          "SELECT contactId, ownerId, isGhost, isArchived, active FROM search_embeddings ORDER BY contactId",
        )
        .all(),
    ).toEqual([
      {
        contactId: "active",
        ownerId: owner,
        isGhost: 0,
        isArchived: 0,
        active: 1,
      },
      {
        contactId: "archived",
        ownerId: owner,
        isGhost: 0,
        isArchived: 1,
        active: 1,
      },
      {
        contactId: "ghost",
        ownerId: owner,
        isGhost: 1,
        isArchived: 0,
        active: 1,
      },
      {
        contactId: "merged",
        ownerId: owner,
        isGhost: 0,
        isArchived: 0,
        active: 0,
      },
      {
        contactId: "theirs",
        ownerId: otherOwner,
        isGhost: 0,
        isArchived: 0,
        active: 1,
      },
      {
        contactId: "trashed",
        ownerId: owner,
        isGhost: 0,
        isArchived: 0,
        active: 0,
      },
    ]);

    // Each vector is its float quantized at the one scale: 384 bytes, a
    // quarter of 1,536, and nothing re-embedded.
    for (const [id, vector] of floats) {
      const stored = (
        sqlite
          .prepare(
            "SELECT embedding FROM search_embeddings WHERE contactId = ?",
          )
          .get(id) as { embedding: Buffer }
      ).embedding;
      expect(stored.length).toBe(384);
      expect(stored.equals(quantize(vector, scale)), id).toBe(true);
    }

    // The scale is stored for every later write and query. At boot the
    // settings cache is empty; here it is dropped by hand.
    clearSettingsCache();
    expect(searchVectorScale()).toBe(scale);
  });

  it("keeps the search results: the same contact, only the owner's, only visible ones", () => {
    floatTable();
    contact("near");
    contact("far");
    contact("near-archived", owner, { isArchived: 1 });
    contact("near-theirs", otherOwner);
    const query = spread(1);
    const vectors: [string, Float32Array][] = [
      ["near", spread(1.01)],
      ["far", spread(4)],
      ["near-archived", spread(1)],
      ["near-theirs", spread(1)],
    ];
    const insert = sqlite.prepare(
      `INSERT INTO search_embeddings (contactId, ownerId, isGhost, isArchived, active, embedding)
       SELECT c.id, c.ownerId, ${VEC_METADATA_SQL}, ? FROM contacts c WHERE c.id = ?`,
    );
    for (const [id, vector] of vectors)
      insert.run(Buffer.from(vector.buffer), id);

    rebuildVecTable("search_embeddings");
    clearSettingsCache();

    const found = findSearchNeighbors(scopeForOwnerId(owner), query, 10).map(
      (row) => row.contactId,
    );
    expect(found).toEqual(["near", "far"]);
  });

  it("refuses to turn int8 back into float", () => {
    sqlite.exec("DROP TABLE IF EXISTS legacy_int8");
    sqlite.exec(vecTableDdl("legacy_int8", 384, "int8"));
    // Only search_embeddings is int8. A table that must be float and holds
    // bytes cannot get its floats back.
    expect(() => rebuildVecTable("legacy_int8")).toThrow(/re-embed/);
    sqlite.exec("DROP TABLE legacy_int8");
  });
});

describe("the neighbours of real vectors", () => {
  it("keeps the float KNN's nearest contacts, up to rounding", () => {
    // The search gate's MiniLM vectors: 300 contacts and 79 questions.
    const fixture = loadFixture();
    const ids = fixture.contacts.map((_, i) => `real-${i}`);
    sqlite.transaction(() => ids.forEach((id) => contact(id)))();
    upsertSearchEmbeddings(
      ids.map((contactId, i) => ({
        contactId,
        embedding: fixture.contactVectors[i],
      })),
    );
    expect(searchVectorScale()).toBe(scaleFor(fixture.contactVectors));

    const l2 = (a: Float32Array, b: Float32Array) =>
      a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0);
    let recall = 0;
    let sameFirst = 0;
    for (const query of fixture.queryVectors) {
      const exact = ids
        .map((id, i) => ({ id, d: l2(query, fixture.contactVectors[i]) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 10)
        .map((row) => row.id);
      const found = findSearchNeighbors(scopeForOwnerId(owner), query, 10).map(
        (row) => row.contactId,
      );
      recall += found.filter((id) => exact.includes(id)).length / 10;
      if (found[0] === exact[0]) sameFirst++;
    }
    // Measured with 79 questions (2026-09-30): recall@10 0.986 and the same
    // nearest contact for 79 of 79. What int8 loses is near ties at the tenth
    // place.
    // With bytes up to ±127, sqlite-vec's 16-bit square overflowed for two
    // large components of opposite sign, and recall@10 was 0.967.
    expect(recall / fixture.queryVectors.length).toBeGreaterThanOrEqual(0.98);
    expect(sameFirst).toBeGreaterThanOrEqual(69);
  });
});

describe("the scale", () => {
  it("intersects planner candidates and facets inside one KNN constraint", () => {
    contact("kept");
    contact("planner-only");
    contact("facet-only");
    contact("other-owner", otherOwner);
    const ids = ["kept", "planner-only", "facet-only", "other-owner"];
    upsertSearchEmbeddings(
      ids.map((contactId, i) => ({ contactId, embedding: spread(i + 1) })),
    );
    const found = findSearchNeighbors(
      scopeForOwnerId(owner),
      spread(1),
      10,
      new Set(["kept", "planner-only", "other-owner"]),
      { sql: "c.id != ?", params: ["planner-only"] },
    );
    expect(found.map((row) => row.contactId)).toEqual(["kept"]);
  });

  it("comes from every vector of the first write to an empty table", () => {
    contact("a");
    contact("b");
    upsertSearchEmbeddings([
      { contactId: "a", embedding: spread(1) },
      { contactId: "b", embedding: Float32Array.from(spread(2), (v) => v * 2) },
    ]);
    expect(searchVectorScale()).toBe(
      scaleFor([spread(1), Float32Array.from(spread(2), (v) => v * 2)]),
    );
  });

  it("stays when a later vector is larger, which is clamped at 90", () => {
    contact("first");
    contact("later");
    upsertSearchEmbeddings([{ contactId: "first", embedding: spread(1) }]);
    const scale = searchVectorScale();
    const larger = spread(2);
    larger[0] = 1;
    upsertSearchEmbeddings([{ contactId: "later", embedding: larger }]);
    expect(searchVectorScale()).toBe(scale);
    const stored = (
      sqlite
        .prepare(
          "SELECT embedding FROM search_embeddings WHERE contactId = 'later'",
        )
        .get() as { embedding: Buffer }
    ).embedding;
    expect(new Int8Array(stored.buffer, stored.byteOffset, 384)[0]).toBe(90);
  });

  it("keeps every byte difference inside sqlite-vec's 16-bit square", () => {
    // sqlite-vec 0.1.9 squares each byte difference in 16 bits on its NEON
    // path. At ±127 the largest components of opposite sign differ by 254,
    // the square overflows, and the distance comes back NULL. At ±90 they
    // differ by 180 at most.
    contact("plus");
    contact("minus");
    const plus = new Float32Array(384).fill(0.05);
    plus[0] = 0.3;
    const minus = new Float32Array(384).fill(0.05);
    minus[0] = -0.3;
    upsertSearchEmbeddings([
      { contactId: "plus", embedding: plus },
      { contactId: "minus", embedding: minus },
    ]);
    const found = findSearchNeighbors(scopeForOwnerId(owner), plus, 2);
    expect(found.map((row) => row.contactId)).toEqual(["plus", "minus"]);
    // 90 against -90 in the first component, and the same bytes elsewhere.
    expect(found[1].distance).toBeCloseTo(180, 3);
  });

  it("starts over when the table is empty again", () => {
    contact("a");
    upsertSearchEmbeddings([{ contactId: "a", embedding: spread(1) }]);
    const first = searchVectorScale();
    sqlite.prepare("DELETE FROM search_embeddings").run();
    const doubled = Float32Array.from(spread(1), (v) => v * 2);
    upsertSearchEmbeddings([{ contactId: "a", embedding: doubled }]);
    expect(searchVectorScale()).toBe(first! / 2);
  });

  it("is dropped with the table when the embedding model changes", () => {
    contact("a");
    upsertSearchEmbeddings([{ contactId: "a", embedding: spread(1) }]);
    expect(searchVectorScale()).not.toBeNull();
    rebuildSearchEmbeddingTable(384);
    expect(searchVectorScale()).toBeNull();
    const ddl = (
      sqlite
        .prepare(
          "SELECT sql FROM sqlite_master WHERE name = 'search_embeddings'",
        )
        .get() as { sql: string }
    ).sql;
    expect(ddl).toContain("INT8[384]");
  });

  it("reads a stored vector back as the float it was, within half a step", () => {
    contact("a");
    const vector = spread(3);
    upsertSearchEmbeddings([{ contactId: "a", embedding: vector }]);
    const scale = searchVectorScale()!;
    const stored = (
      sqlite
        .prepare(
          "SELECT embedding FROM search_embeddings WHERE contactId = 'a'",
        )
        .get() as { embedding: Buffer }
    ).embedding;
    const signed = new Int8Array(stored.buffer, stored.byteOffset, 384);
    for (let i = 0; i < 384; i++)
      expect(Math.abs(signed[i] / scale - vector[i])).toBeLessThanOrEqual(
        0.5 / scale + 1e-9,
      );
    // And floatsOf reads a float blob, which the migration relies on.
    expect(floatsOf(Buffer.from(vector.buffer))).toEqual(vector);
  });
});
