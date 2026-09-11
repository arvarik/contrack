# 15. The 2.0 Story: Features Beyond Tenancy

Multi-user is the foundation of 2.0, not the headline. A major version is a
launch. People read the release notes, and "several people can now share one
instance" is one line. This document lists the features that make 2.0 worth
upgrading to for the person who runs Contrack alone today, ranks them, and
splits them between 2.0 and 2.1.

Four kinds of change live here:

1. **Already folded into the plan** by the review (section 1). Listed so nobody proposes them twice.
2. **Small extras** that a major release is the right moment for (section 2).
3. **Ten headline features** ranked by importance (sections 3 to 6).
4. **Ten performance, accuracy, and stability stories** that make existing features faster, better, and more reliable (section 7).

Rules that apply to everything below:

- A feature lands as its own PR into `v2.0`. Same test and lint bar as a phase. Its own CHANGELOG bullet and its own line in the release notes.
- A 2.0 feature must be additive. It may not change a table the migration touches, and it may not weaken an isolation guarantee. Every new endpoint gets a manifest row and a matrix test.
- Nothing new starts after the Phase 5 security review begins. Whatever is not merged by then ships in 2.1.
- No new runtime dependency unless the feature's row says so.
- Sizes: XS under half a day. S one to two days. M three to five days. L six to ten days.

---

## 1. Already folded into the plan

| Change | Phase |
| ------ | ----- |
| FTS triggers delete by an indexed contact token (`cidTok`) instead of scanning the index | 1 |
| BM25 weight offset fix, as its own PR | 0 |
| `GET /api/contacts/action-items` reachable (router mount order) | 0 |
| `GET /api/query/contacts` excludes trashed and ghost contacts | 2g |
| Request id on rate-limit `429` responses | 0 |
| `Retry-After` header on every `429` | 3 |
| Dedupe and AI Search `429` bodies use the standard error envelope | 2e, 2f |
| Daily maintenance interval for audit log, sessions, tokens, invitations, invocations | 3 |
| One shared frontend response handler for every API module | 4 |
| Admin settings views lazy-loaded | 4 |
| Docs drift fixed (test counts, project count, table count, duplicate section label) | 0, 5 |

---

## 2. Small extras

| # | Extra | Size | Earliest start |
| - | ----- | ---- | -------------- |
| F1 | `Cache-Control: no-store` on auth, admin, stats, and export routes; `private` on uploads | XS | after Phase 3 |
| F2 | Coverage threshold in CI | XS | end of Phase 4 |
| F3 | Instance name setting | S | after Phase 4 |
| F4 | `/healthz` reports schema and sqlite-vec versions | XS | after Phase 1 |
| F5 | Remove the `AUTH_TOKEN` alias | XS | with Phase 3.12 |
| F6 | AI stats feed pagination appends instead of replacing | S | after Phase 4 |

**F1.** A shared instance has shared browsers and proxies. `.agent/STATUS.md`
lists the missing header on the stats endpoints as known issue S-03, and
`express.static` serves uploads with the default `public, max-age=0`. One
small `noStore` middleware on four prefixes, plus a `setHeaders` option on
the static handler. One integration test per prefix.

**F2.** `docs/ci-and-release.md` says coverage is collected but not enforced.
The matrix and manifest tests are the isolation guarantee, and a threshold
stops a future PR from deleting them quietly. Set it two points under the
measured coverage at the end of Phase 4.

**F3.** `SignIn` already notes that an instance name is out of scope. With
invitations, the join page and the sign-in page should say whose Contrack
this is. One `app_settings` key, `instance.name`, 1 to 60 characters,
exposed read-only in `GET /api/auth/status` and editable in the admin
Instance view. Shown on sign-in, join, the sidebar identity menu, and the
browser title.

**F4.** Add `schema: { tenancy, fts }` and `vec` to the health payload so an
operator can confirm the migration ran without opening the database.

**F5.** `AUTH_TOKEN` is the pre-accounts name for `API_TOKEN` and is already
honored only with a startup warning. A major release is the time to drop it.
`API_TOKEN` itself stays deprecated until 3.0.

