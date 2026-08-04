<div align="center">
  <h1>🤝 Contrack</h1>
  <p><b>People Relationship Manager for Proactive Networking</b></p>

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node.js Version](https://img.shields.io/badge/Node.js-22+-success)](https://nodejs.org/)
[![SQLite WAL](https://img.shields.io/badge/Database-SQLite3_WAL-003B57?logo=sqlite)](https://sqlite.org/)
[![React 19](https://img.shields.io/badge/Frontend-React_19-61DAFB?logo=react)](https://react.dev/)
[![Tailwind v4](https://img.shields.io/badge/Styling-Tailwind_v4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-316_passing-brightgreen)](https://vitest.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
</div>

<br/>

Relationships are your most valuable asset, but they're also the hardest thing to keep track of. Contacts scattered across Apple, Google, and LinkedIn. Names you recognize but can't quite place. Introductions you meant to follow up on but never did. **Contrack fixes that.**

Sync your contacts from every source into one unified network with automatic dedupe across platforms. Let AI enrichment research your connections across the web and fill in the context you never had time to enter. Behind the scenes, proactive intelligence keeps watch over your network and nudges you to reconnect before important relationships go quiet.

---

## ✨ Features

<table>
<tr>
<td width="30%" valign="top">

### 👤 Rich Contact Profiles

Get a complete picture of every connection instantly. View their interaction history, personal details, and relationship context all in one beautifully designed profile card.

Built with a timeline architecture featuring @mention network weaving, AI briefings, Ghost entity extraction, multi-value fields, and data age halos.

</td>
<td width="70%">

<img src="docs/screenshots/contact-detail.png" alt="Rich Contact Profile Detail" width="100%" />

</td>
</tr>
<tr>
<td width="30%" valign="top">

### ⌘ Command Palette (Cmd+K)

Navigate your entire network at lightning speed without ever touching your mouse. Instantly search contacts, log new notes, or jump to specific views using keyboard shortcuts.

A GitHub-style command center featuring faceted filters (`role:`, `company:`, `tag:`), action sub-menus, and an inline note composer for zero-state CRM intelligence.

</td>
<td width="70%">

<img src="docs/screenshots/command-pallette.png" alt="Command Palette" width="100%" />

</td>
</tr>
<tr>
<td width="30%" valign="top">

### 💓 Relationship Pulse

Never let an important connection slip through the cracks again. This proactive dashboard automatically tracks your network health and suggests who you should reach out to next.

Runs on an automated scoring engine (frequency × recency × depth) to power action item swimlanes and generate daily AI insights.

</td>
<td width="70%">

<img src="docs/screenshots/pulse-dashboard.png" alt="Relationship Pulse Dashboard" width="100%" />

</td>
</tr>
<tr>
<td width="30%" valign="top">

### 🗺️ Geospatial Mapping

Visualize your network geographically to plan trips or coordinate local meetups. See exactly where your connections are clustered around the globe at a glance.

Interactive cluster map powered by React Leaflet, utilizing Mapbox and Nominatim for accurate backend geocoding and detail overlays.

</td>
<td width="70%">

<img src="docs/screenshots/map.png" alt="Geospatial Mapping Dashboard" width="100%" />

</td>
</tr>
<tr>
<td width="30%" valign="top">

### 🔍 Ask Contrack (AI Search)

Query your CRM using natural language just like you're talking to an assistant. Ask complex questions like "Who do I know in San Francisco that works in tech?" and get precise answers.

Driven by a Hybrid RAG pipeline combining FTS5 + local vector KNN via Reciprocal Rank Fusion, with instant retrieval (<15ms) and streaming AI-enriched reasoning.

</td>
<td width="70%">

<img src="docs/screenshots/search.png" alt="Ask Contrack AI Search" width="100%" />

</td>
</tr>
<tr>
<td width="30%" valign="top">

### ⚡ Intelligent Deduplication

Keep your database impeccably clean with an automated assistant that spots duplicate contacts for you. Review merged suggestions quickly with an intuitive swipe interface.

Multi-pass engine utilizing Double Metaphone phonetic matching, Levenshtein distance, E.164 phone normalization, and 768-dim AI embeddings with one-click undo.

</td>
<td width="70%">

<img src="docs/screenshots/dedupe-engine.png" alt="Intelligent Deduplication Review" width="100%" />

</td>
</tr>
</table>

### More Capabilities

- **Magic Paste** — Paste unstructured text, AI extracts a structured contact
- **Multi-Provider AI** — Gemini (default), OpenAI, or Anthropic via provider-agnostic adapters
- **Smart Router** — Automatic Gemini model selection (Lite/Flash/Pro) per use case
- **Batch Enrichment** — AI-powered web research to hydrate contact profiles
- **Custom Lists** — Unlimited groups with icons, drag-to-reorder, bulk membership
- **Doc2Query** — Write-time search expansion via AI for better recall
- **Ghost Detection** — Passive entity extraction from notes creates ghost contacts
- **@Mentions** — Bi-directional relationship graph via Tiptap rich text
- **AI Cache Telemetry** — Multi-tiered LRU caching with full transparency dashboard
- **Enterprise Virtualization** — <20ms page transitions for 100K+ contacts
- **Quick Note** (`Cmd+Shift+I`) — Log interactions from anywhere
- **Link Unfurling** — Zero-Chromium OpenGraph extraction via Cheerio
- **Logo Proxy** — Heuristic company logo discovery with local caching
- **Trash & Undo** — Deletes are soft: restore from Settings → Trash within 30 days
- **Automatic Backups** — Scheduled SQLite snapshots with rotation, plus one-click JSON/CSV export
- **Single-User Auth** — Token-gated API + sign-in screen; secure-by-default in Docker

---

## 🚀 Quick Start

**Try it locally in under 60 seconds.**

### Option 1: Docker (Recommended)

The easiest way to run Contrack is via Docker Compose. This ensures all native dependencies (like `sqlite-vec`) work perfectly.

```bash
git clone https://github.com/arvarik/contrack.git
cd contrack
cp .env.example .env
# Add your API key (GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY)
docker-compose up -d
```

Open **http://localhost:3210**. Data is automatically persisted to `./data`. Authentication is on by default in Docker — grab your access token with `docker logs contrack | grep "Access token"` (or set `AUTH_TOKEN`).

### Option 2: Native Installation

```bash
git clone https://github.com/arvarik/contrack.git
cd contrack
npm install
cp .env.example .env
# Add your API key (GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY)
npm run dev
```

Open **http://localhost:3210**. The server auto-initializes the database, loads embedding models, and starts background tasks.

> **Seed data:** Run `npm run seed` to populate with demo contacts.

---

## 🛠️ Technology Stack

| Domain       | Technology                                                            |
| ------------ | --------------------------------------------------------------------- |
| **Frontend** | React 19, Vite 6, React Query v5, Tailwind CSS v4, Tiptap, Motion     |
| **Backend**  | Node.js 22, Express, TypeScript (tsx), Zod validation                 |
| **Database** | SQLite3 (WAL mode), Drizzle ORM, FTS5, sqlite-vec                     |
| **AI**       | Gemini / OpenAI / Anthropic (provider-agnostic adapter pattern)       |
| **Search**   | Hybrid RAG: FTS5 keyword + 384-dim local vector KNN (Transformers.js) |
| **Mapping**  | React Leaflet + Leaflet Cluster, Mapbox/Nominatim geocoding           |
| **Testing**  | Vitest — 180 tests, <600ms                                            |

---

## 📚 Documentation

Full documentation lives in the [`docs/`](docs/) directory:

| Guide                                      | Description                                           |
| ------------------------------------------ | ----------------------------------------------------- |
| [Getting Started](docs/getting-started.md) | Installation, first boot, scripts, keyboard shortcuts |
| [Configuration](docs/configuration.md)     | Environment variables, AI provider setup, tier tuning |
| [Architecture](docs/architecture.md)       | System overview, data flow, schema, caching           |
| [API Reference](docs/api-reference.md)     | Complete REST API with curl and JavaScript examples   |

### Feature Guides

| Feature            | Guide                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| Contact Management | [docs/features/contact-management.md](docs/features/contact-management.md) |
| Command Palette    | [docs/features/command-palette.md](docs/features/command-palette.md)       |
| AI Search          | [docs/features/ai-search.md](docs/features/ai-search.md)                   |
| Deduplication      | [docs/features/deduplication.md](docs/features/deduplication.md)           |
| Pulse Dashboard    | [docs/features/dashboard-pulse.md](docs/features/dashboard-pulse.md)       |
| Map View           | [docs/features/map-view.md](docs/features/map-view.md)                     |
| Lists              | [docs/features/lists.md](docs/features/lists.md)                           |

---

## 🔐 Environment Variables

| Variable            | Description                                                   | Default      |
| ------------------- | ------------------------------------------------------------- | ------------ |
| `AI_PROVIDER`       | LLM provider: `gemini`, `openai`, `anthropic`                 | `gemini`     |
| `GEMINI_API_KEY`    | Gemini API key                                                | —            |
| `OPENAI_API_KEY`    | OpenAI API key                                                | —            |
| `ANTHROPIC_API_KEY` | Anthropic API key                                             | —            |
| `AI_TIER`           | `FREE` or `PAID` rate limit profile                           | `FREE`       |
| `PORT`              | Express listening port                                        | `3210`       |
| `HOST`              | Bind interface (`0.0.0.0` to expose on LAN)                   | `127.0.0.1`  |
| `AUTH_TOKEN`        | Single-user auth token (gates `/api` + `/uploads`)            | — (off)      |
| `AUTH_REQUIRED`     | `true` = enforce auth with a generated token (Docker default) | `false`      |
| `DATA_DIR`          | Root for runtime data (DB, uploads, model cache)              | project root |
| `MAPBOX_API_KEY`    | Mapbox geocoding (optional, higher accuracy)                  | —            |

See [Configuration Guide](docs/configuration.md) for full details.

---

## ⚡ System Architecture

```mermaid
graph TD
    subgraph Frontend ["UI Layer — React 19 / Vite"]
        RQ["React Query v5"] --> TW["Tailwind v4 'No-Line' UI"]
        TW --> TT["Tiptap Editor + Cheerio Previews"]
        TT --> Map["React Leaflet Geospatial"]
    end

    subgraph Backend ["Node.js Express Server"]
        EX["Express Router"] --> SVC["Service Layer"]
        SVC --> AI["AI Service + Smart Router"]
        SVC --> SRCH["Ask Contrack v3 Spotlight"]
        SVC --> DDP["Dedupe Engine"]
        SVC --> REL["Relationship Scoring"]
    end

    subgraph Storage ["Persistence — Local-First"]
        SQL[("SQLite3 WAL Mode")]
        DZ["Drizzle ORM"] --> SQL
        FTS["FTS5 Search Index"] --- SQL
        VEC["sqlite-vec Embeddings"] --- SQL
    end

    subgraph AILayer ["AI Infrastructure"]
        SR["Smart Router"] --> Adapters["Gemini / OpenAI / Anthropic"]
        SR --> QT["Quota Tracker + Parallel Queue"]
        LE["Transformers.js Local"] --> VEC
    end

    Frontend <===>|"JSON REST + UUID Tracing"| Backend
    AI <===>|"Smart Router model selection"| AILayer
    Backend <===>|"Drizzle ORM"| Storage
```

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development standards, code style, and PR process.

---

## 📜 License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE). This means you can use, modify, and distribute the code, but any modified versions — including those offered as a network service (SaaS) — must also be open-sourced under AGPL v3.
