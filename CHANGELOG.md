# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The process now survives `docker stop`.** SIGTERM/SIGINT drain in-flight
  requests, close SQLite with its WAL checkpoint, and exit 0 — previously the
  process rode Docker's grace period into a SIGKILL on every stop, closing the
  database uncleanly each time. An 8-second internal deadline keeps a hung
  handler from reaching the SIGKILL anyway.
- **`/healthz` and a Docker HEALTHCHECK.** The probe lives outside the auth
  gate (a health check holds no credential), proves both the event loop and
  SQLite answer, and reports nothing else. Docker can now see a process that
  is alive but wedged; `restart: unless-stopped` only ever noticed dead ones.
- Boot failures exit non-zero with a log line naming startup;
  `unhandledRejection` logs with the stack instead of crashing bare;
  `uncaughtException` closes the database before exiting.

### Fixed

- **A DNS-rebinding hole in the outbound fetch guard.** The SSRF check
  resolved a hostname, validated the address, and then `fetch()` resolved the
  same name again to dial — two queries a hostile DNS server answers
  differently, passing the check with a public address and serving the
  connect `127.0.0.1`. Validation now runs inside the resolver the socket
  actually uses, checks every address in the answer, and fails closed on a
  public/private mix.
- **Every route accepted a 50 MB body**, unauthenticated ones included — a
  limit sized for bulk import, inherited globally. The default is now 1 MB
  with the import route exempt, and an over-limit body answers a clean
  `413 PAYLOAD_TOO_LARGE` instead of a stack-logging 500.
- The SPA fallback answered every HTTP method with `index.html` — a POST to a
  mistyped path returned 200, which reads as success to a script. Navigation
  is GET/HEAD; everything else now 404s.
- Node's 5-second keep-alive default sat below every reverse proxy's reuse
  window, surfacing as sporadic 502s. Now 65 seconds.

### Changed

- Every response carries `X-Content-Type-Options: nosniff` (previously
  `/uploads` only), `X-Frame-Options: DENY`, and a referrer policy. Production
  adds a CSP with `script-src 'self'` — the built `index.html` has no inline
  script, which is what makes the strict policy possible.

## [1.5.3] — 2026-08-09

A self-hosted release. The headline fix is that a local model server connected
through Settings → AI now actually answers requests; the rest is a sweep of
readability and clarity work across the UI, and the end of a long-running test
flake.

### Fixed

- **A custom OpenAI-compatible endpoint failed every AI request while
  appearing correctly connected.** Adding an Ollama, vLLM, or LM Studio server
  and leaving the capabilities on **Automatic** — which is what you get by
  adding an endpoint and changing nothing else — resolved to the endpoint but
  named no model, and the compat adapter refuses to be called without one. The
  result was `a model must be selected for OpenAI-compatible endpoints` on
  every Magic Paste, mention, or summary, from a settings page reporting the
  endpoint as connected.

  The three built-in providers map a capability onto a model themselves, so
  Automatic passes them no model on purpose. A compat endpoint has no such map,
  so Automatic now names one: the first chat model in the catalog discovered
  from the endpoint. Quick and Deep get the same model, because nothing in the
  OpenAI-compatible model list says which of yours is the cheaper one and
  guessing from model names would be a judgement the user cannot see — pin them
  separately if you run both a small and a large model.

  When discovery found no chat model there is nothing to call, so Automatic now
  skips the endpoint and the capability reports itself unavailable naming the
  endpoint and the fix, instead of failing later with a message about model
  ids.

- **Settings → AI listed every custom endpoint twice**, and the second copy
  carried a "remove" button that removed nothing: it deleted from the
  provider-key store, where an endpoint has no entry, then reported success.
  Endpoints now appear once, in their own section, which is also where their
  discovered model count, discovery errors, and a refresh button now live.

