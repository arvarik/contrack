# Relationship Pulse Dashboard — Proactive Relationship Intelligence Engine

> **Status:** Design Approved — Ready for Implementation  
> **Scope:** New `action_items` table, new `DashboardView`, Relationship Scoring, Ghost Promotion, Network Health KPIs, AI Daily Insight, Sidebar Badge, Contact List Indicators, Profile Banners  
> **Depends on:** `contacts` table, `interactions` table, `interaction_mentions` junction, `interactionService`, `HealthRingAvatar`, `RichInteractionComposer`

---

## 1. The Problem

Today, when users open Contrack they land on a flat, alphabetically-sorted contact list with zero proactive intelligence. The `nextFollowUpAt` field is a single date slot buried inside individual contact profiles — a write-only reminder that requires the user to do all the remembering. Meanwhile, the `cadenceDays` and `lastContactedAt` fields exist in the database but power nothing visible in the UI.

**Six specific failures of the current system:**

1. **No global visibility.** Follow-up dates are only visible deep inside individual profiles. The user must remember *who* they set reminders for and manually navigate there.
2. **No urgency signal.** Zero visual distinction between a contact due today and one due in three months.
3. **No resolution path.** Seeing a reminder provides no shortcut to act on it. The user must scroll to the timeline composer, manually log an interaction, and then separately clear the follow-up.
4. **No deferral mechanism.** No way to snooze a reminder without editing a raw date string.
5. **One item per contact.** A single `nextFollowUpAt` date field cannot represent multiple tasks ("Send proposal" AND "Intro to Bob"). Real relationship management requires multiple concurrent action items per contact.
6. **No network pulse.** No aggregated health metrics, no ghost entity surfacing, no AI insights, no sense of "how healthy is my network overall?"

**The deeper insight:** High-leverage professionals don't think in alphabetical lists. They think in urgency, momentum, and opportunity. The first screen of the CRM should answer: *"What should I do right now to be a better relationship-builder?"*

Every time a user has to manually scroll and remember who to follow up with, the app has failed. It's acting as a filing cabinet, not an assistant.

---

## 2. Design Philosophy

Four pillars govern how the Relationship Pulse Dashboard surfaces information:

| Principle | Definition | Application |
|---|---|---|
| **Ambient Awareness** | Pending tasks and network state visible without context switching | Sidebar badge count, list indicators, HealthRing scores |
| **Interruptive Urgency** | Overdue items demand attention on the primary surface | Dashboard overdue rail, profile banners |
| **Immediate Affordance** | Seeing a task offers a one-click resolution path | Log Interaction, Snooze, Complete — always visible on the card |
| **Proactive Intelligence** | The app surfaces insights the user didn't know to ask for | Ghost promotions, AI daily insight, at-risk contacts |

### Urgency Classification System

Every action item's `dueAt` value maps to exactly one urgency tier:

| Tier | Condition | Color Token | Icon Treatment |
|---|---|---|---|
| **Overdue** | `dueAt < today` | `rose-500` | Pulsing dot + bold badge |
| **Due Today** | `dueAt == today` | `amber-500` | Solid dot + badge |
| **Upcoming** | `today < dueAt <= today + 7d` | `primary` | Subtle icon, no dot |
| **Scheduled** | `dueAt > today + 7d` | `on-surface-variant` | Calendar icon only |

### Relationship Health Tiers

Every contact's computed `relationshipScore` (0–100) maps to a health tier:

| Tier | Score Range | Color | Visual Treatment |
|---|---|---|---|
| **Thriving** | 70–100 | `emerald-500` | Full HealthRing, green dot in list |
| **Stable** | 40–69 | `amber-500` | Partial HealthRing, amber dot in list |
| **At Risk** | 0–39 | `rose-500` | Low HealthRing, red dot in list |

---

## 3. Backend Architecture

### 3.A Schema — The `action_items` Table

Since we have full schema freedom (no production data), Action Items become a **first-class entity** rather than stretching the bare `nextFollowUpAt` date field. This unlocks:
- Multiple action items per contact ("Send proposal" + "Intro to Bob")
- Descriptive titles (the *what*, not just the *when*)
- Completion tracking (history of resolved items)
- Clean CRUD semantics (create, snooze, complete, delete)

**Drizzle schema addition** (`src/db/schema.ts`):
```ts
export const actionItems = sqliteTable('action_items', {
  id: text('id').primaryKey(),
  contactId: text('contactId').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  dueAt: text('dueAt').notNull(),           // ISO 8601 UTC
  completedAt: text('completedAt'),          // null = pending
  createdAt: text('createdAt').default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text('updatedAt').default(sql`(CURRENT_TIMESTAMP)`),
});
```

**Keep `contacts.nextFollowUpAt` as a trigger-maintained cache.** This field becomes a denormalized read-optimization — automatically set to `MIN(dueAt)` across pending (non-completed) action items for that contact. This ensures the `slim` contact list query stays fast (no JOIN needed) and the sidebar badge count remains a single-table scan.

**Sync triggers** (installed in `server/db.ts`):
```sql
CREATE TRIGGER IF NOT EXISTS action_items_sync_insert AFTER INSERT ON action_items BEGIN
  UPDATE contacts SET nextFollowUpAt = (
    SELECT MIN(dueAt) FROM action_items
    WHERE contactId = NEW.contactId AND completedAt IS NULL
  ) WHERE id = NEW.contactId;
END;

CREATE TRIGGER IF NOT EXISTS action_items_sync_update AFTER UPDATE ON action_items BEGIN
  UPDATE contacts SET nextFollowUpAt = (
    SELECT MIN(dueAt) FROM action_items
    WHERE contactId = NEW.contactId AND completedAt IS NULL
  ) WHERE id = NEW.contactId;
END;

CREATE TRIGGER IF NOT EXISTS action_items_sync_delete AFTER DELETE ON action_items BEGIN
  UPDATE contacts SET nextFollowUpAt = (
    SELECT MIN(dueAt) FROM action_items
    WHERE contactId = OLD.contactId AND completedAt IS NULL
  ) WHERE id = OLD.contactId;
END;
```