**F6.** `.agent/STATUS.md` known issue B-02. Phase 2f scopes the feed and
Phase 3.10 adds the admin view, so the file is open twice. The blocker is a
design decision (append or page), not the code.

---

## 3. The 2.0 story

The person Contrack is built for writes notes about people and expects the
software to remember, connect, and nudge. 1.x delivered that for one person
on one machine. 2.0 delivers it for the people around them, and for the AI
agents they already use.

Release-notes headline, as a draft:

> **Contrack 2.0.** Invite your partner, your co-founder, or your team to the
> same instance, each with a private CRM and an admin who cannot read it.
> Connect Claude, Cursor, or any MCP client to your contacts with a personal
> token. Capture a note from your phone's share sheet and let the AI file it.
> Get a nudge on Slack or ntfy when a relationship goes quiet. Ask Contrack to
> draft the message that reconnects you.

Four headline features ship in 2.0 with the multi-user work. Six more follow
in 2.1, each of them built on something 2.0 lays down.

---

## 4. Ten headline features, ranked

Rank is importance to the product. "Ships in" is timing, which also weighs
size and risk against the 2.0 migration. A 2.1 feature can outrank a 2.0 one.

| Rank | Feature | One line | Ships in | Size | Builds on |
| ---- | ------- | -------- | -------- | ---- | --------- |
| 1 | Contrack MCP server | Your CRM as a tool for any AI agent, with a personal token | 2.0 | M | Personal tokens (Phase 3), the existing machine endpoints |
| 2 | Quick Capture | Share anything to Contrack from your phone; the AI files it | 2.0 | M | Magic Paste (`parse-contact`), mention extraction, the PWA manifest |
| 3 | Nudges | Follow-up and quiet-relationship reminders on ntfy, Slack, Discord, or a webhook | 2.0 | S to M | `action_items`, `nextFollowUpAt`, cadence, `user_settings`, the daily interval |
| 4 | Calendar-aware timeline | Subscribe to a calendar feed; meetings become interactions with the right people | 2.1 | L | Interactions, `contact_emails`, the maintenance interval |
| 5 | Reconnect drafts | One click turns "reach out to Maya" into a message in your voice | 2.0 | M | Briefings, the timeline, the capability router |
| 6 | Introductions | Hand a contact to another member of the instance, with provenance | 2.1 | M | Accounts, `contact_sources`, the scoped repository |
| 7 | Voice notes | Speak a note; Contrack transcribes it, extracts the people, logs it | 2.1 | M to L | Attachments, mention extraction, provider transcription |
| 8 | Browser clipper | Save a profile page as a contact from a browser extension | 2.1 | M | Magic Paste, personal tokens |
| 9 | Warm paths | Who in my network can introduce me to this person or company | 2.1 | M | The mention graph, experience and company data, semantic search |
| 10 | Year in relationships | A yearly review page: who you met, who you kept, who you lost touch with | 2.1 | S to M | Interactions, relationship scores, the dashboard |

Effort for the four 2.0 features together: about 12 to 18 engineer-days on
top of the tenancy estimate in the risks document. They can start as soon as
their dependencies land (each entry below names the earliest phase), so much
of that work runs alongside Phases 3 and 4.

---

## 5. Ships in 2.0

### 1. Contrack MCP server

**Pitch.** "Ask Claude who you met at the conference last spring, and have it
log the follow-up." 2.0 already gives every user a personal `ctk_` token and
scopes the machine endpoints to that user. A small MCP server turns those
endpoints into tools that Claude Desktop, Cursor, and any MCP client can
call.

**What it is.** A `packages/contrack-mcp` workspace (or `scripts/mcp/`) that
runs over stdio, reads `CONTRACK_URL` and `CONTRACK_TOKEN`, and exposes
tools: `find_people` (semantic search), `get_person` (profile plus recent
timeline), `log_note` (creates an interaction and lets the server extract
mentions), `add_follow_up`, `catch_me_up` (the existing briefing), and
`list_follow_ups`. Every call goes through the normal HTTP API with the
token, so isolation, rate limits, and audit are inherited. Nothing new
touches the database.

