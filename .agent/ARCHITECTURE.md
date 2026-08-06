# Architecture

_This document acts as the definitive anchor for understanding system design, data models, API contracts, and technology boundaries. Update this document during the Design and Review phases._

## 0. Project Topology

**Topology:** `[frontend, backend, ml-ai]`

_Agents: Read the corresponding Gemstack topology profiles (`frontend.md`, `backend.md`, and `ml-ai.md`) from `~/.gemini/antigravity/global_workflows/` before proceeding with any workflow step. These profiles enforce component state coverage, data integrity testing, Evaluation-Driven Development (EDD), circuit breaker cost controls, and prompt versioning._

## 1. Tech Stack & Infrastructure

- **Language / Runtime**: TypeScript ~5.8 / Node.js 22+
- **Frontend**: React 19 via Vite 6, incorporating Tiptap for rich interaction composition, `cmdk` for the Command Palette, `react-router-dom` v7 for client-side routing, Framer Motion (`motion/react`) for layout animations, and Leaflet for interactive maps.
- **Backend / API**: Express 4 running natively via `tsx`. Vite dev server runs as middleware **inside** the Express process (not on a separate port).
- **Database**: SQLite (WAL mode) via `better-sqlite3` + Drizzle ORM. Vector search via `sqlite-vec`. Full-text search via FTS5.
- **AI Provider**: Capability-routed multi-provider — Google Gemini via `@google/genai`, OpenAI via `openai`, Anthropic via `@anthropic-ai/sdk`, plus a generic OpenAI-compatible adapter for self-hosted servers. Providers are resolved per capability at call time (see `capabilities.ts`), not fixed at startup; `AI_PROVIDER` is now only the Auto-mode preference. Local embeddings via `@huggingface/transformers` (Transformers.js).
- **Deployment**: Local-first / Self-hosted. Single Node.js process serves both API and frontend.
- **Package Management**: npm
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite` plugin.

## 2. System Boundaries & Data Flow

### Request / Data Flow

- **Client to Server**: React Components → React Query (`useQuery`/`useMutation` in `src/api/`) → Express API routes (`server/routes/`) → Services (`server/services/`) → Repositories (`server/repositories/`) → Drizzle ORM → SQLite. **Never** write native `useEffect` fetch loops.
- **Cold-Boot Prefetch**: `src/main.tsx` calls `queryClient.prefetchQuery` for `['contacts']` before the first render, ensuring Cmd+K has 0ms client-side data availability.

### Search Pipeline (Ask Contrack v5 — Plan → Filter → Rank → Verify)

The retrieval pipeline is split into four pipeline stages, each enforcing a different
quality guarantee:

| Stage      | Goal                                | Mechanism                                                                                              | Failure mode                                      |
| ---------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| **Plan**   | Understand user intent              | `parseSearchQuery` → `QueryPlan { must, should, confidence }`                                          | LLM unavailable → empty plan, pipeline still runs |
| **Filter** | Enforce hard structured intent      | JS-side word-boundary regex on `contact.location/company/role/industry` for each `must.*Matchers` list | Empty filter set → honest "no matches" response   |
| **Rank**   | Surface relevance within candidates | FTS5 (BM25) + HyDE-vector KNN + soft trait boosts → RRF fusion (k=15)                                  | One channel down → others still produce results   |
| **Verify** | Reject false positives              | `rerankCandidates` requires evidence per match; server-side word-boundary re-check against the plan    | LLM unavailable → keep Phase 1 results unverified |

The architectural fix for "Sydney leaking into 'Who lives in America'" is the
**Filter** stage: when the planner reports `confidence: "high"|"medium"` and emits
`must.locationMatchers`, the JS-side word-boundary regex filter is the gate that
FTS/vector run against — not a downstream RRF boost that can be outweighed by
strong vector similarity on irrelevant signals.

The legacy v4 description follows for historical context (now superseded):

> v4 added LLM-driven query understanding on top of the v3 retrieval core: the user's
> natural-language query is parsed and expanded by the LLM _before_ retrieval
> runs, so the local FTS + vector channels work against a richer signal.

1. **Parallel AI Query Augmentation** (lite-tier LLM, ~150-300ms each, cached 24h):
   - `parseSearchQuery()` emits a `QueryPlan { must, should, confidence, rationale }`. The planner expands each concept into an _exhaustive synonym set_ a contact field could literally contain (for "America": ["United States","USA","America","CA","NY","TX",...,"San Francisco","Boston",...]). The split into `must` (hard) and `should` (soft) is the planner's responsibility — high-confidence structured intent ("who lives in X", "VCs at Y") goes to `must`; vague descriptive intent ("loves climbing") goes to `should.traits`.
   - `expandQueryForEmbedding()` rewrites the query as a hypothetical contact-shaped paragraph (HyDE — Gao et al., 2022) for the vector channel.
   - Both fail gracefully. On AI outage, the pipeline runs FTS + HyDE-or-raw vector with no hard filter — still produces results.
2. **Hard Pre-Filter** (`applyHardFilters` in `hybridRetrieval.ts`): For each populated `must.*Matchers` list, build a case-insensitive **word-boundary** regex and pass only contacts whose corresponding field matches. Word-boundary is `(?:^|[^a-zA-Z0-9])` so 2-letter codes like `CA` match `"Los Angeles, CA"` but not `"Casablanca"`. When `confidence: "low"` the hard filter is skipped — exploratory queries shouldn't be gated. Empty result set returns early with `candidates: []` rather than falling through to broad retrieval.
3. **FTS5 Weighted BM25**: Runs over the filtered candidate corpus (or full corpus if no plan). Column priority via BM25 weights `(name 10, company 5, role 3, headline 2, location 2, about 1, industry 1, extras 1, expansion 1)`.
4. **Local Vector KNN (HyDE-enhanced)**: `sqlite-vec` cosine similarity over the filtered candidate corpus. Embedding model: `Xenova/all-MiniLM-L6-v2` (384-dim, runs locally via Transformers.js).
5. **Soft Trait Boosts**: each entry in `should.traits` is a separate ranked list — a contact matching multiple traits accumulates score, but absence of a trait is not penalized. Intersected with the hard filter set.
6. **RRF Fusion (k=15)**: Combines FTS5 + HyDE-vector + trait boost channels into a single ranked candidate list.
7. **Verified LLM Reranker** (`rerankCandidates`): receives the `QueryPlan` alongside the top ~30 candidates. The LLM must produce per-match evidence (`{ contact_id, verified_field, verified_value, reason }`). Server then performs three independent verifications: (a) `verified_value` must be a literal substring of the named field on the actual candidate row, (b) the candidate's actual field must satisfy at least one of the active `must.*Matchers` (word-boundary), (c) the reason text must not contain negative qualifiers. Failing any check drops the match. This is the second line of defense behind the hard pre-filter.
8. **Grounded Synthesis** (`synthesizeSearchResults`): the executive brief receives the `QueryPlan` and is instructed never to make a claim that doesn't apply to ≥80% of contacts shown. The prompt explicitly enumerates the verified filter and shows an example of a hallucinated vs grounded summary. Each contact in the prompt is rendered with its `[location:]` tag so the LLM can verify geographic claims literally.
9. **Two-Phase NDJSON Streaming**: Phase 1 (post-filter, hydrated, pre-rerank) streams in <15ms. Phase 2 (post-rerank, verified) replaces it ~500ms later.

**Caching**: `parseSearchQuery`, `expandQueryForEmbedding`, `rerankCandidates`, and `synthesizeSearchResults` all cache by content-hashed query under their respective `aiCache` tiers (24h TTL). Repeat queries pay zero AI cost.

### AI Adapter Pipeline

All AI operations route through a layered architecture in `server/ai/`:

- **`provider.ts`**: Abstract `AIProvider` interface — the single contract all adapters implement. Methods: `generate(options)` (required), `getQuotaSnapshot()` (optional, Gemini-only).
- **`aiService.ts`**: Provider-agnostic business logic facade. Exports: `parseContactRecord`, `generateCatchMeUpBriefing`, `extractMentions`, `summarizeEmlEmail`, `rerankCandidates` (now accepts `QueryPlan` and enforces per-filter evidence), `generateDailyInsight`, `bulkParseContacts`, `generateSearchExpansion`, `synthesizeSearchResults` (now accepts `QueryPlan` for grounding), `parseSearchQuery` (v5 — emits `QueryPlan { must, should, confidence, rationale }`), `expandQueryForEmbedding` (HyDE). **Never imports any SDK directly.**
- **`singleton.ts`**: Back-compat surface. `sharedProvider` is a Proxy that delegates to the registry's default provider, so per-provider state (Gemini's SmartRouter, QuotaTracker) stays singleton while the underlying provider can change at runtime. New code should call `generateFor()` from `gateway.ts` instead.
- **`types.ts`**: Provider-agnostic type definitions including `AIProviderName = "gemini" | "openai" | "anthropic"`, `AIGenerateOptions`, `AIGenerateResult`, `JsonSchemaNode`, `RoutingPolicy`.
- **Adapters** (`server/ai/adapters/`):
  - `gemini.ts` — Google Gemini via `@google/genai`. Includes SmartRouter integration, QuotaTracker, circuit breakers. Schema translation: `JsonSchemaNode` → Gemini `Type.*` enums.
  - `openai.ts` — OpenAI via `openai` npm package. Schema translation: `JsonSchemaNode` → `response_format: { type: "json_schema", json_schema: { strict: true, ... } }`. Web search via Responses API `web_search` tool. System prompt via `system` role message.
  - `anthropic.ts` — Anthropic Claude via `@anthropic-ai/sdk`. Schema translation: `JsonSchemaNode` → `output_config.format: { type: "json_schema" }`. Web search via native `web_search` tool. System prompt via `system` parameter. Requires explicit `max_tokens` on every request.
- **Routing** (Gemini-only, `server/ai/routing/`):
  - `SmartRouter.ts` — 3-pass model selection (Filter → Capacity → Overflow). **Only used by GeminiAdapter.**
  - `QuotaTracker.ts` — Optimistic in-memory sliding-window quota tracker. **Only used by GeminiAdapter.**
  - `registry.ts` — Gemini model configs with per-tier rate limits. Model classes: `lite`, `flash`, `pro`.
  - `ParallelQueue.ts` — Tier-aware concurrency limiter (PAID=10, FREE=2 workers). Provider-agnostic.
- **Model class mapping** (`routing.prefer`):

  | `prefer`  | Gemini (PAID, AI_TIER)                  | Gemini (FREE)           | OpenAI                      | Anthropic           |
  | --------- | --------------------------------------- | ----------------------- | --------------------------- | ------------------- |
  | `"lite"`  | `gemini-3.1-flash-lite` (GA 2026-05-07) | `gemini-2.5-flash-lite` | `gpt-5.4-nano` (2026-03-17) | `claude-haiku-4-5`  |
  | `"flash"` | `gemini-2.5-flash`                      | `gemini-2.5-flash`      | `gpt-5.4-mini`              | `claude-sonnet-4-6` |
  | `"pro"`   | `gemini-2.5-pro`                        | `gemini-2.5-pro`        | `gpt-5.4`                   | `claude-opus-4-6`   |

  SmartRouter prefers higher-generation models within a class, so on `AI_TIER=PAID` `prefer: "lite"` picks the newer paid-only `gemini-3.1-flash-lite`; on `AI_TIER=FREE` the same call resolves to `gemini-2.5-flash-lite` because Gemini 3 has no free tier.

### AI Search Enrichment Pipeline (`server/services/aiSearch/`)

Deep enrichment system for contact data using LLM-powered web search:

- **`jobQueue.ts`**: Background job processor with concurrency controls.
- **`mergeEngine.ts`**: Merges AI-discovered data into existing contact records.
- **`promptTemplate.ts`**: Structured prompts for search-based enrichment.
- **`strategies/`**: Pluggable enrichment strategy implementations.

### AI Response Caching (`server/utils/aiCache.ts`)

Multi-tier LRU cache for AI responses:

- Tiers: `mentions`, `synthesis`, and extensible.
- Content-addressed via SHA-256 hash of input text.
- Prevents redundant LLM calls for identical inputs (e.g., immutable interaction text → mention extraction).

### Link Unfurling

Handled natively using lightweight `cheerio` HTML parsers for OpenGraph extraction without headless browsers (see `server/services/linkPreviewService.ts`).

### Concurrency / Threading Model

- **Server**: Single Node.js process, async I/O. Background sweeps run on startup: relationship score recomputation in yielding batches of 200 (then hourly via `setInterval`), retroactive geocoding, local embedding backfill, dedupe embedding backfill.
- **AI Queue**: Concurrency managed by `ParallelQueue` — max 10 concurrent workers (PAID) or 2 (FREE), respecting per-model RPM/TPM/RPD limits dynamically.

## 3. Data Models & Database Schema

### Core Tables (Drizzle ORM — `src/db/schema.ts`)

| Table                  | Purpose                            | Key Fields                                                                                                                                                                                                                            |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contacts`             | Primary entity boundary            | `id`, `name`, `firstName`, `lastName`, `headline`, `role`, `company`, `location`, `lat/lng`, `isGhost`, `isArchived`, `canonicalId`, `phoneticHash`, `relationshipScore`, `searchExpansion`, `aiBriefing`, `aiSummary`, `cadenceDays` |
| `contact_emails`       | Multi-value emails                 | `contactId` FK CASCADE, `email`, `label`, `isPrimary`, `source`                                                                                                                                                                       |
| `contact_phones`       | Multi-value phones                 | `contactId` FK CASCADE, `phone`, `label`, `isPrimary`, `source`                                                                                                                                                                       |
| `contact_addresses`    | Multi-value addresses              | `contactId` FK CASCADE, `address`, `label`, UNIQUE(contactId, address)                                                                                                                                                                |
| `contact_social_links` | Typed social/professional URLs     | `contactId` FK CASCADE, `platform`, `url`, `handle`                                                                                                                                                                                   |
| `contact_education`    | Normalized education history       | `contactId` FK CASCADE, `school`, `degree`, `fieldOfStudy`, `startDate`, `endDate`                                                                                                                                                    |
| `contact_experience`   | Normalized work history            | `contactId` FK CASCADE, `company`, `role`, `startDate`, `endDate`, `isCurrent`, `location`                                                                                                                                            |
| `contact_sources`      | Per-import provenance              | `contactId` FK CASCADE, `platform`, `externalId`, `connectedOn`, `rawData`                                                                                                                                                            |
| `contact_tags`         | Free-form tagging                  | `contactId` FK CASCADE, `tag`                                                                                                                                                                                                         |
| `contact_interests`    | AI-generated personal interests    | `contactId` FK CASCADE, `interest`, `isAiGenerated`, UNIQUE(contactId, interest)                                                                                                                                                      |
| `contact_attributes`   | Flexible key-value LLM extractions | `contactId` FK CASCADE, `name`, `value`, UNIQUE(contactId, name)                                                                                                                                                                      |
| `interactions`         | Chronological timeline entries     | `contactId` FK CASCADE, `type`, `title`, `content`, `date`, `mentions`, `fileUrl`                                                                                                                                                     |
| `interaction_mentions` | Bi-directional graph connections   | Composite PK(`interactionId`, `contactId`), both FK CASCADE                                                                                                                                                                           |
| `action_items`         | First-class follow-up tasks        | `contactId` FK CASCADE, `interactionId` FK SET NULL, `title`, `dueAt`, `completedAt`                                                                                                                                                  |
| `lists`                | User-created contact groups        | `id`, `name`, `icon`, `sortOrder`                                                                                                                                                                                                     |
| `list_members`         | List↔Contact junction              | Composite PK(`listId`, `contactId`), both FK CASCADE                                                                                                                                                                                  |

