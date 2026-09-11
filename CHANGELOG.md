# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Phase 3.** An administrator can manage the accounts on the instance.
  `GET`, `POST`, `PATCH` and `DELETE /api/admin/users` list, create, change
  and remove accounts, `POST /api/admin/users/:id/disable` and `/enable` turn
  one off and on again, `POST /api/admin/users/:id/reset-password` issues a
  new temporary password, and `GET /api/admin/users/:id/export` downloads one
  account's data for the person who is leaving. Every one of them needs an
  admin account.
- **Phase 3.** Invitations. `POST /api/admin/invitations` returns a link once,
  `GET` lists them with their status, and `DELETE` revokes one. The person
  uses the link at `POST /api/auth/accept-invitation`, which creates their
  account with the role the invitation carried and signs them in. There is no
  mail: the database holds only the hash of the secret in the link, and the
  admin sends the link however they already talk to the person.
- **Phase 3.** An audit log. Every administrative action writes one row:
  creating, inviting, disabling, enabling, deleting and exporting an account,
  changing a role or a password, changing an instance setting, taking a
  backup, and every sign-in and sign-out. `GET /api/admin/audit` pages through
  it newest first. Details never carry a password, a token, an invitation
  secret or a provider key, and the service redacts a credential-shaped field
  rather than trusting each call site.
- **Phase 3.** A forced password change. An account created or reset by an
  administrator holds a password that administrator chose, so every data route
  answers `403 PASSWORD_CHANGE_REQUIRED` until the person replaces it. Their
  own account settings stay reachable, which is where the change happens.
- **Phase 3.** Personal API tokens. `POST /api/auth/tokens` mints one,
  `GET` lists them with enough of each to tell two apart, and `DELETE`
  revokes one. A token acts as its own account everywhere that reads owned
  data, so an MCP client signed in with one reads the contacts of whoever
  issued it. It cannot reach any route that manages the account, which means
  a script can neither mint a second token nor change the password that would
  revoke its own.
- **Phase 3.** Open registration, off by default. `POST /api/auth/register`
  answers `403 REGISTRATION_CLOSED` until an admin turns it on through
  `PUT /api/admin/settings`, and the account it creates is always a member.
- **Phase 3.** `GET` and `PUT /api/admin/settings` hold the instance
  settings: open registration and the session lifetime.
  `PUT /api/auth/session-policy` writes the same session value and is
  deprecated.
- **Phase 3.** A second rate limit on the AI routes, per account rather than
  per address, at thirty requests a minute. On a multi-user instance behind
  one office address the older per-address limit let one person spend
  everybody's provider budget. `GET /api/dashboard/insight` and
  `POST /api/dedupe/scan` join the list both limits cover, and a `429` from
  either now carries a `Retry-After` header.
- **Phase 3.** One daily maintenance sweep, gated by
  `DISABLE_BACKGROUND_JOBS`. It removes audit rows past ninety days, expired
  sessions, tokens revoked more than thirty days ago, invitations that died
  more than thirty days ago, and AI invocations outside the stats window.
  Before this the invocation cleanup ran once at boot and the session sweep
  was boot-only, so an instance left running for a year swept twice.
- **Phase 3.** `?scope=all` on `GET /api/ai/stats/summary` and
  `/feed` gives an admin the instance totals and a per-account breakdown,
  because the provider key is one key and the bill is one bill. A member
  asking for it gets `403 ADMIN_REQUIRED`. The instance feed names the
  account behind each call and omits the description, which is the one field
  that can carry a fragment of what somebody asked about.

- **Phase 4.** An administration area, for admins only and downloaded only by
  them. Accounts (create, invite, edit, reset a password, disable, export,
  delete), Invitations, Instance (who can join, how long a sign-in lasts, the
  AI configuration and SearXNG), Backups, and the Audit log with a filter and
  paging. Each is a separate chunk, so a member never fetches five pages of
  account management to be told they may not open them.
- **Phase 4.** Backups have a UI. The service has taken snapshots and rotated
  them for years and nothing in the app has ever shown one, so the only way to
  know it was working was to look in the data directory.
- **Phase 4.** AI usage gained a **Mine / All users** control for admins, with
  a per-account breakdown of calls, tokens and cost. The provider key is one
  key and the bill is one bill. A member sees only their own, and asking for
  the instance view without an admin account is a `403`.
- **Phase 4.** Deleting an account shows what it owns before it goes. The
  first click is refused with `409 USER_HAS_DATA`, the counts in that refusal
  are what the dialog shows, and the delete needs both an explicit checkbox
  and an "export their data first" button beside it.

- **Phase 4.** The sign-in flow covers every way an account starts. A new
  instance is set up; an instance that has been running without sign-in is
  _secured_, and the screen says so and explains that the contacts already
  there stay with the account it creates. An invitation link opens a join
  screen, open registration adds a "Create one" link to sign-in, and an
  account holding a password an administrator chose is sent to a screen that
  replaces it before anything else works.
