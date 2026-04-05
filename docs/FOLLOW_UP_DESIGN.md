# Action Items — Proactive Relationship Management Engine

> **Status:** Design Approved — Ready for Implementation  
> **Scope:** New `action_items` schema table, Backend API, Sidebar, Dedicated View, Contact List, Contact Profile  
> **Depends on:** `contacts` table (schema exists), `POST /api/contacts/:id/interactions` (exists)

---

## 1. The Problem

Today, `nextFollowUpAt` is a bare date field on `contacts` — a write-only slot. Users can set it via the NLP input in the Rich Interaction Composer, but:

1. **No global visibility.** The date is only visible deep inside an individual Contact Profile — the user must remember *who* they set it for and manually navigate there.
2. **No urgency signal.** There is zero visual distinction between a contact due for follow-up today and one due in three months.
3. **No resolution path.** Seeing a reminder provides no shortcut to act on it. The user must scroll to the timeline composer, manually log an interaction, and then separately clear the follow-up.
4. **No deferral mechanism.** If the user can't act today, there is no way to snooze the reminder without editing a raw date string.
5. **One item per contact.** A single date field cannot represent multiple tasks ("Send proposal" AND "Intro to Bob"). Real relationship management requires multiple concurrent action items per contact.
6. **No task context.** A raw date says *when* but not *what*. The user must recall what they intended to do.

This is a **UX dead zone** — a reminder system that requires the user to do all the remembering defeats its own purpose. The app is acting as a passive Rolodex instead of an active relationship manager.

---

## 2. Design Philosophy

Three pillars govern how Action Items surface across the app:

| Principle | Definition | Application |
|---|---|---|
| **Ambient Awareness** | Pending tasks visible without context switching | Sidebar badge count, list indicators |
| **Interruptive Urgency** | Overdue items demand attention on the primary surface | Dedicated Action Items view, profile banners |
| **Immediate Affordance** | Seeing a task offers a one-click resolution path | Log Interaction, Snooze, Clear — always visible on the card |

### Classification System

Every action item's `dueAt` value maps to exactly one urgency tier:

| Tier | Condition | Color Token | Icon Treatment |
|---|---|---|---|
| **Overdue** | `dueAt < today` | `rose-500` | Pulsing dot + bold badge |
| **Due Today** | `dueAt == today` | `amber-500` | Solid dot + badge |
| **Upcoming** | `today < dueAt <= today + 7d` | `primary` | Subtle icon, no dot |
| **Scheduled** | `dueAt > today + 7d` | `on-surface-variant` | Calendar icon only |

---

## 3. Backend Architecture

### 3.A Schema — The `action_items` Table

Since we have full schema freedom (no production data to migrate), Action Items should be a **first-class entity** rather than a bare date field on `contacts`. This unlocks:
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
  dueAt: text('dueAt').notNull(),
  completedAt: text('completedAt'),
  createdAt: text('createdAt').default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text('updatedAt').default(sql`(CURRENT_TIMESTAMP)`),
});
```

**Keep `contacts.nextFollowUpAt` as a trigger-maintained cache.** This field becomes a denormalized read-optimization — automatically set to `MIN(dueAt)` across pending (non-completed) action items. This ensures the `slim` contact list query stays fast (no JOIN needed) and the sidebar badge count remains a single-table scan.

**Sync triggers** (installed in `server/db.ts`):
```sql
CREATE TRIGGER action_items_sync_insert AFTER INSERT ON action_items BEGIN
  UPDATE contacts SET nextFollowUpAt = (
    SELECT MIN(dueAt) FROM action_items
    WHERE contactId = NEW.contactId AND completedAt IS NULL
  ) WHERE id = NEW.contactId;
END;

CREATE TRIGGER action_items_sync_update AFTER UPDATE ON action_items BEGIN
  UPDATE contacts SET nextFollowUpAt = (
    SELECT MIN(dueAt) FROM action_items
    WHERE contactId = NEW.contactId AND completedAt IS NULL
  ) WHERE id = NEW.contactId;
