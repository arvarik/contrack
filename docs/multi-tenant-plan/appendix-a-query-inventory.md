# Appendix A. Query-Site and Shared-State Inventory

This appendix is the raw inventory of the server as it stands today (v1.5.5).
It was produced by a full read of `server/`, `src/`, and `tests/`. Line
numbers refer to the current tree. Phase 2 uses this appendix as its
checklist. When a line number drifts, search for the function name.

Mount root facts (`server/app.ts`):

- `attachPrincipal` runs globally at `server/app.ts:170`. `requireAuth` gates `["/api", "/uploads"]` at `server/app.ts:176`.
- `/api/auth` is mounted at `server/app.ts:175`, before the gate.
- `healthRouter` is mounted at `server/app.ts:166`, outside `/api`.
- `reconcileOwnership()` is called at `server/app.ts:113`, so it runs on every `createApp()` (production and every test file).

Headline: **zero read or write queries filter or stamp `ownerId`.** The only code that touches the column is DDL (`server/db.ts:865-902`) and the claim and reconcile pair (`server/services/authService.ts:205-215, 661-696`).

---

## A. Query-site inventory by file (under `server/`)

Counts are occurrences of `.prepare(` (better-sqlite3, includes multi-line `sqlite\n.prepare(`), `.exec(`, Drizzle builder calls (`db.select/insert/update/delete(`), `db.query.*`, and `.transaction(`. `db.query.*` is 0 everywhere: the Drizzle relational API is never used.

| file | prepare | exec | drizzle | tx | tables read | tables written | already owner-aware? | receives owner/user/principal/req? |
|---|---|---|---|---|---|---|---|---|
| `server/db.ts` | 15 | 24 | 0 | 3 | action_items, contact_emails, contact_experience, contact_interests, contact_phones, contact_tags, contacts, contacts_fts, sessions, sqlite_master | action_items, contact_education, contact_experience, contact_interests, contacts, contacts_fts, interactions, sessions | yes, DDL only (`:865-902` adds `ownerId` + `idx_*_owner` to the 4 OWNED_TABLES) | no (module top-level, runs at import) |
| `server/repositories/contactRepository.ts` | 20 | 0 | 7 | 1 | contact_addresses, contact_attributes, contact_education, contact_emails, contact_experience, contact_interests, contact_phones, contact_social_links, contact_sources, contact_tags, interactions, list_members, lists | contact_addresses, contact_attributes, contact_interests + Drizzle inserts into contactEducation, contactEmails, contactExperience, contactPhones, contactSocialLinks, contactSources, contactTags | no | no. Module-level `stmts` object at `:93`, `contactRepo` at `:146`. `hydrate()` `:161`, `hydrateMany()` `:212`, `insertChildRecords()` `:496`, `_insertChildRecordsUnsafe()` `:513` all take ids or payloads only |
| `server/services/contactService.ts` | 33 | 0 | 8 | 6 | contact_emails, contact_embeddings, contact_interests, contact_phones, contact_social_links, contact_tags, contacts, dedupe_embedding_meta, interactions, list_members, lists, search_embeddings | contact_embeddings, contacts, dedupe_embedding_meta, search_embeddings + `db.insert(schema.contacts)` `:208`, `:311`. `db.update(schema.contacts)` `:383`, `:504`, `:543`, `:561`, `:650` | no. `createContact` `:199` builds insert values with no `ownerId` | no |
| `server/services/dedupe/merging.ts` | 59 | 0 | 2 | 2 | 16 tables incl. contacts, all contact_* children, list_members, interaction_mentions, search_embeddings, contact_embeddings, dedupe_embedding_meta | same 16 plus interactions | no | no |
| `server/services/dedupe/suggestions.ts` | 24 | 0 | 0 | 4 | contacts, dedupe_merge_log, dedupe_suggestions | contacts, dedupe_exclusions, dedupe_merge_log, dedupe_suggestions | no. `INSERT INTO dedupe_merge_log (...)` at `:128-131` omits `ownerId` even though the table has it | no. Module-level `_stmts` at `:69` |
| `server/services/authService.ts` | 20 | 0 | 0 | 2 | contacts, sessions, users | sessions, users | YES. `countUnownedContacts()` `:205-215` (`WHERE ownerId IS NULL`), `claimUnownedData()` `:661-681` (`UPDATE ${table} SET ownerId = ?`), `reconcileOwnership()` `:690-696` | takes `userId: string`. Module `stmts` at `:191-201` |
| `server/services/listService.ts` | 17 | 0 | 0 | 2 | contacts, list_members, lists | list_members, lists | no. `INSERT INTO lists (id, name, icon, sortOrder)` at `:37` omits `ownerId` | no |
| `server/services/dashboardService.ts` | 15 | 0 | 0 | 0 | contacts, interaction_mentions, interactions | none | no. About 13 unscoped aggregate queries over all contacts, `:58-295` | no |
| `server/services/actionItemService.ts` | 14 | 0 | 0 | 0 | action_items, contacts | action_items | no | no |
| `server/services/dedupe/normalization.ts` | 14 | 0 | 0 | 0 | contact_emails, contact_interests, contact_phones, contact_sources, contact_tags, contacts | none | no | no |
| `server/services/search/localEmbeddings.ts` | 12 | 2 | 0 | 2 | contact_interests, contact_tags, contacts, search_embeddings | search_embeddings | no. `backfillSearchEmbeddings()` `:322` scans all contacts. `findSearchNeighbors()` `:227` is a global KNN | no |
| `server/services/dedupe/embeddings.ts` | 11 | 2 | 0 | 1 | contact_embeddings, contacts, dedupe_embedding_meta | contact_embeddings, dedupe_embedding_meta | no. `_stmts.knn` at `:278` is a global vector search | no |
| `server/services/dedupe/engine.ts` | 9 | 0 | 0 | 0 | contact_emails, contact_embeddings, contact_phones, contacts | contact_emails, contact_embeddings, contact_phones, contacts | no | no |
| `server/routes/contacts.ts` | 8 | 0 | 0 | 0 | contact_emails, contact_phones, contacts | none directly | no. Cross-contact dupe probes at `:276`, `:281`, `:341-347`, `:373`, `:378`, `:411-416`, `:441`, `:446` | yes, has `req` on every handler, uses none of it for ownership |
| `server/services/exportService.ts` | 7 | 0 | 0 | 0 | action_items, contacts, dedupe_merge_log, interactions, list_members, lists | none | no. `buildFullExport()` `:23` does `SELECT * FROM contacts/interactions/lists/list_members/action_items/dedupe_merge_log` with no WHERE. `buildContactsCsv()` `:59` filters only `deletedAt IS NULL` | no |
| `server/services/relationshipService.ts` | 7 | 0 | 0 | 1 | contacts, interactions | contacts | no | no |
| `server/services/aiStatsService.ts` | 6 | 0 | 0 | 0 | ai_invocations | ai_invocations | no. `INSERT INTO ai_invocations (id, operation, model, tokenCount, latencyMs, cached, description, createdAt)` at `:89-90` omits `ownerId`. `summaryStmt` `:93-100` aggregates the whole table | no |
| `server/services/mcpService.ts` | 6 | 0 | 0 | 0 | contact_tags, contacts, interactions | none | no | no |
| `server/services/searchService.ts` | 6 | 0 | 0 | 0 | contact_interests, contact_tags, contacts, contacts_fts | none | no | partly: one function takes `res: Response` (`:228`) for NDJSON streaming, never `req` |
| `server/services/interactionService.ts` | 5 | 0 | 18 | 1 | action_items, contacts, interaction_mentions, interactions | action_items, interaction_mentions + `db.update(schema.contacts)` `:180`,`:278`,`:349`,`:377`. `db.update(schema.interactions)` `:90`. `db.delete(schema.interactions)` `:444` | no | no |
| `server/services/zeroStateService.ts` | 5 | 0 | 0 | 0 | action_items, contacts, dedupe_suggestions, interaction_mentions | none | no | no |
| `server/services/dedupe/passes.ts` | 4 | 0 | 0 | 0 | contact_emails, contact_phones, contact_sources, contacts | none | no. `:99`, `:128`, `:166`, `:182` pull whole-table cross products | no |
| `server/services/dedupe/blocking.ts` | 3 | 0 | 0 | 0 | contact_embeddings, dedupe_exclusions, interaction_mentions | none | no | no |
| `server/services/dedupe/context.ts` | 3 | 0 | 0 | 0 | contact_embeddings, contact_social_links, contacts | none | no | no |
| `server/services/search/hybridRetrieval.ts` | 3 | 0 | 0 | 0 | contact_interests, contact_tags, contacts, contacts_fts | none | no. `ACTIVE_GATE_SQL` at `:148` is the only WHERE clause and has no owner term | no |
| `server/services/settingsService.ts` | 3 | 0 | 0 | 0 | app_settings | app_settings | no. `app_settings` is instance-global by design, no owner column | no |
| `server/services/aiSearch/mergeEngine.ts` | 2 | 0 | 0 | 1 | (via helpers) | contacts | no | no |
| `server/services/geocoding/cache.ts` | 2 | 1 | 0 | 0 | geocode_cache | geocode_cache | no. Instance-global cache keyed by normalized location string | no |
| `server/services/dedupe/clustering.ts` | 1 | 0 | 0 | 0 | interactions | none | no | no |
| `server/services/geocoding/index.ts` | 1 | 0 | 0 | 0 | contacts | none | no. `startRetroactiveGeocoding()` `:7-25` scans all contacts | no |
| `server/services/geocoding/queue.ts` | 0 | 0 | 3 | 0 | none | `db.update(schema.contacts)` `:32`, `:121`, `:128` | no | no |
| `server/routes/dedupe/embeddings.ts` | 1 | 0 | 0 | 0 | contacts | none | no. `:51-54` global COUNT(*) | yes, has `req` |
| `server/routes/health.ts` | 1 | 0 | 0 | 0 | (`SELECT 1`) | none | n/a | `_req` only |
| `server/services/backupService.ts` | 0 (uses `sqlite.backup()` `:81`) | 0 | 0 | 0 | whole DB file | whole DB file | no. Snapshots the entire database to one file | no |