- **Phase 4.** The app knows who is signed in. `useAuth()` carries the account,
  its role, whether the password must change, and what the instance allows,
  and it is available on every screen rather than only after the gate opens.
  The signed-in account appears at the foot of the sidebar on desktop, with a
  menu holding the account settings and sign-out, and at the top of Settings
  on a phone. All of it hides on an instance that asks nobody to sign in.
- **Phase 4.** An API tokens section in Account settings. Create a token and
  see its value once, read the list with the last time each was used, and
  revoke one. A banner appears while the deprecated environment `API_TOKEN`
  is still set, naming the variable to remove.
- **Phase 4.** A dedupe scan behind another account's says so. The scan is
  booked on the server and starts by itself, and the page says that rather
  than showing a progress bar at zero. `GET /api/dedupe/active` gained a
  `queued` field, which is the only way a reloaded page can tell a booked scan
  from one that has hung.
- **Extra S2.** A search quality gate. `tests/eval/search.eval.test.ts` runs
  fifty golden queries against a fixed corpus of three hundred contacts and
  compares recall at ten and mean reciprocal rank with a committed baseline,
  for the quick search box, for keyword ranking on its own, and for the hybrid
  fusion. Ranking could be changed by one number in one string before this,
  and nothing in the suite would have noticed. The gate fails on an
  improvement as well as on a regression, so a ranking change arrives with the
  measurement that justifies it. The contact and query embeddings are recorded
  by `npm run eval:record`, so the gate needs no model and no network.

### Fixed

- **Phase 3.** An expired personal token is refused from the moment it
  expires. The expiry check compared a database timestamp against a
  JavaScript one, and a space sorts before a `T`, so a token whose expiry fell
  earlier on the same UTC day still worked, in the worst case for nearly a
  full day past the time it was meant to stop.
- **Phase 3.** A capital letter no longer escapes the AI rate limits. This
  app routes URLs case-insensitively, so `/API/Dashboard/Insight` reaches the
  same handler and makes the same billable call as the lower-case spelling,
  and neither limiter was counting it.
- **Phase 3.** The daily sweep removes a session or an invitation that expired
  earlier the same day, rather than leaving it for the next day's run, and a
  session that has expired no longer counts towards the session totals an
  account or an administrator sees.
- **Phase 3.** A personal token's `lastUsedAt` is stamped at most once an
  hour, as it was always meant to be. The hourly check compared a database
  timestamp (`2026-09-10 05:33:50`) against a JavaScript one
  (`2026-09-10T04:33:50.000Z`), and a space sorts before a `T`, so the stored
  value looked older than any cut-off from the same day and the row was
  written on every request a script made.
- **Phase 3.** An invitation link no longer reaches the access log. The link
  carries its secret in a query string, and the invitee's browser sends it to
  this server as an ordinary page request, so the one value the invitation
  system keeps out of the database was landing in the request log instead.
  The value of `token`, `secret` and `api_key` is replaced in every logged
  URL.

- **Phase 4.** An administrator could reset their own password and be locked
  out of the instance. A reset deletes every session of its target, so aiming
  it at yourself signs you out mid-request and the response carrying the new
  password reaches a browser that is already being torn down. The old password
  no longer works either. `POST /api/admin/users/:id/reset-password` now
  refuses a self-target, alongside the disable and the delete it already
  refused.
- **Phase 4.** The account row menu was clipped away by the list's
  `overflow-hidden`, so on the lower rows Disable, Delete and Export were
  painted outside the box and could not be clicked at all.
- **Phase 4.** A failed read in the administration area rendered as "there is
  nothing here". A query that fails leaves its loading flag false and its data
  undefined, so a 500 or a dropped connection reported an empty instance in
  reassuring copy, and the Instance page painted its controls from invented
  defaults including registration "closed".
- **Phase 4.** The Settings back button was a 36 px touch target, on the one
  control every page in that area shares. The AI usage empty state was drawn
  at 1.57:1 contrast, the only text in the app the audit fails on.
- **Phase 4.** `npm run audit:contrast` could not gate anything it was pointed
  at. Its default port was one nothing listens on, its route list named none
  of the administration pages, and it drives a browser with no session — so on
  a gated instance it measured the sign-in screen a dozen times and reported
  zero failures. It now defaults to the port `npm run dev` serves, sweeps the
  administration area, and says in the file that it has to run against an
  instance with sign-in off.

- **Phase 4.** Enrichment reported every refusal as the daily grounding quota
  being exhausted. The branch that did it could not run at all — the shared
  client throws for any non-2xx, so the code reading `res.status` was
  unreachable — and since Phase 3 the likeliest refusal is the per-account AI
  limit, not the quota. The message now comes from the code the server sent,
  and a limit held by another account says so instead of blaming the reader.
