# Contrack CRM — Developer & AI Context

This file serves as the definitive anchor for understanding the architectural decisions, design system mandates, and schema topologies enforcing Contrack CRM.

## 1. Stack Conventions
- **Tooling**: Vite 6, React 19, Node.js 22 + Express (run natively via `tsx` script loader).
- **Styles**: **Tailwind CSS v4**. *Do not use standard border properties (`border-gray-200`)*. The UI utilizes strict tokenized CSS shifts. A surface layer sits at `surface`. Secondary containers belong on `surface-container-low`. All cards and modals belong on `surface-container-lowest`. Read `workflows/design-system.md` for specific semantic mappings.
- **Data Flow**: The frontend utilizes explicit `fetch` calls wrapped via `useQuery` and `useMutation` exclusively relying on **React Query**. Never write native `useEffect` fetch loops.
- **Testing**: Vitest with 72+ tests across unit and integration suites. Run `npx vitest run` (single pass) or `npm test` (watch).

## 2. Database (SQLite via Drizzle)
The CRM relies on a relational abstraction using SQLite operating in `WAL` mode.

### Critical Relationships:
- **`contacts`**: The primary entity boundary. All scalar definitions live here (name, company, role, AI briefing, `searchExpansion`, `isGhost`, `canonicalId`, geo coordinates).
- **Child arrays**: Emails, phones, tags, interests, experience, education, social links, sources, and addresses — normalized tables with `contactId` FK and strict `ON DELETE CASCADE`.
- **`interactions`**: Represents raw timeline nodes (calls, notes, meetings, emails).
- **`interaction_mentions`**: Junction table mapping bi-directional @mention relationships between interactions and contacts.
- **`action_items`**: Follow-up tasks with due dates, completion state, and automated creation via SQLite triggers.
- **`lists` / `list_members`**: User-created contact groups with sort ordering and bulk management.
- **Virtual tables**:
  - `contacts_fts` — FTS5 full-text search index with BM25 weighted columns.
  - `search_embeddings` — `vec0` 384-dim local embeddings (Transformers.js, `all-MiniLM-L6-v2`).
  - `contact_embeddings` — `vec0` 768-dim Gemini embeddings for deduplication.

### ⚠️ Vec0 Tables:
`search_embeddings` and `contact_embeddings` are `vec0` virtual tables. They do **NOT** support foreign key cascading. When deleting or merging contacts, you MUST manually `DELETE FROM search_embeddings WHERE contactId = ?` and `DELETE FROM contact_embeddings WHERE contactId = ?`.

### Database Operations:
Schema changes are managed via **Drizzle Kit migrations**. After modifying `src/db/schema.ts`, run `npm run db:generate` to create a new tracked migration file. The server applies pending migrations automatically on startup. FTS5 virtual tables and vec0 tables are maintained separately in `server/db.ts` since Drizzle ORM does not manage virtual tables.

## 3. AI Architecture

### Provider Adapter Pattern
All AI operations live under `server/ai/` using a provider-agnostic architecture:
- **`server/ai/types.ts`**: Shared type definitions (`ModelClass`, `ModelTier`, etc.).
- **`server/ai/provider.ts`**: Abstract `AIProvider` interface that all adapters implement.
- **`server/ai/adapters/gemini.ts`**: Concrete Gemini adapter — the **only file** that imports `@google/genai`.
- **`server/ai/aiService.ts`**: Business-logic facade exposing **9 functions** that program against the abstract provider interface:
  1. `parseContactRecord` — AI-parse unstructured text into structured contact (Lite)
  2. `bulkParseContacts` — Batch parse multiple contacts (Lite)
  3. `extractMentions` — Identify @mentioned names in interaction text (Lite)
  4. `generateCatchMeUpBriefing` — 3-bullet executive summary from timeline (Flash)
  5. `summarizeEmlEmail` — Clean and format raw .eml content (Flash)
  6. `generateSearchExpansion` — Doc2Query synthetic search terms for contacts (Lite)
  7. `generateDailyInsight` — AI-generated daily network insight (Lite)
  8. `rerankCandidates` — LLM reranking for Ask Contrack search results (Flash)
  9. `semanticContactSearch` — Legacy semantic search (Flash, deprecated by v3 pipeline)

### Smart Router (`server/ai/routing/`)
All AI calls are routed through the `SmartRouter`, which:
- Selects the optimal Gemini model based on `ModelClass` (lite / flash / pro).
- Tracks per-model quota via `QuotaTracker` (RPM/RPD limits vary by `AI_TIER`).
- Manages concurrent requests via `ParallelQueue` (max 5 parallel per model).
- Handles automatic retry with fallback to lower-tier models on rate limit errors.

### Local Embeddings (`server/services/search/localEmbeddings.ts`)
- Model: `Xenova/all-MiniLM-L6-v2` (384-dim, quantized q8) via `@huggingface/transformers`.
- Loads in ~200ms (warmed), produces embeddings in ~3ms per query.
- Backfills all contacts on server startup (~2s for ~960 contacts).
- Stored in `search_embeddings` vec0 table.