**Why it matters.** The target user already works inside an AI assistant.
The CRM that is reachable from there is the one that gets used.

**Needs.** One new dependency in the package, the MCP SDK. Personal tokens
(Phase 3.6). Earliest start: after Phase 3. Size M.

**Done when.** Claude Desktop with the server configured can find a contact,
log a note that creates a ghost from an @mention, add a follow-up, and get a
briefing, all as the token's user and nobody else.

### 2. Quick Capture

**Pitch.** "Share it to Contrack." A LinkedIn profile, a text message, a
meeting note, a business card photo: from the phone's share sheet or a
keyboard shortcut on the desktop, into a capture inbox where the AI proposes
a contact or an interaction and the user confirms with one tap.

**What it is.** `share_target` in `public/site.webmanifest` (the manifest
exists; it has no share target), a `/capture` route in the SPA, and
`POST /api/capture` that stores raw text or an image under the caller's
scope and runs the existing `parseContactRecord` and mention extraction
asynchronously. The inbox lists captures with a proposed action: new contact,
new interaction for a matched contact, or discard. Accepting creates the
rows through the existing services. Desktop gets `Cmd+Shift+V` (paste to
capture) next to today's `Cmd+Shift+I` quick note.

**Why it matters.** "You write the notes, the AI builds the graph" is the
philosophy. Capture is where the notes come from, and today they come only
from a desktop browser with the app open.

**Needs.** A `captures` table (`id`, `ownerId`, `kind`, `raw`, `fileUrl`,
`status`, `proposal` JSON, `createdAt`), owned and scoped from day one.
Earliest start: after Phase 2a and 2b. Size M.

**Done when.** A shared text from a phone appears in the inbox within a
second, the AI proposal arrives within the provider's latency, and accepting
it creates exactly the rows the user saw in the preview.

### 3. Nudges

**Pitch.** "Contrack tells you before you lose touch." Follow-ups that are
due today, relationships that crossed their cadence, and a birthday this
week, delivered where the user already looks: ntfy, Slack, Discord, or any
webhook. Per user, opt-in, outbound only.

**What it is.** A `notifications` section in account settings backed by
`user_settings` (its first real rows): a destination (ntfy topic URL, Slack
or Discord incoming webhook URL, or a generic URL), a delivery hour, and
toggles for due follow-ups, quiet relationships, and birthdays. A per-owner
job inside the daily maintenance interval (Phase 3.8) builds the digest from
`action_items`, `nextFollowUpAt`, cadence, and `birthday`, and posts one
message per owner. Every URL passes the existing `urlSafety` pinning, the
same way link unfurling does. A "Send test" button.

**Why it matters.** Cadence and follow-ups are the core loop, and today they
only work if the user opens the app. A self-hosted app has no email, so the
push has to go to a channel the user already has.

**Needs.** No new dependency. Earliest start: after Phase 2b for the query,
Phase 3.8 for the interval, Phase 4 for the settings UI. Size S to M.

**Done when.** Two users on one instance receive two different digests at
their chosen hours, a user with nothing due receives nothing, and a wrong
URL fails safely with a visible error in settings.

### 5. Reconnect drafts

**Pitch.** "You should reach out to Maya" becomes "Here is what to say." From
the Pulse at-risk list or a contact page, one click drafts a short message
grounded in the last interactions, the person's context, and how long it has
been, in the user's own tone.

**What it is.** A new capability, `reconnectDraft`, in the capability router,
so it can be assigned to any configured provider. `POST /api/contacts/:id/reconnect`
returns three variants (short, warm, professional) as text. The prompt reuses
the briefing context builder. The UI shows the drafts in a `Modal` with copy
buttons and a "Log that I reached out" action that creates an interaction.
Tone learning is a later step; 2.0 uses a fixed style guide plus the user's
display name.

