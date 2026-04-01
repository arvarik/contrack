# Contrack 

**Contrack** is a high-performance, keyboard-first "People CRM" tailored for power users who want maximum density and minimum latency. Inspired by the speed and aesthetic of tools like Superhuman and Linear, Contrack eschews slow modals and paginated tables in favor of an instantly responsive Master-Detail layout powered by deeply optimistic UI components.

## Features

- **Blazing Fast SQLite Backend:** Built over `better-sqlite3` and `drizzle-orm`, running in WAL mode with instant local caching.
- **Global Command Palette:** Hit `Cmd+K` from anywhere to trigger an FTS5 (Full-Text Search) powered contact query or quick-action executor.
- **Optimistic UI with React Query:** Every action (adding a note, changing a contact's role, logging a meeting) writes to the SQLite backend while instantly updating the React layout. No spinners.
- **Frictionless Entry & Navigation:** Log interactions with a simple headless text composer using `Cmd+Enter`. Zip through your contacts natively using `J/K` or `ArrowUp/Down` traversing the master list perfectly with scrolling auto-managed without touching your mouse.
- **Smart Clipboard Auto-Parser:** Copy any messy block of text (email signatures, bios) and click the Magic Paste (`Wand`) button. An Express backend hooks directly into Gemini `responseSchema` strict outputs to instantly return structured CRM fields, triggering a glowing pre-filled UI state securely.
- **Visual Health Rings:** Dynamic `<HealthRingAvatar />` components inject a sweeping animated SVG border around contact photos. Integrating `date-fns`, the rings natively update color mapping (Emerald > Amber > Rose) intuitively demonstrating the state of your relationship health at a glance.
- **AI Curated Briefings:** Read a contact's timeline and click "Generate AI Intel" to instantly extract sentiment, relationship health, and an actionable follow-up date via the Gemini model (extensible to Ollama).

## Tech Stack Overview

### Backend (`server.ts`)
- **Node.js + Express:** API layer routing and parsing.
- **Drizzle ORM:** Schema management and query building.
- **SQLite (better-sqlite3):** Highly-concurrent database file (`curator.db`), tuned with synchronous PRAGMAs.
- **FTS5:** A virtual search table automatically kept in sync via SQL Triggers for instant `Cmd+K` indexing.

### Frontend
- **Vite & React 19:** Fast bundling and modern React features.
- **Tailwind CSS v4:** Heavy use of CSS variables (Surface colors, on-surface text) designed specifically in `src/index.css` for a premium, dynamically-themed interface.
- **TanStack Query (React Query):** Complete decoupling of server state from the component tree.
- **cmdk:** Unstyled command palette primitive layered with Tailwind to construct the global `Cmd+K` handler.

## Installation & Setup

Ensure you have Node.js v20+ and `npm`.

\`\`\`bash
# 1. Install Dependencies
npm install

# 2. Push Schema to Database (Initializes curator.db)
npx drizzle-kit push

# 3. Configure AI API Key (Optional)
export GEMINI_API_KEY="your-google-ai-studio-key"

# 4. Start Development Server (Vite + Express)
npx tsx server.ts
\`\`\`

The server gracefully boots the Express backend on `http://localhost:3000` while proxying Vite for blazing hot modular replacement (HMR).

## Architecture Details

### The Database Design
- **`contacts` table:** Stores primitive user data (Name, Location, Birthday).
- **`interactions` table:** A unified append-only ledger for all Notes, Calls, Proposals, and Emails. Replacing sprawling join tables with a single timeline feed.
- **`contacts_fts` virtual table:** Instantly syncs text tokens on insertions/updates to power the global `cmdk` search query.

### Local AI via Ollama
By default, Contrack invokes `@google/genai` to analyze timeline feeds. For users seeking absolute self-hosting privacy, edit `src/services/geminiService.ts` to point the client Base URL towards `http://localhost:11434/v1` (the default OpenAI-compatible port for an active Ollama process running locally on your hardware).

## License

MIT - Open Source.
