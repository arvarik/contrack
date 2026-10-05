# Architecture

What an agent needs to know before it changes Contrack v2. The long form is
`docs/architecture.md`. Every route is in `docs/api-reference.md`. Visual and
code rules are in `STYLE.md`, test rules in `TESTING.md`.

## 1. Stack

- **Runtime.** Node 26.10 or later runs the TypeScript itself. There is no
  tsx and no server build. `tsc --noEmit` (TypeScript 7) only type-checks.
- **Server.** Express 5. `server.ts` boots the process. `server/app.ts`
  (`createApp`, `finalizeApp`) builds the app for the server and for the
  integration tests. In development Vite 8 runs as middleware inside the same
  process, with its reload socket on the same port (`server/serveClient.ts`).
  In production the server serves `dist/`. One port, 3210.
- **Client.** React 19, React Router 7, React Query 5, Tailwind CSS 4,
  Motion 13, Tiptap 3, cmdk, MapLibre GL 6 through `@vis.gl/react-maplibre`.
- **Data.** SQLite in WAL mode through better-sqlite3 and Drizzle ORM. FTS5
  for keyword search. sqlite-vec (`vec0`) for vectors.
- **AI.** Optional. Gemini, OpenAI, Anthropic, or any OpenAI-compatible
  endpoint. Two local models run on a CPU worker with Transformers.js:
  `Xenova/all-MiniLM-L6-v2` (384-dim embeddings) and
  `Xenova/ms-marco-TinyBERT-L-2-v2` (a cross-encoder). They ship in the Docker
  image, or `npm run models:fetch` downloads them.
- **Tooling.** Oxlint (`.oxlintrc.json`), `tsc`, the tenant lint
  (`scripts/tenant-lint.mjs`), knip for unused code, Prettier, husky with
  lint-staged.

## 2. Layout

| Folder                 | Holds                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `server/routes/`       | Thin Express routers. Validate with zod, delegate, wrap in `asyncHandler`                                                         |
| `server/services/`     | Business logic, including `search/`, `dedupe/`, `research/`, `aiSearch/`, `geocoding/`                                            |
| `server/repositories/` | Contact hydration and query helpers                                                                                               |
| `server/ai/`           | Capabilities, gateway, work queue, adapters, prompt safety                                                                        |
| `server/connectors/`   | ICS, IMAP and Google sync: scheduler, ingest, matching                                                                            |
| `server/mcp/`          | The MCP server: tools, resources, prompts                                                                                         |
| `server/tenancy/`      | `Scope`, the request context, `ROUTE_MANIFEST`                                                                                    |
| `server/middleware/`   | Auth, rate limits, AI switches, uploads guard, errors, cache headers                                                              |
| `server/workers/`      | The CPU worker that runs the local models                                                                                         |
| `server/utils/`        | `AppError`, validators, `aiCache`, `secretBox`, `urlSafety`, paths, logger                                                        |
| `server/db.ts`         | The connection, the call to the migration runner and the index installers, every-boot steps                                       |
| `server/db/`           | `runner.ts`, `migrations/`, `indexes.ts` (derived structures and their versions), `schema.ts`                                     |
| `server/modules/`      | One module per area: routers, MCP tools, jobs, subscribers. `index.ts` is the mount order                                         |
| `server/events/`       | `recordEvent`, the dispatcher and its cursors, the subscribers                                                                    |
| `server/jobs/`         | The job runner, `runJobNow`, the recurring and start-up jobs                                                                      |
| `shared/`              | Code both sides import: the API contracts and event payloads (`contracts/`), facets, score bands, research records, MCP tool list |
| `src/api/`             | React Query hooks, one file per domain                                                                                            |
| `src/views/`           | Pages: `pulse/`, `contact-list/`, `contact-detail/`, `ai-search/`, `map/`, `settings/`, `dedupe/`                                 |
| `src/components/`      | Shared UI: `ui/` primitives, `layout/`, `command-palette/`, `brand/` (the corvid), `auth/`                                        |
| `src/lib/`             | Tokens (`styles.ts`), names, shortcuts, theme, the corvid's motion                                                                |
| `scripts/`             | Seeds, model fetch, eval recorders, brand icons, password reset                                                                   |
| `tests/`               | `unit/`, `integration/`, `eval/`, `contract/`, `e2e/`                                                                             |