Files under `server/ai/**` and `server/utils/**` touch no tables (except `server/utils/aiCache.ts`, which is pure in-memory). All 14 route files receive `req`. None of them read `req.principal` except `server/routes/auth.ts`.

---

## B. Ownership stamping today

Every site that mentions `ownerId`, `currentUser(`, `req.principal`, or `principal` under `server/`:

**`ownerId` sites (only 9 in server code, all in 2 files):**

| file:line | what it does |
|---|---|
| `server/db.ts:158` | comment pointing at the OWNERSHIP note in `src/db/schema.ts` |
| `server/db.ts:865-871` | `export const OWNED_TABLES = ["contacts", "lists", "ai_invocations", "dedupe_merge_log"]` |
| `server/db.ts:873-902` | boot loop: `pragma table_info(table)`, throws if table missing (`:880`), `ALTER TABLE ${table} ADD COLUMN ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT` (`:892`), then `CREATE INDEX IF NOT EXISTS idx_${table}_owner ON ${table}(ownerId)` (`:900`) |
| `server/services/authService.ts:205-215` | `countUnownedContacts()`: `SELECT COUNT(*) FROM contacts WHERE ownerId IS NULL AND deletedAt IS NULL AND isGhost = 0`. Feeds the setup screen |
| `server/services/authService.ts:661-681` | `claimUnownedData(userId)`: transaction looping OWNED_TABLES, `UPDATE ${table} SET ownerId = ? WHERE ownerId IS NULL` (`:666`) |
| `server/services/authService.ts:690-696` | `reconcileOwnership()`: no-op unless `countUsers() === 1`. Reads the single user id and calls `claimUnownedData` |

**Call sites of the above:**

- `server/services/authService.ts:323`: `if (isFirst) claimUnownedData(id);` inside `createUser`. This is the ONLY place ownership is assigned as a consequence of a user action, and it assigns everything, not per-row.
- `server/app.ts:113`: `reconcileOwnership();` at app construction.

**No route or service stamps `ownerId` on create.** Confirmed for all four owned tables:

- `contacts`: `server/services/contactService.ts:208` and `:311` (`db.insert(schema.contacts).values(values)`), values built by `buildInsertValues` with no owner field.
- `lists`: `server/services/listService.ts:37` `INSERT INTO lists (id, name, icon, sortOrder)`.
- `ai_invocations`: `server/services/aiStatsService.ts:89-90` `INSERT INTO ai_invocations (id, operation, model, tokenCount, latencyMs, cached, description, createdAt)`.
- `dedupe_merge_log`: `server/services/dedupe/suggestions.ts:128-131` `INSERT INTO dedupe_merge_log (id, primaryId, duplicateId, mergedBy, mergeType, confidence, reasoning, duplicateSnapshot)`.

The comment at `server/middleware/auth.ts:22` ("stamping ownership on new rows already uses it") and at `:225` are inaccurate as of today. Ownership is only assigned in bulk by `claimUnownedData`.

**`principal` / `currentUser` sites:**

| file:line | what it does |
|---|---|
| `server/types/express.d.ts:19` | `principal?: Principal` declared on `Express.Request` |
| `server/middleware/auth.ts:45-51` | `type Principal = {kind:"anonymous"} \| {kind:"user"; user; sessionId} \| {kind:"service"}` |
| `server/middleware/auth.ts:58-60` | `currentUser(req)` returns `User \| null` |
| `server/middleware/auth.ts:63-65` | `currentSessionId(req)` |
| `server/middleware/auth.ts:207-249` | `attachPrincipal`: Bearer to `{kind:"service"}` (`:218`), cookie to `{kind:"user"}` (`:232`), else `{kind:"anonymous"}` when auth is off (`:242`), else leaves `req.principal` unset |
| `server/middleware/auth.ts:253-255` | `isAuthenticated(req)` = `req.principal !== undefined` |
| `server/middleware/auth.ts:263-268` | `requireAuth` gate |
| `server/middleware/auth.ts:278-292` | `requireUser` gate (403 for service tokens) |
| `server/app.ts:170` | `app.use(attachPrincipal)` |
| `server/app.ts:176` | `app.use(["/api","/uploads"], requireAuth)` |
| `server/routes/auth.ts:97` | `GET /api/auth/status` reads `currentUser(req)` for the status payload |
| `server/routes/auth.ts:193-195` | `GET /me` returns `publicUser(currentUser(req)!)` |
| `server/routes/auth.ts:202` | `PATCH /me` calls `updateUser(currentUser(req)!.id, ...)` |
| `server/routes/auth.ts:221,224` | `POST /change-password` uses `currentUser(req)!.id` and `currentSessionId(req)` |
| `server/routes/auth.ts:236` | `GET /sessions` calls `listSessions(currentUser(req)!.id, currentSessionId(req))` |
| `server/routes/auth.ts:243-244` | `DELETE /sessions` calls `revokeOtherSessions(currentUser(req)!.id, currentSessionId(req))` |
| `server/routes/auth.ts:257,266` | session-policy get/put, `requireUser` only, no role check |

That is the complete list. `server/routes/auth.ts` is the only router that reads the principal at all. `role` is never read anywhere in `server/` outside `authService.createUser` (`:313`, sets `"admin"` for the first account).

---

## C. Module-level shared state that leaks across users

