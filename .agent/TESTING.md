# Testing Strategy & Results

_This file tracks test methods, scenarios, and results with concrete execution evidence. Bugs found here block the release of a feature. Agents must update this during the Test and Fix phases._

## 0. Local Development Setup

### Prerequisites

- Node.js 22+
- Valid `GEMINI_API_KEY` mapping in `.env` (copy from `.env.example`). AI features degrade gracefully if missing.

### Initialization

1. Install dependencies: `npm install`.
2. Generate schema migrations (if needed): `npm run db:generate`.
3. Generate synthetic data: `npm run seed`. This clears raw SQL instances, recreates schemas via explicit Drizzle migrations, and provides controlled fixture nodes.
4. Start the dev server: `npm run dev` (Express + Vite middleware on `:3000`).

## 1. Test Architecture

### Framework & Configuration

- **Runner**: Vitest 4.x (imported from `vitest/config`)
- **Environment**: Node (not jsdom — backend-focused tests)
- **Globals**: `true` (describe/it/expect available without imports)
- **Coverage**: V8 provider with `text`, `json`, `html` reporters (see `vitest.config.ts`)

### Two vitest projects (vitest.config.ts)

| Project       | Include                | Database                                                                                  | Setup file                   |
| ------------- | ---------------------- | ----------------------------------------------------------------------------------------- | ---------------------------- |
| `unit`        | `tests/unit/**`        | **Mocked** — `tests/setup.ts` stubs `server/db.ts`                                        | `tests/setup.ts`             |
| `integration` | `tests/integration/**` | **Real SQLite** in a per-file temp `DATA_DIR` (migrations, FTS triggers, indexes all run) | `tests/integration-setup.ts` |

Integration tests mount the production request pipeline via `createApp()`
(`server/app.ts`) with supertest — no port, no Vite. `tests/integration-setup.ts`
sets `DATA_DIR` to a fresh temp dir BEFORE any server module is imported,
clears all AI keys (mock mode), and sets `DISABLE_BACKGROUND_JOBS=true`
(suppresses geocode fetches and debounced dedupe timers; the same env var is
honored in production code). Run one project with
`npx vitest run --project integration`.

Integration suites cover: contact CRUD + validation envelopes, FTS
create/rename/child-table triggers, bulk create/delete, interactions +
@mention linking (`interaction_mentions`), action items + the
`nextFollowUpAt` triggers, lists + membership, hard-merge (409 undo
contract) and soft-merge → audit log → undo, dashboard/zero-state/MCP.

### Test Setup Mock Pattern (`tests/setup.ts`)

The global setup file mocks the database module to prevent any test from accidentally writing to `curator.db`:

```typescript
vi.mock("../server/db.ts", () => ({
  sqlite: {
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() })),
    exec: vi.fn(),
    transaction: vi.fn((cb) => cb),
  },
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));
```

**Critical**: Any new test that imports from `server/db.ts` will automatically receive this mock. Tests requiring real database operations must use a dedicated test database fixture.

### Test File Inventory

#### Unit Tests (`tests/unit/`)

