# Contrack CRM — Feature Proposals v1.0

> **Author:** Principal Engineer / Product Visionary Review  
> **Status:** Proposal — Awaiting Prioritization  
> **Last Updated:** April 4, 2026  
> **Estimated Total LOE (all 10 features):** ~18–26 days with Antigravity

---

## Table of Contents

1. [Relationship Pulse Dashboard](#1-relationship-pulse-dashboard)
2. [Smart Introductions Engine](#2-smart-introductions-engine)
3. [CalDAV Calendar Sync](#3-caldav-calendar-sync)
4. [Relationship Strength Decay & Re-engagement Nudges](#4-relationship-strength-decay--re-engagement-nudges)
5. [Contact Import Pipeline (LinkedIn, Google, vCard, CSV)](#5-contact-import-pipeline-linkedin-google-vcard-csv)
6. [AI Meeting Prep Dossier](#6-ai-meeting-prep-dossier)
7. [Shared Contacts & Warm Introduction Mapping](#7-shared-contacts--warm-introduction-mapping)
8. [Pipeline & Deal Stage Tracker](#8-pipeline--deal-stage-tracker)
9. [Offline-First PWA with Background Sync](#9-offline-first-pwa-with-background-sync)
10. [Interactive Network Graph Visualization](#10-interactive-network-graph-visualization)

---

## 1. Relationship Pulse Dashboard

### The Problem

When users open Contrack today, they land on an empty state or a flat alphabetical list. There is zero proactive intelligence surfaced at the moment of entry — no sense of "who needs my attention," "what conversations am I dropping," or "how healthy is my network overall." The `FOLLOW_UP_DESIGN.md` identified this gap but remained scoped to follow-ups only.

**The deeper insight:** High-leverage professionals don't think in alphabetical lists. They think in urgency, momentum, and opportunity. The first screen of the CRM should answer the question: *"What should I do right now to be a better relationship-builder?"*

Every time a user has to manually scroll and remember who to follow up with, we've failed. The app is acting as a filing cabinet, not an assistant.

### Feature Description

The **Relationship Pulse Dashboard** replaces the current empty state (`/` route) with a dynamic, card-based intelligence hub that proactively surfaces:

- **🔥 Overdue Follow-Ups:** Contacts whose `nextFollowUpAt` has passed, sorted by how overdue they are. Each card shows avatar, company, last interaction excerpt, and two quick-action buttons: `Log Interaction` (opens composer) and `Snooze 7d` (one-click date bump via API).
- **📅 Today's Agenda:** Contacts with follow-ups due today, rendered as a compact horizontal scroll rail.
- **👻 Ghost Entities to Promote:** Up to 5 Ghost contacts with the highest mention counts — these are people you talk *about* frequently but haven't formally added. One-click promote to full contact.
- **📊 Network Health Metrics:** Three KPI cards showing: Total Active Contacts, Avg. Days Since Last Interaction (across all contacts), and Contacts At Risk (cadence breached by >2x).
- **🆕 Recently Added:** The 5 most recently created contacts, so the user has ambient awareness of network growth.
- **✨ AI Insight of the Day:** A rotating AI-generated observation about the user's network (e.g., "You haven't contacted anyone in the Finance industry in 45 days" or "3 of your contacts recently changed roles — consider reaching out").

### High-Level Design

**Architecture:**
```
┌────────────────────────────────────────────────────────┐
│  Frontend: DashboardView.tsx                           │
│  ├── OverdueRail (horizontal scroll)                   │
│  ├── TodayAgenda (compact list)                        │
│  ├── GhostPromotionCards                               │
│  ├── NetworkHealthKPIs                                 │
│  └── AIInsightCard                                     │
├────────────────────────────────────────────────────────┤
│  API:                                                  │
│  GET /api/dashboard                                    │
│  → returns { overdue[], today[], ghosts[],             │
│     metrics: { total, avgGap, atRisk }, recent[] }     │
│  POST /api/contacts/:id/snooze { days: number }        │
│  GET /api/dashboard/insight (cached daily)             │
├────────────────────────────────────────────────────────┤
│  Backend: dashboardService.ts                          │
│  → Single optimized SQL query for overdue/today        │
│  → Ghost ranking via interaction_mentions COUNT        │
│  → Metrics computed via aggregate queries              │
│  → AI insight via Gemini with cached 24h TTL           │
└────────────────────────────────────────────────────────┘
```

**UI Layout:** Full-width responsive grid. On desktop: 3-column KPI row on top, then a 2-column layout with Overdue/Today on the left and Ghosts/Recent on the right. Mobile: single-column stacked. All cards follow the No-Line design system with `surface-container-low` backgrounds and `motion` stagger animations on mount.

**Routing:** Replace the `EmptyState` component at `/` with `DashboardView`. The contact list remains in the left panel as-is.

### Estimated Level of Effort

| Component | Estimate |
|---|---|
| `GET /api/dashboard` endpoint + service | 1 hour |
| `POST /api/contacts/:id/snooze` | 20 min |
| `DashboardView.tsx` + sub-components | 2–3 hours |
| AI Insight of the Day (prompt + cache) | 1 hour |
| Polish, animations, responsive | 1 hour |
| **Total** | **~1.5 days** |

---

## 2. Smart Introductions Engine

### The Problem

One of the most valuable things a well-connected person does is **make introductions**. "You should meet Sarah — she's working on the exact same problem you are." But today, Contrack offers zero tooling to help users identify *who in their network should know each other*.

The `interaction_mentions` junction table already captures who is mentioned alongside whom. The `@mentions` system already builds an implicit graph. But this graph is completely invisible to the user — it exists in the database but is never surfaced as actionable intelligence.

**The deeper insight:** The ultimate CRM superpower isn't tracking relationships — it's *creating new ones*. If Contrack can proactively say "David Kim and Elena Rostova are both in AI infrastructure and don't know each other — you could introduce them," it transcends being a rolodex and becomes a **relationship multiplier**.

### Feature Description

The **Smart Introductions Engine** analyzes the user's contact graph and proactively suggests introductions between people who:

1. **Share professional overlap:** Same industry, similar roles, complementary companies (e.g., a startup founder and a VC in the same space).
2. **Have been mentioned in similar contexts:** Contacts who appear in timeline notes about the same topics/projects but have never been mentioned *together*.
3. **Exist in adjacent network clusters:** Using the `interaction_mentions` graph, identify contacts who are "two hops" apart (both mentioned by a common third contact) but have no direct connection.

**The UX Flow:**
- New card in the Dashboard or a dedicated "Introductions" view accessible from the sidebar.
- Each suggestion shows both contacts' avatars, names, companies, and a 1-sentence AI-generated reason for the introduction.
- One-click action: **"Draft Introduction"** — pre-fills a rich-text template in the timeline composer: *"Hi [Name A], I wanted to connect you with [Name B] who is [role] at [company]. [AI-generated reason]. I think you two would have a lot to talk about."*
- Users can dismiss suggestions (tracked to avoid re-surfacing).

### High-Level Design

**Architecture:**
```
┌──────────────────────────────────────────────────────────┐
│  Backend: introductionService.ts                         │
│                                                          │
│  1. INDUSTRY OVERLAP PASS:                               │
│     SELECT pairs where industry matches AND              │
│     no interaction_mentions links exist between them     │
│                                                          │
│  2. TOPIC CO-OCCURRENCE PASS:                            │
│     Analyze interaction content via FTS5 for             │
│     contacts who appear in notes about similar topics    │
│                                                          │
│  3. TWO-HOP GRAPH PASS:                                 │
│     Query interaction_mentions for contacts that         │
│     share a mutual mention-neighbor                      │
│                                                          │
│  4. AI RANKING:                                          │
│     Send top-N candidates to Gemini for scoring          │
│     and one-sentence justification generation            │
│                                                          │
│  API: GET /api/introductions?limit=10                    │
│       POST /api/introductions/:id/dismiss                │
├──────────────────────────────────────────────────────────┤
│  Frontend: IntroductionCard.tsx                          │
│  - Dual-avatar card with VS-style "connector" line       │
│  - AI reason badge                                       │
│  - "Draft Introduction" button → opens composer          │
│  - "Dismiss" → soft-hide                                 │
└──────────────────────────────────────────────────────────┘
```

**Schema additions:** New `dismissed_introductions` table with `(contactA_id, contactB_id)` composite key — straightforward DDL addition to `schema.ts`, no migration concerns.

**UI:** Horizontal carousel of introduction cards with a dual-portrait layout — two avatars connected by a gradient line. Glassmorphism card with a pulsing "✨ Potential Connection" badge.

### Estimated Level of Effort

| Component | Estimate |
|---|---|
| Three-pass matching algorithm | 2–3 hours |
| AI ranking and justification | 1 hour |
| API endpoints + dismissed_introductions schema | 1 hour |
| Frontend card + carousel UI | 2 hours |
| Composer integration ("Draft Introduction") | 1 hour |
| **Total** | **~2 days** |

---

## 3. CalDAV Calendar Sync

### The Problem

The README roadmap explicitly calls out *"Calendar CalDAV sync ingestion to natively hydrate meetings without clicking"* — and for good reason. Today, every meeting interaction must be manually logged. If a user has a Google Calendar or Apple Calendar meeting with "Sarah Chen — Q4 Planning," they still have to:

1. Open Contrack
2. Navigate to Sarah's profile
3. Open the composer
4. Select "Meeting" type
5. Type the meeting title and notes
6. Submit

This is exactly the kind of friction that causes CRMs to go stale. The user forgets, the meeting goes unlogged, and 3 months later the "Catch Me Up" briefing has a blind spot.

**The deeper insight:** The single biggest killer of CRM adoption is *data entry friction*. Every interaction that auto-populates is one the user never has to remember. Calendar sync is the highest-leverage automation a personal CRM can offer because meetings are the primary unit of relationship-building for executives and freelancers.

### Feature Description

**CalDAV Calendar Sync** connects to Google Calendar, Apple iCloud Calendar, or any CalDAV-compliant provider and:

1. **Polls for new/updated events** on a configurable interval (default: every 15 minutes via `setInterval` on the server).
2. **Matches attendees to contacts** by comparing attendee email addresses against `contact_emails`.
3. **Auto-creates timeline entries** of type `meeting` with the event title, start/end time, attendee list, and any description/notes from the calendar event.
4. **Handles recurring events** by creating individual timeline entries for each occurrence (deduped by event UID + date).
5. **Passive mode (default):** Automatically creates timeline entries without user intervention. No manual approval step — the whole point is zero-friction ingestion.
6. **Conflict detection:** If a meeting interaction already exists for the same contact on the same date with a similar title (FTS5 match), skip it to prevent duplicates.

### High-Level Design

**Architecture:**
```
┌──────────────────────────────────────────────────────────┐
│  Settings UI: CalendarSyncSettings.tsx                   │
│  - CalDAV URL input                                      │
│  - Username/Password (stored encrypted in SQLite)        │
│  - Sync interval selector (5m / 15m / 30m / 1h)         │
│  - "Sync Now" manual trigger                             │
│  - Last sync timestamp + event count                     │
├──────────────────────────────────────────────────────────┤
│  Backend: calendarSyncService.ts                         │
│  - Uses `tsdav` npm package for CalDAV/CALDAV protocol   │
│  - Fetches VEVENT components via REPORT method           │
│  - Parses attendees, extracts emails                     │
│  - Matches emails → contact_emails table                 │
│  - Creates interactions with type='meeting'              │
│  - Stores sync cursor (last sync timestamp)              │
│  - Runs on setInterval in server.ts                      │
├──────────────────────────────────────────────────────────┤
│  Schema additions (direct DDL, no migration concerns):   │
│  - calendar_connections: id, caldavUrl, username,         │
│    password, lastSyncAt, syncIntervalMinutes             │
│  - calendar_sync_log: eventUid, contactId, interactionId │
│    (prevents duplicate ingestion)                        │
├──────────────────────────────────────────────────────────┤
│  API:                                                    │
│  POST /api/settings/calendar  (save connection)          │
│  GET  /api/settings/calendar  (get connection status)    │
│  POST /api/settings/calendar/sync  (manual trigger)     │
│  DELETE /api/settings/calendar  (disconnect)             │
└──────────────────────────────────────────────────────────┘
```

**Security:** Since Contrack is a local-first app (SQLite on the user's own machine), CalDAV credentials are stored in plaintext in the local database — the same trust model as the `.env` file. No encryption layer needed. Credentials are never sent back to the frontend in API responses.

### Estimated Level of Effort

| Component | Estimate |
|---|---|
| CalDAV client integration (`tsdav`) | 3–4 hours |
| Email → contact matching engine | 1 hour |
| Interaction creation + dedup logic | 1.5 hours |
| Schema additions (2 tables in schema.ts) | 30 min |
| Settings UI (connection form) | 2 hours |
| Polling orchestration in server.ts | 1 hour |
| **Total** | **~2.5 days** |

---

## 4. Relationship Strength Decay & Re-engagement Nudges

### The Problem

The current `cadenceDays` and `nextFollowUpAt` system is binary — you either have a follow-up set or you don't. There's no gradient, no sense of *how much* a relationship has weakened over time. A contact you spoke to 89 days ago (1 day before the 90-day cadence) looks identical to a contact you spoke to 30 days ago.

**The deeper insight:** Relationships don't expire on a cliff — they decay on a curve. The longer you go without interaction, the harder it becomes to re-engage naturally. A CRM that understands this curve can intervene at the optimal moment: early enough that re-engagement feels natural, but not so aggressively that it creates notification fatigue.

### Feature Description

**Relationship Strength Decay** introduces a computed `relationshipScore` (0–100) for every contact, based on:

1. **Recency:** Days since last interaction, weighted against `cadenceDays`. Score decays on a sigmoid curve — rapid drop-off only after cadence is exceeded.
2. **Frequency:** Total interaction count in the last 90/180/365 days, normalized.
3. **Depth:** Average content length of interactions (a 500-word meeting note signals deeper engagement than a 10-word "quick call").
4. **Reciprocity:** Ratio of interaction types (are you only logging outbound notes, or are there emails/meetings indicating bidirectional communication?).
5. **Momentum:** Is the interaction frequency increasing, stable, or declining over the last 3 months?

**The UX:**
- The existing `HealthRingAvatar` component gets upgraded: the ring color and fill percentage now reflect the real `relationshipScore` instead of being cosmetic.
- Contacts in the sidebar list show a subtle color-coded dot: 🟢 (>70), 🟡 (40-70), 🔴 (<40).
- A new "Relationships at Risk" section in the Dashboard (Feature #1) shows contacts whose score dropped below 40 in the last week.
- **Re-engagement Nudges:** When a contact's score drops below a threshold, Contrack generates an AI-powered re-engagement suggestion: *"You haven't spoken to Marcus in 67 days. He recently posted about launching a new fund — consider congratulating him."* (Requires AI Search or manual notes to populate context.)

### High-Level Design

**Architecture:**
```
Backend: relationshipService.ts
  │
  ├── computeScore(contactId): number
  │   → Queries interactions for the contact
  │   → Applies weighted scoring formula
  │   → Returns 0-100 integer
  │
  ├── computeAllScores(): Map<contactId, score>
  │   → Batch computation on server startup + hourly refresh
  │   → Cached in-memory Map (invalidated on new interaction)
  │
  └── getAtRiskContacts(threshold = 40): Contact[]
      → Returns contacts whose score dropped below threshold

API:
  GET /api/contacts?view=slim  → adds `relationshipScore` to each contact
  GET /api/dashboard/at-risk   → returns at-risk contacts with scores

Frontend:
  - HealthRingAvatar.tsx → reads score from contact data, sets ring fill/color
  - ContactListItem.tsx  → adds colored dot indicator
  - DashboardAtRiskRail  → horizontal scroll of declining contacts
```

**Schema:** Since we have no prod data to worry about, we can add a `relationshipScore INTEGER DEFAULT 50` column directly to the `contacts` table. This lets us sort/filter by score in SQL queries without maintaining a separate in-memory cache. A background job recomputes scores hourly and on new interaction creation. The `cadenceDays` field already exists on contacts.

### Estimated Level of Effort

| Component | Estimate |
|---|---|
| Scoring algorithm + schema column + recompute job | 2 hours |
| API integration (slim view augmentation) | 30 min |
| HealthRingAvatar upgrade | 1 hour |
| Contact list dot indicators | 30 min |
| Dashboard "At Risk" rail | 1.5 hours |
| AI re-engagement suggestions (prompt) | 1.5 hours |
| **Total** | **~2 days** |

---

## 5. Contact Import Pipeline (LinkedIn, Google, vCard, CSV)

### The Problem

Today, the only way to add contacts is manual entry, Magic Paste (AI text parsing), or `.eml` ingestion. There is no structured import flow for the most common contact sources:

- **LinkedIn exports** (CSV with specific column headers: `First Name`, `Last Name`, `Email Address`, `Company`, `Position`, `Connected On`)
- **Google Contacts exports** (Google CSV or vCard 3.0)
- **Apple Contacts exports** (vCard 4.0)
- **Generic CSV** with arbitrary column headers

This is a critical onboarding barrier. A user with 500 LinkedIn connections has no practical way to bootstrap their CRM. They would have to manually add contacts one-by-one or paste 500 individual text blocks into Magic Paste.

**The deeper insight:** The first 5 minutes of a CRM determine whether the user adopts it or abandons it. If a user can import their entire LinkedIn network in under 60 seconds, they immediately see value. If they're staring at an empty list wondering how to get started, they close the tab.

### Feature Description

A **multi-source import wizard** that handles:

1. **LinkedIn CSV:** Auto-detects LinkedIn's column format. Maps `First Name` + `Last Name` → `name`, `Company` → `company`, `Position` → `role`, `Connected On` → `contact_sources.connectedOn`, `Email Address` → `contact_emails`.
2. **Google Contacts CSV:** Handles Google's multi-column format (multiple phone/email columns, structured address fields).
3. **vCard (.vcf):** Parses vCard 3.0/4.0 format with full field mapping including photos (base64 → avatar).
4. **Generic CSV:** Shows a column-mapping UI where the user maps arbitrary CSV headers to Contrack fields.

**The Wizard UX:**
- Step 1: **Drop Zone** — Drag file or click to upload. Auto-detects format.
- Step 2: **Preview & Map** — Shows first 5 rows in a table. For LinkedIn/Google, columns are auto-mapped with a green checkmark. For generic CSV, each column has a dropdown: `→ Name`, `→ Company`, `→ Email`, `→ Phone`, `→ Skip`.
- Step 3: **Dedup Warning** — Shows contacts that match existing records (by email or exact name match). Options: `Skip`, `Merge`, or `Import as New`.
- Step 4: **Import** — Progress bar. Contacts created in batches of 50. `contact_sources` populated with platform and import timestamp.

### High-Level Design

**Architecture:**
```
Backend: importService.ts
  │
  ├── detectFormat(buffer): 'linkedin-csv' | 'google-csv' | 'vcard' | 'csv'
  ├── parseLinkedInCSV(buffer): ParsedContact[]
  ├── parseGoogleCSV(buffer): ParsedContact[]
  ├── parseVCard(buffer): ParsedContact[]
  ├── parseGenericCSV(buffer, mapping): ParsedContact[]
  │
  ├── findDuplicates(parsed[]): { contact, existingMatch }[]
  └── bulkCreate(parsed[], options): { created, skipped, merged }

API:
  POST /api/import/detect   → multipart upload, returns format + preview rows
  POST /api/import/execute  → multipart upload + mapping + dedup strategy

Frontend: ImportWizard.tsx (expand existing ImportModal.tsx)
  - Step stepper with animated transitions
  - File drop zone with format auto-detection badge
  - Column mapping table (generic CSV only)
  - Duplicate resolution checkboxes
  - Progress bar with batch counter

Dependencies: `papaparse` (CSV), `vcard-parser` or manual RFC 6350 parser
```

### Estimated Level of Effort

| Component | Estimate |
|---|---|
| LinkedIn CSV parser | 1 hour |
| Google CSV parser | 1.5 hours |
| vCard parser (3.0 + 4.0) | 2 hours |
| Generic CSV + column mapping | 1.5 hours |
| Dedup detection on import | 1 hour |
| Bulk create service | 1 hour |
| Import Wizard UI (4-step stepper) | 3 hours |
| **Total** | **~3 days** |

---

## 6. AI Meeting Prep Dossier

### The Problem

The "Catch Me Up" briefing is powerful but narrow — it summarizes *your history* with a contact. It doesn't prepare you for what the meeting is actually *about*. Before a high-stakes meeting, a user wants:

- What has this person's company been doing recently? (News, funding rounds, product launches)
- What's the person's public stance on topics relevant to my agenda?
- What mutual connections do we share that I could reference?
- What conversation starters would resonate based on their interests?

Today, this requires manual Google searching, LinkedIn stalking, and cross-referencing multiple tabs. The prep that separates a good meeting from a great one takes 15–30 minutes per contact.

**The deeper insight:** "Catch Me Up" answers "where did we leave off?" but the meeting prep dossier answers "how do I make this meeting exceptional?" These are complementary but fundamentally different tools. The dossier is outward-looking (internet research about them), while the briefing is inward-looking (our shared history).

### Feature Description

The **AI Meeting Prep Dossier** generates a comprehensive, one-page intelligence report combining:

1. **Company Intelligence:** Recent news, funding rounds, executive changes, product launches (via Gemini search grounding).
2. **Personal Intel:** Recent public posts, talks, publications, interviews (via search grounding).
3. **Conversation Starters:** 3 personalized icebreakers based on their interests, recent activity, and shared context from your timeline.
4. **Mutual Connections:** Cross-reference the `interaction_mentions` graph to surface shared contacts.
5. **Briefing Integration:** Includes the "Catch Me Up" 3-bullet summary inline.

**Delivery:** Rendered as a beautiful, printable card in the Contact Detail view under a new "📋 Dossier" tab. Can also be exported as a clean PDF.

### High-Level Design

**Architecture:**
```
Backend: dossierService.ts
  │
  ├── generateDossier(contactId):
  │   ├── 1. Fetch HydratedContact + last 15 interactions
  │   ├── 2. Build research prompt with search grounding
  │   │      (company news, personal activity, publications)
  │   ├── 3. Query interaction_mentions for mutual contacts
  │   ├── 4. Generate 3 icebreakers via separate prompt
  │   ├── 5. Include existing aiBriefing if fresh (< 24h)
  │   └── 6. Compose structured DossierPayload
  │
  └── Response: { companyIntel, personalIntel, icebreakers[],
                   mutualContacts[], briefingBullets[], generatedAt }

API: POST /api/contacts/:id/dossier
Frontend: DossierTab.tsx (extends existing tab system)
  - Glassmorphism card with sections
  - "Generate Dossier" button (triggers on-demand)
  - Cached for 24 hours with "Refresh" option
  - Print/PDF export button
```

### Estimated Level of Effort

| Component | Estimate |
|---|---|
| Dossier service (research prompt + grounding) | 2 hours |
| Mutual contacts query | 30 min |
| Icebreaker generation prompt | 1 hour |
| API endpoint | 30 min |
| DossierTab.tsx UI | 3 hours |
| PDF/Print export | 1.5 hours |
| **Total** | **~2 days** |

---

## 7. Shared Contacts & Warm Introduction Mapping

### The Problem

The `interaction_mentions` table creates an implicit social graph, but users can't navigate it. If you mention Sarah in David's timeline and David in Sarah's timeline, there's a bidirectional edge — but neither contact's profile shows "Also connected to: David/Sarah."

**The deeper insight:** The value of a network is not its size — it's its *interconnectedness*. A user who can see "David and Sarah are both connected through you, and both work in the healthcare AI space" has a fundamentally different understanding of their network than someone looking at two isolated profiles. This is the difference between an address book and a **relational graph**.

### Feature Description

**Shared Contacts** surfaces the implicit graph from `interaction_mentions` as a first-class UI element:

1. **"Connected Through You" Section** on each Contact Detail page: Shows other contacts who have been mentioned in the same interactions as this contact, or who share bidirectional mention links.
2. **Connection Strength Indicators:** Based on co-mention frequency. Mentioned together 10 times = strong connection. Mentioned together once = weak connection.
3. **Context Snippets:** For each shared contact, show the most recent interaction where both were mentioned, with a truncated excerpt.
4. **"Introduce" Quick Action:** One-click to draft an introduction email/note connecting two contacts who share mutual connections but have never been mentioned together.

### High-Level Design

**Architecture:**
```
Backend: graphService.ts
  │
  ├── getSharedContacts(contactId):
  │   → Query interaction_mentions for other contactIds
  │     that appear in the same interactions
  │   → JOIN with contacts table for hydration
  │   → COUNT co-occurrences for strength scoring
  │   → Return: { contact, strength, lastMentionedTogether, excerpt }[]
  │
  └── getMutualMentionGraph(contactId):
      → Two-hop traversal: contactId → interactions → other contacts
        → their interactions → contacts they mention
      → Returns second-degree connections

API: GET /api/contacts/:id/graph

Frontend: ConnectionsSection.tsx (new section in ContactProfile)
  - Compact avatar stack with strength indicator bars
  - Expandable to show context snippets
  - "View Full Network" → links to Network Graph (Feature #10)
```

### Estimated Level of Effort

| Component | Estimate |
|---|---|
| Graph query service | 1.5 hours |
| API endpoint | 30 min |
| ConnectionsSection.tsx UI | 2 hours |
| Context snippet extraction | 1 hour |
| **Total** | **~1.5 days** |

---

## 8. Pipeline & Deal Stage Tracker

### The Problem

Contrack is positioned for "creative directors, freelancers, and executives" — people who close deals, win clients, and manage business relationships. Yet it has zero pipeline management. When a freelance designer is courting 5 potential clients simultaneously, they can't answer: "What stage is each opportunity at? What's my total pipeline value? Which deals am I about to lose?"

The existing `tags` and `lists` systems are too flat for this. Tags are unordered labels. Lists are static groups. Neither captures the *sequential, stage-based progression* of a deal from "Lead" to "Proposal Sent" to "Negotiation" to "Won/Lost."

**The deeper insight:** Every relationship has a lifecycle, and for business relationships, that lifecycle maps to a pipeline. The freelancer's pipeline is their livelihood. By modeling deal stages as a first-class entity linked to contacts, Contrack becomes the only CRM they need — not just for remembering people, but for *managing their business*.

### Feature Description

**Pipeline Tracker** introduces deal/opportunity tracking without the complexity of Salesforce:

1. **Pipelines:** User-defined stages (e.g., `Lead → Qualified → Proposal → Negotiation → Won/Lost`). Default pipeline created on first use. Stages are drag-to-reorder.
2. **Deals:** Linked to one or more contacts. Each deal has: title, value ($), stage, expected close date, notes, and created/updated timestamps.
3. **Kanban Board:** Visual board view where deals are cards in stage columns. Drag-and-drop to move between stages.
4. **Pipeline Metrics:** Total pipeline value, weighted pipeline (value × stage probability), win rate, average deal cycle time.
5. **Contact Integration:** Each contact's profile shows their associated deals. The Dossier (Feature #6) includes deal context.

### High-Level Design

**Architecture:**
```
Schema:
  pipelines: id, name, sortOrder, createdAt
  pipeline_stages: id, pipelineId, name, sortOrder, probability (0.0-1.0)
  deals: id, title, value, stageId, expectedCloseDate, notes, createdAt, updatedAt
  deal_contacts: dealId, contactId (junction table)

API:
  GET/POST /api/pipelines
  GET/POST /api/deals
  PUT /api/deals/:id (move stage, update value)
  GET /api/pipelines/:id/metrics

Frontend:
  PipelineView.tsx → Kanban board with drag-drop (react-beautiful-dnd or @hello-pangea/dnd)
  DealCard.tsx → compact card with value, contact avatars, days-in-stage
  PipelineMetrics.tsx → KPI bar above the board
```

### Estimated Level of Effort

| Component | Estimate |
|---|---|
| Schema design (4 new tables in schema.ts) | 1 hour |
| Pipeline + Deal CRUD services | 2 hours |
| API routes (5 endpoints) | 1.5 hours |
| Kanban board UI with drag-drop | 4 hours |
| Pipeline metrics | 1.5 hours |
| Contact profile integration | 1 hour |
| **Total** | **~3 days** |

---

## 9. Offline-First PWA with Background Sync

### The Problem

Contrack is a local-first app with SQLite, but it's served as a standard web app that requires the Express server to be running. On a plane, in a subway, at a conference with bad WiFi — the user can't access their contacts. For a tool designed for "high-leverage individuals" who are constantly on the move, this is a critical gap.

The README roadmap calls out *"iOS/Android PWA optimized layout"* — but just making the layout responsive isn't enough. The transformative capability is **offline access with background sync**.

**The deeper insight:** The most important time to check your CRM is the 30 seconds before a meeting starts. You're walking into a room, your phone is in your hand, and you need to know *who is this person and what did we last discuss*. If the app doesn't work offline or loads slowly, you walk in cold. PWA with offline caching ensures the contact data is *always* available, even without connectivity.

### Feature Description

1. **Service Worker Registration:** Cache the shell (HTML, CSS, JS) for instant loading. Cache the most recently viewed 100 contacts' data in IndexedDB.
2. **Offline Contact Browsing:** Navigate contacts, view profiles, read timelines — all from cached IndexedDB data.
3. **Offline Interaction Logging:** Write new interactions to an IndexedDB "outbox." When connectivity resumes, the service worker replays the outbox to the server.
4. **PWA Manifest:** Installable on iOS/Android home screen with proper icons, splash screen, and standalone display mode.
5. **Background Sync:** Uses the Background Sync API to push queued interactions to the server when the device reconnects.

### High-Level Design

**Architecture:**
```
├── public/
│   ├── manifest.json (PWA manifest)
│   ├── sw.js (Service Worker)
│   └── icons/ (192px, 512px app icons)
│
├── src/lib/offlineStore.ts
│   ├── cacheContacts(contacts[]) → IndexedDB
│   ├── getCachedContacts() → Contact[]
│   ├── getCachedContact(id) → Contact
│   ├── queueInteraction(interaction) → IndexedDB outbox
│   └── flushOutbox() → POST each to server
│
├── src/hooks/useOfflineStatus.ts
│   └── Returns { isOnline, pendingSync: number }
│
└── sw.js
    ├── Cache-first for static assets
    ├── Network-first for API calls, falling back to IndexedDB
    └── Background Sync registration for outbox flush
```

**UI Changes:**
- Subtle "Offline Mode" badge in the sidebar when disconnected.
- Pending sync count indicator: "3 interactions queued."
- Toast notification when sync completes: "3 interactions synced successfully."

### Estimated Level of Effort

| Component | Estimate |
|---|---|
| PWA manifest + icons | 30 min |
| Service Worker (caching strategy) | 2 hours |
| IndexedDB offline store | 3 hours |
| Offline interaction outbox + sync | 2 hours |
| useOfflineStatus hook + UI indicators | 1 hour |
| Testing on mobile (iOS Safari, Android Chrome) | 2 hours |
| **Total** | **~2.5 days** |

---

## 10. Interactive Network Graph Visualization

### The Problem

The Map View shows *where* contacts are geographically, but it doesn't show *how they relate to each other*. The `interaction_mentions` junction table encodes a rich social graph — who knows who, who was mentioned with whom, who introduced whom — but this graph only exists as raw database rows.

The README roadmap lists *"Enhanced Network Visualization (Canvas/d3 graph rendering)"* as a planned feature. This is the single most visually impressive and strategically valuable feature Contrack could add.

**The deeper insight:** Humans are fundamentally visual thinkers. A list of contacts with mention counts is data. An interactive graph where you can see clusters, bridges, and isolated nodes is *understanding*. When a user sees that 80% of their network is in tech but they have no connections in healthcare (where they want to expand), that's an insight that changes behavior. When they see that one person is a "bridge node" connecting two otherwise disconnected clusters, they understand that relationship's strategic value.

### Feature Description

**Interactive Network Graph** renders the user's entire contact network as a force-directed graph:

1. **Nodes:** Each contact is a node. Size = interaction count. Color = industry or list membership. Avatar rendered inside the node circle.
2. **Edges:** Lines between nodes represent `interaction_mentions` co-occurrences. Edge thickness = mention frequency.
3. **Clusters:** Contacts in the same `list` or `industry` gravitationally cluster together. Force-directed layout naturally reveals network structure.
4. **Interactions:**
   - **Hover:** Tooltip with contact name, company, relationship score.
   - **Click:** Opens Contact Detail panel (same as clicking from the list).
   - **Drag:** Reposition nodes manually. Physics simulation respects the new position.
   - **Zoom/Pan:** Scroll to zoom, drag background to pan.
   - **Filter:** Toggle visibility by list, industry, or relationship score threshold.
5. **Insights Panel:** Sidebar stats: Most connected contacts (highest degree), Bridge nodes (highest betweenness centrality), Isolated contacts (no edges), Cluster summary.

### High-Level Design

**Architecture:**
```
Dependencies: d3-force (physics simulation) + Canvas 2D API (rendering)
  Why Canvas over SVG: Performance. SVG chokes at 200+ nodes.
  d3-force handles the simulation; we render via requestAnimationFrame.

Backend:
  GET /api/graph
  → Returns: {
      nodes: { id, name, company, industry, interactionCount, score, avatarUrl }[],
      edges: { source, target, weight }[]
    }
  → Built from: contacts LEFT JOIN (interaction_mentions graph query)

Frontend: NetworkGraphView.tsx
  ├── GraphCanvas.tsx (Canvas 2D rendering + d3-force simulation)
  ├── GraphControls.tsx (zoom, filter toggles, layout reset)
  ├── GraphInsightsPanel.tsx (stats sidebar)
  └── GraphTooltip.tsx (hover card)

Routing: /graph (new sidebar icon: Network/Share2 from lucide)
```

**Rendering approach:** Use `d3-force` for physics only (force-many-body, force-link, force-center, force-collide). Render via HTML Canvas `2d` context in a `requestAnimationFrame` loop. Nodes rendered as circles with contact initials or scaled-down avatars. Edges rendered as semi-transparent arcs with thickness proportional to weight.

**Performance budget:** Target 60fps with up to 500 nodes and 2000 edges by using Canvas over SVG and spatial indexing (quadtree) for hover hit-testing.

### Estimated Level of Effort

| Component | Estimate |
|---|---|
| Graph data API (nodes + edges) | 1.5 hours |
| d3-force simulation setup | 2 hours |
| Canvas 2D renderer (nodes, edges, labels) | 4 hours |
| Zoom/Pan/Drag interactions | 2 hours |
| Hover tooltips + click navigation | 1.5 hours |
| Filter controls (list, industry, score) | 1.5 hours |
| Insights panel (degree, centrality) | 2 hours |
| Responsive + performance optimization | 1.5 hours |
| **Total** | **~3.5 days** |

---

## Summary & Prioritization Matrix

| # | Feature | Impact | LOE | Priority |
|---|---|---|---|---|
| 1 | Relationship Pulse Dashboard | 🔥🔥🔥 | 1.5d | **P0** — Critical UX gap |
| 4 | Relationship Decay & Nudges | 🔥🔥🔥 | 2d | **P0** — Core CRM intelligence |
| 5 | Contact Import Pipeline | 🔥🔥🔥 | 3d | **P0** — Onboarding blocker |
| 10 | Network Graph Visualization | 🔥🔥🔥 | 3.5d | **P1** — Flagship differentiator |
| 3 | CalDAV Calendar Sync | 🔥🔥 | 2.5d | **P1** — Automation unlock |
| 6 | AI Meeting Prep Dossier | 🔥🔥 | 2d | **P1** — Premium AI feature |
| 7 | Shared Contacts Graph | 🔥🔥 | 1.5d | **P1** — Graph surfacing |
| 2 | Smart Introductions Engine | 🔥🔥 | 2d | **P2** — Network multiplier |
| 8 | Pipeline & Deal Tracker | 🔥 | 3d | **P2** — Business expansion |
| 9 | Offline-First PWA | 🔥 | 2.5d | **P2** — Mobile unlock |

**Recommended execution order:** 1 → 4 → 5 → 7 → 10 → 6 → 3 → 2 → 8 → 9

This sequence front-loads the features that transform the *daily experience* of using Contrack (Dashboard, Decay, Import), then builds the network intelligence layer (Shared Contacts, Graph), then layers on premium AI capabilities (Dossier, Calendar), and finally expands into adjacent markets (Pipeline, PWA).