END;

CREATE TRIGGER action_items_sync_delete AFTER DELETE ON action_items BEGIN
  UPDATE contacts SET nextFollowUpAt = (
    SELECT MIN(dueAt) FROM action_items
    WHERE contactId = OLD.contactId AND completedAt IS NULL
  ) WHERE id = OLD.contactId;
END;
```

This means:
- `contacts.nextFollowUpAt` is **never written directly** by application code anymore.
- All mutations go through `action_items` — the triggers keep the cache in sync.
- The `slim` endpoint, sidebar badge, and list indicators all read `contacts.nextFollowUpAt` as before — zero query changes needed.

**TypeScript type** (`src/types.ts`):
```ts
export interface ActionItem {
  id: string;
  contactId: string;
  title: string;
  dueAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Joined from contacts (only on list endpoints)
  contactName?: string;
  contactCompany?: string | null;
  contactAvatarUrl?: string | null;
  contactThemeColor?: string;
}
```

### 3.B API Endpoints — `server/routes/actionItems.ts`

A dedicated Express router for full CRUD on action items.

#### `GET /api/action-items` — Global Action Items List

Returns all pending action items with contact info, sorted by urgency.

```sql
SELECT ai.*, c.name as contactName, c.company as contactCompany,
       c.avatarUrl as contactAvatarUrl, c.themeColor as contactThemeColor
FROM action_items ai
JOIN contacts c ON ai.contactId = c.id
WHERE ai.completedAt IS NULL
  AND ai.dueAt <= date('now', '+7 days')
  AND (c.isArchived = 0 OR c.isArchived IS NULL)
