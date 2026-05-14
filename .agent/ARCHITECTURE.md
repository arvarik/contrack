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
- **AI Provider**: Multi-provider — Google Gemini via `@google/genai` (default), OpenAI via `openai`, Anthropic via `@anthropic-ai/sdk`. Selected at startup via `AI_PROVIDER` env var. Local embeddings via `@huggingface/transformers` (Transformers.js).
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
6. **Optional LLM Reranker**: `rerankCandidates()` in `aiService.ts` uses the active AI provider to filter false positives from ~30 pre-screened candidates.
7. **Two-Phase NDJSON Streaming**: Instant UI feedback from local retrieval (<15ms), followed by enriched backend resolution.

### AI Adapter Pipeline
All AI operations route through a layered architecture in `server/ai/`:
- **`provider.ts`**: Abstract `AIProvider` interface — the single contract all adapters implement. Methods: `generate(options)` (required), `getQuotaSnapshot()` (optional, Gemini-only).
- **`aiService.ts`**: Provider-agnostic business logic facade. Exports: `parseContactRecord`, `generateCatchMeUpBriefing`, `extractMentions`, `summarizeEmlEmail`, `rerankCandidates`, `generateDailyInsight`, `bulkParseContacts`, `generateSearchExpansion`, `synthesizeSearchResults`. **Never imports any SDK directly.**
- **`singleton.ts`**: Provider factory — resolves the active `AIProvider` instance based on `AI_PROVIDER` env var. Supports `"gemini"` (default), `"openai"`, and `"anthropic"`. Ensures one shared instance across the entire application.
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
  | `prefer` | Gemini | OpenAI | Anthropic |
  |----------|--------|--------|-----------|
  | `"lite"` | `gemini-2.5-flash-lite` | `gpt-4o-mini` | `claude-haiku-4.5` |
  | `"flash"` | `gemini-2.5-flash` | `gpt-5.4-mini` | `claude-sonnet-4.6` |
  | `"pro"` | `gemini-2.5-pro` | `gpt-5.4` | `claude-opus-4.6` |

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
- **LLM Providers** (selected via `AI_PROVIDER` env var):
  - **Gemini** (default): 6 registered models via `@google/genai`. Full SmartRouter + QuotaTracker + circuit breakers. Includes Google Search grounding and embedding models.
  - **OpenAI**: `gpt-4o-mini`, `gpt-5.4-mini`, `gpt-5.4` via `openai` npm package. Web search via Responses API. Structured output via `response_format: json_schema`.
  - **Anthropic**: `claude-haiku-4.5`, `claude-sonnet-4.6`, `claude-opus-4.6` via `@anthropic-ai/sdk`. Web search via native `web_search` tool. Structured output via `output_config.format: json_schema`.
- **Dedupe Embeddings**: `gemini-embedding-2-preview` via `@google/genai` (Gemini-only, uses `GEMINI_API_KEY` regardless of active `AI_PROVIDER`). Degrades to deterministic-only matching when unavailable.
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

#### Gemini Models (AI_PROVIDER="gemini")