- **A capability pinned to a deleted provider kept pointing at it.** Quick,
  Deep, and Research fall back to Automatic with a warning, but Embeddings
  resolved straight to the dead provider and every embed threw — semantic
  search and duplicate detection stopped working with nothing in the UI to
  explain why, because the pin still looked valid. Removing a provider or an
  endpoint now returns anything pinned to it to Automatic.

- Saving a provider key or an endpoint that then fails its connectivity check
  left the settings list stale. The credential is stored before it is
  validated — deliberately, so a typo does not cost you the key you just typed
  — so the failed save had still changed the page.

- **The duplicate badge counted the wrong thing.** It read pending _pairs_
  while the review queue groups pairs into clusters, because (A,B) and (B,C)
  are one problem with three people rather than two problems. The badge
  promised 7 and the page showed 3.

- The bulk selection toolbar was 80% transparent, so the contact list showed
  through the controls that archive and delete in bulk. The map opened centred
  on longitude 0, putting the Atlantic in the middle, and left empty background
  above and below the world on a tall window. The AI usage feed's separators
  referenced a colour token that did not exist, so Tailwind dropped the class
  and they rendered in near-black.

- An un-researched contact's Dossier tab was blank — every section in it is
  conditional. It now says what a dossier holds and links to Contact
  Enrichment.

- Five of the fourteen AI cache tiers and operations had no display name, so
  the tier table and activity feed printed raw keys like `queryParse` beside
  properly named rows. All fourteen now have a name and an explanation of what
  the tier caches.

- Startup logged both vector stores at their creation width — 768 for
  `contact_embeddings`, 384 for `search_embeddings` — regardless of what they
  actually held. Those literals only apply to a fresh database; choosing a different
  embeddings model rebuilds the tables at that model's width. Vector width is
  the first thing you check when embeddings misbehave, so a hardcoded number
  there is worse than no number. Both lines now read the width back from the
  table.

- **CI's image-architecture check could only ever fail.** It grepped the raw
  manifest for `"architecture":"amd64"`, but current buildx pretty-prints
  `--raw`, so the compact-JSON pattern never matched and `merge-image` reported
  a missing platform on every push while publishing a perfectly good
  two-architecture image. Parsed with `jq` now, filtered to `os == "linux"` so
  the per-platform provenance attestations are not counted as platforms.

- **The integration suite's long-running flake is fixed at the source.**
  `request(app)` makes supertest bind a fresh HTTP server and tear it down for
  every single request — roughly 500 listen/close cycles a run. Ephemeral ports
  recycle faster than closed sockets leave `TIME_WAIT`, so a new server
  occasionally inherited a port a previous connection was still addressing and
  a request was answered by the wrong socket. The symptom was a status the
  route cannot produce: a 404 from a registered path, a 403 from a router with
  no 403 in it, a 401 on an un-gated instance — each one an invitation to audit
  auth code that was never involved.

  Each test file now listens once and every request goes to that server, which
  removes the recycling. Measured at roughly one failed run in six before, and
  none in thirty after; the `retry: 2` that had been absorbing it is gone, so
  the suite reports instability instead of hiding it.

### Added

- **The health score explains itself.** Clicking the badge on the Pulse
  at-risk list breaks the number into its five signals with the measurement
  behind each — "last contact 200 days ago, against a 90-day cadence" rather
  than "42". A score attached to a person is a judgement, and one you cannot
  interrogate is one you either over-trust or ignore.
- **Settings has a filter.** Five groups and a dozen destinations is past where
  scanning beats typing. Items match synonyms too, so "logout" finds Account
  and "bin" finds Trash.
- **Shift-click selects a range and Cmd/Ctrl+A selects everything visible.**
  Ranges add rather than toggle — shift-clicking across selected rows and
  having them flip off is never what "select from here to there" means. The
  shortcut is ignored while focus is in a field.
- **Session lifetime is configurable** (1 day to 1 year, presets in Settings →
  Account) rather than fixed at 30 days. It applies to new sign-ins only, which
  the card says out loud, because someone shortening it to lock out a lost
  device would otherwise believe they had.
