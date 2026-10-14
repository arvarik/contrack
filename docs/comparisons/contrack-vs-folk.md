# Contrack vs Folk

_Compared in October 2026: Contrack 2.0.0 and Folk 3.0 (hosted SaaS)._

[Folk](https://www.folk.app) is a commercial, Notion-style CRM designed for
agencies, venture teams, founders and sales or recruiting pipelines. It centers
around customizable spreadsheet tables, Kanban boards, browser-extension capture
and bulk email sequences.

Contrack is an open-source, self-hosted relationship manager built for people
rather than deal tables. It runs on a single SQLite file, combines personal and
professional relationships in one calm workspace, and includes local semantic
search, automatic email and calendar timelines, a world map and a built-in MCP
server with no per-seat subscription.

## At a glance

| Area                      | Contrack 2.0.0                                                                                         | Folk 3.0 (hosted SaaS)                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **Hosting and license**   | Self-hosted, open-source (AGPL-3.0), free with no seat or enrichment limits                            | Proprietary cloud SaaS with per-member monthly pricing and quotas       |
| **Primary model**         | People, relationship timelines, stay-in-touch cadences and a daily **Pulse** brief                     | Spreadsheet tables, custom object views, Kanban pipelines and sequences |
| **Stack and storage**     | 1 Node container and 1 SQLite file (`curator.db`) on your own server                                   | Cloud-hosted SaaS infrastructure                                        |
| **Personal context**      | Friends, family, birthdays, anniversaries, custom dates, gift ideas in notes, tags, lists, @mentions   | Can be added as custom table columns, but designed around B2B workflows |
| **Professional context**  | Role, company, experience, education, cadence, relationship score, web research and pre-meeting briefs | Companies, deals, custom pipeline stages, sequences and shared tables   |
| **Getting data in**       | Google Contacts, Gmail, Google Calendar, IMAP, ICS, vCard/CSV/JSON import, and **Add from text**       | Browser extension (LinkedIn/X), Google/Microsoft sync, CSV import       |
| **Keeping up**            | Opt-in tracking per person, custom cadence, **Pulse** morning page, overdue and upcoming milestones    | Manual reminders and pipeline stage movement                            |
| **Search**                | Local hybrid search (FTS5 + `sqlite-vec` embeddings + local cross-encoder reranker) and **Notes** mode | Keyword filtering and cloud AI assistants across tables                 |
| **Map**                   | Built-in MapLibre world map with clustering, box/lasso selection, saved views and custom pin placement | None built in                                                           |
| **AI and web enrichment** | Optional BYO-key or local Ollama + SearXNG web research with cited sources and **Not this person**     | Cloud magic fields and credit-metered contact enrichment                |
| **MCP server**            | Built in at `/api/mcp` (18 tools, personal tokens and OAuth 2.1)                                       | Cloud API and webhook/Zapier integrations                               |
| **Multi-user**            | Multiple isolated accounts on one server (ideal for households or private individual networks)         | Shared workspaces with per-seat billing                                 |

## A relationship timeline vs a spreadsheet of rows

Spreadsheet-style CRMs work well when every contact is a row in a sales or
recruiting funnel, but they often feel like work when you want to remember the
context around a person over years.

- **Folk** organizes people into groups and spreadsheet views where you configure
  custom columns, pipeline stages and bulk outreach campaigns.
- **Contrack** gives every person a dedicated dossier and chronological timeline
  (see [Contacts](../contacts.md)):
  - Notes, calls, meetings, emails, attachments and `@mentions` live in one
    place instead of tiny spreadsheet cells.
  - **Add from text** (Smart Paste) accepts any free-form note — whether
    `"Met at Sarah's wedding — loves natural wine, kids are Leo and Maya, catch up every quarter"`
    or `"Partner at Sequoia — follow up next Tuesday on seed round"` — and
    creates the contact, extracts work and personal facts, sets a follow-up and
    logs past dated interactions automatically.
  - [Pulse](../pulse.md) opens each morning with the people you are overdue to
    reach out to, upcoming follow-ups, and birthdays, anniversaries or custom
    milestones over the next 7 to 14 days.

## Self-hosted ownership with no seat or enrichment quotas

- **Folk** charges per member per month and meters contact enrichment credits,
  email messages and AI usage by plan tier. Your contacts, notes and synced
  emails reside in Folk's cloud.
- **Contrack** is free and self-hosted on your own machine or VPS in a single
  Docker container backed by one SQLite file (`curator.db`). Every user account
  on your server is isolated at the database layer, daily SQLite backups run
  automatically, and web enrichment uses your own search and model keys (or a
  local Ollama model + self-hosted SearXNG) with no platform markups or credit
  caps (see [Self-hosting](../self-hosting.md) and [AI and research](../ai.md)).

## Local hybrid search, world map and MCP

- **Local semantic search across notes.** Contrack embeds every contact, note,
  interaction and custom fact locally using `bge-small-en-v1.5` in `sqlite-vec`
  alongside SQLite FTS5, then reranks matches with a local
  `ms-marco-MiniLM-L-6-v2` cross-encoder. Switching to **Notes** mode finds the
  exact paragraph where a topic was discussed months ago — without sending your
  notes to an external API (see [Search and Ask Contrack](../search.md)).
- **Interactive world map.** Contrack's [Map](../map.md) plots your contacts
  across a MapLibre world map with clustering, metro-area resolution, rectangle
  and lasso selection for building trip lists, and saved geographic views.
- **Built-in MCP server.** Connect Claude Desktop, ChatGPT, Cursor or custom
  agents directly to `/api/mcp` on your own server to search contacts, read
  timelines, prepare for meetings or log notes (see [MCP server](../mcp.md)).

## When Folk might still fit better

Folk is built for collaborative commercial workflows that Contrack intentionally
leaves out:

- **Shared multi-user deal pipelines** where several teammates edit the same
  contact rows and Kanban boards together in real time (in Contrack, each user
  account on a server has a private, isolated network).
- **Bulk outbound email sequences** and mail-merge campaigns sent directly from
  the CRM.
- **Browser extension capture** (Folk X) for one-click scraping from LinkedIn or
  X/Twitter pages while browsing.

## Moving from Folk to Contrack

1. In Folk, open the group or view you want to move, click **Export CSV**, and
   download the file.
2. In Contrack, open **Settings → Import** (or press `⌘K` and type `Import`),
   upload the CSV file, and let the duplicate detector merge any overlapping
   contacts.
3. Use [Pulse](../pulse.md) or **Network** to turn on **Track** and set cadences
   for the relationships you want to keep warm.
