# 05. Phase 0: Foundations and Safety Net

**Goal:** put the isolation scaffolding in place with **no user-visible
change**, fix the ownership-stamping gap, and fix three small defects the
review found in `v1.5.5`. Everything in this phase is additive. A
single-account instance behaves exactly as before.

**Lands on:** the `v2.0` integration branch (section 0). It has no
user-visible change, so it is safe to cherry-pick to `main` as `1.6.0` if a
release is wanted before 2.0. That is optional.

**Size:** M (about 5 to 7 engineering days).

**Depends on:** nothing.

This document is written so that an implementer can work from it alone.
Section 0 gives the repository facts, the branch workflow, and the
conventions. Section 8 restates every plan name and rule this phase uses.
The wider design is in [03-architecture.md](03-architecture.md) and the
review evidence is in [bench/review-2026-09-08/](bench/review-2026-09-08/README.md).

---

## 0. Context for the implementer

### 0.1 The repository

Contrack is a local-first personal CRM: Express 5.2.1 API in `server/`,
React 19 SPA in `src/`, one SQLite file through `better-sqlite3` 12.11
(SQLite 3.53.2) with the `sqlite-vec` 0.1.9 extension and FTS5. Drizzle ORM
0.45 supplies the types in `src/db/schema.ts` and two early migrations in
`drizzle/`; most DDL is idempotent raw SQL in `server/db.ts`, which runs at
import time. TypeScript 6 in strict mode. Vitest 4 with three projects:
`unit` (mocked database), `integration` (a real database in a temp
`DATA_DIR` per test file, `createApp()` under supertest), and `contract`
(real provider calls, not part of `npm test`). Node 22 is the runtime and the
Docker base image.

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | Starts the API with `tsx server.ts` (Vite serves the SPA in dev) |
| `npm test` | Runs the `unit` and `integration` projects. Today: 41 files, 575 tests, about 16 s |
| `npx vitest run --project integration tests/integration/<file>` | One integration file |
| `npm run lint` | ESLint plus `tsc --noEmit`. Must pass before a PR |
| `npm run format:check` | Prettier. CI runs it |
| `npm run build` | Production build. CI runs it |
| `npm run test:coverage` | What CI runs instead of `npm test` |

Key files for this phase:

| Path | Role |
| ---- | ---- |
| `server/app.ts` | `createApp()`: middleware order and router mounts. Line references below are to `v1.5.5` |
| `server/middleware/auth.ts` | `Principal`, `attachPrincipal`, `requireAuth`, `requireUser`, `currentUser`, `isAuthRequired` |
| `server/middleware/rateLimit.ts` | `createRateLimiter`, `aiEndpointRateLimit`, `AI_COST_PATTERNS` |
| `server/services/authService.ts` | `createUser`, `claimUnownedData`, `reconcileOwnership`, `countUsers` |
| `server/db.ts` | All DDL, `OWNED_TABLES`, FTS triggers, `vec0` tables |
| `server/services/search/hybridRetrieval.ts` | `BM25_WEIGHTS` at `:113`, `ftsRetrieval` at `:276` |
| `tests/integration/helpers.ts`, `tests/integration-setup.ts` | `makeTestApp()`, the per-file temp `DATA_DIR`, mock AI, `AUTH_REQUIRED=""` by default |
| `tests/integration/api.auth.test.ts` | The 49 existing auth tests |
| `.agent/ARCHITECTURE.md`, `.agent/TESTING.md`, `.agent/STYLE.md` | House rules. `TESTING.md` §3: paste the raw vitest summary into every PR |

### 0.2 Branch, PR, and release workflow (applies to every phase)

- All multi-tenant work lands on one integration branch, **`v2.0`**, created from `main` at the start of this phase:

  ```bash
  git checkout main && git pull
  git checkout -b v2.0 && git push -u origin v2.0
  ```

