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

- **TypeScript**: `strict: true` is enforced by `tsconfig.json` (plus `noImplicitOverride` and `noFallthroughCasesInSwitch`), and `@typescript-eslint/no-explicit-any` is an **error** — `any` disables strict checking for everything it touches. For genuinely untypable third-party surfaces, use an inline `eslint-disable-next-line` with a one-line justification. Prefer `Record<string, unknown>` + narrowing over index signatures. Cast better-sqlite3 `.get()`/`.all()` results once at the query site to a narrow row interface (only the selected columns), or use `Pick<ContactRow, ...>` from the Drizzle-inferred types.
- **React lint**: `react-hooks/rules-of-hooks` is an error; `react-hooks/exhaustive-deps` and the `jsx-a11y` recommended set are warnings being ratcheted to errors as their counts reach zero — don't add new violations.
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
npm test              # Unit + integration (496 tests, no API keys needed)
npm run test:coverage # ...with a coverage report
npm run lint          # ESLint + tsc --noEmit (strict)
```

**You never need an API key to develop Contrack.** `npm test` mocks every AI
call, and the integration suite blanks provider keys so a stray request can't
escape to a real API.

#### Contract tests (optional)

`npm run test:contract` calls **real** provider APIs. It exists because mocked
adapter tests cannot catch a wire-format mismatch — a mock encodes our
assumption about a provider, so if the assumption is wrong the test passes
forever while the feature is broken. That is not hypothetical: Anthropic's
structured output shipped broken for exactly that reason, with a green unit
test asserting the wrong shape.

Every provider block **skips itself when its credential is absent — or when the
provider rejects it**. A stale `OPENAI_API_KEY` exported in your shell for some
unrelated tool will not turn this suite red; it skips with the reason. Only a
genuine adapter fault fails. So this is useful with one key or none:

```bash
npm run test:contract            # no keys -> everything skips, exit 0
GEMINI_API_KEY=... npm run test:contract   # runs only the Gemini block
```

To exercise a self-hosted OpenAI-compatible server:

```bash
CONTRACT_COMPAT_URL=http://localhost:11434/v1 \
CONTRACT_COMPAT_MODEL=llama3.1 \
  npm run test:contract
```

Models can be pinned per provider with `CONTRACT_<PROVIDER>_MODEL` and
`CONTRACT_<PROVIDER>_EMBED_MODEL` if the defaults are unavailable on your
account. These tests are not part of CI — they are run before a release and
whenever an adapter changes.

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
2. Run `npm run lint` and `npm test` — both must pass. If you changed an
   AI adapter, run `npm run test:contract` with whatever key you have.
3. Describe **what** changed and **why** in the PR description
4. If your change modifies the API surface, update [`docs/api-reference.md`](docs/api-reference.md)
5. If your change modifies the database schema, include the migration file

## Reporting Issues

When opening an issue, please include:

- Steps to reproduce
- Expected vs. actual behavior
- Node.js version and OS
- Relevant console output or error messages
