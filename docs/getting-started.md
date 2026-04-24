# Getting Started

This guide walks you through installing Contrack, running it locally, and understanding what happens on first boot.

## Prerequisites

- **Node.js 22+** — [Download](https://nodejs.org/)
- **Git** — [Download](https://git-scm.com/)
- **An AI API key** (at least one):
  - [Gemini](https://aistudio.google.com/apikey) (default provider)
  - [OpenAI](https://platform.openai.com/api-keys)
  - [Anthropic](https://console.anthropic.com/settings/keys)

## Quick Start

```bash
git clone https://github.com/arvarik/contrack.git
cd contrack
npm install
cp .env.example .env
# Edit .env — add your API key for your chosen provider
npm run dev
```

Navigate to **http://localhost:3000**. You're ready.

## What Happens on First Boot

When the server starts for the first time, several background processes kick off automatically:

1. **Database initialization** — SQLite tables, FTS5 indexes, and `vec0` virtual tables are created
2. **Local embedding model** — Transformers.js downloads and caches `all-MiniLM-L6-v2` (384-dim) for Ask Contrack search
3. **Search embedding backfill** — Existing contacts get local vector embeddings for semantic search
4. **Dedupe embedding backfill** — If Gemini is configured, 768-dim embeddings are generated for deduplication
5. **Relationship scoring** — Full recompute of all relationship scores (runs hourly after boot)
6. **Retroactive geocoding** — Contacts with addresses but no coordinates get geocoded in the background

All of this is non-blocking — the UI is fully usable while background tasks run.

## Seed Data

Populate the database with realistic demo contacts for testing:

```bash
npm run seed
```

This creates ~50 demo contacts with names, companies, emails, phone numbers, tags, interactions, and relationship history. **Warning**: seeding clears the existing database.

## Production Deployment

```bash
npm run build
NODE_ENV=production npx tsx server.ts
```

> **Docker note:** Mount a persistent volume for the SQLite database file (`curator.db`). Ephemeral containers will destroy data on restart.

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite + Express dev server with HMR |
| `npm run build` | Compile production bundle via Vite |
| `npm run preview` | Preview production build locally |
| `npm run seed` | Clear DB and repopulate with demo data |
| `npm run lint` | TypeScript type-check (`tsc --noEmit`) |
| `npm test` | Run Vitest test suite (113 tests, <500ms) |
| `npm run db:generate` | Generate a Drizzle Kit migration after schema changes |
| `npm run clean` | Purge `dist/` build cache |

---

## Keyboard Shortcuts

### Global

| Shortcut | Action |
|----------|--------|
| `Cmd+K` / `Ctrl+K` | Toggle Command Palette |
| `Cmd+Shift+I` | Quick Note Modal |
| `Cmd+Shift+N` | Navigate to Network |
| `Cmd+Shift+P` | Navigate to Pulse |
| `Cmd+Shift+M` | Navigate to Map |
| `Cmd+Shift+S` | Navigate to AI Search |
| `Cmd+Shift+,` | Navigate to Settings |
| `Cmd+[` / `Cmd+]` | Browser back / forward |
| `/` | Focus active search bar |
| `?` | Toggle Keyboard Shortcuts Reference |
| `Escape` | Unfocus / close modals |

### Command Palette

| Shortcut | Action |
|----------|--------|
| `↑ / ↓` | Navigate results |
| `Enter` | Select / navigate to contact |
| `→` | Open Action Sub-Menu for focused contact |
| `←` or `Escape` | Go back one layer (sub-menu → results → close) |
| `Space` (hold) | Peek contact details (200ms delay) |
| `↑ / ↓` (empty input) | Browse search history |
| `Backspace` (empty input) | Remove last facet filter pill |
| `role:`, `company:`, etc. | Activate faceted filter autocomplete |

### Action Sub-Menu (inside Command Palette)

| Shortcut | Action |
|----------|--------|
| `↵` Enter | View Profile |
| `N` | Log Note (inline composer) |
| `C` | Log Call (inline composer) |
| `B` | Catch Me Up (AI briefing) |
| `L` | Add to List (inline picker) |

### Contact List

| Shortcut | Action |
|----------|--------|
| `↓` or `j` | Next contact |
| `↑` or `k` | Previous contact |
| `c` | New Contact modal |
| `v` | Magic Paste (AI extraction) |
| `Enter` | Focus interaction composer |

### Rich Interaction Composer

| Shortcut | Action |
|----------|--------|
| `Cmd+Enter` | Save interaction |

### @Mentions

| Shortcut | Action |
|----------|--------|
| `↑ / ↓` | Navigate suggestions |
| `Enter` | Select contact |
| `Escape` | Close dropdown |
