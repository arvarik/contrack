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

| Prefix        | Example          | Description                      |
| ------------- | ---------------- | -------------------------------- |
| `role:`       | `role:engineer`  | Filter by job title              |
| `company:`    | `company:stripe` | Filter by company name           |
| `tag:`        | `tag:investor`   | Filter by tag                    |
| `score:>N`    | `score:>80`      | Filter by relationship score     |
| `updated:>Nm` | `updated:>3m`    | Filter by last update (N months) |

Active filters display as **color-coded pills** below the search input. Press `Backspace` on an empty input to remove the last pill.

Typing a prefix (e.g., `role:`) triggers **autocomplete** sourced from the contact cache, showing all known values for that facet.

## Action Sub-Menu

Press `→` on any search result (or tap `>>` on mobile) to drill into a keyboard-first action panel:

| Key       | Action       | Description                            |
| --------- | ------------ | -------------------------------------- |
| `↵` Enter | View Profile | Navigate to the contact's full profile |
| `N`       | Log Note     | Opens inline note composer             |
| `C`       | Log Call     | Opens inline call composer             |
| `B`       | Catch Me Up  | Generates AI briefing for the contact  |
| `L`       | Add to List  | Opens inline list picker               |

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

| Signal              | Description                                                 |
| ------------------- | ----------------------------------------------------------- |
| 🔴 Action Items     | Tasks due today or overdue                                  |
| ⚠️ At-Risk Contacts | Contacts you haven't interacted with beyond their cadence   |
| 👻 Ghost Contacts   | Names mentioned multiple times but not yet in your contacts |
| 📊 Stale Data       | Contacts with outdated information                          |
| 🔗 Dedupe           | Pending duplicate suggestions to review                     |

These signals are fetched from `GET /api/command-palette/zero-state` and provide proactive intelligence without requiring a search.

<!-- Screenshot: zero-state.png -->

## Search History

The palette supports terminal-style search history:

- Press `↑` / `↓` on an empty input to browse past queries
- Recent queries appear as **clickable pills** below the input
- History auto-populates after 30 seconds of inactivity
- History is stored in-memory per session

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
