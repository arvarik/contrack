# Pulse

Pulse is Contrack's daily office. It turns your network into a calm morning workspace arranged across three responsive columns: Focus, Network, and Intelligence.

Access Pulse via the navigation bar or `Cmd+Shift+P`.

<!-- Screenshot: pulse-dashboard.png -->

## Layout Overview

On wide screens (1280 px and wider), Pulse organizes work into three parallel columns:

1. **Focus**: The ranked Up next queue and completed task history.
2. **Network**: Interaction habits, score momentum, and network composition charts.
3. **Intelligence**: Proactive AI insights, cleanup inbox, upcoming events, and new connections.

On phones and narrower viewports, Pulse stacks the columns in priority order (Focus, Intelligence, Network) with horizontal scrolling for today status chips and the activity heatmap.

---

## 1. Focus Column

### Up Next Queue

The Up next card aggregates and ranks everything requesting attention into one continuous list:

- **Overdue**: Past-due follow-ups ordered oldest first, highlighted with error badges.
- **Today**: Follow-up tasks due today.
- **This week**: Action items scheduled for the next seven days.
- **Birthdays**: Contacts celebrating birthdays this week, with a one-click action to log a birthday note.
- **Slipping**: Contacts with relationship scores below 40 that have gone silent past their target cadence, capped at top three suggestions.

In the card header, an SVG progress ring visualizes completion rate for today's tasks.

When all tasks are cleared, the queue displays an empty state celebrating the milestone with party popper confetti.

### Keyboard Navigation

Up next provides high-speed, single-key keyboard operations when typing targets do not have focus:

| Key     | Action                                                          |
| ------- | --------------------------------------------------------------- |
| `J`     | Advance highlight to next queue item                            |
| `K`     | Move highlight to previous queue item                           |
| `D`     | Mark highlighted action item as completed                       |
| `S`     | Snooze highlighted action item by one day                       |
| `L`     | Open quick note composer pre-filled for the highlighted contact |
| `Enter` | Open contact profile                                            |
| `C`     | Toggle layout customize mode                                    |

These single-key shortcuts can be toggled in Settings under Keyboard shortcuts.

### Completed Card

An expandable accordion lists tasks completed today with timestamps and undo options, preserving session context while keeping the primary queue focused.

---

## 2. Network Column

### Activity Heatmap and Streak

The Activity card displays a rolling 84-day (12-week) SVG heatmap mapping interaction density:

- **Quantile Scaling**: Daily interaction counts map to five discrete primary alpha steps (0, 0.12, 0.3, 0.55, 0.8, 1).
- **Calendar Alignment**: Columns start on the day defined by your account `weekStart` preference (Monday or Sunday).
- **Today Indicator**: Today's cell is outlined in the primary theme color.
- **Accessibility**: Every cell contains an SVG title tooltip showing date and interaction counts. A visually hidden list (`.sr-only`) provides screen readers with weekly interaction totals.
- **Streak Tracking**: Consecutive days with logged interactions. Connector sync rows and import rows are excluded so automated imports never artificially inflate streaks. Tooltip: "Days you logged something".
- **Sparkline**: A 40 px polyline charting weekly volume over the last 12 weeks compared against the prior 12-week window.
- **Type Pills**: Badges breaking down this week's logged notes, calls, meetings, and emails.

### Momentum Card

The Momentum card tracks relationship trajectories by comparing current relationship scores against snapshots from four weeks prior:

- **Rising**: Top five contacts with the largest 4-week score gains.
- **Cooling**: Top five contacts with the largest 4-week score drops.
- **Silent**: Contacts overdue against their target cadence, ordered by overdue days. Contacts in the at-risk list are excluded to avoid duplication.
- **The Four-Week Rule**: Calculating score movement requires four weekly snapshots. If fewer than four weeks of history exist, the card explains when the first snapshot was taken while keeping the Silent column fully operational.

### Composition Card

The Composition card visualizes network diversity via a hand-drawn 120 px SVG donut chart:

- **Dimensions**: Segmented control switches between Industry, Role, and Location views.
- **Top Six Plus Other**: Arcs represent top categories with remaining items grouped under Other.
- **Interactive Legend**: Clicking any legend filter pill navigates to filtered search results (`/?q=industry:<value>`, `/?q=role:<value>`, `/?q=location:<value>`).
- **See All**: Launches the Network Composition modal for exhaustive distributions.

---

## 3. Intelligence Column

### Daily Insight

Displays proactive AI-generated observations regarding networking habits and outreach opportunities. The "Ask a follow-up" link opens Ask Contrack pre-populated with the insight query.

### Inbox Card

Surfaces data maintenance tasks that keep your CRM grounded and accurate:

- **Duplicates**: Links to `/pulse/duplicates` with count of pending merges.
- **Ghosts**: Promotes mentioned people into full contacts.
- **Stale Data**: Links to contacts without updates in six months (`/?q=updated:>6m`).
- **Data Hygiene**: Filter pills for contacts missing company (`/?q=missing:company`) or location (`/?q=missing:location`).
- **Correspondents**: Unsaved email correspondents detected by connectors.
- When clear, displays "Inbox zero. Nothing to clean up."

### Coming Up Card

Displays upcoming birthdays across the next 14 days and scheduled meetings over the next 7 days from connected calendars.

### New People Card

Shows recently added contact avatars with a count of new relationships formed this month, linking directly to the Network Growth modal.

---

## 4. Customize Mode

You can rearrange, hide, or restore any card on the Pulse page:

1. Click **Customize** in the header or press `C`.
2. Screen readers announce "Layout editing on".
3. Every card header displays:
   - A `GripVertical` drag handle on desktop.
   - An eye toggle button (`EyeOff`) to hide the card.
   - An ActionMenu offering "Move to Focus", "Move to Network", or "Move to Intelligence".
   - Move up and Move down buttons on phone viewports.
4. Hidden cards appear in a **Hidden cards** tray at the top, where they can be restored with the `Eye` button.
5. A floating bottom bar provides **Reset layout** to restore defaults and **Done** to exit.
6. Layouts persist to your account via the `pulseLayout` preference, keeping your setup synchronized across devices.

---

## 5. Possible Duplicates

Duplicate review has moved from a tab into its own dedicated view at `/pulse/duplicates`. Old links (`/pulse?tab=suggestions` and `/pulse/suggestions`) automatically redirect to this page.

---

## 6. APIs

| Method  | Path                             | Description                                                                                            |
| ------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET`   | `/api/dashboard`                 | Main dashboard payload (overdue, due today, upcoming, hygiene, meetings, correspondents, compositions) |
| `GET`   | `/api/dashboard/activity`        | 84 rolling days of activity, 12 weekly totals, streaks, and this week type breakdown                   |
| `GET`   | `/api/dashboard/momentum`        | Rising, cooling, and silent contacts with score deltas                                                 |
| `GET`   | `/api/dashboard/insight`         | Cached daily AI insight                                                                                |
| `GET`   | `/api/auth/preferences`          | Account preferences including `pulseLayout`                                                            |
| `PATCH` | `/api/auth/preferences`          | Updates account preferences including `pulseLayout`                                                    |
| `POST`  | `/api/action-items/:id/complete` | Marks an action item complete                                                                          |
| `PATCH` | `/api/action-items/:id`          | Updates an action item (e.g. snooze due date)                                                          |
