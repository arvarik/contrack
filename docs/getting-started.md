# Getting Started

This guide walks you through installing Contrack, running it locally, and understanding what happens on first boot.

## Prerequisites

- **Node.js 22+** — [Download](https://nodejs.org/)
- **Git** — [Download](https://git-scm.com/)
- **An AI API key** — any one is enough; Contrack picks a suitable model for
  each kind of work. Add more later to mix providers across tasks.
  - [Gemini](https://aistudio.google.com/apikey)
  - [OpenAI](https://platform.openai.com/api-keys)
  - [Anthropic](https://console.anthropic.com/settings/keys)

  You can also point Contrack at a self-hosted OpenAI-compatible server
  (Ollama, vLLM, LM Studio) from Settings → AI instead of using a key. Add it
  as a **custom endpoint** whose base URL ends in `/v1` — for Ollama that is
  `http://localhost:11434/v1`. See
  [Configuration](configuration.md#custom-endpoints-self-hosted--other-vendors).

## Quick Start

```bash
git clone https://github.com/arvarik/contrack.git
cd contrack
npm install
cp .env.example .env
# Edit .env — add one API key. Everything else is optional.
npm run dev
```

Navigate to **http://localhost:3210**. You're ready.

## What Happens on First Boot

When the server starts for the first time, several background processes kick off automatically:

1. **Database initialization** — SQLite tables, FTS5 indexes, and `vec0` virtual tables are created
2. **Local embedding model** — Transformers.js downloads and caches `all-MiniLM-L6-v2` (384-dim) for Ask Contrack search
3. **Search embedding backfill** — Existing contacts get local vector embeddings for semantic search
4. **Dedupe embedding backfill** — Contacts get vector embeddings for duplicate detection, using the same model as search (the local one by default, so no API key is needed)
5. **Relationship scoring** — Full recompute of all relationship scores (runs hourly after boot)
6. **Retroactive geocoding** — Contacts with addresses but no coordinates get geocoded in the background

All of this is non-blocking — the UI is fully usable while background tasks run.

## Seed Data

Populate the database with realistic demo contacts for testing:

```bash
npm run db:seed
```

This generates ~30 demo contacts with names, companies, emails, phone numbers,
tags, interactions, and relationship history. It only adds — **nothing is
deleted**, and it never clears the database.

There is also `npm run seed`, which inserts a single hand-written example
contact and skips entirely when the database already has any contacts. Both
scripts write to the same database the server uses (they honour `DATA_DIR`).

## Production Deployment

```bash
npm run build
NODE_ENV=production npx tsx server.ts
```

The production server serves the built `dist/`, enables the security headers
and CSP, and answers health probes at `GET /healthz` (no credential needed).
SIGTERM shuts it down cleanly — in-flight requests drain and the database
checkpoints before exit.

> **Docker note:** mount **`/app/data`** as a persistent volume — it holds
> the database, uploads, backups, and the embedding-model cache. That one
> mount is the entire persistence story; an ephemeral container loses all
> four on restart. See
> [Configuration → Database & Persistence](configuration.md#database--persistence).

---

## Available Scripts

| Script                  | Description                                                |
| ----------------------- | ---------------------------------------------------------- |
| `npm run dev`           | Start Vite + Express dev server with HMR                   |
| `npm run build`         | Compile production bundle via Vite                         |
| `npm run preview`       | Preview production build locally                           |
| `npm run db:seed`       | Generate ~30 realistic demo contacts (adds, never deletes) |
| `npm run seed`          | Insert one example contact; skips a non-empty database     |
| `npm run lint`          | ESLint + TypeScript strict type-check                      |
| `npm test`              | Run the full Vitest suite (unit + integration)             |
| `npm run test:watch`    | The same suite in watch mode                               |
| `npm run test:coverage` | The suite with a coverage report                           |
| `npm run test:contract` | Optional: real provider APIs (skips without keys)          |
| `npm run format`        | Prettier write; `format:check` is what CI enforces         |
| `npm run db:generate`   | Generate a Drizzle Kit migration after schema changes      |
| `npm run db:push`       | Push the Drizzle schema directly (dev only)                |
| `npm run clean`         | Purge `dist/` build cache                                  |

---

## Keyboard Shortcuts

### Global

| Shortcut           | Action                              |
| ------------------ | ----------------------------------- |
| `Cmd+K` / `Ctrl+K` | Toggle Command Palette              |
| `Cmd+Shift+I`      | Quick Note Modal                    |
| `Cmd+Shift+H`      | Navigate to Network                 |
| `Cmd+Shift+P`      | Navigate to Pulse                   |
| `Cmd+Shift+M`      | Navigate to Map                     |
| `Cmd+Shift+S`      | Navigate to AI Search               |
| `Cmd+Shift+,`      | Navigate to Settings                |
| `Cmd+[` / `Cmd+]`  | Browser back / forward              |
| `/`                | Focus active search bar             |
| `?`                | Toggle Keyboard Shortcuts Reference |
| `Escape`           | Unfocus / close modals              |

### Command Palette

| Shortcut                  | Action                                         |
| ------------------------- | ---------------------------------------------- |
| `↑ / ↓`                   | Navigate results                               |
| `Enter`                   | Select / navigate to contact                   |
| `→`                       | Open Action Sub-Menu for focused contact       |
| `←` or `Escape`           | Go back one layer (sub-menu → results → close) |
| `Space` (hold)            | Peek contact details (200ms delay)             |
| `↑ / ↓` (empty input)     | Browse search history                          |
| `Backspace` (empty input) | Remove last facet filter pill                  |
| `role:`, `company:`, etc. | Activate faceted filter autocomplete           |

### Action Sub-Menu (inside Command Palette)

| Shortcut  | Action                      |
| --------- | --------------------------- |
| `↵` Enter | View Profile                |
| `N`       | Log Note (inline composer)  |
| `C`       | Log Call (inline composer)  |
| `B`       | Catch Me Up (AI briefing)   |
| `L`       | Add to List (inline picker) |

### Contact List

| Shortcut   | Action                      |
| ---------- | --------------------------- |
| `↓` or `j` | Next contact                |
| `↑` or `k` | Previous contact            |
| `c`        | New Contact modal           |
| `v`        | Magic Paste (AI extraction) |
| `Enter`    | Focus interaction composer  |

### Rich Interaction Composer

| Shortcut    | Action           |
| ----------- | ---------------- |
| `Cmd+Enter` | Save interaction |

### @Mentions

| Shortcut | Action               |
| -------- | -------------------- |
| `↑ / ↓`  | Navigate suggestions |
| `Enter`  | Select contact       |
| `Escape` | Close dropdown       |