**Why it matters.** The gap between knowing you should reconnect and doing
it is the whole problem. Removing the blank page is the highest-leverage AI
feature the product does not have.

**Needs.** No new dependency. Earliest start: after Phase 2b and 2f (cache
keys per owner). Size M.

**Done when.** The draft names a real recent interaction, respects the
provider assignment, is cached per owner, and never appears for another
owner's contact.

---

## 6. Ships in 2.1

### 4. Calendar-aware timeline

**Pitch.** Subscribe to a calendar feed and meetings appear on the right
people's timelines, before and after they happen.

**What it is.** A per-user ICS subscription URL (or upload) polled by the
maintenance interval, parsing events with attendees, matching attendee
emails to `contact_emails`, and proposing interactions of type "meeting".
Unmatched attendees can become ghosts on confirmation. Pre-meeting, the
dashboard shows "Today you meet Maya and Jon" with their briefings.

**Needs.** An ICS parser dependency. Earliest start: after 2.0 ships. Size
L, mostly matching rules and duplicate handling with recurring events.

### 6. Introductions

**Pitch.** "Send Maya to Jon." One member hands a contact to another member
on the same instance. The receiver gets a copy in their own CRM, with a
`contact_sources` row that says who introduced it and when. No live sharing,
no cross-owner reads, no change to isolation.

**What it is.** `POST /api/contacts/:id/introduce` with a target username
creates a pending introduction; the receiver accepts from an inbox and the
service copies the contact and its child rows under the receiver's scope.
The sender never sees what the receiver does with it.

**Needs.** An `introductions` table. Earliest start: after 2.0. Size M. This
is the first step toward workspaces in the future-work document without
building them.

### 7. Voice notes

**Pitch.** Talk after the meeting. Contrack writes the note, finds the
people, and logs it.

**What it is.** Audio attachments (`.m4a`, `.webm`, `.mp3`) on the quick note
and on Quick Capture, transcribed through a configured provider that
supports audio (OpenAI and Gemini adapters exist), then run through the
same mention extraction as typed notes. The audio file is stored under the
owner's uploads directory; the transcript is the interaction content.

**Needs.** A `transcribe` capability in the router. Earliest start: after
2.0 and Quick Capture. Size M to L. Local transcription is out of scope
until a small model is practical in the runtime.

### 8. Browser clipper

**Pitch.** Save a person from any page in one click.

**What it is.** A minimal WebExtension (Chrome and Firefox) that sends the
page's selected text or main content to `POST /api/capture` with a personal
token. Everything else is Quick Capture.

**Needs.** A separate `packages/clipper` with its own build. Earliest start:
after Quick Capture. Size M.

### 9. Warm paths

**Pitch.** "Who can introduce me to Acme?" Contrack answers from your own
notes.

**What it is.** A query over the mention graph, shared employers in
`contact_experience`, and semantic similarity, ranked by relationship score,
producing "You know Jon, who worked at Acme until 2024 and mentioned Priya
twice." Surfaced in search and on company pages.

**Needs.** No new dependency. Earliest start: after 2.0. Size M.

### 10. Year in relationships

**Pitch.** A page each January: people met, the strongest bonds, the ones
that went quiet, the notes that mattered.

**What it is.** A read-only view over interactions, relationship scores, and
`addedAt`, per owner, with an optional AI summary through the existing
insight capability, and an export as an image.

**Needs.** No new dependency. Earliest start: after 2.0. Size S to M.

---

## 7. Ten performance, accuracy, and stability stories

These do not add a feature. They make an existing one faster, make it
produce better results, or make it fail less. Each is grounded in a specific
place in the `v1.5.5` code. Rank is importance; "Ships in" also weighs size
and risk. Nine ship in 2.0, one in 2.1.