- **Phase 4.** A dedupe stream that failed four times used to stop silently:
  no error, no toast, no change on screen, and a progress bar that never moved
  again for a scan that finished normally. An `EventSource` failure carries no
  status, so the client now asks `/api/auth/status` which kind of failure it
  was. A signed-out browser goes to the gate; a working one falls back to
  polling the scan until it ends.
- **Phase 4.** The contacts prefetch ran at module load, before React
  rendered, so the first request of every page load on a gated instance was a
  `401` from a browser that had not yet asked whether it was signed in. It now
  runs when the gate opens, and again for the next account after a sign-out.
- **Phase 4.** Three components reached `/api/...` with a bare `fetch`: the
  bulk import, the link unfurler, and the enrichment call. None of them could
  act on a `401` or a `403`, so a session that expired during an import
  produced a failed import and no way to sign back in.
  `tests/unit/frontend.apiClient.test.ts` scans the source and fails on the
  next one.

### Changed

- **Phase 4.** Session length moved from Account settings to Administration →
  Instance. It decides how long every account's sign-in lasts, which stopped
  being a personal setting the moment an instance could have more than one
  account. `/settings/ai-config` redirects for the same reason: one set of
  provider keys pays one bill.
- **Phase 4.** `GET /api/dedupe/active` reports `queued`. A booked scan is a
  real record with phase `starting`, identical to a scan that began a moment
  ago, and this is the only thing that tells them apart after a reload.
- **Phase 4.** `GET /api/admin/audit` takes an `action` filter, validated
  against the actions the app writes. Filtering a fetched page would show two
  sign-ins out of fifty rows with no way to reach the rest, and an audit log
  that answers a typo with an empty page reads as "nothing happened".

- **Phase 4.** Signing in as a different account replaces the whole component
  tree rather than reusing it. Clearing the query cache removed what the
  server had sent; the recently-viewed list, the last AI Search, the dedupe
  scan and every open panel were React state and survived it.
- **Phase 4.** `emitAuthExpired` carries a reason. A `401` and a
  `403 ACCOUNT_DISABLED` both end at the sign-in screen and now say different
  things there, because inviting somebody whose account an administrator
  closed to try their password again sends them round a loop with no end.
- **Phase 4.** `.agent/STYLE.md` states the two mobile rules the primitives
  have carried without documenting: a 44 px minimum hit area on every touch
  control, and modals as bottom sheets below `sm`.
- **Phase 3.** The fourteen routes the route manifest has classed `admin`
  since Phase 2 are now closed to a member. Backups, every write under
  `/api/settings/ai`, the AI diagnostics and grounding-capacity reports, the
  instance-wide embedding backfill, the session-policy write and the
  development cache-stats endpoint each answer `403 ADMIN_REQUIRED`. The guard
  sits on each route rather than on its router, and the manifest test fails
  when an admin route arrives without it.
- **Phase 3.** Deleting an account is two steps. The first answers
  `409 USER_HAS_DATA` with what the account owns and changes nothing, so the
  export button next to the delete button is still useful. A request that says
  `decision: "purge"` removes every row, both vector stores, the embedding
  metadata, the search index rows and the upload directory, in one
  transaction. Ten thousand contacts take 147 ms.
- **Phase 3.** Three guards stand between an administrator and an instance
  nobody can administer. The last active admin cannot be demoted, disabled or
  deleted. An admin cannot disable or delete their own account. The local
  account that owns this device's data cannot be touched while authentication
  is off, because nobody can sign in as it.
- **Phase 3.** The forced password change covers `PUT /api/auth/session-policy`
  as well. That route sets how long every future session on the instance
  lasts, and it lives in the auth router, which the gate exempts so that a
  password change stays reachable. The exemption is now the six paths an
  account with a temporary password actually needs.
- **Phase 3.** `GET /api/auth/status` reports `registrationOpen`,
  `localOwnerPresent` and `legacyTokenConfigured`, and `GET /api/auth/me`
  reports `via`. The environment `API_TOKEN` still works, still acts as the
  first admin, and now logs one deprecation warning at startup. It is removed
  in 3.0, and a personal token replaces it.
- **Phase 3.** Disabling an account ends its sessions at once and refuses its
  personal tokens while it is off. Enabling gives the tokens back. The
  sessions stay gone, because revoking one is a delete rather than a flag.
  Resetting a password revokes both.

- **Phase 2.** Every route that reads or writes owned data now filters by the
  account that asked, and the isolation matrix proves it for all eighty of
  them. A route that carries no test in that file fails the manifest check, so
  a new one cannot arrive unproven.
- **Phase 2g.** A data export contains the account's own rows, in every table
  it returns. Contacts, interactions, lists, list memberships, action items
  and the merge history each stop at the caller. One request used to return
  every account's data on the instance, which made the export the widest read
  in the app by a wide margin.
