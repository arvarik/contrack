// =============================================================================
// Integration Tests — status columns inside the vector index
// =============================================================================
// The vector channel has to return contacts somebody can actually see: not a
// ghost, not archived, not in the trash, not merged away. Until 2.0 that was
// `contactId IN (SELECT c.id FROM contacts c WHERE ...)` wrapped around the
// KNN, which gave the right answers and made SQLite materialize a list of
// every active contact the account has, on every search.
//
// Now the four states are sqlite-vec METADATA columns, which sqlite-vec
// evaluates while it is choosing the k nearest rows rather than afterwards.
// Two things have to hold for that to be safe, and this file is both:
//
// 1. The filter really is inside the scan. The test for that asks for k = 1
//    against a corpus whose nearest rows are all hidden and whose only
//    visible row is the furthest away. A filter applied after the scan
//    returns nothing.
//
// 2. The columns agree with the contact. A vector is written once and the
//    contact is archived, restored, trashed and merged later, from code that
//    has never heard of the vector store. A trigger is what keeps them equal,
//    for the same reason the FTS index uses one.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const { makeTestApp } = await import("./helpers.ts");
const {
  sqlite,
  rebuildVecTable,
  VEC_ACTIVE_MATCH,
  VEC_METADATA_COLUMNS,
  vecTableDdl,
} = await import("../../server/db.ts");
const { findSearchNeighbors, getSearchEmbeddingCount } =
  await import("../../server/services/search/localEmbeddings.ts");
const { createActor, resetAccounts } = await import("./tenancy/helpers.ts");

makeTestApp();

const DIMENSION = 384;
let owner: string;
let otherOwner: string;

/** A unit vector pointing `angle` radians away from the query direction. */
function vectorAt(angle: number): Buffer {
  const values = new Float32Array(DIMENSION);
  values[0] = Math.cos(angle);
  values[1] = Math.sin(angle);
  return Buffer.from(values.buffer);
}

/** The direction every query in this file points. */
const QUERY = new Float32Array(DIMENSION);
QUERY[0] = 1;

/**
 * A contact and its vector, written the way the product writes them.
 *
 * The INSERT is the production shape: owner and status come out of the
 * contact row in the same statement. There is no way to pass them, which is
 * the point.
 */
