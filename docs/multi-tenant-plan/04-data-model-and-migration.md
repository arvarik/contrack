# 04. Data Model and Migration

This document is the exact schema change set and the boot-time migration that
applies it. Phase 1 implements this document. Phase 2 depends on every column
and index named here.

Conventions:

- DDL lives in `server/db.ts` as idempotent numbered sections, following the
  precedent set by `users`, `sessions`, `app_settings`, and the dedupe tables.
  Every new table and column is mirrored in `src/db/schema.ts` so Drizzle
  types stay correct. No `drizzle-kit generate` migration is produced for
  these changes. The reason is in section 9.
- Every statement below is safe to run twice. The migration runs on every
  boot and does nothing after the first successful run.
- `ownerId` is `TEXT REFERENCES users(id) ON DELETE RESTRICT` everywhere. The
  `RESTRICT` choice is unchanged from today: deleting an account that still
  owns data must fail, and the admin delete flow in Phase 3 decides what to
  do with the data first.
- Every number marked "measured" comes from
  [bench/review-2026-09-08/](bench/review-2026-09-08/README.md), run on
  SQLite 3.53.2 and sqlite-vec 0.1.9.
- The tenancy helpers (`ensureLocalOwner`, `primaryAdminId`,
  `claimUnownedData`) are written in `server/db.ts` as raw SQL and exported.
  `server/services/authService.ts` imports `sqlite` and `OWNED_TABLES` from
  `db.ts` and runs `sqlite.prepare` at module top level, so `db.ts` cannot
  import `authService` without an import cycle that throws at boot.

---

## 1. Migration versioning and safety

### 1.1 Version slot

`PRAGMA user_version` already holds `FTS_SCHEMA_VERSION`. A second integer
cannot share that slot (it is one 32-bit field at offset 60 of the header).
The tenancy migration stores its version in `app_settings` under the key
`schema.tenancy`, read and written with raw SQL inside `server/db.ts` (the
settings service cannot be imported there without a cycle). `app_settings`
is created today at §9g2, which runs after the point where the tenancy block
now sits (section 10). The tenancy block therefore runs the same
`CREATE TABLE IF NOT EXISTS app_settings (...)` statement first, and §9g2
becomes a no-op.

```ts
// server/db.ts
export const TENANCY_SCHEMA_VERSION = 1;

function readTenancyVersion(): number {
  const row = sqlite
    .prepare(`SELECT value FROM app_settings WHERE key = 'schema.tenancy'`)
    .get() as { value: string } | undefined;
  return row ? Number(JSON.parse(row.value)) : 0;
}
```

### 1.2 Backup before the first run

When `readTenancyVersion() < TENANCY_SCHEMA_VERSION` and the `contacts` table
has at least one row, the migration first writes a full copy of the database:

```sql
VACUUM INTO '<DATA_DIR>/backups/pre-tenancy-<ISO stamp>.db';
```

`VACUUM INTO` is synchronous, works in WAL mode, and produces a consistent
single-file copy of the committed state. It is used instead of
`sqlite.backup()` because that API is asynchronous and `server/db.ts` runs at
import time. The file is not subject to the normal rotation in
`backupService` because its name does not start with `curator-`. The log line
names the file. The docs tell the operator to delete it once they trust the
upgrade.

Rules, all verified:

- `VACUUM INTO` fails with "cannot VACUUM from within a transaction". It runs before `sqlite.transaction()` opens, never inside it.
- The target file must not exist. The ISO stamp in the name makes a collision impossible on one boot; the code still checks and appends a counter if the file exists.
- Free space needed is about one compacted copy of the database, not two. The code reads `fs.statfsSync(DATA_DIR)` and skips the backup with an `error` log when free space is below 1.5 × the database file size. It never fails the boot for a missing backup, because the operator can restore from the rotating `curator-*.db` snapshots.
- `PRAGMA synchronous` must not be `OFF` for the copy to be fsynced. The app sets `NORMAL`.

### 1.3 Transaction boundary

The order is fixed by three constraints found in the review: the FTS block
references `contacts.ownerId`, so the column must exist first; the claim
`UPDATE` fires every trigger on `contacts`, so the expensive triggers must be
absent while it runs; and `VACUUM INTO` cannot run inside a transaction.

1. **Backup.** `VACUUM INTO`, outside any transaction, only when the version is behind and `contacts` has rows.
2. **Transaction A, the tenancy block.** `app_settings` if missing. `users` columns. Identity tables. The three dedupe tables if missing (identical DDL to §9c to 9e). `ownerId` on all eight owned tables. `DROP TRIGGER IF EXISTS` for the eleven FTS triggers, the three `_auto_updated_at` triggers, and the three `action_items_sync_*` triggers. `ensureLocalOwner`. `claimUnownedData`. Child backfill. Invariant triggers. Composite indexes. Write `schema.tenancy`. One `sqlite.transaction`, measured under 1 s per 50,000 contacts once the triggers are gone.
3. **FTS v2.** The existing `user_version` gate drops and recreates `contacts_fts` with its eleven triggers and runs the bulk backfill (233 ms per 50,000 rows measured). Its own `exec`, as today.
4. **Sections 4, 5, 6 of `server/db.ts`** recreate the `_auto_updated_at` and `action_items_sync_*` triggers. Each already begins with `DROP TRIGGER IF EXISTS`, so no change is needed there.
5. **`vec0` rebuild.** One transaction per table (0.9 s per 50,000 × 384-dim rows measured).
6. **Uploads relocation.** Last, outside any transaction, because it touches the filesystem.

If the process dies mid-way, the next boot re-runs from the top. Every step
checks its own precondition, so partial progress is not a problem. A crash
between steps 2 and 4 leaves the six dropped triggers absent until the next
boot recreates them; the window is one process lifetime and the next boot
always closes it, because steps 3 and 4 are unconditional `DROP` + `CREATE`.

---

## 2. Identity tables

### 2.1 `users` additions

