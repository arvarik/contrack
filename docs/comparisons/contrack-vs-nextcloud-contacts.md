# Contrack vs Nextcloud Contacts

_Compared in October 2026: Contrack 2.0.0 and Nextcloud Contacts 8.9.1._

[Nextcloud Contacts](https://github.com/nextcloud/contacts) is the standard
address book app for Nextcloud. It stores vCard records and syncs phone numbers,
emails and addresses across devices over CardDAV.

Contrack goes beyond a static address book to work as a **relationship manager**:
it pairs your contact list with chronological interaction timelines, stay-in-touch
cadences, automatic email and calendar sync, local semantic search across notes,
a world map, web enrichment and a built-in MCP server — all inside a single
Node.js container and a single SQLite file.

## At a glance

| Area                      | Contrack 2.0.0                                                                                         | Nextcloud Contacts 8.9.1                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| **Primary job**           | Proactive personal and professional relationship manager (CRM)                                         | CardDAV address book inside a Nextcloud server                         |
| **Stack and deployment**  | 1 Node container and 1 SQLite file (`curator.db`)                                                      | Requires a full Nextcloud server (PHP, MariaDB/PostgreSQL, Redis, web) |
| **Backup**                | One SQLite snapshot (`VACUUM INTO`), automatic daily backups, or one click in **Settings → Backups**   | Nextcloud database dump + data directory snapshot, or `.vcf` export    |
| **Personal context**      | Rich timelines, birthdays, anniversaries, custom dates, gift ideas in notes, tags, lists, @mentions    | Static vCard fields (phone, email, address, birthday, single Note box) |
| **Professional context**  | Role, company, experience, education, cadence, relationship score, web research and pre-meeting briefs | Basic vCard title and organization fields                              |
| **Interaction history**   | Chronological timeline of notes, calls, meetings, emails and attachments per person                    | None (only a single plain-text `NOTE` field per contact)               |
| **Getting data in**       | Google Contacts, Gmail, Google Calendar, IMAP, ICS, vCard/CSV/JSON import, and **Add from text**       | CardDAV sync and vCard (`.vcf`) import                                 |
| **Keeping up**            | Opt-in tracking per person, custom cadence, **Pulse** morning page, overdue and upcoming milestones    | Optional birthday calendar events; no stay-in-touch cadences or scores |
| **Search**                | Local hybrid search (FTS5 + `sqlite-vec` embeddings + local cross-encoder reranker) and **Notes** mode | Substring search on contact name and vCard fields                      |
| **Map**                   | Built-in MapLibre world map with clustering, box/lasso selection, saved views and custom pin placement | None in Contacts app                                                   |
| **AI and web enrichment** | Optional provider-backed or SearXNG web research with cited sources, plus **Ask Contrack**             | None                                                                   |
| **MCP server**            | Built in at `/api/mcp` (18 tools, personal tokens and OAuth 2.1)                                       | None                                                                   |

## A living relationship timeline vs a static vCard form

An address book answers _"What is Alex's phone number?"_ A relationship manager
answers _"When did I last talk to Alex, what did we discuss, and who am I
losing touch with?"_

- **Nextcloud Contacts** models each person as a vCard with fields for phone,
  email, physical address and a single static `NOTE` box. There is no timeline of
  past conversations, no way to log a call or coffee with a follow-up date, and
  no cadence tracking.
- **Contrack** gives every person a full dossier and chronological timeline
  (see [Contacts](../contacts.md)):
  - Log rich Markdown notes, calls, meetings and emails with file attachments,
    `@mentions` that cross-link connected people, and a **Next follow-up** date.
  - Turn on **Track** for the friends, family members and professional contacts
    you want to stay close to. [Pulse](../pulse.md) computes a relationship
    health score (`0–100`) and shows who is overdue alongside upcoming
    birthdays, anniversaries and custom milestones.
  - Use **Add from text** (Smart Paste) to paste a quick note — such as
    `"Met at Sarah's wedding — loves natural wine, kids are Leo and Maya, catch up every quarter"`
    or `"Partner at Sequoia — follow up next Tuesday on seed round"` — and let
    Contrack extract the contact's fields, tags, custom facts and dated
    interactions automatically.

## Automatic email and calendar context

- **Nextcloud Contacts** does not automatically attach your email threads or
  calendar meetings to a contact's history.
- **Contrack** includes background connectors for Gmail, Google Calendar, Google
  Contacts, any standard **IMAP** mailbox (including mail hosted alongside
  Nextcloud) and any **ICS** calendar feed (including a Nextcloud Calendar ICS
  URL). Emails and meetings automatically appear on the matching contact's
  timeline and update their last-contacted date (see
  [Import, sync and export](../import-and-sync.md)).

## Local hybrid search, world map, web enrichment and MCP

- **Search by meaning, not just exact spelling.** Contrack indexes every contact,
  note, interaction and custom fact in SQLite FTS5 and embeds them locally on CPU
  using `bge-small-en-v1.5` (`sqlite-vec`) with `ms-marco-MiniLM-L-6-v2`
  cross-encoder reranking. Search `"fintech"`, `"wine"` or `"Who did I meet at the conference?"`
  across both people and **Notes** mode with no external API key (see
  [Search and Ask Contrack](../search.md)).
- **Interactive world map.** View your network on a MapLibre [Map](../map.md),
  select a city with a rectangle or lasso tool to build a trip list, or fine-tune
  any pin.
- **Web enrichment with citations.** Fill in a contact's work history, education,
  bio and links using web research that cites every source URL and can be
  reverted in one click with **Not this person** (see [AI and research](../ai.md)).
- **MCP server.** Connect Claude Desktop, ChatGPT or Cursor to `/api/mcp` to
  search your CRM or log notes from your AI assistant (see
  [MCP server](../mcp.md)).

## Standalone single-file SQLite deployment

Even if you do not run Nextcloud, Contrack deploys in seconds as a single Node.js
container backed by one SQLite file (`curator.db`). And if you already run
Nextcloud, Contrack runs happily alongside it on a tiny memory footprint with
zero database server contention (see [Self-hosting](../self-hosting.md)).

## When Nextcloud Contacts might still fit better

- You only want a **CardDAV server** to sync names and phone numbers with the
  built-in Contacts and Phone dialer apps on iOS or Android.
- You already run Nextcloud and do not need interaction timelines, stay-in-touch
  cadences, semantic search or a network map.

## Using Nextcloud with Contrack (or moving over)

Many self-hosters use both or migrate in three steps:

1. In Nextcloud Contacts, click **Contacts settings** (bottom left), click the
   `⋯` menu next to your address book, and select **Download** to export a
   `.vcf` (vCard) file.
2. In Contrack, open **Settings → Import** (or press `⌘K` and type `Import`),
   drop the `.vcf` file onto the page, and let the duplicate check merge any
   overlapping contacts.
3. Optional: copy your Nextcloud Calendar's private **ICS link** and your mail
   server's **IMAP** credentials into **Settings → Connectors** in Contrack so
   meetings and emails flow onto your contact timelines automatically.
