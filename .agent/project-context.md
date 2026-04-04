# Contrack CRM — Developer & AI Context

This file serves as the definitive anchor for understanding the architectural decisions, design system mandates, and schema topologies enforcing Contrack CRM.

## 1. Stack Conventions
- **Tooling**: Vite, React 19, Node.js + Express (run natively via `tsx` script loader).
- **Styles**: **Tailwind CSS v4**. *Do not use standard border properties (`border-gray-200`)*. The UI utilizes strict tokenized CSS shifts. A surface layer sits at `surface`. Secondary containers belong on `surface-container-low`. All cards and modals belong on `surface-container-lowest`. Read `workflows/design-system.md` for specific semantic mappings.
- **Data Flow**: The frontend utilizes explicit `fetch` calls wrapped via `useMutation` and `useQuery` exclusively relying on **React Query**. Never write native `useEffect` fetch loops.

## 2. Database (SQLite via Drizzle)
The CRM relies on a relational abstraction using SQLite operating in `WAL` mode. 

### Critical Relationships:
- **`contacts`**: The primary entity boundary. All scalar definitions live here (Name, AI Briefing blocks, Geolocation).
- **`child arrays`**: Emails, Phone numbers, Tags, and Experience chunks represent normalized external tables natively holding `contactId` bindings mapped with strict `ON DELETE CASCADE`.
- **`interactions`**: Represents the raw timeline nodes. 
- **`interaction_mentions`**: A specialized junction table mapping complex Bi-Directional network relationships explicitly connecting an `.interactionId` against a foreign `.contactId` explicitly. `server.ts` routes seamlessly output `isViaName` during database scans evaluating this junction matrix.

### Database Operations:
Schema changes are managed via **Drizzle Kit migrations**. After modifying `src/db/schema.ts`, run `npm run db:generate` to create a new tracked migration file. The server applies pending migrations automatically on startup via `drizzle-orm/better-sqlite3/migrator`. FTS5 virtual tables are maintained separately in `server/db.ts` since Drizzle ORM does not manage virtual tables.

## 3. AI Integrations & API Layer
AI operations live under the `server/ai/` module using a **provider adapter pattern**:
- **`server/ai/types.ts`**: Provider-agnostic type definitions shared across the AI layer.
- **`server/ai/provider.ts`**: Abstract `AIProvider` interface that all adapters implement.
- **`server/ai/adapters/gemini.ts`**: Concrete Gemini adapter — the **only file** that imports `@google/genai`.
- **`server/ai/aiService.ts`**: Business-logic facade exposing 5 functions (`parseContactRecord`, `generateCatchMeUpBriefing`, `extractMentions`, `summarizeEmlEmail`, `semanticContactSearch`). Programs against the abstract provider interface, never against SDK internals.
Routes import from `server/ai/aiService.ts`. To add a new LLM provider, create an adapter in `server/ai/adapters/` and register it in the `resolveProvider()` switch in `aiService.ts`.

## 4. Bootstrapping Notes
- Node routes automatically inject Request UUID logging ensuring trace capabilities across terminal layers.
- If performing automated testing bounds, `npm run seed` drops baseline JSON profiles executing natively against the current instance mapping test nodes reliably. Ensure local `.env` bounds define `GEMINI_API_KEY` explicitly.
