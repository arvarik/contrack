# Pulse

Pulse is Contrack's proactive intelligence center. It shows relationship health, action items, and AI-driven insights about your network.

Access via the **Pulse** tab in the navigation or `Cmd+Shift+P`.

<!-- Screenshot: pulse-dashboard.png -->

## Relationship Scoring

Every contact gets an automated relationship score (0–100) based on three weighted factors:

| Factor        | Weight | Description                                                  |
| ------------- | ------ | ------------------------------------------------------------ |
| **Frequency** | High   | How often you interact (total interaction count)             |
| **Recency**   | High   | When the last interaction occurred                           |
| **Depth**     | Medium | Quality signals — meetings and calls score higher than notes |

### Score Lifecycle

- Scores are **fully recomputed on server startup**
- An **hourly sweep** recalculates all scores in the background
- Individual scores update immediately when interactions are logged

---

## Network Health Panel

The dashboard header displays key network metrics:

| Metric                   | Description                                    |
| ------------------------ | ---------------------------------------------- |
| **Total Contacts**       | Active (non-archived, non-ghost) contact count |
| **Avg Score**            | Mean relationship score across all contacts    |
| **At-Risk**              | Contacts below their interaction cadence       |
| **Interaction Velocity** | Interactions per week (with trend)             |

Click on any metric card to drill into a detailed modal with charts and breakdowns.

---

## Action Item Swimlanes

Action items are organized into three lanes:

| Lane          | Description                         |
| ------------- | ----------------------------------- |
| **Overdue**   | Past-due items (highlighted in red) |
| **Due Today** | Items due within the next 24 hours  |
| **Upcoming**  | Items due in the next 7 days        |

Each action item card shows:

- Task title
- Contact name + avatar
- Due date
- **Complete** button (tap to mark done)

The urgent action item count appears as a badge on the Pulse navigation icon.

**APIs:**

- `GET /api/action-items` — Fetch all pending items
- `PATCH /api/action-items/:id/complete` — Mark complete
- `GET /api/action-items/count` — Urgent count for badges

---

## Daily AI Insight

An AI-generated card at the top of the dashboard provides daily observations about your network:

<!-- Screenshot: daily-insight.png -->

Examples:

- "You've interacted with 12 contacts this week — 3x your average. Most active relationships: Jane Smith, Bob Chen."
- "3 contacts haven't been reached in over 60 days. Consider a check-in with Sarah, Mike, and David."

The insight is cached for 24 hours (via `aiCache.dailyInsight` tier) and regenerated daily.

**API:** `GET /api/dashboard/insight`

---

## Network Composition

Click the **composition** metric to see:

- **Industry distribution** — Bar chart of contacts by industry
- **Role distribution** — Most common job titles
- **Tag cloud** — Most-used tags

---

## Network Growth

A timeline chart showing contact additions over time, with:

- Monthly granularity
- Cumulative vs. net-new views
- Import spike detection

---

## Quick Interaction Dialog (`Cmd+Shift+I`)

A system-wide shortcut for rapid interaction logging from anywhere in the app:

1. Press `Cmd+Shift+I` to open the "Log an interaction" dialog.
2. Search for the contact and press Enter. Focus moves to the editor.
3. Write the note. Type `@` to mention another person.
4. Choose the type (Note, Call, Meeting, Email), and add a next action if you want a follow-up task.
5. Press `Cmd+Enter`, or Save.

The dialog draws the same composer as the contact page, in its compact form, so mentions and the next-action line work the same way in both. See [Logging Interactions](contact-management.md#logging-interactions).

On save, the dialog:

- Refreshes the contact's timeline and the views that show the contact
- Triggers relationship score recomputation
- Closes with a toast such as "Note logged for Ada Lovelace"

`QuickInteractionModal` takes an optional `initialContactId`. With it the dialog opens for that contact, shows the name instead of the search, and starts in the editor.