- **The first PR on the branch is task 0.0 below**, which makes CI run for the branch. Until it merges, pull requests into `v2.0` run no tests, because `.github/workflows/ci.yml` lists only `main` under `pull_request.branches`.
- Each phase is one PR from a feature branch into `v2.0`. Phase 2 is nine PRs, one per sub-phase. Branch names: `v2.0/phase-0-foundations`, `v2.0/phase-2a-contacts`, and so on. PRs are **squash-merged** into `v2.0`, which is the repository's habit (every commit on `main` has one parent and a `(#N)` suffix).
- PR title: `feat(tenancy): phase 0, foundations and safety net`. Commit messages use the `type(area): subject` form from `CONTRIBUTING.md`. No AI attribution trailers or footers anywhere.
- PR description: one plain sentence saying what the PR adds and why, then short sections in this order: what users or the API see, how it works, operational behavior, guarantees. Nested bullets for reviewer context. A **Testing** section with the exact commands and the raw vitest summary line, for example `Test Files  44 passed (44) / Tests  612 passed (612)`. No semicolons, no em-dashes.
- Keep `v2.0` current with `main`: run `git merge origin/main` into `v2.0` at every phase boundary and before the final release PR. Merge, do not rebase, because the branch is shared.
- `package.json` stays at `1.5.5` on the branch until Phase 5 sets `2.0.0`. Each phase adds its entry under `## [Unreleased]` in `CHANGELOG.md`, prefixed with the phase, for example `- **Phase 0.** ...`.
- Nothing is released from `v2.0`. Phase 5 merges `v2.0` into `main` with a merge commit, tags `v2.0.0`, and publishes. See [10-phase-5-hardening-release.md](10-phase-5-hardening-release.md) section 4.
- Never push to `main` directly. Never force-push `v2.0`.

### 0.3 Facts about `v1.5.5` that this phase depends on

- `req.principal` is `{kind:"anonymous"} | {kind:"user"; user; sessionId} | {kind:"service"}` (`server/middleware/auth.ts:46-52`). Only `server/routes/auth.ts` reads it.
- Nothing stamps `ownerId` on insert. `createContact` builds its values in `buildInsertValues` (`server/services/contactService.ts:94-114`) with no owner field. `INSERT INTO lists` at `listService.ts:37`, `INSERT INTO ai_invocations` at `aiStatsService.ts:88-91`, and `INSERT INTO dedupe_merge_log` at `dedupe/suggestions.ts:127-131` omit it. The ghost insert at `interactionService.ts:70-80` and the dev seed at `dedupe/engine.ts:584-585` omit it too.
- Ownership is assigned only in bulk: `claimUnownedData` on first account creation (`authService.ts:323`) and `reconcileOwnership()` at `server/app.ts:113`, which does nothing unless exactly one user exists.
- The AI rate limiter mounts at `server/app.ts:141-143`, **before** `req.requestId` is assigned at `:145-148` and before `attachPrincipal` at `:170`. A limiter `429` therefore has no request id.
- `contactsRouter` mounts at `server/app.ts:202` and `mcpRouter` at `:204`. `GET /contacts/:id` (`routes/contacts.ts:122`) captures `GET /api/contacts/action-items` (`routes/mcp.ts:34`) with `id = "action-items"` and returns `404`. The MCP route is unreachable today.
- `BM25_WEIGHTS` (`hybridRetrieval.ts:113`) has nine values for a ten-column FTS table. `bm25()` weights are positional and include `contactId UNINDEXED` at position 0, so `name` receives 5.0 instead of the intended 10.0 and every other column is shifted one to the left.
- Express 5's router does not store mount path strings. `app.router` is a lazy getter, `app._router` is undefined, layers have no `regexp`, and `layer.path` is set only after `layer.match(url)`. A naive walk of `app.router.stack` yields `/`, `/reorder`, `/contacts/:id/timeline` without their prefixes.
- `AsyncLocalStorage` context survives multer's `destination` and `filename` callbacks, `await`, `setTimeout`, and `Promise.all` (verified with multer 2.2.0). An `EventEmitter` listener runs in the context of the code that calls `emit`. multer issue #1111 reports context loss in the handler after `upload.single()` when the multipart body also has text fields.

---

## 1. Deliverables