- A tooltip on every AI cache tier explaining what it caches and what a hit
  saved. It opens on click as well as hover, because neither hover nor the
  `title` attribute exists on a phone.
- An end-to-end test suite for compat endpoints, running against a stub server
  that speaks the OpenAI wire format. It covers the case the bug above lived
  in — an install whose only provider is a custom endpoint, with everything on
  Automatic — through the real adapter, real base-URL handling, and real model
  discovery.

### Changed

- Duplicates now leads the Organize group, ahead of Lists. It is the one
  destination there with work queued behind it, and a queue nobody sees is a
  queue nobody clears.
- Sign-out lives only on Settings → Account. Two doors to the same action is
  one more than it needs.
- The empty Network view leads with Import rather than "Add contact". Nobody
  builds a personal CRM by typing four hundred people in by hand.
- The first-run setup screen names how many contacts are waiting and states
  they will be assigned to the account being created; the sign-in screen now
  distinguishes an expired session from an ordinary visit.
- The active letter on the alphabet rail is marked on the rail itself. The
  floating marker it replaces covered contact names.

## [1.5.2] — 2026-08-07

### Added

- **Accounts replace the access token.** A gated instance now shows a one-time
  setup screen that creates your account (email + username + password), then a
  real sign-in screen. Sessions are server-side rows lasting 30 days, so
  signing out actually ends the session and "sign out other devices" works.
  Settings → Account holds your profile, password, and the list of devices
  you're signed in on; the sidebar gets a sign-out button.

  Passwords use scrypt (N=2^16, r=8, p=1) from `node:crypto` — no new native
  dependency. Cost parameters are stored inside each hash, so raising them
  later upgrades passwords silently on next sign-in. The session cookie holds a
  random secret and the database stores only its SHA-256, so neither the
  database nor one of the rotating backups yields a live session.

  Existing data is not disturbed: everything already in the database is
  assigned to the account you create. There is no reset email — this is
  self-hosted with no mail server — so
  [Configuration](docs/configuration.md#authentication--remote-access)
  documents the recovery procedure.

- **`ownerId` on `contacts`, `lists`, `ai_invocations` and `dedupe_merge_log`**
  — every table not reachable from `contacts` through a foreign key. Nothing
  filters on it yet; it exists so that adding multi-tenancy later is "scope the
  queries" rather than "scope the queries AND migrate live data". `NULL` means
  "belongs to whoever owns this instance", which is every row until an account
  exists. `ON DELETE RESTRICT`, so a stray `DELETE FROM users` fails loudly
  instead of taking the contacts with it.

- **Provider contract tests** (`npm run test:contract`) — a suite that calls
  real provider APIs to verify the things a mocked test cannot: that
  `listModels` speaks the shape we parse, that structured output returns
  parseable JSON, and that `embed` returns one vector per input. Both provider
  bugs found in 1.4.0 were wire-format mismatches invisible to mocked tests, and
  one of them had a green unit test asserting the wrong shape.

  Not part of CI and not required for development. Each provider block skips
  itself when its credential is absent, so `npm test` remains key-free and
  contributors with a single key exercise only that provider.

### Changed

- **`AUTH_TOKEN` is now `API_TOKEN`**, and means something narrower: the
  credential for scripts, cron jobs and MCP clients, sent as
  `Authorization: Bearer`. People sign in with an account instead. The old name
  still works with a deprecation warning at startup. `AUTH_REQUIRED` keeps its
  name and its `false` default, in Docker as well as locally — the server warns
  at startup when it binds a non-loopback address with auth off.

- Settings → AI now says _why_ a capability is unavailable and what to do about
  it, instead of "nothing available". A self-hosted setup is told that research
  runs through SearXNG — which is accurate, since enrichment works through
  SearXNG even though no provider resolves for the capability.
- Pinning an embeddings model now probes it first and refuses the assignment if
  the provider cannot actually produce a vector. Compat servers advertise bare
  model ids, so embedding capability is guessed from the name; a model that
  looks right on a server without `/v1/embeddings` previously saved a pin that
  silently left the vector store on the old model.

### Fixed

- **Settings → AI reported embeddings as unavailable when it was working.** The
  view resolved every capability except embeddings, so the Auto row rendered an
  amber "nothing available" against a capability served correctly by the
  built-in local model. It now reads "Built-in local model · 384-dim".
- **OpenAI structured output was rejected outright.** The adapter sent
  `strict: true`, which requires `required` to list every key in `properties` —
  but Contrack's schemas have genuinely optional fields (a contact has a name;
  it may not have a company). Every schema-constrained OpenAI call failed with
  `400 Invalid schema for response_format`. As with the Anthropic bug, a unit
  test asserted the broken shape and stayed green. Found by the contract suite
  on its first run against a working key.
