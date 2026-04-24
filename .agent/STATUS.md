# Contrack CRM — Project Status
[STATE: IDLE]

## Current Focus

_No active feature — ready for next cycle._

## Feature Lifecycle

_Empty — start a new feature with `/step1-spec`._

## Current State
**Phase:** Idle

**Test Suite:** 113 tests (113 passing) — full suite, 0 regressions

Phases 1 and 2 are complete. We are currently architecting features that deeply leverage visualization, relational analytics, and AI constraints, ensuring robust, production-grade output.

## Relevant Files for Current Task
_None — next feature not started._

## Recently Completed

**Multi-Provider AI** (2026-04-24) — Shipped to main.
- OpenAI (`gpt-4o-mini`, `gpt-5.4-mini`, `gpt-5.4`) and Anthropic (`claude-haiku-4.5`, `claude-sonnet-4.6`, `claude-opus-4.6`) as first-class providers alongside Gemini
- Provider-agnostic `AIProvider` interface with adapters in `server/ai/adapters/`
- Singleton factory resolves provider from `AI_PROVIDER` env var
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
- B-02: Feed pagination replaces pages instead of appending (design decision needed)
- S-02: Error messages reflect raw user input in JSON (low risk, React escapes)
- S-03: No `Cache-Control: no-store` header on stats endpoints (low risk)
- D-02: OpenAI/Anthropic adapters lack retry/error handling (job queue provides batch-level retry with 4 attempts + 3s backoff; adapter-level retry is a v2 enhancement)

---

## Stub Audit Tracker

_Track mock/stub status across the frontend. Populated during Build phase, cleared during Ship._

| Stub Location | Type | Real API Endpoint | Status |
|---------------|------|-------------------|--------|
| `server/ai/aiService.ts:76` — `parseContactRecord()` | isMockMode guard | Throws error (no mock data) | Production — graceful degradation |
| `server/ai/aiService.ts:199` — `generateCatchMeUpBriefing()` | isMockMode mock data | `POST /api/contacts/:id/briefing` | Production — returns hardcoded 3-bullet briefing |
| `server/ai/aiService.ts:262` — `extractMentions()` | isMockMode mock data | Inline AI call | Production — returns empty array |
| `server/ai/aiService.ts:340` — `summarizeEmlEmail()` | isMockMode mock data | `POST /api/contacts/:id/interactions` | Production — returns hardcoded HTML summary |
| `server/ai/aiService.ts:401` — `rerankCandidates()` | isMockMode mock data | `POST /api/search/semantic` | Production — returns first candidate |
| `server/ai/aiService.ts:509` — `generateDailyInsight()` | isMockMode mock data | `GET /api/dashboard/insight` | Production — returns null |
| `server/ai/aiService.ts:592` — `bulkParseContacts()` | isMockMode guard | Throws error (no mock data) | Production — graceful degradation |
| `server/ai/aiService.ts:664` — `generateSearchExpansion()` | isMockMode guard | Inline AI call | Production — returns null |
| `server/ai/aiService.ts:715` — `synthesizeSearchResults()` | isMockMode mock data | `POST /api/search/synthesize` | Production — returns templated string |
| `src/views/ai-stats/components/SummaryBar.tsx:20` | Tier badge label | N/A (UI label) | Production — displays "Mock Mode" tier badge |

_All stubs are production-grade graceful degradation paths (triggered when the active provider's API key is absent). No MSW mocking or dev-only fake data detected._

---

## Prompt Versioning Changelog

_Track changes to LLM prompts so we can diff versions and rollback if evals degrade._

| Version | Date | Change Description | Eval Score | Delta | File |
|---------|------|--------------------|------------|-------|------|
| v1.0 | 2026-04-16 | Baseline — contact record parsing (structured extraction from unstructured text) | — | — | `server/ai/aiService.ts:80-95` |
| v1.0 | 2026-04-16 | Baseline — catch-me-up briefing (3-bullet executive brief from contact+timeline) | — | — | `server/ai/aiService.ts:209-230` |
| v1.0 | 2026-04-16 | Baseline — mention extraction (NER for people in CRM notes) | — | — | `server/ai/aiService.ts:277-294` |
| v1.0 | 2026-04-16 | Baseline — EML email summarization (raw .eml → HTML digest) | — | — | `server/ai/aiService.ts:346-360` |
| v1.0 | 2026-04-16 | Baseline — reranker (precision-focused candidate filtering for Ask Contrack) | — | — | `server/ai/aiService.ts:412-427` |
| v1.0 | 2026-04-16 | Baseline — daily insight (actionable CRM network insight from stats) | — | — | `server/ai/aiService.ts:515-529` |
| v1.0 | 2026-04-16 | Baseline — search expansion / Doc2Query (write-time synonym generation) | — | — | `server/ai/aiService.ts:680` |
| v1.0 | 2026-04-16 | Baseline — synthesis brief (executive summary of search results) | — | — | `server/ai/aiService.ts:739-753` |
| v1.0 | 2026-04-16 | Baseline — AI Search research prompt (grounded contact research with disambiguation) | — | — | `server/services/aiSearch/promptTemplate.ts:31-188` |
| v1.0 | 2026-04-16 | Baseline — AI Search extraction prompt (Pass 2 structured JSON extraction) | — | — | `server/services/aiSearch/strategies/twoPass.ts:120-140` |