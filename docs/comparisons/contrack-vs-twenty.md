# Contrack vs Twenty

_Compared in October 2026: Contrack 2.0.0 and Twenty 2.45.0._

[Twenty](https://github.com/twentyhq/twenty) is an open-source, self-hosted
alternative to Salesforce and HubSpot. It is built for B2B sales teams that
manage leads, company accounts, deal pipelines and revenue stages.

People searching for a self-hosted CRM often compare Twenty and Contrack, and
the right choice comes down to a simple question: **are you managing a sales
pipeline for a company, or relationships across your life and career?**

Contrack is a personal CRM (PRM) built for individuals, households and small
groups who want to remember context about the people they know, including friends,
family, founders, peers, mentors and investors, and stay in touch without
turning relationships into sales tickets.

## At a glance

| Area                      | Contrack 2.0.0                                                                                         | Twenty 2.45.0                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **Primary focus**         | Personal and professional relationships, cadence, context, notes and milestones                        | B2B sales pipelines, companies, opportunities, stages and team workflows   |
| **Core mental model**     | People, timelines, follow-ups, cadences, dates/milestones and lists                                    | Companies, People, Opportunities (deals), kanban boards and custom objects |
| **Stack and deployment**  | 1 Node container and 1 SQLite file (`curator.db`)                                                      | Node/NestJS server, worker container, PostgreSQL and Redis                 |
| **Memory footprint**      | Light single-process server; runs comfortably on a small VPS or home server                            | Multi-container stack (PostgreSQL + Redis + server + worker)               |
| **Personal life fit**     | Native birthdays, anniversaries, custom dates, how you met, interests and private per-person accounts  | Sales-oriented schema; personal notes and birthdays require custom fields  |
| **Keeping in touch**      | Opt-in tracking, per-person cadence, **Pulse** morning page, 5-signal relationship score               | Task lists and sales stage workflows                                       |
| **Search**                | Local hybrid search (FTS5 + `sqlite-vec` embeddings + local cross-encoder reranker) and **Notes** mode | Keyword and filter views over PostgreSQL records                           |
| **Web enrichment**        | Built-in web research (provider search or SearXNG) with source citations and **Not this person** undo  | Requires third-party enrichment workflows or API integrations              |
| **Add from text**         | Built-in Smart Paste for bios, signatures, personal notes and meeting notes                            | Manual entry, CSV import or API/webhook workflows                          |
| **Map**                   | Built-in MapLibre world map with clustering, box/lasso selection, saved views and pin adjustment       | None built in                                                              |
| **MCP server**            | Built in at `/api/mcp` (18 tools, personal tokens and OAuth 2.1)                                       | Community third-party MCP wrappers                                         |
| **Privacy between users** | Each account on an instance is strictly isolated; no one sees another user's contacts                  | Shared workspace where team members collaborate on the same CRM records    |

## Relationships vs deal pipelines

A B2B CRM assumes every contact belongs to a **Company** and moves toward an
**Opportunity** with a dollar amount and a close date. That works well for a
sales team, and poorly for the rest of your life:

- Close friends, family members, former classmates, engineers you met at a
  meetup, or a founder you catch up with twice a year do not belong on a kanban
  board of sales stages.
- **Contrack** centers on the **person** and your shared **timeline**:
  - **Pulse** is a calm morning page showing overdue follow-ups, what is due
    today, tracked people who have drifted past their cadence, and upcoming
    birthdays, anniversaries and calendar meetings (see [Pulse](../pulse.md)).
  - **Add from text** and the timeline composer work just as naturally for
    `"Met at Sarah's wedding, loves natural wine, kids are Leo and Maya, catch up every quarter"`
    as they do for `"Partner at Sequoia, follow up next Tuesday on seed round"`
    (see [Contacts](../contacts.md)).
  - **Tracking is a choice.** You can import thousands of contacts from Google,
    Apple Contacts or LinkedIn and track only the people you want Pulse to
    remind you about.

## One container and one SQLite file vs four services

Self-hosting a personal tool should take minutes to set up and almost zero
maintenance over the years:

- **Twenty** deploys a multi-container architecture: the main server, a
  background worker, a PostgreSQL database and a Redis instance.
- **Contrack** runs in a single container and stores everything in one SQLite
  file (`curator.db`) plus your `uploads/` and `backups/` folders inside one
  `DATA_DIR`. Daily backups are written automatically with `VACUUM INTO` and
  verified with `PRAGMA quick_check` (see [Self-hosting](../self-hosting.md)).

## Built-in intelligence without third-party SaaS glue

In a traditional B2B CRM, features like contact enrichment, semantic search or
AI assistants require wiring up Clearbit/Apollo keys, vector databases or
external automation tools. Contrack builds them into the single binary:

- **Local hybrid search.** Full-text search (FTS5), vector embeddings
  (`sqlite-vec` with `bge-small-en-v1.5`) and cross-encoder reranking
  (`ms-marco-MiniLM-L-6-v2`) run locally on CPU with no API key. You can search
  by meaning (`"climate founders in Europe"`), by structured facets
  (`tag:investor location:Berlin contacted:>90d`), or across the full text of
  your interaction notes (see [Search and Ask Contrack](../search.md)).
- **Grounded web research.** When you connect an AI provider (Gemini, OpenAI,
  Anthropic or a local/custom OpenAI-compatible server) or a SearXNG instance,
  **Enrich contact** searches the live web for a person, merges verified fields,
  and records every source URL and query in the contact's **Dossier** (see
  [AI and research](../ai.md)).
- **Built-in Map.** See where your contacts live on an interactive world map,
  filter by tag or cadence, draw a box or lasso around a city before a trip, and
  add everyone in that area to a list such as `Lisbon trip` (see
  [Map](../map.md)).
- **Built-in MCP server.** Point Claude, ChatGPT or Cursor at `/api/mcp` and
  authorize with OAuth 2.1 or a personal token, with no extra bridge container
  needed (see [MCP server](../mcp.md)).

## Private accounts vs shared team workspaces

- **Twenty** is designed for a company workspace where colleagues share the same
  contacts, companies and deals.
- **Contrack** isolates every account on the server (`ownerId` scoping on every
  table and route). You can run one Contrack container for your family,
  co-founders or lab group, and each person's address book, notes, connectors
  and search index remain private to their own sign-in (see
  [Accounts and sign-in](../accounts.md) and [Privacy and data](../privacy.md)).

## When Twenty might fit better

Choose Twenty if you are running a B2B sales motion with a team:

- You need **shared deal pipelines**, revenue forecasting, kanban stages and
  company-to-opportunity hierarchies that multiple salespeople work on
  together.
- You want a low-code **custom object builder** and workflow triggers for
  company-wide business processes.
