# Contrack CRM — Project Status

[STATE: IDLE]

## Current Focus

Phase 3 of `docs/multi-tenant-plan/` is done. Phase 4 is the UI for everything it added: the admin screens, the token page, the invitation flow and the forced password change.

## Feature Lifecycle

_Empty — start a new feature with `/step1-spec`._

## Current State

**Phase:** Multi-tenancy Phase 3 complete (accounts, roles, tokens, and the admin API)

**Test Suite:** 1163 tests (1163 passing, 0 todo) — unit + integration (real SQLite), 0 regressions. Phase 3 of the multi-tenancy plan is complete, in two pull requests. The first mounts `requireAdmin` on every route the manifest classes `admin` and adds thirteen more under `/api/admin`: the account list, create, patch, reset-password, disable, enable, export and delete, plus invitations and the audit log. The second adds personal API tokens, open registration and the instance settings, a per-account rate limit on the AI routes beside the existing per-address one, the daily maintenance sweep, the instance view of AI usage, and the deprecation path for the environment `API_TOKEN`. An adversarial review of each half found eleven defects between them, all fixed. The five in the second half were an expired token that kept working until the UTC date rolled over, a capital letter that escaped both AI rate limiters, a sweep that left a session or invitation that expired earlier the same day, a per-address limiter test that passed with the limiter unmounted, and a schedule test that inherited its precondition from another test's teardown. `tests/integration/api.admin.test.ts` calls every admin route as a member and as an admin, and covers the temporary-password gate, the invitation life cycle, disable and enable, and the purge, which removes an account of 10,000 contacts in 147 ms to 160 ms against a two-second budget. An adversarial review of the branch found five defects, all fixed: the forced-change gate exempted the whole `/api/auth` namespace and so left one instance setting writable, the invitation secret reached the access log through morgan's `:url` token, the audit pagination test never asserted an order, the purge comment claimed accepted invitations survive their inviter when the schema deletes them, and a failed upload removal was reported as a success. Phase 2 remains complete: the isolation matrix has no todo left, every `scoped` route is `isolated: true` in `ROUTE_MANIFEST`, `npm run lint` runs `tenant-lint --strict "server/**/*.ts"` over the whole server tree, and `tests/integration/tenancy.queryPlans.test.ts` proves the owner predicate is an index seek for the ten relational statements the plan names, with the eleventh, the full-text query, pinned through its `MATCH` expression.

The "Stabilization & Polish" refactor sweep (Phases 2–4) is complete. The codebase now meets open-source release quality: every Express route is wrapped in `asyncHandler`, every operational error is an `AppError` subclass, every AI provider routes through `withTimeout`/`withRetry`/`parseAIJson`, every multi-step DB mutation runs inside a transaction, and every modal renders correctly as a bottom sheet on mobile.

## Relevant Files for Current Task

_None — next feature not started._

## Stabilization & Polish Sweep (Phase 2–4, 2026-05-14)

**Phase 2 — Backend Stabilization & Robustness:**

- `server/utils/AppError.ts` — added `code`, `details`, `cause` fields + named subclasses (`NotFoundError`, `ValidationError`, `ConflictError`, `RateLimitedError`, `ServiceUnavailableError`, `UpstreamTimeoutError`)
- `server/utils/asyncHandler.ts` — strict typing; catches synchronous throws
- `server/middleware/errorHandler.ts` (NEW) — central translation for AppError / ZodError / Express parse errors / SQLite errors; production stack stripping; `notFoundHandler` for `/api/*` 404s
- `server/utils/validators.ts` — `validateBody` / `validateParams` / `validateQuery` now throw `ValidationError` instead of writing responses
- `server/ai/resilience.ts` (NEW) — shared `withTimeout`, `withRetry`, `isRetryableError`, `parseAIJson` primitives consumed by every adapter
- OpenAI / Anthropic / Gemini adapters — all now have retries, hard timeouts, and tolerant JSON parsing
- `server/repositories/contactRepository.ts` — `insertChildRecords` wrapped in `sqlite.transaction()`
- `server/services/dedupe/merging.ts` + `suggestions.ts` — merge + audit log now atomic; `throw new Error` replaced with typed `AppError` subclasses

**Phase 3 — Frontend Consistency & Mobile Responsiveness:**

