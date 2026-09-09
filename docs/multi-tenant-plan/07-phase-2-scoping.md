# 07. Phase 2: Scope Every Read and Write

**Goal:** every query that touches owned data carries the caller's `Scope`.
Every shared cache and queue is keyed or checked by owner. Uploads are gated
by owner. At the end of this phase the cross-owner matrix test is fully green
and `tenant-lint --strict "server/**"` passes.

**Lands on:** the `v2.0` branch, as nine PRs (one per sub-phase, 2a to 2i).

**Size:** XL (about 13 to 19 engineering days).

**Depends on:** Phase 1.

This document is written so that an implementer can work from it alone.
Section 0 gives the repository facts, the workflow, and the rules. Each
sub-phase names every function and statement it converts with its `v1.5.5`
line number. When a line has drifted, search for the function name. The
complete inventory is [appendix-a-query-inventory.md](appendix-a-query-inventory.md).

> **What 2a actually shipped, where it differs from this document.** Same
> cause as the Phase 1 note: the plan was written against `v1.5.5` and PR #18
> rewrote the search layer.
>
> - **There is no Doc2Query fire-and-forget block.** The 2a table and appendix
>   A2 describe an AI call after the response that writes
>   `contacts.searchExpansion` and then embeds. PR #18 replaced it with
>   `scheduleSearchIndex` in `server/services/search/indexQueue.ts`, which sets
>   `searchExpansion` to `NULL` and queues a local embedding. Nothing calls
>   `generateSearchExpansion` any more; the column is only ever cleared.
>   `embedContact` reads the owner off the contact row it already loads, so
>   there is nothing to scope and nothing to attribute. The surviving tail is
>   the non-stream bulk import, which is wrapped as the plan says.
> - **The bulk-import tail was already attributed.** `AsyncLocalStorage`
>   survives the `setTimeout`, so the invocation rows carried the importer
>   before the wrapper as well as after it. The wrapper stays because it makes
>   the scope an argument instead of an inheritance, and rule 6's real case is
>   an `EventEmitter` listener, not a timer.
> - **`requireContact` is scoped now, not in 2b.** It is shared with the
>   interaction, action item, and list routes, and `POST /contacts/:id/avatar`
>   and `POST /contacts/:id/enrich` depend on it. Leaving it unscoped would
>   have left a hole in 2a's own routes. `assertContactExists` keeps its
>   unscoped form for the three services 2b converts.
> - **Three signatures needed interim call sites.** `normalizeContacts`,
>   `normalizeContactById` and `loadNegativeConstraints` take a scope now, and
>   the dedupe engine, its pass context, and the embedding helpers call them
>   from paths 2e and 2h own. Each of those gets its scope from the contact
>   row through `scopeOfContact`, not from the async context, and carries a
>   `TODO`. The one true instance sweep, `backfillEmbeddings`, runs the scoped
>   query once per owner through `normalizeContactsForAllOwners`, so it stays
>   instance-wide until 2h gives it a real per-owner loop.
> - **`tenant-lint --strict` takes several globs.** Each sub-phase adds its
>   files. 2i still replaces the list with one `server/**/*.ts`.

---

## 0. Context for the implementer

### 0.1 Repository, commands, and workflow

Same as [05-phase-0-foundations.md](05-phase-0-foundations.md) sections 0.1
and 0.2. In short: Express 5 API in `server/`, one SQLite file through
better-sqlite3 with sqlite-vec 0.1.9 and FTS5, prepared statements compiled
once into module-level `stmts` objects, a few Drizzle builder calls, three
vitest projects, integration tests on a real database per file. Each
sub-phase is one PR from `v2.0/phase-2<letter>-<slug>` into `v2.0`,
squash-merged. `npm run lint` (which now includes `tenant-lint`) and
`npm test` must pass. Paste the raw vitest summary line into the PR. No AI
attribution in commits or PRs. `package.json` stays at `1.5.5`.

### 0.2 State at the start of this phase (after Phase 1)

- Every row in every owned table has a non-`NULL` `ownerId`. `contacts_owner_required` and the fill triggers enforce it on insert. The mismatch triggers reject a child row whose owner differs from its contact's.
- Every request past `requireAuth` has `req.principal = { kind: "user", user, via }`. `scopeOf(req)` never throws for an authenticated request.
- `contacts_fts` has an indexed `ownerTok`. `ownerToken(scope)` in `server/tenancy/scope.ts` matches the SQL, pinned by a unit test. There is no `cidTok`: the trigger deletes use `rowid`, which FTS5 already pushes down (data model §5.5).
- Both `vec0` tables carry `ownerId TEXT PARTITION KEY`, and every insert supplies it.
- Composite indexes named `idx_<table>_owner_<suffix>` exist (list in Phase 1 task 1.7). The single-column `idx_<table>_owner` indexes still exist.
- Uploads live under `uploads/u/<ownerId>/avatars/` and `uploads/u/<ownerId>/files/`. `ownerUploadDir` and `ownerUploadUrl` exist.
- `requireSession` (was `requireUser`) and `requireAdmin` exist. `requireAdmin` is not mounted anywhere.
- `ROUTE_MANIFEST` has every route with `isolated: false`. `tenancy.isolation.test.ts` has one `it.todo` per scoped route. `tenant-lint --report` runs in `npm run lint`.
- `attachRequestContext` runs after `attachPrincipal`. `recordInvocation` reads `currentScopeOrNull()`.

### 0.3 The rules

1. **Signature.** Every repository function that reads or writes an owned table takes `scope: Scope` as its **first** parameter. Every service function a route calls takes `scope` first. Do not add it to functions that receive a parent id already owner-checked in the same call (hydration, child inserts).
2. **Same statement.** A user-supplied id and the scope go in the same SQL statement: `WHERE id = ? AND ownerId = ?`. Never select by id and compare in JavaScript. One statement is one index probe; two statements are two probes and a race.
3. **Inserts** set `ownerId = scope.ownerId` explicitly. The fill triggers are a safety net, not the path.
4. **Not found.** A scoped lookup that returns no row throws `NotFoundError` (404, code `NOT_FOUND`). Do not distinguish "does not exist" from "not yours". The 404 body for a foreign id and a nonexistent id must be identical.
5. **Route.** `const scope = scopeOf(req);` once at the top of the handler, passed down. Routes never read `ownerId` from the body or the query string.
6. **Streams.** SSE and NDJSON handlers capture `scope` in the closure **before** subscribing or awaiting, and pass it explicitly. An `EventEmitter` listener runs in the emitter's async context, so `currentScope()` inside a queue listener returns the job's scope or `null`, never the request's.
7. **Background jobs** wrap per-owner work in `runWithContext({ scope: scopeForOwnerId(id), principal: null, requestId: "job-<name>-<id>" }, fn)` so `recordInvocation` and cache keys attribute correctly.
8. **Lint.** After converting a file, move it into the `--strict` glob. A statement that legitimately has no owner predicate carries `// tenant-lint: allow <reason>` on the line above, with one of: `instance sweep`, `owner-checked by caller`, `boot migration`, `admin cross-user`, `derived table`.
9. **Test.** Replace the route's `it.todo` with a real test and flip `isolated: true` in the manifest in the same PR.
10. **Vector rules** (sqlite-vec 0.1.9): filter with `AND ownerId = ?` in the KNN; never `ownerId IN (...)`; `k` at most 4096; upserts are `DELETE` then `INSERT`; never `UPDATE` a partition column.

