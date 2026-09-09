# 14. Risks and Open Questions

Decisions in this plan that the project owner should confirm before Phase 1
starts, the technical questions and their answers, risks that span phases,
and the effort estimate.

Reviewed against `v1.5.5` on 2026-09-08. Every technical question in section
2 was tested on the installed engines (Node v22.23.2, SQLite 3.53.2,
sqlite-vec v0.1.9, Express 5.2.1, multer 2.2.0) or checked against a primary
source. The scripts and raw numbers are in
[bench/review-2026-09-08/](bench/review-2026-09-08/README.md). Section 5 lists
what the review changed in the other documents.

---

## 1. Decisions to confirm

| # | Decision in the plan | Alternative | Why the plan chose this | Review note |
| - | -------------------- | ----------- | ----------------------- | ----------- |
| Q1 | An admin cannot read a member's contacts (D10). The only admin read of member data is the offboarding export, which is audit-logged. | Admin sees everything (Paperless model). | Personal CRM. Privacy is a stated core belief. A household admin should not be able to browse a partner's notes by default. | Miniflux and Monica keep user data private. Paperless is the counterexample. No change. |
| Q2 | Auth-off mode gets a hidden local owner account (D3). | Keep `ownerId IS NULL` as "the local user" and branch every query. | One query shape, one index shape, no `IS NULL` branches, and the setup screen converts the account instead of re-claiming. The cost is one hidden row. | The `passwordHash = 'none$'` value can never verify: `parseHash` rejects it because it has two parts, not six (`server/services/passwords.ts:151-156`). No change. |
| Q3 | The environment `API_TOKEN` maps to the primary admin and is deprecated (D11). | Refuse it once a second account exists. | Breaking an existing MCP setup on the day a second user is added is a worse surprise than a warning. | `isAuthRequired()` today is `AUTH_REQUIRED === "true" || API_TOKEN is set` (`server/middleware/auth.ts:103-105`). The plan keeps that rule. No change. |
| Q4 | Ship as `2.0.0` (D15). | `1.7.0` with the token change flagged. | The token semantics change is breaking for scripts. Semver says major. | Two more breaking changes were found: `USER_REQUIRED` becomes `SESSION_REQUIRED`, and the dedupe and AI Search `429` bodies move into the standard error envelope. Both are listed in [13-api-changes.md](13-api-changes.md). Major is confirmed. |
| Q5 | `interactions`, `action_items`, `dedupe_suggestions`, `dedupe_exclusions` get a denormalized `ownerId` (D5). | Join through `contacts` everywhere. | Covering composite indexes for the global timeline, the action item swimlane, and the suggestion badge. Triggers keep it consistent. | `dedupe_exclusions` has no `id` column. Its primary key is `(contactIdA, contactIdB)`. The fill trigger uses the composite key. No change to the decision. |
| Q6 | FTS owner token as an indexed column (D6). | `UNINDEXED` column with a post-filter. | Index-level intersection. The post-filter is the fallback if the token approach shows a problem in Phase 2c. | Measured at 50,000 contacts: the indexed token is 3 to 5 times faster than the post-filter and 8 to 10 times faster than a join. It is also faster than today's unfiltered query. Confirmed. |
| Q7 | Registration closed by default. | Open by default. | Every self-hosted app surveyed defaults closed. | Confirmed against Gitea, Vaultwarden, Miniflux, Immich, Monica docs. |
| Q8 | Both invitation links and temporary passwords. | One of them. | Different operators want different flows. Both are small. | No change. |
| Q9 | Global run lock for dedupe scans and AI Search batches with per-owner state and a FIFO. | Per-owner concurrency. | SQLite single writer and provider rate limits. Revisit with the concurrency benchmark. | No change. |
| Q10 | Members can read the redacted AI settings view. | Members see nothing about AI configuration. | The UI needs to know which capabilities exist to show or hide features. Keys are already redacted. | No change. |
| Q11 | The `local` username is reserved. A real user cannot register it. | Use a UUID username for the local owner. | A readable name in the admin list. Reservation is one check in `validateUsername`. | `local` passes today's `validateUsername` pattern (`server/services/authService.ts:137`), so the reservation is required, not optional. |
| Q12 | Rollback of uploads needs a script. | Keep a copy of the flat directory for one release. | Doubling upload storage on every instance for a rollback few will use is a poor trade. The script is 40 lines. | No change. |
| Q13 | **New.** Fix the BM25 weight offset in Phase 0 as its own small PR. | Preserve today's effective weights forever. | `bm25()` weights are positional and include the `UNINDEXED` `contactId` column at position 0. Today's nine-value string gives `name` 5.0 instead of the intended 10.0 and shifts every other column by one. The FTS v2 rebuild must touch this string anyway. Fixing it in Phase 0 isolates any ranking change from the tenancy work. | Recommended: fix. Alternative: keep the effective weights by writing the twelve-value string `0, 5, 3, 2, 2, 1, 1, 1, 1, 1, 0, 0`. |
| Q14 | **New.** The `mentions` AI cache tier stays shared across owners. | Prefix it with the owner id. | Its key is a content hash of the note text, and the cached value is the AI's extraction from that text. It is a pure function of the input, like `queryParse` and `hyde`. Sharing saves paid calls. | Confirm during 2f that the extraction prompt contains no owner data. If it does, prefix the key. |
| Q15 | **New.** Fix the router mount order in Phase 0 so `GET /api/contacts/action-items` is reachable. | Rename the path. | `contactsRouter` mounts before `mcpRouter` (`server/app.ts:202`, `:204`), so `GET /contacts/:id` captures `action-items` as an id and returns 404. The route is dead today. Reordering changes nothing for any working client. | Recommended: mount `mcpRouter` first. |
| Q16 | **New.** Add `GET /api/dashboard/insight` and `POST /api/dedupe/scan` to the per-user AI limiter. Leave `POST /api/contacts/bulk` out. | Limit only what `AI_COST_PATTERNS` lists today. | Both routes call a provider and are not in the pattern list. The bulk import is rare, already 50 MB-capped, and runs its AI work asynchronously. | Recommended as written. |

