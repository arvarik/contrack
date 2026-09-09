# 06. Phase 1: Storage and Migration

**Goal:** land every schema change from
[04-data-model-and-migration.md](04-data-model-and-migration.md) with an
idempotent boot migration, a pre-migration backup, and verification. After
this phase every row has an owner, the search structures can filter by
owner, the FTS triggers no longer scan the index on every update, and
uploads live under per-owner directories. Queries still do not filter (that
is Phase 2), so a single-account instance behaves as before.

**Lands on:** the `v2.0` branch. Not released alone, because the local owner
account changes what `/api/auth/status` reports on an auth-off instance and
the frontend needs Phase 4 to present that well.

**Size:** L (about 7 to 10 engineering days).

**Depends on:** Phase 0.

This document is written so that an implementer can work from it alone. The
exact DDL is repeated here. The reasoning behind each choice is in the data
model document. Every number marked "measured" comes from
[bench/review-2026-09-08/](bench/review-2026-09-08/README.md).

---

## 0. Context for the implementer

### 0.1 Repository, commands, and workflow

Same as Phase 0, section 0.1 and 0.2 of
[05-phase-0-foundations.md](05-phase-0-foundations.md). In short: Express 5
API in `server/`, React SPA in `src/`, one SQLite file through better-sqlite3
(SQLite 3.53.2) with sqlite-vec 0.1.9 and FTS5, raw idempotent DDL in
`server/db.ts` that runs at import time, three vitest projects. Work on a
feature branch `v2.0/phase-1-storage`, open the PR into `v2.0`, squash-merge.
`npm run lint` and `npm test` must pass. Paste the raw vitest summary line
into the PR. No AI attribution in commits or PRs. `package.json` stays at
`1.5.5`.

### 0.2 State at the start of this phase (after Phase 0)

- `server/tenancy/scope.ts` exports `Scope`, `OwnerId`, `scopeOf`, `scopeForUser`, `scopeForOwnerId`, `ownerToken`, `contactToken`.
- `server/tenancy/requestContext.ts` exports `runWithContext`, `getContext`, `currentScope`, `currentScopeOrNull`, `attachRequestContext`, mounted after `attachPrincipal` in `server/app.ts`.
- Every insert into an owned table sets `ownerId` from the request context when one exists. Background inserts still write `NULL`.
- `ROUTE_MANIFEST` and the recorder-based route test exist. The two-user harness exists. `bench-tenancy` exists.
- `BM25_WEIGHTS` has ten values. `mcpRouter` mounts before `contactsRouter`.
- `req.principal` is still `anonymous | user | service`.

### 0.3 Facts about `server/db.ts` and its neighbors that this phase edits

Line numbers are `v1.5.5`. Section labels are the `// N.` comments in the file.

| Section | Lines | What it does today |
| ------- | ----- | ------------------ |
| §1, §1a, §1b | 20-139 | Open the file, PRAGMAs (`journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`), load sqlite-vec, log `vec_version()` |
| §2 | 140-150 | Drizzle migrations `0000` (contacts, ten `contact_*` tables, interactions, interaction_mentions, lists, list_members, action_items) and `0001` (ai_invocations) |
| §2z | 151-199 | `users`, `sessions`, indexes, expired-session sweep |
| §2a | 201-262 | Dicebear avatar URL migration (`UPDATE contacts`) |
| §2a (duplicate label, becomes §2b in Phase 0) | 268-333 | Legacy AI-search cleanup (`UPDATE contact_interests`, `contact_experience`, `contact_education`) |
| §3 | 335-556 | `FTS_SCHEMA_VERSION = 1`, `user_version` gate, `contacts_fts` with ten columns and no `tokenize` option, eleven triggers, bulk backfill |
| §4, §5 | 558-605 | `contacts_auto_updated_at`, `interactions_auto_updated_at`, `action_items_auto_updated_at` (each `DROP TRIGGER IF EXISTS` then `CREATE`) |
| §6 | 607-658 | `action_items` (`IF NOT EXISTS`, also in Drizzle `0000`), `action_items_sync_insert/update/delete` (each `DROP` then `CREATE`) |
| §7, §8 | 660-705 | `relationshipScore` column guard, legacy `nextFollowUpAt` backfill that inserts `action_items` without `ownerId` |
| §9a, §9b | 713-731 | `canonicalId`, `phoneticHash` and its index |
| §9c, §9d, §9e | 733-782 | `dedupe_suggestions`, `dedupe_exclusions` (PK `contactIdA, contactIdB`, no `id`), `dedupe_merge_log` |
| §9f, §9f-b | 784-800 | `contact_embeddings` `vec0(contactId TEXT PRIMARY KEY, embedding FLOAT[768])`, `search_embeddings` `FLOAT[384]` |
| `vecTableWidth` | 810-815 | Private. Returns a string, `"unknown"` on no match |
| §9g, §9g2 | 828-852 | `dedupe_embedding_meta` (no FK), `app_settings` |
| §9i | 854-903 | `OWNED_TABLES = ["contacts","lists","ai_invocations","dedupe_merge_log"]`, `ownerId` ALTER guarded by `table_info`, `idx_<table>_owner` |
| §9h | 905-933 | Fifteen hot-path indexes, `PRAGMA optimize` |
| §10 | 935-965 | Phonetic hash backfill |

Other facts:

- `server/services/authService.ts:18` imports `sqlite, OWNED_TABLES` from `db.ts` and prepares statements at module top level (`:191-201`). `db.ts` cannot import it.
- `authService.ts` enumerates user columns by hand in `USER_COLUMNS` (`:178-179`), the `User` type (`:89-98`), `stripHash` (`:249-260`), `publicUser` (`:116-126`).
- `passwords.ts` hashes are `scrypt$N$r$p$salt$hash`. `parseHash` (`:151-156`) returns `null` when the part count is not six.
- `requireUser` (`server/middleware/auth.ts:278-294`) returns `403 USER_REQUIRED`. Seven routes use it (`routes/auth.ts:193, 199, 217, 234, 241, 257, 268`). `api.auth.test.ts:379` asserts the code.
- `isAuthRequired()` is `AUTH_REQUIRED === "true" || API_TOKEN is set` (`auth.ts:103-105`). Keep that rule.
- Every FTS trigger starts with `DELETE FROM contacts_fts WHERE contactId = ...`. `contactId` is `UNINDEXED`, so that is a full scan of the FTS table per firing: 4 ms at 40,000 rows, measured.
- `contacts_ai` (`:395-406`) lacks the `deletedAt IS NULL` guard the other triggers have.
- The search upsert is `DELETE` then `INSERT` (`localEmbeddings.ts:203-212`). The dedupe upsert is `INSERT OR REPLACE` (`dedupe/embeddings.ts:188`). `rebuildDedupeEmbeddingTable` (`dedupe/embeddings.ts:48`) is not exported. `rebuildSearchEmbeddingTable` (`localEmbeddings.ts:179`) is.
- `ai.embeddingsState` (search) and `ai.embeddingsState.dedupe` (dedupe) in `app_settings` hold the model signature and dimension. Both `ensure*Store` functions compare settings, not DDL, so a copy-rebuild does not trigger a re-embed.
- `findStaleEmbeddings` (`dedupe/embeddings.ts:298-313`) re-embeds any contact whose `updatedAt` is newer than its `embeddedAt`. Anything that stamps `updatedAt` on every contact causes a paid re-embed of the corpus.
- Multer `destination` callbacks ignore `req` today (`routes/contacts.ts:63-69`, `routes/interactions.ts:34-41`). Avatars go to `UPLOADS_DIR/avatars/`, attachments to `UPLOADS_DIR/`. `resolveUploadPath` (`server/utils/paths.ts:35-43`) is the containment check.
- `scripts/seed.ts` (`:18`, `:105`) and `scripts/seedMock.ts` (`:385`, `:499`) insert contacts and interactions through Drizzle with no `ownerId`. `npm run seed` and `npm run db:seed` call them.
- `tests/integration/api.auth.test.ts` inserts `NULL`-owned contacts at `:586`, `:605`, `:752-753`, `:760-761`, and `wipeAccounts()` (`:33`) runs `DELETE FROM sessions; DELETE FROM users;`.
- `geocode_cache` is created by `server/services/geocoding/cache.ts` at import time.

### 0.4 Verified engine behavior this phase relies on

| Fact | Consequence |
| ---- | ----------- |
| `VACUUM INTO` fails inside a transaction | The backup runs before `sqlite.transaction()` opens |
| `ALTER TABLE ADD COLUMN ... REFERENCES` works with `foreign_keys = ON` when the default is `NULL`; `NOT NULL DEFAULT 'x'` works; `REFERENCES` with a non-`NULL` default fails only on non-empty tables | The `ownerId` and `users` ALTERs below are legal. Never combine `REFERENCES` with a non-`NULL` default |
| `CREATE TRIGGER` does not validate column names; a `SELECT` in an `exec` does | The FTS backfill fails at prepare time if `contacts.ownerId` is missing, even with zero rows. Order matters |
| An `AFTER INSERT` trigger that `UPDATE`s its own row fires the table's `AFTER UPDATE` triggers; `recursive_triggers` is off | The fill triggers stamp `updatedAt` on the rare insert without an owner. Acceptable |
| FK cascades fire the child table's triggers | A contact delete fires `fts_emails_ad` per email. With `cidTok` each firing is cheap |
| `vec0` `TEXT PARTITION KEY` works; KNN with `ownerId = ?` filters; `DELETE`, `SELECT`, `COUNT` by partition work; `UPDATE` of the partition column fails; `IN` on it is unsupported; `k` max 4096; an `INSERT` without `ownerId` gets a `NULL` partition silently; `ALTER TABLE RENAME` breaks the table | Copy-rebuild only. Upserts are `DELETE` + `INSERT`. Verification counts `NULL` partitions |
| `DROP TABLE` and `CREATE VIRTUAL TABLE ... vec0` work inside a transaction | The copy-rebuild is one transaction per table |
| `vec_version()` returns `v0.1.9` (leading `v`, may carry `-alpha.N`) | Parse three integers; do not compare strings |

---

## 1. Deliverables

| # | Deliverable | Spec |
| - | ----------- | ---- |
| 1.1 | `users` columns, `api_tokens`, `invitations`, `user_settings`, `audit_log`, `app_settings` moved up | data model §2, §1.1 |
| 1.2 | `ensureLocalOwner`, `primaryAdminId`, `claimUnownedData` in `db.ts`; rewritten `reconcileOwnership`; `convertLocalOwner` | data model §3 |
| 1.3 | `ownerId` on four child tables with backfill and invariant triggers, `OWNED_TABLES` extended, triggers dropped around the claim | data model §4 |
| 1.4 | FTS v2: `ownerTok` and `cidTok`, `MATCH`-based deletes in every trigger, generated trigger template, `FTS_SCHEMA_VERSION = 2`, twelve BM25 weights | data model §5 |
| 1.5 | `vec0` partition-key rebuild by copy, `vec_version` check, rebuild helpers and upserts updated | data model §6 |
| 1.6 | Uploads relocation and `ownerUploadDir` | data model §7 |
| 1.7 | Composite indexes, `ANALYZE` | data model §8 |
| 1.8 | `TENANCY_SCHEMA_VERSION`, `VACUUM INTO` backup, boot ordering | data model §1 and §10 |
| 1.9 | `npm run tenancy:verify` script | data model §11 |
| 1.10 | Rollback script for uploads | data model §12 |
| 1.11 | Principal rewrite: `implicit` and `legacy-env-token` kinds, removal of `anonymous` and `service`, `requireSession`, `requireAdmin` | architecture §4.1, §4.2 |
| 1.12 | Upgrade test from a 1.5.5-shaped database | this document §3 |
| 1.13 | Test harness reset that survives the local owner | this document §2, task 1.13 |
| 1.14 | Seed scripts stamp the local owner | `scripts/seed.ts`, `scripts/seedMock.ts` |
| 1.15 | `src/db/schema.ts` mirror | data model §13 |
| 1.16 | CHANGELOG entry | `CHANGELOG.md` |

