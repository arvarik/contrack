# 01. Current State (v1.5.5)

This document describes what exists today and what is missing. It is the
baseline every phase starts from. The raw inventory with line numbers is in
[appendix-a-query-inventory.md](appendix-a-query-inventory.md).

---

## 1. What already exists

The identity layer is real and well built. It was written with multi-tenancy
in mind and says so in its comments.

| Piece | Where | State |
| ----- | ----- | ----- |
| `users` table with `role` (`admin` or `member`) | `server/db.ts` §2z, `src/db/schema.ts` | Done. The first account is always `admin`. |
| `sessions` table, hashed secrets, expiry, sweep on boot | `server/db.ts` §2z, `server/services/authService.ts` | Done. |
| scrypt password hashing with self-describing parameters | `server/services/passwords.ts` | Done. |
| `Principal` on every request (`anonymous`, `user`, `service`) | `server/middleware/auth.ts` | Done. Only `server/routes/auth.ts` reads it. |
| `requireAuth` gate on `/api` and `/uploads`, `requireUser` for account endpoints | `server/middleware/auth.ts`, `server/app.ts` | Done. |
| First-run setup that closes itself, sign-in, sign-out, profile, password change, session list and revoke, session TTL policy | `server/routes/auth.ts`, `src/components/auth/*`, `src/views/settings/AccountSettings.tsx` | Done. |
| `ownerId` column on `contacts`, `lists`, `ai_invocations`, `dedupe_merge_log`, each with a single-column index | `server/db.ts` §9i | Done. `NULL` means unowned. |
| `claimUnownedData` on first account creation and `reconcileOwnership` on boot when exactly one account exists | `server/services/authService.ts` | Done. |
| `existingContacts` count on the setup screen | `server/routes/auth.ts`, `src/components/auth/SetupWizard.tsx` | Done. |
| Rate limits on sign-in and setup, per IP | `server/routes/auth.ts` | Done. |
| Integration tests for setup, sign-in, gating, tokens, sessions, ownership claim | `tests/integration/api.auth.test.ts` | 49 tests. |

The `.agent/PHILOSOPHY.md` file says "no multi-user sync" under "What This Is
NOT". This plan changes that statement for the local instance only. Nothing
leaves the machine.

---

## 2. What is missing

### 2.1 Nothing filters by owner

Every read of every owned table is unscoped. The inventory counts 33 prepared
statements in `contactService`, 59 in `dedupe/merging.ts`, 24 in
`dedupe/suggestions.ts`, 15 in `dashboardService`, and so on, none of which
mention `ownerId`. `GET /api/contacts` returns every contact on the instance.

### 2.2 Nothing stamps ownership on create

The comment in `server/middleware/auth.ts` says "stamping ownership on new
rows already uses it". It does not. `contactService.createContact` builds its
insert from `buildInsertValues`, which has no owner field. The same is true for
`lists`, `ai_invocations`, and `dedupe_merge_log`. New rows are `NULL`-owned
until the next boot, when `reconcileOwnership` claims them for the single
account. With two accounts, `reconcileOwnership` does nothing and the rows
stay unowned forever.

### 2.3 Auth-off mode has no owner at all

With `AUTH_REQUIRED=false` and no account, every row is `NULL`-owned by
design. That model cannot support a second account because there is no answer
to "which owner is the anonymous caller".

### 2.4 The `service` principal has no owner

`API_TOKEN` produces `{ kind: "service" }`. There is no user behind it, so
there is nothing to scope a query to. MCP clients use this path.

### 2.5 Shared in-process state

Full list in appendix A, section C. The ones that would leak data, not just
degrade fairness:

- `dedupeQueue` holds scan results with contact snapshots in a map keyed only by scan id. `GET /api/dedupe/active` returns whichever scan is running.
- `jobQueue` (AI Search) holds batch results keyed only by batch id.
- `aiCache` tier `dailyInsight` is keyed by the literal string `"singleton"`. The tiers `rerank`, `synthesis`, and `mentions` are keyed by query text or content hash. A cached answer for one owner would be served to another owner who asks the same question.

### 2.6 Shared filesystem

All avatars and attachments live in flat directories with timestamp-based
names. `express.static` serves the whole tree to any authenticated principal.

### 2.7 Settings, exports, backups, stats are instance-wide