| Rank | Story | Kind | Ships in | Size | Today |
| ---- | ----- | ---- | -------- | ---- | ----- |
| 1 | CPU-bound work off the main thread | Performance, Stability | 2.0 | L | Local embeddings and dedupe passes run on the event loop |
| 2 | Search quality gate | Accuracy | 2.0 | S to M | No eval set; ranking changes are unmeasured |
| 3 | One scan after a bulk import | Performance | 2.0 | S | One incremental check per imported contact |
| 4 | Filters inside the vector index | Accuracy, Performance | 2.0 | M | Global top 500, then a JavaScript filter |
| 5 | Verified backups | Stability | 2.0 | S | Snapshot written, never opened |
| 6 | WAL checkpoint and write health | Stability | 2.0 | S | No checkpoint call anywhere |
| 7 | Fuzzy mention resolution | Accuracy | 2.0 | M | Exact match on `contacts.name` |
| 8 | Dedupe precision and recall gate | Accuracy | 2.0 | M | Unit tests per matcher, no pair-level gate |
| 9 | Admin health panel | Stability | 2.0 | S | Health is `SELECT 1` |
| 10 | Incremental relationship scoring | Performance | 2.1 | S to M | Hourly full recompute of every contact |

Effort for the five 2.0 stories together: about 6 to 10 engineer-days. They
touch files the phases already open, so most of them ride along with the
relevant sub-phase PR or land right after it.

### Ships in 2.0

**2. Search quality gate.** Phase 0 changes the BM25 weights and Phase 2c
rewrites every search statement. Without a measure, "better" is a guess. Add
`tests/eval/search.eval.test.ts` with a fixed fixture of about 300 contacts
and 50 golden queries (name typos, company plus role, location plus
interest, a nickname, a phrase from a note), each with the expected top
results. Assert recall at 10 and mean reciprocal rank against a committed
baseline, with a small tolerance. FTS runs for real; the vector channel uses
a recorded embedding fixture so the test is deterministic and needs no
model. The baseline is re-recorded on purpose, with the diff in the PR, when
a ranking change is intended. Earliest start: Phase 0, before the BM25 PR.
Fits the "ML / AI Evaluation Thresholds" section that `.agent/TESTING.md`
already has.

**3. One scan after a bulk import.** The non-stream import path
(`server/routes/contacts.ts:530-549`) waits 3 s and then runs
`incrementalDedupeCheck` once per created contact, with concurrency 1. Each
check normalizes the whole corpus (`dedupe/engine.ts:309`), so an import of
`n` contacts into a corpus of `m` does about `n × m` work. Replace the loop
with one scoped scan restricted to the new ids as the left side of every
pair (`runScan(scope, "incremental-set", ids)`), which normalizes the corpus
once. Same result, one pass. Earliest start: with Phase 2e.

**5. Verified backups.** `runBackup` (`server/services/backupService.ts:75`)
writes the snapshot with the online backup API and rotates. Nothing opens
the file again. After each snapshot: open it read-only, run
`PRAGMA quick_check`, compare the row counts of the eight owned tables and
`users` with the live database, and record `{ ok, checkedAt, rows }` next to
the file (a sidecar JSON, or a row in `app_settings`). The admin Backups view
shows a verified badge per snapshot. Boot logs a warning when the newest
verified snapshot is older than two intervals. Earliest start: with Phase 3
(the backups routes go admin there) and Phase 4 (the view).

**6. WAL checkpoint and write health.** The database runs in WAL mode with
`busy_timeout = 5000` and no checkpoint call anywhere in `server/` or
`server.ts`. SQLite auto-checkpoints at 1,000 pages, but a long reader (a
dedupe scan, an export) can hold the WAL open and let it grow. With more
writers this matters. In the daily maintenance interval (Phase 3.8): read
the WAL file size, run `PRAGMA wal_checkpoint(PASSIVE)`, and run
`wal_checkpoint(TRUNCATE)` when the file exceeds 64 MB and no scan is
running. Count `SQLITE_BUSY` errors in the error handler and expose both
numbers on the admin health panel. Earliest start: with Phase 3.8.

**9. Admin health panel.** `/healthz` answers `SELECT 1`. An admin needs more
when several people depend on one instance. `GET /api/admin/health` returns:
schema versions (extra F4), database and WAL sizes, last backup and its
verification, the dedupe and AI Search queue states (running owner, pending
owners), embedding backfill progress per owner, `aiCache` hit rates (already
computed for the stats page), provider circuit state, and uptime. One card
grid under Administration. No secrets. Earliest start: after Phase 3;
the view with Phase 4.