---

## 2. Tasks in order

### 1.1 Identity tables

Add these blocks to `server/db.ts` directly after §2z. Guard each
`ALTER TABLE users ADD COLUMN` with `table_info`, mirroring §9i.

```sql
-- 2z-1
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';           -- 'active' | 'disabled'
ALTER TABLE users ADD COLUMN credentialState TEXT NOT NULL DEFAULT 'password'; -- 'password' | 'none'
ALTER TABLE users ADD COLUMN mustChangePassword INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN passwordChangedAt TEXT;
ALTER TABLE users ADD COLUMN disabledAt TEXT;
ALTER TABLE users ADD COLUMN createdBy TEXT REFERENCES users(id) ON DELETE SET NULL;

-- 2z-2
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)); -- same DDL as §9g2
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE, tokenPrefix TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), lastUsedAt TEXT, expiresAt TEXT, revokedAt TEXT);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(userId);
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY, email TEXT, role TEXT NOT NULL DEFAULT 'member', tokenHash TEXT NOT NULL UNIQUE,
  invitedBy TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), expiresAt TEXT NOT NULL,
  acceptedAt TEXT, acceptedBy TEXT REFERENCES users(id) ON DELETE SET NULL, revokedAt TEXT);
CREATE TABLE IF NOT EXISTS user_settings (
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL,
  updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), PRIMARY KEY (userId, key));
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, actorUserId TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL,
  targetType TEXT, targetId TEXT, details TEXT, ip TEXT, createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP));
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actorUserId, createdAt DESC);

-- 2z-3: the three dedupe tables, identical DDL to §9c, §9d, §9e (those sections become no-ops)
```

Copy the exact `CREATE TABLE IF NOT EXISTS` text for `dedupe_suggestions`,
`dedupe_exclusions`, and `dedupe_merge_log` from §9c to §9e into 2z-3,
including their two indexes. They must exist before the tenancy block because
`OWNED_TABLES` names them.

Update `authService.ts`: `USER_COLUMNS`, the `User` type, `stripHash`, and
`publicUser` gain `status`, `credentialState`, `mustChangePassword`,
`passwordChangedAt`, `disabledAt`, `createdBy`. `publicUser` exposes
`status`, `mustChangePassword`, and `credentialState`; never `passwordHash`.

### 1.2 Local owner and claim (in `server/db.ts`)

Add to `server/db.ts`, exported, raw SQL, no imports from services:

```ts
export const OWNED_TABLES = [
  "contacts", "lists", "interactions", "action_items",
  "dedupe_suggestions", "dedupe_exclusions", "dedupe_merge_log", "ai_invocations",
] as const;

function countUsers(): number { /* SELECT COUNT(*) FROM users */ }

export function primaryAdminId(): string {
  // SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY createdAt ASC LIMIT 1
  // throws if none: impossible after ensureLocalOwner has run once
}

export function ensureLocalOwner(): string {
  const existing = sqlite.prepare(`SELECT id FROM users WHERE credentialState = 'none' LIMIT 1`).get() as { id: string } | undefined;
  if (existing) return existing.id;
  if (countUsers() > 0) return primaryAdminId();
  const id = crypto.randomUUID();
  sqlite.prepare(`
    INSERT INTO users (id, email, username, displayName, passwordHash, role, credentialState)
    VALUES (?, 'local@contrack.local', 'local', 'This device', 'none$', 'admin', 'none')
  `).run(id);
  return id;
}

export function claimUnownedData(ownerId: string): Record<string, number> {
  // for each table in OWNED_TABLES: UPDATE <t> SET ownerId = ? WHERE ownerId IS NULL
  // return { table: changes }
}
```

`'none$'` never verifies: `parseHash` rejects any hash that does not split
into six parts. Move the existing `claimUnownedData` body out of
`authService.ts` into `db.ts` and have `authService.ts` import it, the same
way it imports `OWNED_TABLES`.

In `server/services/authService.ts`:

- `reconcileOwnership()` becomes `const owner = ensureLocalOwner(); claimUnownedData(owner);`. Delete the "exactly one user" guard. `server/app.ts:113` keeps calling it.
- `countUnownedContacts()` stays for the setup screen, but its meaning shifts to "contacts owned by the local owner account": `WHERE ownerId = (SELECT id FROM users WHERE credentialState = 'none') AND deletedAt IS NULL AND isGhost = 0`. Rename it `countDeviceContacts()`. The status payload field becomes `deviceContacts` (Phase 3 finishes the API rename; do both names in the payload from this phase so the current frontend keeps working).
- `createUser` keeps "first account is admin". Add `convertLocalOwner(input)`: sets email, username, displayName, passwordHash, `credentialState = 'password'`, `passwordChangedAt = now`, keeps `id` and `role = 'admin'`. `POST /api/auth/setup` calls `convertLocalOwner` when a `credentialState = 'none'` row exists, else `createUser`. Ownership does not move, because the id does not change.
- `setupRequired` in `/status` becomes `isAuthRequired() && COUNT(users WHERE credentialState = 'password') = 0`.
- `validateUsername` rejects `local` (Q11 in the risks document). Today's pattern accepts it.

