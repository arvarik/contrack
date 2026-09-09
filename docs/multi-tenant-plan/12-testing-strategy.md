# 12. Testing Strategy

Isolation cannot be proven by reading code. This document defines the tests
that prove it, the tools that keep it proven, and the definition of done for
each phase.

The existing harness is kept: vitest with three projects (`unit` with a
mocked database, `integration` with a real SQLite database per file in a
temp `DATA_DIR`, and `contract` against real providers, which `npm test`
does not run), `createApp()` mounted with supertest,
`DISABLE_BACKGROUND_JOBS=true`, and AI in mock mode. See
`tests/integration-setup.ts` and `tests/integration/helpers.ts`. Today:
41 files, 575 tests, about 16 s.

---

## 1. Test inventory

| File | Phase | Purpose |
| ---- | ----- | ------- |
| `tests/unit/tenancy.scope.test.ts` | 0 | `Scope` constructors, `ownerToken` and `contactToken` equal SQLite's expressions, each token is one FTS5 term, `currentScope()` throws `NO_SCOPE` outside a context |
| `tests/unit/tenancy.requestContext.test.ts` | 0 | context survives `await`, `setTimeout`, `setImmediate`, and `Promise.all`; an `EventEmitter` listener sees the emitter's context, and `null` when the emit comes from outside any context |
| `tests/integration/tenancy.context.upload.test.ts` | 0 | context intact inside multer `destination` and `filename` and in the handler after `upload.single()` with a text field in the body (multer issue #1111) |
| `tests/unit/tenantLint.test.ts` | 0 | the lint flags a statement without `ownerId`, honors the allow comment, rejects an unknown reason, and ignores non-owned tables |
| `tests/unit/search.test.ts` (extended) | 0 | `bm25()` weights are positional and include `UNINDEXED` columns |
| `tests/unit/ftsTriggers.test.ts` | 1 | snapshot of the generated FTS trigger SQL; every delete uses `WHERE rowid = old.rowid` and never `contactId`; every insert writes `ownerTok`; `contacts_ai` has the `deletedAt` guard; one BM25 weight per column. The `vec0` DDL equality moved to `tenancy.storage.test.ts`, which needs a real sqlite-vec |
| `tests/integration/tenancy.triggerCost.test.ts` | 1 | updating 1,000 contacts on a 5,000-contact database finishes in under 500 ms |
| `tests/integration/tenancy.routeManifest.test.ts` | 0, 2i, 3 | every route classified. From 2i: every `scoped` route `isolated`. From 3: every `admin` route carries `requireAdmin` |
| `tests/integration/tenancy.stamping.test.ts` | 0 | every insert into an owned table carries the caller's id |
| `tests/integration/tenancy.isolation.test.ts` | 0 (skeleton), 2 (filled) | the cross-owner matrix |
| `tests/integration/tenancy.migration.test.ts` | 1 | 1.5.5-shaped database migrates, verifies, and is idempotent on second boot; `updatedAt` unchanged on every contact and interaction; `embedBatch` never called; the seventeen triggers exist afterward; the backup file opens; the auth-on variant keeps the real account |
| `tests/integration/tenancy.localOwner.test.ts` | 1 | local owner creation, claim, conversion by setup, forced-auth rule |
| `tests/integration/tenancy.uploads.test.ts` | 1, 2a | files land under the owner dir, guard returns 404 across owners |
| `tests/integration/tenancy.search.test.ts` | 2c | FTS owner token, vector partition, hybrid retrieval never returns another owner's contact even when that contact is the best match |
| `tests/integration/tenancy.dedupe.test.ts` | 2e | identical contacts under two owners never pair, scan state per owner, merge and undo 404 across owners |
| `tests/integration/tenancy.cache.test.ts` | 2f | `aiCache` owner keys, `dailyInsight` per owner |
| `tests/integration/tenancy.jobs.test.ts` | 2f, 2h | AI Search batch state per owner, `recordInvocation` attribution inside SSE and background contexts |
| `tests/integration/tenancy.queryPlans.test.ts` | 2i | `EXPLAIN QUERY PLAN` names the composite index for each hot statement |
| `tests/integration/api.admin.test.ts` | 3 | user management, invitations, tokens, registration, audit, last-admin and self guards, disable and purge |
| `tests/integration/api.auth.test.ts` | 1, 3 | updated for the new principal kinds, `requireSession`, status fields |
| `tests/unit/frontend.invite.test.ts` | 4 | invitation link parsing and token display formatting |
| `tests/unit/frontend.apiClient.test.ts` | 4 | no file under `src/api/` (except `auth.ts` and `client.ts`) calls `fetch` without the shared response handler |
| `scripts/bench-tenancy.ts` | 0, 2i, 5 | latency at four data shapes |
| `scripts/bench-concurrency.ts` | 5 | 10 owners for 60 s, count `503`s |

---

## 2. The two-user harness

`tests/integration/tenancy/helpers.ts`:

```ts
export interface Actor { user: AccountUser; cookie: string[]; scope: Scope }

export async function createActor(app, overrides?): Promise<Actor>
// First call: POST /api/auth/setup (admin). Later calls: authService.createUser (member)
// then POST /api/auth/login. Returns the cookie and a Scope for direct DB assertions.

export async function seedOwner(app, actor, shape: { contacts: number; interactions?: number; lists?: number; actionItems?: number }): Promise<Seeded>
// Uses the public API so every row is stamped the way production stamps it.
// Returns every created id grouped by table, plus one uploaded avatar URL and one attachment URL.

export function rowsOwnedBy(table: string, ownerId: string): number
// SELECT COUNT(*) FROM <table> WHERE ownerId = ?  (for before/after assertions)

export function resetAccounts(): void
// Deletes every owned table's rows, then sessions, api_tokens, users, then calls ensureLocalOwner().
// A bare DELETE FROM users fails on ON DELETE RESTRICT once the local owner owns rows.
```

Every isolation file does:

```ts
beforeAll(async () => { process.env.AUTH_REQUIRED = "true"; A = await createActor(app); B = await createActor(app, { username: "b" }); seedA = await seedOwner(app, A, { contacts: 20, interactions: 10, lists: 2, actionItems: 5 }); seedB = await seedOwner(app, B, { contacts: 5 }); });
```

---

## 3. The isolation matrix

For each `scoped` route in `ROUTE_MANIFEST`, one test with this shape:

| Route kind | Test |
| ---------- | ---- |
| `GET` by id | B requests A's id → `404`. A requests it → `200`. B requests a random UUID → `404` with an identical body. |
| `PUT`/`PATCH`/`DELETE` by id | B mutates A's id → `404`, and A's row is unchanged (compare the row before and after). |
| `POST` child under a parent id (`/contacts/:id/interactions`, `/action-items`, `/lists/:id/members`) | B posts under A's parent → `404`, no row created (count unchanged). |
| Bulk with an id list | B sends `[A's ids..., B's ids...]` → only B's rows affected. Response count equals B's count. |
| List endpoints | B's list contains zero ids from `seedA`. A's list contains zero from `seedB`. |
| Aggregates (`/dashboard`, `/zero-state`, `/action-items/count`, `/dedupe/suggestions/count`, `/ai/stats/summary`) | B's numbers equal what B alone seeded. |
| Search (`/search`, `/search/semantic`, `/search/synthesize`, `/query/contacts`, `/interactions/search`, `/timeline`) | Seed A with a contact whose name is a unique token (`"Zebulon Quarrington"`). B searches that token → empty. |
| Streams (SSE and NDJSON) | B opens A's `scanId` or `batchId` → `404` before any event. |
| Uploads | B fetches A's avatar and attachment URLs → `404`. |
| Export | B's JSON export contains only B's rows in every table. |

Assertions on the **database**, not only the response: after every mutating
attempt by B, `rowsOwnedBy` for A is unchanged and the specific row is
byte-identical.

Enumeration check: the `404` body for a foreign id and for a nonexistent id
must be identical (`deepEqual` on the JSON minus `requestId`).

---

## 4. Route manifest test

```ts
const registered = listRoutes(app);            // [{ method, path }]
const manifest = new Map(ROUTE_MANIFEST.map(r => [`${r.method} ${r.path}`, r]));
for (const r of registered) expect(manifest.has(key(r)), `unclassified route ${key(r)}`).toBe(true);
for (const k of manifest.keys()) expect(registered.some(r => key(r) === k), `stale manifest entry ${k}`).toBe(true);
// Phase 2i:
for (const r of ROUTE_MANIFEST.filter(r => r.class === "scoped")) expect(r.isolated, `${key(r)} not isolated`).toBe(true);
// Phase 3:
for (const r of ROUTE_MANIFEST.filter(r => r.class === "admin")) expect(hasMiddleware(app, r, "requireAdmin")).toBe(true);
```

`listRoutes` cannot join mount paths from the stack alone: Express 5's
router (`router@2.2.0`) does not store mount path strings, layers have no
`regexp`, and `layer.path` is set only after `layer.match(url)`. The helper
wraps `Router.prototype.use` and `app.use` while `createApp()` runs to record
each mount path, restores them, then walks `app.router.stack` and joins the
recorded prefixes with `route.path`. About forty lines, pinned to
`router@2.2.0` with a comment. It also reports `route.stack` handler names so
the Phase 3 `requireAdmin` check works, and it recognises the
`express.static` layer (`layer.name === "serveStatic"`) for the `/uploads`
row. Rows marked `devOnly` are expected only when `NODE_ENV !== "production"`.

---

## 5. Tenant lint

`scripts/tenant-lint.mjs` is a regex scanner, not a parser. That is
deliberate: it must be fast, dependency-free, and readable by anyone. It
looks for SQL keywords followed by an owned table name inside string and
template literals, and for Drizzle chains on owned schema objects. It checks
the same literal (or the same chain expression up to the terminating `;`)
for `ownerId` or `ownerTok`.

False positives are silenced with `// tenant-lint: allow <reason>` on the
line above the statement. The reason is mandatory and appears in the report.
Accepted reasons:

- `instance sweep` (background maintenance across owners)
- `owner-checked by caller` (child statement after a scoped parent lookup)
- `boot migration`
- `admin cross-user` (an admin report or the purge)
- `derived table` (a `contact_*` read by contact id)

`tests/unit/tenantLint.test.ts` runs the scanner on fixture strings.

---

## 6. Query plan tests

For each statement in the Phase 2i table:

```ts
const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map(r => r.detail).join("\n");
expect(plan).toMatch(/USING (COVERING )?INDEX idx_contacts_owner_status/);
expect(plan).not.toMatch(/SCAN contacts\b/);
```

For the scoped FTS query the plan is `SCAN contacts_fts VIRTUAL TABLE INDEX
0:M...` (the `MATCH` index) and nothing else; a `SCAN contacts_fts VIRTUAL
TABLE INDEX 0:` with no `M` means the owner predicate fell out of the
`MATCH` expression.

The database is seeded with two owners and 500 contacts each before the
check, then `ANALYZE` runs, because SQLite's planner prefers a scan on an
empty table.

---

## 7. Migration test

Described in [06-phase-1-storage.md](06-phase-1-storage.md) section 2, task
1.12. The fixture builder `tests/fixtures/make-v1-database.ts` is the only
code that encodes the 1.5.5 shape. It is versioned with a comment naming the
release it reproduces.

---

## 8. Benchmarks

`scripts/bench-tenancy.ts` output is committed under
`docs/multi-tenant-plan/bench/` at Phase 0 (baseline), Phase 2i, and Phase
5. Each file records the machine, the Node version, the SQLite version, the
data shape, and a markdown table of p50 and p95 per endpoint. Regressions
between files are explained in the same file.

---

## 9. Definition of done per phase

| Phase | Done when |
| ----- | --------- |
| 0 | Existing 575 tests green. Manifest test green with every route classified. Stamping test green. Context tests green, including the emitter rule and the multipart case. Lint report committed. Bench baseline committed. CI runs on `v2.0`. |
| 1 | Migration test green including second boot, `updatedAt` unchanged, no `embedBatch`. `tenancy:verify` passes on a real copied database in both auth modes. Local owner tests green. Upload relocation test green. Trigger cost test green. Day-one `vec0` smoke output in the PR. |
| 2 | Matrix has zero `todo` and is green. `tenant-lint --strict "server/**"` green. Query plan tests green. Bench at `10 × 2000` meets Phase 2 targets. |
| 3 | `api.admin.test.ts` green. Manifest asserts `requireAdmin` on every `admin` route. Audit rows asserted. |
| 4 | UI walkthrough recorded with screenshots. Two-browser manual check. Contrast audit green. Build green. |
| 5 | Four bench shapes recorded. Concurrency run with zero `503`s. Security checklist closed. Docs updated. Upgrade and rollback rehearsals recorded. Release PR merged with a merge commit, `v2.0.0` tagged, images and notes published. |

"Green" means the raw vitest summary line is pasted into the PR description,
as `.agent/TESTING.md` section 3 requires.