### Deduplication Engine Tables

| Table                   | Purpose                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `dedupe_suggestions`    | Pending match pairs with confidence, reasoning, status lifecycle (`pending` → `merged` / `dismissed` / `auto_merged`) |
| `dedupe_exclusions`     | Permanent never-merge constraints. Composite PK(`contactIdA`, `contactIdB`)                                           |
| `dedupe_merge_log`      | Full audit trail for merge/undo operations (soft + hard merges) with `duplicateSnapshot` JSON blob                    |
| `dedupe_embedding_meta` | Tracks `embeddedAt` timestamp per contact for staleness detection                                                     |

### Virtual Tables (NOT managed by Drizzle — defined in `server/db.ts`)

| Table                | Engine | Dimensions | Purpose                                                                                                                            |
| -------------------- | ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `contacts_fts`       | FTS5   | N/A        | Full-text search index with weighted columns. Rebuilt on every startup. Maintained by 12+ SQL triggers on contacts + child tables. |
| `search_embeddings`  | `vec0` | 384-dim    | Local embeddings via `Xenova/all-MiniLM-L6-v2` (Transformers.js). Powers KNN search in Spotlight.                                  |
| `contact_embeddings` | `vec0` | 768-dim    | Gemini API embeddings exclusively for deduplication NLP.                                                                           |