- `src/contexts/SessionContext.tsx` — split into `RecentContext` + `AISearchSessionContext`; both provider values memoized
- `src/contexts/AISearchContext.tsx` + `DedupeContext.tsx` — provider values memoized to stop value-recreation cascades
- `src/components/ui/Modal.tsx` — responsive bottom-sheet on mobile (full-width, slide-up); 44px close-button hit area; safe-area inset
- `src/components/ui/IconButton.tsx` (NEW) — touch-safe 44×44 icon button primitive
- `src/components/QuickInteractionModal.tsx` — re-platformed onto shared `Modal` + `IconButton`; `text-base` mobile inputs to suppress iOS auto-zoom
- `src/components/BulkEditFieldModal.tsx` — fixed hard-coded dark dropdown (was `bg-[#242424]`); added click-outside; 44px touch targets

**Phase 4 — Open Source Polish & Test Coverage:**

- TSDoc enrichment for `src/lib/utils.ts`, `server/utils/helpers.ts`, `src/types.ts`, `server/repositories/types.ts`
- New test file `tests/unit/resilience.test.ts` (35 tests) — full coverage of timeout, retry, classifier, JSON parser
- New test file `tests/unit/appError.test.ts` (14 tests) — AppError contract + every subclass
- New test file `tests/unit/errorHandler.test.ts` (18 tests) — middleware translation for every error shape
- Removed `: any` on the 3 AI adapter SDK response sites (replaced with minimal local interfaces)
- Logger usage verified: INFO for state changes, WARN for AI retries + operational errors, ERROR for unhandled exceptions

## Recently Completed

**Multi-Provider AI** (2026-04-24) — Shipped to main.

- OpenAI (`gpt-4o-mini`, `gpt-5.4-mini`, `gpt-5.4`) and Anthropic (`claude-haiku-4.5`, `claude-sonnet-4.6`, `claude-opus-4.6`) as first-class providers alongside Gemini
- Provider-agnostic `AIProvider` interface with adapters in `server/ai/adapters/`
- Capability router (`ai/capabilities.ts`) resolves provider + model per capability; `AI_PROVIDER` is the Auto-mode preference
- Single-pass search strategy for OpenAI/Anthropic (web search + structured output in one call)
- Provider-aware UI: generic "AI" labels, per-provider tier badges, cost display for all paid tiers
- Provider-aware diagnostics, quota visualization, error messages
- 41 multi-provider contract tests + 72 existing = 113 total
- 2 audit cycles (10 findings total, all resolved)
- Archived to `docs/archive/multi-provider-ai/`

**AI Stats Page** (2026-04-14) — Shipped to main.

- Invocation tracking across all 10 AI functions + 2 cache-hit paths
- `/settings/ai-stats` dashboard with SummaryBar, KPI cards, filtered feed, cache tiers accordion
- `GET /api/ai/stats/summary` and `GET /api/ai/stats/feed` endpoints
- 30-day retention cleanup, X-Powered-By disabled
- Security audit: 0 critical/high findings, 5 low (documented)
- Archived to `docs/archive/ai-stats-page/`

## Known Issues Carried Forward

