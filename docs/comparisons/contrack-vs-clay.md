# Contrack vs Clay

_Compared in October 2026: Contrack 2.0.0 and Clay (hosted SaaS)._

[Clay](https://clay.earth) is a polished commercial personal CRM known for its
editorial design, automatic social and email imports, and natural-language
search across your network.

Contrack brings that same focus on thoughtful design, effortless capture, semantic
search and relationship cadences to an open-source, self-hosted server that runs on
a single SQLite file, so your personal and professional relationships, notes,
emails and calendar history never leave hardware you control.

## At a glance

| Area                       | Contrack 2.0.0                                                                                         | Clay (hosted SaaS)                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| **Hosting and license**    | Self-hosted, open-source (AGPL-3.0), free with no seat or contact limits                               | Cloud-only proprietary SaaS with paid monthly tiers                  |
| **Stack and storage**      | 1 Node container and 1 SQLite file (`curator.db`) on your own disk                                     | Hosted cloud infrastructure managed by Clay                          |
| **Data privacy**           | Zero telemetry; notes, emails and embeddings stay on your server                                       | Contact graph, email headers/metadata and notes stored in Clay cloud |
| **Personal context**       | Friends, family, birthdays, anniversaries, custom dates, gift ideas in notes, tags, lists, @mentions   | Notes, birthdays, reminders, lists and life updates                  |
| **Professional context**   | Role, company, experience, education, cadence, relationship score, web research and pre-meeting briefs | Work history, social profiles, job change alerts and notes           |
| **Getting data in**        | Google Contacts, Gmail, Google Calendar, IMAP, ICS, vCard/CSV/JSON import, and **Add from text**       | Google/Microsoft email & calendar, iMessage, LinkedIn, CSV/vCard     |
| **Keeping up**             | Opt-in tracking per person, custom cadence, **Pulse** morning page, overdue and upcoming milestones    | Reconnect cadences, home feed and reminders                          |
| **Search**                 | Local hybrid search (FTS5 + `sqlite-vec` embeddings + local cross-encoder reranker) and **Notes** mode | Cloud-hosted semantic and keyword search (Nexus)                     |
| **Map**                    | Built-in MapLibre world map with clustering, box/lasso selection, saved views and custom pin placement | Location search and list filtering; no interactive lasso world map   |
| **AI and web enrichment**  | Optional BYO-key or local Ollama + SearXNG web research with cited sources and **Not this person**     | Built-in cloud AI (Nexus) and commercial profile enrichment          |
| **MCP server**             | Built in at `/api/mcp` (18 tools, personal tokens and OAuth 2.1 on your own server)                    | Hosted MCP integration tied to a Clay account                        |
| **Multi-user / household** | Multiple isolated accounts on one server, included for free                                            | Paid per-user plans and team workspaces                              |

## Self-hosted ownership vs cloud-only SaaS

A personal CRM holds some of your most sensitive context: private notes about
friends and family, candid takeaways from investor or recruiting meetings, email
correspondence, and where the people you care about live.

- **Clay** is a closed-source cloud service. Using it means syncing your email,
  calendar and notes to Clay's servers and paying an ongoing subscription to
  keep full access to your network and search.
- **Contrack** runs on your own machine, home server or VPS as a single Node.js
  process over one SQLite file (`curator.db`). There is no telemetry, no vendor
  cloud, and no per-contact or per-seat pricing. Backing up your entire CRM is a
  single SQLite snapshot via **Settings → Backups** or automatic daily backups
  (see [Self-hosting](../self-hosting.md) and [Privacy](../privacy.md)).

## Local hybrid search and optional AI vs cloud-only AI

Both Clay and Contrack treat search as a core workflow rather than an
afterthought, but they run that search very differently:

- **Clay** indexes your contacts and notes in the cloud and routes natural-language
  queries through its hosted Nexus AI service.
- **Contrack** runs its entire hybrid search pipeline locally on CPU inside the
  container, with no API key required:
  - Every contact, note, interaction and custom fact is indexed in SQLite FTS5
    and embedded locally with `bge-small-en-v1.5` (384 dimensions) in
    `sqlite-vec`, then reranked with a local `ms-marco-MiniLM-L-6-v2`
    cross-encoder.
  - You can search people (`"Who do I know in Tokyo?"`, `"fintech founders"`) or
    switch to **Notes** mode to search across every note and interaction passage
    (`"Who mentioned natural wine?"`, `"seed round"`).
  - If you turn on AI features such as **Ask Contrack**, **Add from text**,
    pre-meeting briefs, or web enrichment, you choose the model provider
    (OpenAI, Anthropic, Google Gemini, OpenRouter, or a local Ollama model) and
    web search engine (provider-native, Brave, Tavily, Serper or self-hosted
    SearXNG). See [Search and Ask Contrack](../search.md) and
    [AI and research](../ai.md).

## Calm, intentional tracking vs social feed noise

When you connect email and address books, thousands of people flow in at once.

- **Clay** automatically imports contacts across connected accounts and surfaces
  a stream of social updates and reconnect prompts.
- **Contrack** separates your **address book** from your **tracked inner circle**:
  - Gmail, Google Calendar, Google Contacts, IMAP and ICS connectors sync quietly
    in the background and attach emails and meetings to existing contacts (see
    [Import, sync and export](../import-and-sync.md)).
  - Only the people you explicitly mark as **Tracked** appear in your overdue
    check-ins on [Pulse](../pulse.md) and factor into your network health score.
  - **Add from text** (Smart Paste) lets you drop in a quick note after a wedding
    or a coffee meeting, like `"Met at Sarah's wedding, loves natural wine, kids are Leo and Maya, catch up every quarter"`
    or `"Partner at Sequoia, follow up next Tuesday on seed round"`, and turns
    it into a structured contact, tags, custom facts and dated timeline entries
    in seconds.

## Interactive world map and self-hosted MCP

- **World map.** Planning a trip to London or New York? Contrack's
  [Map](../map.md) plots your contacts on an interactive MapLibre globe and flat
  map, resolves metro and regional locations automatically, lets you draw a
  rectangle or freehand lasso around a city to add everyone to a trip list, and
  saves named map views.
- **MCP server on your terms.** Contrack ships a built-in Model Context Protocol
  server at `/api/mcp` with 18 tools, scoped read-only or read-write personal
  tokens, and OAuth 2.1, so Claude Desktop, ChatGPT, or Cursor can work with
  your CRM directly against your own server (see [MCP server](../mcp.md)).

## When Clay might still fit better

Clay has a few capabilities that come from its commercial data partnerships and
native Apple client apps:

- **Native iOS and macOS apps** with direct local access to iMessage history on
  a Mac (Contrack is a responsive web app that installs as a PWA on mobile and
  desktop).
- **Direct LinkedIn and X/Twitter sync** and automatic job-change alerts powered
  by commercial third-party data brokers (Contrack enriches profiles on demand
  via web research with cited source URLs).
- **Zero hosting setup** if you prefer a managed SaaS subscription over running
  Docker.

## Moving from Clay to Contrack

1. In Clay, open **Settings → Export** and export your contacts as a **CSV** or
   **vCard** (`.vcf`) file.
2. In Contrack, open **Settings → Import** (or press `⌘K` and type `Import`),
   upload the exported file, and review any suggested merges in the duplicate
   check.
3. Connect Google or IMAP/ICS accounts in **Settings → Connectors** if you want
   automatic email and calendar timelines, then mark your priority relationships
   as **Tracked** on [Pulse](../pulse.md).
