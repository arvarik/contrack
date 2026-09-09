// =============================================================================
// Integration Tests — upgrading a 1.5.5 database
// =============================================================================
// The riskiest thing this phase does is run against a database that already
// has someone's contacts in it. Every other test in the suite starts from an
// empty file, which proves the new schema is buildable and nothing about
// whether the upgrade is safe.
//
// So this file builds a real 1.5.5-shaped database with data, uploads, and
// vectors in it (tests/fixtures/make-v1-database.ts), points DATA_DIR at it,
// imports server/db.ts, and then checks what the migration did. The two
// assertions that matter most are the quiet ones:
//
//   • `updatedAt` is byte-identical afterwards. The dedupe scan re-embeds any
//     contact whose updatedAt is newer than its embeddedAt, so a migration
//     that stamps the corpus bills the operator for re-embedding all of it.
//   • The vectors are copied, not recomputed. Same rows, same nearest
//     neighbour, no provider call.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { makeV1Database, V1_TRIGGERS } from "../fixtures/make-v1-database.ts";
import { verify } from "../../scripts/tenancy-verify.ts";

// Boot must not reach an embedding provider. The mock throws rather than
// returning something plausible, so a call shows up as a failed boot with a
// named cause instead of a silently re-embedded corpus.
const embedBatch = vi.fn(async () => {
  throw new Error("embedBatch was called during boot");
});
vi.mock("../../server/ai/embeddings.ts", async (importActual) => {
  const actual =
    await importActual<typeof import("../../server/ai/embeddings.ts")>();
  return { ...actual, embedBatch };
});

const fixture = makeV1Database();
process.env.DATA_DIR = fixture.dataDir;

// Importing this runs the migration. Everything below inspects the result.
const { sqlite } = await import("../../server/db.ts");

const uploads = path.join(fixture.dataDir, "uploads");
const backupDir = path.join(fixture.dataDir, "backups");

afterAll(() => {
  sqlite.close();
  fs.rmSync(fixture.dataDir, { recursive: true, force: true });
});

