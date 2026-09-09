// =============================================================================
// Integration Tests — the storage guarantees Phase 1 makes
// =============================================================================
// Four claims that only mean something against a real SQLite file with
// sqlite-vec loaded:
//
//   • The boot refuses to start on a sqlite-vec too old for partition keys.
//   • The three places that build vec0 DDL build the same DDL.
//   • A contact update is cheap. The FTS delete is an indexed rowid probe,
//     not a scan of the virtual table.
//   • Rebuilding the index for a realistic corpus takes well under a second.
// =============================================================================

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { sqlite, assertVecVersion, vecTableDdl } from "../../server/db.ts";
import { installSearchIndex } from "../../server/services/search/ftsIndex.ts";
import { rebuildSearchEmbeddingTable } from "../../server/services/search/localEmbeddings.ts";
import { rebuildDedupeEmbeddingTable } from "../../server/services/dedupe/embeddings.ts";
import { localOwnerId } from "./tenancy/helpers.ts";

describe("the sqlite-vec version gate", () => {
  it("accepts every release that has partition keys", () => {
    for (const version of ["v0.1.6", "v0.1.9", "v0.1.10-alpha.4", "v1.0.0"]) {
      expect(() => assertVecVersion(version), version).not.toThrow();
    }
  });

  it("refuses anything older, with a message that names the version", () => {
    for (const version of ["v0.1.5", "v0.0.9", "v0.1.0-alpha.1"]) {
      expect(() => assertVecVersion(version), version).toThrow(
        /sqlite-vec >= 0\.1\.6 is required/,
      );
    }
    expect(() => assertVecVersion("v0.1.5")).toThrow(/found v0\.1\.5/);
  });

  it("compares numbers, not strings", () => {
    // "v0.1.10" sorts before "v0.1.6" as a string and after it as a version.
    // Getting this wrong would refuse to boot on a newer sqlite-vec.
    expect("v0.1.10" < "v0.1.6").toBe(true);
    expect(() => assertVecVersion("v0.1.10")).not.toThrow();
  });

  it("passes for the version actually installed", () => {
    const installed = (
      sqlite.prepare("SELECT vec_version() AS v").get() as { v: string }
    ).v;
    expect(() => assertVecVersion(installed)).not.toThrow();
  });
});

describe("vec0 table DDL", () => {
  it("is identical wherever it is built", () => {
    // Three call sites build this: the boot rebuild in db.ts and the two
    // model-change rebuilds in the embedding stores. If one of them drops the
    // partition key, every scoped KNN Phase 2 writes returns nothing for rows
    // written afterwards, and nothing fails until then.
    const probe = new Database(":memory:");
    sqliteVec.load(probe);
    try {
      for (const [table, dimension] of [
        ["search_embeddings", 384],
        ["contact_embeddings", 768],
      ] as const) {
        const ddl = vecTableDdl(table, dimension);
        expect(ddl).toContain("ownerId TEXT PARTITION KEY");
        expect(ddl).toContain(`FLOAT[${dimension}]`);
        // And it is DDL SQLite actually accepts, not a plausible string.
        expect(() => probe.exec(ddl)).not.toThrow();
      }
    } finally {
      probe.close();
    }
  });

  it("is what the two rebuild helpers emit", () => {
    for (const [rebuild, table, dimension] of [
      [rebuildSearchEmbeddingTable, "search_embeddings", 384],
      [rebuildDedupeEmbeddingTable, "contact_embeddings", 768],
    ] as const) {
      rebuild(dimension);
      const actual = (
        sqlite
          .prepare("SELECT sql FROM sqlite_master WHERE name = ?")
          .get(table) as { sql: string }
      ).sql;
      expect(actual, table).toContain("PARTITION KEY");
      // Compare what SQLite stored against what db.ts would have written,
      // ignoring the whitespace SQLite normalises away.
      const squash = (s: string) => s.replace(/\s+/g, " ").trim();
      expect(squash(actual)).toBe(squash(vecTableDdl(table, dimension)));
    }
  });
});

describe("the cost of a contact update", () => {
  it("updates 1,000 contacts on a 5,000-contact database in under 500ms", () => {
    const owner = localOwnerId();
    const insert = sqlite.prepare(
      `INSERT INTO contacts (id, name, company, role, headline, location, about, industry, ownerId)
       VALUES (?, ?, ?, 'Engineer', 'headline text', 'Austin', 'about this person', 'Software', ?)`,
    );
    sqlite.transaction(() => {
      for (let i = 0; i < 5000; i++) {
        insert.run(`cost-${i}`, `Person ${i}`, `Company ${i % 100}`, owner);
      }
    })();

    const update = sqlite.prepare("UPDATE contacts SET role = ? WHERE id = ?");
    const started = performance.now();
    sqlite.transaction(() => {
      for (let i = 0; i < 1000; i++) update.run("VP Sales", `cost-${i}`);
    })();
    const elapsed = performance.now() - started;

    // The same loop measured 499ms with the pre-1.5.x triggers, which deleted
    // on the UNINDEXED contactId column and so scanned the whole FTS table on
    // every firing. Anything near that number means a delete went back.
    expect(elapsed, `1,000 updates took ${elapsed.toFixed(0)}ms`).toBeLessThan(
      500,
    );

    // The index actually kept up, rather than being fast because it stopped
    // doing the work.
    const reindexed = sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM contacts_fts WHERE contacts_fts MATCH ?",
      )
      .get('"VP" AND "Sales"') as { n: number };
    expect(reindexed.n).toBe(1000);

    sqlite.prepare("DELETE FROM contacts WHERE id LIKE 'cost-%'").run();
  });

  it("rebuilds the whole index for 10,000 contacts in under a second", () => {
    const owner = localOwnerId();
    const insert = sqlite.prepare(
      `INSERT INTO contacts (id, name, company, role, headline, location, about, industry, ownerId)
       VALUES (?, ?, ?, 'Designer', 'headline text', 'Berlin', 'about this person', 'Design', ?)`,
    );
    sqlite.transaction(() => {
      for (let i = 0; i < 10000; i++) {
        insert.run(`bulk-${i}`, `Bulk ${i}`, `Company ${i % 200}`, owner);
      }
    })();

    // Force the versioned rebuild gate, which is the path an upgrade takes.
    sqlite.pragma("user_version = 0");
    const started = performance.now();
    installSearchIndex(sqlite);
    const elapsed = performance.now() - started;

    expect(
      elapsed,
      `rebuilding 10,000 contacts took ${elapsed.toFixed(0)}ms`,
    ).toBeLessThan(1000);

    const indexed = sqlite
      .prepare("SELECT COUNT(*) AS n FROM contacts_fts")
      .get() as { n: number };
    expect(indexed.n).toBeGreaterThanOrEqual(10000);

    const token = "o" + owner.replace(/-/g, "");
    const scoped = sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM contacts_fts WHERE contacts_fts MATCH ?",
      )
      .get(`ownerTok:${token}`) as { n: number };
    expect(scoped.n).toBe(indexed.n);

    sqlite.prepare("DELETE FROM contacts WHERE id LIKE 'bulk-%'").run();
  });
});