Helper added in 2a and reused everywhere:

```ts
// server/repositories/contactRepository.ts
findOwned(scope: Scope, id: string): ContactRow | null           // SELECT * FROM contacts WHERE id = ? AND ownerId = ?
findOwnedActive(scope: Scope, id: string): ContactRow | null     // ... AND deletedAt IS NULL
findManyOwned(scope: Scope, ids: string[]): ContactRow[]         // chunked IN (...) AND ownerId = ?
requireOwned(scope: Scope, id: string): ContactRow               // throws NotFoundError
```

`hydrate` and `hydrateMany` (`contactRepository.ts:161`, `:212`, chunks of
500 at `:231`) are unchanged. They take rows that came from a scoped
statement. They also read `lists` and `interactions` by contact id
(`stmts.lists` `:122-127`, `stmts.interactionCount` `:128-130`, the chunked
variants `:381-387`, `:396-401`), which are owned tables, so each of those
statements carries `// tenant-lint: allow owner-checked by caller`.

### 0.4 The isolation test shape

For each `scoped` route, the matrix test in
`tests/integration/tenancy.isolation.test.ts` uses the two-user harness (two
actors, A seeded with 20 contacts, 10 interactions, 2 lists, 5 action items,
one avatar and one attachment; B seeded with 5 contacts):

| Route kind | Test |
| ---------- | ---- |
| `GET` by id | B requests A's id → `404`. A requests it → `200`. B requests a random UUID → `404` with an identical body (`deepEqual` minus `requestId`). |
| `PUT`, `PATCH`, `DELETE` by id | B mutates A's id → `404`, and A's row is byte-identical before and after. |
| `POST` child under a parent id | B posts under A's parent → `404`, no row created (count unchanged). |
| Bulk with an id list | B sends `[A's ids..., B's ids...]` → only B's rows affected. Response count equals B's count. |
| List endpoints | B's list contains zero ids from A's seed, and the reverse. |
| Aggregates | B's numbers equal what B alone seeded. |
| Search | A has a contact named `Zebulon Quarrington`. B searches that token in every search path → empty. |
| Streams | B opens A's `scanId` or `batchId` → `404` before any event. |
| Uploads | B fetches A's avatar and attachment URLs → `404`. |
| Export | B's JSON export contains only B's rows in every table. |

After every mutating attempt by B, `rowsOwnedBy(table, A.id)` is unchanged.

---

## 1. Sub-phases

### 2a. Contacts core and uploads guard

**Files:** `server/routes/contacts.ts`, `server/services/contactService.ts`, `server/repositories/contactRepository.ts`, `server/utils/avatarProcessor.ts`, `server/middleware/uploads.ts` (new), `server/app.ts`.

| Function (line) | Change |
| --------------- | ------ |
| `getSlimContacts` (`:681`), `getAllContacts` (`:811`), `getMapContacts` (`:664`), `getArchivedContacts` (`:672`), `listTrash` (`:581`) | add `scope`, `WHERE ownerId = ?` first in the predicate. `getSlimContacts` is seven statements, not one: pass 2 (`:704-740`) runs six queries whose inner subselect `WHERE contactId IN (SELECT id FROM contacts WHERE isArchived = 0 ...)` must gain `AND ownerId = ?`. |
| `getContactById` (`:820`) | `findOwned` |
| `createContact` (`:198`), `bulkCreateContacts` (`:276`) | `buildInsertValues(scope, body, id)` sets `ownerId` from `scope`, replacing the Phase 0 context read |
| `updateContact` (`:375`), `patchContact` (`:502`), `deleteContact` (`:535`), `restoreContact` (`:553`), `purgeTrashedContact` (`:597`), `updateAvatar` (`:637`) | `requireOwned` first, then the existing `UPDATE` with `AND ownerId = ?` added as well, so the statement is self-describing for the lint |
| `hardDeleteContact` (`:155-163`, `db.delete(schema.contacts)`; called from `:602` and `:626`) | takes `scope`; the delete gains `eq(contacts.ownerId, scope.ownerId)`. Missed by the first inventory. |
| `bulkDeleteContacts` (`:329`), `bulkUpdateContacts` (`:350`) | `findManyOwned` first, operate on the returned ids only, return the count actually affected |
| `purgeExpiredTrash` (`:611`) | unchanged, instance-wide sweep. `// tenant-lint: allow instance sweep` |
| ~~Doc2Query fire-and-forget (`:239-265` and `:465-479`)~~ | **Gone since PR #18.** `scheduleSearchIndex` replaced it: it clears `searchExpansion` and queues a local embedding, with no AI call and nothing to attribute. `embedContact` reads the owner off the contact row. Nothing calls `generateSearchExpansion` any more. |
| `invalidateAllCaches` (`:124`) | becomes owner-scoped: `aiCache.invalidateForOwner(tier, scope.ownerId)` for each owner-keyed tier (2f defines the helper; in 2a call the whole-tier flush and leave a `TODO(2f)`) |
| `requireContact` (`services/contactGuard.ts`) | becomes `assertOwnedContact(scopeOf(req), id)`. Shared with the interaction, action item and list routes, and `POST /contacts/:id/avatar` and `/enrich` depend on it, so it cannot wait for 2b. `assertContactExists` keeps its unscoped form for the three services 2b converts. |
| `routes/contacts.ts` import path: `normalizeContacts()` (`:234`), `loadNegativeConstraints()` (`:233`), `normalizeContactById` (`:246`) | these are the real cross-owner matching calls during import. Their signatures change in 2e. In 2a, pass `scope` through and add the predicate to these three functions only (the rest of dedupe waits for 2e), so `routes/contacts.ts` can go strict now. |
| Duplicate probes in `routes/contacts.ts` (`:276`, `:281`, `:373`, `:378`, `:441`, `:446`) | each is `SELECT * FROM contacts WHERE id = ?` hydrating an already-matched pair → `findOwned`. The email probe (`:341-349`, `FROM contact_emails ce JOIN contacts c`) and the phone probe (`:411-416`, which loads every phone row in the database per imported contact) gain `AND c.ownerId = ?`. |
| Non-stream bulk import tail (`:521-550`) | fires `generateAndStoreBulkEmbeddings` (`:523`) and, after 3 s, `ParallelQueue.process(createdIds, 1, incrementalDedupeCheck)` (`:530-549`). Capture `scope` and run both inside `runWithContext`. Missed by the first inventory. |
| `POST /api/parse-contact` (`:556`) | AI only (`parseContactRecord`, `:562`), no owned data. Class `instance-read`. Its `recordInvocation` row gets the request scope from the context. |
| `POST /api/contacts/:id/enrich` (`:704`) | `requireOwned` (`:737`) before calling the strategy; `mergeSearchResult(scope, ...)` (`:755`, changed in 2f) |
| `GET /api/contacts/:id/score` (`:142`) | route does `requireOwned` then calls `relationshipService.explainScore(id)`, which stays unscoped because the route already checked. Note that `explainScore` also **writes** (`relationshipService.ts:250-252`, `UPDATE contacts SET relationshipScore`); the allow comment `owner-checked by caller` covers that `UPDATE` too. |