This means:
- `contacts.nextFollowUpAt` is **never written directly** by application code anymore.
- All mutations go through `action_items` — the triggers keep the cache in sync.
- The `slim` endpoint, sidebar badge, and list indicators all read `contacts.nextFollowUpAt` as before — zero query changes needed for existing features.

### 3.B Schema — `relationshipScore` Column on `contacts`

Add a computed column directly to the `contacts` table for SQL-level sort/filter without maintaining a separate in-memory cache:

```ts
// Add to contacts table definition in src/db/schema.ts:
relationshipScore: integer('relationshipScore').default(50),
```

**Scoring algorithm** (`server/services/relationshipService.ts`):

The score combines five weighted signals into a 0–100 integer. All inputs come from data already in the database — no new tables needed.

```
Score = w₁·Recency + w₂·Frequency + w₃·Depth + w₄·Reciprocity + w₅·Momentum
```

| Signal | Weight | Calculation | Source Tables |
|---|---|---|---|
| **Recency** | 40% | Sigmoid decay: `100 / (1 + e^(k * (daysSinceLastInteraction - cadenceDays)))`. Score stays near 100 within cadence, drops steeply after. `k = 0.1` gives a nice decay curve. | `contacts.lastContactedAt`, `contacts.cadenceDays` |
| **Frequency** | 25% | `min(100, interactionCount_90days * 10)`. 10+ interactions in 90 days = max score. | `interactions` COUNT with date filter |
| **Depth** | 15% | `min(100, avgContentLength / 5)`. Avg content length of last 10 interactions, normalized. 500+ chars avg = max. | `interactions.content` LENGTH |
| **Reciprocity** | 10% | Ratio of interaction types that imply bidirectional communication (meeting, call, email) vs. unidirectional (note, message). `bidirectional_count / total_count * 100`. | `interactions.type` |
| **Momentum** | 10% | Compare interaction count in the last 30 days vs. the 30 days before that. Increasing = 100, stable = 50, declining = 0. | `interactions` COUNT with date windows |

**Recomputation schedule:**
- **On interaction creation:** Recompute score for affected contact (via `interactionService.createInteraction` — add call after insert).
- **Hourly background sweep:** Recompute all scores every 60 minutes via `setInterval` in `server.ts`. This catches recency decay even when no new interactions occur.
- **On server startup:** Full recompute on boot to ensure freshness after downtime.

**Add to slimContacts query:** The `getSlimContacts()` SQL already selects from `contacts` — simply add `c.relationshipScore` to the column list. Zero JOIN overhead.

### 3.C TypeScript Types (`src/types.ts`)

```ts
export interface ActionItem {
  id: string;
  contactId: string;
  title: string;
  dueAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Joined from contacts (only on global list endpoints)
  contactName?: string;
  contactCompany?: string | null;
  contactAvatarUrl?: string | null;
  contactThemeColor?: string;
}

// Add to existing Contact interface:
//   relationshipScore: number;
```

### 3.D API Endpoints — Action Items (`server/routes/actionItems.ts`)

A dedicated Express router for full CRUD on action items.

#### `GET /api/action-items` — Global Action Items List

Returns all pending action items with contact info, sorted by urgency (overdue first, then by due date ascending).

```sql
SELECT ai.*, c.name as contactName, c.company as contactCompany,
       c.avatarUrl as contactAvatarUrl, c.themeColor as contactThemeColor
FROM action_items ai
JOIN contacts c ON ai.contactId = c.id
WHERE ai.completedAt IS NULL
  AND (c.isArchived = 0 OR c.isArchived IS NULL)
ORDER BY ai.dueAt ASC
```

> **Note:** Unlike the original design which filtered to `dueAt <= date('now', '+7 days')`, we return **all** pending items and let the frontend classify/group them. This gives the dashboard full flexibility for a "Scheduled" section and prevents items from silently hiding.

#### `GET /api/action-items/count` — Badge Count

Lean endpoint for the sidebar badge (overdue + due today only):

```sql
SELECT COUNT(*) as count
FROM action_items ai
JOIN contacts c ON ai.contactId = c.id
WHERE ai.completedAt IS NULL
  AND ai.dueAt <= date('now')
  AND (c.isArchived = 0 OR c.isArchived IS NULL)
```

Returns: `{ count: number }`

#### `GET /api/contacts/:id/action-items` — Per-Contact Items

Returns all action items for a specific contact (pending + recently completed).

```sql
SELECT * FROM action_items
WHERE contactId = ?
ORDER BY completedAt IS NULL DESC, dueAt ASC
```

#### `POST /api/contacts/:id/action-items` — Create

Request: `{ title: string, dueAt: string }`  
Creates a new action item. The sync trigger auto-updates `contacts.nextFollowUpAt`.

#### `PATCH /api/action-items/:id` — Snooze / Edit

Request: `{ dueAt?: string, title?: string }`  
Snoozing = `{ dueAt: addDays(new Date(), N).toISOString() }`. The trigger handles the rest.

#### `PATCH /api/action-items/:id/complete` — Complete

Sets `completedAt = now()`. The trigger recomputes `contacts.nextFollowUpAt` to the next pending item (or `null` if none remain).

#### `DELETE /api/action-items/:id` — Delete

Permanently removes the action item. Trigger recomputes the cache.

