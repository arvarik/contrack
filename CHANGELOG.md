# Changelog

This file says what changes for the people who use and run Contrack, one
release at a time. Each line is a summary. The pull request behind a change,
which its commit links, holds the details.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- The Docker image moves to the newest Node 26 Debian base, and takes the
  newer Debian updates when it builds. This fixes CVE-2026-109518 in `apt`, and
  CVE-2026-76844, CVE-2026-85091 and CVE-2026-27171 in `zlib1g`.
- The server never draws an SVG it was sent. An SVG named as another image
  type is refused as an account photo, and a contact gets a drawn avatar for
  one in a vCard.
- A contact photo upload must be a JPEG, PNG, GIF, WebP or AVIF image by its
  bytes, not only by the type the upload names, so an SVG or a page sent as
  a PNG is refused and never served from your Contrack.

### Added

- HEIC photos, the format an iPhone takes, and AVIF photos work in an
  import, as a contact's photo and as your account photo. Your browser turns
  each into a JPEG before it sends it, so the server still reads no HEIF
  image.
- An import's summary says how many photos it could not read, and a
  connector's run history counts the contact photos it could not read. Before,
  those contacts got a drawn avatar without a word.
- Every instance serves `/third-party-notices.txt`: each package, model, font
  and data file Contrack ships from others, with its licence. The Docker
  image holds the file too.

### Changed

- A new contact gets a random id, so its URL no longer holds the name. A
  contact added before keeps its id, and the server log writes that id
  without the name.
- The API returns the `source` of each school and job, as it does for
  emails and phones.
- A TIFF image at a web address, such as a CardDAV card's photo or a link
  preview's picture, is saved like a JPEG or PNG one. A TIFF photo inside a
  vCard already was.

### Fixed

- Undoing a merge clears the AI answers and briefings cached while the two
  contacts were one.
- Undoing a merge moves a row back to the other contact after the kept
  contact's list was saved. Before, the same email or phone ended up on both.
- One phone number written with and without its country code matches, also
  for countries whose numbers are not 10 digits long, such as France and
  Spain. A contact made from a synced message keeps the whole number.
- **Not this person** keeps a school or job you corrected or typed yourself.
- A contact edited later on the day of its last duplicate check is checked
  again.
- The MCP `updatedSince` filter finds a contact edited later on that day.
- A vCard whose lines end in an extra carriage return, as an Apple Contacts
  export can, imports its photos and long notes whole. Before, every photo in
  such a file was lost and its contact got a drawn avatar.

## [2.0.6] - 2026-11-04

Upgrading runs one database migration when the server starts. The first
Google sync reads every Google contact once more, and the first calendar sync
counts each person in your past meetings once more.

### Security

- Running from source needs Node.js 26.13.0 or later. Until the image library
  ships the libheif security fixes, HEIF and AVIF images are refused, such as
  an account photo or a remote logo in AVIF.
- A long run of dashes or apostrophes in a name or a mail sender's name no
  longer stalls the server.
- With `CONNECTORS_ALLOW_PRIVATE_HOSTS`, CardDAV accepts a plain `http://`
  address only on the private network.

### Added

- Google Contacts sync birthdays, addresses, notes and websites, and Google
  labels become tags.
- The Calendar connector has **Also treat these addresses as mine**, for a
  calendar that invites you at another address than your sign-in email.

### Changed

- Access log lines use one layout, the old `short` one without the empty user
  field.
- A sync where one part fails shows the error on the connector and in its run
  history, while the other parts still sync. A CardDAV write that the server
  refuses is an error, and it is tried again after your next edit.

### Fixed

- **Google**
  - Gmail syncs when AI summaries are off. Every sync of its mail failed.
  - A contact deleted in Google moves to the trash in Contrack.
  - A meeting is logged after it ends. Coming up shows the next 60 days of
    meetings with someone else, without birthdays, focus time, out of office
    or cancelled events.
  - Connecting works on a server east of UTC, and a permission you untick
    turns that part of the sync off instead of failing on every run.
  - Reconnect repairs a connector whose secret no longer opens. Removing a
    connector revokes Contrack's access at Google. "Sign-in expired" names the
    7-day limit of an app in Testing, and Connect Google explains Google's
    "hasn't verified this app" and "Access blocked" screens.
  - With two Google accounts, each one counts as you, and a mail or invite
    that both receive is logged once.
  - AI summaries no longer try mail that Google did not allow, and a run tries
    at most 50.
  - Google's letter tile is no longer saved as a photo, and email addresses and
    phone numbers keep their work and home labels.
  - A suggested person that you save in Google Contacts becomes a contact, and
    turning Gmail or Calendar on later starts at the lookback date.
