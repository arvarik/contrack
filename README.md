<div align="center">
  <img src="https://via.placeholder.com/150x150.png?text=Contrack+Logo" alt="Contrack Logo" width="120" height="120"/>
  <h1>🤝 Contrack CRM</h1>
  <p><b>The Personal AI Relational Engine for High-Leverage Individuals</b></p>
  
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
  [![Node.js Version](https://img.shields.io/badge/Node.js-22+-success)](https://nodejs.org/)
  [![SQLite WAL](https://img.shields.io/badge/Database-SQLite3_WAL-003B57?logo=sqlite)](https://sqlite.org/)
  [![React 19](https://img.shields.io/badge/Frontend-React_19-61DAFB?logo=react)](https://react.dev/)
  [![Tailwind v4](https://img.shields.io/badge/Styling-Tailwind_v4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
  [![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6?logo=typescript)](https://www.typescriptlang.org/)
  [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
</div>

<br/>

## 📖 Table of Contents
- [Philosophy & Vision](#-philosophy--vision)
- [System Architecture](#-system-architecture)
- [Key Capabilities & Engineering Specs](#-key-capabilities--engineering-specs)
- [Technology Stack](#-technology-stack)
- [Database Overview](#-database-overview)
- [UI/UX Architecture](#-uiux-architecture-the-no-line-hierarchy)
- [API Integration Contracts](#-api-integration-contracts)
- [Zero-Friction Deployment](#-zero-friction-deployment)
- [Environment Variables](#-environment-variables)
- [Available Scripts](#-available-scripts)
- [Roadmap](#-roadmap)
- [Contribution & Maintenance Standards](#-contribution--maintenance-standards)
- [License](#-license)

---

## 🧭 Philosophy & Vision

Contrack isn't just an address book; it is a **Personal AI Relational Engine**. Engineered for creative directors, freelancers, and executives, Contrack intelligently weaves context, deduplicates massive datasets locally, and autonomously uncovers hidden network connections. 

By combining the blazing speed of local-first SQLite architecture with the analytical power of modern Edge LLMs (`gemini-1.5-flash`), Contrack ensures your professional network is tracked seamlessly without the heavy cognitive load of manual data entry. **You write the notes—the AI builds the relational graph.**

Gone are the days of manually typing out structured `First Name`, `Last Name`, `Company` forms. Paste raw unstructured text, drag in an email export, or just brain-dump your meeting notes into the timeline. Contrack parses the chaotic unstructured inputs into highly robust, strictly-typed Drizzle ORM models under the hood.

---

## ⚡ System Architecture

Contrack uses a highly durable, localized architecture designed for zero-latency lookups and frictionless deployments. Every architectural decision prioritizes local data ownership, blistering execution times, and maximum robustness.

```mermaid
graph TD
    %% Frontend Layer
    subgraph Frontend [UI Layer - React 19 / Vite]
        R[(React Query v5)] --> C[Tailwind v4 'No-Line' UI]
        C --> T[Tiptap Editor + Cheerio Previews]
        T --> Map[React Leaflet Geospatial]
    end

    %% Backend Layer
    subgraph Backend [Edge Node.js Express]
        E(Express Router)
        E --> M[Multer Media Uploads]
        E --> GenAI[@google/genai Service Layer]
    end

    %% Storage Layer
    subgraph Storage [Persistence - Local]
        SQL[(SQLite3 WAL Mode)]
        D[Drizzle ORM] --> SQL
        FTS[FTS5 Search Index]
        SQL --- FTS
    end

    %% AI Layer
    subgraph Cloud [External AI]
        GEMINI[Google Gemini 1.5 Flash]
    end

    %% Connections
    Frontend <==>|JSON REST + UUID Tracing| Backend
    GenAI <==>|Strict JSON Schema bounds| GEMINI
    Backend <==>|Drizzle ORM DDL| Storage
```

---

## 🚀 Key Capabilities & Engineering Specs

Contrack replaces traditional CRM chores through background asynchronous processing and optimized data structures.

### 1. "Catch-Me-Up" AI Briefing
Walking into a high-stakes meeting? The `generateCatchMeUpBriefing` pipeline feeds up to 3 years of scattered meeting notes, emails, and timeline logs into Gemini. It utilizes strict JSON bounding to enforce a highly compressed, 3-bullet executive summary (Wins, Projects, Open Loops), granting immediate context parsing without hallucination drift.

### 2. Bi-Directional Network Weaving (Implicit Graph Tracking)
Type `@someone` in any interaction payload via the **Tiptap Rich Interaction Composer**. The system's asynchronous AI parser sweeps the text payload, identifying proper nouns and executing exact-match queries against the CRM. It generates an unbreakable bi-directional connection inside the `interaction_mentions` junction table, instantly mapping nodes together ("who knows who").

### 3. "Ghost" Entity Extraction
A critical data-harvesting innovation. The AI passively observes your notes. If it identifies organizational entities or human names not present in the DB, it silently registers them as "Ghost" nodes (`isGhost = 1`). When you eventually interact with them, their profile effortlessly upgrades to a formal node, pre-hydrated with historical mentions mapping back to when they were first spoken of.

### 4. Zero-Chromium Native Link Unfurling
Instead of relying on heavy Puppeteer sub-processes that drain local memory, Contrack utilizes `cheerio` HTML parsers. When URLs are pasted into the interface, the backend intercepts the fetch, parses OpenGraph (`og:title`, `og:image`, `og:description`) headers rapidly, and caches the localized payload injected natively back into the timeline UI.

### 5. `.eml` Digestion & Data Polymorphism
Drag raw `.eml` exports into the UI. The Express backend rips the MIME structure apart while Gemini 1.5 strips noisy HTML signatures and redundant email reply-chains. The result is a clean, markdown-formatted conversational thread injected synchronously into the timeline, entirely bypassing cluttered email UI paradigms.

### 6. Levenshtein-Bounded Deduplication
CRMs rot from data duplication. Our backend actively scans the schema utilizing Levenshtein-distance string algorithms and E.164 phone normalization checks. It exposes highly probable "clones" to the `/api/dedupe/suggestions` endpoint, empowering 1-click timeline merges that execute within single SQL transactions to prevent data partition failures.

### 7. Geospatial Mapping Component
Automatically maps parsed `lat`/`lng` coordinates globally using `react-leaflet`. Contacts interact natively with coordinate data to visualize where your network density physically resides.

---

## 🛠️ Technology Stack

| Domain | Technology | Justification |
|---|---|---|
| **Frontend Framework** | `React 19` + `Vite 6` | Cutting edge concurrent rendering and instantaneous HMR. |
| **Data Fetching** | `@tanstack/react-query v5` | Declarative cache invalidation, SSR support, and query deduplication. |
| **Styling** | `Tailwind CSS v4` | Predictable utility classes bounded by our strict "No-Line" UI hierarchy. |
| **Rich Text Engine** | `Tiptap` + `@tiptap/pm` | Block-based headless component yielding total aesthetic control overriding standard PM boundaries. |
| **Backend Server** | `Node 22` + `Express` | Stable, unyielding async handling for edge capabilities. |
| **Database** | `Better-SQLite3` + `Drizzle ORM`| Write-Ahead Logging (WAL) synchronous performance without the Postgres overhead. Full-Text Search (FTS5). |
| **AI Inference** | `@google/genai` (Gemini 1.5 Flash) | Superior high-context-window ingestion for unstructured text summarization and JSON extraction. |
| **Animation** | `Motion` | Micro-interactions and fluid layout transitions. |
| **Mapping** | `Leaflet` + `React-Leaflet` | Client-side map cluster rendering. |

---

## 🗄️ Database Overview

Contrack employs a highly normalized, cleanly segregated Drizzle schema running on top of localized SQLite. Operations enforce `ON DELETE CASCADE` down to the metal.

Key Tables:
*   `contacts`: The primary demographic node (stores `id`, `name`, `birthday`, `cadenceDays`, `aiBriefing`, `isGhost`).
*   `contact_emails`, `contact_phones`, `contact_social_links`: 1:N relations supporting multi-value deduplication and provenance (`source`).
*   `contact_education`, `contact_experience`: Timeline-specific data for chronological history.
*   `interactions`: The overarching timeline log (calls, notes, emails, meetings).
*   `interaction_mentions`: The physical junction table generating the explicit graph connecting `interactions` to multiple `contacts`.

*Refer to `src/db/schema.ts` for raw typescript DDL modeling.*

---

## 🎨 UI/UX Architecture: The "No-Line" Hierarchy

Engineered for maximum optical cleanliness, the CRM follows strict Tailwind CSS v4 token constraints documented in `workflows/design-system.md`.

- **Zero Borders Rule**: Standard 1px `border-gray-200` sections are explicitly banned. Containment is represented exclusively through surface background shifts:
  - `surface` (Base layer)
  - `surface-container-low` (Secondary sections)
  - `surface-container-lowest` (Cards and high-focus nodes)
- **Glassmorphism & Z-Depth**: Modals and dropdowns utilize backdrop blurs layered on opaque backgrounds to enforce optical priority without heavy drop-shadows.
- **Micro-Animations**: Uses `motion` to stagger elements, fade inputs, and transition states smoothly to elevate the UI far above traditional data-entry screens.

---

## ⌨️ Keyboard Shortcuts

Contrack is built for speed and efficiency. Below are the global and component-specific keyboard shortcuts currently implemented:

### Global
- \`Cmd + K\` or \`Ctrl + K\`: Open/Toggle the Command Palette (Quick Actions / Semantic Search).

### Navigation (Contact List)
- \`Arrow Down\` or \`j\`: Navigate to the next contact in the list.
- \`Arrow Up\` or \`k\`: Navigate to the previous contact in the list.
- \`Enter\`: Quickly focus the Rich Interaction Composer (when on a contact detail page, not focused on an input).

### Rich Interaction Composer
- \`Cmd + Enter\` or \`Ctrl + Enter\`: Save and log the current interaction (Note, Call, Meeting, Email).

### @Mentions Dropdown
- \`Arrow Up\` / \`Arrow Down\`: Navigate the suggestion list.
- \`Enter\`: Select the highlighted contact.
- \`Escape\`: Close the mentions dropdown.

### The Singularity (Cleanup View)
- \`Right Arrow\` or \`l\`: Focus the next duplicate suggestion.
- \`Left Arrow\` or \`h\`: Focus the previous duplicate suggestion.
- \`m\`: Merge the currently focused contact pair.
- \`d\`: Dismiss/ignore the currently focused contact pair.

---

## 🔌 API Integration Contracts

The Express backend acts as a monolithic REST interface. Below are critical path contracts. All payload requests/responses are handled as `application/json`.

### Entity Hydration & Mutation
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/contacts` | Fetch global rolodex. Supports `?q=` leveraging FTS5 indexing. |
| `GET` | `/api/contacts/:id` | Deep-fetch a specific node. Hydrates all child arrays (phones, emails, experiences). |
| `POST` | `/api/contacts` | Ingest explicit nodes. |
| `PUT` | `/api/contacts/:id` | Idempotent updates for nested schemas. |
| `DELETE`| `/api/contacts/:id` | Executes physical cascade drops. |
| `POST` | `/api/parse-contact` | Natively parses unstructured text arrays via AI, returning structured Drizzle models. |

### Temporal Event Topology
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/contacts/:id/timeline` | Fetch chronological multi-cast views overlapping `interactions` and `interaction_mentions`. |
| `POST` | `/api/contacts/:id/interactions`| Append logs, triggering async `extractMentions` sweeps natively. |

### Media, Automation, & Geographic Intersections
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/contacts/:id/briefing` | Engages Gemini boundary for 3-bullet Catch-Me-Up payload generation. |
| `POST` | `/api/contacts/:id/promote` | Triggers a state transition shifting a node from "Ghost" to Explicit status. |
| `GET` | `/api/utils/unfurl` | Validates and parses external URI references via `cheerio` returning OpenGraph attributes securely. |
| `GET` | `/api/contacts/map` | Exposes global geometry intersections clustering entities for mapping views. |

---

## 🚀 Zero-Friction Deployment

### Prerequisites
- Node.js 22+ (Mandatory for optimal SQLite native driver hooks)
- A valid Gemini Edge token (`GEMINI_API_KEY` from Google AI Studio)
- Git

### 1. Developer Bootstrap
```bash
git clone https://github.com/my-acc/contrack.git
cd contrack

# Install modern dependencies
npm install

# Setup environment
cp .env.example .env
```
*Note: Ensure you edit the `.env` file to include your `GEMINI_API_KEY` and `APP_URL`.*

**Database Note:** Contrack deliberately ignores Drizzle CLI migrations for bootstrapping. The database auto-heals and reconstructs DDL mapping strings synchronously over `sqlite.exec()` during runtime initialization, preventing schema drift on fresh installs.

To hydrate synthetic testing entities:
```bash
npm run seed
```

### 2. Local Execution
```bash
npm run dev
```
Navigate to `http://localhost:3000`. Hot Module Replacement (HMR) protects client state while the isolated backend tracks modifications seamlessly via `tsx`.

### 3. Production Hardening
When preparing the monolith for VPS instances (AWS, Hetzner, Railway):
1. **Compile Application Bounds**:
   ```bash
   npm run build
   ```
2. **Execute Node Binary**:
   ```bash
   NODE_ENV=production npx tsx server.ts
   ```
*Warning:* When deploying via Docker, heavily restrict the configuration to ensure mapping an absolute path volume to the SQLite `.db` matrix. Ephemeral containers will instantly destroy the WAL files on reboot without a hard-linked persistent volume.

---

## 🔐 Environment Variables

| Variable | Description | Requirement |
|---|---|---|
| `GEMINI_API_KEY` | Required for all Gemini AI operations (summaries, text parses). | **Required** |
| `APP_URL` | The domain/URL where the app is hosted (e.g. `http://localhost:3000`). | Optional/Local |
| `PORT` | Listening port for Express. Defaults to `3000`. | Optional |

---

## 💻 Available Scripts

- `npm run dev`: Boots Vite UI + TSX Express backend concurrently.
- `npm run build`: Compiles production localized bounds using Vite.
- `npm run preview`: Test local prod build.
- `npm run seed`: Clears the DB and repopulates synthetic, pseudo-realistic demo data.
- `npm run lint`: Validates strictly typed configurations inside typescript without emitting traces.
- `npm run clean`: Purges `dist/` caching bundles.

---

## 🗺️ Roadmap
- [ ] End-to-End Encryption (E2EE) for at-rest SQL databases.
- [ ] Calendar CalDAV sync ingestion to natively hydrate meetings without clicking.
- [ ] iOS/Android PWA optimized layout.
- [ ] Enhanced Network Visualization (Canvas/d3 graph rendering).

---

## 🤝 Contribution & Maintenance Standards

As a principal-grade open-source system, Contrack adheres to rigid operational standards:

- **Local-First Speed**: Network round-trips to managed DBs are eliminated. Avoid submitting PRs that push database calls over HTTP boundaries.
- **No `any` Typings**: Ensure all UI props, API responses, and Express payloads define strict TypeScript interfaces.
- **Fetch Purity**: New frontend data requirements must extend React Query hooks. Raw `useEffect` loops are globally banned for remote fetch.
- **Styling constraints**: Leverage existing Tailwind layout combinations. Do not invent manual margins/paddings or colors outside the `surface` palettes. *(See `workflows/design-system.md`)*.

Contributions should be made via Pull Requests. Please add or modify tests for any new features to maintain data integrity.

---

## 📜 License

This project is open-sourced under the [MIT License](https://opensource.org/licenses/MIT). You are free to utilize, morph, and deploy instances of Contrack per your specific workflow demands.
