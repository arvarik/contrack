# Contrack Status
Last updated: 2026-04-14

_This file tracks the detailed explore/plan/build/test sub-phases per feature. It is the single source of truth for "where am I?" Agents should update this file after completing tasks or making progress._

## Current Focus
**Phase 3: The Visionary (In Progress)**
Phases 1 and 2 are complete. We are currently architecting features that deeply leverage visualization, relational analytics, and AI constraints, ensuring robust, production-grade output.

**Active Feature**: AI Stats Page — Implementation complete (all 12 tasks). `npm run lint` 0 errors · `npx vitest run` 72/72 pass · `npm run build` succeeds. Awaiting visual review.

## Relevant Files for Current Task
- `src/db/schema.ts` (modify — add `aiInvocations` table)
- `server/services/aiStatsService.ts` (create — recording + query logic)
- `server/routes/aiStats.ts` (create — 2 endpoints)
- `server/ai/aiService.ts` (modify — add `recordInvocation()` at 10 call sites)
- `server.ts` (modify — mount router + retention cleanup)
- `src/api/aiStats.ts` (create — React Query hooks)
- `src/views/ai-stats/AIStatsView.tsx` (create — main page)
- `src/views/ai-stats/components/` (create — SummaryBar, FeedItem, FeedFilters, CacheTiersAccordion, AIStatsSkeleton)
- `src/views/SettingsView.tsx` (modify — add card + route)
- `.agent/STYLE.md` (reference — design system tokens)
- `.agent/ARCHITECTURE.md` §11 (reference — API contracts)

## State of Work

### Phase 1: Foundation (Complete)
- [x] Contact CRUD with normalized child tables (emails, phones, addresses, social links, education, experience, sources)
- [x] Interaction timeline with Tiptap rich-text composition
- [x] `@mention` ingestion via Tiptap → `interaction_mentions` bi-directional graph
- [x] Ghost Entity discovery via AI `extractMentions()`
- [x] FTS5 full-text search with weighted columns and child-table triggers
- [x] Relationship scoring with decay-weighted formulas (hourly recompute)
- [x] Retroactive geocoding (Mapbox primary / Nominatim fallback)
- [x] Map view with Leaflet clustering
- [x] Search history persistence
- [x] Nav shortcuts (`Cmd+Shift+X`)
- [x] Deep Profile Peek (contact detail slide-over from map)
- [x] Link unfurling via Cheerio OpenGraph extraction
- [x] CSV / LinkedIn / Apple Contacts import pipeline

### Phase 2: Power Tools (Complete)
- [x] Command Palette overhaul (`cmdk` with faceted search, inline actions, AI components)
- [x] Multi-pass Deduplication Engine (14-file module: email, phone, name, phonetic, nickname, embedding, AI passes)
- [x] Dedupe UI with Tinder-style swipe cards (merge/dismiss/undo)
- [x] AI Smart Router + QuotaTracker + GEMINI_REGISTRY (6 models, 3-pass routing)
- [x] Ask Contrack v3 — Spotlight hybrid search (FTS5 + local vector KNN + RRF + LLM reranker)
- [x] Local vector embeddings (Transformers.js, 384-dim, sqlite-vec)
- [x] Gemini dedupe embeddings (768-dim, sqlite-vec)
- [x] Doc2Query write-time search expansion (`generateSearchExpansion`)
- [x] AI Search enrichment pipeline (`server/services/aiSearch/`)
- [x] AI-powered contact parsing (`parseContactRecord`, `bulkParseContacts`)
- [x] Catch-Me-Up briefings (`generateCatchMeUpBriefing`)
- [x] EML email summarization (`summarizeEmlEmail`)
- [x] Daily insight generation (`generateDailyInsight`)
- [x] Action Items system with SQL trigger sync to `contacts.nextFollowUpAt`
- [x] Pulse dashboard (metrics, action item swimlanes, daily insights, network health)
- [x] Lists feature (create, manage, drag-to-reorder, add/remove members)
- [x] AI response caching (`aiCache.ts` multi-tier LRU)
- [x] Search result synthesis (`synthesizeSearchResults`)
- [x] Archive/unarchive contacts
- [x] Keyboard shortcuts modal
- [x] Quick Interaction Modal (`Cmd+Shift+I`)
- [x] Avatar picker with Sharp image processing
- [x] Bulk edit field modal
- [x] Settings view with dedupe configuration
- [x] Performance PRAGMAs (cache_size, mmap, synchronous, temp_store)
- [x] Cold-boot contact prefetch for 0ms Cmd+K
- [x] Hardening generic AI documentation formats across repositories

### Phase 3: The Visionary (In Progress)
- [ ] SearchView Renaissance (Persistent Workbench — saved searches, pinned results)
- [ ] Orbit Map (Relational force-graph visualization)
- [ ] Constraint Locking (Multi-pill complex filter lockups)
- [ ] Agentic CLI integration inside Cmd+K

## Known Issues
- **Network page search input**: Character-dropping under rapid typing due to rendering synchronization in `ContactList.tsx`.
- **Cmd+K mobile regressions**: Complex layout regressions under rapid menu traversals on smaller breakpoints (< 640px) in `CommandPalette.tsx`.
- **AI search "null" string values**: Experience history and dates occasionally arrive from LLM as the literal string `"null"` instead of actual null — mitigated by `server/db.ts` startup cleanup, but root cause in `promptTemplate.ts` remains.

## What's Next
Initiating work on the Phase 3 roadmap:
1. **SearchView Renaissance**: Transform `SearchView.tsx` into a persistent workbench with saved search queries and pinned result sets.
2. **Orbit Map**: Build a force-directed relational graph using D3/Sigma showing contact interconnections derived from `interaction_mentions`.
3. **Constraint Locking**: Evolve `FacetPills.tsx` into persistent multi-pill filter lockups that persist across navigation.

## Relevant Files for Current Task
- `.agent/ARCHITECTURE.md`
- `.agent/STYLE.md`
- `.agent/workflows/design-system.md`
- `src/views/SearchView.tsx`
- `src/components/command-palette/FacetPills.tsx`
- `src/components/command-palette/FacetAutocomplete.tsx`
- `README.md`
- `CONTRIBUTING.md`

## Active Worktrees
(none — sequential execution)