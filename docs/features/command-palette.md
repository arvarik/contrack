# Command Palette (Cmd+K)

The Command Palette is Contrack's operating system — a full-featured, keyboard-first interface for searching, navigating, and taking action on contacts without leaving the keyboard.

**Open:** `Cmd+K` (Mac) / `Ctrl+K` (Windows/Linux) or tap the search button on mobile.

<!-- Screenshot: command-palette.png -->

## Instant Search

The palette uses a dual-source search architecture for zero-latency results:

1. **Slim Cache (0ms)** — Client-side filtering over a pre-fetched slim contact cache delivers instant results as you type. These are marked with a `⚡ instant` indicator.
2. **FTS5 Server (50-100ms)** — Full-text search results stream in from the server and merge with cached results in the background.

This "latency masking" pattern ensures you never see a loading spinner for basic searches.

## Faceted Filters

Use GitHub-style prefix operators to narrow results:

| Prefix          | Example            | Description                                                     |
| --------------- | ------------------ | --------------------------------------------------------------- |
| `role:`         | `role:engineer`    | Filter by job title                                             |
| `company:`      | `company:stripe`   | Filter by company name                                          |
| `location:`     | `location:lisbon`  | Filter by location                                              |
| `industry:`     | `industry:fintech` | Filter by industry                                              |
| `tag:`          | `tag:investor`     | Filter by tag                                                   |
| `score:>N`      | `score:>80`        | Filter by relationship score                                    |
| `updated:>Nm`   | `updated:>3m`      | Filter by last update (N months)                                |
| `contacted:>Nd` | `contacted:>90d`   | Filter by last contact. See [Last contact](#last-contact)       |
| `missing:`      | `missing:email`    | No `company`, `location`, `email` or `phone`                    |
| `list:`         | `list:investors`   | Members of a list, by its name, its name with dashes, or its id |
| `near:`         | `near:London/50km` | Within a distance of a place, 25 km when the facet names none   |
| `tracked:`      | `tracked:yes`      | The people you track, or `no`                                   |

Active filters display as **color-coded pills** below the search input. Press `Backspace` on an empty input to remove the last pill.

Typing a prefix (e.g., `role:`) triggers **autocomplete** sourced from the contact cache, showing all known values for that facet.

### Last contact

`contacted:` reads the date of the last logged contact:

| Value             | Keeps                                                                  |
| ----------------- | ---------------------------------------------------------------------- |
| `contacted:>90d`  | Contacts whose last contact is more than 90 days ago, or who have none |
| `contacted:<30d`  | Contacts whose last contact is within the last 30 days                 |
| `contacted:never` | Contacts with no logged contact                                        |

The units are `d` (days), `w` (weeks), `m` (30 days) and `y` (365 days). A value with no operator means `>`. A date that the app cannot read counts as no contact. The autocomplete offers three presets: **Within 30 days**, **Over 90 days ago, or never** and **Never**.

`updated:` and `contacted:` read a SQLite timestamp such as `2026-09-10 05:33:50` as UTC, as the rest of the app does. Before this change, `updated:` read it as local time.

### Facets on the server

The palette shows the people rows in the order it gets them. It does not
filter them again with cmdk's fuzzy filter, which reads only a row's name. That
filter used to hide every person the search found by company, nickname,
misspelling or phone number. Only the action (`>`) rows use cmdk's filter.

The palette filters its cached contacts first. Then it asks the server's keyword search (`GET /api/search`) with the same facets. The server turns every facet into SQL and applies it before its result limit. `list:`, `missing:`, `near:` and `contacted:` work there too. Before this change, the server refused `list:`, `missing:` and `near:` with `400`.

`near:` narrows the results only when it carries a resolved point. The map resolves the place with the geocoder. Without a point, `near:` keeps everyone.

In AI (`?`) mode, the palette sends its pills with the question, as `filters`. Ask Contrack applies them at every stage. A pill that you add or remove asks the question again. See [Facets](ai-search.md#facets).

## Action Sub-Menu

Press `→` on any search result (or tap `>>` on mobile) to drill into a keyboard-first action panel:

| Key       | Action       | Description                                                                                                    |
| --------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| `↵` Enter | View Profile | Navigate to the contact's full profile                                                                         |
| `N`       | Log Note     | Opens inline note composer                                                                                     |
| `C`       | Log Call     | Opens inline call composer                                                                                     |
| `B`       | Catch Me Up  | Generates AI briefing for the contact                                                                          |
| `L`       | Add to List  | Opens inline list picker                                                                                       |
| `T`       | Track        | Tracks or untracks, with Undo, and closes the palette. Reads Untrack for a tracked contact. A ghost has no row |

Press `←` or `Escape` to go back to the search results.

<!-- Screenshot: action-submenu.png -->

## Inline Note Composer

From the action sub-menu, pressing `N` or `C` opens an inline composer directly within the palette:

- Auto-growing textarea
- Type selector (Note / Call)
- `Cmd+Enter` to save
- Automatic cache invalidation and relationship score recomputation

No need to navigate to the contact's profile — log interactions from anywhere.

## Zero-State Intelligence

Before you type anything, the palette displays **CRM intelligence signals**:

| Signal            | Description                                                                            |
| ----------------- | -------------------------------------------------------------------------------------- |
| 🔴 Action Items   | Tasks due today or overdue                                                             |
| ◎ Catch-ups       | The two tracked contacts furthest past their cadence, "Ada Lovelace, 3 weeks past due" |
| 👻 Ghost Contacts | Names mentioned multiple times but not yet in your contacts                            |
| 📊 Stale Data     | Contacts with outdated information                                                     |
| 🔗 Dedupe         | Pending duplicate suggestions to review                                                |

These signals are fetched from `GET /api/command-palette/zero-state` and provide proactive intelligence without requiring a search.

<!-- Screenshot: zero-state.png -->

## Search History

The palette shares a unified search history with Ask Contrack, persisted on the account in the `search_history` database table:

- **Unified storage:** Normal searches and action runs are saved as palette queries. AI queries starting with `?` are recorded as People searches with the prefix stripped, so questions asked in the palette appear in the Ask Contrack history pane and vice versa.
- **Recall & navigation:** Press `↑` / `↓` on an empty input to browse past queries in terminal style. Reopening the palette within 30 seconds restores your last query.
- **Zero-state display:** The 5 most recent queries across all modes appear under **Recent Searches** in the palette zero state.
- **Management & clear:** Search history can be cleared across all modes from **Settings → Privacy and AI** or from the Ask Contrack history pane.

## Deep Profile Peek

**Hold `Space`** on a focused search result for a 200ms peek tooltip showing:

- Relationship score
- Last contacted date
- Tags
- Company and role

Release `Space` to dismiss. This provides at-a-glance context without navigating away.

## Group Synthesis

When search results are displayed, a **"✨ Synthesize"** button appears. Clicking it:

1. Sends the search query and matched contacts to the AI provider
2. Generates an executive brief summarizing the group
3. Streams the result via NDJSON in real-time

This is useful for preparing for meetings with a group, understanding team composition, or generating reports.

**API:** `POST /api/search/synthesize`

## Mobile Behavior

On mobile devices:

- All keyboard shortcuts are hidden
- Touch-friendly tap targets (minimum 44px)
- Responsive pill layout
- `>>` button replaces `→` arrow for action sub-menu access
- Swipe gestures are not used (to avoid conflicts with native gestures)