ORDER BY ai.dueAt ASC
```

#### `GET /api/action-items/count` — Badge Count

Lean endpoint for the sidebar badge:

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
Snoozing = `{ dueAt: addDays(new Date(), 7).toISOString() }`. The trigger handles the rest.

#### `PATCH /api/action-items/:id/complete` — Complete

Sets `completedAt = now()`. The trigger recomputes `contacts.nextFollowUpAt` to the next pending item (or `null` if none remain).

#### `DELETE /api/action-items/:id` — Delete

Permanently removes the action item. Trigger recomputes the cache.

### 3.C Atomicity Fix — Composite Interaction + Action Item

The current `RichInteractionComposer.tsx` makes **two separate calls** when logging an interaction with a follow-up date:

1. `POST /api/contacts/:id/interactions` — creates the timeline entry  
2. `PUT /api/contacts/:id` — updates `nextFollowUpAt`

If call (2) fails, we get a logged interaction with no scheduled follow-up — a silent data integrity bug.

**Fix:** Extend `createInteraction` in `interactionService.ts` to accept an optional `actionItem: { title, dueAt }` in the request body. The service creates the interaction AND the action item in the same synchronous call:

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
- The action item is created with a real **title** derived from the NLP input (e.g., user types "follow up about the partnership next Tuesday" → title becomes "Follow up about the partnership", dueAt becomes next Tuesday).

### 3.D NLP Title Extraction

The `RichInteractionComposer` already uses `chrono-node` to parse dates from natural language. We extend this to also extract the task description:

```ts
// Input: "Follow up about the deal next Tuesday at 2pm"
// chrono parses: date = next Tuesday 2pm
// Title extraction: strip the date phrase → "Follow up about the deal"
// If no meaningful text remains, default title: "Follow up"
```

This gives action items real context without requiring the user to fill out separate fields.

---

## 4. Frontend Architecture

### 4.A Sidebar Badge — `Sidebar.tsx`

Add an "Action Items" nav icon between Search and Settings. The badge count is fetched via a dedicated React Query hook with a 60-second refetch interval.

```
[Home]  [Map]  [Search]  [Action Items (3)]  [Settings]
```

**Implementation:**
- New icon: `CalendarCheck` from `lucide-react`
- New route: `/action-items`
- Badge styling: A `min-w-[18px] h-[18px] rounded-full` pill with `bg-rose-500 text-white text-[10px] font-bold` positioned `absolute -top-1 -right-1` on the icon wrapper.
- Badge shows count of **overdue + due today** only (not upcoming).
- Badge hides when count is 0 (no empty badge).

**React Query hook:**
```ts
export const useActionItemCount = () => {
  return useQuery({
    queryKey: ['action-items', 'count'],
    queryFn: async () => {
      const res = await fetch('/api/contacts/action-items/count');
      if (!res.ok) throw new Error('Failed');
      return res.json() as Promise<{ count: number }>;
    },
    refetchInterval: 60_000,
  });
};
```

### 4.B Dedicated Action Items View — `/action-items`

A **full-page view** (same layout treatment as `SettingsView` and `SearchView` — takes `flex-1` main area alongside the sidebar). This replaces the original design's "dashboard scroll rail" which would have been too cramped for real use and invisible on mobile.

**Layout:**
```
┌──────────────────────────────────────────────┐
│  Action Items                     Sort ▾     │
│  ─────────────────────────────────────────── │
│  OVERDUE (2)                                 │
│  ┌─────────────────────────────────────────┐ │
│  │ 🔴 Jane Smith · Acme Corp              │ │
│  │    "Send revised proposal"              │ │
│  │    2 days overdue                       │ │
│  │    [Log Interaction]  [Snooze ▾]  [✓]   │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │ 🔴 Bob Lee · Startup Inc               │ │
│  │    "Follow up on seed round"            │ │
│  │    5 days overdue                       │ │
│  │    [Log Interaction]  [Snooze ▾]  [✓]   │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  DUE TODAY (1)                               │
│  ┌─────────────────────────────────────────┐ │
│  │ 🟡 Alice Wong · BigCo                  │ │
│  │    "Intro to investor network"          │ │
│  │    Due today                            │ │
│  │    [Log Interaction]  [Snooze ▾]  [✓]   │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  UPCOMING (3)                                │
│  ┌─────────────────────────────────────────┐ │
│  │ 🔵 Chris Park · DeepTech               │ │
│  │    "Follow up about the partnership"    │ │
│  │    Due in 3 days                        │ │
│  │    [Log Interaction]  [Snooze ▾]  [✓]   │ │
│  └─────────────────────────────────────────┘ │
│  ... more cards ...                          │
└──────────────────────────────────────────────┘
```

**Each Action Card contains:**
1. **Avatar** — `HealthRingAvatar` (already exists, reuse)
2. **Contact name + company** — clickable, opens `FloatingContactCard` overlay
3. **Action item title** — the *what* (e.g., "Send revised proposal"), displayed as the card's primary text in `font-semibold`
4. **Urgency badge** — color-coded pill (`Overdue`, `Today`, `In 3 days`)
5. **Quick actions bar:**
   - **[Log Interaction]** — Opens `FloatingContactCard` (which includes the timeline composer for immediate logging)
   - **[Snooze ▾]** — Dropdown with presets: `Tomorrow`, `3 Days`, `1 Week`, `2 Weeks`, `1 Month`, `Custom Date...`
   - **[✓ Done]** — Marks `completedAt = now()`, card animates out. Trigger recomputes `nextFollowUpAt`.

**Multiple items per contact:** If a contact has 2+ pending action items, they render as separate cards grouped under the same urgency tier. Each card is independently snoozable/completable.

**Empty state:** When all items are cleared, show a celebratory empty state:
> "You're all caught up! 🎉"  
> "No action items pending. Keep building relationships."

**Design system compliance:**
- Cards use `bg-surface-container-lowest rounded-2xl shadow-sm` (No-Line rule)
- Section headers use `LABEL` style: `text-[10px] font-bold uppercase tracking-widest text-on-surface-variant`
- Snooze dropdown uses `glass-panel` (glassmorphism)
- Quick action buttons use `btn-secondary` (ghost style, rounded-full)
- The overdue section header uses `text-rose-500`, today uses `text-amber-500`, upcoming uses `text-primary`

### 4.C Contact List Indicators — `ContactListItem.tsx`

In the network list view, contacts with upcoming or overdue action items get a subtle visual indicator:

- **Overdue:** A small `CalendarClock` icon in `text-rose-500` placed after the company name, with a pulsing `ring-2 ring-rose-500/30` animation on the avatar.
- **Due Today:** Same icon in `text-amber-500`, no pulse.
- **Upcoming (≤7 days):** Faint `CalendarClock` in `text-on-surface-variant/50`.

This requires no additional API call — the `slim` endpoint already includes `nextFollowUpAt` in its response (verified in `contactService.getSlimContacts()`).

### 4.D Profile Banner — `ProfileHeader.tsx`

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
- The banner appears via `AnimatePresence` with a slide-down entrance
- **[Log Interaction]** auto-scrolls to and focuses the `RichInteractionComposer`
- **[Snooze 1 Week]** fires `PATCH /api/action-items/:id` and the item smoothly exits
- **[✓ Done]** fires `PATCH /api/action-items/:id/complete` — when last item completes, banner exits

### 4.E Mobile Navigation

Add the Action Items icon to the mobile bottom nav in `App.tsx`:
```tsx
<Link to="/action-items" className={...}>
  <CalendarCheck className="w-6 h-6" />
  {actionItemCount > 0 && <span className="badge">{actionItemCount}</span>}
