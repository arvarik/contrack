# Contrack CRM - Agent Context & Architecture Guide

Welcome to **Contrack**, a self-hosted "People CRM" designed to run on a local home server or NAS. This file provides comprehensive context, architectural decisions, and technology stack details for any AI agent interacting with this repository.

## 🎯 Core Philosophy
Contrack is designed as a **high-performance, high-density, keyboard-first productivity tool** (inspired by Linear and Superhuman). It is modal-free, preferring inline edits, instantaneous master-detail pane transitions, and background asynchronous data mutations to keep the user entirely within flow.

## 🎨 Design System & Styling
- **The "No-Line" Rule**: 1px solid borders are strictly prohibited for sectioning. Boundaries must be defined solely through background color shifts (`surface`, `surface-container-low`, `surface-container-lowest`).
- **Surface Hierarchy**: Treated as a physical stack of fine paper:
  - Base Layer: `surface` (bg hash #f5f6f9)
  - Sectional Layer: `surface-container-low` (e.g. sidebars or list panes)
  - Interactive/Card Layer: `surface-container-lowest`
- **Centralized Style Dictionary**: All repeated Tailwind class string patterns (cards, headings, pills, buttons) MUST be exported from `src/lib/styles.ts`. Components import and compose them using `cn(...)`. Avoid copy-pasting inline Tailwind strings.
- **Glassmorphism**: Reserved exclusively for floating UI elements like the Command Palette and Modals using backdrop blur techniques.
- **CSS Layers**: `src/index.css` acts as the definitive design token provider, hosting `@theme` configs for Tailwind v4.

## 🛠️ Technology Stack
- **Frontend Framework**: React 19 via Vite.
- **Styling**: Tailwind CSS v4, `clsx`, `tailwind-merge`, and `src/lib/styles.ts` for centralized patterns.
- **State Management**: TanStack React Query (`@tanstack/react-query`) for all remote server state. No Redux/Zustand required.
- **Routing**: `react-router-dom` (Hash or BrowserRouter).
- **Animation**: `motion/react` (Framer Motion) exclusively used for `layoutId` shared-element transitions between List and Detail views.
- **Backend Framework**: Node.js + Express (`server.ts`).
- **Database**: SQLite locally via `better-sqlite3`.
- **ORM**: Drizzle ORM (`drizzle-orm`, `drizzle-kit`) mapped in `src/db/schema.ts`.

## 🏗️ Architecture & Vital Components

### 1. Database & Search (SQLite + FTS5)
- The database (`curator.db`) is strictly local and runs in `WAL` mode for concurrency.
- **Schema** (`src/db/schema.ts`):
  - `contacts`: Stores all primary demographic and geospatial (`lat`, `lng`) data.
  - `interactions`: Stores history of notes, calls, meetings, emails, and file attachments.
- **FTS5 Virtual Table**: An advanced full-text search virtual table (`contacts_fts`) is synchronized natively via SQLite `TRIGGER` hooks (insert, update, delete) to map against `contacts`.

### 2. Express Backend (`server.ts`)
- Serves as a monolith proxy serving both the React App (`/dist` in production) and the REST API (`/api/*`).
- **Geocoding Queue**: A background process that listens to `location` updates on contacts and asynchronously pings OpenStreetMap's Nominatim API (respecting exactly 1 req/sec limits) to inject `lat`/`lng` coordinates.
- **Multer Uploads**: Intercepts `multipart/form-data` uploads, capping at 50MB, writing raw binaries strictly to `./uploads/` dynamically mapped as an `express.static` route.

### 3. Frontend Panes & Shared Layout
- **Master-Detail Layout**: `App.tsx` routes map `ContactList` (left-pane) and `ContactDetail` (right-pane).
- **Animations**: Wraps elements in `<LayoutGroup>` and uses `<motion.img layoutId="avatar-{id}">` to fly components seamlessly across the screen when routing.

### 4. Advanced Tooling Components
- **Command Palette (`src/components/CommandPalette.tsx`)**: 
  - Accessed via `Cmd+K`. Built on `cmdk`.
  - Supports standard search.
  - Supports **Action Mode**: Typing `>` shifts into a command interpreter (e.g., `> note Julian: Great meeting`), leveraging regex to instantly ping the Express backend headlessly.
  
- **Geospatial Map (`src/views/MapView.tsx`)**:
  - Built with `Leaflet` / `react-leaflet`.
  - Maps Contacts graphically using their OpenStreetMap resolved coordinates.

- **Rich Interaction Composer (`src/components/RichInteractionComposer.tsx`)**:
  - Replaces traditional `<textarea>`. Built heavily on `@tiptap/react`.
  - Native Markdown parsing (`#` for H1, `-` for bullet). No toolbar.
  - Custom `Mod-Enter` shortcut securely bypasses CR and fires the `useAddInteraction` Tanstack mutation.
  
- **Contextual Intelligence (`src/components/LocalContext.tsx`)**:
  - Pings `tz-lookup` locally and the Open-Meteo free API to resolve live Timezone matching and weather states on the contact's detail hero.

- **Drag-and-Drop Attachments**:
  - Handled by `react-dropzone` enveloping the timeline. Files drop to `/api/contacts/:id/attachments` via `FormData` payloads and render dynamically leveraging `dangerouslySetInnerHTML` for the rich Tiptap timeline notes.

- **Smart Clipboard Auto-Parser**:
  - Located dynamically in the Global Navigation / ContactList Header via `<SmartPasteModal>`.
  - Sends raw string blocks to `POST /api/parse-contact` where `aiService.ts` natively enforces `@google/genai` `responseSchema` constraints.
  - Automatically loads the React Creation Modal where AI-resolved variables render with a distinct pulsing `shadow-primary` UI outline awaiting user confirmation.

- **Contact Health Rings**:
  - The standard List Avatar UI is enveloped by `<HealthRingAvatar />`. Uses `date-fns` to determine remaining `cadenceDays` math.
  - Controls infinite-res SVG `<circle>` primitives binding to responsive CSS color themes (`emerald`, `amber`, `rose`).

## 🚨 Critical Agent Rules

1. **No External S3/Cloud Storage**: Everything in Contrack must be self-hosted. Attachments map strictly to the `./uploads` directory via Express `multer`.
2. **Keyboard First**: Any new interactive feature must possess a hotkey or be entirely navigable without a mouse (e.g. `Cmd+Enter` to save, `Cmd+K` to search).
3. **No Modals (Unless Necessary)**: Prefer inline `<EditableField />` components instead of giant CRUD modals. The goal is blazing fast in-place data mutation.
4. **Shared Element Transitions**: When adjusting avatars, names, or containers, ensure `motion.div` and `layoutId` tags are perfectly preserved to avoid breaking the Framer Motion fluid pane flying effects.
5. **Rate Limits & API usage**: Contrack uses strictly free APIs without keys, primarily `OpenStreetMap Nominatim` (limit 1 request per second strictly enforced via `server.ts` queue) and `Open-Meteo` (no key required).
6. **Gemini Intelligence**: The `server.ts` requires a `.env` configured with `GEMINI_API_KEY` specifically for generating timeline summaries via `/api/chat`. Do not rewrite this to OpenAI without explicitly asking.

## 📁 Repository Structure
\`\`\`
├── server.ts                 # Monolithic Backend Server (Express, SQLite, Geocode)
├── aiService.ts              # Dedicated Gemini parsing core leveraging JSON constraints
├── src/
│   ├── api.ts                # Master TanStack React Query Hooks mapping to /api
│   ├── db/
│   │   └── schema.ts         # Drizzle ORM Schema definitions
│   ├── hooks/
│   │   └── useCompanyLogo.ts # Resolves Google S2 Favicons silently
│   ├── components/           # Shared stateless/reusable components
│   │   ├── CommandPalette.tsx
│   │   ├── RichInteractionComposer.tsx
│   │   ├── HealthRingAvatar.tsx
│   │   ├── LocalContext.tsx
│   │   ...
│   ├── views/                # High-level Routable views
│   │   ├── ContactDetail.tsx # Master Right-Pane UI
│   │   ├── ContactList.tsx   # Master Left-Pane UI
│   │   ├── MapView.tsx       # Leaflet Explorer
│   └── index.css             # Tailwind v4 core tokens and Tiptap prose configurations
├── uploads/                  # Physical mapped dir for Multer Local binary storage
└── package.json              # Vite, Tailwind, Tiptap, Drizzle definitions
\`\`\`

If you are an agent reading this, execute tasks confidently bearing these rules and topological parameters in mind. Ensure that all data reads/writes funnel through the `useQuery`/`useMutation` structures in `api.ts` to maintain reactive synchronization across the DOM.
