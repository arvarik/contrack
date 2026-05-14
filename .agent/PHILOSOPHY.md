# Product Philosophy

_This is the soul of the product. It explains why the app exists and what its core beliefs are. Product Visionaries and UI/UX Designers use this to make feature and design decisions. Engineers use it to resolve ambiguity._

## 1. Why This Exists

Contrack is a local-first, AI-powered personal CRM built for high-leverage individuals (creative directors, executives, contractors). Traditional CRMs are bloated log-books requiring immense manual input for enterprise sales funnels. Contrack works differently: **You write the notes, the AI builds the relational graph.** We convert chaotic unstructured interactions into deep intelligence without manual forms, pipeline stages, or data entry drudgery.

## 2. Target User Concept

The power user values rapid recall, keyboard-first navigation, and immediate insight extraction over complex pipelines. They prefer to pull up a contact dynamically via `Cmd+K` during a live meeting rather than navigating heavy multi-page dashboards. They import contacts from LinkedIn, Apple Contacts, Google, and CSV exports — then expect the system to organize, deduplicate, and enrich that data automatically.

## 3. Core Beliefs

### 0ms Doctrine

Latency breaks flow. Every interaction path is engineered for perceived instant response:

- **Client-side prefetch**: `['contacts']` query is prefetched in `main.tsx` before the first render, so Cmd+K has data on first open.
- **React Query caching**: Global `staleTime: 30s` with per-feature overrides (dashboard 2min, map 5min) means navigating back is instant.
- **FTS5 full-text search**: SQLite FTS5 indexes return results in <1ms, bypassing any network round-trip for the core search path.
- **Local vector embeddings**: Transformers.js (`Xenova/all-MiniLM-L6-v2`) runs entirely in-process — zero network latency for 384-dim KNN search.
- **Doc2Query write-time enrichment**: AI generates `searchExpansion` terms at write time, so "Who works in fintech?" matches via FTS5 keyword search (<1ms) without needing runtime LLM calls.
- **Two-phase NDJSON streaming**: Search results appear instantly from local retrieval, then enrich asynchronously with AI reranking.

### Ghost Entity Mapping

The AI passively processes raw interaction text via `extractMentions()`, discovering references to individuals even before users officially log them. These "Ghost" nodes (`isGhost=1` on the contact entity) materialize into formal contacts automatically once active engagement unfolds, ensuring history is never lost purely due to delayed data entry. Ghost contacts are invisible in the main network list but fully participate in the relational graph.

### Privacy Is Fundamental

Core storage (SQLite) is local — `curator.db` lives on disk, never in the cloud. AI network boundaries are explicitly controlled:

- **Outbound AI calls are opt-in features**: Catch-Me-Up briefings, Data Enrichment (AI Search), Daily Insights, EML Summarization, contact parsing, search expansion.
- **Local-only features use zero network**: FTS5 search, local vector KNN, client-side instant search, relationship scoring, phonetic blocking.
- **Token conservation**: The `SmartRouter` + `QuotaTracker` system conserves API calls by routing to the cheapest capable model (lite → flash → pro) and caching AI responses via `aiCache.ts`.
- **Mock mode**: When `GEMINI_API_KEY` is missing, all AI functions return realistic mock data — the entire app remains fully functional without any external network calls.

### Relationship Intelligence Is Ambient

Intelligence should feel passive and ambient, not interventional:

- **Automated relationship scoring**: `relationshipService` recomputes decay-weighted scores hourly using interaction frequency, recency, and cadence adherence — users see health rings and at-risk warnings without manual input.
- **Retroactive geocoding**: On startup, contacts with locations but no coordinates are silently geocoded (Mapbox → Nominatim fallback), populating the map without user intervention.
- **Background embedding backfill**: Both search embeddings (local, 384-dim) and dedupe embeddings (Gemini, 768-dim) backfill silently on startup.
- **Phonetic hash indexing**: Double Metaphone hashes are computed and backfilled on startup for O(1) phonetic blocking in the deduplication engine.

## 4. Design & UX Principles

### No-Line Hierarchy

Lines signify a failure of visual hierarchy. Containment is expressed purely through surface background shifts (`surface` → `surface-container-low` → `surface-container-lowest`) rather than rigid borders. The only exceptions are interactive focus rings on inputs and active selection states.

### Glassmorphism Integration

Modals, dropdowns, the Command Palette, and floating navigation bars utilize `glass-panel` (80% white + 20px blur) to represent contextual dominance over underlying content. This creates depth without opaque overlays.

### Keyboard-First Architecture

- **Cmd+K**: Opens the Command Palette — the central operating hub for search, navigation, AI queries, list management, and quick actions.
- **Cmd+Shift+I**: Quick Interaction Modal — log a note without navigating away.
- **Cmd+Shift+X**: Global navigation shortcuts (via `useGlobalNavShortcuts`).
- **?**: Keyboard shortcuts reference modal.
- All shortcut scopes are managed to prevent conflicts between global handlers, the Command Palette's internal `cmdk` handlers, and nested sub-component handlers.

### Typography System

- **Headlines**: `Manrope` (font-headline) — bold, tight tracking for section headers and display text.
- **Body**: `Inter` (font-body) — clean, readable sans-serif for all body text, labels, and UI elements.
- Loaded via Google Fonts with `display=swap` for immediate text rendering.

### Animation Philosophy

Two animation strategies are used, chosen based on their rendering characteristics:

- **Framer Motion (`motion/react`)**: Used for layout transitions (route changes, presence animations, spring-based panel sliding). Appropriate when individual elements enter/exit the DOM.
- **CSS `@keyframes`**: Used for GPU-composited list animations (`result-card-enter`, `timeline-entry`). These use opacity-only transforms to avoid subpixel reflow jitter in large lists. Animation delay is set inline per item index.

### Error Recovery

Errors should never destroy user context:

- **`ErrorBoundary`** (global): Catches top-level React crashes with a recovery button.
- **`RouteErrorBoundary`** (per-view): Isolates crashes to individual views — the sidebar, navigation, and other views remain functional.
- **`AppError`** (server): Distinguishes operational errors (expected, logged at info level) from programmer errors (unexpected, logged with full stack trace). Clients receive structured JSON error responses with request IDs.

## 5. What This Is NOT

- **Not a sales tracker**: No traditional leads, conversion pipelines, CRM workflows, or financial metrics. No deal stages, no revenue attribution.
- **Not an Enterprise DB**: Database rests strictly isolated on disk. No cloud connections, no multi-user sync, no hosted database services.
- **Not a raw task manager**: Action items exist strictly as contextual offshoots of relationships (`action_items` table FK'd to `contacts`), not a daily planner or project manager.
- **Not a social media client**: Social links are stored for reference; we never connect to or post on social platforms.
- **Not a data warehouse**: Contact data is enriched for relationship intelligence, not for analytics funnels or marketing campaigns.