| file:line | what it stores | keyed by user? | how exposed via routes |
|---|---|---|---|
| `server/services/dedupe/jobQueue.ts:30` | `private scans = new Map<scanId, DedupeScanProgress>()`, including full `clusters: DedupeCluster[]` with contact snapshots | no | `GET /api/dedupe/status?scanId` (`routes/dedupe/scan.ts:119`), `GET /api/dedupe/stream?scanId` SSE (`scan.ts:68`). Any authenticated caller who knows or guesses a scanId reads another user's clusters |
| `server/services/dedupe/jobQueue.ts:31` | `private processing = false`, the single global scan lock | no | `POST /api/dedupe/scan` returns 429 via `canStartScan()` (`jobQueue.ts:33-40`, route `scan.ts:56`) when any user is scanning. `GET /api/dedupe/active` (`scan.ts:108`) returns the one global in-flight scan to whoever asks |
| `server/services/dedupe/jobQueue.ts:161` | `export const dedupeQueue = new DedupeJobQueue()` singleton, also an `EventEmitter` whose event names are scanIds | no | SSE subscription `dedupeQueue.on(scanId, handler)` at `scan.ts:100` |
| `server/services/aiSearch/jobQueue.ts:118` | `private batches = new Map<batchId, AISearchBatch>()` with per-contact job results | no | `GET /api/ai-search/status?batchId` (`routes/aiSearch.ts:117`), `GET /api/ai-search/stream?batchId` SSE (`aiSearch.ts:140`) |
| `server/services/aiSearch/jobQueue.ts:119` | `private processing` global lock | no | `POST /api/ai-search` returns 429 for everyone while any batch runs (`canStartBatch()` `:126`) |
| `server/services/aiSearch/jobQueue.ts:120` | `private lastBatchCompletedAt` global cooldown timestamp | no | one user's completed batch imposes the cooldown on every other user |
| `server/services/aiSearch/jobQueue.ts:368` | `export const jobQueue = new AISearchJobQueue()` singleton | no | as above |
| `server/utils/aiCache.ts:139` | `const stores = new Map<tier, Map<cacheKey, CacheEntry>>()`, 7 tiers: `briefing` (`:74`), `rerank` (`:81`), `synthesis` (`:88`), `mentions` (`:97`), `dailyInsight` (`:104`), `queryParse` (`:117`), `hyde` (`:131`) | no. Keys are content hashes or query strings only | Read paths: `interactionService.ts:250` briefing, `searchIntel.ts:405` synthesis, `:556` queryParse, `:767` hyde, `mentions.ts:34`. Stats surfaced at `GET /api/ai/stats/summary` (`aiStatsService.ts:217` `cacheTiers`), and `GET /api/debug/cache-stats` (dev only, `server.ts:99`) |
| `server/services/dashboardService.ts:214` and `:313` | `aiCache.get<DailyInsight>("dailyInsight", "singleton")` / `.set(..., "singleton", ...)` | no, literal key `"singleton"` | `GET /api/dashboard/insight` (`routes/dashboard.ts:21`). One user's AI-generated daily insight about their network is served verbatim to every other user for 24h |
| `server/utils/aiCache.ts:142` | `const stats = new Map<tier, TierStats>()` hit/miss/eviction counters | no | `GET /api/ai/stats/summary` |
| `server/utils/aiCache.ts:166` | `let batchRefCount = 0` global ref-counted batch mode | no | one user's bulk import (`beginBatch` at `:392`) defers cache invalidation for all users |
| `server/utils/aiCache.ts:167` | `const pendingInvalidations = new Set<string>()` | no | as above |
| `server/services/settingsService.ts:21` | `const cache = new Map<string, unknown>()` of parsed `app_settings` JSON, including provider API keys (`SETTING_KEYS.aiProviderKeys`) and custom endpoint configs | no. `app_settings` is instance-global with no owner column | Written via `PUT /api/settings/ai/providers/:id/key` (`aiSettings.ts:63`), `PUT /endpoints` (`:114`), etc. Cleared only by `clearSettingsCache()` |
| `server/ai/providerRegistry.ts:69` | `const instances = new Map<fingerprint, {fingerprint, provider}>()`, live AI adapter instances holding API keys | no (fingerprint is `kind\|baseUrl\|apiKey`, `:73`) | Every AI route shares one provider instance per credential |
| `server/ai/singleton.ts:91` | `sharedProvider` Proxy resolving to the registry's default provider | no | all legacy AI call sites |
| `server/ai/singleton.ts:100` | `export const isProviderConfigured` computed once at import | no | `GET /api/ai/diagnostics` (`routes/ai.ts:34`). Stale after a settings write |
| `server/ai/adapters/gemini.ts:176-178, 188-189` | per-adapter `tracker: QuotaTracker`, `router: SmartRouter`, `circuitBreakers = new Set<string>()` | no | `GET /api/ai/grounding-capacity` (`routes/ai.ts:87`) and `gemini.ts:295-297` snapshot. One user exhausting grounding RPD blocks everyone |
| `server/ai/routing/QuotaTracker.ts:42` | `private usage = new Map<modelId, UsageWindow>()` (RPM/TPM/RPD windows) | no | shared per adapter instance, so globally |
| `server/ai/routing/QuotaTracker.ts:45` | `private groundingUsage = { dateKey, rpd }` daily grounding counter | no | `GET /api/ai/grounding-capacity` |
| `server/ai/routing/ParallelQueue.ts:18` | `class ParallelQueue` worker pool (`Array.from({length: workerCount})` at `:68`) | no | instantiated per call site, but concurrency budget is process-wide |
| `server/ai/adapters/anthropic.ts:110` | `private schemaTooComplex = new Set<string>()` | no (schema names) | low risk, noted for completeness |
| `server/ai/adapters/openaiCompatible.ts:84` | `private jsonModes = new Map<string, JsonMode>()` | no | low risk |
| `server/services/geocoding/queue.ts:20` | `const geocodeQueue: GeoTask[] = []` global FIFO of `{contactId, location, normalizedKey}` | no | populated by `queueGeocode()` from `contactService.createContact` and by `startRetroactiveGeocoding()`. `applyCoordinates()` `:117-138` writes lat/lng to every queued contactId sharing a normalizedKey, across users (safe: an address is not user data) |
| `server/services/geocoding/queue.ts:21` | `let isGeocoding = false` global processing lock | no | serializes geocoding for all users |
| `server/services/geocoding/cache.ts` (table `geocode_cache`) | persisted location to lat/lng, plus negative-result caching | no owner column | shared, fine, but a negative cache entry from one user suppresses another's lookup for `FAILURE_TTL_DAYS` |
| `server/services/dedupe/embeddings.ts:363` | `let _backfillRunning = false` | no | `POST /api/dedupe/backfill-embeddings` (`routes/dedupe/embeddings.ts:14`) silently returns 0 when another user's backfill is running |
| `server/services/dedupe/embeddings.ts:458` | `const _inFlightIds = new Set<string>()` | contactId, not userId | fire-and-forget dedupe embedding |
| `server/services/dedupe/embeddings.ts:186` | `const _stmts = {...}` incl. `_stmts.knn` (global vector KNN over `contact_embeddings`) | no | dedupe scan and incremental check |
| `server/services/contactService.ts:38` | `const _dedupeTimers = new Map<contactId, Timeout>()` 5s debounce | contactId | scheduled on every create or update (`scheduleIncrementalDedupe` `:61-84`) |
| `server/services/search/localEmbeddings.ts:42-44` | `let extractor`, `let modelReady`, `let initPromise` (Transformers.js pipeline) | no | one model instance process-wide. Fine functionally |
| `server/services/search/localEmbeddings.ts:203` | `const _upsertTxn = sqlite.transaction(...)` | no | low risk |
| `server/services/dedupe/suggestions.ts:69` | `const _stmts = {...}` incl. `getMergeLog` (`:133-137`) which is `SELECT * FROM dedupe_merge_log ORDER BY mergedAt DESC LIMIT ?` with no WHERE | no | `GET /api/dedupe/merge-log` (`routes/dedupe/suggestions.ts:106`) |
| `server/middleware/rateLimit.ts:43` | `const windows = new Map<ip, WindowState>()` per limiter closure | by IP, not user | `aiLimiter` at `:93` (60 req/min) applied by `aiEndpointRateLimit` `:99` to 8 path patterns (`AI_COST_PATTERNS` `:80-89`). Users behind one NAT share a bucket |
| `server/routes/auth.ts:60, 67` | `credentialLimiter`, `setupLimiter` (IP-keyed) | by IP | `POST /api/auth/login`, `POST /api/auth/setup`. Reset seam `__resetAuthRateLimits()` `:74` |
| `server/routes/logos.ts:12` | `const knownFailedDomains = new Set<string>()` | no | `GET /api/logos/:domain`. Also writes shared files, see E |
| `server/services/aiStatsService.ts:118` | `const costPerMMap = new Map<modelId, costPerM>()` | no | static pricing table, safe |
| `server/middleware/auth.ts:92` | `let legacyWarned = false` | no | warning dedupe only |
| `server/utils/urlSafety.ts:191` | `const pinnedAgent = new Agent({connect:{lookup: guardedLookup}})` | no | shared undici agent, safe |
| `server/utils/nlp/nicknames.ts:120` | `const _nicknameMap` | no | static data, safe |
| `server/app.ts:40, 69` | `INLINE_UPLOAD_EXTENSIONS`, `LARGE_JSON_PATHS` | no | static config, safe |