| # | Deliverable | Files |
| - | ----------- | ----- |
| 0.0 | `v2.0` branch exists and CI runs for it | `.github/workflows/ci.yml` |
| 0.1 | `Scope` type, constructors, `ownerToken`, `contactToken` | `server/tenancy/scope.ts` (new) |
| 0.2 | Request context on `AsyncLocalStorage`; request id moved above the AI limiter | `server/tenancy/requestContext.ts` (new), `server/app.ts` |
| 0.3 | Route manifest, route recorder, coverage test | `server/tenancy/routeManifest.ts` (new), `tests/integration/tenancy/listRoutes.ts` (new), `tests/integration/tenancy.routeManifest.test.ts` (new) |
| 0.4 | Tenant lint in report mode | `scripts/tenant-lint.mjs` (new), `package.json` |
| 0.5 | Ownership stamping on every insert into an owned table | `server/services/contactService.ts`, `listService.ts`, `aiStatsService.ts`, `dedupe/suggestions.ts`, `interactionService.ts`, `dedupe/engine.ts` |
| 0.6 | Two-user integration test harness | `tests/integration/tenancy/helpers.ts` (new) |
| 0.7 | Isolation matrix skeleton (`it.todo` per route) | `tests/integration/tenancy.isolation.test.ts` (new) |
| 0.8 | Benchmark script and baseline numbers | `scripts/bench-tenancy.ts` (new), `docs/multi-tenant-plan/bench/baseline-phase-0.md` |
| 0.9 | Comment and doc corrections | `server/middleware/auth.ts`, `src/db/schema.ts`, `server/db.ts`, `.agent/ARCHITECTURE.md`, `.agent/TESTING.md`, `.agent/STATUS.md` |
| 0.10 | BM25 weight offset fix, its own PR | `server/services/search/hybridRetrieval.ts`, `tests/unit/search.test.ts` |
| 0.11 | Router mount order fix so the MCP action-items route is reachable | `server/app.ts`, `tests/integration/api.compatEndpoint.test.ts` or a new MCP test |
| 0.12 | `CHANGELOG.md` entry under Unreleased | `CHANGELOG.md` |

---

## 2. Tasks

### 0.0 Branch, CI, and the plan itself

1. Create `v2.0` from `main` as in section 0.2.
2. On a feature branch, edit `.github/workflows/ci.yml`: add `"v2.0"` to `on.pull_request.branches` and to `on.push.branches`. Do not touch the `if:` conditions on `build-image` (`github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v')`) or `release` (`startsWith(github.ref, 'refs/tags/v')`). A push to `v2.0` then runs tests and publishes nothing.
3. **Commit the plan on the branch.** `docs/multi-tenant-plan/` is listed in `.gitignore` (line 58), so a fresh clone has none of these documents and no reviewer or implementer can follow the references in the PRs. Remove that line on the branch and commit the whole folder, including `bench/`. The folder stays tracked for the life of `v2.0`; Phase 5 decides where it goes at release (see [10-phase-5-hardening-release.md](10-phase-5-hardening-release.md) section 4.5). Do not commit the two scratch databases `bench/review-2026-09-08/` may have produced under `/tmp`; only the `.cjs` scripts and the README belong in the folder.
4. Open the PR into `v2.0`, confirm the `build-and-test` job runs on it, merge.

From this point on, each phase PR ticks its own acceptance boxes in its
phase document and records measured numbers under `bench/`, so the plan
stays a live record of what shipped.

### 0.1 `server/tenancy/scope.ts`

```ts
import type { Request } from "express";
import { AppError } from "../utils/AppError.ts";
import type { User } from "../services/authService.ts";

declare const ownerIdBrand: unique symbol;
export type OwnerId = string & { readonly [ownerIdBrand]: true };
export interface Scope { readonly ownerId: OwnerId }

export function scopeForUser(user: Pick<User, "id">): Scope {
  return Object.freeze({ ownerId: user.id as OwnerId });
}

/** Background jobs only. Never called from a route. */
export function scopeForOwnerId(id: string): Scope {
  return Object.freeze({ ownerId: id as OwnerId });
}

export function scopeOf(req: Request): Scope {
  const p = req.principal;
  if (p?.kind === "user") return scopeForUser(p.user);
  // Phase 0: anonymous and service principals have no owner yet. Phase 1
  // removes both kinds. Until then, callers that need a scope get a 401.
  throw new AppError("Authentication required", 401, { code: "UNAUTHORIZED" });
}

/** FTS5 owner token. Must equal  'o' || replace(ownerId, '-', '')  in server/db.ts. */
export function ownerToken(scope: Scope): string {
  return "o" + scope.ownerId.replace(/-/g, "");
}

/** FTS5 contact token. Must equal  'c' || replace(id, '-', '')  in server/db.ts. */
export function contactToken(contactId: string): string {
  return "c" + contactId.replace(/-/g, "");
}
```