```sql
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';          -- 'active' | 'disabled'
ALTER TABLE users ADD COLUMN credentialState TEXT NOT NULL DEFAULT 'password'; -- 'password' | 'none'
ALTER TABLE users ADD COLUMN mustChangePassword INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN passwordChangedAt TEXT;
ALTER TABLE users ADD COLUMN disabledAt TEXT;
ALTER TABLE users ADD COLUMN createdBy TEXT REFERENCES users(id) ON DELETE SET NULL;
```

Each `ALTER` is guarded by `PRAGMA table_info(users)` the same way §9i guards
`ownerId` today. `NOT NULL DEFAULT '...'` on `ADD COLUMN` is legal; a
`REFERENCES` clause with a non-`NULL` default is not (SQLite raises the error
only when the table has rows, so an empty test database would not catch it).
`createdBy` has a `NULL` default and is fine.

Four places in `server/services/authService.ts` enumerate user columns by
hand and must gain the new ones: `USER_COLUMNS` (`:178-179`), the `User`
type (`:89-98`), `stripHash` (`:249-260`), and `publicUser` (`:116-126`).
Until they do, `resolveSession` and `attachPrincipal` cannot see `status`,
`credentialState`, or `mustChangePassword`.

| Column | Meaning |
| ------ | ------- |
| `status` | `disabled` refuses sign-in, token use, and existing sessions. |
| `credentialState` | `none` marks the local owner account (section 3). Sign-in is impossible until setup converts it. |
| `mustChangePassword` | Set by admin create-with-temporary-password and by admin reset. Cleared by `POST /api/auth/change-password`. |
| `passwordChangedAt` | Shown in the admin user list. |
| `disabledAt` | Audit convenience. |
| `createdBy` | Which admin created or invited this account. `NULL` for the first account and the local owner. |

### 2.2 `api_tokens`

```sql
CREATE TABLE IF NOT EXISTS api_tokens (
  id          TEXT PRIMARY KEY,
  userId      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  tokenHash   TEXT NOT NULL UNIQUE,     -- sha256 hex of the full token
  tokenPrefix TEXT NOT NULL,            -- first 12 chars, for display
  createdAt   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  lastUsedAt  TEXT,
  expiresAt   TEXT,                     -- NULL = never
  revokedAt   TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(userId);
```

Cascade is correct here. A token without an account is meaningless, like a
session.

### 2.3 `invitations`

```sql
CREATE TABLE IF NOT EXISTS invitations (
  id         TEXT PRIMARY KEY,
  email      TEXT,                      -- optional hint, not enforced on accept
  role       TEXT NOT NULL DEFAULT 'member',
  tokenHash  TEXT NOT NULL UNIQUE,
  invitedBy  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  createdAt  TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  expiresAt  TEXT NOT NULL,
  acceptedAt TEXT,
  acceptedBy TEXT REFERENCES users(id) ON DELETE SET NULL,
  revokedAt  TEXT
);
```

The invitation link is `<origin>/join?token=<secret>`. The database holds only
the hash. Default expiry is 7 days. An accepted or revoked invitation cannot
be used again.

### 2.4 `user_settings`

```sql
CREATE TABLE IF NOT EXISTS user_settings (
  userId    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key       TEXT NOT NULL,
  value     TEXT NOT NULL,              -- JSON
  updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  PRIMARY KEY (userId, key)
);
```

Empty at the end of this plan. It exists so that Phase 4 and later features
have a home for per-user server-side preferences without another migration.

### 2.5 `audit_log`

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  actorUserId TEXT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,            -- 'user.create', 'user.disable', 'auth.login.failed', ...
  targetType  TEXT,                     -- 'user' | 'token' | 'invitation' | 'setting' | 'backup'
  targetId    TEXT,
  details     TEXT,                     -- JSON, never contains secrets
  ip          TEXT,
  createdAt   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_log(actorUserId, createdAt DESC);