- **Phase 2g.** An export filename names the account it came from, as
  `contrack-export-<username>-<date>.json` and
  `contrack-contacts-<username>-<date>.csv`. Two people exporting on the same
  day used to download two files with the same name, and the second one
  replaced the first.
- **Phase 2g.** The trash is per account. Restore and purge answer `404` for
  a contact another account deleted, with the same body an id that never
  existed answers. The trash list holds the caller's own deleted contacts and
  nobody else's, and a mixed bulk restore brings back only the caller's rows
  and counts only those, keeping the `200` it has always answered because
  undo is forgiving by design.
- **Phase 2g.** The MCP surface answers for the account that asked. The
  contact query, the follow-up list, the tag and industry vocabularies, the
  interaction search and the whole-account timeline each read one account's
  rows. A personal API token acts as its own account here, exactly as a
  browser session does, so an MCP client reads the contacts of whoever issued
  its token and nobody else.
- **Phase 2h.** Both embedding backfills run one account at a time, inside
  that account's context, and accounts take turns in rounds of 200 contacts.
  A large account no longer holds up a small account's first results, and a
  provider call made from inside a backfill now names the account whose
  contacts it embedded rather than the instance's first administrator. No
  invocation row is written for an embedding yet, so nothing appears in the
  AI stats feed either way, but every path that reads the caller from the
  context gets the right answer.
- **Phase 2i.** `npm run lint` runs `tenant-lint --strict` over the whole of
  `server/`. Every SQL statement that reads an owned table either names the
  owner or carries a one-line reason why it does not.
- **Phase 2i.** The four single-column owner indexes are dropped on the next
  boot, as tenancy schema version 2. Each was the leading column of a
  composite index that answers the same query, so each cost a second B-tree
  write on every insert and gave the query planner a narrower index to prefer
  over the one the reads were built for.

- **Phase 2e.** A duplicate scan reads one account's contacts and finds one
  account's duplicates. Every stage is scoped: the normalized corpus, the five
  child-table loads behind it, the exact email, phone and name passes, the
  embedding neighbours, the co-occurrence and exclusion constraints, and the
  clusters the scan reports. Two people who share a name across two accounts
  are two people, and the scan can no longer suggest merging them into one.
- **Phase 2e.** Every merge checks that both contacts belong to the caller,
  in one statement, before it moves a single child row. A merge that names a
  contact the caller does not own answers `404`, with the same body an id that
  never existed answers, and nothing moves.
- **Phase 2e.** Suggestions, dismissals, exclusions and the merge log are per
  account. The review queue, the sidebar badge, the per-contact banner and the
  merge history each showed every account's rows. Undoing a merge works on the
  caller's own audit entries only.
- **Phase 2e.** A scan status page and its live stream answer `404` for a scan
  another account started. A scan record holds every cluster it found with the
  contacts hydrated inside it, so an id that leaked used to be a complete read
  of somebody else's duplicate list.
- **Phase 2e.** A full-mode scan clears its own account's dedupe vectors. It
  ran an unqualified delete before, so one person choosing "full" erased every
  other account's dedupe index and made their next scan pay a provider to
  rebuild it. Re-embedding changed contacts on a deep scan is scoped the same
  way, and the embedding coverage figure now describes the caller's own
  contacts rather than the instance.
- **Phase 2e.** One scan still runs at a time for the whole instance, and an
  account that arrives while the lock is held takes its turn instead of being
  turned away. Its scan starts on its own when the running one finishes.
- **Phase 2e.** **Breaking:** starting a scan while one is already running
  answers with the standard error envelope, `{ error: { code, message,
requestId, details } }` with code `RATE_LIMITED`, instead of a bare
  `{ error: "<message>" }`. `details.yours` says whether the caller is already
  scanning or somebody else holds the lock, and `details.queued` says whether
  a turn was booked. Any client reading `error` as a string must read
  `error.message` instead.
- **Phase 2f.** AI research batches belong to the account that started them.
  Polling a batch, opening its live stream, or cancelling it works for its own
  account and answers `404` for everybody else, with the same body an id that
  never existed answers. A batch refuses a contact the caller does not own
  before it spends a single token.
- **Phase 2f.** The five-minute research cooldown is per account. One person
  finishing a batch used to make everybody else on the instance wait. The
  single-batch run lock stays instance-wide, because the provider API key it
  protects is shared.
- **Phase 2f.** Starting a batch too soon now answers with the same error
  shape as every other endpoint, including a request id, and says whether the
  refusal is the caller's own cooldown or somebody else's batch holding the
  shared lock. It was the one endpoint that answered with a bare message.
- **Phase 2f.** The AI stats page counts the caller's own invocations, tokens
  and cost. It described every account's AI use before. The shared in-process
  cache counters stay, for an admin only, because they describe the instance
  rather than a person.