### Critical Rules (Virtual Tables)

**`vec0` virtual tables do NOT support foreign key cascading.**
When deleting or merging contacts, you **MUST** manually execute:

```sql
DELETE FROM search_embeddings WHERE contactId = ?;
DELETE FROM contact_embeddings WHERE contactId = ?;
```

Failure to do this creates orphaned embedding vectors that corrupt KNN search results.

### SQL Triggers (installed in `server/db.ts`)

- **FTS5 Sync**: 12 triggers maintain `contacts_fts` consistency across inserts/updates/deletes on `contacts`, `contact_tags`, `contact_interests`, `contact_emails`, `contact_phones`.
- **`updatedAt` Auto-stamp**: 3 triggers on `contacts`, `interactions`, `action_items` — auto-set `updatedAt` to `datetime('now')` when the field isn't explicitly changed.
- **Action Item Sync**: 3 triggers keep `contacts.nextFollowUpAt` = `MIN(dueAt)` of pending (non-completed) action items. Fires on insert/update/delete of `action_items`.

### Schema Change Process

1. Modify `src/db/schema.ts` (Drizzle schema definition).
2. Run `npm run db:generate` to output a Drizzle migration to `./drizzle/`.
3. The server automatically applies pending migrations on startup via `migrate()`.
4. Virtual table configs and triggers persist in `server/db.ts` (NOT managed by Drizzle).

### Performance PRAGMAs (set in `server/db.ts`)