## 3. A request

1. A component calls a hook in `src/api/`. Never fetch in a `useEffect`.
2. The route validates its input with the Zod schemas in
   `shared/contracts/`: the body through `validateBody(schema)`, and the
   query through `parseQuery(schema, req.query)`
   (`server/utils/validators.ts`). A contracted route reads both from its
   `route()` entry, and `src/api/` calls it with `apiJson(contract, path)`.
3. The route calls a service and returns JSON. Business logic stays out of
   routes.
4. A service throws an `AppError` subclass (`NotFoundError`,
   `ValidationError`, `ConflictError`, `RateLimitedError`,
   `ServiceUnavailableError`, `UpstreamTimeoutError`). Never a plain `Error`.
5. `server/middleware/errorHandler.ts` turns every error into
   `{ error: { code, message, requestId, details } }`. The client never sees a
   raw message for a 500. Every response carries `X-Request-Id`.
6. A multi-step write runs inside `sqlite.transaction(...)`.

## 4. Accounts and isolation

Version 2 hosts several accounts on one instance. Isolation is enforced in
SQL, and tests prove it.

- Owned tables carry `ownerId`. Triggers refuse an insert with no owner, fill
  it from the parent contact, or refuse a child whose owner disagrees.
- A function that reads or writes owned data takes a `Scope` first
  (`server/tenancy/scope.ts`). The id and the owner go in the SAME statement:
  `WHERE id = ? AND ownerId = ?`. Never select by id and compare in
  JavaScript. The request context is for attribution only.
- Another owner's row answers `404` with the same body as an id that does not
  exist. Never `403`, never a message that names the id.
- An id that arrives in a body (a mention's `data-id`, a list member) is
  checked with `contactRepo.findManyOwned` first. Unknown ids drop silently.
- Full-text queries filter by the indexed owner token:
  `ownerTok:<token> AND (<query>)`. Only `server/services/search/lexical.ts`
  builds a `contacts_fts` MATCH.
- Every `vec0` KNN names the owner beside `MATCH` and `k`
  (`AND ownerId = ?`), because `ownerId` is the partition key.
- A cache value built from one owner's rows is keyed by owner (`ownerKey`
  in `server/utils/aiCache.ts`). An in-memory queue or map keyed by a client id
  stores the owner beside each record and refuses other readers.
- A background sweep that calls AI or writes an attributable row runs one
  account at a time inside `runWithContext`.
- `ROUTE_MANIFEST` (`server/tenancy/routeManifest.ts`) classes every route:
  `public`, `session-self`, `scoped`, `admin`, `instance-read`, `static`. A
  test fails on an unclassified route, a stale row, a scoped route without an
  isolation test, or an admin route without `requireAdmin` on the route
  itself (a named function, never `router.use`).
- Composite indexes lead with `ownerId`. `tenancy.queryPlans.test.ts` fails
  when an owner predicate becomes a scan.
- Sign-in is off by default (`AUTH_REQUIRED=false`): one local owner holds the
  data. `POST /api/auth/setup` turns that owner into the first admin in place.
  Sessions are server-side rows keyed by the SHA-256 of the cookie secret.
  Personal API tokens start with `ctk_`. Passkeys use
  `@simplewebauthn/server`. Mailed links need `PUBLIC_URL`. `API_TOKEN` is
  deprecated.

## 5. Data

- A schema change is a new migration: `npm run db:new <name>` writes
  `server/db/migrations/NNNN_<name>.ts`. `server/db/runner.ts` applies each
  migration once, in order, in one transaction with its row in
  `schema_migrations`, and a failure stops the boot with its id. Mirror every
  table and column in `server/db/schema.ts`. Never edit a shipped migration.
  `0001_baseline` is the schema of a new database, and
  `tests/fixtures/schema/v2.0-d67c8a9.sql` is the schema it must produce. A
  database with tables but no `schema_migrations` refuses to start.