describe("upgrading a 1.5.5 database", () => {
  it("passes every tenancy-verify check", () => {
    const failed = verify(sqlite).filter((c) => !c.ok);
    expect(
      failed.map((c) => `${c.group}: ${c.name} (${c.detail})`),
      "verification queries 1 to 11",
    ).toEqual([]);
  });

  it("gives every row an owner without inventing a second account", () => {
    const users = sqlite
      .prepare("SELECT id, username, credentialState, role FROM users")
      .all() as { username: string; credentialState: string; role: string }[];
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      username: "local",
      credentialState: "none",
      role: "admin",
    });

    const owner = (
      sqlite.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }
    ).id;
    for (const table of [
      "contacts",
      "lists",
      "interactions",
      "action_items",
      "dedupe_suggestions",
      "dedupe_exclusions",
      "dedupe_merge_log",
      "ai_invocations",
    ]) {
      const n = (
        sqlite
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ownerId != ?`)
          .get(owner) as { n: number }
      ).n;
      expect(n, `${table} rows not owned by the local owner`).toBe(0);
    }
  });

  it("owns the action item that the legacy follow-up backfill creates", () => {
    // §8 of server/db.ts inserts into action_items with no ownerId, after the
    // invariant triggers are armed. Without the fill trigger this boot would
    // have aborted; with it the row lands owned. This is the one code path in
    // the app that relies on the fill rather than on an explicit stamp.
    const owner = (
      sqlite.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }
    ).id;
    const row = sqlite
      .prepare(
        "SELECT id, ownerId FROM action_items WHERE contactId = ? AND title = 'Follow up'",
      )
      .get(fixture.legacyFollowUpId) as
      { id: string; ownerId: string | null } | undefined;
    expect(row, "the backfill did not create an action item").toBeTruthy();
    expect(row?.ownerId).toBe(owner);
  });

  it("leaves updatedAt byte-identical on every contact and interaction", () => {
    // The whole reason the migration drops the _auto_updated_at triggers. One
    // stamped row is one contact re-embedded through the paid provider on the
    // next deep dedupe scan; 50 stamped rows is the whole corpus.
    for (const row of sqlite
      .prepare("SELECT id, updatedAt FROM contacts")
      .all() as { id: string; updatedAt: string }[]) {
      // The one exception is the contact §8 builds an action item for: the
      // sync trigger writes nextFollowUpAt back to it. That is 1.5.5
      // behaviour on a database that has not booted 1.5.5 yet, and it costs
      // one re-embed rather than the whole corpus.
      if (row.id === fixture.legacyFollowUpId) continue;
      expect(row.updatedAt, `contact ${row.id}`).toBe(
        fixture.contactUpdatedAt[row.id],
      );
    }
    for (const row of sqlite
      .prepare("SELECT id, updatedAt FROM interactions")
      .all() as { id: string; updatedAt: string }[]) {
      expect(row.updatedAt, `interaction ${row.id}`).toBe(
        fixture.interactionUpdatedAt[row.id],
      );
    }
  });

  it("leaves no contact looking stale to the dedupe scan", () => {
    // The consequence the timestamps exist to prevent, stated directly:
    // findStaleEmbeddings re-embeds anything whose updatedAt is newer than its
    // embeddedAt, and after this migration nothing should qualify.
    const stale = sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM dedupe_embedding_meta m
           JOIN contacts c ON c.id = m.contactId
          WHERE c.updatedAt > m.embeddedAt`,
      )
      .get() as { n: number };
    // Zero, not "a few": the ten embedded contacts are all untouched. If the
    // migration stamped the corpus this would be ten, and on a real instance
    // it would be every contact that has ever been embedded.
    expect(stale.n).toBe(0);
  });

  it("never calls an embedding provider during boot", () => {
    expect(embedBatch).not.toHaveBeenCalled();
  });

  it("copies the vectors rather than recomputing them", () => {
    const counts = {
      search: (
        sqlite.prepare("SELECT COUNT(*) AS n FROM search_embeddings").get() as {
          n: number;
        }
      ).n,
      dedupe: (
        sqlite
          .prepare("SELECT COUNT(*) AS n FROM contact_embeddings")
          .get() as {
          n: number;
        }
      ).n,
    };
    expect(counts).toEqual(fixture.vectorCounts);

    // The same query vector finds the same contact, so the bytes survived the
    // drop-and-recreate intact.
    const nearest = sqlite
      .prepare(
        "SELECT contactId FROM search_embeddings WHERE embedding MATCH ? AND k = 1",
      )
      .get(fixture.queryVector) as { contactId: string };
    expect(nearest.contactId).toBe(fixture.nearestSearch);
  });

  it("partitions the vectors by their contact's owner", () => {
    const owner = (
      sqlite.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }
    ).id;
    // A KNN restricted to the partition returns the same answer, which is what
    // Phase 2c will rely on.
    const scoped = sqlite
      .prepare(
        "SELECT contactId FROM search_embeddings WHERE embedding MATCH ? AND k = 1 AND ownerId = ?",
      )
      .get(fixture.queryVector, owner) as { contactId: string };
    expect(scoped.contactId).toBe(fixture.nearestSearch);
  });

  it("rebuilds the FTS index with an owner token", () => {
    const ftsSql = (
      sqlite
        .prepare("SELECT sql FROM sqlite_master WHERE name = 'contacts_fts'")
        .get() as { sql: string }
    ).sql;
    expect(ftsSql).toContain("ownerTok");
    // The prefix index from the 1.5.x search work has to survive the rebuild,
    // or every as-you-type query gets slower.
    expect(ftsSql).toContain("prefix='2 3 4'");
    expect(sqlite.pragma("user_version", { simple: true })).toBe(3);

    const owner = (
      sqlite.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }
    ).id;
    const token = "o" + owner.replace(/-/g, "");
    const hits = sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM contacts_fts WHERE contacts_fts MATCH ?",
      )
      .get(`ownerTok:${token}`) as { n: number };
    expect(hits.n).toBe(fixture.contactIds.length);
  });

  it("gives back every trigger it dropped", () => {
    const present = new Set(
      (
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
          .all() as { name: string }[]
      ).map((r) => r.name),
    );
    // The child fts_*_ai/ad triggers were rewritten in 1.5.x to null
    // searchExpansion instead of touching contacts_fts, so their bodies differ
    // from the fixture's. Their names still have to be there.
    for (const name of V1_TRIGGERS) {
      expect(present.has(name), `${name} is missing after the migration`).toBe(
        true,
      );
    }
  });

  it("writes a backup that opens with the old shape", () => {
    const backups = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith("pre-tenancy-") && f.endsWith(".db"));
    expect(backups).toHaveLength(1);

    const backup = new Database(path.join(backupDir, backups[0]), {
      readonly: true,
    });
    sqliteVec.load(backup);
    try {
      // The pre-migration shape: no ownerTok, no partition key, no local owner.
      const ftsSql = (
        backup
          .prepare("SELECT sql FROM sqlite_master WHERE name = 'contacts_fts'")
          .get() as { sql: string }
      ).sql;
      expect(ftsSql).not.toContain("ownerTok");
      const vecSql = (
        backup
          .prepare(
            "SELECT sql FROM sqlite_master WHERE name = 'search_embeddings'",
          )
          .get() as { sql: string }
      ).sql;
      expect(vecSql).not.toContain("PARTITION KEY");
      expect(
        (
          backup.prepare("SELECT COUNT(*) AS n FROM users").get() as {
            n: number;
          }
        ).n,
      ).toBe(0);
      // And the data is all there, which is the point of keeping it.
      expect(
        (
          backup.prepare("SELECT COUNT(*) AS n FROM contacts").get() as {
            n: number;
          }
        ).n,
      ).toBe(fixture.contactIds.length);
    } finally {
      backup.close();
    }
  });

  it("moves uploads under the owner and rewrites the URLs", () => {
    const owner = (
      sqlite.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }
    ).id;

    for (const avatar of fixture.avatarUrls) {
      const row = sqlite
        .prepare("SELECT avatarUrl FROM contacts WHERE id = ?")
        .get(avatar.id) as { avatarUrl: string };
      expect(row.avatarUrl).toBe(`/uploads/u/${owner}/avatars/${avatar.file}`);
      expect(
        fs.existsSync(path.join(uploads, "u", owner, "avatars", avatar.file)),
        `${avatar.file} should exist at the new path`,
      ).toBe(true);
      expect(
        fs.existsSync(path.join(uploads, "avatars", avatar.file)),
        `${avatar.file} should be gone from the flat path`,
      ).toBe(false);
    }

    for (const attachment of fixture.attachmentUrls) {
      const row = sqlite
        .prepare("SELECT fileUrl FROM interactions WHERE id = ?")
        .get(attachment.id) as { fileUrl: string };
      expect(row.fileUrl).toBe(`/uploads/u/${owner}/files/${attachment.file}`);
      expect(
        fs.existsSync(path.join(uploads, "u", owner, "files", attachment.file)),
      ).toBe(true);
    }
  });

  it("leaves generated, external, and shared URLs alone", () => {
    const generated = sqlite
      .prepare("SELECT avatarUrl FROM contacts WHERE id = ?")
      .get(fixture.contactIds[10]) as { avatarUrl: string };
    expect(generated.avatarUrl).toBe("/api/avatar/avataaars?seed=x");

    const external = sqlite
      .prepare("SELECT avatarUrl FROM contacts WHERE id = ?")
      .get(fixture.contactIds[11]) as { avatarUrl: string };
    expect(external.avatarUrl).toBe("https://example.com/face.png");

    expect(fs.existsSync(path.join(uploads, "logos", "acme.png"))).toBe(true);
  });

  it("moves an unreferenced upload aside instead of deleting it", () => {
    const orphaned = path.join(uploads, "orphaned", fixture.orphanFile);
    expect(fs.existsSync(orphaned), "the orphan should be kept").toBe(true);
    expect(fs.readFileSync(orphaned, "utf8")).toBe("orphan bytes");
  });
});