Auth-off validity rule: at boot, if `!isAuthRequired()` and
`SELECT COUNT(*) FROM users WHERE credentialState = 'password' > 0`, log
`error` and set an in-process flag `forcedAuth = true` that `isAuthRequired()`
returns. The log line: "AUTH_REQUIRED is false but accounts exist. Auth is
enforced. Set AUTH_REQUIRED=true to silence this." The boot check lives in
`server/app.ts` next to `reconcileOwnership()`.

### 1.3 Child ownership, trigger drops, and invariant triggers

All inside the tenancy block (task 1.8), in this order:

1. `ownerId` on all eight `OWNED_TABLES`, the same `table_info`-guarded loop as today's §9i, moved here. Keep the single-column `idx_<table>_owner` creation for now.
2. Drop the seventeen triggers:

   ```sql
   DROP TRIGGER IF EXISTS contacts_ai;  DROP TRIGGER IF EXISTS contacts_au;  DROP TRIGGER IF EXISTS contacts_ad;
   DROP TRIGGER IF EXISTS fts_tags_ai;  DROP TRIGGER IF EXISTS fts_tags_ad;
   DROP TRIGGER IF EXISTS fts_interests_ai;  DROP TRIGGER IF EXISTS fts_interests_ad;
   DROP TRIGGER IF EXISTS fts_emails_ai;  DROP TRIGGER IF EXISTS fts_emails_ad;
   DROP TRIGGER IF EXISTS fts_phones_ai;  DROP TRIGGER IF EXISTS fts_phones_ad;
   DROP TRIGGER IF EXISTS contacts_auto_updated_at;  DROP TRIGGER IF EXISTS interactions_auto_updated_at;
   DROP TRIGGER IF EXISTS action_items_auto_updated_at;
   DROP TRIGGER IF EXISTS action_items_sync_insert;  DROP TRIGGER IF EXISTS action_items_sync_update;
   DROP TRIGGER IF EXISTS action_items_sync_delete;
   ```

   Why: the claim and the backfill are bulk `UPDATE`s. With the triggers in place, `contacts_au` costs 5.4 ms per row (27 s per 5,000 rows measured) and the `_auto_updated_at` triggers stamp `updatedAt`, which makes the next deep dedupe scan re-embed the whole corpus through the paid provider. §3, §4, §5, and §6 of the file recreate all seventeen on the same boot; each already begins with `DROP TRIGGER IF EXISTS`.

3. `ensureLocalOwner()` then `claimUnownedData(owner)`.
4. Backfill:

   ```sql
   UPDATE interactions       SET ownerId = (SELECT ownerId FROM contacts WHERE id = interactions.contactId)      WHERE ownerId IS NULL;
   UPDATE action_items       SET ownerId = (SELECT ownerId FROM contacts WHERE id = action_items.contactId)      WHERE ownerId IS NULL;
   UPDATE dedupe_suggestions SET ownerId = (SELECT ownerId FROM contacts WHERE id = dedupe_suggestions.contactIdA) WHERE ownerId IS NULL;
   UPDATE dedupe_exclusions  SET ownerId = (SELECT ownerId FROM contacts WHERE id = dedupe_exclusions.contactIdA)  WHERE ownerId IS NULL;
   ```

5. Invariant triggers, all `CREATE TRIGGER IF NOT EXISTS`:

   ```sql
   -- required on insert: contacts, lists, dedupe_merge_log, ai_invocations
   CREATE TRIGGER IF NOT EXISTS contacts_owner_required BEFORE INSERT ON contacts
   WHEN NEW.ownerId IS NULL BEGIN SELECT RAISE(ABORT, 'contacts.ownerId is required'); END;

   -- fill from parent: interactions, action_items (by contactId), dedupe_suggestions (by contactIdA)
   CREATE TRIGGER IF NOT EXISTS interactions_owner_fill AFTER INSERT ON interactions
   WHEN NEW.ownerId IS NULL BEGIN
     UPDATE interactions SET ownerId = (SELECT ownerId FROM contacts WHERE id = NEW.contactId) WHERE id = NEW.id;
   END;
   -- dedupe_exclusions has no id column: key on the composite primary key
   CREATE TRIGGER IF NOT EXISTS dedupe_exclusions_owner_fill AFTER INSERT ON dedupe_exclusions
   WHEN NEW.ownerId IS NULL BEGIN
     UPDATE dedupe_exclusions SET ownerId = (SELECT ownerId FROM contacts WHERE id = NEW.contactIdA)
      WHERE contactIdA = NEW.contactIdA AND contactIdB = NEW.contactIdB;
   END;

   -- mismatch check: interactions, action_items (contactId); dedupe_suggestions, dedupe_exclusions (both A and B)
   CREATE TRIGGER IF NOT EXISTS interactions_owner_check BEFORE INSERT ON interactions
   WHEN NEW.ownerId IS NOT NULL AND NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.contactId)
   BEGIN SELECT RAISE(ABORT, 'interactions.ownerId does not match contact owner'); END;

   -- propagate: contacts
   CREATE TRIGGER IF NOT EXISTS contacts_owner_propagate AFTER UPDATE OF ownerId ON contacts
   WHEN NEW.ownerId IS NOT OLD.ownerId BEGIN
     UPDATE interactions       SET ownerId = NEW.ownerId WHERE contactId = NEW.id;
     UPDATE action_items       SET ownerId = NEW.ownerId WHERE contactId = NEW.id;
     UPDATE dedupe_suggestions SET ownerId = NEW.ownerId WHERE contactIdA = NEW.id OR contactIdB = NEW.id;
     UPDATE dedupe_exclusions  SET ownerId = NEW.ownerId WHERE contactIdA = NEW.id OR contactIdB = NEW.id;
   END;
   ```

   The propagate trigger cannot touch the `vec0` tables (`UPDATE` of a partition key is refused). That is fine: the only owner change in 2.0 is the one-time claim, which runs before the `vec0` rebuild reads `contacts.ownerId`.