- **Changing the embeddings model left the dedupe index at the old width.** The
  settings route rebuilt only the search store, so `contact_embeddings` stayed
  at 384 while new vectors were 1536 and every insert failed with
  `Expected 384 dimensions but received 1536` until the process restarted. Both
  stores now rebuild together, with an integration test asserting they stay the
  same width.
- Contract tests no longer fail on a credential the provider rejects. A stale
  `OPENAI_API_KEY` exported globally for an unrelated tool — common on a
  developer machine — turned the suite red for someone who never meant to test
  that provider. Credentials are probed once up front: rejected ones skip with
  the reason, and only a real adapter fault fails.
- The integration suite no longer makes outbound network calls. Two tests
  stored a key for a built-in provider, which reached the real vendor to
  validate it — the only flaky tests in the suite. They now use a custom
  endpoint pointed at a closed port, which fails immediately and
  deterministically; real provider behaviour is covered by the contract suite.

## [1.4.0] — 2026-08-05

Contrack no longer asks you to pick "an AI provider". You connect whichever
services you have keys for, and each kind of work is routed to a suitable
model. One API key is still all you need — everything else is optional.

### Added

- **Capability-based AI configuration.** Four independent settings — Quick
  tasks, Deep tasks, Embeddings, and Web research — each resolved from
  Settings → AI, an environment variable, or automatically. Providers are no
  longer mutually exclusive; connect several and mix them across tasks.
- **Model discovery.** Saving an API key queries the provider's list-models
  endpoint, which validates the credential and fills the model dropdowns, so
  new releases appear without a Contrack update. Cached 24h, refreshable on
  demand, and populated in the background at startup. Gemini and Anthropic
  report capabilities directly; OpenAI-shaped servers are inferred from the
  model name and marked as guessed.
- **Custom OpenAI-compatible endpoints.** One adapter for Ollama, vLLM, LM
  Studio, llama.cpp, OpenRouter, xAI, DeepSeek, and Mistral — configured with
  a base URL and optional key. Structured output is negotiated per model
  (`json_schema` → `json_object` → prompt) and the working mode is remembered.
- **Self-hosted web research via SearXNG.** Point Contrack at a SearXNG
  instance to enrich contacts from the live web with no cloud provider. With a
  local chat model and the built-in embeddings, the entire AI stack can run on
  your own hardware.
- **Per-task model overrides:** `AI_QUICK_MODEL`, `AI_DEEP_MODEL`,
  `AI_RESEARCH_MODEL`, and `AI_EMBEDDINGS_MODEL`, each accepting `model` or
  `provider:model`. Intended for declarative deployments; a pin made in
  Settings takes precedence.

### Changed

- **`.env.example` rewritten in tiers** — one key at the top, everything else
  optional and commented out. Previously it framed keys as conditional on
  `AI_PROVIDER`, implying you had to choose a provider before anything worked.
- **`AI_PROVIDER` is now only the Auto preference.** It selects which provider
  Auto favours when several keys are present, and does nothing with one key.
  Existing deployments are unaffected.
