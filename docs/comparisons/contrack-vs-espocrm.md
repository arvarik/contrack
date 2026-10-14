# Contrack vs EspoCRM

_Compared in October 2026: Contrack 2.0.0 and EspoCRM 10.0.9._

[EspoCRM](https://github.com/espocrm/espocrm) is a mature open-source business
CRM written in PHP. It offers a comprehensive suite of enterprise sales and
support modules: Accounts, Leads, Opportunities, Cases, Quotes, Invoices,
Knowledge Base and BPM workflows.

Self-hosters looking for a reliable, open-source way to organize contacts often
consider EspoCRM alongside personal CRMs. While EspoCRM is built to run a
company's sales and customer-support departments, Contrack is built from the
ground up for **personal and professional relationship management**.

## At a glance

| Area                       | Contrack 2.0.0                                                                                         | EspoCRM 10.0.9                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **Designed for**           | Individuals, founders, researchers and households managing personal and professional relationships     | Small and mid-sized businesses managing sales, support cases and quotes  |
| **Stack and deployment**   | 1 Node container and 1 SQLite file (`curator.db`)                                                      | PHP, Apache/Nginx, MySQL or MariaDB, plus cron daemon                    |
| **Interface**              | Calm, keyboard-first React interface (`⌘K` palette, single-key shortcuts, light/dark/warm themes)      | Multi-module business portal with admin layout manager and entity tables |
| **Personal context**       | First-class birthdays, anniversaries, custom dates, gift/family notes, interests and @mentions         | Business contact fields; personal milestones require custom layout edits |
| **Proactive relationship** | Opt-in tracking, per-contact cadence, 5-signal relationship score and **Pulse** morning page           | Sales tasks, calendar calls and meeting schedulers                       |
| **Data entry**             | **Add from text** (Smart Paste), 1-key note logging, drag-and-drop/paste attachments, auto connectors  | Multi-field entity forms and CSV import                                  |
| **Search**                 | Local hybrid search (FTS5 + `sqlite-vec` embeddings + local cross-encoder reranker) and **Notes** mode | SQL text and field filters                                               |
| **Web enrichment**         | Built-in web research (provider search or SearXNG) with cited sources and one-click undo               | None built in                                                            |
| **Map**                    | Built-in MapLibre world map with clustering, box/lasso selection and saved views                       | Requires paid or third-party extensions for mapping                      |
| **MCP server**             | Built in at `/api/mcp` (18 tools, personal tokens and OAuth 2.1)                                       | REST API only; no built-in MCP server                                    |

## A calm daily habit vs an enterprise back office

The biggest difference between Contrack and a traditional business CRM is how it
feels to open it every morning:

- **EspoCRM** presents a navigation bar of business entities: Accounts,
  Contacts, Leads, Opportunities, Emails, Calendar, Calls, Tasks, Cases and
  Reports. Adding a note or checking who you have not spoken to in three months
  means navigating entity lists, sub-panels and form modals.
- **Contrack** is built around four focused workspaces (**Pulse**, **Network**,
  **Ask Contrack** and **Map**) and a command palette (`⌘K` / `Ctrl+K`) that
  reaches every action from the keyboard:
  - Open **Pulse** in the morning to see your overdue follow-ups, today's tasks,
    tracked contacts due for a catch-up, and upcoming birthdays, anniversaries
    and meetings (see [Pulse](../pulse.md)).
  - Press `n` on a contact page to jump straight into the note composer, type a
    note (`@`-mentioning anyone else who was there), drop or paste an image or
    file, add a follow-up with a natural-language date (`next Tuesday`), and
    press `⌘↵` to save (see [Contacts](../contacts.md) and
    [Keyboard shortcuts](../keyboard-shortcuts.md)).
  - Keep both personal and professional context in one place: a note about a
    friend's kids and favorite wine sits naturally alongside a note from a
    board meeting or a conference coffee.

## Zero-admin SQLite vs LAMP stack maintenance

- **EspoCRM** runs on PHP with MySQL or MariaDB and a cron daemon. Customizing
  it involves admin panels for Entity Manager, Layout Manager, Formula scripts
  and role ACL matrices.
- **Contrack** works out of the box with zero schema administration. It runs as
  one Node.js process over a single SQLite file (`curator.db`), with automatic
  daily backups and an **Instance health** page that shows database integrity,
  backup status, search index state and background jobs in plain language (see
  [Self-hosting](../self-hosting.md)).

## Local semantic search, web research and MCP

Traditional PHP CRMs were designed before local embedding models and AI agents
existed:

- **Hybrid semantic search that runs locally.** Contrack embeds every contact
  and interaction note on your own CPU using `sqlite-vec` and reranks results
  with a local cross-encoder. You can search for a concept (`"robotics"`,
  `"natural wine"`, `"privacy audit"`) even when you do not remember the exact
  word you used, or combine facets like `tag:friend location:London` (see
  [Search and Ask Contrack](../search.md)).
- **Smart Paste and web enrichment.** Paste a block of free text into **Add from
  text** to create or update a contact with its tags, facts and dated past
  interactions, or run **Enrich contact** (`Standard` or `Deep`) to gather
  public role, company, education and links with cited sources (see
  [AI and research](../ai.md)).
- **Duplicate resolution.** Contrack automatically detects duplicates across
  imports and connectors using Jaro-Winkler name matching, nickname tables,
  phonetic hashes, shared emails/phones and vector similarity, and lets you undo
  any merge for 90 days (see [Duplicates](../duplicates.md)).
- **Model Context Protocol (`/api/mcp`).** Connect Claude, ChatGPT or Cursor
  directly to your Contrack instance with OAuth 2.1 or a personal token so your
  AI assistant can query your network or log notes for you (see
  [MCP server](../mcp.md)).

## When EspoCRM might fit better

Choose EspoCRM if you are running a traditional business operation that needs
back-office ERP and CRM modules:

- You need **Leads, Opportunities, Quotes, Invoices and Support Cases** with
  multi-user role hierarchies, territory permissions and automated BPM
  flowcharts.
- You want a browser-based **Entity Manager** to design custom database tables
  and form layouts for a sales or support department.
