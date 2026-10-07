# Status

## Where v2 stands

- Version 2 is on `main`, and pull requests target `main`. The repository
  squash-merges pull requests.
- Version 2 is a new start. It does not open a Contrack 1 database, and no
  code reads 1.x data.
- `CHANGELOG.md` summarizes what v2 changes, by area. The pull requests hold
  the details, and the summary below is the map.

## What v2 changes

- **Accounts.** Several accounts on one instance, isolated in SQL. Sign-in
  with a password, a passkey or an emailed link. Invitations, roles, an admin
  area, an audit log, outgoing mail, personal API tokens, and instance
  settings that an environment variable can lock.
- **Security.** A CSP and security headers on every response, no trusted proxy
  unless `TRUST_PROXY_HOPS` says so, data files readable by their owner only,
  mailed links from `PUBLIC_URL` only, outside fetches through `safeFetch`,
  encrypted stored keys, formula-safe CSV.
- **Tracking and Pulse.** Tracking is a choice, and the score ring shows only
  for tracked people. Pulse is one morning page: the day's sentence, Up next
  with Catch up, Keeping up, Activity, Inbox, Coming up, Composition, and a
  layout a person can rearrange. Tracked contacts is a settings page.
- **Search.** Ask Contrack answers locally first: facets in SQL, names, emails
  and phone numbers with no model, a local cross-encoder, int8 vectors, a
  semantic cache, passage evidence, and model-checked reasons. Note search is
  new, and search history is shared with the palette.
- **Contacts.** A contact page that follows its pane's width, one composer,
  one pattern for every detail, the Dossier with the briefing and the research
  record, default avatars from pronouns and names, a trash with undo, and
  vCard export.
- **Research.** Two depths that both start with one plain ask, cited
  sources, a record of every run, **Not this person**, a next step when a
  run finds little, and filters on the Contact enrichment page.
- **Map.** MapLibre on OpenFreeMap tiles, layers and saved views, selection
  and bulk actions, the insights pane, pins placed by hand, and self-hosted
  basemaps.
- **Connectors.** Calendar (ICS), mailbox (IMAP) and Google, with a
  correspondents review.
- **MCP.** A built-in MCP server with 18 tools for Claude, Cursor and scripts.
- **Settings.** A registry of pages with row search and a two-pane shell.
- **AI.** Routing by task across Gemini, OpenAI, Anthropic and any
  OpenAI-compatible endpoint. Account and instance switches. The local search
  models ship in the Docker image.
- **The corvid.** A brand kit drawn from one path file, a rig, a living mark,
  and flights.
- **Platform.** Node 26.10 runs the TypeScript itself, TypeScript 7, Oxlint,
  Express 5, Vite 8, knip, test isolation, and eval gates for search,
  duplicates and answers.

## Open

- **A-05.** `recencyScore` is discontinuous at zero: a contact stamped at or
  ahead of now scores 100 on a signal weighted at 40 percent. The reachable
  path is closed (future interaction dates are refused, and
  `lastContactedAt` is clamped to now). The formula is unchanged, because
  smoothing it moves every score and no eval shows which numbers are better.
- **Large components.** `src/components/command-palette/CommandPalette.tsx`
  (about 1,260 lines) needs a refactor of its own. The largest file of the
  duplicates review is `src/views/dedupe/components/DuplicateQueue.tsx`
  (about 800).
- **Archive and Trash.** A delete marks the contact archived as well, and a
  restore clears both, so a contact archived before it was deleted comes back
  unarchived.
- **Google sign-in.** A session that ends between the start and the callback
  still meets the API's 401 JSON at the callback.
- **Map selection.** A keyboard user can select with **All in view** only. Box
  and lasso still need a pointer.
- **Touch tooltips.** The Tags page row icons wait for the shared tooltip
  that shows on touch.
- **Test-only seams.** The ones PR #147 listed are gone. A few exports still
  exist only so a test can reset module state, such as `resetPendingDeletes`
  in `src/lib/pendingDeletes.ts`, and the `__reset*` functions of the rate
  limiters and queues, which integration tests need.

## Resolved issues that code comments cite

| Id   | Issue                                                           | Resolution                                                                     |
| ---- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A-01 | The dedupe eval counted auto-merges of two different people     | 26 of 58 were a corpus defect; shared team mailboxes no longer anchor identity |
| A-03 | `text-primary` on a primary wash failed WCAG AA                 | `--color-on-primary-wash` carries that text                                    |
| B-02 | The AI usage feed replaced its page instead of appending        | The feed is an infinite query                                                  |
| P-02 | Duplicate KNN could pair an active contact with an archived one | Status columns filter the KNN                                                  |
| S-03 | The stats endpoints could be cached                             | `server/middleware/cacheControl.ts` marks them `no-store`                      |
