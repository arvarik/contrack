# Contrack vs Huly

_Compared in October 2026: Contrack 2.0.0 and Huly 0.7.426._

[Huly](https://github.com/hcengineering/platform) is an ambitious open-source
all-in-one workspace built to replace Linear, Jira, Slack, Notion and applicant
or contact tracking inside a single company platform.

Contrack is a focused, self-hosted personal and professional relationship manager.
Instead of running a multi-container enterprise workspace for issue tracking and
team chat, Contrack runs as a single Node.js process over one SQLite file and
focuses entirely on helping you remember and stay in touch with the people in
your life and work.

## At a glance

| Area                         | Contrack 2.0.0                                                                                         | Huly 0.7.426                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **Primary job**              | Personal and professional relationship manager (CRM)                                                   | All-in-one company workspace (issues, chat, docs, virtual office, ATS)   |
| **Stack and deployment**     | 1 Node container and 1 SQLite file (`curator.db`)                                                      | 10+ microservices, CockroachDB/MongoDB, Elasticsearch, MinIO/S3, Nginx   |
| **Memory and CPU footprint** | Runs comfortably on a small VPS, Raspberry Pi or home NAS                                              | Multi-gigabyte RAM footprint across database, search and service cluster |
| **Backup**                   | One SQLite snapshot (`VACUUM INTO`), automatic daily backups, or one click in **Settings → Backups**   | Coordinated dumps across relational/document DB, object storage & index  |
| **Personal context**         | Friends, family, birthdays, anniversaries, custom dates, gift ideas in notes, tags, lists, @mentions   | Workspace contacts and leads; not designed for personal life milestones  |
| **Professional context**     | Role, company, experience, education, cadence, relationship score, web research and pre-meeting briefs | Leads, customer funnels, recruiting candidates and organization records  |
| **Getting data in**          | Google Contacts, Gmail, Google Calendar, IMAP, ICS, vCard/CSV/JSON import, and **Add from text**       | GitHub, Gmail/Google Calendar workspace integrations and manual entry    |
| **Keeping up**               | Opt-in tracking per person, custom cadence, **Pulse** morning page, overdue and upcoming milestones    | Issue assignments, tasks and calendar events                             |
| **Search**                   | Built-in local hybrid search (SQLite FTS5 + `sqlite-vec` + local cross-encoder reranker)               | External Elasticsearch / OpenSearch cluster                              |
| **Map**                      | Built-in MapLibre world map with clustering, box/lasso selection, saved views and custom pin placement | None                                                                     |
| **AI and web enrichment**    | Optional provider-backed or SearXNG web research with cited sources, plus **Ask Contrack**             | Workspace AI assistant for docs, chat and transcription                  |
| **MCP server**               | Built in at `/api/mcp` (18 tools, personal tokens and OAuth 2.1)                                       | None built in                                                            |

## One SQLite file vs a 10-container microservice cluster

For a self-hoster, operational simplicity determines whether a tool stays running
for years or breaks on the next server upgrade.

- **Huly** (`huly-selfhost`) is an enterprise distributed system. Running it
  yourself requires orchestrating front-end, account, transactor, collaborator,
  rekoni and fulltext services alongside CockroachDB (or MongoDB),
  Elasticsearch, MinIO object storage and a reverse proxy.
- **Contrack** is one Node.js process and one SQLite file (`curator.db`) in WAL
  mode. Full-text search (FTS5) and vector search (`sqlite-vec`) live inside that
  same SQLite file, and the embedding and reranker models run in-process on CPU.
  One `docker compose up -d` starts everything, and a complete backup is a
  single portable `.db` file (see [Self-hosting](../self-hosting.md)).

## Purpose-built for relationships vs an issue-tracker workspace

- **Huly** treats contacts primarily as participants in company workflows:
  recruiting candidates, sales leads, or organization members linked to issues
  and documents.
- **Contrack** is built from the ground up around **people and memory**:
  - **Personal and professional in one timeline.** Keep friends and family right
    alongside founders, collaborators and mentors. **Add from text** (Smart
    Paste) turns `"Met at Sarah's wedding, loves natural wine, kids are Leo and Maya, catch up every quarter"`
    or `"Partner at Sequoia, follow up next Tuesday on seed round"` into a
    structured contact with tags, custom facts and dated past interactions.
  - **Proactive cadences on [Pulse](../pulse.md).** Opt in to tracking specific
    people on a weekly, monthly, quarterly or custom schedule. Contrack computes
    a live relationship health score from 0 to 100, highlights who is overdue, and
    shows upcoming birthdays, anniversaries and custom dates 7 to 14 days ahead.
  - **Web enrichment with citations.** Enrich a contact from the web (Standard or
    Deep) to fill in work history, education, location and social links, with
    every source URL cited and a one-click **Not this person** revert (see
    [AI and research](../ai.md)).
  - **Geographic view.** See where your network lives on an interactive MapLibre
    [Map](../map.md) with clustering, metro-area resolution, and box or lasso
    selection for planning trips.

## Built-in hybrid search and MCP without external infrastructure

Because Contrack embeds `bge-small-en-v1.5` and `ms-marco-MiniLM-L-6-v2` locally,
you get semantic and keyword search across every person and note immediately
after starting the container, without provisioning or tuning an Elasticsearch
cluster (see [Search and Ask Contrack](../search.md)). And with the built-in
[MCP server](../mcp.md) at `/api/mcp`, external AI tools like Claude Desktop,
ChatGPT and Cursor can query your network or log notes directly.

## When Huly might still fit better

Huly solves a very different problem if you are running a software company or
engineering team:

- You want an **issue tracker, sprint planner, team chat, virtual voice office,
  collaborative wiki and recruiting ATS** in one shared workspace.
- You need two-way **GitHub issue and pull request synchronization** for a
  development team.

## Moving contacts from Huly to Contrack

1. Export your contacts from Huly (or from your connected Google Contacts / CSV
   source).
2. In Contrack, open **Settings → Import** (or press `⌘K` and type `Import`),
   upload your CSV, vCard (`.vcf`) or JSON file, and let the duplicate check
   merge any overlapping entries.
3. Connect Gmail, Google Calendar, Google Contacts, IMAP or ICS in **Settings →
   Connectors**, then pick the people you want to track on [Pulse](../pulse.md).