| Model | Role | Cost (1M in / 1M out) | Context Window | Structured Output | Rate Limit (FREE) | Rate Limit (PAID) | Circuit Breaker Cost Cap |
|-------|------|----------------------|----------------|-------------------|-------------------|-------------------|--------------------------|
| `gemini-2.5-flash-lite` | Lite extraction, mentions, reranking, search expansion, daily insight | $0.075 / $0.40 | 1M tokens | Yes (JSON schema) | 10 RPM / 250K TPM / 500 RPD | 10K RPM / 10M TPM / ∞ RPD | $0.50/day |
| `gemini-2.5-flash` | Flash reasoning, EML summaries, general structured tasks | $0.15 / $2.50 | 1M tokens | Yes (JSON schema) | 2 RPM / 250K TPM / 20 RPD | 2K RPM / 3M TPM / 100K RPD | $2.00/day |
| `gemini-2.5-pro` | Pro — complex reasoning, AI search grounding (Pass 1) | $1.25 / $10.00 | 1M tokens | Yes (JSON schema) | 2 RPM / 4K TPM / 2 RPD | 1K RPM / 5M TPM / 50K RPD | $5.00/day |
| `gemini-3.1-flash-lite-preview` | Preview lite — overflow capacity (PAID only) | $0.075 / $1.50 | 1M tokens | Yes (JSON schema) | N/A (paid only) | 10K RPM / 10M TPM / 350K RPD | $1.50/day |
| `gemini-3-flash-preview` | Preview flash — overflow capacity (PAID only) | $0.15 / $3.00 | 1M tokens | Yes (JSON schema) | N/A (paid only) | 2K RPM / 3M TPM / 100K RPD | $3.00/day |
| `gemini-3.1-pro-preview` | Preview pro — overflow capacity (PAID only) | $1.25 / $12.00 | 1M tokens | Yes (JSON schema) | N/A (paid only) | 1K RPM / 5M TPM / 50K RPD | $6.00/day |

_Grounding RPD is a shared pool: 500 RPD (FREE) / 5,000 RPD (PAID) across all Gemini models._

#### OpenAI Models (AI_PROVIDER="openai")

| Model | Class | Cost (1M in / 1M out) | Context Window | Structured Output | Web Search | Notes |
|-------|-------|----------------------|----------------|-------------------|------------|-------|
| `gpt-4o-mini` | lite | $0.15 / $0.60 | 128K tokens | Yes (`json_schema`) | Yes (Responses API) | Cheapest, default for lite tasks |
| `gpt-5.4-mini` | flash | $0.75 / $4.50 | 400K tokens | Yes (`json_schema`) | Yes (Responses API) | Balanced price/quality |
| `gpt-5.4` | pro | $2.50 / $15.00 | 1.05M tokens | Yes (`json_schema`) | Yes (Responses API) | Flagship reasoning |

_No free tier. Prepaid billing required (~$5 starter credits for new accounts). Rate limits are dynamic based on account spend tier._

#### Anthropic Models (AI_PROVIDER="anthropic")

| Model | Class | Cost (1M in / 1M out) | Context Window | Structured Output | Web Search | Notes |
|-------|-------|----------------------|----------------|-------------------|------------|-------|
| `claude-haiku-4.5` | lite | $1.00 / $5.00 | 200K tokens | Yes (`json_schema`) | Yes (native tool) | Cheapest, default for lite tasks |
| `claude-sonnet-4.6` | flash | $3.00 / $15.00 | 200K tokens | Yes (`json_schema`) | Yes (native tool) | Balanced coding/agents |
| `claude-opus-4.6` | pro | $5.00 / $25.00 | 200K tokens | Yes (`json_schema`) | Yes (native tool) | Flagship reasoning |

_No free tier. Prepaid billing required (~$5 starter credits for new accounts). Rate limits based on 4-tier spend system. No first-party embedding models._

#### Local Models (Provider-Agnostic)

| Model | Role | Cost | Dimensions | Notes |
|-------|------|------|------------|-------|
| `Xenova/all-MiniLM-L6-v2` | Search embeddings (Transformers.js) | Free (local) | 384-dim | Powers KNN in Spotlight. Runs regardless of AI_PROVIDER. |