Then update the tests that insert `NULL`-owned rows directly
(`api.auth.test.ts:586`, `:605`, `:752-753`, `:760-761`): insert with the
local owner's id and assert that setup **converts** the local owner rather
than claiming from `NULL`.

### 1.4 FTS v2

Replace the eleven hand-written triggers with a generator:

```ts
const FTS_COLS = "contactId, name, company, role, headline, location, about, industry, extras, searchExpansion, ownerTok, cidTok";
function ftsRowSelect(alias: string): string {
  return `SELECT ${alias}.id, ${alias}.name, ${alias}.company, ${alias}.role, ${alias}.headline, ${alias}.location,
          ${alias}.about, ${alias}.industry, <the four GROUP_CONCAT subselects as today>, COALESCE(${alias}.searchExpansion, ''),
          'o' || replace(${alias}.ownerId, '-', ''), 'c' || replace(${alias}.id, '-', '')`;
}
function ftsDelete(idExpr: string): string {
  return `DELETE FROM contacts_fts WHERE contacts_fts MATCH 'cidTok:c' || replace(${idExpr}, '-', '')`;
}
function childTrigger(table: string, event: "ai" | "ad"): string {
  // ${ftsDelete(`${NEW|OLD}.contactId`)}; INSERT INTO contacts_fts(${FTS_COLS}) ${ftsRowSelect("c")} FROM contacts c
  //   WHERE c.id = ${NEW|OLD}.contactId AND c.deletedAt IS NULL;
}
```

Rules:

1. The table DDL becomes `fts5(contactId UNINDEXED, name, company, role, headline, location, about, industry, extras, searchExpansion, ownerTok, cidTok)`. No `tokenize` option, as today.
2. Every delete inside a trigger uses `ftsDelete(...)`. **Never** `WHERE contactId = ...`, which scans the table.
3. `contacts_ai` gains `WHERE new.deletedAt IS NULL` (missing today).
4. `contacts_au` stays `AFTER UPDATE ON contacts` with no column list.
5. The bulk backfill at the end of §3 uses `ftsRowSelect("c")` with `WHERE c.deletedAt IS NULL`.
6. `FTS_SCHEMA_VERSION = 2`.
7. `BM25_WEIGHTS` in `hybridRetrieval.ts` becomes twelve values: `"0.0, 10.0, 5.0, 3.0, 2.0, 2.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0"` (or the preserve-today variant if Q13 decided that way). `searchService.searchFts` (`:193-208`) uses `ORDER BY rank` and needs no weight change.

Snapshot-test the generated SQL (`tests/unit/ftsTriggers.test.ts`). Log the
rebuild duration. Expected: the bulk backfill took 233 ms for 50,000 contacts
in the review; a 10,000-contact instance should log well under one second.

Verify with a test that updates 1,000 contacts in a loop on a 5,000-contact
database and asserts the loop finishes in under 500 ms (the same loop takes
about 5 s with the old triggers).

### 1.5 vec0

In `server/db.ts` (a new §9k after §9f-b):

1. Parse `SELECT vec_version()`: strip the leading `v`, split on `.` and `-`, compare `[major, minor, patch]` to `[0, 1, 6]`. On failure, `throw new Error("sqlite-vec >= 0.1.6 is required for partitioned vector search; found " + v)`.
2. Change the `CREATE VIRTUAL TABLE IF NOT EXISTS` DDL in §9f and §9f-b to include `ownerId TEXT PARTITION KEY` between `contactId` and `embedding`, so a fresh database gets the partition key directly.
3. For each of `search_embeddings`, `contact_embeddings`: read `sql` from `sqlite_master`; if it lacks `PARTITION KEY` (case-insensitive), run the copy rebuild inside one `sqlite.transaction`: read `SELECT e.contactId, c.ownerId, e.embedding FROM <t> e JOIN contacts c ON c.id = e.contactId` in chunks of 5,000, `DROP TABLE <t>`, `CREATE VIRTUAL TABLE <t> USING vec0(contactId TEXT PRIMARY KEY, ownerId TEXT PARTITION KEY, embedding FLOAT[<dim>])`, reinsert. Read `<dim>` by parsing `vecTableWidth()` to an integer; throw with a clear message if it is `"unknown"`. Log rows copied and the duration (0.9 s per 50,000 × 384-dim rows measured). **Never** `ALTER TABLE ... RENAME` a `vec0` table.

In `server/services/search/localEmbeddings.ts` and
`server/services/dedupe/embeddings.ts`:

- `rebuildSearchEmbeddingTable` and `rebuildDedupeEmbeddingTable` emit the partition key column. Export the dedupe one. A unit test asserts their DDL strings equal the string in `db.ts`.
- `_upsertTxn`, `_stmts.upsert`, `upsertSearchEmbedding`, `storeEmbedding`, `storeEmbeddings`, `embedContact`, `generateAndStoreEmbedding`, `generateAndStoreBulkEmbeddings`, `reEmbedStaleContacts`, and both backfills supply `ownerId`, read from `contacts` by id inside the same transaction. New signature: `upsertSearchEmbedding(contactId, ownerId, embedding)`.
- Every upsert is `DELETE` then `INSERT`. Run the existing `INSERT OR REPLACE` against a partitioned table in the day-one smoke test; if it fails on 0.1.9, replace it (risks document T24).
- KNN statements do **not** yet filter by owner. That is Phase 2c. But the partition column must be populated for every row from this phase on, or Phase 2c's filter returns nothing for new rows.

Day-one smoke test: run `bench/review-2026-09-08/01-vec-fts-smoke.cjs`
against the installed `node_modules` and paste its output into the PR.

### 1.6 Uploads

