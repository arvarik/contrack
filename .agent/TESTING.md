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
- **Setup File**: `tests/setup.ts` — mocks `server/db.ts` to prevent disk writes during tests
- **Coverage**: V8 provider with `text`, `json`, `html` reporters (see `vitest.config.ts`)

### Test Setup Mock Pattern (`tests/setup.ts`)
The global setup file mocks the database module to prevent any test from accidentally writing to `curator.db`:
```typescript
vi.mock('../server/db.ts', () => ({
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
  }
}));
```
**Critical**: Any new test that imports from `server/db.ts` will automatically receive this mock. Tests requiring real database operations must use a dedicated test database fixture.

### Test File Inventory

#### Unit Tests (`tests/unit/`)
| File | Lines | Purpose |
|------|-------|---------|
| `routing.test.ts` | 492 | SmartRouter 3-pass algorithm: model selection, circuit breakers, tier filtering, paid spillover, preference sorting, capacity exhaustion |
| `search.test.ts` | 121 | Search pipeline: query tokenization, RRF fusion math, FTS5 query building |
| `nlp.names.test.ts` | 47 | Name parsing: split first/last, handle suffixes, multi-word names |
| `nlp.distances.test.ts` | 47 | String distance metrics: Levenshtein, Jaro-Winkler, normalized similarity |
| `nlp.phonetics.test.ts` | 26 | Double Metaphone: phonetic encoding for blocking passes |
| `nlp.company.test.ts` | 22 | Company name normalization: strip suffixes (Inc, LLC, Corp), abbreviation expansion |

#### Integration Tests (`tests/integration/`)
| File | Lines | Purpose |
|------|-------|---------|
| `dedupe.test.ts` | 15 | Deduplication engine: blocking pass output, merge conflict detection |
| `geocoding.test.ts` | 16 | Geocoding service: Mapbox/Nominatim fallback, coordinate validation |

### AI Mock Requirements
Tests targeting AI integrations **MUST**:
- Inject a mocked `SmartRouter` / `aiService` rather than emitting expensive production tokens.
- Use the `isMockMode()` pattern already established in `aiService.ts` — every AI function checks `isProviderConfigured` and returns realistic mock data when the API key is absent.
- Never rely on network calls in CI — all AI functions have mock fallbacks baked in.

## 2. Test Execution Commands

| Command | Purpose | Mode |
|---------|---------|------|
| `npm test` | Standard run | Watch mode (re-runs on file changes) |
| `npx vitest run` | Single-run validation | Parallel execution, CI-friendly |
| `npx vitest run --coverage` | Coverage report | Generates `text`, `json`, `html` reports |
| `npm run lint` | TypeScript integrity | `tsc --noEmit` — ensures strict type checking passes |
| `npm run build` | Production build | Vite build — validates all imports resolve and JSX compiles |

## 3. Execution Evidence Rules
_Never mark a test as PASS without evidence._
- Automate outputs via raw pasting of `npx vitest run` block completions.
- Submit `npm run lint` metrics as proof of stable compilation.
- "PASS" declarations absent execution artifacts must be designated as UNTESTED blocks.

---

## 4. Current Test Coverage Map

### Well-Covered Domains
| Domain | Test Files | Coverage Notes |
|--------|-----------|----------------|
| AI Routing (SmartRouter) | `routing.test.ts` (492 lines) | Thorough: tier filtering, circuit breakers, overflow, preference sorting, capacity limits |
| NLP Primitives | 4 files (142 lines total) | Core algorithms: names, phonetics, distances, company normalization |
| Search Pipeline | `search.test.ts` (121 lines) | Query parsing, RRF math, FTS5 query construction |

### Under-Covered Domains (Testing Debt)
| Domain | Current State | Recommended Action |
|--------|--------------|-------------------|
| Contact CRUD (routes/services) | No dedicated tests | Add integration tests: create, update, delete with cascade verification |
| Interaction creation + mention extraction | No tests | Add unit tests for `interactionService.ts` mention parsing flow |
| Dedupe engine (multi-pass) | Minimal (15 lines) | Expand: test each pass independently (email, phone, name, phonetic, embedding, AI) |
| Action items + sync triggers | No tests | Add integration test verifying `nextFollowUpAt` trigger sync |
| Import pipeline (CSV/LinkedIn/Apple) | No tests | Add unit tests for `src/lib/importers.ts` parsing |
| List management | No tests | Add CRUD tests for `listService.ts` |
| AI Search enrichment | No tests | Add mock-based tests for `server/services/aiSearch/` |
| Frontend components | No tests | Consider React Testing Library for critical components (CommandPalette, ContactList) |

## 5. Bugs Found (Fix Phase Queue)
_List specific bugs discovered during testing._
1. None

---

## 6. Regression Scenarios (Persistent)
| Scenario | Last Verified | Notes |
|----------|---------------|-------|
| _Type Check Passes_ | _YYYY-MM-DD_ | `npm run lint` yields 0 errors |
| _Vitest Suite Passes_ | _YYYY-MM-DD_ | `npx vitest run` passes all suites |
| _Production Build Succeeds_ | _YYYY-MM-DD_ | `npm run build` completes without errors |
| _Vec0 Deletion Safety_ | _YYYY-MM-DD_ | Contact deletion explicitly purges `search_embeddings` and `contact_embeddings` |
| _FTS5 Trigger Consistency_ | _YYYY-MM-DD_ | All 12 FTS triggers fire correctly on child-table mutations |