## 6. Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `AI_PROVIDER` | No | `gemini` | LLM provider adapter selection. Supported: `"gemini"`, `"openai"`, `"anthropic"`. |
| `GEMINI_API_KEY` | When `AI_PROVIDER=gemini` | — | Google Gemini API key. Also used for dedupe embeddings regardless of active provider. |
| `OPENAI_API_KEY` | When `AI_PROVIDER=openai` | — | OpenAI API key. Prepaid billing required. |
| `ANTHROPIC_API_KEY` | When `AI_PROVIDER=anthropic` | — | Anthropic Claude API key. Prepaid billing required. |
| `AI_TIER` | No | `FREE` | **Gemini only.** Controls SmartRouter rate limit profiles: `FREE` (~10 RPM) or `PAID` (10K+ RPM, preview models). Has no effect on OpenAI/Anthropic. |
| `MAPBOX_API_KEY` | No | — | Enables Mapbox as primary geocoder (falls back to Nominatim if missing). |
| `PORT` | No | `3000` | Server port. |
| `APP_URL` | No | — | Self-referential URL for OAuth/links (injected by AI Studio). |
| `NODE_ENV` | No | — | When `production`, serves static `dist/` and uses `morgan` short format. |
| `DISABLE_HMR` | No | — | Set to `true` to disable Vite HMR (used in AI Studio to prevent flickering). |

## 7. Invariants & Safety Rules
- **NEVER** write native `useEffect` fetch loops for data operations. Rely solely on `@tanstack/react-query`.
- **NEVER** silently swallow errors (`.catch(() => {})`).
- **MUST** manually purge `search_embeddings` and `contact_embeddings` on contact deletion/merge.
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

| Class | Status | `code` | Use when… |
|-------|--------|--------|-----------|
| `AppError` | configurable | derived from status | The catch-all — only for cases no subclass fits |
| `NotFoundError(entity, id?)` | 404 | `NOT_FOUND` | An entity wasn't found |
| `ValidationError(message, details)` | 400 | `VALIDATION_ERROR` | Inbound payload failed validation (carries Zod issues) |
| `ConflictError` | 409 | `CONFLICT` | Resource already exists / state conflict |
| `RateLimitedError` | 429 | `RATE_LIMITED` | Upstream or local rate limit hit |
| `ServiceUnavailableError` | 503 | `SERVICE_UNAVAILABLE` | Dependency is down (e.g. AI provider after retries) |
| `UpstreamTimeoutError` | 504 | `UPSTREAM_TIMEOUT` | A bounded upstream call exceeded its timeout |

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
Tolerant JSON parser for model output. Strips markdown code fences (```json … ```), trims surrounding whitespace, and falls back to extracting the first balanced `{...}` or `[...]` block when models wrap JSON in prose. On unrecoverable input, throws `AppError(502, "AI_INVALID_JSON")` with a snippet of the offending response — clients can branch on that code to substitute a default or retry.

### Adapter integration
All three adapters (`server/ai/adapters/{gemini,openai,anthropic}.ts`) share the same shape:

```ts
return withRetry(async (attempt) => {
  const result = await withTimeout(
    (signal) => this.client.someMethod(params, { signal }),
    timeoutMs,
    options.signal,
  );
  if (options.responseFormat === "json") parseAIJson(result.text, "ProviderAdapter.generate(...)");
  return result;
}, {
  signal: options.signal,
  onRetry: (attempt, err) => log.warn("ProviderAdapter", `attempt ${attempt} failed: ${getErrorMessage(err)}`),
});
```

### Transactional Data Integrity
- `ContactRepository.insertChildRecords` runs all child-table inserts inside a single `sqlite.transaction()` — if any insert fails the entire contact write is rolled back.
- `mergeContacts` and `softMergeContacts` in `server/services/dedupe/merging.ts` re-fetch contact data **inside** the transaction (to mitigate TOCTOU) and write the audit log via `recordMergeUnsafe` **inside** the same transaction — there is no longer a window where a merge succeeds but the audit log doesn't.

## 9. Startup Lifecycle (`server.ts`)
1. Load environment variables (`dotenv/config`)
2. Validate active provider's API key based on `AI_PROVIDER` (warn if missing)
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
- **Requirements**: Set `AI_PROVIDER` and the corresponding API key (`GEMINI_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`) in `.env` (copy from `.env.example`)

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