- **Phase 2f.** Editing a contact clears that account's cached AI work and
  leaves everybody else's alone. Every affected cache is keyed by account now,
  so one person adding a contact no longer costs every other account a fresh
  search, briefing and daily insight through a paid provider.

- **Phase 2c.** Search returns the caller's own contacts and nobody else's, in
  every channel. Keyword search, the semantic pipeline and its NDJSON stream,
  the executive brief, the hard filters behind a parsed query, and the trait
  boosts all read one account's rows. The keyword index carries an owner token
  and intersects it inside the index, so another account's contacts are never
  read and then dropped.
- **Phase 2c.** Vector search asks one account's partition. The nearest
  neighbour query fetched the instance-wide top hundred and filtered the
  result afterwards, so an account with a few hundred contacts on a large
  instance rarely appeared in that hundred and their vector channel returned
  nothing. This is a correctness fix before it is a speed one. The three
  duplicate-detection vector queries take the same predicate.
- **Phase 2c.** Cached search results are held per account. Reranked matches
  and the executive brief were cached under the query text alone, so the first
  account to search a phrase had its own contacts served to every other
  account that typed the same words for the next twelve hours.
- **Phase 2c.** The executive brief refuses a contact id the caller does not
  own with the same answer a deleted id has always taken.

- **Phase 2b.** Interactions, action items, and lists belong to the account
  that created them. Every timeline, briefing, attachment, follow-up task, and
  list endpoint reads and writes the caller's rows only. Another account's id
  answers `404` with the same body an id that never existed answers.
- **Phase 2b.** A note that mentions somebody now stays inside the writer's
  own contacts. Two paths handle mentions and both were open: the AI extractor
  matched a name against every contact on the instance, so a note could link to
  a stranger's row instead of creating a ghost, and the editor's own mention
  markup was inserted with no check at all, so any contact id in the request
  body was linked. The extractor matches the caller's contacts and creates a
  ghost the caller owns. The markup path drops any id the caller does not own.
- **Phase 2b.** Each account's lists number from zero. `sortOrder` came from
  the highest number on the instance, so a new account's first list started
  above every list stored on that box.
- **Phase 2b.** Removing a contact from a list and adding contacts in bulk now
  check both the list and the contact. Removing checked nothing at all, and
  bulk adding checked only the list. Reordering answers `404` when the request
  names a list the caller does not own, and keeps its `400` for a set of the
  caller's own lists that is not complete.
- **Phase 2d.** The dashboard, the daily insight, and the command palette
  zero-state count the caller's own contacts, interactions, follow-ups, and
  duplicate suggestions. Every number on those three screens described the
  whole instance before.
- **Phase 2d.** The daily insight is cached per account. One account's
  AI-written paragraph about their own network was cached under a key that
  described the instance, so whoever opened the dashboard first had their
  insight served to every other account for 24 hours. The cache now holds one
  entry per account.

- **Phase 2a.** Contacts belong to the account that created them. Every
  contact endpoint reads and writes the caller's rows only: the list, the map,
  the archive, the trash, one contact by id, the score breakdown, both bulk
  endpoints, avatar upload, and enrichment. Another account's id answers `404`
  with the same body an id that never existed answers, so the response cannot
  be used to find out which contacts exist. A bulk request that names another
  account's ids reports the number of the caller's own rows it changed.
- **Phase 2a.** Import-time duplicate matching stops at the importer's own
  contacts. Importing a file that happens to contain a name or an email
  another account already has no longer matches, merges, or files a
  suggestion against that account's contact.
- **Phase 2a.** Uploads are served to their owner only. A request for
  `/uploads/u/<ownerId>/...` answers `404` unless the caller is that owner.
  `/uploads/logos/` stays shared, and every other `/uploads` path answers
  `404`. The check is a comparison against the path, with no database read.

- **Phase 1, breaking.** Endpoints that manage the signed-in account refuse an
  API token with `403 SESSION_REQUIRED`. The code was `403 USER_REQUIRED`. The
  seven affected endpoints are under `/api/auth`: `GET /me`, `PATCH /me`,
  `POST /change-password`, `GET /sessions`, `DELETE /sessions`,
  `GET /session-policy`, `PUT /session-policy`. Nothing else changes, and a
  token still reaches every data endpoint. The rename is because every request
  now carries a user account, so "user required" said the opposite of what the
  gate checks: it wants a browser session, not merely a valid credential.
- **Phase 1.** Auth-off instances now have an account. Every instance gets a
  `local` account at boot that nobody can sign in to, and it owns this
  device's data. `GET /api/auth/status` reports it, so an ungated instance
  answers `authenticated: true` with a user instead of `null`. Securing the
  instance converts that account rather than creating a second one, so
  everything it already owns stays owned and nothing has to be claimed.