- **Settings → AI collapses to a single line** ("All tasks → provider, chosen
  automatically") with per-task controls behind a disclosure that opens
  automatically when anything is pinned.
- **Duplicate-detection embeddings now follow the Embeddings setting**, and
  default to the built-in local model. They previously called Gemini directly
  regardless of the setting, so choosing a local model still sent every
  contact to Google.
- Magic Paste output is now sanitized before it reaches a contact record —
  length caps, control-character stripping, injection-echo rejection, and URL
  validation.

### Fixed

Two of these affect data written by v1.3.0. If you ran that version, the
indexes below repair themselves automatically on first start.

- **Gemini embeddings returned one vector per batch instead of one per
  contact.** `contents: string[]` reads as a single Content with many parts,
  so each batch collapsed into one vector and the rest were silently dropped.
  Switching the Embeddings setting to a Gemini model left the semantic index
  almost entirely empty while reporting success.
- **Duplicate-detection embeddings had the same defect**, plus a backfill that
  only ran when the store was completely empty — so a partial index could
  never repair itself. On a 431-contact database it held 5 rows. Duplicate
  matching has been running without the semantic signal it was designed
  around. Restoring it raises match scores but crossed no auto-merge
  thresholds in testing (0 of 381 candidate pairs).
- **Anthropic structured output was broken entirely.** `output_config.format`
  takes the schema directly, but Contrack sent OpenAI's nested `json_schema`
  wrapper, so every JSON operation on Anthropic failed with a 400. Only
  text-only calls worked. Claude also caps schemas at 24 optional parameters,
  which the research schema exceeds; that case now falls back to
  prompt-guided JSON instead of failing.
- A provider returning fewer embeddings than inputs is now a hard error rather
  than a silently short batch, and the backfill refuses to write a partial
  index.
- OpenAI-compatible backends that return `200 OK` with a non-JSON body now
  trigger the structured-output downgrade, not just those that reject the
  format outright.
- Reasoning models (gemma-4, QwQ, DeepSeek-R1) that spend their whole token
  budget on `reasoning_content` now report that explicitly instead of
  surfacing as "malformed JSON".
- `data/` is excluded from version control — it holds the auth token,
  uploads, and backups.
- **Container images are now published for `linux/arm64` as well as
  `linux/amd64`.** Previous releases were amd64-only, so Apple Silicon and ARM
  homelab hosts could not pull them at all.

## [1.3.0] — 2026-08-04

### Added

- Trash view in Settings for restoring or permanently deleting contacts.
- Data lifecycle: soft-delete with retention purge, scheduled SQLite
  snapshots, and full JSON/CSV export.
- Single-user authentication (`AUTH_TOKEN` / `AUTH_REQUIRED`) with an
  HttpOnly cookie and bearer-token support for scripts.

### Changed

- TypeScript `strict` mode enabled across the codebase with real lint
  enforcement in CI.
- Integration tests run HTTP routes against a real SQLite database.
- Heavy startup work moved off the request thread.
- Documentation refresh and release-pipeline improvements.

### Fixed

- Prompt-injection hardening across the AI pipeline: untrusted content is
  fenced and model output is validated before it can be written.
- Soft-merged contacts no longer leak into contact lists.

## [1.1.0] — 2026-08-03

### Added

- Lite-tier model integration and an enhanced hybrid search pipeline.

## [1.0.0] — 2026-08-03

Initial release: local-first AI-powered personal CRM with contact
management, semantic search, AI enrichment, and duplicate detection.

[unreleased]: https://github.com/arvarik/contrack/compare/v1.5.3...HEAD
[1.5.3]: https://github.com/arvarik/contrack/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/arvarik/contrack/compare/v1.4.0...v1.5.2
[1.4.0]: https://github.com/arvarik/contrack/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/arvarik/contrack/compare/v1.1.0...v1.3.0
[1.1.0]: https://github.com/arvarik/contrack/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/arvarik/contrack/releases/tag/v1.0.0