- `server/utils/paths.ts`: add `ownerUploadDir(ownerId: string, kind: "avatars" | "files"): string` and `ownerUploadUrl(ownerId, kind, filename)`. Both validate `ownerId` against `/^[0-9a-f-]{36}$/` so a malformed id cannot form a path segment. Layout: `UPLOADS_DIR/u/<ownerId>/avatars/` and `UPLOADS_DIR/u/<ownerId>/files/`. `logos/` stays shared.
- Multer `destination` callbacks in `server/routes/contacts.ts` and `server/routes/interactions.ts` resolve the directory from `req.principal` (multer passes `req` as the first argument; do not rely on the async context here) and call `ensureDir`. After Phase 1 every authenticated request has a user principal.
- `contactService.updateAvatar` (`:637`), `avatarProcessor` (`:47-48`, `:65`), and `interactionService.handleAttachment` (`:310`, `:342`, `:370`) build URLs with `ownerUploadUrl`.
- `server/db.ts` §11 relocation, run once per boot after the database migration, idempotent:
  1. `SELECT id, ownerId, avatarUrl FROM contacts WHERE avatarUrl LIKE '/uploads/avatars/%'`. Move each file to `u/<ownerId>/avatars/<file>` and rewrite `avatarUrl`. Missing source file: rewrite the URL only.
  2. `SELECT id, ownerId, fileUrl FROM interactions WHERE fileUrl LIKE '/uploads/%' AND fileUrl NOT LIKE '/uploads/u/%' AND fileUrl NOT LIKE '/uploads/logos/%'`. Same, into `files/`.
  3. Leave `/api/avatar/...` and external `https://` URLs alone.
  4. Move unreferenced files in the flat directories to `UPLOADS_DIR/orphaned/` and log them. Delete nothing.
- `scripts/tenancy-rollback-uploads.mjs` reverses the moves using the restored 1.x database's URLs.

The `/uploads` ownership guard middleware is Phase 2a. In Phase 1 alone, the
old flat path returns 404 for relocated files and the new path is served to
any authenticated principal, which is the same exposure as today.

### 1.7 Indexes

Inside the tenancy block, after the columns exist, all `IF NOT EXISTS`:

```sql
CREATE INDEX IF NOT EXISTS idx_contacts_owner_status    ON contacts(ownerId, isGhost, isArchived, canonicalId);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_deleted   ON contacts(ownerId, deletedAt);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_lastc     ON contacts(ownerId, lastContactedAt);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_added     ON contacts(ownerId, addedAt);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_score     ON contacts(ownerId, relationshipScore);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_phonetic  ON contacts(ownerId, phoneticHash);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_canon     ON contacts(ownerId, canonicalId);
CREATE INDEX IF NOT EXISTS idx_interactions_owner_date  ON interactions(ownerId, date);
CREATE INDEX IF NOT EXISTS idx_action_items_owner_due   ON action_items(ownerId, dueAt) WHERE completedAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_action_items_owner_done  ON action_items(ownerId, completedAt);
CREATE INDEX IF NOT EXISTS idx_lists_owner_sort         ON lists(ownerId, sortOrder);
CREATE INDEX IF NOT EXISTS idx_dedupe_sugg_owner_status ON dedupe_suggestions(ownerId, status);
CREATE INDEX IF NOT EXISTS idx_dedupe_sugg_owner_conf   ON dedupe_suggestions(ownerId, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_dedupe_excl_owner        ON dedupe_exclusions(ownerId);
CREATE INDEX IF NOT EXISTS idx_merge_log_owner_at       ON dedupe_merge_log(ownerId, mergedAt DESC);
CREATE INDEX IF NOT EXISTS idx_ai_inv_owner_created     ON ai_invocations(ownerId, createdAt DESC);
```

Then `ANALYZE` (new) after the FTS and `vec0` steps. Do not drop the
single-column owner indexes yet (Phase 2i).

### 1.8 Version, backup, and boot order

- `export const TENANCY_SCHEMA_VERSION = 1;` `readTenancyVersion()` and `writeTenancyVersion()` read and write `app_settings` key `schema.tenancy` with raw SQL.
- Backup: when the version is behind and `SELECT COUNT(*) FROM contacts > 0`, and **before** any transaction opens: check `fs.statfsSync(DATA_DIR)` free bytes against 1.5 × the database file size; if enough, `VACUUM INTO '<DATA_DIR>/backups/pre-tenancy-<ISO stamp>.db'` (append a counter if the file exists); if not enough, log `error` and continue without a backup. Log the file name.
- Wrap tasks 1.1 (2z-1 to 2z-3 are outside the transaction; they are `IF NOT EXISTS`), 1.3, 1.7, and the version write in one `sqlite.transaction`. Log each sub-step with its row count and duration in the style of the existing `log.info("Database", ...)` lines.
- Final section order in the file:

| § | Step |
| - | ---- |
| 2 | Drizzle migrations |
| 2z | `users`, `sessions` |
| 2z-1, 2z-2, 2z-3 | task 1.1 |
| 2z-4 | tenancy block: version read, backup, transaction (columns, trigger drops, local owner, claim, backfill, invariant triggers, composite indexes, version write) |
| 2a, 2b | unchanged |
| 3 | FTS v2 (task 1.4) |
| 4, 5, 6 | unchanged; they recreate the six non-FTS triggers |
| 7, 8 | unchanged; the §8 backfill's `action_items` inserts get `ownerId` from the fill trigger |
| 9a, 9b | unchanged |
| 9c to 9e | now no-ops |
| 9f, 9f-b | `vec0` DDL with the partition key |
| 9k | `vec0` copy rebuild (task 1.5) |
| 9g, 9g2 | unchanged (`app_settings` now a no-op) |
| 9i | reduced to a guard that throws if any owned table lacks `ownerId` |
| 9h | unchanged, then `ANALYZE` |
| 10 | unchanged |
| 11 | uploads relocation (task 1.6) |