### 3.E API Endpoints — Dashboard (`server/routes/dashboard.ts`)

A single aggregated endpoint that powers the entire dashboard in one round-trip.

#### `GET /api/dashboard` — Full Dashboard Payload

Returns a composite response assembled by `dashboardService.ts`:

```ts
interface DashboardPayload {
  // Section 1: Action Items (same data as action-items endpoint, pre-grouped)
  overdue: ActionItem[];       // dueAt < today
  dueToday: ActionItem[];      // dueAt == today
  upcoming: ActionItem[];      // today < dueAt <= today + 7d

  // Section 2: Ghost Entities to Promote
  ghosts: {
    id: string;
    name: string;
    company: string | null;
    avatarUrl: string | null;
    themeColor: string;
    mentionCount: number;       // how often they appear in interaction_mentions
  }[];

  // Section 3: Network Health Metrics
  metrics: {
    totalActive: number;         // COUNT contacts WHERE isGhost=0 AND isArchived=0
    avgDaysSinceInteraction: number; // AVG(julianday('now') - julianday(lastContactedAt))
    atRiskCount: number;         // COUNT contacts WHERE relationshipScore < 40
    totalInteractions30d: number; // COUNT interactions in last 30 days
  };

  // Section 4: Contacts At Risk
  atRisk: {
    id: string;
    name: string;
    company: string | null;
    avatarUrl: string | null;
    themeColor: string;
    relationshipScore: number;
    daysSinceContact: number;
    lastInteractionTitle: string | null;
  }[];

  // Section 5: Recently Added
  recentlyAdded: {
    id: string;
    name: string;
    company: string | null;
    avatarUrl: string | null;
    themeColor: string;
    addedAt: string;
  }[];
}
```

**SQL strategy for each section:**

**Ghosts** (top 5 by mention frequency):
```sql
SELECT c.id, c.name, c.company, c.avatarUrl, c.themeColor,
       COUNT(DISTINCT im.interactionId) as mentionCount
FROM contacts c
JOIN interaction_mentions im ON c.id = im.contactId
WHERE c.isGhost = 1 AND (c.isArchived = 0 OR c.isArchived IS NULL)
GROUP BY c.id
ORDER BY mentionCount DESC
LIMIT 5
```

**At Risk** (bottom 10 by relationship score, excluding ghosts):
```sql
SELECT c.id, c.name, c.company, c.avatarUrl, c.themeColor, c.relationshipScore,
       CAST(julianday('now') - julianday(c.lastContactedAt) AS INTEGER) as daysSinceContact,
       (SELECT title FROM interactions WHERE contactId = c.id ORDER BY date DESC LIMIT 1) as lastInteractionTitle
FROM contacts c
WHERE c.isGhost = 0
  AND (c.isArchived = 0 OR c.isArchived IS NULL)
  AND c.relationshipScore < 40
  AND c.lastContactedAt IS NOT NULL
ORDER BY c.relationshipScore ASC
LIMIT 10
```

**Recently Added** (last 5 non-ghost, non-archived):
```sql
SELECT id, name, company, avatarUrl, themeColor, addedAt
FROM contacts
WHERE isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
ORDER BY addedAt DESC
LIMIT 5
```

**Performance:** All queries run against indexed columns (`isGhost`, `isArchived`, `lastContactedAt`, `addedAt`). The entire payload assembles in <5ms on a 500-contact database. SQLite is single-threaded, so we run these sequentially in a single `dashboardService.getDashboard()` call — no Promise.all needed.

#### `GET /api/dashboard/insight` — AI Insight of the Day

A daily-cached AI observation about the user's network, generated by Gemini with a structured prompt:

```ts
interface DailyInsight {
  text: string;        // The insight text, 1-2 sentences
  category: string;    // "industry_gap" | "role_change" | "engagement_drop" | "growth" | "milestone"
  generatedAt: string; // ISO timestamp
}
```

**Implementation:**
- Cache the insight in an in-memory variable with 24h TTL.
- On cache miss, build a prompt from aggregate network stats (industry distribution, recent interaction drop-offs, contacts who changed roles) and send to Gemini.
- The prompt template:
  ```
  You are a CRM intelligence analyst. Based on the following network statistics,
  generate a single actionable insight (1-2 sentences max) that helps the user
  be a better relationship-builder. Be specific and reference actual patterns.

  Stats:
  - Total contacts: {N}
  - Industry distribution: {map}
  - Contacts not reached in 60+ days: {list of names}
  - New contacts this month: {N}
  - Most active relationships: {top 3}
  - Least active relationships: {bottom 3}
  ```