---

## 2. Technical questions

Status: **Resolved** means tested or verified from a primary source, and the
plan documents were updated. **Open** means a small check remains and a
fallback exists.

### 2.1 Questions from the first draft

| # | Question | Answer | Status |
| - | -------- | ------ | ------ |
| T1 | Does sqlite-vec 0.1.9 accept `TEXT PARTITION KEY` with UUID values and filter KNN correctly? | Yes. Verified with script 01: two owners, KNN with `ownerId = ?` returns only that owner's rows. `DELETE`, `SELECT`, and `COUNT(*)` with `WHERE ownerId = ?` also work. The 0.1.6 release post states partition keys may be `TEXT` or `INTEGER`. | Resolved |
| T2 | Does `ALTER TABLE ... RENAME` work on `vec0` tables? | No, and it is dangerous. On 0.1.9 the statement returns OK but the shadow tables keep their old names, and the next read fails with `no such table: main.<new>_rowids`. Rename support arrives in 0.1.10 (pre-release). The plan's copy-through-memory rebuild is required. Never rename a `vec0` table. | Resolved |
| T3 | Does Express 5 expose `app.router.stack` or `app._router.stack`? | `app.router` (a lazy getter). `app._router` is undefined. Router layers have no `regexp` property and do not store the mount path string; `layer.path` is set only after `layer.match(url)`. A naive walk yields leaf paths without their prefixes. The route manifest test records mount paths by wrapping `use` during `createApp()`, or probes with `layer.match()`. See [05-phase-0-foundations.md](05-phase-0-foundations.md) task 0.3. | Resolved |
| T4 | Does `AsyncLocalStorage` context survive multer's `destination` callback and SSE `EventEmitter` listeners? | Multer 2.2.0 `destination` and `filename` keep the context (script 03). `await`, `setTimeout`, and `Promise.all` keep it. An `EventEmitter` listener runs in the context of the code that calls `emit`, not the code that subscribed: an emit from a background job or from outside any context gives the listener that context or `null`. SSE handlers therefore capture `scope` in the closure and never read it from the context inside a listener. One open item: multer issue #1111 reports context loss in the route handler after `upload.single()` when the multipart body also carries text fields. See T25. | Resolved, one sub-item open |
| T5 | FTS5 `unicode61` with `remove_diacritics` and the owner token. | The table uses the default tokenizer with no options (`server/db.ts:390-392`). `fts5vocab` shows the 33-character token stored as one term. ASCII letters and digits are token characters; `-` is a separator; diacritic removal does not touch ASCII. | Resolved |
| T6 | Does the FTS `AND` wrapper interact badly with the prefix strategy `"john"* OR "smith"*`? | No. Verified for all three shapes: `ownerTok:X AND ("john smith")`, `ownerTok:X AND ("john"* OR "smith"*)`, and `ownerTok:X AND ({name company} : (john OR acme))`. A wrong owner token returns nothing. | Resolved |
| T7 | `VACUUM INTO` disk space on a small NAS. | `VACUUM INTO` needs free space for one compacted copy, not two. The output file must not exist. It must run outside any transaction (verified: "cannot VACUUM from within a transaction"). `fs.statfsSync` exists on Node 22. The plan checks free space before the backup and skips with an `error` log below 1.5 × database size. | Resolved |
| T8 | Does the `vec0` copy step slow the integration suite? | No. The detection is one `sqlite_master` read. On a fresh database the tables are created with the partition key and nothing is copied. When rows exist, 50,000 × 384-dim rows copy in 0.9 s. | Resolved |
| T9 | Is `hydrateMany` a lint exception or should it carry `ownerId`? | Lint exception with reason `owner-checked by caller`. The parent rows came from a scoped statement. `hydrate` also reads `lists` and `interactions` by contact id (`server/repositories/contactRepository.ts:122-130`, `:381-401`), which are owned tables, so those statements carry the same comment. | Resolved |