```

Retention: 90 days. There is no daily sweep to attach to today:
`cleanupOldInvocations` runs once at boot with no interval
(`server.ts:170-174`) and the session sweep is boot-only
(`server/db.ts:193-198`). Phase 3 adds one daily maintenance interval in
`server.ts`, gated by `DISABLE_BACKGROUND_JOBS`, that sweeps `audit_log`,
expired `sessions`, expired `api_tokens`, expired `invitations`, and old
`ai_invocations`.

---

## 3. The local owner account

Runs after section 2 and before section 4, because section 4 needs a valid
owner id to backfill into. The code lives in `server/db.ts` and is exported;
`countUsers()` and `primaryAdminId()` below are local raw-SQL helpers in the
same file, not imports from `authService`.

```ts
export function ensureLocalOwner(): string {
  const existing = sqlite
    .prepare(`SELECT id FROM users WHERE credentialState = 'none' LIMIT 1`)
    .get() as { id: string } | undefined;
  if (existing) return existing.id;
  if (countUsers() > 0) return primaryAdminId();   // an account already exists; nothing to create
  const id = crypto.randomUUID();
  sqlite.prepare(`
    INSERT INTO users (id, email, username, displayName, passwordHash, role, credentialState)
    VALUES (?, 'local@contrack.local', 'local', 'This device', 'none$', 'admin', 'none')
  `).run(id);
  return id;
}
```

- `passwordHash = 'none$'` never verifies. `parseHash` (`server/services/passwords.ts:151-156`) splits on `$` and returns `null` when the part count is not six, before it looks at the algorithm. `verifyPassword` returns `false`. `needsRehash` returns `true`, which is harmless because nothing can sign in to rehash.
- The account is an admin because in auth-off mode the person at the keyboard is the operator.
- `primaryAdminId()` is `SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY createdAt ASC LIMIT 1`.

Immediately after: `claimUnownedData(ownerId)` for every table in the extended
`OWNED_TABLES` list. On an instance upgraded from 1.x with one real account,
this claims nothing new. On an auth-off instance it claims everything for the
new local owner.

---

## 4. Ownership columns on the four child tables

```sql
ALTER TABLE interactions        ADD COLUMN ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE action_items        ADD COLUMN ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE dedupe_suggestions  ADD COLUMN ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE dedupe_exclusions   ADD COLUMN ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT;
```

Backfill from the parent contact:

```sql
UPDATE interactions       SET ownerId = (SELECT ownerId FROM contacts WHERE id = interactions.contactId)      WHERE ownerId IS NULL;
UPDATE action_items       SET ownerId = (SELECT ownerId FROM contacts WHERE id = action_items.contactId)      WHERE ownerId IS NULL;
UPDATE dedupe_suggestions SET ownerId = (SELECT ownerId FROM contacts WHERE id = dedupe_suggestions.contactIdA) WHERE ownerId IS NULL;
UPDATE dedupe_exclusions  SET ownerId = (SELECT ownerId FROM contacts WHERE id = dedupe_exclusions.contactIdA)  WHERE ownerId IS NULL;
```

`OWNED_TABLES` becomes:

```ts
export const OWNED_TABLES = [
  "contacts", "lists", "interactions", "action_items",
  "dedupe_suggestions", "dedupe_exclusions", "dedupe_merge_log", "ai_invocations",
] as const;
```

`claimUnownedData` loops this list unchanged.

### 4.1 Invariant triggers

The invariant: every owned row has a non-null `ownerId`, and a child row's
`ownerId` equals its parent contact's `ownerId`.

**Required on insert (all eight owned tables).** SQLite cannot add `NOT NULL`
to an existing column. A trigger gives the same guarantee.

```sql
CREATE TRIGGER IF NOT EXISTS contacts_owner_required BEFORE INSERT ON contacts
WHEN NEW.ownerId IS NULL
BEGIN SELECT RAISE(ABORT, 'contacts.ownerId is required'); END;
```

Repeated for `lists`, `dedupe_merge_log`, `ai_invocations`. For the four child
tables, the required-trigger is replaced by a fill-trigger so callers that
insert through a parent id still work:

**Fill from parent (child tables).**

```sql
CREATE TRIGGER IF NOT EXISTS interactions_owner_fill AFTER INSERT ON interactions
WHEN NEW.ownerId IS NULL
BEGIN
  UPDATE interactions
     SET ownerId = (SELECT ownerId FROM contacts WHERE id = NEW.contactId)
   WHERE id = NEW.id;
END;
```

Same shape for `action_items` (by `contactId`) and `dedupe_suggestions` (by
`contactIdA`). `dedupe_exclusions` has no `id` column; its primary key is
`(contactIdA, contactIdB)`, so its fill trigger ends with
`WHERE contactIdA = NEW.contactIdA AND contactIdB = NEW.contactIdB`. Services
still pass `ownerId` explicitly. The trigger is a safety net, not the primary
path.

The fill `UPDATE` fires the table's own `AFTER UPDATE` triggers (verified):
`interactions_auto_updated_at` stamps `updatedAt`, and on `action_items` the
`action_items_sync_update` trigger updates `contacts.nextFollowUpAt`, which
fires `contacts_au` and `contacts_auto_updated_at`. This is acceptable for
the rare insert that omits `ownerId`. It is not acceptable for the bulk
backfill, which is why the migration drops those triggers first (section
1.3).

**Mismatch check (child tables).**

```sql
CREATE TRIGGER IF NOT EXISTS interactions_owner_check
BEFORE INSERT ON interactions
WHEN NEW.ownerId IS NOT NULL
 AND NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.contactId)
BEGIN SELECT RAISE(ABORT, 'interactions.ownerId does not match contact owner'); END;
```

For `dedupe_suggestions` and `dedupe_exclusions` the check compares against
both `contactIdA` and `contactIdB`. A cross-owner suggestion is a bug and
must fail loudly.

When the parent contact's `ownerId` is `NULL`, `NEW.ownerId != NULL` is
`NULL` and the check does not fire. That state cannot exist after the claim,
and the triggers are installed after the claim, so the gap is closed by
ordering. Verification query 1 in section 11 guards it.

**Propagate owner change (contacts).** The only supported owner change is the
one-time claim from `NULL`. This trigger keeps children consistent if a future
admin "reassign data" feature is built.

```sql
CREATE TRIGGER IF NOT EXISTS contacts_owner_propagate AFTER UPDATE OF ownerId ON contacts
WHEN NEW.ownerId IS NOT OLD.ownerId
BEGIN
  UPDATE interactions       SET ownerId = NEW.ownerId WHERE contactId = NEW.id;
  UPDATE action_items       SET ownerId = NEW.ownerId WHERE contactId = NEW.id;
  UPDATE dedupe_suggestions SET ownerId = NEW.ownerId WHERE contactIdA = NEW.id OR contactIdB = NEW.id;
  UPDATE dedupe_exclusions  SET ownerId = NEW.ownerId WHERE contactIdA = NEW.id OR contactIdB = NEW.id;