### Also shipped in 2.0

Four of these five were taken after the six small extras landed. Each
paragraph below is as it was written against `v1.5.5`; what was actually
found and done is in the decision record.

**1. CPU-bound work off the main thread.** The Transformers.js embedding
pipeline (`server/services/search/localEmbeddings.ts:42-44`) and the dedupe
passes run in the request process. A 2,000-contact embedding backfill or a
deep scan for one owner stalls every other owner's requests for its
duration. `recomputeAll` already yields between batches; the embedding and
scan loops do not have the same escape. Move both to a `worker_threads`
worker with a small job protocol (start, progress, cancel, result). The
worker opens its own read connection for scans and returns rows for the main
thread to write, so the single-writer rule holds. The global run lock
becomes the worker queue, and the per-owner FIFO from Phase 2e stays. This
is the biggest multi-user performance risk in the product and the largest
item here, which is why it is 2.1 and not 2.0.

**4. Filters inside the vector index.** `findSearchNeighbors`
(`localEmbeddings.ts:236-252`) takes the global top `min(k, 500)` and then
drops rows that fail the hard filter in JavaScript. Phase 1 scopes the scan
to one owner's partition, which fixes the cross-owner half of the problem.
The other half remains: a query with a hard filter that matches few contacts
can return nothing because none of them made the top 500. sqlite-vec
supports metadata columns that filter inside the KNN. Add `isGhost`,
`isArchived`, and `active` (`deletedAt IS NULL`) as metadata columns to both
`vec0` tables and push those predicates into the `MATCH` query. The
copy-rebuild from Phase 1 makes the schema change cheap (0.9 s per 50,000
rows measured). Id-list filters (a specific list, a tag) stay in JavaScript
but run over a much smaller candidate set.

**7. Fuzzy mention resolution.** `runMentionExtraction`
(`server/services/interactionService.ts:58-66`) resolves a mentioned name
with `eq(contacts.name, m.name)`. "Jon" does not find "Jonathan Smith",
"Maria García" does not find "Maria Garcia", and each miss creates a ghost.
The dedupe engine already has nickname tables, phonetic hashes, and a name
normalizer under `server/utils/nlp/`. Use them: resolve within the owner's
contacts by normalized name, then nickname, then phonetic hash, with the
company or a co-mentioned person as a tiebreaker. Above a confidence
threshold, link. Below it, create a "possible mention" suggestion instead of
a ghost, reviewed in the same queue as dedupe suggestions. Fewer wrong
ghosts and more real links, which also improves the mention graph that the
dashboard and warm paths read.

**8. Dedupe precision and recall gate.** `tests/unit/nlp.*.test.ts` cover the
matchers one at a time. Nothing measures the engine end to end. Build a
labeled fixture of about 300 contact pairs (true duplicates with typos,
nicknames, and moved companies; near-misses such as father and son at the
same firm; clear negatives) and run the deterministic passes over it in CI,
asserting precision and recall per pass against a committed baseline. The
fixture doubles as the regression suite for the 2.1 mention work and for
any threshold preset change.

### Ships in 2.1

**10. Incremental relationship scoring.** `recomputeAll`
(`server/services/relationshipService.ts:289-336`) scores every non-ghost,
non-archived contact every hour (`server.ts:210-217`), in batches of 200. On
a 50,000-contact instance that is a lot of work to change nothing. Keep a
`scoreDirty` flag (or a `lastScoredAt` compared with `updatedAt` and the
newest interaction) and recompute only dirty contacts hourly, with one full
pass nightly to catch time decay. The dashboard reads the same column, so
nothing else changes.

---

## 8. Not planned for 2.x

Kept short. Each is tracked in [11-future.md](11-future.md).