- **People and correspondents**
  - Each person counts once per mail or meeting, whatever the spelling of the
    address ("+tag", Gmail's dots), and a mail to such an address finds the
    contact.
  - Your own addresses, robots such as billing@ or no-reply@, Hide My Email
    relays and bulk mail are left out. Mail with only you and strangers no
    longer lands on your own contact. People at mail providers and
    universities can be suggested again.
  - A duplicate group says once how many contacts share a name.
- **Mailbox (IMAP)**
  - The mailbox you connect counts as you, and newsletters and mailing lists
    no longer suggest people.
  - A folder that cannot be opened shows as an error, "Presentations" is no
    longer taken for the Sent folder, and mail moved in from another mailbox
    keeps the date it was sent.
- **Calendar (ICS)**
  - Meetings you declined are left out, events with no one but you stay off
    Coming up, and shared or room calendars and Outlook's hidden attendees are
    not people. A CalDAV `urn:uuid:` attendee is read by its address.
  - A meeting of someone else's series that you are invited to is logged once.
  - An address that returns a web page fails the sync instead of emptying
    Coming up.
- **CardDAV and vCards**
  - Two-way sync uploads only the contacts and fields you change, so a server
    edit to another field stays. Switching from Pull only to Two-way no longer
    uploads almost every contact.
  - Address books of more than about 15,000 cards sync.
  - Removing a connector and adding it back links its contacts again instead
    of importing some twice, and a card from a stopped upload is linked.
  - A contact keeps taking its source's edits when a second card shares its
    address or another connector uploads it. A card deleted on the server is
    unlinked even when the upload of that sync failed, and a false "gone" from
    the server no longer lets the next sync undo a newer edit.
  - vCard 4.0 cards stay 4.0. `tel:` numbers, `image/jpeg` photos, every
    CATEGORIES line and custom labels such as "old work" are read, and a photo
    removed on the server is removed. A birthday written as a date-time keeps
    its day, and a year alone or "circa 1950" no longer becomes January 1.
  - A card with thousands of addresses no longer stalls the server, and synced
    contacts are capped like the ones made in the app.
- A shorter sync interval moves the next run up.

## [2.0.5] - 2026-11-02

### Security

- Docker image: Node.js 26.13.0, which has the fixes of the Node.js 26.12.1
  security release. They cover TLS hostname checks, DNS names that hold a NUL
  byte, HTTP connection reuse and the Brotli decoder. If you run Contrack from
  source, use Node.js 26.12.1 or later.

### Changed

- Anthropic: requests use Claude API version 2026-10-21 and send the key in
  the `Authorization` header. A proxy set with `ANTHROPIC_BASE_URL` that reads
  `X-Api-Key` must read `Authorization` instead.

## [2.0.4] - 2026-10-27

### Security

- Single sign-on: the upgrade to 2.0.3 trusted every existing email. Email
  matching now skips an account from open registration, or one that accepted
  an invitation with another address, until a mailed link proves its email.
- Account: a new email needs the current password. With outgoing mail, it
  waits for a link mailed to the new address, and the old address gets a
  notice. Until the link is opened, the account keeps its old email.
- Single sign-on: linking and unlinking need the current password, and with
  outgoing mail the account gets a notice each time.

### Fixed

- Accessibility: filter chips, map facets, Narrow chips, contact rows, Ask
  history rows, Tags page links and the import drop zone have names that hold
  their visible words in order, so voice control reaches them by what they
  show.
- Settings: removing the Google OAuth client or the OpenID Connect provider
  moves focus to the first empty field and clears an old save error, and the
  Single sign-on card follows a provider change at once.
- Single sign-on: a signed-in person whose sign-in did not finish sees a
  message, and the unlink dialog warns about linking again only when it can
  happen.
- Possible duplicates: a decision made within a moment of an Undo keeps its
  own message and Undo, which an old message's removal used to take with it.

## [2.0.3] - 2026-10-27

### Added

- Sign in with an OpenID Connect provider, linked from account settings or,
  when an admin turns it on, matched by verified email (#250). Email matching
  reaches only an account whose own email Contrack trusts: one made at setup,
  by an admin or from an invitation to that address, or one a mailed link
  proved. A password reset also removes the account's linked sign-ins.

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

[unreleased]: https://github.com/arvarik/contrack/compare/v2.0.5...HEAD
[2.0.6]: https://github.com/arvarik/contrack/compare/v2.0.5...v2.0.6
[2.0.5]: https://github.com/arvarik/contrack/compare/v2.0.4...v2.0.5
[2.0.4]: https://github.com/arvarik/contrack/compare/v2.0.3...v2.0.4
[2.0.3]: https://github.com/arvarik/contrack/compare/v2.0.2...v2.0.3
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