In Phase 0 nothing calls `scopeOf` on the data path yet. The function exists
so Phase 2 has one place to change when Phase 1 makes every principal a user.
`contactToken` is unused until Phase 1 writes the FTS triggers; it lives here
from the start so the unit test below pins both tokens together.

Unit test (`tests/unit/tenancy.scope.test.ts`): for a fixed UUID, assert
`ownerToken` equals `SELECT 'o' || replace(?, '-', '')` and `contactToken`
equals `SELECT 'c' || replace(?, '-', '')` computed by an in-memory
better-sqlite3 database in the same test. Assert the token is one FTS5 term
by creating a one-column `fts5` table, inserting the token, and matching it
with `MATCH 'col:<token>'`.

### 0.2 `server/tenancy/requestContext.ts`

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError.ts";
import type { Principal } from "../middleware/auth.ts";
import { scopeForUser, type Scope } from "./scope.ts";

export interface RequestContext {
  requestId: string;
  principal: Principal | null;
  scope: Scope | null;
}

const als = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}
export function getContext(): RequestContext | null {
  return als.getStore() ?? null;
}
export function currentScope(): Scope {
  const s = getContext()?.scope;
  if (!s) throw new AppError("No owner scope on this code path", 500, { code: "NO_SCOPE" });
  return s;
}
export function currentScopeOrNull(): Scope | null {
  return getContext()?.scope ?? null;
}

export function attachRequestContext(req: Request, _res: Response, next: NextFunction): void {
  const p = req.principal ?? null;
  const scope = p?.kind === "user" ? scopeForUser(p.user) : null;
  runWithContext({ requestId: req.requestId, principal: p, scope }, () => next());
}
```

Changes in `server/app.ts`:

1. Move the `req.requestId` assignment (today `:145-148`) **above** `app.use(aiEndpointRateLimit)` (today `:141-143`). A limiter `429` then carries a request id like every other error.
2. Mount `attachRequestContext` directly after `attachPrincipal` (today `:170`) and before the `/api/auth` router (today `:175`).

Rules the context must follow, and the tests that pin them
(`tests/unit/tenancy.requestContext.test.ts`):

- The store survives `await`, `setTimeout`, `setImmediate`, `Promise.all`, and a `for await` loop.
- An `EventEmitter` listener sees the context of the **emitter**, not the subscriber. The test subscribes inside `runWithContext(A)`, emits from inside `runWithContext(B)`, and asserts the listener sees `B`; then emits from outside any context and asserts `null`. This is why every SSE handler in Phase 2 captures `scope` in its closure.
- `currentScope()` throws an `AppError` with status 500 and code `NO_SCOPE` outside a context.
- Integration test: a multipart upload with **one text field plus one file** to a test-only route wrapped in `upload.single()` asserts `getContext()` is intact inside `destination`, inside `filename`, and inside the handler after multer. If the handler assertion fails (multer issue #1111), record it in the PR and have the two upload handlers in Phase 1 read the scope from `req.principal` instead of the context.

`recordInvocation` in `server/services/aiStatsService.ts` reads
`currentScopeOrNull()?.ownerId` and writes it into the existing `ownerId`
column. Boot-time jobs produce `NULL`, which is correct until Phase 2 wraps
them in a context.

### 0.3 Route manifest and route recorder

```ts
// server/tenancy/routeManifest.ts
export type RouteClass =
  | "public"         // no credential: /healthz, /api/auth/status, /api/auth/login, ...
  | "session-self"   // acts on the caller's own account: /api/auth/me, /api/auth/tokens
  | "scoped"         // reads or writes owned data for the caller's scope
  | "admin"          // requireAdmin
  | "instance-read"  // any authenticated caller, no owned data: /api/avatar/:style, /api/logos/:domain
  | "static";        // the /uploads express.static layer; guarded by middleware, not a route

