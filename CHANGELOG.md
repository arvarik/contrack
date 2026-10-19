# Changelog

This file says what changes for the people who use and run Contrack, one
release at a time. Each line is a summary. The pull request behind a change,
which its commit links, holds the details.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Sign in with an OpenID Connect provider, linked from account settings or
  matched by verified email.

## [2.0.2] - 2026-10-18

### Fixed

- Connectors: keep the browser session signed in when a connector's own
  authentication check fails, and show the IMAP server's error message instead
  of `Command failed` (#245).
- Connectors: save a new mailbox when its IMAP server is busy or down for
  maintenance, and try it again later. Gmail's connection limit no longer
  counts as a wrong password (#245).

## [2.0.1] - 2026-10-16

### Added

- CardDAV connector for two-way or pull-only contact sync with Nextcloud,
  iCloud, Fastmail, Radicale and Baïkal.

### Changed

- Google OAuth setup in Settings now lists the five Google Cloud steps with the
  redirect address inline, and the Connect Google dialog explains where an
  admin configures it.

### Fixed

- Account and Passkeys: normalize usernames and emails, skip no-op passkey
  renames, reject blank or unchanged passwords, refresh device sessions after a
  password change, and show clear error messages on failure.
- Import, Duplicates and Contact enrichment: reject empty or oversized import
  files upfront, clear stale errors when switching import tabs, lock duplicate
  actions while running, and avoid flashing an empty state when clearing a
  contact enrichment search.
- Tags, Lists, Archived contacts and Trash: add search filters to Archived
  contacts and Trash, offer Undo when restoring an archived contact, prune
  hidden selections when filtering, and keep cached rows on screen when a
  background refetch fails.
- Connectors, Correspondents and MCP: accept `webcal://` calendar URLs, strip
  `imaps://` from IMAP hosts, preserve spaces in CardDAV and IMAP passwords,
  and add a search filter and name prompt to Correspondents.
- Administration: keep cached AI settings and Audit log entries on screen when a
  background refetch fails, reject non-decimal SMTP port strings, and validate
  invitation email addresses when typed.
- Connectors: retry failed syncs after backoff, merge matched Google contacts
  instead of overwriting them, keep Gmail messages past the per-run cap,
  deduplicate cross-folder IMAP mail, and preserve all-day recurring event IDs
  across time zones.

## [2.0.0] - 2026-10-14

Contrack 2.0 reimagines Contrack from the ground up as a fast, multi-user,
self-hosted personal CRM built around four steps: **Import → Dedupe → Enrich →
Track**. Every page has been rebuilt—from local-first semantic search and an
opt-in morning **Pulse** briefing to cited web research, an interactive
MapLibre network map, live calendar/mailbox connectors, and a built-in MCP
server.

> **Breaking change — clean start required:** Contrack 2.0 does not open or
> migrate a Contrack 1.x database. If pointed at a 1.x `DATA_DIR`, it exits
> safely without modifying any files. Start Contrack 2.0 with a fresh
> `DATA_DIR`.

### Multi-user accounts & sign-in

- **True multi-tenancy:** Multiple accounts share one instance with strict
  SQL-level isolation across contacts, notes, lists, connectors, and settings.
- **Flexible sign-in:** Sign in with a password, a WebAuthn passkey, or a
  magic link sent over SMTP (`SMTP_URL`). With `AUTH_REQUIRED=true`, the first
  visit walks through creating the initial admin account.
- **Administration & observability:** Invite members or admins, review the
  instance audit log, inspect database/queue/model status on **Instance
  health**, and download verified SQLite snapshots from **Backups**.
- **Per-account sessions & tokens:** Manage active device sessions individually,
  create scoped personal API tokens (full or read-only), and sync theme, accent,
  density, and search history across devices.

### Local-first search & Ask Contrack

- **Offline-capable hybrid search:** Runs entirely on local ONNX embedding and
  cross-encoder reranker models bundled inside the Docker image—no API key or
  internet connection required.
- **Structured facets + natural language:** Combine instant SQL facets
  (`company:`, `tag:`, `near:`, `contacted:`, `added:<30d`) with natural-language
  queries across people and interaction notes (**Notes** search returns the
  matching person, date, and passage).
- **Evidence & AI synthesis:** Every result highlights the exact fields or note
  passages that matched. When an AI provider is enabled, Ask Contrack adds a
  grounded summary on top.
- **Unified command palette (`⌘K` / `Ctrl+K`):** Jump to contacts, pages, saved
  filters, or quick interaction logging (`>`) from desktop or mobile.

### Pulse & opt-in relationship tracking

- **Opt-in tracking:** Choose exactly who to keep up with and on what cadence;
  relationship health rings appear only for tracked contacts.
- **Customizable morning briefing:** **Pulse** brings together **Up next**
  (**Catch up** & **Milestones** for birthdays/anniversaries), **Keeping up**,
  **Activity**, **Inbox**, and **Coming up** (next 7–14 days of meetings and
  dates) in your local time zone, with rearrangeable cards and one-click snooze
  - undo.

### Contacts, timeline & mobile experience

- **Unified contact workspace:** Responsive two-pane layout with human-readable
  slugs (`/contacts/<name>-<id>`), inline field editing, pronoun-aware default
  avatars, custom milestone dates, and a **Dossier** tab for AI briefings and
  research history.
- **One composer for everything:** Log notes, calls, meetings, and emails on
  today or past dates, attach follow-ups, and upload files via drag-and-drop or
  clipboard paste.
- **Add from text:** Paste raw meeting notes or bios to extract structured
  profile fields, tags, interests, and dated past interactions before saving.
- **First-class mobile web & PWA:** Bottom-sheet dialogs with drag-to-dismiss,
  44 px touch targets, one-tap call/text/email/vCard sharing, safe-area inset
  support, and Home Screen shortcuts.
- **Safety nets:** 30-day **Trash** with restore, contact archiving, and
  instant **Undo** toasts on destructive or single-key actions.

### AI providers & cited web research

- **Bring your own model:** Connect Gemini, OpenAI, Anthropic, or any
  OpenAI-compatible endpoint (Ollama, vLLM, LM Studio) and route tasks
  independently per model, with per-provider token and cost tracking.
- **Cited web research:** Run standard or deep research via your AI provider,
  a self-hosted SearXNG instance, or both. Every discovered fact links to its
  source URL and is recorded in the research log.
- **One-click correction:** **Not this person** reverts facts from a mismatched
  search (while preserving your manual edits) and excludes those URLs from
  future runs.

### Interactive network map

- **Zero-key vector map:** Built on MapLibre GL and OpenFreeMap tiles (or your
  own custom basemap URL) with self-hostable Nominatim geocoding and automatic
  metro-area normalization.
- **Spatial workflows:** Filter on the map, select contacts with box or lasso
  tools for bulk actions, save custom map views, place manual pins, and inspect
  unmapped contacts.

### Import, connectors & smart deduplication

- **Live connectors:** Sync Google Contacts, Gmail, Google Calendar, IMAP
  mailboxes, and ICS calendar feeds directly onto each contact's timeline with
  correspondent review queues and per-connector timeouts.
- **Resilient imports & exports:** Batch-streamed imports from Apple, Google,
  LinkedIn, Facebook, vCard, CSV, and JSON survive dropped connections without
  duplicating rows. Full round-trip export to vCard, formula-safe CSV, and JSON.
- **Confidence-scored deduplication:** Automatically merges high-confidence
  duplicates during import and queues ambiguous pairs in **Possible duplicates**
  with plain-English match reasons, side-by-side diffs, and a **90-day undo**
  window.

### Built-in MCP server, OAuth & OpenAPI

- **18-tool MCP server (`/api/mcp`):** Connect Claude Desktop, Claude Code,
  Cursor, VS Code, Codex, Gemini CLI, or ChatGPT via bearer token or OAuth 2.0
  with read-only scope support and prompt-injection guards (`<untrusted_data>`).
- **Shared OpenAPI 3.1 contract:** Every REST endpoint and MCP tool shares a
  single schema, published in `docs/openapi.json`.

### Security, privacy & operations

- **Hardened by default:** Strict CSP, HSTS, and `Permissions-Policy` headers;
  explicit `TRUST_PROXY_HOPS`; SSRF-guarded outbound fetches (`safeFetch`);
  encrypted stored credentials; DNS-rebinding and CSRF protections; and PII-free
  structured logs.
- **Privacy controls:** **Delete forever** purges merged records and uploaded
  media, daily sweeps clean orphaned files and geocode caches, favicons proxy
  through your server, and `docs/privacy.md` documents every outbound call.
- **Lean native runtime:** Runs directly on Node.js 26.10+ native TypeScript
  with numbered SQLite migrations, a ~160 MB multi-arch Docker image (`amd64` +
  `arm64`) with pre-bundled local search models, and signed SLSA build
  provenance attestations.

### Removed from 1.x

- `AI_TIER` quotas, `drizzle-kit` push commands (replaced by `npm run db:new`),
  legacy `/dev` and 1.x migration/redirect shims, `POST /api/contacts/merge-batch`,
  and `GET`/`PUT /api/auth/session-policy` (moved to `/api/admin/settings`).

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

[unreleased]: https://github.com/arvarik/contrack/compare/v2.0.2...HEAD
[2.0.2]: https://github.com/arvarik/contrack/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/arvarik/contrack/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/arvarik/contrack/compare/v1.5.5...v2.0.0
[1.5.5]: https://github.com/arvarik/contrack/compare/v1.5.4...v1.5.5
[1.5.4]: https://github.com/arvarik/contrack/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/arvarik/contrack/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/arvarik/contrack/compare/v1.4.0...v1.5.2
[1.4.0]: https://github.com/arvarik/contrack/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/arvarik/contrack/compare/v1.1.0...v1.3.0
[1.1.0]: https://github.com/arvarik/contrack/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/arvarik/contrack/releases/tag/v1.0.0
