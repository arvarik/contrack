# Contrack vs Monica

_Compared in October 2026: Contrack 2.0.0 and Monica 4.1.2._

[Monica](https://github.com/monicahq/monica) is one of the longest-running
open-source personal CRMs. It pioneered self-hosted relationship management for
friends and family, with fields for birthdays, gift ideas, family members and
journal entries.

Contrack covers that same personal ground — friends, family, birthdays,
anniversaries, gift ideas, how you met and shared household servers — while
extending to your wider personal and professional network with a single-file
SQLite deployment, automatic connectors, local hybrid search, a world map and a
built-in MCP server.

## At a glance

| Area                       | Contrack 2.0.0                                                                                         | Monica 4.1.2                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| **Stack and deployment**   | 1 Node container and 1 SQLite file (`curator.db`)                                                      | PHP (Laravel), MySQL or MariaDB, plus Redis and cron for queues    |
| **Backup**                 | One SQLite snapshot (`VACUUM INTO`), automatic daily backups, or one click in **Settings → Backups**   | Database dump (`mysqldump`) plus application storage directory     |
| **Personal context**       | Friends, family, birthdays, anniversaries, custom dates, gift ideas in notes, tags, lists, @mentions   | Friends, family, birthdays, gift ideas, pets, debts, journal       |
| **Professional context**   | Role, company, experience, education, cadence, relationship score, web research and pre-meeting briefs | Basic work fields; built primarily around family and close friends |
| **Getting data in**        | Google Contacts, Gmail, Google Calendar, IMAP, ICS, vCard/CSV/JSON import, and **Add from text**       | vCard/CSV import, CardDAV and CalDAV                               |
| **Logging interactions**   | One composer for notes, calls, meetings and emails, plus automatic email and calendar sync             | Manual logging through forms for activities, calls and notes       |
| **Keeping up**             | Opt-in tracking per person, custom cadence, **Pulse** morning page, overdue and upcoming milestones    | Per-contact reminders and stay-in-touch intervals                  |
| **Search**                 | Local hybrid search (FTS5 + `sqlite-vec` embeddings + local cross-encoder reranker) and **Notes** mode | SQL keyword search across contact fields                           |
| **Map**                    | Built-in MapLibre world map with clustering, box/lasso selection, saved views and custom pin placement | None built in                                                      |
| **AI and web enrichment**  | Optional provider-backed or SearXNG web research with cited sources, plus **Ask Contrack**             | None                                                               |
| **MCP server**             | Built in at `/api/mcp` (18 tools, personal tokens and OAuth 2.1)                                       | None                                                               |
| **Multi-user / household** | Multiple isolated accounts on one server, with passkeys, password and magic-link sign-in               | Multiple users per instance (shared or separate accounts)          |

## Single-file SQLite vs PHP, MySQL and Redis

Running a personal tool at home or on a small VPS should not require maintaining
a database server.

- **Monica** is a Laravel application that requires PHP, a MySQL or MariaDB
  server, a web server, and (for background jobs and reminders) Redis and a
  scheduled cron runner. Upgrading or moving hosts means coordinating database
  migrations and dumps across containers.
- **Contrack** runs as a single Node.js process over one SQLite file in WAL
  mode, with vector search (`sqlite-vec`) and full-text search (FTS5) compiled
  in. One `docker compose up -d` starts the entire stack. Backups run
  automatically every day as self-contained SQLite files that you can copy,
  verify or download from the browser (see [Self-hosting](../self-hosting.md)).

## Automated connectors and Smart Paste vs manual logging

The hardest part of any personal CRM is keeping it up to date after the first
weekend.

- **Monica** relies mostly on manual data entry. You open a contact, fill out
  forms for a call or an activity, and update fields by hand as people move
  cities or change jobs.
- **Contrack** combines fast manual capture with automatic sync:
  - **Connectors** sync Google Contacts, Gmail, Google Calendar, any IMAP
    mailbox and any ICS calendar feed in the background, placing emails and
    meetings straight onto the matching contact's timeline (see
    [Import, sync and export](../import-and-sync.md)).
  - **Add from text** (Smart Paste) takes a pasted note, email signature or
    bio — whether `"Met at Sarah's wedding — loves natural wine, kids are Leo and Maya, catch up every quarter"`
    or `"Partner at Sequoia — follow up next Tuesday on seed round"` — and
    extracts the person's fields, tags, custom facts and dated past interactions
    in one step.
  - **Contact enrichment** searches the web for a person, fills in missing
    work history, education, location and links, and cites every source URL so
    you can verify or revert it with **Not this person** (see
    [AI and research](../ai.md)).
  - **Duplicates** are caught on import and by background scans that match
    nicknames, phonetic spellings, shared emails or phones, and local embeddings
    (see [Duplicates](../duplicates.md)).

