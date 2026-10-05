# Changelog

This file says what changes for the people who use and run Contrack, one
release at a time. Each line is a summary. The pull request behind a change,
which its commit links, holds the details.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

These changes ship as version 2.0.0. Version 2 turns Contrack into a server
that several people can share and reach from the internet. It also rebuilds
search, Pulse, the map, research and the contact page.

**Version 2 is a new start.** It does not open or convert a Contrack 1 data
folder. It stops with a message and changes nothing in it. Start Contrack 2
with an empty `DATA_DIR`.

### Accounts and sign-in

- Several accounts can share one instance. Each account sees only its own
  contacts, notes and settings, and every database query enforces this.
- Sign in with a password, a passkey or a link sent by email. With
  `AUTH_REQUIRED=true`, the first visit creates the admin account.
- Admins invite people, give the member or admin role, and read an audit log.
  The **Instance health** page shows the database, the last backup, the
  queues, the models and the background jobs.
- Each account makes its own API tokens, and a token can be read-only. They
  replace the one instance-wide token of version 1.
- Each device's session can be signed out on its own. Theme, accent, list
  density and search history follow the account to every device.
- Outgoing mail (`SMTP_URL`) sends invitations, password resets and sign-in
  links.

### Security

- Every response carries a Content Security Policy, a `Permissions-Policy`,
  and `Strict-Transport-Security` over HTTPS.
- The server trusts no reverse proxy unless `TRUST_PROXY_HOPS` says how many
  sit in front. The default is 0, so behind a proxy, set it to 1.
- Mailed links take their address from `PUBLIC_URL` only. Without it, no mail
  carries a link.
- The database, backups, uploads and `secret.key` are readable by their owner
  only. Stored AI keys and connector passwords are encrypted.
- Link previews, remote images, calendar feeds and research fetch outside
  pages through one guard. It refuses private and local addresses when it
  connects, unless `CONNECTORS_ALLOW_PRIVATE_HOSTS` allows them for
  connectors.
- Docker Compose publishes the port on `127.0.0.1` only, and the CSV export
  neutralizes spreadsheet formulas.
- While sign-in is off, the server answers only local host names, the
  `PUBLIC_URL` host and `ALLOWED_HOSTS`, so a web page cannot reach it through
  DNS rebinding. `/api/mcp` refuses a request from another site's page.
- A signed-in change from another site's page is refused, a sibling
  subdomain's included. Instance administration needs a signed-in admin, and
  an API token cannot use it.
- `npm run dev` listens on this machine only and does not serve the data
  files. To serve other machines, run the production build.

### Search and Ask Contrack

- Ask Contrack answers locally first. A name, an email or a phone number needs
  no model, and filters such as `company:`, `tag:`, `near:` and `contacted:`
  run in SQL.
- A local reranker orders the answers, and each person shows the fields that
  made the match. AI writes a short brief on top when it is on.
- Search works with AI off, and with no network once the two local models are
  present.
- **Notes** search answers questions such as "Who discussed hiring last
  month?" with the person, the date and the passage.
- Search history is shared with the command palette, and "Try asking" offers
  questions built from your own contacts.

### Pulse and tracking

- Tracking is a choice. You decide who to keep up with and how often, and only
  tracked people get a relationship score.
- Pulse is one morning page: what is due today, **Up next** with **Catch up**,
  **Keeping up**, **Activity**, **Inbox** and **Coming up**. You can move and
  hide its cards. Overdue and Today follow your own time zone, not the
  server's.

### Contacts

- The contact page fits the width of its pane. One composer logs a note, a
  call, a meeting or an email, with a follow-up.
- The **Dossier** holds the AI briefing and the record of every research run.
- Default avatars follow a contact's pronouns and name.
- Deletes go to a trash that keeps them for 30 days by default, and a write
  made with one key offers **Undo**.
- Export to vCard, CSV or JSON. A vCard export imports back in.
- On a phone, a contact's phone and email are one tap from a call, a text or
  a mail, **Share contact** sends a vCard, and the Network list keeps its
  place and opens the command palette.
- On a phone, dialogs are sheets that drag closed, Back on Android closes
  them, and Save stays above the keyboard while the tab bar steps aside.
  The app keeps clear of the status bar and a side cutout, and a contact
  opens without its timeline jumping.

### AI and research

- Connect Gemini, OpenAI, Anthropic or any OpenAI-compatible server, such as
  Ollama, vLLM or LM Studio. One settings page picks the model for each task.
- An admin can turn AI off for the instance, and each person can turn it off
  for their account. Contact management and search keep working.
- Research has two depths, cites its sources, and records what each run found
  and cost. It can search with the AI provider, with SearXNG, or with both.
- The usage page shows what each provider costs.

### Map

- The map runs on MapLibre with OpenFreeMap tiles, and needs no API key. You
  can point it at your own basemap.
- Save views, select people with a box or a lasso, act on a selection, and see
  who is not on the map yet.
- Place a pin by hand, find a place by name, and open the results of a
  question on the map.

### Import, sync and export

- Connectors sync a calendar (ICS), a mailbox (IMAP) and Google Contacts,
  Gmail and Calendar. Meetings and email appear on each person's timeline.
- An import survives a dropped connection and never imports a row twice.
  It saves in batches, so the server keeps answering while a large file
  goes in.
- A Google, mailbox or calendar call that stops answering times out, so one
  stuck sync no longer holds up every connector.

### Duplicates

- One merge policy decides every merge, keeps follow-ups, and can be undone.
- A pair marked as different people is never merged, and a quick scan runs
  with AI off.

### Privacy

- **Delete forever** also removes the contacts merged into the contact, their
  merge records, and their photos, attachments and link-preview images. A
  daily sweep removes uploaded files that nothing uses.