**Uploads guard** (`server/middleware/uploads.ts`):

```ts
export function guardUploads(req, res, next) {
  const p = req.path;                          // relative to /uploads
  if (p.startsWith("/logos/")) return next();
  const m = /^\/u\/([0-9a-f-]{36})\//.exec(p);
  if (m && m[1] === req.principal.user.id) return next();
  next(new NotFoundError());
}
```

Mounted in `server/app.ts` between `requireAuth` and `express.static`. One
regex, no database read. Token principals pass too, because they carry a
user.

Tests: user B fetches user A's avatar URL → 404. User A fetches it → 200.
Both fetch `/uploads/logos/x.png` → 200. A path outside `/u/` and `/logos/`
→ 404.

**Isolation tests for this PR:** every route in `server/routes/contacts.ts`,
plus `/uploads`.

### 2b. Interactions, action items, lists

**Files:** `server/services/interactionService.ts`, `server/services/actionItemService.ts`, `server/services/listService.ts`, `server/routes/interactions.ts`, `server/routes/actionItems.ts`, `server/routes/lists.ts`.

| Function (line) | Change |
| --------------- | ------ |
| `interactionService.getTimeline` (`:104`), `createInteraction` (`:141`), `generateBriefing` (`:231`), `promoteGhost` (`:294`), `handleAttachment` (`:310`), `getRelationships` (`:449`) | `requireOwned(scope, contactId)` first |
| `createInteraction` | insert `ownerId = scope.ownerId`. Two mention paths exist and both need a guard: the AI path (`runMentionExtraction`, `:49-93`) resolves names with `db.select().from(contacts).where(eq(contacts.name, m.name))` (`:60-64`) and writes `interactions.mentions` JSON; add `eq(contacts.ownerId, scope.ownerId)`. The explicit `data-id` path (`:166-177`) inserts client-supplied ids into `interaction_mentions` with `INSERT OR IGNORE` and no check; run the ids through `findManyOwned` first and insert only the owned ones. A ghost created from a mention (`:70-80`) is inserted with `ownerId = scope.ownerId`. |
| Mention extraction `setTimeout` (`:216-218`) | captures `scope` in the closure and runs inside `runWithContext` |
| `updateInteraction` (`:398`), `deleteInteraction` (`:430`) | `UPDATE/DELETE interactions WHERE id = ? AND ownerId = ?` (Drizzle: `and(eq(interactions.id, id), eq(interactions.ownerId, scope.ownerId))`), throw 404 on zero changes. `deleteInteraction` unlinks the attachment through `resolveUploadPath` only after the scoped delete succeeded. |
| `handleAttachment` | file URL through `ownerUploadUrl` (done in Phase 1), insert `ownerId` |
| `getRelationships` (`:449`) | the mention graph query (`:451`) joins `interaction_mentions` to `contacts` and gains `c.ownerId = ?` |
| `actionItemService.getAllPending` (`:31`), `getRecentlyCompleted` (`:51`), `getUrgentCount` (`:73`) | `WHERE ai.ownerId = ?` on `action_items` using `idx_action_items_owner_due` and `idx_action_items_owner_done`. The `JOIN contacts c` stays because the payload needs `c.name, c.company, c.avatarUrl, c.themeColor` and the `c.isArchived` filter (`:36-41`, `:56-61`, `:79-82`); only the owner predicate moves to the `action_items` side. |
| `getByContactId` (`:92`), `create` (`:107`) | `requireOwned(scope, contactId)`, insert `ownerId` |
| `update` (`:129`), `complete` (`:167`), `delete` (`:190`) | `WHERE id = ? AND ownerId = ?` |
| `listService.getAllLists` (`:14`) | `WHERE ownerId = ? ORDER BY sortOrder` |
| `createList` (`:28`) | insert `ownerId` from `scope`. The `SELECT MAX(sortOrder) FROM lists` at `:29-31` gains `WHERE ownerId = ?` so each owner's lists number from zero. |
| `updateList` (`:46`), `deleteList` (`:82`), `reorderLists` (`:95`) | `WHERE id = ? AND ownerId = ?`. `reorderLists` first checks `SELECT COUNT(*) FROM lists WHERE id IN (...) AND ownerId = ?` equals the input length, else 404 |
| `getListContacts` (`:109`) | list owned check, then contacts `WHERE c.ownerId = ?` joined through `list_members` |
| `addMember` (`:119`), `removeMember` (`:138`), `bulkAddMembers` (`:146`) | both the list and every contact must be owned. Two scoped lookups, then the insert or delete. Today `removeMember` checks nothing and `bulkAddMembers` checks the list only. |

The `nextFollowUpAt` triggers on `action_items` (`server/db.ts:633-655`) key
by `contactId` and are unaffected.

`MCP` routes `GET /api/contacts/action-items`, `GET /api/interactions/search`,
`GET /api/timeline` move to 2g with the rest of MCP, but their SQL in
`mcpService` gains `ownerId = ?` here so the file can go strict in one PR.