describe("booting the migrated database again", () => {
  let secondSqlite: Database.Database;
  let versionBefore: string;
  let backupsBefore: number;
  let updatedAtBefore: Record<string, string>;

  beforeAll(async () => {
    versionBefore = (
      sqlite
        .prepare("SELECT value FROM app_settings WHERE key = 'schema.tenancy'")
        .get() as { value: string }
    ).value;
    backupsBefore = fs.readdirSync(backupDir).length;
    // The baseline for a second boot is what the first boot left behind, not
    // the fixture. The two differ on exactly one contact: §8's legacy
    // follow-up backfill writes nextFollowUpAt back to it, which the test
    // above records as expected. Comparing against the fixture here made this
    // assertion depend on whether the first boot happened to land in the same
    // clock second as the fixture build.
    updatedAtBefore = Object.fromEntries(
      (
        sqlite.prepare("SELECT id, updatedAt FROM contacts").all() as {
          id: string;
          updatedAt: string;
        }[]
      ).map((r) => [r.id, r.updatedAt]),
    );

    // A fresh module registry, so server/db.ts runs its whole boot again
    // against the file the first boot left behind.
    vi.resetModules();
    ({ sqlite: secondSqlite } = await import("../../server/db.ts"));
  });

  afterAll(() => secondSqlite.close());

  it("changes nothing and writes no second backup", () => {
    const versionAfter = (
      secondSqlite
        .prepare("SELECT value FROM app_settings WHERE key = 'schema.tenancy'")
        .get() as { value: string }
    ).value;
    expect(versionAfter).toBe(versionBefore);
    expect(fs.readdirSync(backupDir)).toHaveLength(backupsBefore);
    expect(secondSqlite.pragma("user_version", { simple: true })).toBe(3);
  });

  it("leaves updatedAt alone a second time", () => {
    for (const row of secondSqlite
      .prepare("SELECT id, updatedAt FROM contacts")
      .all() as { id: string; updatedAt: string }[]) {
      expect(row.updatedAt, `contact ${row.id}`).toBe(updatedAtBefore[row.id]);
    }
  });

  it("still passes every tenancy-verify check", () => {
    expect(verify(secondSqlite).filter((c) => !c.ok)).toEqual([]);
  });

  it("does not create a second local owner", () => {
    const n = (
      secondSqlite.prepare("SELECT COUNT(*) AS n FROM users").get() as {
        n: number;
      }
    ).n;
    expect(n).toBe(1);
  });
});