- Falls back gracefully if Gemini key is missing (returns `null`; frontend simply doesn't render the card).

### 3.F Atomicity Fix — Composite Interaction + Action Item

The current `RichInteractionComposer.tsx` makes **two separate calls** when logging an interaction with a follow-up date:

1. `POST /api/contacts/:id/interactions` — creates the timeline entry
2. `PUT /api/contacts/:id` — updates `nextFollowUpAt`

If call (2) fails, we get a logged interaction with no scheduled follow-up — a silent data integrity bug.

**Fix:** Extend `createInteraction` in `interactionService.ts` to accept an optional `actionItem: { title, dueAt }` in the request body. The service creates the interaction AND the action item in the **same synchronous SQLite transaction**:

```ts
// In interactionService.createInteraction():
if (body.actionItem) {
  db.insert(schema.actionItems).values({
    id: crypto.randomUUID(),
    contactId,
    title: body.actionItem.title,
    dueAt: body.actionItem.dueAt,
  }).run();
  // The SQL trigger auto-updates contacts.nextFollowUpAt
}
```

This means:
- **No new API route** — we extend the existing `POST /api/contacts/:id/interactions` payload.
- The frontend reduces from 2 calls to 1.
- The action item gets a real **title** derived from the NLP input (see §3.G below).
- If either the interaction or action item insert fails, the entire transaction rolls back.

### 3.G NLP Title Extraction

The `RichInteractionComposer` already uses `chrono-node` to parse dates from natural language. We extend this to also extract the task description:

```ts
// Input: "Follow up about the deal next Tuesday at 2pm"
// chrono parses: date = next Tuesday 2pm
// Title extraction: strip the date phrase → "Follow up about the deal"
// If no meaningful text remains, default title: "Follow up"
```

The `extractFollowUpTitle(text: string, chronoResult)` utility:
1. Takes the raw input text and the chrono parse result
2. Removes the matched date substring from the text
3. Trims connective words ("on", "at", "by", "in")
4. Falls back to `"Follow up"` if nothing meaningful remains

This gives action items real context without requiring the user to fill out separate fields.

### 3.H Relationship Score Recomputation Service

`server/services/relationshipService.ts`:

```ts
export const relationshipService = {
  /**
   * Compute the relationship score for a single contact.
   * Called after each interaction creation for immediate feedback.
   */
  computeScore(contactId: string): number { /* ... */ },

  /**
   * Batch recompute all non-archived, non-ghost contact scores.
   * Called on server startup and every 60 minutes via setInterval.
   * Uses a single transaction for efficiency.
   */
  recomputeAll(): void {
    const contacts = sqlite.prepare(
      `SELECT id, cadenceDays, lastContactedAt FROM contacts
       WHERE isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)`
    ).all();

    const txn = sqlite.transaction(() => {
      for (const c of contacts) {
        const score = computeScoreForContact(c);
        sqlite.prepare('UPDATE contacts SET relationshipScore = ? WHERE id = ?')
          .run(score, c.id);
      }
    });
    txn();
  },
};
```

**Server startup integration** (`server.ts`):
```ts
// After app.listen():
relationshipService.recomputeAll();
setInterval(() => relationshipService.recomputeAll(), 60 * 60 * 1000); // hourly
```

---

## 4. Frontend Architecture

### 4.A The Dashboard View — `DashboardView.tsx`

The **Relationship Pulse Dashboard** replaces the "No Contact Selected" empty state at the `/` route (when no contact is selected) with a dynamic, card-based intelligence hub. It occupies the `flex-1` main area to the right of the contact list sidebar — the same layout treatment as `SettingsView` and `SearchView`.

**Full Layout:**

```
┌──────────────────────────────────────────────────────────────────────┐
│  Relationship Pulse                                     April 7     │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │  28          │  │  14 days    │  │  3           │  │  47         │ │
│  │  Active      │  │  Avg Gap    │  │  At Risk     │  │  Logged     │ │
│  │  Contacts    │  │             │  │  ⚠️          │  │  (30 days)  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │ ✨ AI Insight                                                 │   │
│  │ "You haven't reached out to anyone in Healthcare & AI in     │   │
│  │  45 days. Dr. Sarah Chen would be a natural reconnect."      │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  OVERDUE (2)                                                         │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │ 🔴 ┌──┐ Jane Smith · Acme Corp                               │   │
│  │    │  │ "Send revised proposal"                               │   │
│  │    └──┘ 2 days overdue                                        │   │
│  │         [Log Interaction]   [Snooze ▾]   [✓ Done]             │   │
│  └───────────────────────────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │ 🔴 ┌──┐ Bob Lee · Startup Inc                                │   │
│  │    │  │ "Follow up on seed round"                             │   │
│  │    └──┘ 5 days overdue                                        │   │
│  │         [Log Interaction]   [Snooze ▾]   [✓ Done]             │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  DUE TODAY (1)                                                       │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │ 🟡 ┌──┐ Alice Wong · BigCo                                   │   │
│  │    │  │ "Intro to investor network"                           │   │
│  │    └──┘ Due today                                             │   │
│  │         [Log Interaction]   [Snooze ▾]   [✓ Done]             │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  UPCOMING (3)                                                        │
│  ┌─── cards collapsed, expandable ──────────────────────────────┐   │
│                                                                      │
│  ── Two-Column Grid Below ──────────────────────────────────────    │
│                                                                      │
│  RELATIONSHIPS AT RISK               GHOST ENTITIES                  │
│  ┌───────────────────────┐           ┌───────────────────────┐      │
│  │ 🔴 Marcus Sterling    │           │ 👻 Sarah Johnson      │      │
│  │    Sterling Capital   │           │    Mentioned 7 times  │      │
│  │    Score: 23 · 67 days│           │    [Promote]          │      │
│  │    Last: "Q3 Sync"   │           └───────────────────────┘      │
│  └───────────────────────┘           ┌───────────────────────┐      │
│  ┌───────────────────────┐           │ 👻 Mike Peters        │      │
│  │ 🟡 Kenji Sato         │           │    Mentioned 4 times  │      │
│  │    Robotics Inc       │           │    [Promote]          │      │
│  │    Score: 35 · 42 days│           └───────────────────────┘      │
│  └───────────────────────┘                                           │
│                                                                      │
│  RECENTLY ADDED                                                      │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐                                         │
│  │  │ │  │ │  │ │  │ │  │   ← avatar row, hover for name           │
│  └──┘ └──┘ └──┘ └──┘ └──┘                                         │
└──────────────────────────────────────────────────────────────────────┘
```

**Component Breakdown:**