export interface RouteEntry {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "USE";
  path: string;            // full path as a client sends it, with the mount prefix
  class: RouteClass;
  /** Phase 2 flips this when the isolation test for the route is green. */
  isolated: boolean;
  /** Only registered when NODE_ENV !== "production". */
  devOnly?: boolean;
}

export const ROUTE_MANIFEST: readonly RouteEntry[] = [ /* every row of appendix B */ ];
```

Express 5 does not keep mount path strings, so the test cannot rebuild
`/api/lists/reorder` from the stack alone. Use a **recorder**:

```ts
// tests/integration/tenancy/listRoutes.ts
import express from "express";
export interface RegisteredRoute { method: string; path: string; handlers: string[] }

/** Wraps Router.prototype.use and the app's use while fn runs, records every mount path,
 *  then walks app.router.stack and joins mount prefixes with route.path. */
export function listRoutes(build: () => express.Express): RegisteredRoute[] { /* about 40 lines */ }
```

Implementation notes for the recorder: patch `express.Router.prototype.use`
and `express.application.use` before calling `createApp()`, record
`(handle, mountPath)` for every string first argument (an array of strings
records one entry per string), restore the originals in a `finally`, then
walk `app.router.stack`: a layer with `layer.route` is a route (`route.path`,
`Object.keys(route.methods)`, and `route.stack.map(l => l.handle.name)` for
the handler names); a layer with `layer.name === "router"` is a mount whose
prefix is the recorded path for `layer.handle`; the `express.static` layer
has `layer.name === "serveStatic"`. Normalize a trailing `/` so
`/api/search/` and `/api/search` are one entry.

The test (`tests/integration/tenancy.routeManifest.test.ts`) asserts:

1. Every registered `method + path` has exactly one manifest entry.
2. Every manifest entry corresponds to a registered route, except rows with `devOnly: true` when `NODE_ENV === "production"`.
3. The `/uploads` static layer is present and the manifest has one `USE /uploads` row of class `static`.

Two routes need care. `GET /api/debug/cache-stats` is registered in
`server.ts:97-102`, outside `createApp()`, so a supertest app never has it.
Move it into `createApp()` behind the same `NODE_ENV !== "production"` guard
(after the routers, before the error handler) so the manifest can see it;
mark it `devOnly`. `POST /api/dev/seed-duplicates` is registered only when
`NODE_ENV !== "production"` at module load (`routes/dedupe/scan.ts:138`);
mark it `devOnly`.

The test does **not** yet assert `isolated`. Phase 2 adds that assertion when
the last route flips. The initial classification is in
[appendix-b-route-manifest.md](appendix-b-route-manifest.md).

### 0.4 Tenant lint (report mode)

`scripts/tenant-lint.mjs`:

- Walks `server/**/*.ts`.
- Finds every string or template literal that contains `FROM <t>`, `JOIN <t>`, `UPDATE <t>`, `DELETE FROM <t>`, or `INSERT INTO <t>` where `<t>` is an owned table (`contacts`, `lists`, `interactions`, `action_items`, `dedupe_suggestions`, `dedupe_exclusions`, `dedupe_merge_log`, `ai_invocations`) or a virtual table (`contacts_fts`, `search_embeddings`, `contact_embeddings`).
- Also finds Drizzle builder chains on `schema.contacts`, `schema.lists`, `schema.interactions`, `schema.actionItems` (`db.select().from(...)`, `db.insert(...)`, `db.update(...)`, `db.delete(...)`).
- Flags any such statement that does not contain the substring `ownerId` (or `ownerTok` for FTS), unless the previous line contains `// tenant-lint: allow <reason>` with one of the reasons listed in section 8.
- Two modes: `--report` prints a table and exits 0. `--strict <glob>` exits 1 on any flag inside matching files.
- `npm run lint` runs `tenant-lint --report` in Phase 0. Phase 2 moves files into `--strict` as they are converted, and Phase 2 ends with `--strict "server/**"`.

The report from Phase 0 is committed to
`docs/multi-tenant-plan/bench/tenant-lint-baseline.txt` so Phase 2 can watch
the count go to zero. Expect roughly 240 owned-table statements across about
375 statements in all (current-state document, section 4).