`reconcileOwnership()` in `server/app.ts:113` calls `ensureLocalOwner()` and
`claimUnownedData()` unconditionally. With every row already owned, it is a
no-op after the first boot.

### 1.9 Verify script

`scripts/tenancy-verify.ts` opens the database read-only, runs the eleven
query groups in data model §11 (no unowned rows; child owner equals parent
owner; FTS count equals active contacts; every FTS row has the right
`ownerTok` and `cidTok`; both `vec0` tables have `PARTITION KEY` in their
DDL; no `NULL` partitions; every vector row's owner equals its contact's
owner; no legacy flat upload URLs; at most one local owner; the seventeen
triggers exist), prints a pass or fail table, and exits non-zero on any
failure. Add `"tenancy:verify": "tsx scripts/tenancy-verify.ts"` to
`package.json`.

### 1.10 Rollback script

`scripts/tenancy-rollback-uploads.mjs`: given `DATA_DIR`, reads the restored
1.x database's `avatarUrl` and `fileUrl` values and moves files from
`uploads/u/<ownerId>/avatars/` back to `uploads/avatars/` and from
`uploads/u/<ownerId>/files/` back to `uploads/`. Prints what it moved. The
full rollback procedure is data model §12: stop, restore
`backups/pre-tenancy-<stamp>.db` over `curator.db` (remove `-wal` and
`-shm`), run this script, start the 1.x image.

### 1.11 Principal rewrite

In `server/middleware/auth.ts`:

- `Principal` becomes:

  ```ts
  export type Principal =
    | { kind: "user"; user: User; via: "session"; sessionId: string }
    | { kind: "user"; user: User; via: "token"; tokenId: string }
    | { kind: "user"; user: User; via: "implicit" }
    | { kind: "user"; user: User; via: "legacy-env-token" };
  ```

- `attachPrincipal` order:
  1. `Bearer ctk_...` → SHA-256 the token, look up `api_tokens` by `tokenHash`; reject `revokedAt`, past `expiresAt`, or a `disabled` user. Phase 3 adds the creation endpoints; Phase 1 adds the lookup and tests it with a row inserted directly.
  2. `Bearer <env API_TOKEN>` (timing-safe compare, as today) → `{ kind: "user", user: primaryAdmin, via: "legacy-env-token" }`. Warn once at boot when `API_TOKEN` or `AUTH_TOKEN` is set.
  3. Cookie → `session` as today, plus reject `status = 'disabled'`.
  4. No credential and `!isAuthRequired()` → `{ kind: "user", user: localOwner, via: "implicit" }`. Cache the local owner row in memory; refresh it when `convertLocalOwner` runs.
  5. Otherwise leave `req.principal` unset.
- `requireUser` is renamed `requireSession` and passes only `via === "session"`. Its error code becomes `403 SESSION_REQUIRED`. Update the seven call sites in `server/routes/auth.ts` and the assertion at `api.auth.test.ts:379`. This is a documented breaking change (API changes document).
- `requireAdmin` is added: `principal.user.role === "admin"`, else `403 ADMIN_REQUIRED`. Not yet mounted anywhere. Phase 2g and Phase 3 mount it.
- `currentUser(req)` always returns a user for an authenticated request. Its return type drops `null`.
- `scopeOf(req)` in `server/tenancy/scope.ts` drops the 401 branch for anonymous, because that kind no longer exists.
- `isAuthRequired()` keeps returning true when `API_TOKEN` is set, and also when the boot flag `forcedAuth` is set (task 1.2).

Update `api.auth.test.ts`:

- "leaves everything open when AUTH_REQUIRED is off" still passes, but now asserts `/api/auth/status` reports `user.username === "local"` and `via` is not exposed on status.
- "admits a bearer token without any account existing" changes: with a local owner always present, the token maps to that account. Assert `GET /api/auth/me` with the token returns `403 SESSION_REQUIRED` and a data endpoint works.
- "cannot reach account endpoints, there is no account behind a token" (`:374`): the code changes from `USER_REQUIRED` to `SESSION_REQUIRED`.
- Add: "disabled account cannot sign in and its live session stops working".
- Add: "auth-off with a real account forces auth on" (boot flag).
- Add: "the `local` username cannot be registered".

### 1.12 Upgrade test

`tests/integration/tenancy.migration.test.ts`:

1. Open a fresh temp `DATA_DIR`. Before importing `server/db.ts`, build a 1.5.5-shaped database with `tests/fixtures/make-v1-database.ts`: run the two Drizzle migrations, create `users`, `sessions`, `app_settings` (with `ai.embeddingsState` and `ai.embeddingsState.dedupe` rows so no re-embed is triggered), `geocode_cache`, the dedupe tables, `dedupe_embedding_meta`, the two `vec0` tables **without** partition keys, the eleven v1 FTS triggers and the six other triggers, add `ownerId` to the four original tables, and insert 50 contacts with `ownerId = NULL` and distinct `updatedAt` values, 20 interactions, 5 action items, 3 lists, 2 dedupe suggestions, 10 rows in each `vec0` table with random vectors and matching `dedupe_embedding_meta` rows, 5 avatar files in `uploads/avatars/`, and 2 attachments in `uploads/`. Save a KNN result for a fixed query vector and the `updatedAt` map. This fixture is the only place that knows the old shape; comment it with the release it reproduces.
2. Import `server/db.ts`. The migration runs.
3. Assert every query group in data model §11 passes.
4. Assert the vector row counts are unchanged and the KNN for the fixed query returns the same nearest neighbor.
5. Assert `updatedAt` is byte-identical for every contact and interaction (the trigger-drop rule), and that the AI mock's `embedBatch` was never called.
6. Assert the backup file exists and opens with the old shape.
7. Import again (clear the module cache) and assert no log line reports a change and the version is unchanged.
8. Run the same file with `AUTH_REQUIRED=true` and one real account in the fixture: the local owner is not created, the account keeps its rows, `setupRequired` is false.

