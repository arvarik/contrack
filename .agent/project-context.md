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
Never utilize `drizzle-orm` migration scripts! The SQLite definitions execute securely on boot via raw literal strings (`sqlite.exec(...)`) parsing DDL structures. If you modify `src/db/schema.ts`, you **must** also map the update exactly inside `<app-root>/server/db.ts` DDL configurations.

## 3. AI Integrations & API Layer
AI tasks traditionally live under `aiService.ts` and route through the `server/routes/mcp.ts` and `server/routes/dedupe.ts` modules. All routines invoke `gemini-1.5-flash` (or newer) passing strictly bounded JSON schemas:
- **Entity Mentions**: Analyzes raw prose identifying semantic names formatting implicit "ghost" elements dynamically. (Triggered via `interactions.ts`)
- **Catch Me Up**: Reads chronological DB intersections wrapping structured executive briefs.
- **Link Unfurling**: Not technically AI, but bound dynamically behind `server.ts` utilizing `cheerio` explicitly bypassing computationally heavy Chrome Puppeteer tasks ensuring fast rich-media OG data generation securely mapped via `Tiptap` node extensions natively.

## 4. Bootstrapping Notes
- Node routes automatically inject Request UUID logging ensuring trace capabilities across terminal layers.
- If performing automated testing bounds, `npm run seed` drops baseline JSON profiles executing natively against the current instance mapping test nodes reliably. Ensure local `.env` bounds define `GEMINI_API_KEY` explicitly.