| Component | Responsibility |
|---|---|
| `DashboardView.tsx` | Top-level container, fetches `/api/dashboard`, orchestrates sub-components |
| `KPIRow.tsx` | Four metric cards in a responsive grid |
| `AIInsightCard.tsx` | Fetches `/api/dashboard/insight`, renders rotating sparkle card |
| `ActionItemSection.tsx` | Grouped action item cards (Overdue / Due Today / Upcoming) |
| `ActionItemCard.tsx` | Individual action card with avatar, title, urgency badge, quick actions |
| `SnoozeDropdown.tsx` | Glassmorphism popover with preset durations + custom date picker |
| `AtRiskSection.tsx` | Grid of contacts with low relationship scores |
| `GhostPromotionSection.tsx` | Cards for the most-mentioned ghost entities with promote CTA |
| `RecentlyAddedRow.tsx` | Compact avatar row for newest contacts |

### 4.B KPI Cards — `KPIRow.tsx`

Four metric cards in a responsive grid (4-column on desktop, 2×2 on tablet, stacked on mobile).

| Card | Value Source | Icon |
|---|---|---|
| **Active Contacts** | `metrics.totalActive` | `Users` |
| **Avg Gap** | `metrics.avgDaysSinceInteraction` formatted as "14 days" | `Clock` |
| **At Risk** | `metrics.atRiskCount` | `AlertTriangle` |
| **Activity (30d)** | `metrics.totalInteractions30d` | `MessageSquare` |

**Styling:**
- `bg-surface-container-lowest rounded-2xl shadow-sm p-5`
- Value: `text-3xl font-headline font-bold text-on-surface`
- Label: `text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mt-1`
- At Risk card uses `text-rose-500` for the value when count > 0
- Subtle `motion` stagger animation on mount (each card fades in 50ms apart)

### 4.C AI Insight of the Day — `AIInsightCard.tsx`

A full-width card between the KPI row and the action items section. Fetches from `GET /api/dashboard/insight`.

**Styling:**
- `bg-surface-container-lowest rounded-2xl shadow-sm p-5`
- `✨` icon prefix with `text-primary`
- Body text: `text-sm text-on-surface font-medium leading-relaxed`
- Shimmering skeleton loader while generating
- Hidden entirely when Gemini key is unavailable or insight is `null`
- Category badge: subtle pill showing insight type (e.g., "Industry Gap", "Engagement")

### 4.D Action Item Cards — `ActionItemCard.tsx`

Each card in the Overdue/Today/Upcoming sections contains:

1. **Avatar** — `HealthRingAvatar` (reuse existing component, now powered by real `relationshipScore`)
2. **Contact name + company** — clickable, navigates to `/contact/:id`
3. **Action item title** — the *what* (e.g., "Send revised proposal"), displayed as the card's primary text in `font-semibold`
4. **Urgency badge** — color-coded pill (`2 days overdue`, `Today`, `In 3 days`)
5. **Quick actions bar:**
   - **[Log Interaction]** — Navigates to `/contact/:id` (the profile includes the composer)
   - **[Snooze ▾]** — Opens `SnoozeDropdown` with presets: `Tomorrow`, `3 Days`, `1 Week`, `2 Weeks`, `1 Month`, `Custom Date...`
   - **[✓ Done]** — Marks `completedAt = now()`, card animates out with `motion` exit. Trigger recomputes `nextFollowUpAt`.

**Multiple items per contact:** If a contact has 2+ pending action items, they render as *separate cards* grouped under the same urgency tier. Each card is independently snoozable/completable. This is the key behavior change from `nextFollowUpAt`'s single-slot limitation.

**Section headers:** `text-[10px] font-bold uppercase tracking-widest` with tier-specific coloring (`text-rose-500` for Overdue, `text-amber-500` for Today, `text-primary` for Upcoming). Section count shown in parentheses.

**Empty state:** When all action items are cleared:
> "You're all caught up! 🎉"  
> "No action items pending. Keep building relationships."

### 4.E Snooze Dropdown — `SnoozeDropdown.tsx`

A glassmorphism popover (`glass-panel`) triggered by the Snooze button on each action card.

**Preset options:**
| Label | Behavior |
|---|---|
| Tomorrow | `dueAt = startOfDay(addDays(now, 1))` |
| 3 Days | `dueAt = startOfDay(addDays(now, 3))` |
| 1 Week | `dueAt = startOfDay(addDays(now, 7))` |
| 2 Weeks | `dueAt = startOfDay(addDays(now, 14))` |
| 1 Month | `dueAt = startOfDay(addMonths(now, 1))` |
| Custom Date... | Opens inline date picker (native `<input type="date">` styled to match design system) |

All presets fire `PATCH /api/action-items/:id` with the new `dueAt`. Optimistic update via React Query `onMutate` — card re-sorts into its new urgency tier immediately.

### 4.F Ghost Promotion Section — `GhostPromotionSection.tsx`