function addContact(
  ownerId: string,
  id: string,
  angle: number,
  state: Partial<{
    isGhost: number;
    isArchived: number;
    deletedAt: string | null;
    canonicalId: string | null;
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
  sqlite
    .prepare(
      `INSERT INTO search_embeddings (contactId, ownerId, isGhost, isArchived, active, embedding)
       SELECT c.id, c.ownerId, c.isGhost, COALESCE(c.isArchived, 0),
              (c.deletedAt IS NULL AND c.canonicalId IS NULL), ?
         FROM contacts c WHERE c.id = ?`,
    )
    .run(vectorAt(angle), id);
}

/** What the vector store thinks this contact's status is. */
function storedStatus(id: string) {
  return sqlite
    .prepare(
      "SELECT isGhost, isArchived, active FROM search_embeddings WHERE contactId = ?",
    )
    .get(id) as
    { isGhost: number; isArchived: number; active: number } | undefined;
}

function clearContacts(): void {
  sqlite.prepare("DELETE FROM search_embeddings").run();
  sqlite.prepare("DELETE FROM contacts").run();
}

beforeAll(async () => {
  resetAccounts();
  const a = await createActor(makeTestApp(), { username: "vecowner" });
  const b = await createActor(makeTestApp(), { username: "vecother" });
  owner = a.user.id;
  otherOwner = b.user.id;
});

beforeEach(() => {
  clearContacts();
});

// ---------------------------------------------------------------------------
// The shape of the table
// ---------------------------------------------------------------------------

describe("the vec0 tables", () => {
  it("declare the three status columns on both tables", () => {
    for (const table of ["search_embeddings", "contact_embeddings"]) {
      const ddl = (
        sqlite
          .prepare("SELECT sql FROM sqlite_master WHERE name = ?")
          .get(table) as { sql: string }
      ).sql;

      for (const column of VEC_METADATA_COLUMNS) {
        expect(ddl, `${table}.${column}`).toMatch(
          new RegExp(`\\b${column}\\s+INTEGER`, "i"),
        );
      }
      expect(ddl).toMatch(/PARTITION KEY/i);
    }
  });

  it("builds the same DDL from the one function both call sites use", () => {
    const ddl = vecTableDdl("probe_table", 8);

    // The model-change rebuilds in localEmbeddings.ts and dedupe/embeddings.ts
    // recreate these tables. A second copy of the DDL there would let a
    // rebuild drop the status columns, and every later search would then be
    // filtering on a column that is not there.
    for (const column of VEC_METADATA_COLUMNS) {
      expect(ddl).toContain(`${column} INTEGER`);
    }
    expect(ddl).toContain("ownerId TEXT PARTITION KEY");
    expect(ddl).toContain("FLOAT[8]");
  });

  it("refuses a row that does not say what its status is", () => {
    sqlite
      .prepare("INSERT INTO contacts (id, name, ownerId) VALUES (?, ?, ?)")
      .run("bare", "Bare", owner);

    // This is the guarantee that makes the columns trustworthy. An INSERT that
    // omits them is an error, not a row with NULLs that every later query
    // silently skips.
    expect(() =>
      sqlite
        .prepare(
          "INSERT INTO search_embeddings (contactId, ownerId, embedding) VALUES (?, ?, ?)",
        )
        .run("bare", owner, vectorAt(0)),
    ).toThrow(/Expected integer for INTEGER metadata column/);
  });
});

// ---------------------------------------------------------------------------
// The filter is inside the scan
// ---------------------------------------------------------------------------

describe("filtering inside the KNN", () => {
  /**
   * Twelve hidden contacts nearer than the one visible contact.
   *
   * Every one of the hidden rows is closer to the query than `visible`, so a
   * filter applied to the results of an unfiltered KNN returns nothing for any
   * k below thirteen.
   */
  function seedNeedleInHaystack(): void {
    const hidden = [
      { isGhost: 1 },
      { isGhost: 1 },
      { isGhost: 1 },
      { isArchived: 1 },
      { isArchived: 1 },
      { isArchived: 1 },
      { deletedAt: "2026-01-01T00:00:00.000Z" },
      { deletedAt: "2026-01-01T00:00:00.000Z" },
      { deletedAt: "2026-01-01T00:00:00.000Z" },
      { canonicalId: "merged-into" },
      { canonicalId: "merged-into" },
      { canonicalId: "merged-into" },
    ];
    hidden.forEach((state, i) => {
      addContact(owner, `hidden-${i}`, 0.001 * (i + 1), state);
    });
    addContact(owner, "visible", 1.4);
  }

  it("returns the one visible contact when k is one", () => {
    seedNeedleInHaystack();

    const found = findSearchNeighbors({ ownerId: owner } as never, QUERY, 1);

    // The whole story in one assertion. Twelve nearer rows are hidden, k is 1,
    // and the answer is the furthest row. sqlite-vec chose the nearest
    // QUALIFYING row, which a post-scan filter cannot do.
    expect(found.map((r) => r.contactId)).toEqual(["visible"]);
  });

  it("hides a ghost, an archived contact, a trashed one and a merged one", () => {
    seedNeedleInHaystack();

    const found = findSearchNeighbors({ ownerId: owner } as never, QUERY, 50);

    expect(found.map((r) => r.contactId)).toEqual(["visible"]);
  });

  it("still stops at the account that asked", () => {
    addContact(otherOwner, "theirs", 0);
    addContact(owner, "mine", 1.4);

    const found = findSearchNeighbors({ ownerId: owner } as never, QUERY, 10);

    // `ownerId` is the partition key and the status columns are metadata. The
    // two do different jobs and neither replaced the other.
    expect(found.map((r) => r.contactId)).toEqual(["mine"]);
  });

  it("applies an id list on top, not instead", () => {
    addContact(owner, "wanted", 1.4);
    addContact(owner, "unwanted", 0);
    addContact(owner, "wanted-but-archived", 0.001, { isArchived: 1 });

    const found = findSearchNeighbors(
      { ownerId: owner } as never,
      QUERY,
      10,
      new Set(["wanted", "wanted-but-archived"]),
    );

    // The id list narrows; the status columns still hide. A list a caller
    // built from a stale index must not resurrect an archived contact.
    expect(found.map((r) => r.contactId)).toEqual(["wanted"]);
  });

  it("returns nothing for an empty id list without touching the database", () => {
    addContact(owner, "wanted", 0);

    expect(
      findSearchNeighbors({ ownerId: owner } as never, QUERY, 10, new Set()),
    ).toEqual([]);
  });

  it("counts one owner's vectors, hidden ones included", () => {
    addContact(owner, "visible", 0);
    addContact(owner, "ghost", 0.1, { isGhost: 1 });
    addContact(otherOwner, "theirs", 0.2);

    // The count answers "has this account been indexed", which is a question
    // about the store rather than about what a search returns. A ghost has a
    // vector and it counts.
    expect(getSearchEmbeddingCount({ ownerId: owner } as never)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The columns keep up with the contact
// ---------------------------------------------------------------------------

describe("the status trigger", () => {
  beforeEach(() => {
    addContact(owner, "c1", 0);
  });

  function setStatus(sql: string, ...params: unknown[]): void {
    sqlite.prepare(`UPDATE contacts SET ${sql} WHERE id = 'c1'`).run(...params);
  }

  it("starts equal to the contact", () => {
    expect(storedStatus("c1")).toEqual({
      isGhost: 0,
      isArchived: 0,
      active: 1,
    });
  });

  it("follows an archive and an un-archive", () => {
    setStatus("isArchived = 1");
    expect(storedStatus("c1")).toMatchObject({ isArchived: 1 });

    setStatus("isArchived = 0");
    expect(storedStatus("c1")).toMatchObject({ isArchived: 0 });
  });

  it("follows a trash and a restore", () => {
    setStatus("deletedAt = ?", "2026-01-01T00:00:00.000Z");
    expect(storedStatus("c1")).toMatchObject({ active: 0 });

    setStatus("deletedAt = NULL");
    expect(storedStatus("c1")).toMatchObject({ active: 1 });
  });

  it("follows a merge and an unmerge", () => {
    setStatus("canonicalId = ?", "primary-id");
    expect(storedStatus("c1")).toMatchObject({ active: 0 });

    setStatus("canonicalId = NULL");
    expect(storedStatus("c1")).toMatchObject({ active: 1 });
  });

  it("follows a ghost being promoted to a real contact", () => {
    setStatus("isGhost = 1");
    expect(storedStatus("c1")).toMatchObject({ isGhost: 1 });

    setStatus("isGhost = 0");
    expect(storedStatus("c1")).toMatchObject({ isGhost: 0 });
  });

  it("treats a NULL isArchived as not archived", () => {
    // The column is nullable on an upgraded database, and sqlite-vec refuses a
    // NULL metadata value outright, so the trigger has to fold it.
    setStatus("isArchived = NULL");

    expect(storedStatus("c1")).toMatchObject({ isArchived: 0 });
  });

  it("changes what a search returns, not only what a column says", () => {
    addContact(owner, "c2", 1.4);
    expect(
      findSearchNeighbors({ ownerId: owner } as never, QUERY, 1).map(
        (r) => r.contactId,
      ),
    ).toEqual(["c1"]);

    setStatus("isArchived = 1");

    // The assertion that matters. A column nobody reads is not a guarantee.
    expect(
      findSearchNeighbors({ ownerId: owner } as never, QUERY, 1).map(
        (r) => r.contactId,
      ),
    ).toEqual(["c2"]);
  });

  it("is a no-op for a contact with no vector", () => {
    sqlite
      .prepare("INSERT INTO contacts (id, name, ownerId) VALUES (?, ?, ?)")
      .run("novector", "No Vector", owner);

    expect(() =>
      sqlite
        .prepare("UPDATE contacts SET isArchived = 1 WHERE id = 'novector'")
        .run(),
    ).not.toThrow();
  });

  it("covers the dedupe vector store too", () => {
    sqlite
      .prepare(
        `INSERT INTO contact_embeddings (contactId, ownerId, isGhost, isArchived, active, embedding)
         SELECT c.id, c.ownerId, c.isGhost, COALESCE(c.isArchived, 0),
                (c.deletedAt IS NULL AND c.canonicalId IS NULL), ?
           FROM contacts c WHERE c.id = ?`,
      )
      .run(Buffer.from(new Float32Array(768).buffer), "c1");

    setStatus("isArchived = 1");

    expect(
      sqlite
        .prepare(
          "SELECT isArchived FROM contact_embeddings WHERE contactId = ?",
        )
        .get("c1"),
    ).toEqual({ isArchived: 1 });
  });
});

// ---------------------------------------------------------------------------
// The query plan
// ---------------------------------------------------------------------------

describe("the query plan", () => {
  it("has no subquery over contacts left in it", () => {
    addContact(owner, "c1", 0);

    const plan = sqlite
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT contactId, distance FROM search_embeddings
         WHERE embedding MATCH ? AND ownerId = ? AND ${VEC_ACTIVE_MATCH}
           AND k = ? ORDER BY distance`,
      )
      .all(Buffer.from(QUERY.buffer), owner, 10) as { detail: string }[];
    const detail = plan.map((row) => row.detail).join("\n");

    // A `SCAN c` line here means SQLite is reading the contacts table once per
    // search to build a list of ids. That is what this change removed, and it
    // cost 42.7 ms per query on 50,000 contacts.
    expect(detail).not.toMatch(/SCAN c\b/);
    expect(detail).not.toMatch(/LIST SUBQUERY/);
    expect(detail).toMatch(/search_embeddings VIRTUAL TABLE/);
  });
});

// ---------------------------------------------------------------------------
// The upgrade
// ---------------------------------------------------------------------------

describe("upgrading a table that has no status columns", () => {
  /**
   * A vec0 table in the 2.0 shape: partition key, no status columns.
   *
   * This is the table every instance already running 2.0 has, and it is a
   * different starting point from the pre-2.0 one that
   * `tenancy.migration.test.ts` covers. That one has no partition key at all,
   * so the old rebuild gate caught it; this one passes that gate and would
   * have been left alone, with every search then filtering on a column the
   * table does not have.
   */
  function makeLegacyTable(table: string): void {
    sqlite.exec(`DROP TABLE IF EXISTS ${table}`);
    sqlite.exec(`CREATE VIRTUAL TABLE ${table} USING vec0(
      contactId TEXT PRIMARY KEY,
      ownerId TEXT PARTITION KEY,
      embedding FLOAT[${DIMENSION}]
    )`);
  }

  beforeEach(() => {
    clearContacts();
  });

  it("rebuilds it, and carries each contact's status across", () => {
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, ownerId, isGhost, isArchived, deletedAt)
         VALUES ('keep', 'Keep', ?, 0, 0, NULL), ('arch', 'Arch', ?, 0, 1, NULL),
                ('gone', 'Gone', ?, 0, 0, '2026-01-01T00:00:00.000Z')`,
      )
      .run(owner, owner, owner);
    makeLegacyTable("legacy_vectors");
    const insert = sqlite.prepare(
      `INSERT INTO legacy_vectors (contactId, ownerId, embedding) VALUES (?, ?, ?)`,
    );
    insert.run("keep", owner, vectorAt(0));
    insert.run("arch", owner, vectorAt(0.1));
    insert.run("gone", owner, vectorAt(0.2));

    const result = rebuildVecTable("legacy_vectors");

    expect(result).toMatchObject({ copied: 3, dropped: 0, dimension: 384 });
    expect(
      sqlite
        .prepare(
          "SELECT contactId, isGhost, isArchived, active FROM legacy_vectors ORDER BY contactId",
        )
        .all(),
    ).toEqual([
      { contactId: "arch", isGhost: 0, isArchived: 1, active: 1 },
      { contactId: "gone", isGhost: 0, isArchived: 0, active: 0 },
      { contactId: "keep", isGhost: 0, isArchived: 0, active: 1 },
    ]);
    sqlite.exec("DROP TABLE legacy_vectors");
  });

  it("keeps the vectors byte for byte", () => {
    sqlite
      .prepare("INSERT INTO contacts (id, name, ownerId) VALUES (?, ?, ?)")
      .run("near", "Near", owner);
    sqlite
      .prepare("INSERT INTO contacts (id, name, ownerId) VALUES (?, ?, ?)")
      .run("far", "Far", owner);
    makeLegacyTable("legacy_vectors");
    const insert = sqlite.prepare(
      `INSERT INTO legacy_vectors (contactId, ownerId, embedding) VALUES (?, ?, ?)`,
    );
    insert.run("near", owner, vectorAt(0.01));
    insert.run("far", owner, vectorAt(1.4));

    rebuildVecTable("legacy_vectors");

    // Nothing is re-embedded, so the same query vector has to find the same
    // contact. A rebuild that quietly reordered or truncated the bytes would
    // otherwise present later as bad search results.
    const nearest = sqlite
      .prepare(
        `SELECT contactId FROM legacy_vectors
          WHERE embedding MATCH ? AND ownerId = ? AND k = 1 ORDER BY distance`,
      )
      .get(Buffer.from(QUERY.buffer), owner) as { contactId: string };
    expect(nearest.contactId).toBe("near");
    sqlite.exec("DROP TABLE legacy_vectors");
  });

  it("leaves behind a vector whose contact is gone", () => {
    makeLegacyTable("legacy_vectors");
    sqlite
      .prepare(
        `INSERT INTO legacy_vectors (contactId, ownerId, embedding) VALUES (?, ?, ?)`,
      )
      .run("orphan", owner, vectorAt(0));

    const result = rebuildVecTable("legacy_vectors");

    // An orphan has no contact to read a status from, so there is nothing to
    // write. Dropping it is the honest outcome: it was already unreachable.
    expect(result).toMatchObject({ copied: 0, dropped: 1 });
    sqlite.exec("DROP TABLE legacy_vectors");
  });

  it("does nothing to a table that is already current", () => {
    sqlite.exec("DROP TABLE IF EXISTS current_vectors");
    sqlite.exec(vecTableDdl("current_vectors", DIMENSION));

    expect(rebuildVecTable("current_vectors")).toBeNull();
    sqlite.exec("DROP TABLE current_vectors");
  });

  it("has already run on both real tables by the time anything reads them", () => {
    // Boot order, asserted rather than assumed. The rebuild is at module
    // scope in db.ts, so by the time a test can import anything it is done.
    expect(rebuildVecTable("search_embeddings")).toBeNull();
    expect(rebuildVecTable("contact_embeddings")).toBeNull();
  });
});