- A migration never reads a list that later code extends. `server/db.ts`
  keeps the live `OWNED_TABLES`.
- Derived structures are rebuilt from code by `server/db/indexes.ts` on every
  boot, each with an `index` row and a version in `schema_migrations`:
  - `contacts_fts` and `interactions_fts` (FTS5). Bump `FTS_SCHEMA_VERSION`
    when their columns or trigger payloads change; the index then rebuilds.
  - `search_embeddings` (`vec0`, `INT8[384]`, one scale per table),
    `search_passage_vectors` (long profile text in passages, same format), and
    `contact_embeddings` (float vectors for duplicate detection).
  - The FTS triggers keep the index in step (deletes by `rowid`, never by
    `contactId`).
- The baseline's triggers stamp `updatedAt` with named columns, stamp
  `trackedAt`, keep `nextFollowUpAt` equal to the earliest open follow-up,
  and mark contacts whose score must be recomputed. A migration that adds a
  `contacts` column rebuilds `contacts_auto_updated_at` and
  `contacts_score_dirty` with the new column list.
- `vec0` tables do not cascade. Deleting or merging a contact must delete its
  rows in `search_embeddings`, `contact_embeddings` and
  `dedupe_embedding_meta`. Never `UPDATE` a partition key or rename a `vec0`
  table: every upsert is `DELETE` then `INSERT`, and rebuilds go through
  `vecTableDdl()`.
- Timestamps come in two formats (`2026-09-10 05:33:50` and ISO with `T` and
  `Z`). Compare them in SQL through `datetime()` or `strftime`, never against
  `new Date().toISOString()`.
- A bulk boot step must not stamp `updatedAt`: a stale-looking contact is
  re-embedded, which can bill a paid provider.
- Deletes are soft: `DELETE /api/contacts/:id` moves a contact to the trash,
  and a daily sweep purges it after the retention period. A purge
  (`hardDeleteContact`) also takes every contact merged into it and the
  merge log entries that name them, and unlinks their uploads after the
  commit, keeping any file a row still names (`contactPurge.ts` and
  `uploadCleanup.ts` in `server/services/`).

## 6. Search

People search (`server/services/searchService.ts`, `runSearch`) answers as
cheaply as it can:

1. The L1 cache, keyed by owner, `search_revision`, facets, model and query.
2. Facets (typed in the question or sent as `filters`) compile to one SQL
   predicate (`search/facetSql.ts`). A facet-only question is answered from the
   database.
3. A strict keyword search classifies the query (`search/intent.ts`). An
   email, a phone number, a quoted phrase or a name is answered locally,
   verified, with no model.
4. Implicit facets ("at Northwind", "in Lisbon") answer simple questions
   locally too.
5. The L2 semantic cache returns a verified answer to the same question in
   other words.
6. Local retrieval: FTS5 and vector KNN, fused by weighted RRF (k = 15), then
   the cross-encoder reorders the top 30 inside a 25 ms budget. This list
   streams first, marked unverified.
7. With AI on, the model stages run in the search lane inside 12 s: the
   planner, a hard filter, then either a database proof or a compact reranker
   that must cite a real field value. A failure ends with a fresh local list.

Note search (`interactionSearchService.ts`) is local only: FTS5 over note text
with date phrases read in the caller's time zone. The eval gates in
`tests/eval/` replay recorded vectors and model answers, so search quality is
measured in CI without keys.

## 7. AI

- **Capabilities** (`server/ai/capabilities.ts`): quick, deep, research and
  embeddings. Each resolves to a provider and model: a Settings pin, then an
  env pin (`AI_QUICK_MODEL` and the others), then Auto (`AI_PROVIDER` first).
- **Gateway** (`server/ai/gateway.ts`): `generateFor(capability, options)` and
  `streamFor(...)`. Business code calls these. Never import a provider SDK
  outside `server/ai/adapters/`.