| PRAGMA         | Value     | Purpose                                       |
| -------------- | --------- | --------------------------------------------- |
| `journal_mode` | WAL       | Concurrent reads during writes                |
| `foreign_keys` | ON        | Enforce referential integrity                 |
| `cache_size`   | -8000     | ~8MB page cache (pins ~90% of DB)             |
| `mmap_size`    | 268435456 | Memory-map up to 256MB                        |
| `synchronous`  | NORMAL    | Fewer fsync calls, acceptable for local-first |
| `temp_store`   | MEMORY    | In-memory temp tables for complex JOINs       |

## 4. Layered Directory Structure (Strict Segregation)

### Backend (`server/`)

- `server/ai/` — AI layer: `aiService.ts` facade, `singleton.ts`, `provider.ts`, `types.ts`
  - `server/ai/adapters/` — Vendor integrations: `gemini.ts` (`@google/genai`), `openai.ts` (`openai`), `anthropic.ts` (`@anthropic-ai/sdk`)
  - `server/ai/routing/` — `SmartRouter.ts`, `QuotaTracker.ts`, `ParallelQueue.ts`, `registry.ts`
- `server/routes/` — Thin Express controllers: `contacts.ts`, `interactions.ts`, `search.ts`, `aiSearch.ts`, `ai.ts`, `dedupe/`, `lists.ts`, `actionItems.ts`, `dashboard.ts`, `linkPreview.ts`, `mcp.ts`
- `server/services/` — Heavy business logic:
  - `contactService.ts`, `interactionService.ts`, `searchService.ts`, `listService.ts`, `actionItemService.ts`, `dashboardService.ts`, `relationshipService.ts`, `linkPreviewService.ts`, `mcpService.ts`, `zeroStateService.ts`
  - `server/services/dedupe/` — Multi-pass deduplication engine (14 files): `engine.ts`, `passes.ts`, `blocking.ts`, `scoring.ts`, `clustering.ts`, `merging.ts`, `suggestions.ts`, `embeddings.ts`, `normalization.ts`, `ai.ts`, `context.ts`, `jobQueue.ts`, `types.ts`, `index.ts`
  - `server/services/search/` — `hybridRetrieval.ts` (RRF pipeline), `localEmbeddings.ts` (Transformers.js)
  - `server/services/geocoding/` — Mapbox/Nominatim geocoding with retroactive backfill
  - `server/services/aiSearch/` — AI search enrichment: `jobQueue.ts`, `mergeEngine.ts`, `promptTemplate.ts`, `strategies/`, `types.ts`, `index.ts`
- `server/repositories/` — Data-access patterns: `contactRepository.ts`, `types.ts`
- `server/utils/` — Shared utilities: `AppError.ts`, `asyncHandler.ts`, `aiCache.ts`, `paths.ts` (DATA_DIR-aware upload paths + traversal-safe resolution), `logger.ts`, `helpers.ts`, `validators.ts`, `avatarProcessor.ts`, `smartAvatar.ts`, `unionFind.ts`
  - `server/utils/nlp/` — NLP primitives: `names.ts`, `nicknames.ts`, `phonetics.ts` (Double Metaphone), `distances.ts` (Levenshtein, Jaro-Winkler), `company.ts`, `phone.ts`
- `server/middleware/auth.ts` — Single-user bearer-token auth: `requireAuth` gates `/api` + `/uploads` when `AUTH_TOKEN` or `AUTH_REQUIRED=true` is set (auto-generated token persisted to `DATA_DIR/auth-token`); `/api/auth` router (status/login/logout, HttpOnly SameSite=Strict cookie). Timing-safe comparison; env read per request so tests can toggle.
- `server/services/backupService.ts` — Scheduled SQLite snapshots (online backup API) into `DATA_DIR/backups` with rotation (`BACKUP_INTERVAL_HOURS`/`BACKUP_KEEP`).
- `server/services/exportService.ts` — Full-DB JSON export + flat contacts CSV.
- `server/routes/dataLifecycle.ts` — `/api/trash` (+restore/purge), `/api/backups`, `/api/export/{json,csv}`.
- **Trash semantics**: `DELETE /api/contacts/:id` is a SOFT delete (`deletedAt` + `isArchived=1`; FTS row dropped by trash-aware triggers; embeddings purged). Restore clears both and re-embeds. `purgeExpiredTrash()` hard-deletes after `TRASH_RETENTION_DAYS` (default 30, daily sweep). The `deletedAt` column must exist BEFORE the FTS trigger DDL in db.ts (pre-FTS ALTER).
- `server/app.ts` — Express app factory (`createApp`/`finalizeApp`): middleware + routers + error pipeline without listen/Vite. server.ts and the integration tests both consume it.
- `server/ai/capabilities.ts` — Capability routing (`quick` / `deep` / `research` / `embeddings`): resolves each capability to a provider + model from settings pins → env overrides (`AI_QUICK_MODEL` etc.) → Auto (legacy `AI_PROVIDER` first, then a preference order). Internal classes preserved: quick→lite, deep→flash, research→pro.
- `server/ai/gateway.ts` — `generateFor(capability, options)`: the single entry point business logic uses for generation. Replaces calling one shared provider with `routing.prefer`.
- `server/ai/providerRegistry.ts` — All _configured_ providers (env keys, UI-stored keys, custom OpenAI-compatible endpoints), instance-cached per id so Gemini's SmartRouter/QuotaTracker stay singleton.
- `server/ai/adapters/openaiCompatible.ts` — One adapter for every OpenAI-format backend (Ollama, vLLM, LM Studio, xAI, DeepSeek, Mistral). Adaptive structured output: json_schema → json_object → prompt, remembered per model.
- `server/ai/embeddings.ts` — Embeddings capability + vec0 dimension lifecycle (probe → rebuild → re-embed).
- `server/ai/promptSafety.ts` — Prompt-injection defenses: `wrapUntrusted()` fencing + `UNTRUSTED_DATA_RULE` (applied at every prompt that interpolates contact/file/web text) and `sanitizeAiOutputValue()` (write-side backstop in aiSearch mergeEngine).
- `server/db.ts` — Database initialization, FTS5 setup (full rebuild gated behind the `user_version` pragma — bump `FTS_SCHEMA_VERSION` when FTS schema/trigger payloads change), triggers, virtual tables, performance PRAGMAs, data cleanup

### Frontend (`src/`)