### 2.2 Questions found by the review

| # | Question | Answer | Status |
| - | -------- | ------ | ------ |
| T10 | Why does the ownership claim take 5 ms per contact, and the purge 15 ms per contact? | Every FTS trigger starts with `DELETE FROM contacts_fts WHERE contactId = ?`. That column is `UNINDEXED`, so SQLite scans the whole virtual table on every contact update and on every child-row insert or delete (4 ms at 40,000 rows). This is a latent cost in 1.5.5, not something the plan introduces. FTS v2 adds an indexed `cidTok` column and every trigger deletes with `MATCH 'cidTok:...'` (0.011 ms). Measured on 5,000 contacts: the claim drops from 27.1 s to 0.23 s, the purge from 77.1 s to 0.2 s. See the data model document, section 5. | Resolved |
| T11 | Does the claim `UPDATE contacts SET ownerId` have side effects? | Yes. It fires `contacts_auto_updated_at`, which stamps `updatedAt` on every claimed row. `findStaleEmbeddings` compares `contacts.updatedAt` with `dedupe_embedding_meta.embeddedAt`, so the next deep dedupe scan would re-embed the whole corpus through the paid provider. The child backfill fires `interactions_auto_updated_at` the same way. The migration drops the three `_auto_updated_at` triggers and the three `action_items_sync_*` triggers before the claim and the backfill. Sections 4, 5, and 6 of `server/db.ts` recreate them (each begins with `DROP TRIGGER IF EXISTS`). The migration test asserts `updatedAt` is byte-identical before and after. | Resolved |
| T12 | Can a fresh 2.0 database boot with the plan's section order? | No, as first written. The FTS block (§3) referenced `contacts.ownerId`, and on a fresh database that column was added later, at §9i. The backfill `INSERT ... SELECT` fails at prepare time with `no such column` even with zero rows. The tenancy block now runs before the FTS block, and the three dedupe tables move above it. See the data model document, section 10. | Resolved |
| T13 | Can `server/db.ts` call `ensureLocalOwner` from `authService`? | No. `authService.ts` imports `sqlite` and `OWNED_TABLES` from `db.ts` and runs `sqlite.prepare` at module top level. An import in the other direction is a cycle that throws at boot. `ensureLocalOwner`, `primaryAdminId`, and `claimUnownedData` live in `server/db.ts` as raw SQL and are exported. `authService` imports them, the same way it imports `OWNED_TABLES` today. | Resolved |
| T14 | Are the BM25 weights right? | No. `bm25()` weights are positional and include `UNINDEXED` columns. The current nine-value string covers ten columns, so every weight sits one column to the left of its intended target. The v2 table has twelve columns and needs twelve weights, with `0.0` for `ownerTok` and `cidTok`. See Q13 for the decision. | Resolved, decision Q13 |
| T15 | What does sqlite-vec 0.1.9 refuse on a partitioned table? | `UPDATE` of a partition key column ("not supported yet"). `UPDATE` of another column with an `EXISTS` subquery in the `WHERE` trips the same error (issue #261). `ownerId IN (...)` is not supported (issue #142). `k` has a maximum of 4096 (issue #157). An `INSERT` that omits `ownerId` succeeds with a `NULL` partition and no error. The plan uses `DELETE` plus `INSERT` for every upsert, never `IN` on the partition column, and adds a `NULL`-partition count to the verification queries. | Resolved |
| T16 | How long does an owner purge hold the write lock? | With today's triggers, 77 s for 5,000 contacts, which would starve every other writer past `busy_timeout`. With the `cidTok` triggers, 0.2 s. The Phase 3 acceptance criterion is 10,000 contacts under 2 s, measured. | Resolved by T10 |
| T17 | Do the frontend's error paths see the new `403` codes? | Not as first written. Ten of twelve API modules call `fetch` directly and bypass `apiFetch`, so an interceptor in `apiFetch` reaches only `contacts.ts` and `aiSettings.ts`. `emitAuthExpired()` dispatches a bare `Event` with no reason. `EventSource` streams cannot deliver a `403` body. Phase 4 adds one shared response handler used by every module, a `CustomEvent` with a `detail.reason`, and status polling as the SSE fallback. | Resolved |
| T18 | Why is `GET /api/contacts/action-items` unreachable? | Mount order (Q15). | Resolved, decision Q15 |
| T19 | Can a per-user rate limiter read the principal? | Not where the AI limiter mounts today. `aiEndpointRateLimit` runs at `server/app.ts:142`, before `attachPrincipal` at `:170` and before `req.requestId` at `:145`. Phase 0 moves the request id above the limiter. Phase 3 mounts the user-keyed limiter after `attachPrincipal`. | Resolved |
| T20 | Where does the daily audit-log sweep run? | Nowhere today. `cleanupOldInvocations` runs once at boot with no interval (`server.ts:170-174`). Phase 3 adds one daily maintenance interval, gated by `DISABLE_BACKGROUND_JOBS`, that sweeps `audit_log`, expired `sessions`, expired `api_tokens`, expired `invitations`, and old `ai_invocations`. | Resolved |
| T21 | Does the test harness survive a permanent local owner? | Not as written. `wipeAccounts()` in `api.auth.test.ts` runs `DELETE FROM users`, which fails on `ON DELETE RESTRICT` once the local owner owns rows. Every other integration file runs auth-off and creates rows owned by the local owner. The harness reset becomes: delete owned rows, delete sessions, delete users, then `ensureLocalOwner()`. | Resolved |
| T22 | Does the fill-trigger template fit every child table? | `dedupe_exclusions` has no `id` column. Its trigger keys on `(contactIdA, contactIdB)`. | Resolved |
| T23 | Is renaming `USER_REQUIRED` to `SESSION_REQUIRED` free? | No. `requireUser` returns `403 USER_REQUIRED` today and `api.auth.test.ts:379` asserts it. The frontend does not read the code. The rename is a documented breaking change in 2.0. The alternative is to keep the old string under the new middleware name. The plan renames it, because the new name describes the check and 2.0 is a major. | Resolved |
| T24 | Does `INSERT OR REPLACE` work on a partitioned `vec0` table? | The dedupe upsert uses `INSERT OR REPLACE INTO contact_embeddings` (`server/services/dedupe/embeddings.ts:188`). sqlite-vec lists `INSERT OR REPLACE` support as new in 0.1.10. Phase 1 day one runs it on a partitioned table in the smoke test. Fallback: `DELETE` then `INSERT`, which the search store already does. | Open, one-line fallback |
| T25 | Does the route handler after `upload.single()` keep the `AsyncLocalStorage` context when the multipart body has text fields? | Multer issue #1111 (open) reports loss on 1.4.4-lts.1 and later in that exact case. Not reproduced here because the upload routes carry no text fields today. The Phase 0 context test includes a multipart request with one text field. Fallback: the two upload handlers read the scope from `req.principal`, which is always present. | Open, one-line fallback |
| T26 | Does an FK cascade fire the child table's triggers? | Yes (verified). `DELETE FROM contacts` fires `fts_emails_ad` and the others for every cascaded child row. This is why T10 mattered for the purge. With `cidTok` each firing is cheap. | Resolved |
| T27 | Does the mismatch trigger fire when the parent contact has `NULL` owner? | No. `NEW.ownerId != NULL` is `NULL`, so the `WHEN` clause is false. This is harmless because the invariant triggers are installed after the claim, when no `NULL` owner exists. The verification query for `NULL` owners covers the gap. | Resolved |

---

## 3. Cross-phase risks

| Risk | Impact | Mitigation | Owner |
| ---- | ------ | ---------- | ----- |
| A leak ships | Highest. Personal data. | Three structural guards, matrix test, security review, staged release with the upgrade guide recommending a backup. | Phase 2 and 5 |
| Migration corrupts or loses data | High | `VACUUM INTO` backup, idempotent steps, verification script, migration test on a 1.5.5 fixture and on real copies, rollback rehearsal. | Phase 1 |
| Migration takes minutes on a large instance | Medium | The claim runs with the FTS and `updatedAt` triggers dropped, then one bulk FTS backfill (233 ms per 50,000 rows). The `vec0` copy is under 1 s per 50,000 rows. Measured, not estimated. Boot logs each step with a duration. | Phase 1 |
| Migration triggers a paid re-embed | Medium | `updatedAt` is untouched (T11). The migration test asserts `embedBatch` is never called and `updatedAt` is unchanged. | Phase 1 |
| Performance regression for single-user instances | Medium | Bench baseline in Phase 0, compared at Phase 2i and 5. Indexes proven with plan tests. The `cidTok` trigger fix makes contact updates faster than today. | Phase 5 |
| `AsyncLocalStorage` overhead | Low | One published HTTP benchmark shows 7 to 10 percent lower throughput on Node 22 and 24. This app spends its time in SQLite and AI calls, not in the router. The Phase 0 baseline measures the real number. | Phase 0 |
| Purge holds the write lock | Low after T10 | Measured 0.2 s per 5,000 contacts with `cidTok`. If a real database exceeds 2 s per 10,000, chunk the contact delete at 1,000 rows per transaction. | Phase 3 |
| Scope creep into sharing or SSO | Medium | Both are listed in future work with their prerequisites. | Every phase |
| Test suite runtime grows | Low | The matrix is one file with two seeded owners. Estimated under 20 s. Today's suite runs 575 tests in 15.5 s. | Phase 2 |
| The `dedupe/merging.ts` conversion introduces a regression in merge logic | Medium | Existing merge tests run as two owners. Convert last within 2e. | Phase 2e |
| Operators lose track of the local owner concept | Low | Named "This device" in the UI. Documented in configuration.md. | Phase 4 and 5 |
| Frontend error mapping misses call sites | Medium | One shared response handler for every API module (T17). A unit test asserts every module imports it. | Phase 4 |

---

## 4. Effort summary

| Phase | Size | Days (one engineer) | Ships | Change from the first draft |
| ----- | ---- | ------------------- | ----- | --------------------------- |
| 0 Foundations | M | 5 to 7 | 1.6.0 | +1: route recorder for Express 5, mount-order fix, BM25 offset fix, extra context tests |
| 1 Storage | L | 7 to 10 | 2.0 branch | +1: `cidTok` triggers, trigger drops around the claim, seed scripts, harness reset |
| 2 Scoping | XL | 13 to 19 | 2.0 branch | +1: sites found by the review (appendix A, section A2) |
| 3 Accounts and admin | L | 7 to 10 | 2.0 branch | daily maintenance interval replaces the assumed sweep, no net change |
| 4 Frontend | L | 8 to 11 | 2.0 branch | +1: shared response handler, lazy settings routes, mobile identity |
| 5 Hardening and release | M | 5 to 7 | 2.0.0 | none |
| **Total** | | **45 to 64** | | |

Phases 3 and 4 can overlap once Phase 3 has stubbed the endpoints. Phase 2's
nine sub-phases are sequential because each converts shared files.

---

## 5. What the review changed

The review compared every document against the `v1.5.5` source, ran the
scripts in `bench/review-2026-09-08/`, and checked the external claims
against their sources. Corrections landed in the documents themselves. The
ones that changed the design:

1. **FTS v2 gets a second indexed token, `cidTok`** (T10). Data model §5, architecture §6.
2. **The tenancy block runs before the FTS block** and drops the FTS, `updatedAt`, and `action_items_sync_*` triggers around the claim (T11, T12). Data model §10.
3. **The tenancy helpers live in `server/db.ts`**, not `authService` (T13). Architecture §14.
4. **Twelve BM25 weights** and a decision on the offset (T14, Q13). Data model §5.4, Phase 0 task 0.10.
5. **`VACUUM INTO` runs before the transaction opens** (T7). Data model §1.
6. **Route manifest walker records mount paths** (T3). Phase 0 task 0.3, testing strategy §4.
7. **SSE handlers capture the scope in the closure** (T4). Phase 2 recipe.
8. **Per-user limiter mounts after `attachPrincipal`**, request id moves above the AI limiter (T19). Phase 0, Phase 3.9.
9. **One daily maintenance interval** (T20). Phase 3.8.
10. **Shared frontend response handler, `CustomEvent` reason, SSE polling fallback** (T17). Phase 4.11.
11. **Purge and claim targets are measured numbers** (T10, T16). Phase 1 and Phase 3 acceptance.
12. **Mount order fix** so the MCP action-items route is reachable (Q15). Phase 0.

Counts corrected: 575 tests in 41 files (not 316), 49 tests in
`api.auth.test.ts` (not 50), eleven FTS triggers (not twelve), 25
`recordInvocation` call sites (not 27), seven `requireUser` call sites (not
four), five zero-state statements (not six), three vitest projects (not two).