Unit test (`tests/unit/tenantLint.test.ts`): the scanner flags a statement
without `ownerId`, honors the allow comment, rejects an allow comment with an
unknown reason, and ignores non-owned tables.

### 0.5 Ownership stamping

For each insert into an owned table, take the owner from
`currentScopeOrNull()` in Phase 0. This keeps signatures unchanged for one
phase while closing the gap:

| Insert site | Change |
| ----------- | ------ |
| `contactService.createContact`, `bulkCreateContacts` (`buildInsertValues`, `:94-114`) | add `ownerId: currentScopeOrNull()?.ownerId ?? null` |
| `interactionService` ghost creation inside `runMentionExtraction` (`:70-80`) | same |
| `dedupe/engine.ts seedDuplicates` (`:584-585`, dev only) | same |
| `listService.createList` (`:37`) | add `ownerId` column to the `INSERT` |
| `aiStatsService.recordInvocation` (`:88-91`) | add `ownerId` column to the `INSERT` |
| `dedupe/suggestions.ts recordMerge` and `recordMergeUnsafe` (`:127-131`) | add `ownerId` from the primary contact's row (`SELECT ownerId FROM contacts WHERE id = ?`), not from context, because merges can run from a background scan |
| `dedupe/merging.ts` | no `INSERT INTO contacts` exists; merges only `UPDATE` and `DELETE`. Nothing to do here |

Anonymous mode still writes `NULL`, and `reconcileOwnership` still claims on
boot for a single account. Behavior for today's users is unchanged. For an
`AUTH_REQUIRED=true` instance, new rows are now owned immediately.

Test (`tests/integration/tenancy.stamping.test.ts`): with auth on, create a
contact, a list, an interaction with an `@mention` of an unknown name (which
creates a ghost), and trigger one AI call through the mock; assert every new
row's `ownerId` equals the signed-in user's id without a restart.

### 0.6 Two-user harness

`tests/integration/tenancy/helpers.ts` exports:

```ts
export interface Actor { user: AccountUser; cookie: string[]; scope: Scope }

export async function createActor(app, overrides?): Promise<Actor>
// First call: POST /api/auth/setup (admin). Later calls: authService.createUser (member),
// then POST /api/auth/login. Returns the cookie and a Scope for direct DB assertions.
export function asUser(actor: Actor): (req: supertest.Test) => supertest.Test
export async function seedOwner(app, actor, shape: { contacts: number; interactions?: number; lists?: number; actionItems?: number }): Promise<Seeded>
// Uses the public API (POST /api/contacts, /api/lists, /api/contacts/:id/interactions,
// /api/contacts/:id/action-items) so every row is stamped the way production stamps it.
// Returns every created id grouped by table, plus one uploaded avatar URL and one attachment URL.
export function rowsOwnedBy(table: string, ownerId: string): number
export function resetAccounts(): void
// Phase 0: DELETE FROM sessions; DELETE FROM users after deleting owned rows.
// Phase 1 changes this to keep or recreate the local owner (see 06, task 1.13).
```

### 0.7 Isolation matrix skeleton

`tests/integration/tenancy.isolation.test.ts` reads `ROUTE_MANIFEST`, and for
every `scoped` route creates an `it.todo("<METHOD> <path>: user B cannot reach user A's data")`.
Phase 2 replaces each `it.todo` with a real test as the route is converted.
The test file also has a `describe("list endpoints exclude other owners")`
block with one `it.todo` per list endpoint.

The point of the skeleton is the diff in Phase 2: every PR that converts a
domain replaces `todo` with a passing test, and the reviewer can see the
matrix fill in.

### 0.8 Benchmark baseline

`scripts/bench-tenancy.ts`:

- Boots the app against a temp `DATA_DIR` with `DISABLE_BACKGROUND_JOBS=true` and mock AI.
- Seeds `OWNERS × CONTACTS_PER_OWNER` (defaults `1 × 5000`, then `10 × 2000`, then `25 × 2000`) with realistic names, companies, tags, and 3 interactions per contact, through the service layer with a scope per owner. In Phase 0 the scope is set with `runWithContext` around each owner's inserts, which is what task 0.5 reads.
- Measures p50 and p95 over 50 iterations for: `GET /api/contacts?view=slim`, `GET /api/contacts/:id`, `GET /api/search?q=`, `POST /api/search/semantic` (mock AI, so this measures FTS plus vector), `GET /api/dashboard`, `GET /api/command-palette/zero-state`, `GET /api/contacts/:id/timeline`, `GET /api/action-items`, `POST /api/dedupe/scan` wall time (mock AI), and one `PATCH /api/contacts/:id` (to record today's FTS trigger cost per update).
- Prints a markdown table with the machine, Node, SQLite, and sqlite-vec versions in the header.

Phase 0 records the `1 × 5000` and the `10 × 2000` numbers for the current
code in `bench/baseline-phase-0.md` so Phase 5 has a before. Expect the
`10 × 2000` run to show the problem: every list endpoint returns 20,000 rows
to each user. Expect the `PATCH` to cost several milliseconds because of the
FTS trigger scan described in the current-state document, section 2.10.

### 0.9 Corrections

- `server/middleware/auth.ts:20-22` and `:223-227`: rewrite the comments to say ownership is stamped from the request context as of this phase.
- `src/db/schema.ts:144`: "eleven contact_* child tables" becomes "ten". Add a line pointing at this plan.
- `server/db.ts:268`: the second section labelled `2a` becomes `2b`.
- `.agent/ARCHITECTURE.md` §7 Invariants: add "Every function that reads or writes an owned table takes a `Scope` as its first argument. See `server/tenancy/scope.ts`."
- `.agent/TESTING.md` §1: "Two vitest projects" becomes three (`unit`, `integration`, `contract`), and the inventory gains the new test files.
- `.agent/STATUS.md`: the test count line says 316; update it to the real number after this phase.

### 0.10 BM25 weight offset (its own PR)

`BM25_WEIGHTS` in `server/services/search/hybridRetrieval.ts:113` becomes ten
values for the current ten-column table:
`"0.0, 10.0, 5.0, 3.0, 2.0, 2.0, 1.0, 1.0, 1.0, 1.0"`. Position 0 is
`contactId UNINDEXED` and gets `0.0`. This gives every column the weight the
constant's comment intends. Add a unit test in `tests/unit/search.test.ts`
that builds a three-column `fts5(id UNINDEXED, a, b)` table and asserts a
weight in position 1 boosts `a`, so the positional rule is pinned.

This is a ranking change for users. It ships as its own PR with its own
CHANGELOG line so it can be reverted alone. The decision and the alternative
(preserve today's effective weights) are Q13 in the risks document. Phase 1
extends the string to twelve values when it adds `ownerTok` and `cidTok`.

### 0.11 Router mount order

In `server/app.ts`, mount `mcpRouter` before `contactsRouter` (today `:204`
and `:202`). Add an integration test that `GET /api/contacts/action-items`
returns `200` with the MCP payload, and that `GET /api/contacts/<uuid>` still
returns the contact. No client works today with this route, so nothing
breaks.

### 0.12 CHANGELOG

Under `## [Unreleased]`, add a `Phase 0` block with: ownership stamped on
insert for `AUTH_REQUIRED=true` instances, the MCP action-items route fixed,
the request id on rate-limit responses, and the BM25 weight fix (its own
line, marked as a ranking change).

---

## 3. Tests added in this phase

| File | Asserts |
| ---- | ------- |
| `tests/unit/tenancy.scope.test.ts` | Tokens equal SQLite's expressions. A token is one FTS5 term. `scopeOf` throws 401 for a non-user principal. |
| `tests/unit/tenancy.requestContext.test.ts` | Context survives async boundaries. Emitter rule. `NO_SCOPE` outside a context. |
| `tests/unit/tenantLint.test.ts` | Flags, allows, rejects unknown reasons, ignores non-owned tables. |
| `tests/unit/search.test.ts` (extended) | BM25 positional rule. |
| `tests/integration/tenancy.routeManifest.test.ts` | Every route classified, no stale rows, static layer present. |
| `tests/integration/tenancy.stamping.test.ts` | Every insert carries the caller's id. |
| `tests/integration/tenancy.context.upload.test.ts` | Context inside multer callbacks and after multer with a text field. |
| `tests/integration/tenancy.isolation.test.ts` | Skeleton only, one `it.todo` per scoped route. |
| MCP route test | `GET /api/contacts/action-items` reachable. |

---

## 4. Acceptance criteria

- [ ] CI runs on pull requests into `v2.0` (task 0.0 merged first).
- [ ] `npm run lint` passes. `tenant-lint --report` prints the baseline count and exits 0.
- [ ] `npm test` passes. All 575 existing tests unchanged, plus the new files.
- [ ] `tenancy.routeManifest.test.ts` passes: every route classified, including `/api/debug/cache-stats` and the `devOnly` rows.
- [ ] `tenancy.isolation.test.ts` exists with one `it.todo` per scoped route.
- [ ] Stamping test green for contacts, lists, interactions (ghost), merge log, AI invocations.
- [ ] Context tests green, including the emitter rule and the multipart-with-text-field case (or the fallback recorded in the PR).
- [ ] `bench-tenancy` runs and `bench/baseline-phase-0.md` is committed.
- [ ] `GET /api/contacts/action-items` returns the MCP payload.
- [ ] A limiter `429` carries a `requestId`.
- [ ] A single-account instance upgraded from 1.5.5 shows no behavior change. Verified by running the full existing integration suite and by a manual smoke on a copy of a real database.
- [ ] PR description carries the raw vitest summary line and the lint output.

---

## 5. Risks

| Risk | Mitigation |
| ---- | ---------- |
| Express router internals change in a minor release and break the recorder | The recorder patches `use` and reads `route.path`, `route.methods`, and `layer.name`, which are stable public-ish fields. Pin the shape in a comment naming `router@2.2.0`. |
| `AsyncLocalStorage` context lost across a library boundary | The context is attribution-only in this phase. The upload and emitter tests tell Phase 1 and Phase 2 exactly where to pass the scope explicitly. |
| `recordInvocation` `ownerId` is `NULL` for background jobs | Expected. Phase 2 wraps jobs. The AI stats view groups `NULL` as "system". |
| The BM25 fix changes search ranking for existing users | Its own PR and CHANGELOG line. Revertable alone. The unit test documents the rule so the twelve-value string in Phase 1 is right. |

---

## 6. Contract this phase delivers to Phase 1

- `server/tenancy/scope.ts` and `requestContext.ts` exist with the names in section 8.
- `attachRequestContext` is mounted after `attachPrincipal`. `req.requestId` is assigned before any limiter.
- Every insert into an owned table sets `ownerId` when a scope is present.
- `ROUTE_MANIFEST` lists every route with a class. The recorder-based `listRoutes` works.
- The two-user harness can create a second account through `authService.createUser` and sign it in.
- `bench-tenancy` produces a table; the Phase 0 baseline is committed.

---

## 7. Do not do in this phase

- Do not add `WHERE ownerId = ?` to any read. That is Phase 2.
- Do not change the `Principal` union or remove `anonymous` and `service`. That is Phase 1.
- Do not change the database schema. `contactToken` is a helper only.
- Do not bump `package.json` version.

---

## 8. Names and rules used in this phase

| Name | Meaning |
| ---- | ------- |
| Owner | The user who owns a row. `ownerId` is a `users.id`. |
| `Scope` | `{ readonly ownerId: OwnerId }`, built only by `scopeOf(req)`, `scopeForUser(user)`, `scopeForOwnerId(id)`. |
| Owned tables | `contacts`, `lists`, `interactions`, `action_items`, `dedupe_suggestions`, `dedupe_exclusions`, `dedupe_merge_log`, `ai_invocations`. In `v1.5.5` only the first two and the last two have the column. |
| Owner token | `'o' + uuid without hyphens`. Contact token: `'c' + uuid without hyphens`. |
| Route classes | `public`, `session-self`, `scoped`, `admin`, `instance-read`, `static`. |
| Allow-comment reasons | `instance sweep`, `owner-checked by caller`, `boot migration`, `admin cross-user`, `derived table`. |
| `NO_SCOPE` | `AppError` 500 thrown by `currentScope()` outside a context. Programmer error. |
| Request context | `AsyncLocalStorage<RequestContext>` for attribution only. Never the isolation mechanism. Repositories take an explicit `Scope`. |