- B-02: ~~Feed pagination replaces pages instead of appending~~ — **resolved 2026-09-11** by extra F6. The decision was append: `useAIStatsFeed` is an infinite query and "Load older activity" adds a page rather than replacing the one on screen
- S-02: Error messages reflect raw user input in JSON (low risk, React escapes)
- S-03: ~~No `Cache-Control: no-store` header on stats endpoints~~ — **resolved 2026-09-11** by extra F1. `server/middleware/cacheControl.ts` marks `/api/auth`, `/api/admin`, `/api/ai/stats` and `/api/export` as never storable, and uploads are `private` rather than `public`
- P-01: ~~The dedupe scan's name and email passes join a table to itself through `LOWER(TRIM(...))`~~ — **resolved 2026-09-11** by story 1. No index can answer a join predicate wrapped in a function, so SQLite compared every contact with every other: 42.9 s on 10,000 contacts to find no duplicates at all, growing with the size of the account rather than the number of duplicates in it. Both passes group rows already in memory: 24 ms at 10,000, 131 ms at 50,000
- P-02: ~~The KNN matcher can pair an active contact with an archived one~~ — **resolved 2026-09-11** by story 4. The dedupe neighbour search applies the ghost, archived and active predicates as sqlite-vec metadata columns, so a neighbour slot is no longer spent on a candidate the scorer would drop
- A-01: On the dedupe eval's deliberately adversarial corpus, with AI off, a scan produces **58 pairs at or above the auto-merge threshold that are two different people**: every father and son at one firm, every couple sharing a landline, every pair on a team alias, every namesake. Measured by story 8 rather than fixed by it. The engine has no signal that separates some of these (two identical names at one company) and a clear one for others (the tokenizer strips Jr. and Sr. before comparing), so the fix is a threshold or a matcher change, and the eval is now the thing that would show it working
- A-03: `text-primary` on `bg-primary/15` does not clear WCAG AA in the **light** palette: 4.32:1 over a sectional background and 4.21:1 over a container, against a 4.5 requirement. `bg-primary/20` is worse, at 3.92:1. That combination is the active filter pill, the selected row in the list manager and the audit view's range chips, plus about twenty `hover:` states. Not introduced by the theme work and not fixed by it: the fix is a darker brand colour — `#005d80` clears the 15% wash and `#005778` clears 20% as well — which changes how 295 `text-primary` call sites render and is a product decision rather than a side effect of adding a dark mode. The dark palette clears all three washes, and so does every accent the picker can derive, because the derivation's own contract includes the 20% one. Pinned from both sides in `tests/unit/theme.contrast.test.ts`, so a change to the light palette shows up as a change to that assertion. The browser audit cannot see it: an active pill and a hover state are both behind an interaction, and it reads what is on screen at load
- P-03: ~~The hourly relationship-score sweep rescores every contact of every account~~ — **resolved 2026-09-11** by story 10. It cost 989 ms on 50,000 contacts to change almost nothing; it now reads a partial index of contacts a trigger marked, at 0.08 ms on a quiet instance. A daily full pass still runs for recency decay, at 435 ms
- P-04: ~~Writing a relationship score stamps `updatedAt` on the contact~~ — **resolved 2026-09-11** by story 10. The hourly sweep therefore moved `updatedAt` on every contact in the instance every hour, so the column meant "the last sweep" rather than "the last edit", and `findStaleEmbeddings` re-embedded the whole corpus on the next dedupe scan through whichever provider is configured. Both `updatedAt` triggers now name their columns, derived from the table so a column added later is covered
- A-05: `recencyScore` is discontinuous at zero. It returns 100 when `daysSince <= 0` and 91.68 at any positive value with the default cadence, so a contact last contacted this instant and one contacted a millisecond ago score eight points apart on that signal. Reachable in practice only through a future-dated `lastContactedAt`, because a real gap is never exactly zero. Found on 2026-09-11 by a scoring test that sat exactly on the cliff and disagreed with itself about one run in twenty. The test was moved off the cliff rather than the formula changed: smoothing it is a scoring change, and the eval that would show it working does not exist
- A-04: Two placeholder prompts on the contact detail page were drawn at half opacity, which is half the contrast: 2.19:1 and 2.86:1 on a white card. **Resolved 2026-09-11** with the theme work — italic and muted instead of faded. Worth recording because of how it was found: the browser contrast audit had never reached the contact detail route, which it skips unless the instance has a contact in it
- A-02: The dedupe engine finds no `middle-name` duplicates and only 62% of `typo` ones with AI off. Measured by story 8. Both land between the discard and auto thresholds, where a provider would normally verify them
- D-02: ~~OpenAI/Anthropic adapters lack retry/error handling~~ — **resolved 2026-05-14** via the shared `server/ai/resilience.ts` module (`withTimeout` + `withRetry` + `parseAIJson` integrated into all three adapters)

## Carried Tech Debt (not blocking ship)

- `server/services/dedupe/` retains ~30 `any` casts on raw SQLite row access. These are pragmatic — the row shapes are joined-ad-hoc rather than `$inferSelect`-able — but should be narrowed to local row interfaces when next touched. (Out of scope for the polish sweep per the negative constraint "do not change feature logic".)
- `src/views/dedupe/DedupeView.tsx` (742 LOC), `src/views/dedupe/components/SuggestionReviewQueue.tsx` (802 LOC), and `src/components/command-palette/CommandPalette.tsx` (850 LOC) remain "god components". They were flagged in the Phase 1 audit but not decomposed in Phase 3 — each warrants its own focused refactor.