### 2c. Search: FTS, vector, hybrid, embeddings

**Files:** `server/services/searchService.ts`, `server/services/search/hybridRetrieval.ts`, `server/services/search/localEmbeddings.ts`, `server/services/dedupe/embeddings.ts` (KNN only), `server/services/dedupe/blocking.ts` and `context.ts` (their private KNN statements only), `server/routes/search.ts`, `server/utils/aiCache.ts` (rerank keys).

| Function (line) | Change |
| --------------- | ------ |
| `searchService.searchFts` (`:193-208`, the `GET /api/search` path) | MATCH expression becomes `ownerTok:${ownerToken(scope)} AND ("${safeQ}"*)`. It uses `ORDER BY rank` with no weights, so no weight change. The `JOIN contacts c` stays for the row payload and gains `c.ownerId = ?` for the lint and as a second guard. |
| `searchService.semanticSearchStream` (`:225`), `semanticSearch` (`:413`) | thread `scope`. Capture it before the NDJSON stream starts (`res` is passed at `:228`; `req` is not, so the route passes `scope`). |
| Candidate hydration: `hydrateCandidates` (`:77`, statement `:88-90`), `hydrateAiMatches` (`:163`, statement `:170-172`), `buildCompressedCandidates` (`:122-126`, one `SELECT ... FROM contacts WHERE id = ?` per candidate) | `findManyOwned` for the first two; the third becomes `findOwned` or a batched `findManyOwned` |
| `hybridRetrieval.applyHardFilters` (`:176`) | corpus query `WHERE ${ACTIVE_GATE_SQL} AND c.ownerId = ?` (`ACTIVE_GATE_SQL` at `:148`) |
| `hybridRetrieval.ftsRetrieval(query, preFilterIds, scope)` (`:276`, strategies at `:286-290`) | owner token wrap around each of the three strategies; `BM25_WEIGHTS` already has twelve values from Phase 1 |
| `hybridRetrieval.vectorRetrieval` (`:329`) and `localEmbeddings.findSearchNeighbors(scope, vec, k, preFilterIds)` (`:227`) | `WHERE embedding MATCH ? AND k = ? AND ownerId = ?`. The `preFilterIds` post-filter (`:237-252`, cap 500 at `:247`) stays for the hard-filter case. |
| `hybridRetrieval.buildTraitBoosts` (`:369`) | `AND c.ownerId = ?` |
| `hybridRetrieval.hybridRetrieval(scope, query, rid)` (`:489`) | threads `scope` |
| `localEmbeddings.getSearchEmbeddingCount(scope)` (`:258`) | `SELECT COUNT(*) FROM search_embeddings WHERE ownerId = ?` (works on a partition key). Keep an unscoped variant for the boot log with the allow comment. |
| `localEmbeddings.embedContact(contactId)` (`:411`) | reads `ownerId` with the contact row it already loads, passes it to the upsert. Unscoped by design: called from fire-and-forget paths with a contact id that was owner-checked upstream. `// tenant-lint: allow owner-checked by caller` |
| `backfillSearchEmbeddings` (`:322`), `backfillEmbeddings` (`dedupe/embeddings.ts:373`) | instance sweeps, allow comment. They insert `ownerId` from the joined contact row (Phase 1). 2h makes them iterate per owner. |
| `dedupe/embeddings.findNearestNeighbors(scope, embedding, limit, excludeId)` (`:270`; `_stmts.knn` defined at `:198-204`) | `AND ownerId = ?` in `_stmts.knn` |
| `dedupe/blocking.addEmbeddingCandidates` (`:168-175`) | compiles its **own** `knnStmt` with a `MATCH (SELECT embedding ...)` subquery and never calls `_stmts.knn`. It gains `AND ownerId = ?`. Missed by the first inventory. |
| `dedupe/context.getEmbeddingSimilarity` (`:69-99`, statement `:79-88`) | a third private `contact_embeddings MATCH` statement. Same change. |
| `rerank` cache key | built in `aiCache.getCachedSearch` and `setCachedSearch` (`server/utils/aiCache.ts:519-533`), called from `searchService.ts` at `:234`, `:333`, `:378`, `:391`, `:417`, `:459`, `:493`. Not in `searchIntel.ts`. Both helpers take `scope` and prefix the key with `${scope.ownerId}::`. `synthesis` (`searchIntel.ts:404-405`) gets the same prefix. `queryParse` (`:555-556`) and `hyde` (`:766-767`) stay shared. |
| `POST /api/search/semantic` (`routes/search.ts:40`, NDJSON when `Accept: application/x-ndjson` at `:56-63`), `POST /api/search/synthesize` (`:101`, always NDJSON at `:135-158`) | `scope` captured before the stream starts and passed explicitly. Test asserts the `recordInvocation` rows written during the stream carry the right `ownerId`. |

Plan checks (§2i): the FTS query must not show a full scan of `contacts_fts`
beyond the MATCH; the corpus query must use `idx_contacts_owner_status`.

Isolation tests: A has `Zebulon Quarrington`; B's `GET /api/search`,
`POST /api/search/semantic` (JSON and NDJSON), and
`POST /api/search/synthesize` never return A's contact, even when it is the
only lexical or vector match on the instance.

### 2d. Dashboard, zero-state, relationship route

**Files:** `server/services/dashboardService.ts`, `server/services/zeroStateService.ts`, `server/routes/dashboard.ts`, `server/services/relationshipService.ts` (comments only).

| Function (line) | Change |
| --------------- | ------ |
| `dashboardService.getDashboardPayload(scope)` (nine prepared statements at `:57-191`) | every aggregate gains `WHERE ownerId = ?`. Interaction aggregates (`:80`, `:168-178`) use `interactions.ownerId` directly with `idx_interactions_owner_date`. Mention-graph aggregates join to `contacts` with `c.ownerId = ?`. |
| `dashboardService.getInsight(scope)` (six prepared statements at `:232-295`; cache at `:214` and `:313`) | statements scoped; cache key `dailyInsight` becomes `scope.ownerId`; `maxEntries` raised from 1 to 100 in `aiCache.ts:104-108` |
| `zeroStateService.getPayload(scope)` (`stmts` at `:35-84`: `urgentCount` `:36`, `atRisk` `:45`, `topGhost` `:58`, `staleCount` `:70`, `pendingDedupeCount` `:79`) | all five statements scoped. The dedupe pending count uses `dedupe_suggestions.ownerId`. |
| `relationshipService.recomputeAll` (`:289`) | unchanged, sweep. `// tenant-lint: allow instance sweep` |
| `relationshipService.computeScore(contactId)` (`:261`), `explainScore(contactId)` (`:234`) | unchanged, owner-checked by callers. Allow comments, including on the `UPDATE` at `:250-252`. |