`app_settings` holds AI provider keys. Any signed-in member can read the
redacted view and write new keys. `GET /api/export/json` dumps six tables
unfiltered. `GET /api/ai/stats/feed` lists every AI call on the instance.

### 2.8 No admin surface

`role` is written once and never read. There is no endpoint to create a second
user. The frontend never reads `user.role`.

### 2.9 No cross-tenant tests

There is no test that creates two accounts, because no path creates a second
account.

### 2.10 The FTS triggers scan the index on every contact update

Not a tenancy gap, but a cost the migration and the purge would inherit.
Every FTS trigger in `server/db.ts` (`contacts_au`, `fts_emails_ad`, and the
rest) starts with `DELETE FROM contacts_fts WHERE contactId = old.id`. The
`contactId` column is `UNINDEXED`, so FTS5 cannot use its index and SQLite
scans every row of the virtual table. Measured at 40,000 contacts: about 4 ms
per firing, and each contact update or child-row change fires it once. A
bulk ownership claim over 5,000 contacts took 27 s and a 5,000-contact purge
took 77 s in the review benchmark. FTS v2 fixes this with an indexed
contact-id token (data model document, section 5). Evidence in
[bench/review-2026-09-08/](bench/review-2026-09-08/README.md).

### 2.11 One MCP route is unreachable

`GET /api/contacts/action-items` (`server/routes/mcp.ts:34`) is shadowed by
`GET /api/contacts/:id` because `contactsRouter` mounts before `mcpRouter`
(`server/app.ts:202` and `:204`). The request reaches the contact handler
with `id = "action-items"` and returns `404`. Phase 0 fixes the mount order.

---

## 3. What is good and stays

- **Prepared statements compiled once** (`stmts` objects in the repository and services). Adding one bound parameter keeps that pattern.
- **The versioned FTS rebuild gate** (`FTS_SCHEMA_VERSION` and `user_version`). The plan bumps the version and gets a clean re-index for free.
- **`vec0` rebuild helpers** for dimension changes. The plan extends them for the partition key.
- **`hydrate` and `hydrateMany`** read child tables by contact id after the parent row is loaded. That is exactly the "derived table" pattern the plan relies on. They do not change.
- **`resolveUploadPath`** containment. Unchanged.
- **Integration test harness** with a real database per file and `createApp()`. 41 files, 575 tests, 15.5 s on a laptop. The two-user tests build on it.
- **`AppError` codes and the central error handler.** New codes slot in.
- **`asyncHandler` on every route.** Scope resolution throws through it cleanly.

---

## 4. Sizing the work

Counts from appendix A, used to size Phase 2. "Owned" counts statements that
name one of the eight owned tables (`FROM`, `UPDATE`, `DELETE FROM`,
`INSERT INTO`, and Drizzle chains). "All" counts every prepared statement and
Drizzle chain in the domain, which is the number of places a reviewer reads.

| Domain | Files | Owned-table statements | All statements |
| ------ | ----- | ---------------------- | -------------- |
| Contacts (service, repository, routes) | 3 | 42 | 69 |
| Interactions and action items | 3 | 38 | 37 |
| Lists | 2 | 15 | 17 |
| Search (FTS, hybrid, local embeddings) | 3 | 8 | 21 |
| Dashboard and zero-state | 2 | 25 | 20 |
| Dedupe (engine, passes, blocking, normalization, suggestions, merging, embeddings, context, clustering) | 9 | 53 | 130 |
| AI Search (job queue, merge engine, strategies) | 3 | 2 plus queue state | 2 |
| AI stats | 1 | 6 plus 25 `recordInvocation` call sites | 6 |
| Export, trash, backups | 2 | 6 | 7 |
| MCP | 2 | 5 | 6 |
| Relationship scoring | 1 | 7 (mostly unchanged) | 7 |
| Geocoding | 3 | 4 (unchanged) | 6 |
| Boot backfills in `server/db.ts` and the claim in `authService` | 2 | 26 | 39 |

About 240 statements over owned tables, inside about 375 statements in all.
Most changes are one added predicate and one added bound parameter. The
dedupe domain is the largest and the one with the most cross-contact logic,
which is why it gets its own sub-phase. Appendix A section A2 lists the
sites the review added to the inventory.