// =============================================================================
// The other upgrade path
// =============================================================================
// An instance that already made an account has real rows owned by a real user.
// The migration must not invent a local owner beside it, must not move any
// ownership, and must leave the instance looking secured rather than pushing
// its owner back through the setup wizard.
// =============================================================================

describe("upgrading a 1.5.5 database that already has an account", () => {
  const withAccount = makeV1Database({ withAccount: true });
  let authOnSqlite: Database.Database;
  let countPasswordAccounts: () => number;

  beforeAll(async () => {
    process.env.DATA_DIR = withAccount.dataDir;
    process.env.AUTH_REQUIRED = "true";
    vi.resetModules();
    ({ sqlite: authOnSqlite } = await import("../../server/db.ts"));
    ({ countPasswordAccounts } =
      await import("../../server/services/authService.ts"));
  });

  afterAll(() => {
    authOnSqlite.close();
    process.env.AUTH_REQUIRED = "";
    fs.rmSync(withAccount.dataDir, { recursive: true, force: true });
  });

  it("creates no local owner beside the real account", () => {
    const users = authOnSqlite
      .prepare("SELECT id, username, credentialState FROM users")
      .all() as { id: string; username: string; credentialState: string }[];
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe(withAccount.account!.username);
    expect(users[0].credentialState).toBe("password");
  });

  it("leaves every row with the account that already owned it", () => {
    const owner = withAccount.account!.id;
    for (const table of [
      "contacts",
      "lists",
      "dedupe_merge_log",
      "ai_invocations",
    ]) {
      const n = (
        authOnSqlite
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ownerId != ?`)
          .get(owner) as { n: number }
      ).n;
      expect(n, `${table}`).toBe(0);
    }
    // The four child tables had no ownerId at all in 1.5.5. They are backfilled
    // from the parent contact, so they land on the same account.
    for (const table of [
      "interactions",
      "action_items",
      "dedupe_suggestions",
      "dedupe_exclusions",
    ]) {
      const n = (
        authOnSqlite
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ownerId != ?`)
          .get(owner) as { n: number }
      ).n;
      expect(n, `${table}`).toBe(0);
    }
  });

  it("does not send a secured instance back through setup", () => {
    expect(countPasswordAccounts()).toBe(1);
  });

  it("passes every tenancy-verify check on this path too", () => {
    expect(verify(authOnSqlite).filter((c) => !c.ok)).toEqual([]);
  });

  it("moves that account's uploads under its own id", () => {
    const owner = withAccount.account!.id;
    for (const avatar of withAccount.avatarUrls) {
      const row = authOnSqlite
        .prepare("SELECT avatarUrl FROM contacts WHERE id = ?")
        .get(avatar.id) as { avatarUrl: string };
      expect(row.avatarUrl).toBe(`/uploads/u/${owner}/avatars/${avatar.file}`);
    }
  });
});