| File                     | Lines | Purpose                                                                                                                                                                                                                               |
| ------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routing.test.ts`        | 492   | SmartRouter 3-pass algorithm: model selection, circuit breakers, tier filtering, paid spillover, preference sorting, capacity exhaustion                                                                                              |
| `multi-provider.test.ts` | ~550  | Multi-provider AI contracts: adapter compliance (OpenAI, Anthropic), singleton factory, strategy selection, type safety, env validation                                                                                               |
| `resilience.test.ts`     | ~330  | Shared AI resilience: `withTimeout` (deadline + parent-abort), `withRetry` (jittered backoff, classifier, AppError conversion), `parseAIJson` (fences, prose, balanced-bracket recovery), `isRetryableError` (HTTP / ECONN / keyword) |
| `appError.test.ts`       | ~120  | AppError contract: status mapping, default codes, named subclasses (NotFound/Validation/Conflict/RateLimited/ServiceUnavailable/UpstreamTimeout)                                                                                      |
| `errorHandler.test.ts`   | ~245  | Central middleware: AppError translation, ZodError, Express parse errors, SQLite codes, stack stripping in production, headers-sent safety, notFoundHandler for /api/\*                                                               |
| `search.test.ts`         | 121   | Search pipeline: query tokenization, RRF fusion math, FTS5 query building                                                                                                                                                             |
| `nlp.names.test.ts`      | 47    | Name parsing: split first/last, handle suffixes, multi-word names                                                                                                                                                                     |
| `nlp.distances.test.ts`  | 47    | String distance metrics: Levenshtein, Jaro-Winkler, normalized similarity                                                                                                                                                             |
| `nlp.phonetics.test.ts`  | 26    | Double Metaphone: phonetic encoding for blocking passes                                                                                                                                                                               |
| `nlp.company.test.ts`    | 22    | Company name normalization: strip suffixes (Inc, LLC, Corp), abbreviation expansion                                                                                                                                                   |

#### Integration Tests (`tests/integration/`)

| File                | Lines | Purpose                                                              |
| ------------------- | ----- | -------------------------------------------------------------------- |
| `dedupe.test.ts`    | 15    | Deduplication engine: blocking pass output, merge conflict detection |
| `geocoding.test.ts` | 16    | Geocoding service: Mapbox/Nominatim fallback, coordinate validation  |

**Current count**: 180 tests across 12 files, full suite <600ms.

### AI Mock Requirements

Tests targeting AI integrations **MUST**:

- Inject a mocked `SmartRouter` / `aiService` rather than emitting expensive production tokens.
- Use the `isMockMode()` pattern already established in `aiService.ts` — every AI function checks `isProviderConfigured` and returns realistic mock data when the API key is absent.
- Never rely on network calls in CI — all AI functions have mock fallbacks baked in.

## 2. Test Execution Commands

| Command                     | Purpose               | Mode                                                        |
| --------------------------- | --------------------- | ----------------------------------------------------------- |
| `npm test`                  | Standard run          | Watch mode (re-runs on file changes)                        |
| `npx vitest run`            | Single-run validation | Parallel execution, CI-friendly                             |
| `npx vitest run --coverage` | Coverage report       | Generates `text`, `json`, `html` reports                    |
| `npm run lint`              | TypeScript integrity  | `tsc --noEmit` — ensures strict type checking passes        |
| `npm run build`             | Production build      | Vite build — validates all imports resolve and JSX compiles |

## 3. Execution Evidence Rules

_Never mark a test as PASS without evidence._

- Automate outputs via raw pasting of `npx vitest run` block completions.
- Submit `npm run lint` metrics as proof of stable compilation.
- "PASS" declarations absent execution artifacts must be designated as UNTESTED blocks.

---

## 4. Current Test Coverage Map

### Well-Covered Domains

| Domain                      | Test Files                                             | Coverage Notes                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AI Routing (SmartRouter)    | `routing.test.ts` (492 lines)                          | Thorough: tier filtering, circuit breakers, overflow, preference sorting, capacity limits                                                                                                  |
| AI Resilience Primitives    | `resilience.test.ts` (35 tests)                        | `withTimeout` / `withRetry` / `parseAIJson` / `isRetryableError` — covers transient classification, abort propagation, error-type conversion, JSON fence stripping, prose-wrapped recovery |
| Error Handling Contracts    | `appError.test.ts` + `errorHandler.test.ts` (32 tests) | AppError subclass shapes + central middleware translation for AppError / ZodError / express parse / SQLite codes + headers-sent safety                                                     |
| Multi-Provider AI Contracts | `multi-provider.test.ts` (~52 tests)                   | Adapter contracts, singleton factory, strategy selection, env contracts, SDK import containment                                                                                            |
| NLP Primitives              | 4 files (142 lines total)                              | Core algorithms: names, phonetics, distances, company normalization                                                                                                                        |
| Search Pipeline             | `search.test.ts` (121 lines)                           | Query parsing, RRF math, FTS5 query construction                                                                                                                                           |

### Under-Covered Domains (Testing Debt)

| Domain                                    | Current State      | Recommended Action                                                                                      |
| ----------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------- |
| Contact CRUD (routes/services)            | No dedicated tests | Add integration tests: create, update, delete with cascade verification                                 |
| Interaction creation + mention extraction | No tests           | Add unit tests for `interactionService.ts` mention parsing flow                                         |
| Dedupe engine (multi-pass)                | Minimal (15 lines) | Expand: test each pass independently (email, phone, name, phonetic, embedding, AI)                      |
| Action items + sync triggers              | No tests           | Add integration test verifying `nextFollowUpAt` trigger sync                                            |
| Import pipeline (CSV/LinkedIn/Apple)      | No tests           | Add unit tests for `src/lib/importers.ts` parsing                                                       |
| List management                           | No tests           | Add CRUD tests for `listService.ts`                                                                     |
| AI Search enrichment                      | No tests           | Add mock-based tests for `server/services/aiSearch/`                                                    |
| AI Stats service                          | No tests           | Add unit tests for `server/services/aiStatsService.ts` — recordInvocation, getSummary, getFeed, cleanup |
| Frontend components                       | No tests           | Consider React Testing Library for critical components (CommandPalette, ContactList, AIStatsView)       |

---

## Backend Route Coverage Matrix

_Populated by the SDET during the Trap phase. One row per API endpoint._

| Endpoint                                | Method    | 200 OK | 400 Bad Req | 401/403 Auth | 404 Not Found | Idempotent | Edge Cases |
| --------------------------------------- | --------- | ------ | ----------- | ------------ | ------------- | ---------- | ---------- |
| `/api/contacts`                         | GET       |        |             |              |               |            |            |
| `/api/contacts`                         | POST      |        |             |              |               |            |            |
| `/api/contacts/:id`                     | GET       |        |             |              |               |            |            |
| `/api/contacts/:id`                     | PUT       |        |             |              |               |            |            |
| `/api/contacts/:id`                     | PATCH     |        |             |              |               |            |            |
| `/api/contacts/:id`                     | DELETE    |        |             |              |               |            |            |
| `/api/contacts/map`                     | GET       |        |             |              |               |            |            |
| `/api/contacts/archived`                | GET       |        |             |              |               |            |            |
| `/api/contacts/bulk`                    | POST      |        |             |              |               |            |            |
| `/api/contacts/bulk-delete`             | POST      |        |             |              |               |            |            |
| `/api/contacts/bulk-update`             | PUT       |        |             |              |               |            |            |
| `/api/contacts/:id/avatar`              | POST      |        |             |              |               |            |            |
| `/api/contacts/:id/enrich`              | POST      |        |             |              |               |            |            |
| `/api/contacts/:id/timeline`            | GET       |        |             |              |               |            |            |
| `/api/contacts/:id/interactions`        | POST      |        |             |              |               |            |            |
| `/api/contacts/:id/briefing`            | POST      |        |             |              |               |            |            |
| `/api/contacts/:id/promote`             | POST      |        |             |              |               |            |            |
| `/api/contacts/:id/attachments`         | POST      |        |             |              |               |            |            |
| `/api/contacts/:id/relationships`       | GET       |        |             |              |               |            |            |
| `/api/interactions/:id`                 | PATCH     |        |             |              |               |            |            |
| `/api/interactions/:id`                 | DELETE    |        |             |              |               |            |            |
| `/api/search/`                          | GET       |        |             |              |               |            |            |
| `/api/search/semantic`                  | POST      |        |             |              |               |            |            |
| `/api/search/synthesize`                | POST      |        |             |              |               |            |            |
| `/api/ai-search`                        | POST      |        |             |              |               |            |            |
| `/api/ai-search/status`                 | GET       |        |             |              |               |            |            |
| `/api/ai-search/stream`                 | GET (SSE) |        |             |              |               |            |            |
| `/api/ai/diagnostics`                   | GET       |        |             |              |               |            |            |
| `/api/ai/grounding-capacity`            | GET       |        |             |              |               |            |            |
| `/api/ai/stats/summary`                 | GET       |        |             |              |               |            |            |
| `/api/ai/stats/feed`                    | GET       |        |             |              |               |            |            |
| `/api/dashboard`                        | GET       |        |             |              |               |            |            |
| `/api/dashboard/insight`                | GET       |        |             |              |               |            |            |
| `/api/command-palette/zero-state`       | GET       |        |             |              |               |            |            |
| `/api/action-items`                     | GET       |        |             |              |               |            |            |
| `/api/action-items/completed`           | GET       |        |             |              |               |            |            |
| `/api/action-items/count`               | GET       |        |             |              |               |            |            |
| `/api/action-items/:id`                 | PATCH     |        |             |              |               |            |            |
| `/api/action-items/:id/complete`        | PATCH     |        |             |              |               |            |            |
| `/api/action-items/:id`                 | DELETE    |        |             |              |               |            |            |
| `/api/contacts/:id/action-items`        | GET       |        |             |              |               |            |            |
| `/api/contacts/:id/action-items`        | POST      |        |             |              |               |            |            |
| `/api/lists/`                           | GET       |        |             |              |               |            |            |
| `/api/lists/`                           | POST      |        |             |              |               |            |            |
| `/api/lists/reorder`                    | PUT       |        |             |              |               |            |            |
| `/api/lists/:id`                        | PATCH     |        |             |              |               |            |            |
| `/api/lists/:id/contacts`               | GET       |        |             |              |               |            |            |
| `/api/lists/:id`                        | DELETE    |        |             |              |               |            |            |
| `/api/lists/:id/members`                | POST      |        |             |              |               |            |            |
| `/api/lists/:id/members/:contactId`     | DELETE    |        |             |              |               |            |            |
| `/api/lists/:id/members/bulk`           | POST      |        |             |              |               |            |            |
| `/api/link-preview/unfurl`              | GET       |        |             |              |               |            |            |
| `/api/parse-contact`                    | POST      |        |             |              |               |            |            |
| `/api/dedupe/scan`                      | POST      |        |             |              |               |            |            |
| `/api/dedupe/stream`                    | GET (SSE) |        |             |              |               |            |            |
| `/api/dedupe/active`                    | GET       |        |             |              |               |            |            |
| `/api/dedupe/status`                    | GET       |        |             |              |               |            |            |
| `/api/dedupe/suggestions`               | GET       |        |             |              |               |            |            |
| `/api/dedupe/suggestions/count`         | GET       |        |             |              |               |            |            |
| `/api/dedupe/suggestion-for/:contactId` | GET       |        |             |              |               |            |            |
| `/api/dedupe/suggestions/:id/dismiss`   | POST      |        |             |              |               |            |            |
| `/api/dedupe/suggestions/:id/merge`     | POST      |        |             |              |               |            |            |
| `/api/dedupe/merge-log`                 | GET       |        |             |              |               |            |            |
| `/api/dedupe/merge-log/:id/undo`        | POST      |        |             |              |               |            |            |
| `/api/dedupe/backfill-embeddings`       | POST      |        |             |              |               |            |            |
| `/api/dedupe/embedding-status`          | GET       |        |             |              |               |            |            |
| `/api/contacts/merge`                   | POST      |        |             |              |               |            |            |
| `/api/contacts/merge-batch`             | POST      |        |             |              |               |            |            |
| `/api/contacts/merge-cluster`           | POST      |        |             |              |               |            |            |
| `/api/contacts/merge-clusters`          | POST      |        |             |              |               |            |            |
| `/api/query/contacts` (MCP)             | GET       |        |             |              |               |            |            |
| `/api/contacts/action-items` (MCP)      | GET       |        |             |              |               |            |            |
| `/api/tags` (MCP)                       | GET       |        |             |              |               |            |            |
| `/api/industries` (MCP)                 | GET       |        |             |              |               |            |            |
| `/api/interactions/search` (MCP)        | GET       |        |             |              |               |            |            |
| `/api/timeline` (MCP)                   | GET       |        |             |              |               |            |            |
| `/api/logos/:domain`                    | GET       |        |             |              |               |            |            |

---

## Frontend Component State Matrix

_Populated by the SDET during the Trap phase. Every interactive component must be tested across all visual states._

| Component                             | Empty | Loading | Success | Error | Partial |
| ------------------------------------- | ----- | ------- | ------- | ----- | ------- |
| `CommandPalette` (cmdk)               |       |         |         |       |         |
| `FacetAutocomplete`                   |       |         |         |       |         |
| `FacetPills`                          |       |         |         |       |         |
| `ResultPeek`                          |       |         |         |       |         |
| `SynthesisBar`                        |       |         |         |       |         |
| `ZeroStateView`                       |       |         |         |       |         |
| `ContactList` (contact-list view)     |       |         |         |       |         |
| `ContactDetail` (contact-detail view) |       |         |         |       |         |
| `SearchView`                          |       |         |         |       |         |
| `DashboardView`                       |       |         |         |       |         |
| `MapView`                             |       |         |         |       |         |
| `SettingsView`                        |       |         |         |       |         |
| `ArchivedContactsView`                |       |         |         |       |         |
| `AISearchView` (ai-search view)       |       |         |         |       |         |
| `AIStatsView` (ai-stats view)         |       |         |         |       |         |
| `DedupeView` (dedupe view)            |       |         |         |       |         |
| `ListDetailView` (lists view)         |       |         |         |       |         |
| `ImportModal`                         |       |         |         |       |         |
| `QuickInteractionModal`               |       |         |         |       |         |
| `RichInteractionComposer`             |       |         |         |       |         |
| `AvatarPickerModal`                   |       |         |         |       |         |
| `BulkEditFieldModal`                  |       |         |         |       |         |
| `KeyboardShortcutsModal`              |       |         |         |       |         |
| `FloatingContactCard`                 |       |         |         |       |         |
| `HealthRingAvatar`                    |       |         |         |       |         |
| `LocalTimeWeather`                    |       |         |         |       |         |
| `Sidebar`                             |       |         |         |       |         |
| `EmptyState`                          |       |         |         |       |         |
| `ErrorBoundary`                       |       |         |         |       |         |
| `Modal`                               |       |         |         |       |         |
| `ContextMenu`                         |       |         |         |       |         |
| `Combobox`                            |       |         |         |       |         |
| `AnimatedSkeleton`                    |       |         |         |       |         |

---

## ML / AI Evaluation Thresholds

_Populated by the ML Engineer during the Build phase. Track AI feature quality metrics._

| Metric                                | Target                 | Current | Method                                                                              | Eval Set | Prompt Ver.                   | Last Run |
| ------------------------------------- | ---------------------- | ------- | ----------------------------------------------------------------------------------- | -------- | ----------------------------- | -------- |
| Search Relevance (Reranker Precision) | ≥90%                   | —       | Manual review of reranker output vs query intent                                    | N/A      | v1.0 (`aiService.ts:422`)     | —        |
| Search Relevance (RRF Recall@10)      | ≥80%                   | —       | Measure how often correct contact appears in top-10 hybrid results                  | N/A      | N/A (algorithmic)             | —        |
| AI Dossier Accuracy (Two-Pass)        | ≥85% field correctness | —       | Compare AI Search output fields against known ground truth contacts                 | N/A      | v1.0 (`promptTemplate.ts:31`) | —        |
| AI Dossier Hallucination Rate         | ≤5%                    | —       | Spot-check AI-generated fields (social links, education, experience) against source | N/A      | v1.0 (`promptTemplate.ts:31`) | —        |
| Mention Extraction Precision          | ≥95%                   | —       | Compare extracted mentions against manually tagged interaction notes                | N/A      | v1.0 (`aiService.ts:280`)     | —        |
| Catch-Me-Up Briefing Relevance        | ≥85%                   | —       | Human rating of briefing bullet point grounding in actual interaction data          | N/A      | v1.0 (`aiService.ts:213`)     | —        |
| Contact Parse Accuracy                | ≥90%                   | —       | Compare parsed contact fields against original unstructured text                    | N/A      | v1.0 (`aiService.ts:84`)      | —        |
| Search Expansion Quality              | ≥80% term relevance    | —       | Human review of Doc2Query expansion terms vs contact profile                        | N/A      | v1.0 (`aiService.ts:680`)     | —        |
| Synthesis Brief Quality               | ≥85%                   | —       | Human rating of executive brief accuracy and completeness                           | N/A      | v1.0 (`aiService.ts:748`)     | —        |

### Eval / Holdout Boundary

- **eval_set**: No eval set configured yet
- **holdout_set**: No holdout set configured yet — HUMAN-ONLY when created

## 5. Bugs Found (Fix Phase Queue)

_List specific bugs discovered during testing._

1. None

---

## 6. Regression Scenarios (Persistent)

| Scenario                       | Last Verified | Notes                                                                                                                     |
| ------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| _Type Check Passes_            | 2026-05-14    | `npm run lint` yields 0 new errors                                                                                        |
| _Vitest Suite Passes_          | 2026-05-14    | `npx vitest run` passes all 180 tests across 12 test files                                                                |
| _AI Adapter Retry Contract_    | 2026-05-14    | `resilience.test.ts` covers 5xx/429 → typed AppError conversion and abort propagation                                     |
| _Error Middleware Translation_ | 2026-05-14    | `errorHandler.test.ts` covers AppError / ZodError / express parse / SQLite codes; stack stripped in `NODE_ENV=production` |
| _Production Build Succeeds_    | 2026-04-14    | `npm run build` completes without errors (3195 modules)                                                                   |
| _Vec0 Deletion Safety_         | _YYYY-MM-DD_  | Contact deletion explicitly purges `search_embeddings` and `contact_embeddings`                                           |
| _FTS5 Trigger Consistency_     | _YYYY-MM-DD_  | All 12 FTS triggers fire correctly on child-table mutations                                                               |
| _AI Stats Summary Empty State_ | 2026-04-14    | `GET /api/ai/stats/summary` returns zeros with no invocations (not nulls)                                                 |
| _AI Stats Feed Validation_     | 2026-04-14    | `GET /api/ai/stats/feed?operation=invalid_op` returns 400 with descriptive error                                          |

### Frontend Component State Matrix

| Component                 | Loading | Empty | Error | Populated | Offline |
| ------------------------- | ------- | ----- | ----- | --------- | ------- |
| _Fill in your components_ |         |       |       |           |         |

### Backend Route Coverage

| Route                 | Method | Auth | Contract Test | Integration Test |
| --------------------- | ------ | ---- | ------------- | ---------------- |
| _Fill in your routes_ |        |      |               |                  |

### ML/AI Evaluation Thresholds

| Metric                 | Baseline | Target | Current | Status |
| ---------------------- | -------- | ------ | ------- | ------ |
| _Fill in your metrics_ |          |        |         |        |