### 1.13 Test harness reset

`resetAccounts()` in `tests/integration/tenancy/helpers.ts` (and
`wipeAccounts()` in `api.auth.test.ts`) can no longer run `DELETE FROM users`
alone: the local owner owns rows and `ON DELETE RESTRICT` refuses. New shape:
delete every owned table's rows, `DELETE FROM sessions`,
`DELETE FROM api_tokens`, `DELETE FROM users`, then `ensureLocalOwner()`.
Every other integration file runs auth-off (`tests/integration-setup.ts`
sets `AUTH_REQUIRED=""`), so their rows belong to the local owner and they
pass unchanged.

### 1.14 Seed scripts

`scripts/seed.ts` and `scripts/seedMock.ts` import `server/db.ts`, so the
migration and `ensureLocalOwner` have run by the time they insert. Both set
`ownerId: ensureLocalOwner()` on every contact and interaction insert (or on
contacts only and let the fill trigger handle interactions). Without this the
`contacts_owner_required` trigger rejects the first insert.

### 1.15 Schema mirror

`src/db/schema.ts`: add the six `users` columns; new tables `apiTokens`,
`invitations`, `userSettings`, `auditLog` with relations to `users`;
`ownerId` on `interactions`, `actionItems`, `dedupeSuggestions`,
`dedupeExclusions` with `owner` relations. Rewrite the OWNERSHIP comment block
to state: `ownerId` is never `NULL` after boot, the four child tables carry a
denormalized copy kept consistent by triggers, and the local owner account is
what makes auth-off mode work.

### 1.16 CHANGELOG

Under Unreleased, a `Phase 1` block: the migration and its backup, the local
owner account, the FTS trigger fix (state the measured before and after), the
`vec0` partition rebuild with no provider calls, the uploads layout, the
`SESSION_REQUIRED` rename as a breaking change.

---

## 3. Acceptance criteria

- [ ] All Phase 0 criteria still hold.
- [ ] `tenancy.migration.test.ts` passes, including the second-boot idempotency check, the `updatedAt` check, and the no-`embedBatch` check.
- [ ] `npm run tenancy:verify` passes on: a fresh database, a migrated 1.5.5 fixture, a copy of a real 1.5.5 database with auth off, and one with auth on.
- [ ] FTS rebuild time is logged and is under 1 s for 10,000 contacts.
- [ ] Updating 1,000 contacts on a 5,000-contact database takes under 500 ms (the `cidTok` trigger fix).
- [ ] Boot fails with a clear message when `vec_version()` is below 0.1.6 (unit test with a stubbed statement).
- [ ] The day-one `vec0` smoke test output is in the PR.
- [ ] Uploads: after migration, old URLs are gone from both columns and files exist at the new paths. Orphans land in `uploads/orphaned/`.
- [ ] `api.auth.test.ts` green with the new principal kinds and `SESSION_REQUIRED`.
- [ ] `npm run seed` works on a fresh `DATA_DIR`.
- [ ] Rollback rehearsal documented in `docs/multi-tenant-plan/bench/rollback-rehearsal.md` with the exact commands run and their output.
- [ ] `src/db/schema.ts` compiles and `tsc --noEmit` passes with the new types.
- [ ] Every boot step logs its duration; a fresh test database boots in under 1 s more than before this phase.

---

## 4. Risks

| Risk | Mitigation |
| ---- | ---------- |
| A trigger-based `NOT NULL` breaks a code path that inserted without an owner and relied on the boot claim | Phase 0 stamped every insert. The Phase 1 suite runs with `AUTH_REQUIRED=true` **and** with auth off. Any remaining path fails loudly with `ownerId is required`, which is the intended behavior. |
| `VACUUM INTO` needs disk space | About one database size. The free-space check skips the backup with an `error` log rather than failing the boot. The rotating `curator-*.db` snapshots remain. |
| The vector copy on a huge instance takes long | Chunked at 5,000 rows, logged. 50,000 × 384-dim measured at 0.9 s. |
| An operator runs 1.x against a migrated database | The 1.x code finds partitioned `vec0` tables and its inserts lack `ownerId`, which now get a `NULL` partition rather than an error, and its FTS triggers reference columns that exist. It will run, but its rows are unowned. Document: downgrade requires the backup restore in data model §12. |
| A crash between the trigger drops and the FTS rebuild | The next boot re-runs the tenancy block (no-op) and §3 to §6 recreate all seventeen triggers unconditionally. |
| `INSERT OR REPLACE` fails on a partitioned `vec0` table | Smoke-tested on day one. Fallback is `DELETE` + `INSERT`, which the search store already uses. |

---

## 5. Contract this phase delivers to Phase 2

- Every row in every owned table has a non-`NULL` `ownerId`. Triggers enforce it on insert.
- `contacts_fts` has indexed `ownerTok` and `cidTok`. `ownerToken(scope)` and `contactToken(id)` match the SQL.
- Both `vec0` tables have `ownerId TEXT PARTITION KEY` and every row carries it.
- Composite indexes exist. The single-column owner indexes still exist.
- Every request that passes `requireAuth` has a `user` principal. `requireSession` and `requireAdmin` exist.
- Uploads live under `uploads/u/<ownerId>/`. `ownerUploadDir` and `ownerUploadUrl` exist.
- The local owner account exists on every instance; setup converts it.

---

## 6. Do not do in this phase

- Do not add `WHERE ownerId = ?` to reads. Phase 2.
- Do not mount `requireAdmin` anywhere. Phase 2g and 3.
- Do not add the `/uploads` guard. Phase 2a.
- Do not drop the single-column owner indexes. Phase 2i.
- Do not rename any `vec0` table.