- `src/api/` — Domain-separated React Query hooks: `contacts.ts`, `interactions.ts`, `search.ts`, `aiSearch.ts`, `dedupe.ts`, `lists.ts`, `actionItems.ts`, `dashboard.ts`, `enrichment.ts`, `suggestions.ts`, `index.ts`
- `src/hooks/` — Custom hooks: `useInstantSearch.ts`, `useQueryTokenizer.ts`, `useGlobalNavShortcuts.ts`, `useSearchHistory.ts`, `useRecentContacts.ts`, `useDebounce.ts`, `useDedupeSettings.ts`, `useFocusTrap.ts`, `useClickOutside.ts`, `useLongPress.ts`, `usePullToRefresh.ts`, `useScrollRestoration.ts`, `usePageTitle.ts`, `useCompanyLogo.ts`
- `src/components/command-palette/` — Core `cmdk` Cmd+K system (14 files): `CommandPalette.tsx`, `ActionSubMenu.tsx`, `FacetAutocomplete.tsx`, `FacetPills.tsx`, `ListPicker.tsx`, `ResultPeek.tsx`, `SynthesisBar.tsx`, `ZeroStateView.tsx`, `AiComponents.tsx`, `ContactMetaBadges.tsx`, `DataAgeHalo.tsx`, `InlineNoteComposer.tsx`, `utils.ts`, `index.ts`
- `src/components/layout/` — Shell components: `Sidebar.tsx`, `EmptyState.tsx`, `ErrorBoundary.tsx`, `RouteErrorBoundary.tsx`
- `src/components/ui/` — Reusable primitives: `Modal.tsx`, `ContextMenu.tsx`, `Combobox.tsx`, `CustomSelect.tsx`, `AnimatedSkeleton.tsx`, `PullIndicator.tsx`
- `src/components/` — Feature components: `ImportModal.tsx`, `QuickInteractionModal.tsx`, `RichInteractionComposer.tsx`, `AvatarPickerModal.tsx`, `KeyboardShortcutsModal.tsx`, `BulkEditFieldModal.tsx`, `MentionSuggestion.tsx`, `LinkPreviewExtension.tsx`, `LocalTimeWeather.tsx`, `HealthRingAvatar.tsx`, `FloatingContactCard.tsx`
- `src/views/` — Route-driven page components:
  - `src/views/contact-list/` — Network list (left panel)
  - `src/views/contact-detail/` — Contact profile (right panel)
  - `src/views/dedupe/` — Deduplication management (Tinder-style swipe UI)
  - `src/views/search/` — Search result cards
  - `src/views/lists/` — List management (create, detail, members)
  - `src/views/dashboard/` — Pulse dashboard (metrics, action items, insights)
  - `src/views/ai-search/` — AI-powered semantic search view
  - `src/views/dev/` — Component showcase (dev-only, lazy-loaded)
  - `SearchView.tsx`, `DashboardView.tsx`, `MapView.tsx`, `SettingsView.tsx`, `ArchivedContactsView.tsx`, `TrashView.tsx` (restore / delete-forever UI at `/settings/trash`)
- `src/contexts/` — React Context providers: `AISearchContext.tsx`, `DedupeContext.tsx`
- `src/lib/` — Shared frontend utilities: `styles.ts` (token definitions), `queryConfig.ts` (React Query staleTime presets), `importers.ts` (CSV/LinkedIn/Apple parsers), `keyboard.ts`, `avatar.ts`, `safeParse.ts`, `utils.ts`
- `src/db/` — `schema.ts` (Drizzle ORM schema definitions)
- `src/types.ts` — Shared TypeScript type definitions

### Root Files

- `server.ts` — Express application entry point (boots server, mounts routes, starts background tasks)
- `index.html` — SPA shell
- `seed.ts` / `seedMock.ts` — Database seeding scripts
- `vite.config.ts` — Vite + Tailwind + React plugin config (path alias `@` → project root)
- `vitest.config.ts` — Test runner config (Node environment, `v8` coverage)
- `drizzle.config.ts` — Drizzle Kit config (schema → `./src/db/schema.ts`, output → `./drizzle/`, dialect → sqlite, DB → `curator.db`)
- `tsconfig.json` — TypeScript config (ES2022 target, ESNext modules, bundler resolution, `@/*` path alias)

## 5. External Integrations

- **LLM Providers** (resolved per capability; `AI_PROVIDER` sets the Auto preference):
  - **Gemini** (default): 6 registered models via `@google/genai`. Full SmartRouter + QuotaTracker + circuit breakers. Includes Google Search grounding and embedding models.
  - **OpenAI**: `gpt-4o-mini`, `gpt-5.4-mini`, `gpt-5.4` via `openai` npm package. Web search via Responses API. Structured output via `response_format: json_schema`.
  - **Anthropic**: `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-6` via `@anthropic-ai/sdk`. Web search via native `web_search` tool. Structured output via `output_config.format: json_schema`.
- **Dedupe Embeddings**: resolved from the embeddings capability — the same model that backs semantic search. Defaults to the built-in local model. Degrades to deterministic-only matching when unavailable.
- **Local Search Embeddings**: `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers` — 384-dim vectors for search. Provider-agnostic (runs locally).
- **Geocoding**: Mapbox (Primary, requires `MAPBOX_API_KEY`) / Nominatim (Fallback, no key needed).
- **Avatar Processing**: `sharp` for image resizing/optimization.
- **Icons**: `lucide-react` icon library.
- **Toast Notifications**: `sonner`.
- **Drag & Drop**: `@dnd-kit/core` + `@dnd-kit/sortable` for list reordering.
- **Date Utilities**: `date-fns` for formatting, `chrono-node` for NLP date parsing.
- **Validation**: `zod` for runtime payload validation.
- **Utilities**: `clsx` + `tailwind-merge` for class merging, `dompurify` for HTML sanitization, `papaparse` for CSV parsing, `eml-format` for .eml email parsing.

### Model Ledger (ML/AI Topology)

_Documents every LLM/ML model in use. Required by the ml-ai topology profile for Circuit Breaker calculations._

#### Gemini Models