## 4. Search Architecture: Ask Contrack v3 "Spotlight"
The search pipeline (`server/services/search/` + `server/services/searchService.ts`) uses a two-phase NDJSON streaming architecture:

1. **Pre-filter extraction**: chrono-node temporal parsing + regex for location/company → SQL WHERE clauses.
2. **FTS5 weighted BM25**: Column-weighted keyword search (name=10x, company=5x, role=3x).
3. **Local vector KNN**: Brute-force cosine similarity via sqlite-vec (~3ms).
4. **RRF fusion** (k=15): Reciprocal Rank Fusion merges FTS and vector channels.
5. **Confidence gate**: If >85% of results came from FTS, skip the LLM reranker.
6. **LLM reranker** (optional Phase 2): Gemini Flash evaluates top 30 candidates and adds AI reasons.

Phase 1 delivers <15ms results. Phase 2 enriches with AI reasons ~500ms later via streaming.

## 5. Cmd+K Command Center Architecture
The `CommandPalette.tsx` component acts as a state machine managing multiple layers:

### State Layers (Escape Stack)
1. **InlineNoteComposer** / **ListPicker** → `Esc` returns to Action Sub-Menu
2. **ActionSubMenu** → `Esc` returns to search results
3. **Search Results** → `Esc` closes the palette

### Key Hooks
| Hook | File | Purpose |
|---|---|---|
| `useInstantSearch` | `src/hooks/useInstantSearch.ts` | 0ms client-side filter from slim cache with async FTS5 handover |
| `useQueryTokenizer` | `src/hooks/useQueryTokenizer.ts` | Parses `field:value` prefix operators into `FacetFilter[]` + free text |
| `useSearchHistory` | `src/hooks/useSearchHistory.ts` | localStorage-based circular buffer with terminal-style ↑/↓ navigation |
| `useRecentContacts` | `src/hooks/useRecentContacts.ts` | Tracks recently-viewed contacts for zero-state display |
| `useGlobalNavShortcuts` | `src/hooks/useGlobalNavShortcuts.ts` | Centralized `Cmd+Shift+*` navigation shortcuts |

### Key Components (`src/components/command-palette/`)
| Component | Purpose |
|---|---|
| `CommandPalette.tsx` | Main controller — search input, mode detection, result rendering, sub-menu state |
| `ActionSubMenu.tsx` | Keyboard-first action panel (→ on focused result) with 5 actions |
| `InlineNoteComposer.tsx` | Compact note/call editor inside palette (Cmd+Enter to save) |
| `ListPicker.tsx` | Check-style list membership toggle |
| `FacetPills.tsx` | Color-coded filter pill badges with dismiss buttons |
| `FacetAutocomplete.tsx` | Dropdown autocomplete sourced from slim contact cache |
| `ResultPeek.tsx` | Space-to-peek tooltip (score, last contact, tags) |
| `SynthesisBar.tsx` | Streaming executive brief from AI results (NDJSON) |
| `ZeroStateView.tsx` | CRM intelligence + history + navigation when input is empty |
| `ContactMetaBadges.tsx` | `ScoreDot`, `LastContactLine`, `StaleChip` inline badges |
| `DataAgeHalo.tsx` | Colored avatar ring indicating data freshness |

### Critical Patterns
- **`onMouseDown={(e) => e.preventDefault()}`**: Applied to ALL interactive elements inside the palette that are not `Command.Item` elements. Without this, `cmdk` interprets clicks as "outside" clicks and closes the dialog.
- **Capture-phase keyboard handlers**: `window.addEventListener('keydown', handler, true)` is used in `ActionSubMenu` and `FacetAutocomplete` to intercept keys before global shortcuts (e.g., ContactList's `N` for new contact) can fire.
- **Mobile responsiveness**: All `<kbd>` hints use `hidden sm:inline-flex`. The `>>` chevron is always visible on mobile (`opacity-40`) but hover-reveal on desktop. Touch targets are enlarged via `p-2 sm:p-1`.

## 7. Dedupe Architecture
The deduplication engine (`server/services/dedupe/`) uses:
- **Multi-pass blocking**: Name phonetics (Double Metaphone), email exact-match, phone normalization, company+location.
- **Pairwise scoring**: Composite score from name distance, company similarity, role overlap, email/phone overlap, and embedding cosine similarity.
- **Union-Find clustering**: Groups pairwise matches into N-contact clusters.
- **Auto-merge**: Clusters above the user-configurable threshold merge automatically.
- **Manual review**: Below-threshold clusters surface as suggestions in the UI.
- **Staleness detection**: Embeddings older than the contact's `updatedAt` trigger re-embedding.

## 8. Bootstrapping Notes
- Node routes inject a Request UUID for trace logging across the full request lifecycle.
- `AppError` class + `asyncHandler` HOF provide centralized error handling across all routes.
- `npm run seed` drops the database and repopulates with synthetic demo data.
- Ensure `.env` defines `GEMINI_API_KEY`. Optional: `AI_TIER`, `MAPBOX_API_KEY`.
