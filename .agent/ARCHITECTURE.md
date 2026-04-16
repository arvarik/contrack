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
- **AI Provider**: Google Gemini via `@google/genai`. Local embeddings via `@huggingface/transformers` (Transformers.js).
- **Deployment**: Local-first / Self-hosted. Single Node.js process serves both API and frontend.
- **Package Management**: npm
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite` plugin.

## 2. System Boundaries & Data Flow

### Request / Data Flow
- **Client to Server**: React Components → React Query (`useQuery`/`useMutation` in `src/api/`) → Express API routes (`server/routes/`) → Services (`server/services/`) → Repositories (`server/repositories/`) → Drizzle ORM → SQLite. **Never** write native `useEffect` fetch loops.
- **Cold-Boot Prefetch**: `src/main.tsx` calls `queryClient.prefetchQuery` for `['contacts']` before the first render, ensuring Cmd+K has 0ms client-side data availability.

### Search Pipeline (Ask Contrack v3 — Spotlight)
Multi-stage hybrid retrieval with Reciprocal Rank Fusion (k=15):
1. **Temporal Parsing**: `chrono-node` extracts date ranges from natural language queries.
2. **Query Tokenization**: `useQueryTokenizer` hook splits queries into faceted filters and free-text components.
3. **FTS5 Weighted BM25**: Full-text search across `contacts_fts` virtual table (name, company, role, headline, location, about, industry, extras, searchExpansion).
4. **Local Vector KNN**: `sqlite-vec` cosine similarity search against 384-dim embeddings from `Xenova/all-MiniLM-L6-v2` generated locally via Transformers.js.
5. **RRF Fusion**: Combines FTS5 and vector results using Reciprocal Rank Fusion (see `server/services/search/hybridRetrieval.ts`).
6. **Optional LLM Reranker**: `rerankCandidates()` in `aiService.ts` uses Gemini to filter false positives from ~30 pre-screened candidates.
7. **Two-Phase NDJSON Streaming**: Instant UI feedback from local retrieval (<15ms), followed by enriched backend resolution.

### AI Adapter Pipeline
All AI operations route through a layered architecture in `server/ai/`:
- **`aiService.ts`**: Provider-agnostic business logic facade. Exports: `parseContactRecord`, `generateCatchMeUpBriefing`, `extractMentions`, `summarizeEmlEmail`, `rerankCandidates`, `generateDailyInsight`, `bulkParseContacts`, `generateSearchExpansion`, `synthesizeSearchResults`.
- **`singleton.ts`**: Ensures one `SmartRouter`, one `QuotaTracker`, and one set of circuit breakers across the entire application.
- **`routing/SmartRouter.ts`**: 3-pass model selection algorithm:
  - **Pass 1 (Filter)**: Removes models blocked by policy, circuit breakers, tier availability, stability (preview vs stable), or feature requirements (grounding).
  - **Pass 2 (Capacity)**: Scans remaining models (cheapest-first, or preference-sorted) for tier-specific capacity via QuotaTracker.
  - **Pass 3 (Overflow)**: If all capacity exhausted, uses cheapest model with paid-tier limits (if `allowPaidSpillover` is enabled).
- **`routing/QuotaTracker.ts`**: Optimistic in-memory sliding-window tracker. Deducts quota synchronously BEFORE network requests to prevent burst 429 errors across parallel calls. Tracks RPM, TPM, RPD per model + shared grounding RPD pool.
- **`routing/registry.ts`**: Single source of truth for Gemini model configs. Current registry includes `gemini-2.5-flash-lite`, `gemini-2.5-flash`, `gemini-2.5-pro` (stable), and `gemini-3.1-flash-lite-preview`, `gemini-3-flash-preview`, `gemini-3.1-pro-preview` (preview). Model classes: `lite`, `flash`, `pro`.
- **`routing/ParallelQueue.ts`**: Tier-aware concurrency limiter (PAID=10, FREE=2 workers).
- **`adapters/gemini.ts`**: Sole integration point with `@google/genai`. All vendor-specific logic isolated here.

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
- **Server**: Single Node.js process, async I/O. Background sweeps run on startup: relationship score recomputation (then hourly via `setInterval`), retroactive geocoding, local embedding backfill, dedupe embedding backfill.
- **AI Queue**: Concurrency managed by `ParallelQueue` — max 10 concurrent workers (PAID) or 2 (FREE), respecting per-model RPM/TPM/RPD limits dynamically.

## 3. Data Models & Database Schema

### Core Tables (Drizzle ORM — `src/db/schema.ts`)

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `contacts` | Primary entity boundary | `id`, `name`, `firstName`, `lastName`, `headline`, `role`, `company`, `location`, `lat/lng`, `isGhost`, `isArchived`, `canonicalId`, `phoneticHash`, `relationshipScore`, `searchExpansion`, `aiBriefing`, `aiSummary`, `cadenceDays` |
| `contact_emails` | Multi-value emails | `contactId` FK CASCADE, `email`, `label`, `isPrimary`, `source` |
| `contact_phones` | Multi-value phones | `contactId` FK CASCADE, `phone`, `label`, `isPrimary`, `source` |
| `contact_addresses` | Multi-value addresses | `contactId` FK CASCADE, `address`, `label`, UNIQUE(contactId, address) |
| `contact_social_links` | Typed social/professional URLs | `contactId` FK CASCADE, `platform`, `url`, `handle` |
| `contact_education` | Normalized education history | `contactId` FK CASCADE, `school`, `degree`, `fieldOfStudy`, `startDate`, `endDate` |
| `contact_experience` | Normalized work history | `contactId` FK CASCADE, `company`, `role`, `startDate`, `endDate`, `isCurrent`, `location` |
| `contact_sources` | Per-import provenance | `contactId` FK CASCADE, `platform`, `externalId`, `connectedOn`, `rawData` |
| `contact_tags` | Free-form tagging | `contactId` FK CASCADE, `tag` |
| `contact_interests` | AI-generated personal interests | `contactId` FK CASCADE, `interest`, `isAiGenerated`, UNIQUE(contactId, interest) |
| `contact_attributes` | Flexible key-value LLM extractions | `contactId` FK CASCADE, `name`, `value`, UNIQUE(contactId, name) |
| `interactions` | Chronological timeline entries | `contactId` FK CASCADE, `type`, `title`, `content`, `date`, `mentions`, `fileUrl` |
| `interaction_mentions` | Bi-directional graph connections | Composite PK(`interactionId`, `contactId`), both FK CASCADE |
| `action_items` | First-class follow-up tasks | `contactId` FK CASCADE, `interactionId` FK SET NULL, `title`, `dueAt`, `completedAt` |
| `lists` | User-created contact groups | `id`, `name`, `icon`, `sortOrder` |
| `list_members` | List↔Contact junction | Composite PK(`listId`, `contactId`), both FK CASCADE |

### Deduplication Engine Tables

| Table | Purpose |
|-------|---------|
| `dedupe_suggestions` | Pending match pairs with confidence, reasoning, status lifecycle (`pending` → `merged` / `dismissed` / `auto_merged`) |
| `dedupe_exclusions` | Permanent never-merge constraints. Composite PK(`contactIdA`, `contactIdB`) |
| `dedupe_merge_log` | Full audit trail for merge/undo operations (soft + hard merges) with `duplicateSnapshot` JSON blob |
| `dedupe_embedding_meta` | Tracks `embeddedAt` timestamp per contact for staleness detection |

### Virtual Tables (NOT managed by Drizzle — defined in `server/db.ts`)

| Table | Engine | Dimensions | Purpose |
|-------|--------|------------|---------|
| `contacts_fts` | FTS5 | N/A | Full-text search index with weighted columns. Rebuilt on every startup. Maintained by 12+ SQL triggers on contacts + child tables. |
| `search_embeddings` | `vec0` | 384-dim | Local embeddings via `Xenova/all-MiniLM-L6-v2` (Transformers.js). Powers KNN search in Spotlight. |
| `contact_embeddings` | `vec0` | 768-dim | Gemini API embeddings exclusively for deduplication NLP. |

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
| PRAGMA | Value | Purpose |
|--------|-------|---------|
| `journal_mode` | WAL | Concurrent reads during writes |
| `foreign_keys` | ON | Enforce referential integrity |
| `cache_size` | -8000 | ~8MB page cache (pins ~90% of DB) |
| `mmap_size` | 268435456 | Memory-map up to 256MB |
| `synchronous` | NORMAL | Fewer fsync calls, acceptable for local-first |
| `temp_store` | MEMORY | In-memory temp tables for complex JOINs |

## 4. Layered Directory Structure (Strict Segregation)

### Backend (`server/`)
- `server/ai/` — AI layer: `aiService.ts` facade, `singleton.ts`, `provider.ts`, `types.ts`
  - `server/ai/adapters/` — Vendor integrations (`gemini.ts` — sole `@google/genai` touchpoint)
  - `server/ai/routing/` — `SmartRouter.ts`, `QuotaTracker.ts`, `ParallelQueue.ts`, `registry.ts`
- `server/routes/` — Thin Express controllers: `contacts.ts`, `interactions.ts`, `search.ts`, `aiSearch.ts`, `ai.ts`, `dedupe/`, `lists.ts`, `actionItems.ts`, `dashboard.ts`, `linkPreview.ts`, `mcp.ts`
- `server/services/` — Heavy business logic:
  - `contactService.ts`, `interactionService.ts`, `searchService.ts`, `listService.ts`, `actionItemService.ts`, `dashboardService.ts`, `relationshipService.ts`, `linkPreviewService.ts`, `mcpService.ts`, `zeroStateService.ts`
  - `server/services/dedupe/` — Multi-pass deduplication engine (14 files): `engine.ts`, `passes.ts`, `blocking.ts`, `scoring.ts`, `clustering.ts`, `merging.ts`, `suggestions.ts`, `embeddings.ts`, `normalization.ts`, `ai.ts`, `context.ts`, `jobQueue.ts`, `types.ts`, `index.ts`
  - `server/services/search/` — `hybridRetrieval.ts` (RRF pipeline), `localEmbeddings.ts` (Transformers.js)
  - `server/services/geocoding/` — Mapbox/Nominatim geocoding with retroactive backfill
  - `server/services/aiSearch/` — AI search enrichment: `jobQueue.ts`, `mergeEngine.ts`, `promptTemplate.ts`, `strategies/`, `types.ts`, `index.ts`
- `server/repositories/` — Data-access patterns: `contactRepository.ts`, `types.ts`
- `server/utils/` — Shared utilities: `AppError.ts`, `asyncHandler.ts`, `aiCache.ts`, `searchCache.ts`, `logger.ts`, `helpers.ts`, `validators.ts`, `avatarProcessor.ts`, `smartAvatar.ts`, `unionFind.ts`
  - `server/utils/nlp/` — NLP primitives: `names.ts`, `nicknames.ts`, `phonetics.ts` (Double Metaphone), `distances.ts` (Levenshtein, Jaro-Winkler), `company.ts`, `phone.ts`
- `server/db.ts` — Database initialization, FTS5 setup, triggers, virtual tables, performance PRAGMAs, data cleanup

### Frontend (`src/`)
- `src/api/` — Domain-separated React Query hooks: `contacts.ts`, `interactions.ts`, `search.ts`, `aiSearch.ts`, `dedupe.ts`, `lists.ts`, `actionItems.ts`, `dashboard.ts`, `enrichment.ts`, `suggestions.ts`, `index.ts`
- `src/hooks/` — Custom hooks: `useInstantSearch.ts`, `useQueryTokenizer.ts`, `useGlobalNavShortcuts.ts`, `useSearchHistory.ts`, `useRecentContacts.ts`, `useDebounce.ts`, `useDedupeSettings.ts`, `useFocusTrap.ts`, `useClickOutside.ts`, `useLongPress.ts`, `usePullToRefresh.ts`, `useScrollRestoration.ts`, `usePageTitle.ts`, `useCompanyLogo.ts`, `useUndoableAction.ts`
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
  - `SearchView.tsx`, `DashboardView.tsx`, `MapView.tsx`, `SettingsView.tsx`, `ArchivedContactsView.tsx`
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
- **LLM**: Google Gemini (6 registered models across lite/flash/pro × stable/preview). All calls routed through `server/ai/adapters/gemini.ts`.
- **Local Embeddings**: `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers` — 384-dim vectors for search.
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

| Model | Role | Cost (1M in / 1M out) | Context Window | Structured Output | Rate Limit (FREE) | Rate Limit (PAID) | Circuit Breaker Cost Cap |
|-------|------|----------------------|----------------|-------------------|-------------------|-------------------|--------------------------|
| `gemini-2.5-flash-lite` | Lite extraction, mentions, reranking, search expansion, daily insight | $0.075 / $0.40 | 1M tokens | Yes (JSON schema) | 10 RPM / 250K TPM / 500 RPD | 10K RPM / 10M TPM / ∞ RPD | $0.50/day |
| `gemini-2.5-flash` | Flash reasoning, EML summaries, general structured tasks | $0.15 / $2.50 | 1M tokens | Yes (JSON schema) | 2 RPM / 250K TPM / 20 RPD | 2K RPM / 3M TPM / 100K RPD | $2.00/day |
| `gemini-2.5-pro` | Pro — complex reasoning, AI search grounding (Pass 1) | $1.25 / $10.00 | 1M tokens | Yes (JSON schema) | 2 RPM / 4K TPM / 2 RPD | 1K RPM / 5M TPM / 50K RPD | $5.00/day |
| `gemini-3.1-flash-lite-preview` | Preview lite — overflow capacity (PAID only) | $0.075 / $1.50 | 1M tokens | Yes (JSON schema) | N/A (paid only) | 10K RPM / 10M TPM / 350K RPD | $1.50/day |
| `gemini-3-flash-preview` | Preview flash — overflow capacity (PAID only) | $0.15 / $3.00 | 1M tokens | Yes (JSON schema) | N/A (paid only) | 2K RPM / 3M TPM / 100K RPD | $3.00/day |
| `gemini-3.1-pro-preview` | Preview pro — overflow capacity (PAID only) | $1.25 / $12.00 | 1M tokens | Yes (JSON schema) | N/A (paid only) | 1K RPM / 5M TPM / 50K RPD | $6.00/day |
| `Xenova/all-MiniLM-L6-v2` | Local 384-dim embeddings for hybrid search (Transformers.js) | Free (local) | 256 tokens | N/A (embedding) | N/A (local) | N/A (local) | $0 |

_Grounding RPD is a shared pool: 500 RPD (FREE) / 5,000 RPD (PAID) across all models._

## 6. Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `GEMINI_API_KEY` | Yes (for AI features) | — | Google Gemini API key. AI features degrade gracefully with mock responses if missing. |
| `AI_TIER` | No | `FREE` | Controls rate limit profiles: `FREE` (conservative ~10 RPM) or `PAID` (aggressive 10K+ RPM, includes preview models). |
| `AI_PROVIDER` | No | `gemini` | LLM provider adapter selection. Currently only `gemini` supported. |
| `MAPBOX_API_KEY` | No | — | Enables Mapbox as primary geocoder (falls back to Nominatim if missing). |
| `PORT` | No | `3000` | Server port. |
| `APP_URL` | No | — | Self-referential URL for OAuth/links (injected by AI Studio). |
| `NODE_ENV` | No | — | When `production`, serves static `dist/` and uses `morgan` short format. |
| `DISABLE_HMR` | No | — | Set to `true` to disable Vite HMR (used in AI Studio to prevent flickering). |

## 7. Invariants & Safety Rules
- **NEVER** write native `useEffect` fetch loops for data operations. Rely solely on `@tanstack/react-query`.
- **NEVER** silently swallow errors (`.catch(() => {})`).
- **MUST** manually purge `search_embeddings` and `contact_embeddings` on contact deletion/merge.
- **MUST** route all AI calls through the `ai` singleton exported from `server/ai/index.ts`. Never import `@google/genai` directly.
- **Local-First Mandate**: External relational database usage is forbidden. All data lives in `curator.db`.
- **Thin Routes / Heavy Services**: Express routes parse payloads and delegate. Business logic lives in `server/services/`.

## 8. Error Handling
- **Request Tracing**: Every request gets a UUID-prefix via middleware (`crypto.randomUUID().split("-")[0]`).
- **`asyncHandler`**: Higher-order function wrapping async route handlers to forward errors to Express error middleware.
- **`AppError`**: Custom error class with `statusCode`, `message`, and `isOperational` flag. Operational errors are logged at appropriate level; unexpected errors log full stack traces.
- **Centralized Error Middleware**: Handles `AppError`, `entity.parse.failed` (400), `SQLITE_CONSTRAINT` (400), `SQLITE_BUSY` (503), and generic 500s. Stack traces hidden in production.
- **Client Error Boundaries**: `ErrorBoundary` (global) and `RouteErrorBoundary` (per-route) catch rendering crashes with recovery UI.

## 9. Startup Lifecycle (`server.ts`)
1. Load environment variables (`dotenv/config`)
2. Validate `GEMINI_API_KEY` (warn if missing)
3. Initialize Express with CORS, JSON parsing (50MB limit), request ID middleware, Morgan logging
4. Mount all API routers
5. Cache diagnostics endpoint (dev only: `/api/debug/cache-stats`)
6. Attach Vite dev middleware (dev) or serve static `dist/` (production)
7. Install centralized error handler
8. Start HTTP server on `PORT` (default 3000)
9. **Background tasks** (non-blocking):
   - `startRetroactiveGeocoding()` — backfill missing lat/lng
   - `relationshipService.recomputeAll()` — full score recompute, then hourly via `setInterval`
   - `initLocalEmbeddings()` → `backfillSearchEmbeddings()` — load Transformers.js model, backfill 384-dim vectors
   - `backfillEmbeddings()` — backfill 768-dim Gemini dedupe embeddings (only if count === 0)

## 10. Development Lifecycle
- **Install**: `npm install`
- **Boot**: `npm run dev` (Vite middleware + Express on `:3000`)
- **Build**: `npm run build` (Vite production build to `dist/`)
- **Database Seed**: `npm run seed` (resets data, recreates schemas, provides fixture data)
- **Migrations**: `npm run db:generate` (outputs Drizzle migration)
- **Type Check**: `npm run lint` (`tsc --noEmit`)
- **Test**: `npm test` (Vitest in watch mode) / `npx vitest run` (single-run)
- **Requirements**: `GEMINI_API_KEY` in `.env` (copy from `.env.example`)

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