Surfaces up to 5 ghost contacts (entities auto-created via `@mention` in interaction notes that don't match an existing contact) ranked by mention frequency.

**Each ghost card shows:**
- Avatar (DiceBear generated, same as current ghost rendering)
- Name + company (if extracted)
- "Mentioned N times" badge
- **[Promote]** button — calls `POST /api/contacts/:id/promote-ghost` which sets `isGhost = 0` (already implemented in `interactionService.promoteGhost`)
- On promote: card animates out, `contacts` query invalidated, toast: "**{name}** promoted to full contact"

**Existing infrastructure leveraged:**
- `interactionService.promoteGhost()` already exists and works
- `interaction_mentions` junction table already tracks ghost mentions
- Ghost contacts already have `isGhost = 1` flag

### 4.G At Risk Section — `AtRiskSection.tsx`

A grid of contacts whose `relationshipScore` has dropped below 40, ordered by score ascending (most at-risk first). Limited to 10 contacts.

**Each card shows:**
- `HealthRingAvatar` (ring fill reflects actual score)
- Name + company
- Score badge: `"Score: 23"` in `text-rose-500`
- Days since last contact: `"67 days"` in `text-on-surface-variant`
- Last interaction title (truncated): `"Q3 Deal Flow Sync"` in `text-xs text-on-surface-variant`
- Clicking navigates to `/contact/:id`

**No action buttons on this card** — the card is informational. The action is implicitly "go reach out" via the click navigation.

### 4.H Recently Added — `RecentlyAddedRow.tsx`

A compact horizontal row of the 5 most recently added non-ghost contacts. Avatar-only with hover tooltips showing name + company.

**Styling:**
- Avatars: `w-10 h-10 rounded-full` with `ring-2 ring-surface-container-lowest` for the stacked overlap effect
- Hover: `scale-110` transition + Tippy tooltip with name and "Added 2 days ago"
- Click: navigate to `/contact/:id`

### 4.I Sidebar Badge — `Sidebar.tsx`

Add an "Action Items" nav icon between Search and Settings in the existing sidebar. The badge count is fetched via a dedicated React Query hook with a 60-second refetch interval.

```
[Home]  [Map]  [Search]  [Pulse (3)]  [Settings]
```

**Implementation:**
- New icon: `CalendarCheck` from `lucide-react`
- New route: `/pulse` (or rendered inline at `/` as the default main panel)
- Badge styling: A `min-w-[18px] h-[18px] rounded-full` pill with `bg-rose-500 text-white text-[10px] font-bold` positioned `absolute -top-1 -right-1` on the icon wrapper.
- Badge shows count of **overdue + due today** only (not upcoming).
- Badge hides when count is 0 (no empty badge rendered).

**React Query hook:**
```ts
export const useActionItemCount = () => {
  return useQuery({
    queryKey: ['action-items', 'count'],
    queryFn: async () => {
      const res = await fetch('/api/action-items/count');
      if (!res.ok) throw new Error('Failed');
      return res.json() as Promise<{ count: number }>;
    },
    refetchInterval: 60_000,
  });
};
```

### 4.J Contact List Indicators — `ContactListItem.tsx`

In the network list sidebar, contacts with upcoming/overdue action items and relationship health get subtle visual indicators. Both signals come from the `slim` endpoint — **zero additional API calls**.

**Action Item Indicators** (reads `contact.nextFollowUpAt`):
- **Overdue:** Small `CalendarClock` icon in `text-rose-500` after the company name, with a pulsing `ring-2 ring-rose-500/30` animation on the avatar.
- **Due Today:** Same icon in `text-amber-500`, no pulse.
- **Upcoming (≤7 days):** Faint `CalendarClock` in `text-on-surface-variant/50`.

**Relationship Health Dot** (reads `contact.relationshipScore`):
- A 6px colored dot positioned on the bottom-right corner of the avatar:
  - Score ≥ 70: `bg-emerald-500`
  - Score 40–69: `bg-amber-500`
  - Score < 40: `bg-rose-500`
- Dot has a `ring-2 ring-surface-container-lowest` to stand out against the avatar.

### 4.K HealthRingAvatar Upgrade — `HealthRingAvatar.tsx`

The existing component renders the ring at 100% fill with just a theme color. **Upgrade it** to use the real `relationshipScore`:

**Current behavior:** `strokeDashoffset = 0` (always full circle in theme color).

**New behavior:**
- Ring fill percentage = `relationshipScore / 100`
- Ring color = health tier color:
  - Score ≥ 70: `emerald-500` (#10B981)
  - Score 40–69: `amber-500` (#F59E0B)
  - Score < 40: `rose-500` (#F43F5E)
- Fallback: When `relationshipScore` is undefined/null (e.g., on ghost contacts), fall back to current behavior (full ring in theme color).

```ts
const scorePercent = contact.relationshipScore != null 
  ? contact.relationshipScore / 100 
  : 1;
const healthColor = contact.relationshipScore != null
  ? contact.relationshipScore >= 70 ? '#10B981'    // emerald
    : contact.relationshipScore >= 40 ? '#F59E0B'  // amber
    : '#F43F5E'                                     // rose
  : hexColor;                                       // fallback to theme

// strokeDashoffset = circumference * (1 - scorePercent)
```

The ring animation already exists — the `initialRender` state triggers a nice animated fill on mount. This naturally extends to showing the score-based partial fill.

### 4.L Profile Banner — `ProfileHeader.tsx`

When viewing a contact with pending action items, render an interruptive banner below the identity section. Fetch via `GET /api/contacts/:id/action-items`.

**Single item — Overdue:**
```
┌──────────────────────────────────────────────┐
│ ⚠️  "Send revised proposal" — 3 days overdue │
│     [Log Interaction]    [Snooze 1 Week]  [✓]│
└──────────────────────────────────────────────┘
```

**Multiple items — Stacked pills:**
```
┌──────────────────────────────────────────────┐
│ 📋 2 Action Items                            │
│  🔴 "Send revised proposal" — 3 days overdue │
│     [Snooze ▾]  [✓ Done]                     │
│  🟡 "Intro to Bob" — Due today               │
│     [Snooze ▾]  [✓ Done]                     │
│                         [Log Interaction]     │
└──────────────────────────────────────────────┘
```

**Styling:**
- Overdue: `bg-rose-500/10 text-rose-600` with left accent gradient (no border — uses background shift per No-Line rule)
- Today: `bg-amber-500/10 text-amber-600` with same pattern
- Multi-item banner: `bg-surface-container-low` with individual items using urgency-colored left accents
- The banner appears via `AnimatePresence` with a slide-down entrance
- **[Log Interaction]** auto-scrolls to and focuses the `RichInteractionComposer`
- **[Snooze 1 Week]** fires `PATCH /api/action-items/:id` and the item smoothly exits
- **[✓ Done]** fires `PATCH /api/action-items/:id/complete` — when last item completes, banner exits

### 4.M Mobile Concerns

**Dashboard:** Single-column stacked layout. KPI cards become 2×2 grid. Action item sections stack vertically.

**Mobile bottom nav** (already exists in `App.tsx`): Add the Pulse icon with badge, matching the sidebar addition.

```tsx
<Link to="/pulse" className={...}>
  <CalendarCheck className="w-6 h-6" />
  {actionItemCount > 0 && <span className="badge">{actionItemCount}</span>}
</Link>
```

---

## 5. Routing & File Changes

### Routing Updates (`App.tsx`)

| Change | Detail |
|---|---|
| Dashboard as default | When no contact is selected, render `DashboardView` instead of `EmptyState` in the main panel |
| Pulse route | Optional: `<Route path="/pulse" element={<DashboardView />} />` for direct nav |
| `isPulse` flag | Add `location.pathname.startsWith('/pulse')` to the full-page view conditional |

**Design decision:** The dashboard renders as the **default main panel** when no contact is selected (replacing "No Contact Selected"). It does NOT get a separate full-page route like Settings/Search — the contact list remains visible in the left panel so users can quickly navigate to a contact after seeing their action items. The `/pulse` route is an alias that renders the same view.

### New Files

| File | Purpose |
|---|---|
| **Schema & Types** | |
| `src/db/schema.ts` | Add `actionItems` table + `relationshipScore` column on contacts |
| `src/types.ts` | Add `ActionItem` interface, `relationshipScore` to `Contact` |
| **Backend** | |
| `server/routes/actionItems.ts` | Express router: CRUD for action items |
| `server/routes/dashboard.ts` | Express router: dashboard aggregate + AI insight |
| `server/services/actionItemService.ts` | Business logic for action item CRUD |
| `server/services/dashboardService.ts` | Aggregate query builder for dashboard payload |
| `server/services/relationshipService.ts` | Score computation + hourly recompute |
| **Frontend** | |
| `src/api/actionItems.ts` | React Query hooks: `useActionItems`, `useActionItemCount`, `useContactActionItems`, `useCreateActionItem`, `useSnoozeActionItem`, `useCompleteActionItem`, `useDeleteActionItem` |
| `src/api/dashboard.ts` | React Query hooks: `useDashboard`, `useDailyInsight` |
| `src/views/dashboard/DashboardView.tsx` | Top-level dashboard container |
| `src/views/dashboard/KPIRow.tsx` | Four metric cards |
| `src/views/dashboard/AIInsightCard.tsx` | Daily AI insight |
| `src/views/dashboard/ActionItemSection.tsx` | Grouped action items by urgency |
| `src/views/dashboard/ActionItemCard.tsx` | Individual action item card |
| `src/views/dashboard/SnoozeDropdown.tsx` | Glassmorphism snooze popover |
| `src/views/dashboard/AtRiskSection.tsx` | Low-score contact grid |
| `src/views/dashboard/GhostPromotionSection.tsx` | Ghost entity cards |
| `src/views/dashboard/RecentlyAddedRow.tsx` | Compact recently-added avatars |

### Modified Files

| File | Change |
|---|---|
| `src/components/layout/Sidebar.tsx` | Add Pulse nav link with badge between Search and Settings |
| `src/App.tsx` | Render `DashboardView` as default main panel, add mobile nav icon |
| `src/components/HealthRingAvatar.tsx` | Upgrade ring to use `relationshipScore` for fill % and color |
| `src/views/contact-list/ContactListItem.tsx` | Add `CalendarClock` indicator + relationship health dot |
| `src/views/contact-detail/components/ProfileHeader.tsx` | Add urgency banner with per-contact action items |
| `src/components/RichInteractionComposer.tsx` | Send `actionItem: { title, dueAt }` in interaction payload + NLP title extraction |
| `server/services/contactService.ts` | Add `relationshipScore` to `getSlimContacts()` SELECT |
| `server/services/interactionService.ts` | Accept `actionItem` in `createInteraction`, trigger score recompute |
| `server/utils/validators.ts` | Add `actionItem` to `interactionCreateSchema` |
| `server/db.ts` | Install `action_items` sync triggers, create table DDL |
| `server.ts` | Mount `actionItemsRouter`, `dashboardRouter`, start hourly score recompute |

---

## 6. Edge Cases & Robustness

| Edge Case | Handling |
|---|---|
| **Stale `nextFollowUpAt` from before action_items** | On first startup, run a one-time backfill: for each contact with a non-null `nextFollowUpAt` and no `action_items` rows, create an action item with `title: "Follow up"` and `dueAt: nextFollowUpAt`. Then the trigger takes over. |
| **User logs interaction but doesn't complete the action item** | The action item persists. Logging an interaction is NOT an implicit complete — the user may need to do something else. Explicit complete required. |
| **User snoozes an action item multiple times** | Each snooze overwrites `dueAt` on that specific action item. No snooze history; intentional simplicity. |
| **Contact has multiple action items** | Each is independently tracked. `contacts.nextFollowUpAt` trigger always resolves to `MIN(dueAt)` of pending items. Dashboard shows each as a separate card. |
| **Archived contacts with action items** | Excluded from all dashboard and action item queries (`isArchived = 0`). Archiving implicitly silences reminders. Action items are NOT deleted — unarchiving restores them. |
| **Action item with `dueAt` far in the future** | Appears in the "Scheduled" group on the dashboard (collapsed by default). Always visible in the per-contact action items list in the profile. |
| **Contact deleted with pending action items** | `ON DELETE CASCADE` on `contactId` FK cleans up automatically. |
| **Timezone handling** | All dates stored as ISO 8601 UTC. Client-side classification uses `startOfDay(new Date())` from `date-fns` against parsed UTC dates. |
| **Rapid snooze + navigate away** | Optimistic update via React Query `onMutate`. Card animates out immediately; server write happens async. Rollback on error with toast. |
| **Badge count staleness** | 60-second polling via `refetchInterval` + immediate invalidation on any mutation that touches `action_items` (snooze, complete, create via interaction). |
| **No ghost entities exist** | Ghost promotion section gracefully hides when `ghosts.length === 0`. |
| **No at-risk contacts** | At Risk section gracefully hides. The KPI card still shows "0" which is positive feedback. |
| **Gemini key not configured** | AI Insight card hides silently. Dashboard functions fully without it. No error states. |
| **Relationship score for new contacts** | Default `50`. Score will naturally adjust on first hourly recompute based on recency/frequency once interactions exist. |
| **Ghost contacts and relationship scores** | Ghosts are excluded from score computation (`isGhost = 0` filter). Their `HealthRingAvatar` uses the theme color fallback at full fill. |
| **Dashboard performance with 500+ contacts** | All dashboard queries are indexed and bounded (LIMIT clauses). Total payload assembly target: <10ms. Single `useDashboard` query on mount with 60s `refetchInterval`. |

---

## 7. Implementation Phases

### Phase 1: Schema + Core Backend (Foundation) — ~2 hours
1. Add `actionItems` table to Drizzle schema
2. Add `relationshipScore` column to `contacts` table
3. Install `action_items` sync triggers in `server/db.ts`
4. Create `server/services/actionItemService.ts` with full CRUD
5. Create `server/routes/actionItems.ts`
6. Mount router in `server.ts`
7. Backfill: migrate any existing `contacts.nextFollowUpAt` values into `action_items` rows
8. Extend `interactionService.createInteraction` to accept `actionItem` object

### Phase 2: Relationship Scoring Engine — ~1.5 hours
1. Create `server/services/relationshipService.ts` with scoring algorithm
2. Wire hourly recompute in `server.ts`
3. Add `relationshipScore` to `getSlimContacts()` SELECT
4. Score recompute on interaction creation

### Phase 3: Dashboard API — ~1 hour
1. Create `server/services/dashboardService.ts` with aggregate queries
2. Create `server/routes/dashboard.ts` with `/api/dashboard` and `/api/dashboard/insight`
3. Mount router in `server.ts`

### Phase 4: Frontend — Action Items Hooks + Sidebar Badge — ~1 hour
1. Create `src/api/actionItems.ts` React Query hooks
2. Create `src/api/dashboard.ts` React Query hooks
3. Add badge to `Sidebar.tsx` and mobile nav
4. Add Pulse route to `App.tsx`

### Phase 5: Dashboard View (Core Experience) — ~3 hours
1. Build `DashboardView.tsx` with KPI row
2. Build AI Insight card
3. Build Action Item sections with grouped cards
4. Implement snooze dropdown with presets
5. Implement complete action (✓ Done) with optimistic removal
6. Build Ghost Promotion section
7. Build At Risk section
8. Build Recently Added row
9. Empty state celebration animation

### Phase 6: In-Context Indicators + HealthRing Upgrade — ~2 hours
1. Upgrade `HealthRingAvatar.tsx` to use `relationshipScore`
2. Add `CalendarClock` indicators to `ContactListItem.tsx`
3. Add relationship health dots to `ContactListItem.tsx`
4. Add urgency banner to `ProfileHeader.tsx`
5. Fix atomicity bug in `RichInteractionComposer.tsx` (single-call pattern + NLP title extraction)

### Phase 7: Polish & Delight — ~1 hour
1. `motion` stagger animations on dashboard mount
2. Celebration animation when last action item is cleared
3. Keyboard shortcuts in dashboard: `S` snooze, `D` done, `L` log interaction
4. Loading skeletons for all async sections

**Total estimated effort: ~3 days**

---

## 8. What This Design Intentionally Does NOT Include

| Omission | Rationale |
|---|---|
| **Recurring action items** | V1 keeps it simple: one-shot tasks. Recurrence would require a cron-like scheduler and significantly more complexity for a niche use case. Users can manually create a new action item after completing a recurring one. |
| **Priority levels on action items** | Urgency is already communicated by the due date (overdue > today > upcoming). Adding a separate priority dimension creates cognitive overhead without clear benefit. |
| **Notification system (push/email)** | This is a local-first app. All awareness is visual and in-app. Push notifications are a separate feature with different infrastructure requirements. |
| **Custom snooze durations with time-of-day** | The NLP input in the composer already handles precision scheduling ("follow up Tuesday at 2pm"). The snooze presets are for quick deferral only. |
| **Standalone tasks (no contact)** | Action Items are always tied to a contact. For general to-dos, use a dedicated task manager. This is a CRM, not Todoist. |
| **Composite `/api/dashboard/log` endpoint** | Unnecessary. "Log Interaction" on the dashboard navigates to the contact profile where the existing composer handles it. |
| **Full re-engagement suggestion text** | V1 surfaces *which* contacts are at risk and links to their profiles. AI-generated re-engagement messages ("Consider congratulating Marcus on his new fund launch") are deferred to a future PR once the scoring engine is validated. |
| **Historical score graph** | Tracking score over time requires a new table and storage overhead. V1 shows the current score only. Historical trending is a natural follow-up. |
| **Dashboard customization / drag-to-reorder sections** | Fixed layout in V1. User customization adds significant state management complexity for marginal benefit at this stage. |