END;
```

Trigger install order matters: the `_owner_required` triggers are installed
**after** the claim in section 3 and the backfill in section 4. Before that,
rows with `NULL` still exist.

The propagate trigger cannot touch the `vec0` tables: sqlite-vec 0.1.9
refuses `UPDATE` on a partition key column. A future reassign feature deletes
and re-inserts the two vector rows in code after the contact update.

Cost: one indexed sub-select per insert on four tables. Interactions are
written a few times a minute at most. Negligible.

### 4.2 Triggers dropped around the claim

The claim `UPDATE contacts SET ownerId = ? WHERE ownerId IS NULL` and the
child backfill fire every `AFTER UPDATE` trigger on those tables, once per
row. Two of them are expensive or harmful:

- `contacts_au` deletes and re-inserts the FTS row. With today's trigger body that is a full FTS scan per row (section 5.5): 5.4 ms per contact, 27 s for 5,000 contacts measured.
- `contacts_auto_updated_at` and `interactions_auto_updated_at` stamp `updatedAt`. `findStaleEmbeddings` (`server/services/dedupe/embeddings.ts:298-313`) compares `contacts.updatedAt` with `dedupe_embedding_meta.embeddedAt`, so a stamped corpus is re-embedded through the paid provider on the next deep scan. That breaks the promise in section 6.3.

The tenancy block therefore runs, before the claim:

```sql
DROP TRIGGER IF EXISTS contacts_ai;  DROP TRIGGER IF EXISTS contacts_au;  DROP TRIGGER IF EXISTS contacts_ad;
DROP TRIGGER IF EXISTS fts_tags_ai;  DROP TRIGGER IF EXISTS fts_tags_ad;
DROP TRIGGER IF EXISTS fts_interests_ai;  DROP TRIGGER IF EXISTS fts_interests_ad;
DROP TRIGGER IF EXISTS fts_emails_ai;  DROP TRIGGER IF EXISTS fts_emails_ad;
DROP TRIGGER IF EXISTS fts_phones_ai;  DROP TRIGGER IF EXISTS fts_phones_ad;
DROP TRIGGER IF EXISTS contacts_auto_updated_at;
DROP TRIGGER IF EXISTS interactions_auto_updated_at;
DROP TRIGGER IF EXISTS action_items_auto_updated_at;
DROP TRIGGER IF EXISTS action_items_sync_insert;
DROP TRIGGER IF EXISTS action_items_sync_update;
DROP TRIGGER IF EXISTS action_items_sync_delete;
```

The FTS block (§3) and sections 4, 5, and 6 of `server/db.ts` recreate all
seventeen on the same boot. Each of those sections already starts with
`DROP TRIGGER IF EXISTS`, so no code there changes. The migration test
asserts that `updatedAt` on every contact and interaction is byte-identical
before and after the migration, and that the seventeen triggers exist
afterward.

---

## 5. FTS5 rebuild with `ownerTok`

### 5.1 Table

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS contacts_fts USING fts5(
  contactId UNINDEXED,
  name, company, role, headline, location, about, industry, extras, searchExpansion,
  ownerTok, cidTok
);
```

No `tokenize=` option, as today (default `unicode61`). `FTS_SCHEMA_VERSION`
becomes `2`. The existing gate (`server/db.ts` §3) drops and recreates the
table when the stored `user_version` differs, so the first boot after upgrade
performs a full re-index. The bulk backfill took 233 ms for 50,000 contacts
(measured), so 10,000 contacts index in well under one second.

`cidTok` is new in the review. Section 5.5 explains why it exists.

### 5.2 Token expressions

Everywhere the triggers and the backfill build a row, the two tokens are:

```sql
'o' || replace(c.ownerId, '-', '')   -- ownerTok
'c' || replace(c.id, '-', '')        -- cidTok
```

The JavaScript helpers `ownerToken(scope)` and `contactToken(id)` in
`server/tenancy/scope.ts` must produce the identical strings. A unit test
compares each with SQLite's `replace()` for a fixed UUID. Verified with
`fts5vocab`: a 33-character token is stored as one term under `unicode61`.

### 5.3 Triggers

All eleven triggers (`contacts_ai`, `contacts_au`, `contacts_ad`,
`fts_tags_ai/ad`, `fts_interests_ai/ad`, `fts_emails_ai/ad`,
`fts_phones_ai/ad`) and the backfill `INSERT ... SELECT` gain the `ownerTok`
and `cidTok` columns. Three more changes to every trigger body:

1. Every `DELETE FROM contacts_fts WHERE contactId = X` becomes
   `DELETE FROM contacts_fts WHERE contacts_fts MATCH 'cidTok:c' || replace(X, '-', '')`.
   This is the section 5.5 fix.
2. `contacts_ai` gains `WHERE new.deletedAt IS NULL`, which it lacks today
   (`server/db.ts:395-406`). Every other trigger already has the guard.
3. `contacts_au` is `AFTER UPDATE ON contacts` with no column list, so it
   fires on every update. It stays that way. During the migration it is
   dropped (section 4.2), so the claim does not fire it; the bulk backfill
   indexes the claimed rows instead.

The trigger SQL is generated from one template string in `server/db.ts`
instead of eleven hand-copied blocks. This is a refactor of existing code
that Phase 1 does while it is touching every trigger anyway. The generated
SQL is snapshot-tested.

### 5.4 Queries

```sql
-- hybridRetrieval.ftsRetrieval
SELECT contactId, bm25(contacts_fts, 0.0, 10.0, 5.0, 3.0, 2.0, 2.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0) AS score
FROM contacts_fts
WHERE contacts_fts MATCH ?
ORDER BY score
LIMIT ?;
-- bound value: 'ownerTok:o3f2c1d0... AND ("original query")'
```

**The weight string has twelve values, one per column, including
`contactId UNINDEXED` at position 0.** `bm25()` assigns weights by column
position and does not skip `UNINDEXED` columns (verified: a weight on
position 0 has no effect, a weight on position 1 boosts `name`). Today's
constant `BM25_WEIGHTS` in `server/services/search/hybridRetrieval.ts:113`
has nine values for a ten-column table, so every weight sits one column to
the left of its intended target: `name` gets 5.0, not 10.0, and
`searchExpansion` gets the default 1.0. The string above fixes the offset.
The alternative that preserves today's effective ranking is
`0.0, 5.0, 3.0, 2.0, 2.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0`. The decision
is Q13 in the risks document; the recommendation is to fix the offset in
Phase 0 as its own PR so the ranking change is isolated from tenancy.

`searchService.searchFts` (`server/services/searchService.ts:193-208`) runs
one `"<q>"*` query with `ORDER BY rank` and no weights. It gets the owner
wrapper only. The three-strategy list lives in `hybridRetrieval.ftsRetrieval`
(`:286-290`). These two functions and `server/db.ts` are the only code that
names `contacts_fts`. The column-filter syntax `ownerTok : term` and the
`AND` with parentheses are standard FTS5 query syntax; all three strategy
shapes were verified inside the wrapper.