Isolation tests: user B's dashboard totals are zero after user A seeds 50
contacts. Zero-state for B lists none of A's contacts. B's insight is not A's
cached insight.

### 2e. Dedupe

The largest sub-phase. Two rules govern it:

1. **A scan runs for one owner over that owner's active contacts only.** Cross-owner duplicates must never be found, suggested, or merged.
2. **Every merge asserts both contacts share the scope.** The database trigger backs this up, but the service checks first so the error is a 404, not a 500.

**Files:** every file under `server/services/dedupe/`, `server/routes/dedupe/*.ts`.

| Function (line) | Change |
| --------------- | ------ |
| `normalization.normalizeContacts(scope, filter)` (`:288-297`; child loads: emails `:302`, phones `:313`, sources `:324`, tags `:337`, interests `:348`) | `WHERE ownerId = ? AND ${filter}`. The five child-table batch loads become `... JOIN contacts c ON c.id = contactId WHERE c.ownerId = ?` so the maps only hold the owner's rows. This is also a memory win on a multi-owner instance. |
| `normalization.normalizeContactById(scope, id)` (`:387`) | `findOwned` |
| `blocking.loadNegativeConstraints(scope)` (`:227-261`) | two halves: the `dedupe_exclusions` read (`:255-261`) gains `WHERE ownerId = ?`; the `interaction_mentions` self-join (`:227-237`, co-occurrence constraints) joins `interactions` and gains `i.ownerId = ?`. Missed by the first inventory. |
| `blocking.buildBlockIndex` (`:59`), `generateCandidatePairs` (`:84`), `isKnownDistinct` (`:287`) | pure functions over the scoped normalized list; no SQL |
| `blocking.addEmbeddingCandidates(scope, ...)` (`:168-175`) | scoped KNN (2c) |
| `context.buildPassContext(scope, rid)` (`:12`; contacts `:16-20`, social links `:34-38`, calls `normalizeContacts` `:26` and `loadNegativeConstraints` `:31`) | every statement scoped. `getEmbeddingSimilarity` (`:69-99`) scoped in 2c. |
| `passes.ts` D1 emails self-join (`:98-109`), D2 all phones (`:127-129`), D3 contacts self-join (`:165-179`), all sources (`:181-183`) | the four whole-table loads gain the owner join. D1 and D2 currently rely on `contactMap.has()` in JavaScript (`:112`, `:132`) to drop rows outside the scan; keep that as well. |
| `engine.runScan(scope, mode, scanId, rid)` (`:66`) | threads `scope` into everything above. Auto-merge calls the scoped merge. **Full mode** (`:108-110`) runs `DELETE FROM contact_embeddings` and `clearEmbeddingMeta()`, which today wipes every owner's dedupe index; it becomes `DELETE FROM contact_embeddings WHERE ownerId = ?` and a meta delete by `contactId IN (SELECT id FROM contacts WHERE ownerId = ?)`. Deep mode (`:137`) calls `findStaleEmbeddings` and `reEmbedStaleContacts` (`dedupe/embeddings.ts:298-357`), which are instance-wide; scope them by joining `contacts` on `ownerId`. |
| `engine.incrementalDedupeCheck(contactId, rid)` (`:309`) | loads the contact with its `ownerId` first, builds `scopeForOwnerId(row.ownerId)`, runs the rest scoped inside `runWithContext`. It is a background path with no request. |
| `engine.seedDuplicates` (`:571`, dev only; inserts at `:584-585`) | inserts `ownerId = scope.ownerId` (replacing the Phase 0 context read) |
| `suggestions.storeSuggestion`, `storeSuggestions` | insert `ownerId = scope.ownerId` |
| `suggestions.getPendingSuggestions(scope, limit)`, `getPendingCount(scope)`, `getPendingClusterCount(scope)`, `getSuggestionById(scope, id)`, `getSuggestionForContact(scope, contactId)`, `dismissSuggestion(scope, id, rid)`, `markSuggestionMerged(scope, id, by)`, `getMergeLog(scope, limit)` (`_stmts.getMergeLog` `:133-137`, no `WHERE` today), `undoSoftMerge(scope, id, rid)`, `clearStaleSuggestions(scope)`, `clearAllPendingSuggestions(scope)` (fifteen functions at `:156` to `:625`) | `WHERE ownerId = ?` and `WHERE id = ? AND ownerId = ?` |
| `suggestions.recordMerge`, `recordMergeUnsafe` (`insertMergeLog` `:127-131`) | insert `ownerId` from `scope` (replacing the Phase 0 lookup) |
| `merging.mergeContacts(scope, primaryId, duplicateId, ...)`, `softMergeContacts(scope, ...)` (59 prepared statements, Drizzle at `:307` and `:651`) | first statement: `SELECT id FROM contacts WHERE id IN (?, ?) AND ownerId = ?` must return 2 rows, else 404. Then the existing statements run on ids that are known-owned. Merging never inserts a contact: it runs `UPDATE contacts` (`:307-310`, `:656-658`) and `DELETE FROM contacts` (`:332`), re-parents children with `UPDATE ... SET contactId` (`:66-249`, `:410-593`, including `interactions` at `:66-68` and `interaction_mentions` at `:70-79`), and copies list memberships (`:290-297`, `:637-641`). Add `AND ownerId = ?` to the parent `contacts` statements so the lint passes without comments; child statements get `// tenant-lint: allow owner-checked by caller`. The re-parent of `interactions` keeps `ownerId` unchanged, which the mismatch trigger accepts because both contacts share the owner (that is exactly what the up-front check guarantees, so it must run before any child statement). |
| `clustering.computePrimaryScore` (`:22`; interactions count statement at `:48-50`) | `AND ownerId = ?` |
| `dedupe/jobQueue.ts` (`scans` `:30`, `processing` `:31`, `canStartScan` `:34`, `createScan` `:45`, `getScan` `:77`, `getActiveScan` `:82`, `isProcessing` `:93`) | `createScan(scope, mode)` stores `ownerId` on the scan. `getScan(scope, id)` returns null when the owner differs. `getActiveScan(scope)` returns only the owner's scan. `canStartScan(scope)`: if any scan is processing, return `{ allowed: false, reason: "busy", yours: <bool> }`. The run lock stays global. A short FIFO (`pending: OwnerId[]`) starts the next owner's scan when the current one completes. |
| `routes/dedupe/scan.ts` | `POST /scan` (`:13`): `scopeOf(req)`. The `429` today is `res.status(429).json({ error: string })` (`:47-49`) and bypasses the error envelope; it becomes `next(new RateLimitedError("Another user's scan is running. Yours is queued.", { yours: false, queued: true }))` so the body is the standard `{ error: { message, code: "RATE_LIMITED", details } }`. `GET /stream` (`:68`, SSE at `:76-79`, subscribes with `dedupeQueue.on(scanId, handler)` at `:101`): capture `scope` before subscribing, look up the scan with it, 404 on mismatch before the first event; inside the listener use the captured `scope`, never `currentScope()`. `GET /status` (`:119`) and `GET /active` (`:108`): scoped. `POST /api/dev/seed-duplicates` (`:139`): scoped, dev only. |
| `routes/dedupe/merge.ts` (`:12`, `:34`, `:94`, `:144`), `suggestions.ts` (`:19` to `:115`), `embeddings.ts` (`:14`, `:47`) | scope threaded. `POST /backfill-embeddings` stays an instance operation and becomes `admin` (mounted in Phase 3). `GET /embedding-status` (`:51-57`, a raw `SELECT COUNT(*) FROM contacts`) returns the owner's counts. |