---

## Stub Audit Tracker

_Track mock/stub status across the frontend. Populated during Build phase, cleared during Ship._

| Stub Location                                                | Type                 | Real API Endpoint                     | Status                                           |
| ------------------------------------------------------------ | -------------------- | ------------------------------------- | ------------------------------------------------ |
| `server/ai/aiService.ts:76` — `parseContactRecord()`         | isMockMode guard     | Throws error (no mock data)           | Production — graceful degradation                |
| `server/ai/aiService.ts:199` — `generateCatchMeUpBriefing()` | isMockMode mock data | `POST /api/contacts/:id/briefing`     | Production — returns hardcoded 3-bullet briefing |
| `server/ai/aiService.ts:262` — `extractMentions()`           | isMockMode mock data | Inline AI call                        | Production — returns empty array                 |
| `server/ai/aiService.ts:340` — `summarizeEmlEmail()`         | isMockMode mock data | `POST /api/contacts/:id/interactions` | Production — returns hardcoded HTML summary      |
| `server/ai/aiService.ts:401` — `rerankCandidates()`          | isMockMode mock data | `POST /api/search/semantic`           | Production — returns first candidate             |
| `server/ai/aiService.ts:509` — `generateDailyInsight()`      | isMockMode mock data | `GET /api/dashboard/insight`          | Production — returns null                        |
| `server/ai/aiService.ts:592` — `bulkParseContacts()`         | isMockMode guard     | Throws error (no mock data)           | Production — graceful degradation                |
| `server/ai/aiService.ts:664` — `generateSearchExpansion()`   | isMockMode guard     | Inline AI call                        | Production — returns null                        |
| `server/ai/aiService.ts:715` — `synthesizeSearchResults()`   | isMockMode mock data | `POST /api/search/synthesize`         | Production — returns templated string            |
| `src/views/ai-stats/components/SummaryBar.tsx:20`            | Tier badge label     | N/A (UI label)                        | Production — displays "Mock Mode" tier badge     |

_All stubs are production-grade graceful degradation paths (triggered when no AI provider is configured). No MSW mocking or dev-only fake data detected._

---

## Prompt Versioning Changelog

_Track changes to LLM prompts so we can diff versions and rollback if evals degrade._

| Version | Date       | Change Description                                                                   | Eval Score | Delta | File                                                     |
| ------- | ---------- | ------------------------------------------------------------------------------------ | ---------- | ----- | -------------------------------------------------------- |
| v1.0    | 2026-04-16 | Baseline — contact record parsing (structured extraction from unstructured text)     | —          | —     | `server/ai/aiService.ts:80-95`                           |
| v1.0    | 2026-04-16 | Baseline — catch-me-up briefing (3-bullet executive brief from contact+timeline)     | —          | —     | `server/ai/aiService.ts:209-230`                         |
| v1.0    | 2026-04-16 | Baseline — mention extraction (NER for people in CRM notes)                          | —          | —     | `server/ai/aiService.ts:277-294`                         |
| v1.0    | 2026-04-16 | Baseline — EML email summarization (raw .eml → HTML digest)                          | —          | —     | `server/ai/aiService.ts:346-360`                         |
| v1.0    | 2026-04-16 | Baseline — reranker (precision-focused candidate filtering for Ask Contrack)         | —          | —     | `server/ai/aiService.ts:412-427`                         |
| v1.0    | 2026-04-16 | Baseline — daily insight (actionable CRM network insight from stats)                 | —          | —     | `server/ai/aiService.ts:515-529`                         |
| v1.0    | 2026-04-16 | Baseline — search expansion / Doc2Query (write-time synonym generation)              | —          | —     | `server/ai/aiService.ts:680`                             |
| v1.0    | 2026-04-16 | Baseline — synthesis brief (executive summary of search results)                     | —          | —     | `server/ai/aiService.ts:739-753`                         |
| v1.0    | 2026-04-16 | Baseline — AI Search research prompt (grounded contact research with disambiguation) | —          | —     | `server/services/aiSearch/promptTemplate.ts:31-188`      |
| v1.0    | 2026-04-16 | Baseline — AI Search extraction prompt (Pass 2 structured JSON extraction)           | —          | —     | `server/services/aiSearch/strategies/twoPass.ts:120-140` |