- **Phase 1.** Uploads live under `uploads/u/<ownerId>/avatars/` and
  `uploads/u/<ownerId>/files/`. Existing files move on the first boot and the
  stored URLs are rewritten to match. `uploads/logos/` stays shared. A file no
  row references moves to `uploads/orphaned/` and is logged. Nothing is
  deleted. The old flat URL now returns `404` for a file that moved.
- **Phase 1.** `GET /api/auth/status` reports `deviceContacts`, which is what
  `existingContacts` counted. Both names are sent for now so an older frontend
  keeps working; `existingContacts` goes away in Phase 3.
- **Phase 1.** Signing in to a disabled account returns `403 ACCOUNT_DISABLED`
  rather than succeeding. The check runs after the password, so a wrong
  password still gets the shared `401 INVALID_CREDENTIALS` and this cannot be
  used to find out which accounts exist. Disabling an account also ends its
  live sessions on their next request.
- **Phase 1.** Auth-off mode is refused when real accounts exist. The server
  logs an error at boot and enforces auth anyway, because with a second
  account there is no answer to "who is the caller with no credential".

- **Phase 0.** CI now runs for the `v2.0` integration branch. Pull requests
  into `v2.0`, and pushes to it, run the `build-and-test` job. The container
  image job and the release job still run only for `main` and for version
  tags, so `v2.0` publishes nothing.
- **Phase 0.** The multi-tenant plan in `docs/multi-tenant-plan/` is now
  tracked on `v2.0`. A reviewer can follow the references that each 2.0 pull
  request makes. Prettier and ESLint skip that folder, so the design
  documents and their benchmark scripts stay exactly as written.

### Added

- **Phase 1.** Every row in every owned table has an owner, enforced by
  triggers rather than by convention. Eight tables carry `ownerId` now:
  `contacts`, `lists`, `interactions`, `action_items`, `dedupe_suggestions`,
  `dedupe_exclusions`, `dedupe_merge_log` and `ai_invocations`. An insert with
  no owner is refused on the four that have no parent contact, and filled from
  the contact on the four that do. A child row whose owner disagrees with its
  contact is refused, which is what makes a cross-owner duplicate suggestion
  impossible rather than merely unlikely.
- **Phase 1.** The upgrade takes a full copy of the database first, with
  `VACUUM INTO`, into `backups/pre-tenancy-<stamp>.db`. The copy is made before
  any schema change, so restoring it puts the instance exactly back. It is
  skipped with an error in the log when free space is under 1.5 times the
  database size, rather than failing the boot. `backupService` never rotates
  it away, so delete it by hand once the upgrade is trusted.
- **Phase 1.** `npm run tenancy:verify` checks an upgraded instance: no
  unowned rows, every child owner matching its contact, the search index
  complete and correctly tokenized, both vector stores partitioned with no
  orphans, no uploads left at the old paths, and all 27 triggers present.
- **Phase 1.** `scripts/tenancy-rollback-uploads.mjs` moves uploads back to
  the 1.x layout, for a downgrade after restoring the backup.
- **Phase 1.** Vector search is partitioned by owner. Both `vec0` tables gain
  `ownerId TEXT PARTITION KEY`, and existing vectors are copied into the new
  shape rather than recomputed, so upgrading spends nothing with an embedding
  provider. The boot refuses to start on a sqlite-vec below 0.1.6, which is
  where partition keys were introduced.
- **Phase 1.** Per-user API tokens (`ctk_...`) are recognized. Only the
  SHA-256 is stored. A revoked token, an expired one, and one belonging to a
  disabled account are all refused. Phase 3 adds the endpoints that create
  them.

- **Phase 0.** New rows carry their owner. On an instance with
  `AUTH_REQUIRED=true`, a contact, a bulk import, a list, a ghost contact from
  an `@mention`, an AI invocation and a merge log row are all stamped with the
  signed-in user's id as they are written. This starts working without a
  restart. Anonymous instances still write no owner and are unaffected.
- **Phase 0.** A benchmark script, `scripts/bench-tenancy.ts`, and the Phase 0
  baseline under `bench/baseline-phase-0.md`. Phase 5 re-runs it to show that
  scoping every query did not cost performance.
- **Phase 0.** A route manifest at `server/tenancy/routeManifest.ts` names
  every route and what guards it. A test compares it against the routes the
  app really registers, so a new route cannot ship unclassified. The route
  list is recorded while the app builds, because Express 5 keeps no mount
  path strings.
- **Phase 0.** `scripts/tenant-lint.mjs` reports SQL over owned tables that
  carries no owner predicate. `npm run lint` runs it in report mode, so it
  cannot fail a build yet. The Phase 0 baseline is 240 statements across 35
  files, committed under `bench/` so later phases can watch it reach zero.
- **Phase 0.** The request context, `server/tenancy/scope.ts` and
  `server/tenancy/requestContext.ts`. A request now carries who is asking
  through the async call tree, which later phases use to stamp ownership.
  Nothing reads it on the data path yet, so behavior is unchanged.