Isolation tests: A and B each import the same two duplicate contacts
("Jane Doe" with the same email). A scan by A finds one cluster with A's two
contacts only. B's suggestion list is empty. B calling merge with A's ids
gets 404. B calling `GET /api/dedupe/status?scanId=<A's>` gets 404. The
undo endpoint with A's merge-log id from B gets 404. A full-mode scan by A
leaves B's `contact_embeddings` rows in place (count before equals count
after).

### 2f. AI Search batches, AI cache, AI stats

**Files:** `server/services/aiSearch/jobQueue.ts`, `server/services/aiSearch/mergeEngine.ts`, `server/routes/aiSearch.ts`, `server/utils/aiCache.ts`, `server/services/aiStatsService.ts`, `server/routes/aiStats.ts`, `server/ai/services/*.ts` (cache keys), `server/services/interactionService.ts` (briefing cache key).

| Function (line) | Change |
| --------------- | ------ |
| `jobQueue.createBatch(scope, contacts, strategy)` (`:147`) | stores `ownerId` on the batch. Contacts are `findManyOwned` in the route before this call. |
| `jobQueue.canStartBatch(scope)` (`:126`) | global lock stays. The cooldown (`COOLDOWN_MS` 5 min at `:99`, `lastBatchCompletedAt` at `:120`) becomes `Map<OwnerId, Date>`. |
| `jobQueue.processBatch(batchId)` (`:184`) | wraps the whole run in `runWithContext({ scope: scopeForOwnerId(batch.ownerId), ... })` so `recordInvocation` and cache keys attribute correctly. `contactService.getContactById(scope, id)` (`:240`) and `mergeSearchResult(scope, ...)` (`:256`) receive the scope. |
| `jobQueue.getBatch(scope, id)` (`:324`), `getActiveBatches(scope)` (`:329`) | owner filtered |
| `mergeEngine.mergeSearchResult(scope, ...)` (`:56`; `UPDATE contacts` at `:274-278` and `:291-293`) | the updates gain `AND ownerId = ?`. `invalidateSearchCache()` (`:298`, `aiCache.ts:539-541`), which flushes the whole `rerank` tier today, becomes `invalidateForOwner("rerank", scope.ownerId)`. |
| `routes/aiSearch.ts` `POST /api/ai-search` (`:45`) | the `429` at `:75-78` is `res.status(429).json({ error: string })` today; it becomes `next(new RateLimitedError(message, { yours, queued: false, retryAfterSeconds }))`. `GET /status` (`:117`) and `GET /stream` (`:140`, SSE at `:149`): 404 on owner mismatch before the first event; `scope` captured in the closure. |
| `aiCache` (tiers: `briefing` 24h/100 `:74`, `rerank` 12h/200 `:81`, `synthesis` 12h/100 `:88`, `mentions` 24h/200 `:97`, `dailyInsight` 24h/1 `:104`, `queryParse` 24h/500 `:117`, `hyde` 24h/500 `:131`; prefix invalidation with `startsWith` at `:328`) | new `ownerKey(scope, key)` helper. Tiers `briefing`, `rerank`, `synthesis`, `dailyInsight` keyed with it. `dailyInsight` `maxEntries` 100. `invalidateForOwner(tier, ownerId)` uses the existing prefix invalidation. `queryParse`, `hyde`, and `mentions` (key is `contentHash(text)` at `mentions.ts:33`; the result is a pure function of the note text) stay shared, on the condition in the risks document Q14: confirm the extraction prompt contains no owner data. Batch mode (`batchRefCount` `:166`, `pendingInvalidations` `:167`) stays global; it is a ref count around invalidation timing, not data. |
| `aiStatsService.recordInvocation` (`:144`, `insertStmt` `:88-91`) | `ownerId` from `currentScopeOrNull()` (Phase 0). Boot jobs now run inside a context per owner where one exists, else `NULL`. 25 call sites: `relationshipIntel` `:81, :134, :220`; `contactParsing` `:242, :317`; `mentions` `:36, :97`; `searchIntel` `:279, :347, :407, :501, :558, :722, :769, :813`; `interactionService` `:257`; `searchService` `:240, :334, :423, :460`; `dashboardService` `:217`; `singlePass` `:49`; `searxng` `:200`; `twoPass` `:90, :167`. None of them change; the context does the work. |
| `aiStatsService.getSummary(scope)` (`:173`), `getFeed(scope, params)` (`:273`, statements `:297`, `:306`) | `WHERE ownerId = ?` using `idx_ai_inv_owner_created`. Cache tier stats (`cacheTiers`, `:217`) are instance-wide counters and are returned only to admins (the field is omitted for members). |
| `routes/aiStats.ts` (`:32`, `:52`) | scoped. Phase 3 adds `?scope=all` for admins. |
| `cleanupOldInvocations` (`:346`) | sweep, unchanged, allow comment |