| Model                    | Role                                                                  | Cost (1M in / 1M out) | Context Window | Structured Output | Rate Limit (FREE)           | Rate Limit (PAID)            | Circuit Breaker Cost Cap |
| ------------------------ | --------------------------------------------------------------------- | --------------------- | -------------- | ----------------- | --------------------------- | ---------------------------- | ------------------------ |
| `gemini-2.5-flash-lite`  | Lite extraction, mentions, reranking, search expansion, daily insight | $0.075 / $0.40        | 1M tokens      | Yes (JSON schema) | 10 RPM / 250K TPM / 500 RPD | 10K RPM / 10M TPM / ∞ RPD    | $0.50/day                |
| `gemini-2.5-flash`       | Flash reasoning, EML summaries, general structured tasks              | $0.15 / $2.50         | 1M tokens      | Yes (JSON schema) | 2 RPM / 250K TPM / 20 RPD   | 2K RPM / 3M TPM / 100K RPD   | $2.00/day                |
| `gemini-2.5-pro`         | Pro — complex reasoning, AI search grounding (Pass 1)                 | $1.25 / $10.00        | 1M tokens      | Yes (JSON schema) | 2 RPM / 4K TPM / 2 RPD      | 1K RPM / 5M TPM / 50K RPD    | $5.00/day                |
| `gemini-3.1-flash-lite`  | Lite (GA 2026-05-07) — default lite class on PAID tier                | $0.25 / $1.50         | 1M tokens      | Yes (JSON schema) | N/A (paid only)             | 10K RPM / 10M TPM / 350K RPD | $1.50/day                |
| `gemini-3-flash-preview` | Preview flash — overflow capacity (PAID only)                         | $0.15 / $3.00         | 1M tokens      | Yes (JSON schema) | N/A (paid only)             | 2K RPM / 3M TPM / 100K RPD   | $3.00/day                |
| `gemini-3.1-pro-preview` | Preview pro — overflow capacity (PAID only)                           | $1.25 / $12.00        | 1M tokens      | Yes (JSON schema) | N/A (paid only)             | 1K RPM / 5M TPM / 50K RPD    | $6.00/day                |

_Grounding RPD is a shared pool: 500 RPD (FREE) / 5,000 RPD (PAID) across all Gemini models._

#### OpenAI Models

| Model          | Class | Cost (1M in / 1M out) | Context Window | Structured Output   | Web Search          | Notes                                            |
| -------------- | ----- | --------------------- | -------------- | ------------------- | ------------------- | ------------------------------------------------ |
| `gpt-5.4-nano` | lite  | $0.20 / ~$0.80        | 128K tokens    | Yes (`json_schema`) | Yes (Responses API) | Cheapest, default for lite tasks (GA 2026-03-17) |
| `gpt-5.4-mini` | flash | $0.75 / $4.50         | 400K tokens    | Yes (`json_schema`) | Yes (Responses API) | Balanced price/quality                           |
| `gpt-5.4`      | pro   | $2.50 / $15.00        | 1.05M tokens   | Yes (`json_schema`) | Yes (Responses API) | Flagship reasoning                               |

_No free tier. Prepaid billing required (~$5 starter credits for new accounts). Rate limits are dynamic based on account spend tier._

#### Anthropic Models

| Model               | Class | Cost (1M in / 1M out) | Context Window | Structured Output   | Web Search        | Notes                            |
| ------------------- | ----- | --------------------- | -------------- | ------------------- | ----------------- | -------------------------------- |
| `claude-haiku-4-5`  | lite  | $1.00 / $5.00         | 200K tokens    | Yes (`json_schema`) | Yes (native tool) | Cheapest, default for lite tasks |
| `claude-sonnet-4-6` | flash | $3.00 / $15.00        | 200K tokens    | Yes (`json_schema`) | Yes (native tool) | Balanced coding/agents           |
| `claude-opus-4-6`   | pro   | $5.00 / $25.00        | 200K tokens    | Yes (`json_schema`) | Yes (native tool) | Flagship reasoning               |

_No free tier. Prepaid billing required (~$5 starter credits for new accounts). Rate limits based on 4-tier spend system. No first-party embedding models._

#### Local Models (Provider-Agnostic)

| Model                     | Role                                | Cost         | Dimensions | Notes                                                           |
| ------------------------- | ----------------------------------- | ------------ | ---------- | --------------------------------------------------------------- |
| `Xenova/all-MiniLM-L6-v2` | Search embeddings (Transformers.js) | Free (local) | 384-dim    | Powers KNN in Spotlight. Default for the embeddings capability. |

## 6. Environment Variables