### 5.5 Why `cidTok`, with numbers

Every FTS trigger today starts with `DELETE FROM contacts_fts WHERE contactId
= old.id`. FTS5's `xBestIndex` accepts only `MATCH`, `rowid`, and `rank`
constraints, so an `=` on the `UNINDEXED` `contactId` column is evaluated by
the SQLite core after a full scan of the virtual table. Measured at 40,000
rows: 4.06 ms per delete. With an indexed `cidTok` column and
`MATCH 'cidTok:...'`: 0.011 ms.

Consequences, measured on 50,000 contacts with two emails each:

| Operation | Today's triggers | `cidTok` triggers |
| --------- | ---------------- | ----------------- |
| `UPDATE contacts SET ownerId` on 5,000 rows (the claim, if the triggers were left in place) | 27.1 s | 0.23 s |
| Purge one owner: `DELETE FROM contacts WHERE ownerId = ?`, 5,000 contacts plus 10,000 cascaded emails | 77.1 s | 0.20 s |
| One contact update (any column) | about 5 ms of FTS work | about 0.05 ms |
| `DELETE FROM contacts_fts WHERE contacts_fts MATCH 'ownerTok:...'`, 5,000 rows | n/a | 17 ms |

The purge cost is dominated by the child-table triggers: an FK cascade fires
`fts_emails_ad` and its siblings once per cascaded row (verified), and each
firing pays the scan. This is a latent 1.5.5 cost, not something the plan
introduces. FTS v2 is the moment to fix it because every trigger is rewritten
anyway. Scripts 04 and 05 in `bench/review-2026-09-08/` reproduce the table.

---

## 6. `vec0` rebuild with partition keys

### 6.1 Target shape

```sql
CREATE VIRTUAL TABLE search_embeddings USING vec0(
  contactId TEXT PRIMARY KEY,
  ownerId   TEXT PARTITION KEY,
  embedding FLOAT[<dim>]
);
CREATE VIRTUAL TABLE contact_embeddings USING vec0(
  contactId TEXT PRIMARY KEY,
  ownerId   TEXT PARTITION KEY,
  embedding FLOAT[<dim>]
);
```

`<dim>` is read from the existing table's DDL with `vecTableWidth()` so the
rebuild preserves whatever model the instance uses.

### 6.2 Precondition check

```sql
SELECT vec_version();
```

Must be `>= 0.1.6`. Partition keys and metadata columns were introduced in
sqlite-vec 0.1.6. The installed package is 0.1.9, which is the latest stable
release. If the check fails the server logs an error and refuses to start,
because every vector query in Phase 2 depends on the partition key. The
returned string has a leading `v` and may carry a pre-release suffix
(`v0.1.10-alpha.4`), so the check parses the three numbers and compares them;
it does not compare strings. `server/db.ts:132-135` already calls
`vec_version()` for the boot log.

### 6.3 Idempotent rebuild by copy

Detect: `SELECT sql FROM sqlite_master WHERE name = 'search_embeddings'`
contains `PARTITION KEY` (case-insensitive). If yes, skip.

Otherwise, per table, inside one transaction:

1. `SELECT e.contactId, c.ownerId, e.embedding FROM search_embeddings e JOIN contacts c ON c.id = e.contactId` in chunks of 1,000 rows into memory. Rows whose contact no longer exists are dropped (they are orphans already).
2. `DROP TABLE search_embeddings`.
3. `CREATE VIRTUAL TABLE search_embeddings USING vec0(...)` with the partition key and the preserved dimension.
4. Reinsert every row with `INSERT INTO search_embeddings (contactId, ownerId, embedding) VALUES (?, ?, ?)`.

Verified: a `DROP` and `CREATE VIRTUAL TABLE ... vec0` inside one
`sqlite.transaction` works, and the copy of 50,000 × 384-dim rows took 0.9 s.

Memory: 10,000 × 384 floats × 4 bytes is 15 MB for search embeddings and 31 MB
for 768-dim dedupe embeddings. Both fit. On a 50,000-contact instance, chunk
the read and write in one transaction per 5,000 rows.

Rules for this step:

- **Never `ALTER TABLE ... RENAME` a `vec0` table.** On 0.1.9 the statement returns OK, the shadow tables keep the old name, and the next read fails with `no such table: main.<new>_rowids`. Copy and drop, as above.
- `vecTableWidth()` (`server/db.ts:810-815`) is module-private and returns a string with an `"unknown"` fallback. The rebuild parses it to a number and throws with a clear message when the DDL does not match, instead of creating a table with a wrong dimension.
- `rebuildDedupeEmbeddingTable` (`server/services/dedupe/embeddings.ts:48`) is not exported and lives in a module that imports `db.ts`. The rebuild in `db.ts` uses its own DDL string; the two helpers in the services and the string in `db.ts` are pinned equal by a unit test.
- An `INSERT` that omits `ownerId` succeeds with a `NULL` partition and no error. Verification query 9 counts them.

No embedding is recomputed. No provider API call is made. The stored
`ai.embeddingsState` signature and dimension are unchanged, so
`ensureEmbeddingStore` and `ensureDedupeEmbeddingStore` see no change on the
next boot and do not trigger a re-embed.

### 6.4 Code changes that follow