Isolation tests: A's cached rerank for query Q is a miss for B. A's daily
insight is not served to B. B's `GET /api/ai-search/status?batchId=<A's>`
is 404. B's AI stats summary counts only B's invocations.

### 2g. Export, trash, backups, MCP, settings gating

**Files:** `server/services/exportService.ts`, `server/routes/dataLifecycle.ts`, `server/services/mcpService.ts`, `server/routes/mcp.ts`, `server/routes/aiSettings.ts`, `server/routes/auth.ts` (session policy), `server/routes/ai.ts`.

| Route or function (line) | Change |
| ------------------------ | ------ |
| `exportService.buildFullExport(scope)` (`:23`; six tables at `:25-36`), `buildContactsCsv(scope)` (`:59`) | every table `WHERE ownerId = ?`. `list_members` through `lists.ownerId`. `buildFullExport` takes no argument today (`dataLifecycle.ts:111`); Phase 3's admin export calls it with `scopeForOwnerId(id)`. |
| `GET /api/export/json` (`:108`), `GET /api/export/csv` (`:127`) | `scoped`. Filename gains the username. |
| `GET /api/trash` (`:24`), restore (`:31`), purge (`:72`), bulk-restore (`:53`) | `scoped` (done through `contactService` in 2a, routes just pass scope) |
| `GET /api/backups` (`:89`), `POST /api/backups` (`:96`) | class `admin`. `requireAdmin` is mounted in Phase 3. |
| `mcpService.queryContacts(scope, ...)` (`:5`), `getActionItems(scope)` (`:48`), `getTags(scope)` (`:68`; reads `contact_tags` alone at `:70`), `getIndustries(scope)` (`:74`), `searchInteractions(scope, ...)` (`:82`), `getGlobalTimeline(scope, ...)` (`:101`) | `WHERE ownerId = ?`. `getTags` joins `contact_tags` to `contacts`. `queryContacts` (`:13`) has no `deletedAt IS NULL` or `isGhost` filter today and returns trashed and ghost rows; add both filters while the statement is rewritten (note it in the CHANGELOG as a fix). |
| `routes/mcp.ts` (`:9` to `:82`) | `scopeOf(req)`. The token principal makes this work for MCP clients. `GET /api/contacts/action-items` is reachable since Phase 0. |
| `PUT /api/settings/ai/*`, `DELETE /api/settings/ai/*`, `POST .../refresh-models` (`aiSettings.ts:63` to `:205`) | class `admin` |
| `GET /api/settings/ai/` (`:37`), `GET .../models/:capability` (`:45`) | class `instance-read`. Keys are already redacted. |
| `PUT /api/auth/session-policy` (`auth.ts:266`) | class `admin`. `GET` (`:257`) stays `session-self`. |
| `GET /api/ai/diagnostics` (`ai.ts:34`), `GET /api/ai/grounding-capacity` (`:87`) | class `admin` (diagnostics reveal provider configuration) |
| `GET /api/logos/:domain`, `GET /api/avatar/:style`, `GET /api/link-preview/unfurl` | class `instance-read`, no database |

### 2h. Background jobs and boot sweeps

Sweeps that do uniform per-row work stay instance-wide. Sweeps that call AI
or write attributable rows run per owner inside a context.

| Job (where) | Change |
| ----------- | ------ |
| `relationshipService.recomputeAll` (`server.ts:210-217`, hourly) | unchanged |
| `purgeExpiredTrash` (`server.ts:157-167`, daily) | unchanged |
| `cleanupOldInvocations` (`server.ts:170-174`, boot only) | unchanged here; Phase 3 moves it into the daily maintenance interval |
| `startRetroactiveGeocoding` (`server.ts:153`; `geocoding/index.ts:7-25`, `queue.ts` Drizzle updates `:32`, `:121`, `:128`) | unchanged. An address is not user data and the cache is shared by design. The `UPDATE contacts SET lat, lng` by contact id carries `// tenant-lint: allow instance sweep`. |
| `backfillSearchEmbeddings` (`server.ts:222-253`; `localEmbeddings.ts:322`) | iterate `SELECT DISTINCT ownerId FROM contacts` and run each owner's batch inside `runWithContext`, interleaving owners in rounds of 200 so a huge owner does not delay a small owner's first results |
| `backfillEmbeddings` (dedupe, provider-billed; `dedupe/embeddings.ts:373`) | same per-owner loop |
| `refreshStaleModelCaches` (`server.ts:181-188`) | instance, unchanged |
| `scheduleIncrementalDedupe` (`contactService.ts:62-83`) | already resolves the owner from the contact row (2e) |
| Mention extraction `setTimeout` (`interactionService.ts:216`) | done in 2b |
| Bulk-import tail (`routes/contacts.ts:521-550`) | done in 2a. The Doc2Query tail it was paired with no longer exists, see the note at the top of this document |
| Boot backfills in `server/db.ts` (avatar URL `:219-262`, phonetic `:943-965`, legacy follow-up `:679-703`) | `// tenant-lint: allow boot migration`. The follow-up backfill's `action_items` inserts get `ownerId` from the fill trigger (Phase 1 order). |

### 2i. Strict lint, plan checks, and matrix completion

- `package.json`: `"lint:tenant": "node scripts/tenant-lint.mjs --strict \"server/**/*.ts\""`, included in `npm run lint`.
- `tests/integration/tenancy.queryPlans.test.ts`: seed two owners with 500 contacts each, run `ANALYZE`, then for each statement below run `EXPLAIN QUERY PLAN` and assert the named index appears and no `SCAN <table>` does:

| Statement | Expected index |
| --------- | -------------- |
| slim contacts list | `idx_contacts_owner_status` |
| trash list | `idx_contacts_owner_deleted` |
| dashboard at-risk | `idx_contacts_owner_lastc` |
| pending action items | `idx_action_items_owner_due` |
| lists | `idx_lists_owner_sort` |
| pending suggestions | `idx_dedupe_sugg_owner_status` |
| merge log | `idx_merge_log_owner_at` |
| AI stats feed | `idx_ai_inv_owner_created` |
| global timeline (MCP) | `idx_interactions_owner_date` |
| phonetic block load | `idx_contacts_owner_phonetic` |
| FTS scoped query | `SCAN contacts_fts VIRTUAL TABLE INDEX 0:M...` and nothing else |

- `tenancy.routeManifest.test.ts` gains the assertion `every scoped route has isolated === true`.
- `tenancy.isolation.test.ts` has zero `it.todo` left.
- Drop the four single-column owner indexes (`idx_contacts_owner`, `idx_lists_owner`, `idx_ai_invocations_owner`, `idx_dedupe_merge_log_owner`) after the plan tests prove the composites are used. Mechanics: bump `TENANCY_SCHEMA_VERSION` to `2` and add a second step inside the tenancy block that runs when the stored `schema.tenancy` is `1`: four `DROP INDEX IF EXISTS`, then write `2`. Remove the `CREATE INDEX IF NOT EXISTS idx_${table}_owner` line from the ownership loop at the same time, or the next boot recreates them. The migration test gains a case that starts from a version-1 database and asserts the four indexes are gone and the version reads `2`.
- Run `bench-tenancy` at `10 × 2000` and commit `bench/phase-2.md` next to the Phase 0 baseline.

---

## 2. Acceptance criteria

### 2a (shipped)

- [x] `findOwned`, `findOwnedActive`, `findManyOwned` and `requireOwned` exist
      on `contactRepository` and every service read of a contact by a
      client-supplied id goes through one of them. No service selects by id
      and compares the owner in JavaScript.
- [x] Every function in the 2a table takes `scope` first. Every statement over
      an owned table in the five converted files carries `ownerId` or an allow
      comment with a listed reason.
- [x] `tenant-lint --strict` passes for `contactRepository.ts`,
      `contactService.ts`, `routes/contacts.ts`, `avatarProcessor.ts` and
      `middleware/uploads.ts`, and runs in `npm run lint`.
- [x] Matrix tests for every route in `server/routes/contacts.ts` and for
      `/uploads` are real and green: a foreign id answers `404` with a body
      identical to an unknown id's, bulk endpoints affect only the caller's
      rows and report the right count, and A's rows are byte-identical after
      each of B's attempts.
- [x] `guardUploads`: B fetching A's avatar `404`, A `200`,
      `/uploads/logos/*` `200` for both, any other `/uploads` path `404`.
- [x] The bulk-import tail runs inside `runWithContext` with the captured
      scope, and the AI invocation rows it writes carry the importer.
- [x] The existing contacts, lifecycle and avatar suites pass unchanged.
- [x] `isolated: true` for the fifteen routes this sub-phase proved, and the
      manifest test names them.
- [x] CHANGELOG has a Phase 2a block.

### The whole phase

- [ ] `npm run lint` passes with `tenant-lint --strict "server/**/*.ts"`.
- [ ] `tenancy.isolation.test.ts`: no `todo`, all green, run with `AUTH_REQUIRED=true` and two accounts.
- [ ] `tenancy.queryPlans.test.ts` green.
- [ ] Manifest: every `scoped` route `isolated: true`. Every `admin` route has its class set (the middleware is mounted in Phase 3).
- [ ] `bench-tenancy` at `10 × 2000`: every per-owner endpoint returns only that owner's rows, and p95 for the slim list is under 40 ms, FTS search under 10 ms, semantic search (mock AI) under 30 ms, dashboard under 60 ms. Numbers recorded in `bench/phase-2.md`.
- [ ] Single-account instance (local owner or one real account): the full 1.x integration suite still passes with the scope threaded through.
- [ ] The dedupe scan on a two-owner instance never produces a cross-owner pair. A full-mode scan by one owner leaves the other owner's embeddings intact.
- [ ] `aiCache` test: owner A's cached rerank for query Q is a miss for owner B.
- [ ] SSE and NDJSON handlers: `recordInvocation` rows written during a semantic search stream and during a dedupe scan carry the right `ownerId`.
- [ ] The dedupe and AI Search `429` responses use the standard error envelope with `details.yours`.
- [ ] CHANGELOG Unreleased has a `Phase 2` block, including the MCP `queryContacts` trash filter fix.

