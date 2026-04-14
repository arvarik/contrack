# Architecture

_This document acts as the definitive anchor for understanding system design, data models, API contracts, and technology boundaries. Update this document during the Design and Review phases._

## 1. Tech Stack & Infrastructure
- **Language / Runtime**: TypeScript 5 / Node.js 22
- **Frontend**: React 19 via Vite 6, incorporating Tiptap for rich interaction composition and specialized hooks to maintain 0ms UI latency.
- **Backend / API**: Express.js run natively via `tsx`
- **Database**: SQLite (WAL mode) via Drizzle ORM
- **Deployment**: Local-first / Self-hosted
- **Package Management**: npm

## 2. System Boundaries & Data Flow
### Request / Data Flow
- **Client to Server**: Client Components → React Query (`useQuery`/`useMutation` in `src/api/`) → Express API routes (`server/routes/`) → Services (`server/services/`) → Drizzle ORM → SQLite. Never write native `useEffect` fetch loops.
- **Search Pipeline (Ask Contrack v3 - Spotlight)**: Features Reciprocal Rank Fusion (k=15). chrono-node temporal parsing → FTS5 weighted BM25 → Local vector KNN via sqlite-vec (Xenova/all-MiniLM-L6-v2) → RRF → Optional LLM reranker (Gemini Flash). Two-phase NDJSON streaming provides instant UI feedback (<15ms) followed by enriched backend resolution.
- **AI Adapter Pipeline**: All operations route through the `SmartRouter` in `server/ai/`. The `aiService.ts` facade directs requests to specific classes (Lite, Flash, Pro) based on context while enforcing quotas via `QuotaTracker` and concurrency safety via `ParallelQueue`. Calls to `@google/genai` are isolated to `adapters/gemini.ts`.
- **Link Unfurling**: Handled natively utilizing lightweight `cheerio` HTML parsers for OpenGraph extraction without running headless browsers.

### Concurrency / Threading Model
- **Server**: Single Node.js process, async I/O. Background synchronous sweeps run automatically for score re-computation on startup / polling loops.
- **AI Queue**: Max 5 concurrent AI queries, managed explicitly to respect Google LLM limits based on dynamic tier assignment.

## 3. Data Models & Database Schema
- **`contacts`**: Primary entity boundary. Contains canonical IDs, geo coords, expansion terms, and `isGhost` entity state.
- **Child Arrays**: Normalized tables (emails, phones, tags, experience) strictly bound by `contactId` FK with `ON DELETE CASCADE`.
- **`interactions` / `interaction_mentions`**: Timeline nodes and bi-directional graph connections formulated by Tiptap `@mention` ingestion.
- **`dedupe_suggestions` & `merge_log`**: Multi-pass deduplication system records pending clusters and guarantees an undo log for safe recovery.

### Critical Rules (Virtual Tables)
**`vec0` virtual tables do NOT support foreign key cascading.**
- `contacts_fts`: FTS5 full-text search index.
- `search_embeddings`: `vec0` 384-dim local embeddings (`Xenova/all-MiniLM-L6-v2`) generated locally via Transformers.js for 0ms network latency.
- `contact_embeddings`: `vec0` 768-dim Gemini embeddings exclusively driving deduplication NLP modules.
When deleting or merging contacts, you MUST manually execute `DELETE FROM search_embeddings WHERE contactId = ?` and `DELETE FROM contact_embeddings WHERE contactId = ?` to prevent orphaned nodes.

### Schema Change Process
Modify `src/db/schema.ts`, then run `npm run db:generate` to output a Drizzle migration. The backend server automatically applies pending migrations during startup. Virtual configurations persist in `server/db.ts`.

## 4. Layered Directory Structure (Strict Segregation)
- `server/ai/` — Model-agnostic SmartRouter, Quota Tracker, Parallel Queue, and Gemini Adapters.
- `server/routes/` — Thin Express controllers enforcing payload validation.
- `server/services/` — Heavy business logic (Multi-pass Dedupe engine, RRF Search pipelines, Geocoding).
- `server/repositories/` — Data-access patterns and hydration wrappers.
- `src/api/` — Domain-separated React Query hooks.
- `src/hooks/` — Complex custom client intelligence (`useInstantSearch`, `useQueryTokenizer`).
- `src/components/command-palette/` — Core `cmdk` Cmd+K operation center handling complex keyboard focus states.
- `src/views/` — Modular, route-driven page components.

## 5. External Integrations
- **LLM**: Google Gemini.
- **Local Embeddings**: HuggingFace `Xenova/all-MiniLM-L6-v2`. 
- **Geocoding**: Mapbox (Primary) / Nominatim (Fallback).

## 6. Invariants & Safety Rules
- **NEVER** write native `useEffect` fetch loops for data operations. Rely solely on `@tanstack/react-query`.
- **NEVER** silently swallow errors (`.catch(() => {})`).
- **MUST** manually purge vec0 table dependencies on deletions.
- **Local-First Mandate**: External relational database usage is forbidden.

## 7. Error Handling
- Routes enforce UUID-injected request tracing managed through `asyncHandler` higher-order functions resolving into centralized `AppError` payloads.

## 8. Development Lifecycle
- **Install**: `npm install`
- **Boot**: `npm run dev` (Vite on :5173, Express on :3001)
- **Database Seed**: `npm run seed` (Resets data for clean integration boundaries)
- **Migrations**: `npm run db:generate`
- **Requirements**: `GEMINI_API_KEY` mapped inside `.env`.