There is no `activeJob` or `currentScan` free variable. The equivalents are `dedupeQueue.processing` (`dedupe/jobQueue.ts:31`, read via `isProcessing()` `:93` and `getActiveScan()` `:82`) and `jobQueue.processing` (`aiSearch/jobQueue.ts:119`).

---

## D. Background jobs and boot-time sweeps that iterate over ALL data

**Boot, in `server.ts` `startServer()`:**

| file:line | what it scans |
|---|---|
| `server.ts:153` | `startRetroactiveGeocoding()` in `server/services/geocoding/index.ts:7-25`, 2s delay, `SELECT id, location FROM contacts WHERE location IS NOT NULL AND location != '' AND (lat IS NULL OR lng IS NULL)` across all owners, then enqueues each |
| `server.ts:156` | `startBackupSchedule()` in `server/services/backupService.ts:104-125`. `setTimeout(run, 15_000)` at `:123` and `setInterval(run, hours*3.6e6)` at `:124`. `runBackup()` `:75-81` snapshots the entire database to `DATA_DIR/backups/` |
| `server.ts:157-167` | trash purge: `runTrashPurge()` immediately then `setInterval(..., 24h)`. `contactService.purgeExpiredTrash()` `:611-628` selects `SELECT id FROM contacts WHERE deletedAt IS NOT NULL AND deletedAt < ?` (all owners) and hard-deletes each |
| `server.ts:170-174` | `cleanupOldInvocations()` in `aiStatsService.ts:346`, running `cleanupStmt` (`:110-112`) `DELETE FROM ai_invocations WHERE createdAt < datetime('now','-30 days')` with no owner filter |
| `server.ts:181-188` | `refreshModelCatalogs()` now and every 24h, calls `aiSettingsService.refreshStaleModelCaches()` `:230`, writes the instance-global `app_settings` model cache |
| `server.ts:194-205` | `setInterval(() => sqlite.pragma("optimize"), 24h)` |
| `server.ts:210-217` | `runScoreSweep()` now and hourly, calls `relationshipService.recomputeAll()` `server/services/relationshipService.ts:281-334`: `SELECT id, cadenceDays, lastContactedAt FROM contacts WHERE isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)` across all owners, batches of 200 with `setImmediate` yield at `:327` |
| `server.ts:222-253` | `initLocalEmbeddings()` then `ensureEmbeddingStore()` then `backfillSearchEmbeddings()` (`localEmbeddings.ts:322-408`, scans contacts not in `search_embeddings`), then `ensureDedupeEmbeddingStore()` then `backfillEmbeddings()` (`dedupe/embeddings.ts:373-450`, normalizes all active contacts at `:394` then embeds those missing) |
| `server.ts:289, 306, 335` | `sqlite.pragma("optimize")` / `sqlite.close()` on shutdown paths |

**Import-time, in `server/db.ts` (runs on every `import`, including every test file):**