- **Queue** (`server/ai/workQueue.ts`): 2 shared slots and 16 waiting, fair per
  account, interactive before background. Ask Contrack's calls use a search
  lane with 2 slots of its own. A full queue answers `429 AI_BUSY`.
- **Adapters** wrap every call in `withTimeout`, `withRetry` and
  `parseAIJson` (`server/ai/resilience.ts`).
- **Prompt safety** (`server/ai/promptSafety.ts`): `wrapUntrusted()` fences
  contact, file and web text in every prompt. `sanitizeAiOutputValue()`
  checks what a model writes before it is stored or shown.
- **Switches.** An account switch (`aiAssist`) and an instance switch (the
  admin page, or `AI_DISABLED=true`). `aiAllowedFor(req)` reads both. With AI
  off, no request reaches a provider and search answers from local data.
- **Cost.** Every call is recorded in `ai_invocations` for the AI usage pages.
  AI-cost routes are rate limited per address and per account.

## 8. Modules, events and jobs

- Each area is a module in `server/modules/<id>/index.ts`
  (`defineModule({ id, routers, mcpTools, jobs, subscribers, onStart })`).
  `server/modules/index.ts` is the list and the mount order: keep the `mcp`
  module before `contacts`. `createApp()`, `registerAllTools` and `server.ts`
  read it.
- A write records an event in its own transaction (`recordEvent`, which
  throws outside a transaction) and calls `dispatchEvents()` after the
  transaction and before it reads its answer. Subscribers react from a cursor
  each, in `event_cursors`. The contact write reactions (search index, dedupe
  vector and check, geocode, score, caches, auto-enrich) are subscribers in
  `server/events/contactSubscribers.ts`, not inline calls. Payloads carry ids
  and field names only (`shared/contracts/events.ts`).
- Background work is a job in the `jobs` table (`server/jobs/runner.ts`),
  never a `setInterval`. At boot: migrations and the local owner, the
  runner requeues `running` rows, the search module loads the local models
  and runs the embedding backfills, and the start-up jobs geocode missing
  pins and copy stored photos. Recurring jobs: the connector tick (60 s), the
  score sweeps (hourly, daily), backups (`BACKUP_INTERVAL_HOURS`), the trash
  purge, the merge purge, the upload sweep, the geocode cache prune,
  maintenance, model catalogs and planner statistics. The duplicate
  check is an on-demand job. `DISABLE_BACKGROUND_JOBS=true` runs none of
  them, and `runJobNow` still works.

## 9. Rules that are easy to break

- Resolve a stored `/uploads/...` path with `resolveUploadPath()` before any
  file read or delete. `guardUploads` serves `/uploads/u/<ownerId>/` to that
  owner only.
- Fetch outside URLs (link previews, images, feeds) through `safeFetch`
  (`server/utils/urlSafety.ts`), which blocks private addresses at connect
  time.
- Never put a credential in a URL the server logs. `redactUrlForLog` covers
  morgan's `url` token.
- Seal stored secrets with `secretBox` (`CONTRACK_SECRET_KEY` or
  `DATA_DIR/secret.key`).
- Write one `auditService.record()` row for every admin action, with no
  credential in `details`.
- Relative imports in `server/`, `shared/` and `scripts/` name the
  file with its extension (`./geo.ts`). The `@/` alias works in frontend code
  only.
- Log with `log.info` for state changes, `log.warn` for retries and
  degradation, `log.error` for failures. Never `console.log` in app code, and
  never an empty `.catch(() => {})`.
- A new route gets a contract in `shared/contracts/` beside its manifest row.
  A response schema is strict and lists every field the route sends: every
  integration test checks the answers against it. After a contract change,
  run `npm run api:openapi` and commit `docs/openapi.json`.

## 10. Commands

`npm run dev` (port 3210), `npm run build`, `npm test`, `npm run lint`,
`npm run knip`, `npm run api:openapi`, `npm run test:e2e`, `npm run db:new <name>`,
`npm run models:fetch`, `npm run brand:icons`. `CONTRIBUTING.md` explains each.