- A merge can be undone for 90 days. After that, the merged-away contact and
  its merge record are deleted.
- An admin can turn off address lookups for the map, or point them at a
  self-hosted Nominatim (`GEOCODING_DISABLED`, `NOMINATIM_URL`). Cached
  addresses that no contact uses are deleted daily.
- A contact's website icon comes from your server, never from Google. OpenAI
  calls ask OpenAI not to store the answer. A failed sign-in no longer records
  the name typed.
- Signing out removes note drafts and the map's last view from the browser.
- A new [Privacy](docs/privacy.md) page lists what leaves the server, how long
  each kind of data stays, and what a delete removes.

### MCP and API

- The built-in MCP server (`POST /api/mcp`) offers 18 tools, two prompts and
  resources to Claude, Cursor and other clients. A read-only token sees only
  the 9 read-only tools.
- **Settings → MCP and API** sets up Claude Code, Claude Desktop, Cursor, VS
  Code, Codex and Gemini CLI. It makes a token for the client and fills in
  the command, the config or a one-press install link.
- Claude on the web, Claude Desktop, the Claude phone app and ChatGPT
  connect by address and sign in with OAuth, with a consent page that offers
  read only. Approved apps show in the token list, where one press
  disconnects them. OAuth needs sign-in on and an https `PUBLIC_URL`.
- Each tool has a title and hints that say whether it reads, adds, or can
  overwrite. Results leave out the fields only the server reads, and a
  refused call answers with its code and what to do next.
- The routes for contacts, notes, follow-ups, lists, tags and tokens share
  one contract with the app and the MCP tools. `docs/openapi.json` describes
  them in OpenAPI 3.1.

### Install and operations

- The built files under `/assets` are cached for a year, as their names
  change with their content, so a phone loads the app with far fewer
  requests. The Home Screen app has shortcuts to Pulse, Ask and the map.

- Node.js 26.10 or later is required. Node runs the TypeScript itself, so the
  server has no build step.
- The Docker image holds the local search models, so a container downloads
  nothing at start.
- The database changes through numbered migrations. `/healthz` reports the
  last one, and a build refuses to open a database that a newer build changed.
- Background work runs as jobs that **Instance health** lists, and
  `JOB_CONCURRENCY` sets how many run at once.
- Backups are checked against the live database after each snapshot, and
  responses are compressed.
- The docs are rewritten as task pages, which also build as a GitHub wiki.

### Removed

- `AI_TIER` and the free and paid limits behind it.
- `npm run db:generate`, `npm run db:push` and drizzle-kit. Use
  `npm run db:new <name>`.
- `POST /api/contacts/merge-batch`, `POST /api/dev/seed-duplicates`, and the
  dedupe scan modes `deterministic`, `ai` and `both`.
- The single-pass research strategy, the old enrichment dossier and the
  component page at `/dev`.
- The move of 1.x settings out of browser storage, and the redirects from 1.x
  paths.
- `GET` and `PUT /api/auth/session-policy`. Use `/api/admin/settings`.

## [1.5.5] - 2026-08-09

### Fixed

- The Docker Compose file of 1.5.4 turned off scheduled backups.
- Seeding a new data folder failed.
- The outbound fetch guard missed private addresses inside IPv6.

## [1.5.4] - 2026-08-09

### Added

- A quick start with the prebuilt image, a `/healthz` probe and a Docker
  health check. `docker stop` shuts the server down cleanly.

### Fixed

- The seed scripts wrote to the wrong database when `DATA_DIR` was set.
- The outbound fetch guard had a DNS rebinding gap, and every route accepted
  a 50 MB body.
- An install with only an OpenAI or Anthropic key showed a false alarm at
  start.

## [1.5.3] - 2026-08-09

### Added

- The relationship score explains itself, and Settings has a filter.
- Shift-click selects a range of contacts, and the session lifetime can be
  set.

### Fixed

- A custom OpenAI-compatible endpoint failed every AI request, and Settings
  listed each one twice.

## [1.5.2] - 2026-08-07

### Added

- Accounts with a username and a password replace the shared access token.

### Changed

- `AUTH_TOKEN` is renamed `API_TOKEN`.

## [1.4.0] - 2026-08-05

### Added

- AI by capability: Gemini, OpenAI, Anthropic or any OpenAI-compatible
  server, with a model for each task.
- Web research through a self-hosted SearXNG.
- Docker images for `linux/arm64` as well as `linux/amd64`.

### Fixed

- Gemini embeddings kept one vector per batch, which left the search and
  duplicate indexes almost empty. Anthropic structured output failed every
  time.

## [1.3.0] - 2026-08-04

### Added

- A trash with a retention period, scheduled database snapshots, and JSON and
  CSV export.
- Sign-in with an access token.

### Changed

- TypeScript strict mode across the code, and integration tests against a
  real SQLite database.

### Fixed

- Untrusted text is fenced before it reaches a model, and model output is
  checked before it is saved.

## [1.1.0] - 2026-05-15

### Added

- Hybrid search that mixes keyword and vector results.

## [1.0.0] - 2026-05-14

The first release: a local-first personal CRM with contact management,
semantic search, AI enrichment and duplicate detection.

[unreleased]: https://github.com/arvarik/contrack/compare/v1.5.5...HEAD
[1.5.5]: https://github.com/arvarik/contrack/compare/v1.5.4...v1.5.5
[1.5.4]: https://github.com/arvarik/contrack/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/arvarik/contrack/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/arvarik/contrack/compare/v1.4.0...v1.5.2
[1.4.0]: https://github.com/arvarik/contrack/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/arvarik/contrack/compare/v1.1.0...v1.3.0
[1.1.0]: https://github.com/arvarik/contrack/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/arvarik/contrack/releases/tag/v1.0.0