| file:line | what it scans |
|---|---|
| `server/db.ts:147` | `migrate(db, {migrationsFolder: "./drizzle"})` |
| `server/db.ts:162-186` | `CREATE TABLE IF NOT EXISTS users` / `sessions` + indexes |
| `server/db.ts:193-195` | `DELETE FROM sessions WHERE expiresAt <= datetime('now')` (all users' sessions) |
| `server/db.ts:219-262` | dicebear avatar URL migration: `SELECT id, avatarUrl FROM contacts WHERE avatarUrl LIKE 'https://api.dicebear.com/%'` then `UPDATE contacts SET avatarUrl` for each |
| `server/db.ts:271-290` | `UPDATE contact_interests SET isAiGenerated = 1 WHERE ...` (all rows) |
| `server/db.ts:293-317` | four `UPDATE contact_experience/contact_education SET ... = NULL WHERE ... = 'null'` |
| `server/db.ts:369-541` | FTS5 rebuild and backfill (`FTS_SCHEMA_VERSION` `:369`), triggers `contacts_au` `:413` etc., "Backfill FTS for any contacts not yet indexed" `:534` |
| `server/db.ts:562-598` | `updatedAt` triggers on contacts / interactions / action_items |
| `server/db.ts:630-655` | `nextFollowUpAt` sync triggers driven off `action_items` |
| `server/db.ts:679-703` | legacy follow-up backfill: `SELECT id, nextFollowUpAt FROM contacts WHERE nextFollowUpAt IS NOT NULL AND id NOT IN (...)`, inserts an action_item per row |
| `server/db.ts:873-902` | §9i ownership DDL loop (see B) |
| `server/db.ts:913-930` | §9h hot-path index creation (15 indexes) |
| `server/db.ts:932` | `sqlite.pragma("optimize")` |
| `server/db.ts:943-965` | §10 phonetic hash backfill: `SELECT id, name FROM contacts WHERE phoneticHash IS NULL AND name IS NOT NULL`, `UPDATE contacts SET phoneticHash` per row |
| `server/app.ts:113` | `reconcileOwnership()` (see B) |

**Request-triggered background work that touches all data:**

- `server/services/contactService.ts:61-84` `scheduleIncrementalDedupe` calls `dedupeService.incrementalDedupeCheck` (cross-contact, all owners). Suppressed by `DISABLE_BACKGROUND_JOBS=true` at `:64`.
- `server/services/interactionService.ts:216` `setTimeout(...)` fire-and-forget mention extraction.
- `server/routes/dedupe/embeddings.ts:31` `POST /api/dedupe/backfill-embeddings` fires the whole-corpus backfill from an HTTP request.
- `server/routes/dedupe/scan.ts:58` `POST /api/dedupe/scan` calls `dedupeService.runScan` over all contacts.

---

## E. Filesystem writes

Path construction is centralized in `server/utils/paths.ts`:

- `:14` `DATA_DIR = process.env.DATA_DIR ?? process.cwd()`
- `:16` `UPLOADS_DIR = DATA_DIR/uploads`
- `:17` `AVATARS_DIR = UPLOADS_DIR/avatars`
- `:18` `LOGOS_DIR = UPLOADS_DIR/logos`
- `:21` `ensureDir(dir)`
- `:36-43` `resolveUploadPath(urlPath)` containment check against `UPLOADS_DIR`
- `server/services/backupService.ts:21` `BACKUPS_DIR = DATA_DIR/backups`
- `server/db.ts:24-25` `DB_PATH = DATA_DIR/curator.db`
- `server/services/search/localEmbeddings.ts:71-76` model cache in `DATA_DIR/.cache`

**There is no per-user segmentation anywhere.** All filenames are timestamp + random, in one flat directory per kind:

| writer | file:line | filename pattern | per-user? |
|---|---|---|---|
| contact avatar upload (multer diskStorage) | `server/routes/contacts.ts:63-77`, dest `avatarDir` (`:49-50`) | `avatar-${Date.now()}-${rand}${ext}` (`:67-68`), 10 MB cap, raster MIME allowlist `:55-61` | no |
| interaction attachment upload (multer diskStorage) | `server/routes/interactions.ts:34-53`, dest `uploadDir` = `UPLOADS_DIR` (`:15-16`) | `${fieldname}-${Date.now()}-${rand}${ext}` (`:37-39`), 50 MB cap, extension allowlist `:21-33` | no |
| company logo cache | `server/routes/logos.ts:34` `path.join(logosDir, ${sanitizedDomain}.png)`, written at `:61` | `<domain>.png`, deterministic and shared across all users | no (and should stay shared) |
| generated avatar processing | `server/utils/avatarProcessor.ts:17, 38` `mkdirSync(AVATAR_DIR)` | writes into the same flat avatars dir | no |
| DB backups | `server/services/backupService.ts:39, 75-81` `sqlite.backup(dest)`, `dest = BACKUPS_DIR/filename` (`:78`). Rotation `readdirSync` `:41`, `unlinkSync` `:59` | whole-instance snapshot. `BACKUP_KEEP` `:33`, `BACKUP_INTERVAL_HOURS` `:107` | no, and cannot be |
| avatar deletion | `server/services/contactService.ts:647` `fs.unlinkSync(oldPath)` via `resolveUploadPath` | | |
| attachment deletion | `server/services/interactionService.ts:439-441` `fs.unlinkSync(filePath)` via `resolveUploadPath` | | |
| export (in-memory, no file) | `server/services/exportService.ts:23` `buildFullExport()`, `:59` `buildContactsCsv()` | streamed as `Content-Disposition: attachment` from `routes/dataLifecycle.ts:108-141` | no owner filter |

**Serving:** `server/app.ts:180-196` mounts `express.static(UPLOADS_DIR)` at `/uploads`, with `X-Content-Type-Options: nosniff` and forced `Content-Disposition: attachment` for anything not in `INLINE_UPLOAD_EXTENSIONS` (`app.ts:40-47`). It sits after `requireAuth` (`app.ts:176`), so it is gated as a whole, but any authenticated user can fetch any other user's `/uploads/...` file given the URL. Filenames are guessable (`avatar-<ms>-<0..1e6>.<ext>`).

Also `server/routes/logos.ts:38` serves `res.sendFile(filePath)` from the shared logo cache, and `server/routes/avatar.ts:38` generates avatars deterministically with no storage at all (safe).

---

## F. Routes inventory

Prefixes from `server/app.ts:180-200`. `router.<method>` line numbers are the definition line.

### `/api/auth`: `server/routes/auth.ts` (mounted app.ts:175, PRE-AUTH)

| method | path | line | notes |
|---|---|---|---|
| GET | `/api/auth/status` | 95 | pre-auth. Reports `existingContacts` count during setup |
| POST | `/api/auth/setup` | 119 | pre-auth, `setupLimiter`. Creates first admin + claims all data |
| POST | `/api/auth/login` | 151 | pre-auth, `credentialLimiter` |
| POST | `/api/auth/logout` | 182 | pre-auth |
| GET | `/api/auth/me` | 193 | `requireUser` |
| PATCH | `/api/auth/me` | 197 | `requireUser` |
| POST | `/api/auth/change-password` | 215 | `requireUser` |
| GET | `/api/auth/sessions` | 234 | `requireUser` |
| DELETE | `/api/auth/sessions` | 241 | `requireUser` |
| GET | `/api/auth/session-policy` | 257 | `requireUser`, instance setting |
| PUT | `/api/auth/session-policy` | 266 | `requireUser`, instance setting, no role check |

### root: `server/routes/health.ts` (mounted app.ts:166, OUTSIDE gate)

| GET | `/healthz` | 19 | unauthenticated by design |

### `/api`: `server/routes/avatar.ts`

| GET | `/api/avatar/:style` | 38 | stateless renderer |

### `/api/link-preview`: `server/routes/linkPreview.ts`

| GET | `/api/link-preview/unfurl` | 9 | outbound fetch, rate limited |

### `/api/search`: `server/routes/search.ts`

| GET | `/api/search/` | 11 | |
| POST | `/api/search/semantic` | 40 | NDJSON streaming when `Accept: application/x-ndjson` (`:56-63`), rate limited |
| POST | `/api/search/synthesize` | 101 | NDJSON streaming (`:135-153`), rate limited |

### `/api/lists`: `server/routes/lists.ts`

| GET | `/api/lists/` | 15 | |
| POST | `/api/lists/` | 25 | writes owned table `lists`, no ownerId |
| PUT | `/api/lists/reorder` | 38 | bulk |
| PATCH | `/api/lists/:id` | 52 | |
| GET | `/api/lists/:id/contacts` | 64 | |
| DELETE | `/api/lists/:id` | 77 | |
| POST | `/api/lists/:id/members` | 102 | |
| DELETE | `/api/lists/:id/members/:contactId` | 116 | |
| POST | `/api/lists/:id/members/bulk` | 132 | bulk |

### `/api`: `server/routes/contacts.ts`

| GET | `/api/contacts/map` | 81 | |
| GET | `/api/contacts/archived` | 91 | |
| GET | `/api/contacts` | 101 | |
| GET | `/api/contacts/:id` | 122 | |
| GET | `/api/contacts/:id/score` | 142 | |
| POST | `/api/contacts` | 151 | writes owned table `contacts`, no ownerId |
| POST | `/api/contacts/bulk` | 167 | bulk, 50 MB JSON (`app.ts:69` `LARGE_JSON_PATHS`), SSE streaming when `Accept: text/event-stream` (`:172-189`), yields with `setImmediate` `:243`, sleeps 3s `:532` |
| POST | `/api/parse-contact` | 556 | rate limited (AI) |
| POST | `/api/contacts/bulk-delete` | 571 | bulk |
| PUT | `/api/contacts/bulk-update` | 585 | bulk |
| PUT | `/api/contacts/:id` | 607 | |
| PATCH | `/api/contacts/:id` | 625 | |
| DELETE | `/api/contacts/:id` | 663 | soft delete to trash |
| POST | `/api/contacts/:id/avatar` | 674 | multer upload (`uploadAvatar`, `:70`) |
| POST | `/api/contacts/:id/enrich` | 704 | rate limited (AI) |

### `/api`: `server/routes/interactions.ts`

| GET | `/api/contacts/:id/timeline` | 58 | |
| POST | `/api/contacts/:id/interactions` | 66 | |
| POST | `/api/contacts/:id/briefing` | 83 | rate limited (AI), reads global `briefing` cache tier |
| POST | `/api/contacts/:id/promote` | 100 | |
| POST | `/api/contacts/:id/attachments` | 112 | multer upload (`upload`, `:42`) |
| PATCH | `/api/interactions/:id` | 128 | |
| DELETE | `/api/interactions/:id` | 145 | unlinks attachment file |
| GET | `/api/contacts/:id/relationships` | 157 | |

### `/api`: `server/routes/mcp.ts` (machine or API-token surface)

| GET | `/api/query/contacts` | 9 | |
| GET | `/api/contacts/action-items` | 34 | |
| GET | `/api/tags` | 48 | |
| GET | `/api/industries` | 56 | |
| GET | `/api/interactions/search` | 64 | |
| GET | `/api/timeline` | 82 | |

### `/api`: `server/routes/dedupe/*` (composed in `dedupe/index.ts`)

| POST | `/api/dedupe/scan` | scan.ts:13 | global lock, 429 across users |
| GET | `/api/dedupe/stream` | scan.ts:68 | SSE |
| GET | `/api/dedupe/active` | scan.ts:108 | returns the one global in-flight scan |
| GET | `/api/dedupe/status` | scan.ts:119 | reads global scan map by id |
| POST | `/api/dev/seed-duplicates` | scan.ts:139 | non-production only (`NODE_ENV !== "production"` guard `:138`) |
| POST | `/api/contacts/merge` | merge.ts:12 | writes owned `dedupe_merge_log` |
| POST | `/api/contacts/merge-batch` | merge.ts:34 | bulk |
| POST | `/api/contacts/merge-cluster` | merge.ts:94 | bulk |
| POST | `/api/contacts/merge-clusters` | merge.ts:144 | bulk |
| GET | `/api/dedupe/suggestions` | suggestions.ts:19 | |
| GET | `/api/dedupe/suggestions/count` | suggestions.ts:28 | |
| GET | `/api/dedupe/suggestion-for/:contactId` | suggestions.ts:38 | |
| POST | `/api/dedupe/suggestions/:id/dismiss` | suggestions.ts:47 | |
| POST | `/api/dedupe/suggestions/:id/merge` | suggestions.ts:59 | |
| GET | `/api/dedupe/merge-log` | suggestions.ts:106 | unscoped `SELECT * FROM dedupe_merge_log` |
| POST | `/api/dedupe/merge-log/:id/undo` | suggestions.ts:115 | |
| POST | `/api/dedupe/backfill-embeddings` | embeddings.ts:14 | rate limited, whole-corpus job, global `_backfillRunning` lock |
| GET | `/api/dedupe/embedding-status` | embeddings.ts:47 | global COUNT(*) |

### `/api`: `server/routes/actionItems.ts`

| GET | `/api/action-items` | 30 | |
| GET | `/api/action-items/completed` | 40 | |
| GET | `/api/action-items/count` | 53 | |
| PATCH | `/api/action-items/:id` | 65 | |
| PATCH | `/api/action-items/:id/complete` | 80 | |
| DELETE | `/api/action-items/:id` | 94 | |
| GET | `/api/contacts/:id/action-items` | 110 | |
| POST | `/api/contacts/:id/action-items` | 123 | |

### `/api`: `server/routes/dashboard.ts`

| GET | `/api/dashboard` | 9 | about 13 unscoped aggregates |
| GET | `/api/dashboard/insight` | 21 | serves the `"singleton"`-keyed AI insight |
| GET | `/api/command-palette/zero-state` | 39 | |

### `/api`: `server/routes/aiSearch.ts`

| POST | `/api/ai-search` | 45 | rate limited, global batch lock + cooldown |
| GET | `/api/ai-search/status` | 117 | reads global batch map by id |
| GET | `/api/ai-search/stream` | 140 | SSE |

### `/api`: `server/routes/dataLifecycle.ts`

| GET | `/api/trash` | 24 | |
| POST | `/api/trash/:id/restore` | 31 | |
| POST | `/api/trash/bulk-restore` | 53 | bulk |
| DELETE | `/api/trash/:id` | 72 | hard purge |
| GET | `/api/backups` | 89 | admin, lists whole-instance snapshots |
| POST | `/api/backups` | 96 | admin, snapshots the whole DB |
| GET | `/api/export/json` | 108 | dumps 6 tables unfiltered |
| GET | `/api/export/csv` | 127 | dumps all contacts |

### `/api/settings/ai`: `server/routes/aiSettings.ts` (instance-global `app_settings`)

| GET | `/api/settings/ai/` | 37 |
| GET | `/api/settings/ai/models/:capability` | 45 |
| PUT | `/api/settings/ai/providers/:id/key` | 63 | writes shared API key |
| DELETE | `/api/settings/ai/providers/:id/key` | 86 |
| POST | `/api/settings/ai/providers/:id/refresh-models` | 94 |
| PUT | `/api/settings/ai/endpoints` | 114 |
| DELETE | `/api/settings/ai/endpoints/:id` | 126 |
| PUT | `/api/settings/ai/capabilities/:capability` | 142 |
| PUT | `/api/settings/ai/searxng` | 205 |

### `/api/ai/stats`: `server/routes/aiStats.ts`

| GET | `/api/ai/stats/summary` | 32 | whole-table aggregate + global cache tier stats |
| GET | `/api/ai/stats/feed` | 52 | paginated `ai_invocations`, no owner filter |

### `/api/ai`: `server/routes/ai.ts`

| GET | `/api/ai/diagnostics` | 34 | reports configured providers |
| GET | `/api/ai/grounding-capacity` | 87 | global QuotaTracker snapshot |

### `/api/logos`: `server/routes/logos.ts`

| GET | `/api/logos/:domain` | 14 | writes to shared logo cache dir |

### dev-only, added in `server.ts`

| GET | `/api/debug/cache-stats` | server.ts:99 | `NODE_ENV !== "production"` only. Dumps all aiCache tier stats |

---

## G. Frontend touchpoints

| file | what it renders or decides |
|---|---|
| `src/main.tsx` | React root. Mounts `<QueryClientProvider>` then `<AuthGate>` (`:70-72`) then `<App/>`. Global QueryClient defaults at `:17-26` (staleTime 30s, gcTime 10min, retry 1, no refetchOnWindowFocus). Cold-boot prefetch of `queryKey: ["contacts"]` at `:54` runs before the gate resolves, so on a gated instance it returns 401 |
| `src/components/auth/AuthGate.tsx` | The single source of session truth. `GateState = "checking" \| "setup" \| "signin" \| "open" \| "unreachable"` (`:59`). Calls `fetchAuthStatus()` in `check()` (`:70-88`), renders `<SetupWizard>` when `setupRequired`, `<SignIn>` when gated and unauthenticated, else `<AuthContext.Provider>` + children. Exposes `useAuth()` at `:57` returning `{user, authRequired, refresh, signOut}`. Calls `queryClient.clear()` on sign-in (`:99`), sign-out (`:113`), and 401 expiry (`:127`) |
| `src/components/auth/SignIn.tsx` | Single identifier + password form. `reason?: "expired"` prop (`:19-21`) explains why it appeared |
| `src/components/auth/SetupWizard.tsx` | First-run account creation. Mirrors server validation: `USERNAME_PATTERN` `:20`, `EMAIL_PATTERN` `:21`, `MIN_PASSWORD_LENGTH = 8` `:22`. Takes `existingContacts` to tell the user how much data they are about to claim |
| `src/components/auth/AuthShell.tsx` | Shared frame for the two full-screen auth pages |
| `src/api/auth.ts` | Auth client. Bypasses `apiFetch` and uses raw `fetch` via `authFetch()` (`:66-87`) because these endpoints sit outside the gate. Exports `AccountUser` (`:18-26`, includes `role: string`), `AuthStatus` (`:28-39`, includes `existingContacts`), `SessionPolicy`, `SessionSummary`, plus `fetchAuthStatus` `:89`, `setupAccount` `:95`, `signIn` `:109`, `signOut` `:117`, `updateProfile` `:121`, `changePassword` `:132`, `fetchSessions` `:141`, `revokeOtherSessions` `:146`, `fetchSessionPolicy` `:151`, `updateSessionPolicy` `:156` |
| `src/api/client.ts` | `API_BASE = "/api"` (`:9`), `NetworkError` (`:26`), `apiFetch()` (`:46`). `if (res.status === 401) emitAuthExpired()` at `:64` is the whole session-expiry mechanism |
| `src/lib/appEvents.ts` | Names the window events. `AUTH_EXPIRED_EVENT` is dispatched by `client.ts:64` and listened to only in `AuthGate.tsx:131` |
| `src/App.tsx` | Router shell (react-router `BrowserRouter`), route table, command palette, modals. Does not read `useAuth()` at all |
| `src/components/layout/Sidebar.tsx` | Icon nav. Reads `useUrgentActionItemCount()` and `useDedupeCount()` (`:26`). Does not read `useAuth()`. No account avatar or identity anywhere in the nav |
| `src/views/settings/SettingsHome.tsx` | Settings landing. `const { user, authRequired } = useAuth()` at `:297`. Uses it to decide whether the Account row is meaningful |
| `src/views/settings/AccountSettings.tsx` | Profile, password, devices. `useAuth()` at `:148` (`{user, refresh}`) and `:481` (`{user, authRequired, signOut}`). Owns the only two auth-namespaced query keys: `["auth","sessions"]` (`:312`, invalidated `:320`) and `["auth","session-policy"]` (`:386`, invalidated `:394`) |
| `src/contexts/SessionContext.tsx` | Not an auth context. Despite the name it holds `lastContactId` (RecentContext) and the AI-search transcript (`lastAISearchQuery`, `lastAISearchData`, `lastAISearchPhase`). `useSession()` at `:126` is a compatibility shim over both |

**How the client learns `role`:** only through `AuthStatus.user.role` / `AccountUser.role` returned by `GET /api/auth/status` and `GET /api/auth/me` (`src/api/auth.ts:24`). Nothing in `src/` ever reads `user.role`. Every `.role` hit in the frontend is `contact.role` (job title), for example `src/components/command-palette/AiComponents.tsx:83`, `src/hooks/useInstantSearch.ts:126`. There is no admin-only UI, no role gating, no conditional rendering on role.

**React Query keys:** no key anywhere includes a user id. The namespaces are flat and content-addressed only:

- `["contacts"]`, `["contacts", id]`, `["contacts","map"]`, `["contacts","archived"]`, `["contacts","search",q]`, `["contacts", contactId, "score"]`: `src/api/contacts.ts:45,69,108,132,147,160`, `src/api/search.ts:24`, `src/components/ScoreBreakdown.tsx:54`
- `["timeline", contactId]`: `src/api/interactions.ts:18`
- `["lists"]`: `src/api/lists.ts:18`
- `["trash"]`: `src/api/contacts.ts:253`
- `["actionItems","completed"]`, `["actionItems","urgentCount"]`: `src/api/actionItems.ts:8,19`
- `["dashboard"]`: invalidated at `src/api/actionItems.ts:51,69`
- `["ai-search-status", batchId]`: `src/api/aiSearch.ts:99`
- `["ai-settings"]` / `["ai-settings","models",capability]`: `src/api/aiSettings.ts:87,98`
- `suggestionKeys.*` (`pending`, `count`, `mergeLog`, `forContact(id)`): `src/api/suggestions.ts:38,51,65,79`
- `enrichmentKeys.groundingCapacity`: `src/api/enrichment.ts:30`
- `["zero-state"]`: invalidated `src/api/enrichment.ts:86`
- `["weather", lat, lng]`: `src/components/LocalTimeWeather.tsx:143`
- `["auth","sessions"]`, `["auth","session-policy"]`: `src/views/settings/AccountSettings.tsx:312,386`

`src/lib/queryConfig.ts` holds only `STALE_TIMES` (`:34-83`) and a debug logger (`logCacheEvent` `:129`). It does not build keys and has no notion of a principal. The current mitigation for cross-user cache bleed is the `queryClient.clear()` in `AuthGate` (3 call sites listed above). `src/lib/queryConfig.ts:38-40` explicitly reasons from "single-user app".

---

## H. Tests

### `tests/integration-setup.ts` (vitest setupFile for the integration project)

- `:29` `vi.unmock("../server/db.ts")`. Integration tests use the real DB. The unit project's `tests/setup.ts` mocks it.
- `:31` `process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "contrack-int-"))`. One fresh temp DATA_DIR (and therefore one fresh `curator.db`, uploads dir, migrations, FTS index) per test file, because vitest isolates module state per file.
- `:38-44` forces AI mock mode by setting `AI_PROVIDER=gemini` and `GEMINI_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`MAPBOX_API_KEY` to `""` (empty, not deleted, so dotenv cannot repopulate them).
- `:43-44` `AUTH_TOKEN = ""`, `AUTH_REQUIRED = ""`. Auth is OFF by default. Individual test files opt in.
- `:49` `DISABLE_BACKGROUND_JOBS = "true"`. Suppresses geocoding fetches and the 5s dedupe debounce.

### `tests/integration/helpers.ts`

- Single export: `makeTestApp(): http.Server` (`:38`).
- `:40-47` asserts `sqlite.open` is truthy, failing loudly if the unit-project DB mock leaked in.
- `:49` `createApp({ disableRateLimit: true })`, then `app.use(notFoundHandler)` `:50`, then `http.createServer(finalizeApp(app))` `:55`.
- `:56-57` `server.listen(0, "127.0.0.1")` + `server.unref()`. Returns an already-listening server (one bind per file) rather than an Express app, to avoid supertest's per-request listen/close port recycling.
- Because `createApp()` calls `reconcileOwnership()` (`server/app.ts:113`), every test file re-runs the ownership reconcile at construction.

### `tests/integration/api.auth.test.ts` (the only auth coverage)

Local helpers: `wipeAccounts()` `:32` (`DELETE FROM sessions; DELETE FROM users;`), `setupAccount()` `:48`, `signIn()` `:57`, `cookieFrom()` `:73`. `beforeAll` sets `AUTH_REQUIRED = "true"` (`:76-78`). Imports the reset seams `__resetAuthRateLimits` (`:18`), `__resetAuthWarnings` (`:19`), `clearSettingsCache` (`:20`).

describe and it names:

`describe("first-run setup")` `:94`

- `:97` reports setupRequired when gated with no accounts
- `:109` refuses every other request until an account exists
- `:115` creates the first account, makes it admin, and signs it in
- `:135` lowercases the username and email so sign-in is case-insensitive
- `:148` closes setup once an account exists
- `:160` rejects a short password
- `:169` rejects an invalid username
- `:179` rejects an invalid email

`describe("sign in")` `:190`

- `:197` accepts the right password
- `:206` rejects the wrong password
- `:212` gives the same answer for an unknown account, so accounts can't be enumerated
- `:219` records lastLoginAt
- `:233` rate-limits repeated failures

`describe("gating")` `:254`

- `:264` rejects unauthenticated API requests
- `:270` gates /uploads too
- `:275` gates writes
- `:282` accepts a valid session cookie
- `:287` rejects a forged session cookie
- `:294` leaves everything open when AUTH_REQUIRED is off
- `:310` does not push an ungated instance through setup even with no accounts

`describe("API token")` `:324`

- `:337` admits a bearer token without any account existing
- `:344` rejects a wrong bearer token
- `:351` enforces auth on its own, without AUTH_REQUIRED
- `:361` still honours the deprecated AUTH_TOKEN name
- `:374` cannot reach account endpoints, there is no account behind a token

`describe("the signed-in account")` `:385`

- `:396` returns the current account
- `:402` updates the profile
- `:415` rejects an invalid profile update without partially applying it
- `:426` changes the password and invalidates the old one
- `:445` refuses a password change without the current password
- `:456` refuses a new password that is too short
- `:464` needs a credential

`describe("sessions")` `:472`

- `:483` lists the current session and marks it current
- `:492` signs out, and the cookie stops working
- `:502` stores only the hash of the session secret, never the secret
- `:514` revokes other sessions while keeping the current one
- `:539` ends every other session when the password changes
- `:558` rejects an expired session

`describe("data ownership")` `:574` (the only ownership tests that exist)

- `:581` claims pre-existing unowned contacts for the first account (inserts `contacts` with `ownerId` NULL at `:586`, asserts it becomes the user id at `:595-597`)
- `:602` claims unowned lists as well (`:605`, `:611-613`)
- `:618` carries ownership on every table that has it (iterates OWNED_TABLES asserting the `ownerId` column exists, `:629-630`)

`describe("session policy")` `:644`

- `:662` defaults to 30 days and reports its range
- `:670` changes the lifetime of sessions created afterwards
- `:692` leaves existing sessions alone, so a change cannot lock you out
- `:713` rejects values outside the supported range
- `:728` needs an account, not just a token

`describe("setup reports what is waiting")` `:743`

- `:750` counts unowned contacts so the setup screen can name them (`:752-753` inserts two NULL-owner contacts)
- `:761` excludes trashed and ghost contacts from that count
- `:771` reports zero once an account exists

**Gap:** there is not a single test that creates two accounts and asserts isolation, because `authService.createUser` is the only creation path and no endpoint exposes it after the first account. Every other integration file (`api.contacts`, `api.lifecycle`, `api.merge`, `api.aiSearch`, `api.avatar`, `api.interactions`, `api.hardening`, `dedupe`, `geocoding`) runs fully un-gated with `req.principal = {kind:"anonymous"}`.

---

## A2. Sites added by the 2026-09-08 review

The first inventory missed these. Each touches owned data or shared state
and has a home in [07-phase-2-scoping.md](07-phase-2-scoping.md).

| file:line | What it does | Sub-phase |
|---|---|---|
| `server/services/contactService.ts:155-163` | `hardDeleteContact`, `db.delete(schema.contacts)`. Called from `:602` and `:626`. The Drizzle count for this file is 8, not 7 | 2a |
| `server/services/contactService.ts:704-740` | `getSlimContacts` pass 2: six statements with an inner `SELECT id FROM contacts WHERE isArchived = 0 ...` subselect | 2a |
| `server/services/contactService.ts:239-265`, `:465-479` | Doc2Query fire-and-forget: AI call, then `UPDATE contacts SET searchExpansion = ? WHERE id = ?`, then `embedContact` | 2a |
| `server/routes/contacts.ts:521-550` | Non-stream bulk import tail: `generateAndStoreBulkEmbeddings` (`:523`) and a 3 s-delayed `ParallelQueue.process(createdIds, 1, incrementalDedupeCheck)` (`:530-549`) | 2a |
| `server/routes/contacts.ts:233-234`, `:246` | Import-time duplicate matching calls `loadNegativeConstraints()`, `normalizeContacts()`, `normalizeContactById()` across the whole instance. The six `SELECT * FROM contacts WHERE id = ?` probes only hydrate already-matched pairs | 2a, 2e |
| `server/services/relationshipService.ts:250-252` | `explainScore` writes `UPDATE contacts SET relationshipScore` (not read-only) | 2a, 2d |
| `server/repositories/contactRepository.ts:122-130`, `:381-401` | `hydrate` reads `lists` and `interactions` (owned tables) by contact id | 2a (allow comments) |
| `server/services/interactionService.ts:166-177` | Explicit `data-id` mention path inserts client-supplied ids into `interaction_mentions` with `INSERT OR IGNORE` and no check. The AI path (`:55-93`) writes `interactions.mentions` JSON and resolves names at `:60-64` with no owner filter. Drizzle count for this file is 18, not 6 | 2b |
| `server/services/listService.ts:29-31` | `SELECT MAX(sortOrder) FROM lists` unscoped | 2b |
| `server/services/listService.ts:138-149` | `removeMember` checks nothing; `bulkAddMembers` checks the list only | 2b |
| `server/services/searchService.ts:122-126` | `buildCompressedCandidates`, one `SELECT ... FROM contacts WHERE id = ?` per candidate | 2c |
| `server/utils/aiCache.ts:519-533` | `getCachedSearch` / `setCachedSearch` build the `rerank` key; called from `searchService.ts:234, 333, 378, 391, 417, 459, 493`. The read path list in section C should include this | 2c |
| `server/services/dedupe/blocking.ts:168-175` | `addEmbeddingCandidates` compiles its own `contact_embeddings MATCH` statement; it does not use `_stmts.knn` | 2c, 2e |
| `server/services/dedupe/context.ts:69-99` | `getEmbeddingSimilarity`, a third private `MATCH` statement (`:79-88`) | 2c, 2e |
| `server/services/dedupe/blocking.ts:227-237` | `loadNegativeConstraints` also runs an instance-wide `interaction_mentions` self-join | 2e |
| `server/services/dedupe/engine.ts:108-110` | Full-mode scan runs `DELETE FROM contact_embeddings` with no predicate and `clearEmbeddingMeta()`, wiping every owner's dedupe index | 2e |
| `server/services/dedupe/embeddings.ts:298-357` | `findStaleEmbeddings` and `reEmbedStaleContacts`, run by every deep scan (`engine.ts:137`), instance-wide and provider-billed | 2e |
| `server/services/dedupe/engine.ts:584-585` | `seedDuplicates` (dev) inserts contacts with no `ownerId` | 0, 2e |
| `server/services/dedupe/clustering.ts:48-50` | The interactions count statement (the appendix's `:1` is the prepare count, not the line) | 2e |
| `server/services/aiSearch/mergeEngine.ts:298` | `invalidateSearchCache()` flushes the whole `rerank` tier (`aiCache.ts:539-541`) | 2f |
| `server/services/mcpService.ts:13` | `queryContacts` has no `deletedAt IS NULL` or `isGhost` filter | 2g |
| `server/services/search/localEmbeddings.ts:179-191`, `server/services/dedupe/embeddings.ts:48-60` | Both rebuild helpers emit `vec0(contactId TEXT PRIMARY KEY, embedding FLOAT[n])` with no partition key; a model change after 2.0 would drop it | Phase 1 |
| `server/db.ts:679-703` | Legacy follow-up backfill inserts `action_items` without `ownerId` (the fill trigger covers it once the boot order is right) | Phase 1 |
| `scripts/seed.ts:18`, `:105`; `scripts/seedMock.ts:385`, `:499` | Seed scripts insert contacts and interactions with no `ownerId` | Phase 1 |
| `server/services/interactionService.ts:70-80`, `server/services/dedupe/engine.ts:584-585` | Two more `INSERT INTO contacts` sites (ghost and seed), missing from section B's list | 0 |

Corrections to counts in this appendix: `recordInvocation` has 25 call
sites (a plain grep counts two comment lines in `aiStatsService.ts` and
gives 27). There are eleven FTS triggers, not twelve. `zeroStateService` has
five prepared statements. `dashboardService` splits as nine statements in
`getDashboardPayload` (`:57-191`) and six in `getInsight` (`:232-295`).
`searchService.search` does not exist; the FTS entry point is
`searchService.searchFts` (`:193-208`).

Line drift within a few lines, no action needed: `app.ts` healthRouter `:165`
(not `:166`), `dedupe/jobQueue` `canStartScan` `:34-42`, `scan.ts`
`canStartScan` `:46` and `runScan` `:57`, `relationshipService.recomputeAll`
`:289-336`, `authService.countUnownedContacts` `:208`,
`backupService.startBackupSchedule` `:100`, `dedupe/embeddings`
`normalizeContacts` call `:393`.