| Variable              | Required                | Default      | Purpose                                                                                                                                              |
| --------------------- | ----------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_PROVIDER`         | No                      | `gemini`     | Preferred provider when a capability is on Auto. Supported: `"gemini"`, `"openai"`, `"anthropic"`.                                                   |
| `AI_QUICK_MODEL`      | No                      | —            | Pin the Quick-tasks model: `model` or `provider:model`. Overridden by a Settings pin.                                                                |
| `AI_DEEP_MODEL`       | No                      | —            | Pin the Deep-tasks model.                                                                                                                            |
| `AI_RESEARCH_MODEL`   | No                      | —            | Pin the Online-research capability.                                                                                                                  |
| `AI_EMBEDDINGS_MODEL` | No                      | —            | Pin the Embeddings model (governs both search and dedupe vectors).                                                                                   |
| `GEMINI_API_KEY`      | No (any provider works) | —            | Google Gemini API key. Enables Gemini for any capability set to Auto.                                                                                |
| `OPENAI_API_KEY`      | No (any provider works) | —            | OpenAI API key. Prepaid billing required.                                                                                                            |
| `ANTHROPIC_API_KEY`   | No (any provider works) | —            | Anthropic Claude API key. Prepaid billing required.                                                                                                  |
| `AI_TIER`             | No                      | `FREE`       | **Gemini only.** Controls SmartRouter rate limit profiles: `FREE` (~10 RPM) or `PAID` (10K+ RPM, preview models). Has no effect on OpenAI/Anthropic. |
| `MAPBOX_API_KEY`      | No                      | —            | Enables Mapbox as primary geocoder (falls back to Nominatim if missing).                                                                             |
| `PORT`                | No                      | `3210`       | Server port.                                                                                                                                         |
| `HOST`                | No                      | `127.0.0.1`  | Bind interface. No auth exists, so localhost by default; Docker sets `0.0.0.0`.                                                                      |
| `CORS_ORIGIN`         | No                      | — (off)      | Enables CORS for one origin. Disabled by default (SPA is same-origin).                                                                               |
| `DATA_DIR`            | No                      | project root | Root for runtime data: `curator.db`, `uploads/`, Transformers.js model cache. `/app/data` in Docker.                                                 |
| `APP_URL`             | No                      | —            | Self-referential URL for OAuth/links (injected by AI Studio).                                                                                        |
| `NODE_ENV`            | No                      | —            | When `production`, serves static `dist/` and uses `morgan` short format.                                                                             |
| `DISABLE_HMR`         | No                      | —            | Set to `true` to disable Vite HMR (used in AI Studio to prevent flickering).                                                                         |

## 7. Invariants & Safety Rules

- **NEVER** write native `useEffect` fetch loops for data operations. Rely solely on `@tanstack/react-query`.
- **NEVER** silently swallow errors (`.catch(() => {})`).
- **MUST** manually purge `search_embeddings`, `contact_embeddings`, and `dedupe_embedding_meta` on contact deletion/merge.
- **MUST** resolve stored `/uploads/...` URLs through `resolveUploadPath()` (`server/utils/paths.ts`) before any filesystem read/unlink — these columns are user-writable and the helper enforces containment inside the uploads root.
- **MUST** route all AI calls through the `ai` singleton exported from `server/ai/index.ts`. Never import `@google/genai`, `openai`, or `@anthropic-ai/sdk` directly outside the adapter layer.
- **Exception**: `server/services/dedupe/embeddings.ts` imports `@google/genai` directly for embedding generation — this is Gemini-only and does not go through the provider adapter.
- **Local-First Mandate**: External relational database usage is forbidden. All data lives in `curator.db`.
- **Thin Routes / Heavy Services**: Express routes parse payloads and delegate. Business logic lives in `server/services/`.

## 8. Error Handling

### Request Tracing

Every request is assigned an 8-char UUID prefix by middleware (`crypto.randomUUID().split("-")[0]`). The id appears in every log line **and** is echoed back to the client in the error response body, so users can quote it when reporting an issue.

### `asyncHandler`

`server/utils/asyncHandler.ts` is a higher-order function that wraps any async (or sync-throwing) Express handler so its errors flow into the central error middleware. Every route in the codebase uses it — bare `async (req, res) => …` handlers are a code-review block because Express won't catch a rejected promise on its own.

### `AppError` hierarchy (`server/utils/AppError.ts`)

Every operational error thrown from a service or repository MUST be an `AppError` (or one of its subclasses). Plain `throw new Error(...)` in the service layer is a code-review block — it surfaces as a generic 500 and loses both the HTTP status and the machine-readable code.

| Class                               | Status       | `code`                | Use when…                                              |
| ----------------------------------- | ------------ | --------------------- | ------------------------------------------------------ |
| `AppError`                          | configurable | derived from status   | The catch-all — only for cases no subclass fits        |
| `NotFoundError(entity, id?)`        | 404          | `NOT_FOUND`           | An entity wasn't found                                 |
| `ValidationError(message, details)` | 400          | `VALIDATION_ERROR`    | Inbound payload failed validation (carries Zod issues) |
| `ConflictError`                     | 409          | `CONFLICT`            | Resource already exists / state conflict               |
| `RateLimitedError`                  | 429          | `RATE_LIMITED`        | Upstream or local rate limit hit                       |
| `ServiceUnavailableError`           | 503          | `SERVICE_UNAVAILABLE` | Dependency is down (e.g. AI provider after retries)    |
| `UpstreamTimeoutError`              | 504          | `UPSTREAM_TIMEOUT`    | A bounded upstream call exceeded its timeout           |

Every `AppError` carries: `message`, `statusCode`, `code` (stable machine-readable identifier), `details` (arbitrary structured blob — used by `ValidationError` to carry the Zod issue list), `cause` (the original underlying error, kept for log forensics — never sent to clients), and `isOperational` (`true` for expected errors, `false` for programmer errors).

### Centralized Error Middleware (`server/middleware/errorHandler.ts`)

A single Express error handler translates every known thrown shape into the canonical response body:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Contact c_123 not found",
    "requestId": "ab12cd34",
    "details": { "entity": "Contact", "id": "c_123" },
    "stack": "..."
  }
}
```

The middleware handles:

- `AppError` and subclasses — uses the carried `statusCode`, `code`, `message`, `details`
- `ZodError` — 400 / `VALIDATION_ERROR` with `issues` as `details`
- Express `entity.parse.failed` — 400 / `INVALID_JSON`
- `SQLITE_CONSTRAINT` — 400 / `DB_CONSTRAINT`
- `SQLITE_BUSY` — 503 / `DB_BUSY`
- `SQLITE_READONLY` — 503 / `DB_READONLY`
- Anything else — 500 / `INTERNAL` with a generic message (raw thrown text is never leaked)

`stack` is included in the response body only when `NODE_ENV !== "production"`. `cause` is never serialized to clients — it's strictly for the server log. When the response has already started streaming (e.g. SSE routes), the middleware ends the connection instead of trying to write a JSON body on top of partial bytes.

### `notFoundHandler`

Mounted after every API router and before the SPA fallback. Catches any `/api/*` request that didn't match a route and emits an `AppError(404, "ROUTE_NOT_FOUND")` so the client gets a JSON 404 instead of falling through to `index.html`. Non-`/api/*` paths pass through unchanged so the SPA can render the route.

### Input Validation (`server/utils/validators.ts`)

- `validateBody(schema)`, `validateParams(schema)`, `validateQuery(schema)` — Zod-driven middleware factories. They mutate `req.body` / `req.params` / `req.query` to the parsed value and throw `ValidationError` on failure (never writing to `res` directly).

### Client Error Boundaries

- `ErrorBoundary` (global) and `RouteErrorBoundary` (per-route) catch rendering crashes with recovery UI.

## 8a. AI Resilience (`server/ai/resilience.ts`)

Shared utilities that every adapter (Gemini, OpenAI, Anthropic) wraps its SDK call in. Without this module, each adapter would reinvent (or skip) retries and timeouts independently.

### `withTimeout(op, timeoutMs, parentSignal?)`

