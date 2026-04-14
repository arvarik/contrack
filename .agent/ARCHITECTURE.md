# Architecture

_This document acts as the definitive anchor for understanding system design, data models, API contracts, and technology boundaries. Update this document during the Design and Review phases._

## 1. Tech Stack & Infrastructure
- **Language / Runtime**: TypeScript 5 / Node.js 22
- **Frontend**: React 19 via Vite 6
- **Backend / API**: Express.js run natively via `tsx`
- **Database**: SQLite (WAL mode) via Drizzle ORM
- **Deployment**: Local-first / Self-hosted
- **Package Management**: npm

## 2. System Boundaries & Data Flow
### Request / Data Flow
- **Client to Server**: Client Components → React Query `useQuery`/`useMutation` → Express API routes → Drizzle ORM → SQLite. Never write native `useEffect` fetch loops.
- **Search Pipeline (Ask Contrack v3)**: chrono-node temporal parsing → FTS5 weighted BM25 → Local vector KNN via sqlite-vec → RRF fusion (k=15) → Optional LLM reranker (Gemini Flash). Two-phase NDJSON streaming.
- **AI Adapter Pattern**: All AI operations live under `server/ai/`. Calls to `@google/genai` are isolated to `adapters/gemini.ts`. The business logic facade (`aiService.ts`) routes requests via the `SmartRouter`.

### Concurrency / Threading Model
- **Server**: Single Node.js process, async I/O.
- **AI Queue**: Background AI calls run through a `ParallelQueue` (max 5 concurrent per model). QuotaTracker enforces RPM/RPD limits based on model tier (Lite/Flash/Pro).

## 3. Data Models & Database Schema
- **`contacts`**: Primary entity boundary. Contains canonical IDs, geo coords, and expansion terms.
- **Child Arrays**: Normalized tables (emails, phones, tags, etc.) with `contactId` FK and strict `ON DELETE CASCADE`.
- **`interactions` / `interaction_mentions`**: Timeline nodes and bi-directional @mentions.
- **`action_items`**: Tasks triggered automatically by SQLite triggers.
- **`lists` / `list_members`**: Groups and organization.

### Critical Rules (Virtual Tables)
**`vec0` virtual tables do NOT support foreign key cascading.**
- `contacts_fts`: FTS5 full-text search index.
- `search_embeddings`: `vec0` 384-dim local embeddings (`Xenova/all-MiniLM-L6-v2`).
- `contact_embeddings`: `vec0` 768-dim Gemini embeddings for deduplication.
When deleting or merging contacts, you MUST manually execute `DELETE FROM search_embeddings WHERE contactId = ?` and `DELETE FROM contact_embeddings WHERE contactId = ?`.

### Schema Change Process
Modify `src/db/schema.ts`, then run `npm run db:generate` to create a Drizzle Kit migration. The server applies pending migrations automatically on startup. Virtual tables are maintained separately in `server/db.ts`.

## 4. API Contracts
All client-server communication goes through Express routes in `server/routes/`. The frontend accesses these strictly via TanStack React Query hooks located in `src/api/`. 

## 5. External Integrations / AI
- **LLM**: Google Gemini (via `@google/genai` adapter).
- **Local Embeddings**: `@huggingface/transformers` running `Xenova/all-MiniLM-L6-v2` locally in Node.js for 0ms network latency.
- **Deduplication Engine**: Multi-pass blocking (Double Metaphone, email exact-match), Pairwise scoring, Union-Find clustering.
- **Geocoding**: Mapbox/Nominatim.

## 6. Invariants & Safety Rules
- **NEVER** write native `useEffect` fetch loops for data fetching. Use React Query exclusively.
- **NEVER** silently swallow errors with empty `.catch(() => {})`. All async operations must log errors defensively.
- **MUST** manually clean up vec0 table rows (`search_embeddings`, `contact_embeddings`) when deleting contacts.
- **Local-First**: The database is SQLite. Network round-trips to managed external DBs for core storage are forbidden.

## 7. Error Handling Patterns
- Centralized error handling across all Express routes using the `AppError` class and an `asyncHandler` higher-order function.
- Node routes inject a Request UUID for trace logging across the full lifecycle.

## 8. Directory Structure
- `server/ai/` — Provider-agnostic AI adapters and SmartRouter
- `server/routes/` — Thin Express controllers
- `server/services/` — Core business logic (dedupe, search, geocoding)
- `src/api/` — React Query hooks
- `src/hooks/` — Custom React hooks (e.g., `useInstantSearch`, `useQueryTokenizer`)
- `src/components/command-palette/` — Cmd+K command center state machine
- `src/db/schema.ts` — Drizzle ORM schema

## 9. Local Development
- **Install**: `npm install`
- **Start Dev Server**: `npm run dev` (starts Vite on 5173, Express on 3001)
- **Seed Data**: `npm run seed` (drops DB, repopulates demo data)
- **Migrations**: `npm run db:generate`
- **Required Environment**: `GEMINI_API_KEY` (must be set in `.env`)

## 10. Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `AI_TIER` | No | Optional tier override (e.g., `paid`) |
| `MAPBOX_API_KEY` | No | Optional API key for map features |
