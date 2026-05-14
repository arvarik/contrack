# Contributing to Contrack

Thank you for your interest in contributing to Contrack! This guide outlines the standards and workflow for participating in the project.

## Getting Started

1. Fork the repository and clone your fork
2. Install dependencies with `npm install`
3. Copy `.env.example` to `.env` and configure your AI provider key (`GEMINI_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`)
4. Run `npm run dev` to start the development server
5. Optionally run `npm run seed` to populate demo data

## Project Structure

```
contrack/
├── server/                  # Express backend (TypeScript, run via tsx)
│   ├── ai/                  # AI module — provider-agnostic adapter pattern
│   │   ├── adapters/        #   Concrete LLM adapters (gemini, openai, anthropic)
│   │   ├── routing/         #   SmartRouter, QuotaTracker, ParallelQueue
│   │   ├── aiService.ts     #   Business-logic facade (9 exported functions)
│   │   ├── provider.ts      #   Abstract AIProvider interface
│   │   └── types.ts         #   Shared type definitions
│   ├── routes/              # Express route handlers (thin controllers)
│   │   └── dedupe/          #   Dedupe-specific routes (scan, merge, suggestions)
│   ├── services/            # Core business logic
│   │   ├── dedupe/          #   Multi-pass deduplication engine
│   │   ├── search/          #   Hybrid retrieval (FTS5 + vector KNN)
│   │   └── geocoding/       #   Address geocoding (Mapbox / Nominatim)
│   ├── repositories/        # Data access layer (hydration, query helpers)
│   ├── utils/               # Shared utilities (NLP, logging, caching)
│   └── db.ts                # Database init, migrations, virtual tables
├── src/                     # React 19 frontend
│   ├── api/                 #   React Query hooks (one file per domain)
│   ├── hooks/               #   Custom React hooks
│   │   ├── useInstantSearch.ts    # 0ms client-side search with FTS5 handover
│   │   ├── useQueryTokenizer.ts   # Faceted filter prefix operator parser
│   │   ├── useSearchHistory.ts    # Terminal-style search history
│   │   ├── useGlobalNavShortcuts.ts # Cmd+Shift+* navigation
│   │   └── ...              #   Other utility hooks
│   ├── views/               #   Page-level components
│   ├── components/          #   Shared UI components
│   │   ├── command-palette/ #   Cmd+K command center
│   │   │   ├── CommandPalette.tsx  # Main state machine controller
│   │   │   ├── ActionSubMenu.tsx   # Keyboard-first contact actions
│   │   │   ├── InlineNoteComposer.tsx # Note/call editor inside palette
│   │   │   ├── ListPicker.tsx      # List membership toggle
│   │   │   ├── FacetPills.tsx      # Color-coded filter badges
│   │   │   ├── FacetAutocomplete.tsx # Prefix operator autocomplete
│   │   │   ├── ResultPeek.tsx      # Space-to-peek tooltip
│   │   │   ├── SynthesisBar.tsx    # AI executive brief streamer
│   │   │   └── ZeroStateView.tsx   # Intelligence + history display
│   │   └── ...              #   Other shared components
│   └── db/schema.ts         #   Drizzle ORM schema definition
├── tests/                   # Vitest test suites
│   ├── unit/                #   Pure logic tests (NLP, RRF, search)
│   └── integration/         #   Tests requiring database setup
└── drizzle/                 # Auto-generated migration files
```

## Development Standards

### Code Style

- **TypeScript**: All code must be strictly typed. Usage of `any` is prohibited outside of edge-case type narrowing on third-party SDK boundaries (e.g. OpenAI / Anthropic response unions). Prefer `Record<string, unknown>` over index signatures.
- **TSDoc on Exports**: Every exported function, class, and interface in `src/lib/`, `src/types.ts`, `server/utils/`, and `server/repositories/types.ts` MUST carry a TSDoc block describing purpose, parameters, return value, and edge cases.
- **React Query**: All frontend data fetching must go through `@tanstack/react-query` hooks. Raw `useEffect` fetch loops are not acceptable.
- **Styling**: Use Tailwind CSS v4 utility classes. No raw borders — containment is expressed through surface background shifts. Touch-interactive elements must have a 44×44 px minimum hit area (use `<IconButton>` for icon-only buttons).
- **Logging Discipline**: `log.info` for state changes (model selected, scan started, contact merged), `log.warn` for retries and operational degradation (rate-limit hit, AI fallback fired), `log.error` for caught exceptions and unhandled errors. Never `console.log` from production code.

### Architecture Principles

- **Local-First**: Database is SQLite. Network round-trips to managed DBs are forbidden.
- **Service Layer**: Routes are thin controllers. Business logic lives in `server/services/`.
- **AI Adapter Pattern**: The `server/ai/` module uses a provider-agnostic interface. All AI calls go through `aiService.ts`. Every adapter wraps its SDK call in `withTimeout` + `withRetry` + `parseAIJson` from `server/ai/resilience.ts`. When using Gemini, the `SmartRouter` selects the optimal model class (Lite/Flash/Pro); OpenAI and Anthropic adapters use fixed model routing.
- **Error Discipline**: All operational errors thrown from services/repositories MUST be an `AppError` subclass (`NotFoundError`, `ValidationError`, `ConflictError`, `RateLimitedError`, `ServiceUnavailableError`, `UpstreamTimeoutError`). Plain `throw new Error(...)` in the service layer is a code-review block. All async route handlers must be wrapped in `asyncHandler` from `server/utils/asyncHandler.ts`.
- **Transactional Integrity**: Multi-step DB mutations (e.g. contact-with-children inserts, dedupe merges) must execute inside `sqlite.transaction(...)` so partial failures roll back atomically.
- **Defensive Error Handling**: All fire-and-forget async operations must log errors, never silently swallow with empty `.catch(() => {})`.
- **Vec0 Cleanup**: When deleting contacts, manually clean up `search_embeddings` and `contact_embeddings` (vec0 tables don't support FK cascading).

### Testing

Run the full test suite:
```bash
npm test              # Watch mode
npx vitest run        # Single run (180 tests, <600ms)
npm run lint          # TypeScript type check
```

### Commit Messages

Prefix with the area of the codebase:

```
feat(search): add Doc2Query write-time enrichment
fix(dedupe): clean up orphan vec0 embeddings on merge
refactor(ai): extract SmartRouter model selection
perf(search): move NON_LOCATIONS to module scope
docs: update API reference in README
```

## Pull Request Process

1. Ensure your branch is up to date with `main`
2. Run `npm run lint` and `npx vitest run` — both must pass
3. Describe **what** changed and **why** in the PR description
4. If your change modifies the API surface, update [`docs/api-reference.md`](docs/api-reference.md)
5. If your change modifies the database schema, include the migration file

## Reporting Issues

When opening an issue, please include:

- Steps to reproduce
- Expected vs. actual behavior
- Node.js version and OS
- Relevant console output or error messages