---

## 3. Risks

| Risk | Mitigation |
| ---- | ---------- |
| A statement is missed | Three guards: lint (static), matrix (per route), and the mismatch triggers (per row, for writes). A missed **read** is caught by the lint or the matrix. Appendix A section A2 lists the sites the review added. |
| Signature churn breaks many call sites at once | One domain per PR. TypeScript reports every call site. |
| `dedupe/merging.ts` has 59 statements and dense logic | Convert it last in 2e. Add `AND ownerId = ?` only to the parent `contacts` statements. Cover with the existing merge tests run as two owners. |
| Global run locks make one heavy user block another's scan | Accepted for 2.0. The FIFO makes it fair. A per-owner cap is in [11-future.md](11-future.md). |
| A stream handler reads the context inside a listener and gets the wrong scope | Rule 6, and a test that opens an SSE stream while a different owner's job emits. |
| Performance regression from the extra predicate | The predicate is an equality on the leading index column. The plan tests prove index use. The benchmark proves latency. |

---

## 4. Contract this phase delivers to Phase 3

- Every route in class `scoped` filters by the caller's scope and returns 404 for foreign ids. The matrix proves it.
- Every route in class `admin` is classified in the manifest and its handler is scoped or instance-level as required; `requireAdmin` is not yet mounted.
- `exportService.buildFullExport(scope)` exists, for the admin offboarding export.
- `aiCache.invalidateForOwner` and `ownerKey` exist.
- The `429` envelopes for dedupe and AI Search carry `details.yours`.
- `tenant-lint --strict` covers all of `server/`.

---

## 5. Do not do in this phase

- Do not mount `requireAdmin`. Phase 3 does it and tests it.
- Do not add admin endpoints, tokens, invitations, or the audit log.
- Do not change the frontend beyond what a changed response shape strictly requires (the `429` envelope: update `src/api/dedupe.ts:40-43` and `src/api/aiSearch.ts:29` to read `error.error.message` so the UI keeps showing the message). Phase 4 does the rest.
- Do not bump `package.json` version.

---

## 6. Names used in this phase

| Name | Where |
| ---- | ----- |
| `Scope`, `OwnerId`, `scopeOf`, `scopeForUser`, `scopeForOwnerId`, `ownerToken`, `contactToken` | `server/tenancy/scope.ts` |
| `runWithContext`, `currentScope`, `currentScopeOrNull` | `server/tenancy/requestContext.ts` |
| `findOwned`, `findOwnedActive`, `findManyOwned`, `requireOwned` | `server/repositories/contactRepository.ts` (added in 2a) |
| `guardUploads` | `server/middleware/uploads.ts` (added in 2a) |
| `ownerKey`, `invalidateForOwner` | `server/utils/aiCache.ts` (added in 2f) |
| `NotFoundError`, `RateLimitedError(message, details)` | `server/utils/AppError.ts` (exist today) |
| `ROUTE_MANIFEST`, `isolated` | `server/tenancy/routeManifest.ts` |
| Allow-comment reasons | `instance sweep`, `owner-checked by caller`, `boot migration`, `admin cross-user`, `derived table` |
