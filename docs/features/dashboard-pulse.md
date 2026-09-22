# Pulse

Pulse is Contrack's daily office. It turns your network into a calm morning workspace arranged across three responsive columns: Focus, Network, and Intelligence.

Access Pulse via the navigation bar or `Cmd+Shift+P`.

<!-- Screenshot: pulse-dashboard.png -->

## Layout Overview

The page opens with a masthead. The `h1` "Pulse" is a small page label over the date, which is the largest text on the page (32 px, 24 px on a phone). Under the date, one sentence says what the day holds: "2 overdue, 2 due today, 3 birthdays this week. 12 days in a row." Each count above zero is a button that jumps to its card on wide screens, and plain text on a phone. Beside the sentence a 40 px progress mark reads "4 to do", "1 of 4 done", "All done" or "Nothing due". **Log a note** is the one primary action. **More** opens a menu with **New contact** and **Customize layout**.

On wide screens (1280 px and wider), Pulse organizes work into three columns, five, three and four twelfths wide:

1. **Focus** (five columns): The ranked Up next queue and completed task history.
2. **Intelligence** (three columns): Proactive AI insights, cleanup inbox, upcoming events, and new connections.
3. **Network** (four columns): The people you track and their trend, interaction habits, and network composition charts.

Between 1024 and 1279 px, Focus and Network share the first row, and the Intelligence cards run two across underneath. On phones and narrower viewports, Pulse stacks the cards in one column in the order Focus, Network, Intelligence. The masthead stays under 180 px before the first card, and nothing on the page scrolls sideways.

Every card is a title and a body: no line between them, no icon, and the count in muted text after the title. A card with nothing to show can render as one line on the page surface instead of a framed box.

---

## 1. Focus Column

### Up Next Queue

The Up next card aggregates and ranks everything requesting attention into one list. From 1024 px the list scrolls inside its card, capped near the viewport height, so the page never grows with the queue. On a phone it has no cap. Each group has a heading that sticks to the pane, with a dot in the group's tone and the count at the right:

- **Overdue**: Past-due follow-ups ordered oldest first. The chip reads "Overdue" or "12 days overdue".
- **Today**: Follow-up tasks due today.
- **This week**: Action items due in the next seven days. The chip names the day: "Tomorrow", "Wednesday".
- **Birthdays**: Contacts with a birthday in the next seven days, with a one-click action to log a birthday note.
- **Catch up**: Tracked contacts past their cadence, the furthest past due first, ten at most. The clock is the last interaction, or the moment of tracking when nothing is logged yet, so a person tracked today at "every month" comes up in a month even with an empty timeline. Each row's chip says how far: "3 weeks past due". The row has a Log button and no check. When more than ten wait, the heading says "Catch up, 10 of 14". A catch-up ranks after a birthday: it is a soft reminder, and a due follow-up is a promise with a date.

A row is two lines: the name and the chip, then the title. Under them, when known, "Last spoke 12 days ago". A click or a tap anywhere on the row opens the contact. The check completes a follow-up, and the Log button on a birthday or a catch-up opens the note composer. **Snooze** is the one action at the right: on a desktop it appears on hover or focus, on a phone it is always visible. It offers Tomorrow, In 3 days, Next week and Next month. A birthday or a catch-up row has no snooze.

The masthead's counts jump to these group headings. The progress mark in the masthead shows how many of today's follow-ups are done.

When all tasks are cleared, the queue reads "Nothing due today" with one button, Log a note, and celebrates with confetti in the palette's colours.

### Keyboard Navigation

Up next provides single-key keyboard operations when typing targets do not have focus:

| Key | Action                                                          |
| --- | --------------------------------------------------------------- |
| `J` | Advance highlight to next queue item                            |
| `K` | Move highlight to previous queue item                           |
| `D` | Mark highlighted action item as completed                       |
| `S` | Snooze highlighted action item by one day                       |
| `L` | Open quick note composer pre-filled for the highlighted contact |
| `C` | Toggle layout customize mode                                    |

These single-key shortcuts can be toggled in Settings under Keyboard shortcuts.

The highlighted row is the list's one tab stop. Tab reaches it, and from a focused row:

| Key       | Action                                                           |
| --------- | ---------------------------------------------------------------- |
| `Enter`   | Open the contact                                                 |
| `Space`   | Complete the follow-up, or log a note for a birthday or catch-up |
| `↓` / `↑` | Move the highlight to the next or previous row                   |

Enter belongs to the control that has focus. On a button, a link or a menu item it does what that control does, and never opens the highlighted contact. The highlighted row scrolls into view when a key moves it.

### Completed Card

One line: "Nothing completed yet." or "3 completed recently". **Show** opens the list under the line, each row with the title struck through, the contact's name as a link and when it was done. **Hide** closes it.

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

### Keeping Up Card

The Keeping up card shows the state of the people you track, and their trend. It is the Network column's first card and the one door from Pulse to the [Tracked contacts page](contact-management.md#tracking): its header link **Manage** opens it.

- **The bar**: one 8 px bar, split by the ring state of every tracked contact: Strong (success), Fading (warning), At risk (error), and No interactions yet (the neutral track). It is named for a screen reader: "42 tracked: 30 strong, 8 fading, 4 at risk, 0 with no interactions yet". Under it, a legend of links, one per state with somebody in it, each landing on that group on the Tracked contacts page (`/tracked#strong`, `#fading`, `#at-risk`, `#unscored`).
- **One line**: "31 of 42 within cadence, 11 to catch up". Catch up is on the same page, in Up next, so the words are not a link.
- **Rising and Cooling**: two columns, up to three rows each, the tracked contacts whose score moved by three or more over four weeks, with the delta as a chip (+7 in the success tone, −5 in the error tone). Rising and cooling need four weekly snapshots. Before that the card says "Rising and cooling show after four weeks of tracking." A contact tracked after the baseline week is neither, so a two-day-old track is never called cooling.
- **One line, when above zero**: "5 tracked in the last 30 days".
- **Empty**: when nobody is tracked, the card says "Nobody is tracked yet" with one button, **Choose people**, to the Tracked contacts page. This is what an upgraded instance sees first.

The card absorbed the old Momentum card. Rising and cooling are the trend of the people you track, so they belong on the card that shows their state. Momentum's Silent column was Catch up under another name, restricted to people whose score was still above 40, and it is gone.

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

1. Open **More** in the masthead and choose **Customize layout**, or press `C`.
2. Screen readers announce "Layout editing on".
3. Every card header displays:
   - A `GripVertical` drag handle on desktop.
   - An eye toggle button (`EyeOff`) to hide the card.
   - An ActionMenu offering "Move to Focus", "Move to Network", or "Move to Intelligence".
   - Move up and Move down buttons on phone viewports.
4. Hidden cards appear in a **Hidden cards** tray at the top, where they can be restored with the `Eye` button. The tray appears only once a card is hidden.
5. A floating bottom bar says what to do at that width ("Drag a card to move it. Use the eye to hide one." on desktop, "Use the arrows to move a card and the eye to hide one." on a phone) and provides **Reset layout** to restore defaults and **Done** to exit.
6. Layouts persist to your account via the `pulseLayout` preference, keeping your setup synchronized across devices.

---

## 5. Possible Duplicates

Duplicate review has moved from a tab into its own dedicated view at `/pulse/duplicates`. Old links (`/pulse?tab=suggestions` and `/pulse/suggestions`) automatically redirect to this page.

---

## 6. APIs

| Method  | Path                             | Description                                                                                                                                                     |
| ------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/api/dashboard`                 | Main dashboard payload (overdue, due today, upcoming, catch-ups, the tracking summary with rising and cooling, hygiene, meetings, correspondents, compositions) |
| `GET`   | `/api/dashboard/activity`        | 84 rolling days of activity, 12 weekly totals, streaks, and this week type breakdown                                                                            |
| `GET`   | `/api/dashboard/insight`         | Cached daily AI insight                                                                                                                                         |
| `GET`   | `/api/auth/preferences`          | Account preferences including `pulseLayout`                                                                                                                     |
| `PATCH` | `/api/auth/preferences`          | Updates account preferences including `pulseLayout`                                                                                                             |
| `PATCH` | `/api/action-items/:id/complete` | Marks an action item complete                                                                                                                                   |
| `PATCH` | `/api/action-items/:id`          | Updates an action item (e.g. snooze due date)                                                                                                                   |