</Link>
```

---

## 5. Routing Changes

### `App.tsx` Updates

| Change | Detail |
|---|---|
| New route | `<Route path="/action-items" element={<ActionItemsView />} />` |
| Layout treatment | Same as `/settings` and `/search` — full-page, sidebar + main |
| `isActionItems` flag | Add `location.pathname.startsWith('/action-items')` to the full-page view conditional |

### New Files

| File | Purpose |
|---|---|
| `src/db/schema.ts` | Add `actionItems` table + relations |
| `src/views/ActionItemsView.tsx` | Main view component |
| `src/api/actionItems.ts` | React Query hooks (`useActionItems`, `useActionItemCount`, `useContactActionItems`, `useCreateActionItem`, `useSnoozeActionItem`, `useCompleteActionItem`, `useDeleteActionItem`) |
| `server/routes/actionItems.ts` | Express router with full CRUD |
| `server/services/actionItemService.ts` | Business logic for action item operations |

### Modified Files

| File | Change |
|---|---|
| `src/types.ts` | Add `ActionItem` interface |
| `src/components/layout/Sidebar.tsx` | Add Action Items nav link with badge |
| `src/App.tsx` | Add route, add mobile nav icon, add layout branch |
| `src/views/contact-list/ContactListItem.tsx` | Add `CalendarClock` indicator for due contacts (reads existing `nextFollowUpAt` from slim) |
| `src/views/contact-detail/components/ProfileHeader.tsx` | Add urgency banner showing per-contact action items with Done/Snooze |
| `src/components/RichInteractionComposer.tsx` | Send `actionItem: { title, dueAt }` in the interaction payload instead of separate `nextFollowUpAt` call |
| `server/services/interactionService.ts` | Accept `actionItem` object in `createInteraction`, insert into `action_items` table |
| `server/utils/validators.ts` | Add `actionItem` object to `interactionCreateSchema` |
| `server/db.ts` | Install `action_items` sync triggers |
| `server.ts` | Mount `actionItemsRouter` |

---

## 6. Edge Cases & Robustness

| Edge Case | Handling |
|---|---|
| Contact has stale `nextFollowUpAt` from before this feature existed | On first startup after migration, the value stays as-is. The user can clear it from the profile banner, or we run a one-time backfill that creates `action_items` rows from existing `nextFollowUpAt` values with a default title of "Follow up". |
| User logs an interaction but doesn't complete the action item | The action item persists. Logging an interaction is not an implicit complete — the user may need to do something else. Explicit complete required. |
| User snoozes an action item multiple times | Each snooze overwrites `dueAt` on that specific action item. No snooze history; this is intentional simplicity. |
| Contact has multiple action items | Each is independently tracked. `contacts.nextFollowUpAt` trigger always resolves to the earliest pending `dueAt`. |
| Archived contacts with action items | Excluded from all Action Items queries (`isArchived = 0`). Archiving implicitly silences reminders. Action items are NOT deleted — unarchiving restores them. |
| Action item with `dueAt` far in the future | Does not appear in the Action Items view (>7 days out). Still visible in the per-contact action items list in the profile. |
| Contact deleted with pending action items | `ON DELETE CASCADE` on `contactId` FK cleans up automatically. |
| Timezone handling | All dates stored as ISO 8601 UTC. Client-side classification uses `startOfDay(new Date())` from `date-fns` against parsed UTC dates for comparison. |
| Rapid snooze + navigate away | Optimistic update via React Query `onMutate`. Card animates out immediately; server write happens async. Rollback on error with toast. |
| Badge count staleness | 60-second polling + invalidation on any mutation that touches `action_items` (snooze, complete, create via interaction). |

---

## 7. Implementation Phases

### Phase 1: Schema + Backend (Foundation)
1. Add `action_items` table to Drizzle schema + generate migration
2. Install sync triggers in `server/db.ts`
3. Create `server/services/actionItemService.ts`
4. Create `server/routes/actionItems.ts` with full CRUD
5. Mount router in `server.ts`
6. Backfill: migrate any existing `contacts.nextFollowUpAt` values into `action_items` rows
7. Extend `interactionService.createInteraction` to accept `actionItem` object

### Phase 2: Sidebar Badge + Routing
1. Create `src/api/actionItems.ts` React Query hooks
2. Add `useActionItemCount` hook with 60s polling
3. Add badge to `Sidebar.tsx` and mobile nav
4. Add `/action-items` route to `App.tsx`

### Phase 3: Dedicated View (Core Experience)
1. Build `ActionItemsView.tsx` with grouped cards showing titles
2. Implement snooze dropdown with presets
3. Implement complete action (✓ Done) with optimistic removal
4. Wire `FloatingContactCard` for "Log Interaction"

### Phase 4: In-Context Indicators (Polish)
1. Add `CalendarClock` indicators to `ContactListItem.tsx`
2. Add urgency banner to `ProfileHeader.tsx` with per-contact action items
3. Fix atomicity bug in `RichInteractionComposer.tsx` (single-call pattern with NLP title extraction)

### Phase 5: Delight
1. Empty state celebration animation
2. Keyboard shortcuts (e.g., `S` to snooze, `L` to log, `D` to mark done in the Action Items view)

---

## 8. What This Design Intentionally Does NOT Include

| Omission | Rationale |
|---|---|
| **Recurring action items** | V1 keeps it simple: one-shot tasks. Recurrence would require a cron-like scheduler and significantly more complexity for a niche use case. |
| **Priority levels on action items** | Urgency is already communicated by the due date (overdue > today > upcoming). Adding a separate priority dimension creates cognitive overhead without clear benefit. |
| **Notification system (push/email)** | This is a local-first app. All awareness is visual and in-app. Push notifications are a separate feature with different infrastructure requirements. |
| **Custom snooze durations with time-of-day** | The NLP input in the composer already handles precision scheduling ("follow up Tuesday at 2pm"). The snooze presets are for quick deferral only. |
| **Dashboard scroll rail** | A horizontal scroll rail at the top of a contact list view is too cramped, invisible on mobile, and competes with the list's primary scroll axis. A dedicated full-page view is the correct UX. |
| **Composite `/api/interactions/log` endpoint** | Unnecessary new API surface. Extending the existing interaction creation payload with an optional `actionItem` object is simpler, equally atomic, and doesn't break existing callers. |
| **Standalone tasks (no contact)** | Action Items are always tied to a contact. For general to-dos unrelated to a relationship, the user should use a dedicated task manager. This is a CRM, not Todoist. |