- Reverse-proxy header authentication and OIDC.
- Passkeys and two-factor.
- Per-user AI keys and budgets.
- Moving all DDL into Drizzle migrations.
- User quotas.
- A Docker default of `AUTH_REQUIRED=true`. With the local owner account, auth-off is a proper single-user mode, and the non-loopback warning stays.

---

## 9. Decision record

Fill in as decisions are made, so the release PR can list what shipped.

| # | Item | Decision | Date |
| - | ---- | -------- | ---- |
| F1 | No-store cache headers | Accepted. Shipped in [#44](https://github.com/arvarik/contrack/pull/44). | 2026-09-11 |
| F2 | Coverage threshold | Accepted. Shipped in [#44](https://github.com/arvarik/contrack/pull/44). | 2026-09-11 |
| F3 | Instance name | Accepted. Shipped in [#44](https://github.com/arvarik/contrack/pull/44). | 2026-09-11 |
| F4 | Health schema versions | Accepted. Shipped in [#44](https://github.com/arvarik/contrack/pull/44). The versions are on `/healthz` as the paragraph specifies, and also on `GET /api/admin/health` where S9 put them. `/healthz` carries version numbers and nothing else: no counts, no configuration, no accounts. | 2026-09-11 |
| F5 | Remove `AUTH_TOKEN` | Accepted. Shipped in [#44](https://github.com/arvarik/contrack/pull/44). | 2026-09-11 |
| F6 | Feed pagination | Accepted. The design decision was append. Shipped in [#44](https://github.com/arvarik/contrack/pull/44). | 2026-09-11 |
| 1 | Contrack MCP server | Not accepted for 2.0. Moves to 2.1. | 2026-09-10 |
| 2 | Quick Capture | Not accepted for 2.0. Moves to 2.1. | 2026-09-10 |
| 3 | Nudges | Not accepted for 2.0. Moves to 2.1. | 2026-09-10 |
| 5 | Reconnect drafts | Not accepted for 2.0. Moves to 2.1. | 2026-09-10 |
| S2 | Search quality gate | Accepted. Shipped in [#39](https://github.com/arvarik/contrack/pull/39). | 2026-09-10 |
| S3 | One scan after a bulk import | Accepted. Shipped in [#40](https://github.com/arvarik/contrack/pull/40). | 2026-09-10 |
| S5 | Verified backups | Accepted. Shipped in [#41](https://github.com/arvarik/contrack/pull/41). | 2026-09-10 |
| S6 | WAL checkpoint and write health | Accepted. Shipped in [#42](https://github.com/arvarik/contrack/pull/42). | 2026-09-10 |
| S9 | Admin health panel | Accepted. Shipped in [#43](https://github.com/arvarik/contrack/pull/43). | 2026-09-10 |
| S1 | CPU-bound work off the main thread | Accepted. Shipped in [#45](https://github.com/arvarik/contrack/pull/45). The embedding model moved to a `worker_threads` worker as the paragraph asks: a 2,000-contact backfill blocked the event loop for 2.19 s of its 2.4 s and now blocks for 0.03 s, worst single stall 83 ms to 7 ms. Three deviations, all from measuring first. The query path went to the worker too, which the paragraph does not ask for: 0.44 ms against 0.39 ms in process, and it keeps one copy of the model in memory rather than two. The worker is given data rather than its own read connection; the guarantee the paragraph states for that connection is "the main thread writes", and a worker with nothing to write with holds it more simply. And the dedupe passes were **not** moved. A second worker job for them was written and measured and removed: almost none of their cost was CPU. The deterministic pass joined `LOWER(TRIM(name))` to itself, which no index can answer, so it took 42.9 s on 10,000 contacts to find nothing; the funnel asked the vector store for a similarity per candidate even with no vector store, 30,000 failing queries per scan; and `normalizeCompany` compiled thirty-three regular expressions on every call. Fixed in place, those passes cost 34 ms at 10,000 contacts and about 500 ms at 50,000, against roughly 180 ms to ship the corpus across the boundary. The work was better removed than moved. | 2026-09-11 |
| S4 | Filters inside the vector index | Accepted. Shipped in [#45](https://github.com/arvarik/contrack/pull/45). The paragraph's premise is out of date and the item is worth doing anyway. It describes `findSearchNeighbors` taking the global top 500 and filtering in JavaScript, which is what `v1.5.5` did; Phase 2c had already pushed both the active predicate and the id list into the `MATCH`, and sqlite-vec applies those inside the scan, so a hard filter matching few contacts already returned them. Measured on 50,000 contacts: k=10 with twelve nearer hidden rows returns the one visible row, and no ghost or archived contact leaks. What remained was the cost. The subquery made SQLite list every active contact in the account on every search — `EXPLAIN QUERY PLAN` showed `LIST SUBQUERY` / `SCAN c` — at 43.68 ms per query on 50,000 contacts, 8.16 ms on 10,000 and 0.83 ms on 1,000. With the three states as metadata columns it is 1.48, 0.36 and 0.10 ms, for the same fifty contacts in the same order. A trigger keeps the columns equal to the contact row, narrowed so the hourly score recompute pays 2.9 ms per 5,000 rows against 2.6 ms with no trigger at all. | 2026-09-11 |
| S7 | Fuzzy mention resolution | Accepted. Shipped in [#45](https://github.com/arvarik/contrack/pull/45). Tiers, tiebreakers and the three outcomes are as the paragraph describes. One deviation: it says "create a possible mention suggestion **instead of** a ghost", and the ghost is still created. A mention has to point at a contact or the timeline cannot render it, and `dedupe_suggestions` holds a pair of contact ids, so the suggestion pairs the ghost with the candidate and accepting it merges the ghost away. That is the same review queue the paragraph asks for. Two defects found on the way: the shared name tokenizer treated every accent as punctuation, so "María García" tokenized to four fragments with a surname of "a"; and `computePrimaryScore` had no ghost term, so a bare real contact and a ghost both scored 5 and the survivor of a merge came down to which id sorted first — which a mention suggestion makes the common case rather than the edge. | 2026-09-11 |
| S8 | Dedupe precision and recall gate | Accepted. Shipped in [#45](https://github.com/arvarik/contrack/pull/45). 745 contacts and 332 labelled pairs: 221 duplicates across twelve kinds and 111 hard negatives across seven. It found four defects in its own corpus while it was written and named the diacritic improvement in S7 on its own. It also reports something nobody had measured: on this deliberately adversarial corpus, with AI off, a scan produces 58 pairs at or above the auto-merge threshold that are two different people — every father and son, every couple on one landline, every pair on a team alias. Not fixed here. The paragraph asks for the measurement, and changing a threshold is the next change rather than part of this one. | 2026-09-11 |

The five accepted stories land in the order this table lists them, one pull
request each, from `v2.0-extra-<slug>`. The rules at the top of this document
say `v2.0/<slug>`, which git cannot create while a branch called `v2.0`
exists: a ref is a file, and `refs/heads/v2.0/extra-s2` needs `v2.0` to be a
directory. Every phase branch has used the same substitution.

The six small extras were accepted on 2026-09-11, after the quality stories
landed, and went in as one pull request rather than six: every one of them is
XS or S, they touch no common code, and six pull requests of a dozen lines
each is process for its own sake.

Four of the five 2.1 stories were accepted on 2026-09-11 and went in as one
pull request, in the order S8, S4, S7, S1. S8 first on purpose: it is the
measurement the other three lean on, and it is what showed that S7's tokenizer
change improved matching rather than moved it, and that S1's rewrite of the
deterministic pass changed nothing at all.

The table rows above record where the work differed from the paragraph. Three
of the four differ, and in each case because something was measured before it
was built: S4's stated accuracy problem had already been fixed by Phase 2c and
its performance problem had not, and S1's dedupe half turned out to be two
quadratic joins rather than CPU-bound work.

Nothing else was accepted. The four headline features are not rejected on
their merits, and neither is S10. They were not taken for 2.0, so the fourth
rule at the top of this document applies to them: whatever is not merged when
the Phase 5 security review begins ships in 2.1.