- `rebuildSearchEmbeddingTable(dimension)` and `rebuildDedupeEmbeddingTable(dimension)` include the partition key from now on. Without this, the next embedding-model change would recreate the tables without the partition column.
- Every `INSERT INTO search_embeddings` and `INSERT INTO contact_embeddings` supplies `ownerId`. The upsert transactions look it up from `contacts` by id in the same transaction.
- Every upsert is `DELETE` then `INSERT`. The search store already does this (`localEmbeddings.ts:203-212`). The dedupe store uses `INSERT OR REPLACE` (`dedupe/embeddings.ts:188`); sqlite-vec lists `INSERT OR REPLACE` support as new in 0.1.10, so the Phase 1 smoke test runs it against a partitioned table on 0.1.9 and the code switches to `DELETE` + `INSERT` if it fails (risks document T24). sqlite-vec also refuses `UPDATE` of a partition key and mis-reports an `UPDATE ... WHERE EXISTS (...)` on any column as the same error (issue #261).
- `ownerId IN (...)` is not supported on a partition key (issue #142). One owner per statement.
- `k` has a maximum of 4096 (issue #157). `findSearchNeighbors` already caps at 500.
- KNN statements gain `AND ownerId = ?` (Phase 2).

### 6.5 Partition size note

sqlite-vec's guidance is that each partition key value should hold on the
order of hundreds of vectors. An owner with 30 contacts has a tiny partition,
which is fine: KNN over 30 rows is instant. The guidance warns against
thousands of distinct keys with a handful of rows each, which does not
describe this deployment.

---

## 7. Uploads relocation

Target layout: `DATA_DIR/uploads/u/<ownerId>/avatars/` and
`DATA_DIR/uploads/u/<ownerId>/files/`. `logos/` stays where it is.

Procedure, run once per boot after the database migration, idempotent:

1. `SELECT id, ownerId, avatarUrl FROM contacts WHERE avatarUrl LIKE '/uploads/avatars/%'`. For each row: move `<UPLOADS_DIR>/avatars/<file>` to `<UPLOADS_DIR>/u/<ownerId>/avatars/<file>`, then `UPDATE contacts SET avatarUrl = '/uploads/u/<ownerId>/avatars/<file>' WHERE id = ?`. If the source file is missing, only rewrite the URL. The `contacts_au` FTS trigger fires, which is harmless.
2. `SELECT i.id, i.ownerId, i.fileUrl FROM interactions i WHERE fileUrl LIKE '/uploads/%' AND fileUrl NOT LIKE '/uploads/u/%' AND fileUrl NOT LIKE '/uploads/logos/%'`. Same move and rewrite into `files/`.
3. `avatarUrl` values pointing at `/api/avatar/...` (generated) or external `https://` hosts are untouched.
4. A file left in the flat directories that no row references is an orphan. It is moved to `<UPLOADS_DIR>/orphaned/` and logged. Nothing is deleted.

`resolveUploadPath` is unchanged. The new paths are still inside `UPLOADS_DIR`.

---

## 8. Indexes

Installed after all columns exist. All `IF NOT EXISTS`.

```sql
CREATE INDEX IF NOT EXISTS idx_contacts_owner_status   ON contacts(ownerId, isGhost, isArchived, canonicalId);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_deleted  ON contacts(ownerId, deletedAt);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_lastc    ON contacts(ownerId, lastContactedAt);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_added    ON contacts(ownerId, addedAt);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_score    ON contacts(ownerId, relationshipScore);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_phonetic ON contacts(ownerId, phoneticHash);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_canon    ON contacts(ownerId, canonicalId);

CREATE INDEX IF NOT EXISTS idx_interactions_owner_date ON interactions(ownerId, date);
CREATE INDEX IF NOT EXISTS idx_action_items_owner_due  ON action_items(ownerId, dueAt) WHERE completedAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_action_items_owner_done ON action_items(ownerId, completedAt);
CREATE INDEX IF NOT EXISTS idx_lists_owner_sort        ON lists(ownerId, sortOrder);
CREATE INDEX IF NOT EXISTS idx_dedupe_sugg_owner_status ON dedupe_suggestions(ownerId, status);
CREATE INDEX IF NOT EXISTS idx_dedupe_sugg_owner_conf  ON dedupe_suggestions(ownerId, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_dedupe_excl_owner       ON dedupe_exclusions(ownerId);
CREATE INDEX IF NOT EXISTS idx_merge_log_owner_at      ON dedupe_merge_log(ownerId, mergedAt DESC);
CREATE INDEX IF NOT EXISTS idx_ai_inv_owner_created    ON ai_invocations(ownerId, createdAt DESC);
```

Drop after Phase 2 confirms plans (each is a prefix of a composite above):

```sql
DROP INDEX IF EXISTS idx_contacts_owner;
DROP INDEX IF EXISTS idx_lists_owner;
DROP INDEX IF EXISTS idx_ai_invocations_owner;
DROP INDEX IF EXISTS idx_dedupe_merge_log_owner;
```

Keep `idx_contacts_status`, `idx_contacts_last_contacted`, `idx_contacts_added`,
`idx_contacts_score`, `idx_contacts_phonetic`, `idx_contacts_canonical`,
`idx_contacts_deleted`, `idx_action_items_due`, `idx_dedupe_status`,
`idx_dedupe_confidence`, and `idx_ai_invocations_created` through Phase 2.
The background sweeps (`recomputeAll`, trash purge, geocoding backfill,
invocation cleanup) still run across all owners and use them. Revisit in
Phase 5 with `EXPLAIN QUERY PLAN` evidence.

Then `ANALYZE` once (new; nothing runs `ANALYZE` today), and `PRAGMA optimize`
as today (`server/db.ts:932`, daily in `server.ts:198`, and on shutdown).

---

## 9. Why not a Drizzle migration file

The repository has two Drizzle migrations (`0000`, `0001`) and a large body of
idempotent DDL in `server/db.ts` (`users`, `sessions`, the dedupe tables,
`app_settings`, `dedupe_embedding_meta`, every virtual table, every trigger,
every `ownerId` column). `action_items` is defined in both places (Drizzle
`0000` and `server/db.ts` §6 with `IF NOT EXISTS`). `geocode_cache` is
created by `server/services/geocoding/cache.ts` at import time, outside
`db.ts`. The `users` table itself was added the `db.ts` way.

Generating a Drizzle migration for the new tables would produce a migration
that recreates `users` and `sessions`, because the snapshot in
`drizzle/meta/0001_snapshot.json` does not know about them. Reconciling the
snapshot is a separate cleanup with its own risk. This plan follows the
existing precedent and keeps the `src/db/schema.ts` mirror current so types
stay right. A follow-up task in [11-future.md](11-future.md) proposes moving
all of `server/db.ts` DDL into numbered migrations.

---

## 10. Boot sequence in `server/db.ts` after Phase 1

Section numbers continue the file's existing scheme. Today's file has two
sections labelled `2a` (`server/db.ts:201` and `:268`); Phase 1 renames the
second to `2b` while it is editing the file. The tenancy block must run
**before** the FTS block, because the FTS backfill `INSERT ... SELECT`
references `contacts.ownerId` and fails at prepare time on a fresh database
if the column does not exist yet (verified: `no such column`, even with zero
rows). On a fresh database `contacts` comes from Drizzle `0000` without
`ownerId`. The FTS block also must not exist while the claim runs (§4.2).
The three dedupe tables move up with it because `OWNED_TABLES` names them.

| § | Step | Idempotency check |
| - | ---- | ----------------- |
| 2 | Drizzle migrations (unchanged). After this, `contacts`, `lists`, `interactions`, `action_items`, `ai_invocations` and the child tables exist | Drizzle journal |
| 2z | `users`, `sessions` (unchanged) | `IF NOT EXISTS` |
| **2z-1** | `users` column additions (§2.1) | `table_info` |
| **2z-2** | `api_tokens`, `invitations`, `user_settings`, `audit_log` (§2.2 to 2.5); `app_settings` moved up from §9g2 (§1.1) | `IF NOT EXISTS` |
| **2z-3** | `dedupe_suggestions`, `dedupe_exclusions`, `dedupe_merge_log` moved up from §9c to 9e (identical DDL; those sections become no-ops) | `IF NOT EXISTS` |
| **2z-4** | `TENANCY` block: read `schema.tenancy`; `VACUUM INTO` backup if behind and `contacts` has rows (outside the transaction, §1.2); then one transaction: `ownerId` on all eight `OWNED_TABLES` (§4, replaces §9i), drop the seventeen triggers (§4.2), `ensureLocalOwner` (§3), `claimUnownedData`, child backfill (§4), invariant triggers (§4.1), composite indexes (§8), write version | `schema.tenancy` |
| 2a, 2b | avatar URL migration, data cleanup (unchanged) | |
| 3 | FTS table with `ownerTok` and `cidTok`, `FTS_SCHEMA_VERSION = 2`, eleven triggers, bulk backfill (§5) | `user_version` gate |
| 4, 5, 6 | `_auto_updated_at` and `action_items_sync_*` triggers recreated (unchanged code, each starts with `DROP TRIGGER IF EXISTS`) | |
| 7, 8 | unchanged. The §8 legacy follow-up backfill inserts `action_items` without `ownerId`; the `action_items_owner_fill` trigger from 2z-4 fills it from the contact | |
| 9a, 9b | soft-merge column, phonetic index (unchanged) | |
| 9c to 9e | now no-ops (moved to 2z-3) | |
| 9f, 9f-b | `vec0` tables. The `CREATE VIRTUAL TABLE IF NOT EXISTS` DDL gains the partition key, so a fresh database gets it directly | `IF NOT EXISTS` |
| **9k** | `vec0` partition rebuild by copy for tables created before 2.0 (§6) | `sqlite_master.sql` contains `PARTITION KEY` |
| 9g | `dedupe_embedding_meta` (unchanged) | |
| 9g2 | `app_settings` (now a no-op) | |
| 9i | now a no-op (moved to 2z-4). The section stays as a guard that throws if any owned table lacks `ownerId` | `table_info` |
| 9h | hot-path indexes (unchanged) | |
| 10 | phonetic backfill (unchanged) | |
| **11** | uploads relocation (§7) | no rows match the legacy `LIKE` patterns |

`reconcileOwnership()` in `server/app.ts` is rewritten: it calls
`ensureLocalOwner()` and `claimUnownedData()` unconditionally. With every row
already owned, it is a no-op after the first boot. The old "only when exactly
one user" guard is deleted.

`FTS_SCHEMA_VERSION` must be bumped in the same release as the `ownerId`
columns, because the FTS triggers reference `contacts.ownerId` and the
`ownerTok` column. On a fresh 2.0 database the order above guarantees the
column exists when §3 runs. The integration suite exercises exactly that path
on every test file, so a wrong order fails the whole suite immediately.

---

## 11. Verification queries

These run in the Phase 1 integration test and are printed by
`npm run tenancy:verify` (a small script added in Phase 1) so an operator can
check an upgraded instance.

```sql
-- 1. No unowned rows anywhere. Expect 0 for each.
SELECT 'contacts', COUNT(*) FROM contacts WHERE ownerId IS NULL
UNION ALL SELECT 'lists', COUNT(*) FROM lists WHERE ownerId IS NULL
UNION ALL SELECT 'interactions', COUNT(*) FROM interactions WHERE ownerId IS NULL
UNION ALL SELECT 'action_items', COUNT(*) FROM action_items WHERE ownerId IS NULL
UNION ALL SELECT 'dedupe_suggestions', COUNT(*) FROM dedupe_suggestions WHERE ownerId IS NULL
UNION ALL SELECT 'dedupe_exclusions', COUNT(*) FROM dedupe_exclusions WHERE ownerId IS NULL
UNION ALL SELECT 'dedupe_merge_log', COUNT(*) FROM dedupe_merge_log WHERE ownerId IS NULL
UNION ALL SELECT 'ai_invocations', COUNT(*) FROM ai_invocations WHERE ownerId IS NULL;

-- 2. Child owner equals parent owner. Expect 0.
SELECT COUNT(*) FROM interactions i JOIN contacts c ON c.id = i.contactId WHERE i.ownerId != c.ownerId;
SELECT COUNT(*) FROM action_items a JOIN contacts c ON c.id = a.contactId WHERE a.ownerId != c.ownerId;
SELECT COUNT(*) FROM dedupe_suggestions s JOIN contacts a ON a.id = s.contactIdA JOIN contacts b ON b.id = s.contactIdB
 WHERE s.ownerId != a.ownerId OR s.ownerId != b.ownerId;

-- 3. FTS row count equals active contact count.
SELECT (SELECT COUNT(*) FROM contacts_fts) = (SELECT COUNT(*) FROM contacts WHERE deletedAt IS NULL);

-- 4. Every FTS row carries the right owner token.
SELECT COUNT(*) FROM contacts_fts f JOIN contacts c ON c.id = f.contactId
 WHERE f.ownerTok != 'o' || replace(c.ownerId, '-', '');

-- 5. Vector stores have partition keys and preserved counts.
SELECT sql LIKE '%PARTITION KEY%' FROM sqlite_master WHERE name IN ('search_embeddings', 'contact_embeddings');

-- 6. No legacy flat upload URLs remain.
SELECT COUNT(*) FROM contacts WHERE avatarUrl LIKE '/uploads/avatars/%';
SELECT COUNT(*) FROM interactions WHERE fileUrl LIKE '/uploads/%' AND fileUrl NOT LIKE '/uploads/u/%';

-- 7. Exactly one local owner at most.
SELECT COUNT(*) <= 1 FROM users WHERE credentialState = 'none';

-- 8. No FTS row with a missing owner or contact token. Expect 0 for each.
SELECT COUNT(*) FROM contacts_fts WHERE ownerTok IS NULL OR ownerTok = 'o';
SELECT COUNT(*) FROM contacts_fts f JOIN contacts c ON c.id = f.contactId
 WHERE f.cidTok != 'c' || replace(c.id, '-', '');

-- 9. No vector row with a NULL partition. Expect 0 for each.
SELECT COUNT(*) FROM search_embeddings WHERE ownerId IS NULL;
SELECT COUNT(*) FROM contact_embeddings WHERE ownerId IS NULL;

-- 10. Every vector row belongs to an existing contact of the same owner. Expect 0 for each.
SELECT COUNT(*) FROM search_embeddings e LEFT JOIN contacts c ON c.id = e.contactId
 WHERE c.id IS NULL OR c.ownerId != e.ownerId;
SELECT COUNT(*) FROM contact_embeddings e LEFT JOIN contacts c ON c.id = e.contactId
 WHERE c.id IS NULL OR c.ownerId != e.ownerId;

-- 11. The seventeen triggers exist again after the migration. Expect 17.
SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN (
  'contacts_ai','contacts_au','contacts_ad',
  'fts_tags_ai','fts_tags_ad','fts_interests_ai','fts_interests_ad',
  'fts_emails_ai','fts_emails_ad','fts_phones_ai','fts_phones_ad',
  'contacts_auto_updated_at','interactions_auto_updated_at','action_items_auto_updated_at',
  'action_items_sync_insert','action_items_sync_update','action_items_sync_delete');
```

Two checks are tests rather than queries, because they need a before-image:
`updatedAt` on every contact and interaction is unchanged by the migration,
and `embedBatch` is never called during boot.

---

## 12. Rollback

1. Stop the server.
2. Replace `DATA_DIR/curator.db` (and remove `curator.db-wal` and `curator.db-shm`) with `DATA_DIR/backups/pre-tenancy-<stamp>.db`.
3. Move files from `uploads/u/<ownerId>/avatars/` back to `uploads/avatars/` and from `uploads/u/<ownerId>/files/` back to `uploads/`. The 1.x database still holds the old URLs, so the files must be at the old paths. A script `scripts/tenancy-rollback-uploads.mjs` does this.
4. Start the 1.x image.

The FTS index and the vector tables rebuild themselves on the 1.x boot from
the restored database, because the restored file predates the rebuild.

Do not attempt a rollback by renaming `vec0` tables. Renaming breaks them on
sqlite-vec 0.1.9 (section 6.3). The restore of the backup file is the only
supported path.

---

## 13. `src/db/schema.ts` mirror

Additions, all typed with Drizzle:

- `users`: `status`, `credentialState`, `mustChangePassword`, `passwordChangedAt`, `disabledAt`, `createdBy`.
- New tables: `apiTokens`, `invitations`, `userSettings`, `auditLog`, with relations to `users`.
- `ownerId` on `interactions`, `actionItems`, `dedupeSuggestions`, `dedupeExclusions`, with `owner` relations.
- The OWNERSHIP comment block is rewritten. It must state the new invariant: `ownerId` is never `NULL` after boot, the four child tables carry a denormalized copy kept consistent by triggers, and the local owner account is what makes auth-off mode work. It currently says "eleven contact_* child tables" (`src/db/schema.ts:144`); ten exist.

---

## 14. Measured migration costs

All numbers from `bench/review-2026-09-08/`, laptop, SQLite 3.53.2, sqlite-vec
0.1.9. Use them to size the boot log expectations and the acceptance criteria.

| Step | Data | Measured |
| ---- | ---- | -------- |
| FTS bulk backfill (`INSERT ... SELECT` with the email subselect) | 50,000 contacts | 233 ms |
| `vec0` copy-rebuild | 50,000 × 384-dim | 923 ms |
| Claim `UPDATE contacts SET ownerId` with all triggers dropped | 5,000 rows | under 50 ms (the 230 ms figure in the bench includes the `cidTok` FTS re-index, which the migration does not run) |
| Claim with today's FTS triggers still installed (what happens if §4.2 is skipped) | 5,000 rows | 27.1 s |
| Owner purge with `cidTok` triggers (Phase 3) | 5,000 contacts, 10,000 emails | 198 ms |
| Owner purge with today's triggers | same | 77.1 s |
| `VACUUM INTO` | proportional to file size, sequential write | not benchmarked; typical NAS disks write 100 MB in about 1 s |

A 10,000-contact instance should complete the whole migration in under five
seconds plus the backup copy time. The boot log prints each step with its
duration so a slow step is visible.