## Local hybrid search and MCP vs static fields

When you remember a detail about someone six months later, you rarely remember
which field you typed it into.

- **Monica** searches contact names and structured fields with standard database
  queries.
- **Contrack** indexes every contact, note, interaction and custom fact locally
  using SQLite FTS5 and a local 384-dimension embedding model (`bge-small-en-v1.5`),
  then reranks candidates with a local cross-encoder (`ms-marco-MiniLM-L-6-v2`).
  Both models run on CPU inside the container with no API key:
  - Ask `"Who do I know in Amsterdam?"`, `"wine"`, `"seed round"`, or switch to
    **Notes** mode and ask `"Who mentioned their kids last summer?"` to find the
    exact note and passage (see [Search and Ask Contrack](../search.md)).
  - Connect Claude Desktop, ChatGPT, Cursor or any Model Context Protocol
    client to `/api/mcp` so your assistant can search your network, read a
    timeline or log a note with a follow-up while respecting read-only or
    read-write access (see [MCP server](../mcp.md)).

## Personal and professional in one place

Many people keep two separate systems: a personal address book for friends and
family, and a spreadsheet or work tool for colleagues, clients and investors.
Contrack is designed so both live comfortably together:

- **Dates and milestones.** Record a contact's **Birthday**, **Anniversary** or
  any custom date (such as a wedding or work anniversary) with or without a
  year. [Pulse](../pulse.md) surfaces upcoming milestones 7 and 14 days ahead so
  you have time to send a note or pick up a gift.
- **Selective tracking.** You can hold 2,000 contacts from your phone and email
  without noise, and turn on **Track** only for the 50 friends, family members
  and collaborators you actively want to keep up with.
- **Connected people.** Mentioning `@Sarah Chen` inside a note on her partner's
  page links both timelines and lists them under **Connected people** on each
  contact page (see [Contacts](../contacts.md)).
- **Household and team accounts.** A single self-hosted instance can host
  separate accounts for family members or teammates, where each account's
  contacts, notes and connectors stay completely isolated in the database (see
  [Accounts and sign-in](../accounts.md)).

## When Monica might still fit better

Monica has dedicated tables for a few specific life-logging items that Contrack
models as notes, tags or custom attributes instead:

- Dedicated ledgers for **debts** ("owes me $20") and **pets** as separate
  database entities (in Contrack, these live in notes or **Other details**
  attributes).
- Built-in **CardDAV** server endpoints for syncing contacts back out to a
  phone's native address book (Contrack syncs with Google Contacts and imports
  or exports vCard 3.0 and 4.0 files).

## Moving from Monica to Contrack

1. In Monica, open **Settings → Export** and export your contacts as a **vCard**
   (`.vcf`) file.
2. In Contrack, open **Settings → Import** (or press `⌘K` and type `Import`),
   drop the `.vcf` file onto the page, and let the duplicate check merge any
   overlapping entries.
3. Open [Pulse](../pulse.md) or **Network**, pick the people you want to stay in
   touch with, and click **Track** to set a monthly, quarterly or custom
   cadence.