- **Phase 0.** A unit test pins the BM25 weighting rule. `bm25()` reads its
  weights by column position and counts `UNINDEXED` columns, so
  `contacts_fts` needs one weight per column and `contactId` needs a zero.
  Search ranking does not change, because the offset this guards against was
  already corrected in 1.5.5. Phase 1 adds two more columns to that table,
  and this test fails if the weight list is not extended with them.

### Fixed

- **Phase 2g.** The MCP contact query no longer answers with rows the app
  hides. It had no trash filter, no ghost filter and no merged-away filter, so
  an MCP client saw people the user had thrown away, the placeholder rows a
  mention creates, and the losing side of every merge. An agent acting on a
  merged id wrote an interaction onto a record the app never shows again.

- **Phase 2h.** A duplicate scan embeds its own account's contacts. It called
  the instance-wide backfill in the middle of a scan, so one person pressing
  "scan" paid a provider to embed every other account's contacts, and a
  full-mode scan that had just cleared its own vectors refilled everybody's.

- **Phase 2i.** `tenant-lint --strict "server/**/*.ts"` covers files that sit
  directly in `server/`. `**` matched one or more directories, so
  `server/db.ts` fell outside every strict glob the phase used, and the
  fourteen boot statements in it were never checked.

- **Phase 2a.** The migration test's second-boot check no longer depends on
  the clock. It compared `updatedAt` against the fixture, which the legacy
  follow-up backfill legitimately moves on one contact during the first boot,
  so the test failed whenever the fixture build and that boot landed in
  different seconds. It now compares against the state the first boot left.

- **Phase 1.** Upgrading no longer re-embeds the whole contact list through a
  paid provider. Two bulk writes during the migration stamped `updatedAt` on
  every row they touched, and the deep dedupe scan re-embeds any contact whose
  `updatedAt` is newer than its last embedding. The ownership claim now runs
  with the seventeen affected triggers dropped, and the uploads relocation runs
  in the same window. Measured on 5,000 contacts: the claim stamped all 5,000
  before, and none after.

- **Phase 0.** `GET /api/contacts/action-items` works again. `contactsRouter`
  mounted before `mcpRouter`, so `GET /contacts/:id` captured `action-items`
  as a contact id and answered `404`. The route was unreachable, so no
  working client changes behavior. The MCP router now mounts first.

## [1.5.5] — 2026-08-09

Corrections from an independent review of the v1.5.4 release, run with fresh
context specifically to catch what the author could not see in their own
work. It caught one real regression — proven live before the fix shipped.

### Fixed

- **v1.5.4's docker-compose file silently disabled scheduled backups.** The
  new env passthrough rendered an absent `BACKUP_INTERVAL_HOURS` as an empty
  string — set, but empty — and the schedule guard's `!== undefined` check
  read that as an explicit `0`: disabled. Any Compose user upgrading through
  v1.5.4 lost the default 24-hour snapshots without a word (our own
  deployment included, which is how the finding was confirmed). Empty now
  means unset; only an explicit `0` disables. All eight forwarded variables
  were audited for the same trap — this was the only one using a presence
  check — and a regression test pins the exact empty-string shape Compose
  sends.
- **Seeding a brand-new data directory failed** with "no such table" — the
  seed scripts opened a private connection before any migration ran. They
  now use the server's own database module, which migrates on import.
  Verified: fresh empty `DATA_DIR` → first run inserts, second run skips.
- **The SSRF guard missed private addresses wrapped in IPv6.** It knew three
  hardcoded `::ffff:` prefixes; `::ffff:169.254.169.254` (cloud metadata),
  CGNAT, `172.16/12`, and NAT64 (`64:ff9b::`) wrappings all walked past it.
  The gap predates 1.5.4, but the connect-time rebinding guard added there
  leans on this function. Any IPv6 address embedding an IPv4 — dotted or
  hex-group form — is now judged by the full IPv4 policy, block and pass
  cases pinned in tests.
- The scripts table in getting-started still claimed `npm run seed` clears
  the database — the one line the docs audit missed. The table now matches
  the code and lists the scripts CI actually enforces.

## [1.5.4] — 2026-08-09

The clone-and-host release. Four independent verification passes — a clean-
clone install test, a full Docker hosting pass, an adversarial review of every
change since 1.5.3, and a docs-vs-reality audit — ran against this tree, and
everything they found is fixed here. The result: `git clone`, one command, and
a running instance, with an API key, a self-hosted OpenAI-compatible endpoint,
or no AI at all.

### Added

- **A fresh clone installs again.** `npm install` failed outright with an
  ERESOLVE peer conflict — `eslint-plugin-jsx-a11y` (at its latest, 6.10.2)
  declares peer support only through eslint 9 while the project uses
  eslint 10. The Dockerfile and CI already passed `--legacy-peer-deps`;
  humans following the README had no such luck. A committed `.npmrc` now
  makes `npm install` and `npm ci` work exactly as the docs write them.