Runs `op(signal)` with a hard timeout. Resolves with the op's value within `timeoutMs`, or rejects with an `UpstreamTimeoutError` once the timer fires. The signal passed into `op` is aborted when the timer fires AND when `parentSignal` aborts (if provided). Adapters MUST forward this signal to their SDK call (`{ signal }` on the OpenAI / Anthropic clients) so the underlying socket is actually closed — without that, the timer just lets the request leak in the background.

### `withRetry(op, opts)`

Exponential-backoff retry with jitter. Defaults: 3 attempts, base 500ms, jitter 250ms. Recognizes transient failures via `isRetryableError`: HTTP 408/429/5xx, `ECONNRESET`/`ECONNREFUSED`/`ETIMEDOUT`/`EAI_AGAIN`, and message-keyword matches (`rate limit`, `quota`, `overloaded`, `temporarily unavailable`, `timeout`, `deadline`). `UpstreamTimeoutError` is always retryable. When retries are exhausted, the final error is mapped to a typed `AppError`: 429 → `RateLimitedError`, 5xx → `ServiceUnavailableError`, anything else → `ServiceUnavailableError("AI provider call failed after retries")`. The caller's `signal` is honored — if it aborts mid-flight the retry loop breaks immediately and an `AppError(499, "CANCELLED")` is thrown.

The `onRetry(attempt, err)` hook is the adapter's seam for `log.warn(...)` retry telemetry and per-adapter side effects like circuit-breaker tripping.

### `parseAIJson(raw, context?)`

Tolerant JSON parser for model output. Strips markdown code fences (`json … `), trims surrounding whitespace, and falls back to extracting the first balanced `{...}` or `[...]` block when models wrap JSON in prose. On unrecoverable input, throws `AppError(502, "AI_INVALID_JSON")` with a snippet of the offending response — clients can branch on that code to substitute a default or retry.

### Adapter integration

All three adapters (`server/ai/adapters/{gemini,openai,anthropic}.ts`) share the same shape:

```ts
return withRetry(
  async (attempt) => {
    const result = await withTimeout(
      (signal) => this.client.someMethod(params, { signal }),
      timeoutMs,
      options.signal,
    );
    if (options.responseFormat === "json")
      parseAIJson(result.text, "ProviderAdapter.generate(...)");
    return result;
  },
  {
    signal: options.signal,
    onRetry: (attempt, err) =>
      log.warn(
        "ProviderAdapter",
        `attempt ${attempt} failed: ${getErrorMessage(err)}`,
      ),
  },
);
```

### Transactional Data Integrity

- `ContactRepository.insertChildRecords` runs all child-table inserts inside a single `sqlite.transaction()` — if any insert fails the entire contact write is rolled back.
- `mergeContacts` and `softMergeContacts` in `server/services/dedupe/merging.ts` re-fetch contact data **inside** the transaction (to mitigate TOCTOU) and write the audit log via `recordMergeUnsafe` **inside** the same transaction — there is no longer a window where a merge succeeds but the audit log doesn't.

## 9. Startup Lifecycle (`server.ts`)

1. Load environment variables (`dotenv/config`)
2. Validate that at least one provider is configured (env key, stored key, or custom endpoint); warn if none
3. Initialize Express with optional CORS (only when `CORS_ORIGIN` is set), JSON parsing (50MB limit), per-IP rate limiting on AI-cost endpoints (60 req/min via `server/middleware/rateLimit.ts`), request ID middleware, Morgan logging
4. Mount all API routers
5. Cache diagnostics endpoint (dev only: `/api/debug/cache-stats`)
6. Attach Vite dev middleware (dev) or serve static `dist/` (production)
7. Install centralized error handler
8. Start HTTP server on `PORT` (default 3210), bound to `HOST` (default 127.0.0.1)
9. **Background tasks** (non-blocking):
   - `startRetroactiveGeocoding()` — backfill missing lat/lng (skipped when `DISABLE_BACKGROUND_JOBS=true`, used by integration tests)
   - `relationshipService.recomputeAll()` — full score recompute, then hourly via `setInterval`
   - `initLocalEmbeddings()` → `backfillSearchEmbeddings()` — load Transformers.js model, backfill 384-dim vectors
   - `backfillEmbeddings()` — backfill 768-dim Gemini dedupe embeddings (only if count === 0)

## 10. Development Lifecycle

- **Install**: `npm install`
- **Boot**: `npm run dev` (Vite middleware + Express on `:3210`)
- **Build**: `npm run build` (Vite production build to `dist/`)
- **Database Seed**: `npm run seed` (resets data, recreates schemas, provides fixture data)
- **Migrations**: `npm run db:generate` (outputs Drizzle migration)
- **Type Check**: `npm run lint` (`tsc --noEmit`)
- **Test**: `npm test` (Vitest in watch mode) / `npx vitest run` (single-run)
- **Requirements**: Provide at least one AI credential — an API key in `.env` (copy from `.env.example`), a key entered under Settings → AI Configuration, or a custom OpenAI-compatible endpoint

## 11. AI Stats API Contracts

Two endpoints under `/api/ai/stats` (mounted via `aiStatsRouter`).

### `GET /api/ai/stats/summary`

Returns aggregate session KPIs, quota state, and cache tier statistics.

**Response** `200`:

```
{
  session: { totalInvocations, freshCalls, cachedCalls, totalTokens, estimatedCostUsd, cacheHitRate },
  tier: "FREE" | "PAID" | "MOCK",
  quota: { models: Record<modelId, { rpm, tpm, rpd }>, grounding: { rpd, limit, remaining } },
  cacheTiers: Record<tierName, { entries, hits, misses, evictions, hitRate, ttlMs, maxEntries }>,
  timestamp: string  // ISO 8601
}
```

### `GET /api/ai/stats/feed`

Paginated, filterable AI invocation history.

**Query params**: `offset` (default 0), `limit` (default 50, max 200), `operation` (comma-separated filter), `cached` ("true"|"false"), `sort` ("newest"|"oldest").

**Response** `200`:

```
{
  items: Array<{ id, operation, model, tokenCount, latencyMs, cached: boolean, description, createdAt }>,
  pagination: { offset, limit, totalCount, hasMore }
}
```

**Data source**: `ai_invocations` table in `curator.db`. 30-day rolling retention. Full contract details in `docs/designs/2026-04-14-architect-ai-stats-page.md`.