- **A prebuilt-image quick start.** CI has published multi-arch images to
  `ghcr.io/arvarik/contrack` all along; the README finally says so, with a
  one-command `docker run` that skips the from-source build entirely.
- A "Running as a Service" section in the configuration guide: `/healthz`,
  the Docker HEALTHCHECK, SIGTERM drain semantics, the 65-second keep-alive
  and why it matters behind a proxy, and what the production CSP will block.
  The API reference now documents `/healthz`, the 1 MB body limit with its
  single 50 MB exemption, the true pre-auth surface, and fourteen endpoints
  that existed only in code.

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

- **The seed scripts wrote to the wrong database on any `DATA_DIR` install**
  (Docker included): both hardcoded `curator.db` in the working directory
  while the server reads `$DATA_DIR/curator.db`. Seeding a Docker instance
  created a stray database the app never opens. Both scripts now resolve the
  path exactly as the server does.
- **The configuration guide told Docker users to mount the project root** as
  their persistence volume — advice that would shadow the built app and
  `node_modules` inside the image and break the container. It now says what
  `docker-compose.yml` actually does: mount `/app/data`, which holds the
  database, uploads, backups, and the embedding-model cache, and is the
  entire persistence story.
- **Seeding docs described a destructive import that never existed.**
  `npm run seed` inserts one example contact and skips a non-empty database —
  it deletes nothing, ever. The "~50 demo contacts" (actually ~30, from
  `npm run db:seed`) and the false "seeding clears the existing database"
  warning are corrected everywhere.
- **An OpenAI- or Anthropic-only install booted to a false alarm.** Startup
  validated only the key matching `AI_PROVIDER` (default `gemini`), so a
  working OpenAI-only setup was greeted with "GEMINI_API_KEY is not
  configured — AI features will fail gracefully", which was simply untrue.
  Boot now reports the providers actually configured, and with none it says
  what to do (Settings → AI) instead of implying something is broken.
- `docker-compose.yml` forwarded only eight environment variables, so a
  documented setting like `BACKUP_KEEP=30` in `.env` was silently ignored on
  the Docker path. The optional tuning variables now pass through.
- `APP_URL` was documented in two places and read by zero lines of code —
  removed from the docs and `.env.example`. `DISABLE_BACKGROUND_JOBS`,
  `NODE_ENV`, and the configurable session lifetime were the reverse (real
  behaviour, documented nowhere) and are now in the reference.
- The README's two contradictory test counts (474 in the badge, "180 tests,
  <600ms" in the table) both now reflect the real suite, and the Vite config
  no longer triggers a loader warning on every boot (`__dirname` in an ESM
  config, replaced with `import.meta.dirname`).

- **Swipe-merge stayed blocked after confirming a large cluster.** The drag
  handler captured the confirmation flag once and never saw it change — a
  stale closure the exhaustive-deps burn-down surfaced. The merge buttons
  worked; the swipe silently did not.
- The scroll-position save on unmount read a ref React had already cleared,
  so leaving a list mid-scroll saved nothing and the position restored stale.
- The command palette re-bound its document key listener on every keystroke
  (the action list was rebuilt each render into the handler's dependency
  list), and the AI-result array was minted fresh per render into a memo.

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
- **`aiService.ts` (1,557 lines, four unrelated domains) is now five domain
  modules** — contact parsing, relationship intelligence, mentions, search
  intelligence, shared helpers — behind the same import path, so no call
  site changed.
- **One schema translator serves all three AI adapters.** The three copies
  had drifted; the OpenAI/compat copy dropped a nullable object's properties
  outright. The dialect differences (nullable form, object sealing) are now
  two documented options, and the trap is closed with a test on it.
- The four SQL statements on the per-request auth path are compiled once at
  module load instead of per call (measured ~6× per statement), matching the
  repository's existing convention. `PRAGMA optimize` now runs daily and on
  shutdown.
- `react-hooks/exhaustive-deps` is an error now that its count is zero —
  all 14 warnings reviewed and fixed individually, per the config's ratchet
  policy.

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

[unreleased]: https://github.com/arvarik/contrack/compare/v1.5.5...HEAD
[1.5.5]: https://github.com/arvarik/contrack/compare/v1.5.4...v1.5.5
[1.5.4]: https://github.com/arvarik/contrack/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/arvarik/contrack/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/arvarik/contrack/compare/v1.4.0...v1.5.2
[1.4.0]: https://github.com/arvarik/contrack/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/arvarik/contrack/compare/v1.1.0...v1.3.0
[1.1.0]: https://github.com/arvarik/contrack/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/arvarik/contrack/releases/tag/v1.0.0
