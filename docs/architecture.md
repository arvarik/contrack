# Architecture

This page explains how Contrack is built, for contributors. It covers the
parts, the path of one request, the data model, and the rules that keep each
account's data apart.

## Overview

Contrack is one Node.js process. It serves the React app and the JSON API on
one port, 3210 by default, and it keeps all data in one SQLite file.

```mermaid
flowchart LR
  subgraph Browser
    Views["Views and components"]
    Hooks["React Query hooks and apiFetch"]
  end
  Clients["Scripts and MCP clients"]
  subgraph Server["Node process: server.ts"]
    MW["Express middleware: server/app.ts"]
    Routes["Routes: server/routes"]
    MCP["MCP server: server/mcp"]
    Jobs["Background jobs and connectors"]
    Services["Services: server/services"]
    Data["Repositories and SQL with a Scope"]
    Gateway["AI gateway and queue: server/ai"]
    Worker["CPU worker: local models"]
  end
  DB[("SQLite: tables, FTS5, sqlite-vec")]
  Providers["AI providers"]
  Web["Calendars, mail, Google, Nominatim, web pages"]
  Views --> Hooks
  Hooks -->|"JSON, NDJSON, SSE"| MW
  Clients -->|"Bearer token"| MW
  MW --> Routes & MCP
  Routes & MCP & Jobs --> Services
  Services --> Data --> DB
  Services --> Gateway --> Providers
  Services --> Worker
  Services & Jobs --> Web
```

| Part     | Built with                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime  | Node 26.10 or later, which runs the `.ts` files itself. `npm run dev` runs `node server.ts` with Vite as middleware. Production serves `dist/`. |
| Frontend | React 19, Vite 8, React Router 7, TanStack Query 5, Tailwind CSS 4, Motion, Tiptap, cmdk and MapLibre GL.                                       |
| Backend  | Express 5, Zod 4, multer, sharp, nodemailer, SimpleWebAuthn and the MCP SDK.                                                                    |
| Database | SQLite through better-sqlite3 and Drizzle ORM, in WAL mode, with FTS5 and sqlite-vec.                                                           |
| AI       | The Gemini, OpenAI and Anthropic SDKs, any OpenAI-compatible server, and Transformers.js for the local models.                                  |

## Repository layout

| Folder                                              | What it holds                                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`                                              | The React app: `api/` (query hooks and `apiFetch`), `views/` (pages), `components/`, `hooks/`, `lib/`, and `db/schema.ts` (the Drizzle schema). |
| `shared/`                                           | Code that the server and the browser both run: facets, search history, dates, cadence, score bands, vCard and the MCP tool list.                |
| `server/routes/`                                    | The Express routers, one file for each area.                                                                                                    |
| `server/middleware/`                                | Authentication, rate limits, the AI switch, cache headers, the uploads guard and the error handler.                                             |
| `server/services/`                                  | The business logic, with `search/`, `dedupe/`, `aiSearch/` (contact research) and `geocoding/`.                                                 |
| `server/repositories/`                              | Contact reads and writes, and the hydration of child records.                                                                                   |
| `server/ai/`                                        | Capabilities, the gateway, the queue, the provider adapters, prompt safety, and the AI features in `services/`.                                 |
| `server/connectors/`                                | Calendar, mailbox and Google sync: adapters, the scheduler and the ingest step.                                                                 |
| `server/mcp/`, `server/tenancy/`, `server/workers/` | The MCP server; `Scope`, the request context and the route manifest; the CPU worker for local models.                                           |
| `server/utils/`                                     | Errors, validators, paths, the secret box, URL safety, the AI cache and the logger.                                                             |
| `server/db.ts`, `server/app.ts`                     | The database setup, migrations and triggers; the Express app that `server.ts` starts.                                                           |
| `scripts/`                                          | Command-line tools: seed data, `db:enrich`, `reset-password`, `fetch-models`, the tenant lint, eval recorders and benchmarks.                   |
| `tests/`                                            | `unit/`, `integration/`, `eval/`, `contract/`, `e2e/` and `fixtures/`.                                                                          |
| `drizzle/`, `public/`                               | The SQL migrations that `npm run db:generate` writes; icons, fonts and the web manifest.                                                        |

## A request from click to database

This is the path of one edit, from a click to a saved row.

1. A view calls a React Query hook in `src/api/`, such as `useUpdateContact()`.
   The hook calls `apiFetch` in `src/api/client.ts`. A unit test fails when a
   module in `src/api/` calls `fetch` directly.
2. The browser sends the session cookie. A script sends a personal token.
3. `server/app.ts` runs the middleware in this order:
   1. A request id (`X-Request-Id`) and the security headers.
   2. The JSON parser: 1 MB, or 50 MB for `POST /api/contacts/bulk`.
   3. The AI rate limit for each client address.
   4. `GET /healthz`, which sits outside the credential gate.
   5. `attachPrincipal`: a token, the `API_TOKEN`, a cookie, or the local owner.
   6. `attachRequestContext`, which puts the caller in AsyncLocalStorage.
   7. The AI rate limit for each account, and `requireAiAllowed`.
   8. `Cache-Control: no-store` for four prefixes.
   9. The `/api/auth` router, then `requireAuth` and `requirePasswordCurrent`.
   10. The uploads guard and the static files, then the API routers.
4. The route checks its input with a Zod schema (`validateBody` in
   `server/utils/validators.ts`), reads `scopeOf(req)`, and calls a service.
5. The service does the work. Every read and write takes the Scope and names
   the owner in the same SQL statement as the id.
6. SQLite triggers update the derived data in the same transaction: the
   full-text rows, `updatedAt`, `trackedAt`, `nextFollowUpAt`, the score's
   dirty flag and the search revision.
7. The route answers with JSON. A thrown error goes to `errorHandler`, which
   writes the error envelope with the request id.
8. `apiFetch` turns an error answer into an `ApiError`. A `401`, a disabled
   account or a password-change answer makes the whole app change screen. A
   mutation invalidates the queries whose data it changed.

## Frontend

- **Shell.** `src/main.tsx` mounts the app inside an `ErrorBoundary`, the
  `QueryClientProvider` and `AuthGate` (`src/components/auth/`), which shows
  setup, sign-in, a password reset or the app.
- **Routes.** `src/App.tsx` declares `/` and `/contact/:id` (the Network),
  `/pulse/*`, `/search` (Ask Contrack), `/map`, `/map/contact/:id` and
  `/settings/*`. One registry, `src/views/settings/registry.ts`, declares every
  settings page, its group and its searchable rows.
- **Code loading.** The Network list and the contact page are in the first
  bundle. The map, Pulse, Ask Contrack, the note composer and each settings
  page are chunks of their own. The app warms them in idle moments
  (`src/views/pages.ts`, `src/views/settings/warm.ts`, `src/lib/idle.ts`),
  and pointing at a link starts its page's code and first data, except in a
  browser that asks to save data. `src/lib/preloadable.tsx` renders a loaded
  view in the same frame.
- **Page switches.** One Suspense boundary in `src/App.tsx` holds every route.
  A navigation is a transition, so the last page stays on screen until the
  next one is ready, and the two swap in one frame. The sidebar and the tab
  bar mark the pressed link at once (`src/lib/pendingNav.ts`). The Network
  list starts at its saved scroll position, and the pictures it showed stay
  in memory (`src/lib/keptImages.ts`). Long lists draw only the rows near the
  screen (`src/components/ui/VirtualRows.tsx`).
- **Data.** All server data goes through TanStack Query. The defaults in
  `src/main.tsx` keep data fresh for 30 seconds and cached for 10 minutes, with
  no refetch on window focus. `src/lib/queryConfig.ts` holds longer fresh times
  for some queries.
- **Design system.** The tokens live in `src/index.css` and `src/lib/styles.ts`.
  The visual and code rules, and the tests that hold them, are in the
  [style guide](../.agent/STYLE.md).
- **The corvid** is the animated bird in the logo. Views ask it to move through
  `src/lib/corvid.ts`. It stays still when the **Corvid motion** or **Motion**
  setting, or the operating system, asks for less motion.

## Backend

| Layer              | Folder                                                          | Rule                                                                             |
| ------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Route              | `server/routes/`                                                | Validate the request, read the Scope, call a service, answer. No business logic. |
| Service            | `server/services/`, `server/connectors/`, `server/ai/services/` | The work itself. Take a Scope as the first argument.                             |
| Repository and SQL | `server/repositories/`, and prepared statements in services     | Name the owner in every statement on an owned table.                             |
| Database           | `server/db.ts`                                                  | The schema, the triggers and the virtual tables.                                 |

- **Errors.** A service throws an `AppError` (`server/utils/AppError.ts`) or a
  subclass: `NotFoundError`, `ValidationError`, `ConflictError`,
  `RateLimitedError`, `ServiceUnavailableError` or `UpstreamTimeoutError`. Each
  carries a status, a stable `code`, a message and optional `details`.
- **The error handler.** `server/middleware/errorHandler.ts` writes one JSON
  envelope for every error, and handlers run inside `asyncHandler` so a
  rejected promise reaches it. It maps Zod errors, bad JSON, size limits,
  upload limits and SQLite errors (`DB_CONSTRAINT`, `DB_BUSY`, `DB_READONLY`).
  An unknown error answers `500 INTERNAL` with a generic message, and only a
  server outside production adds the stack. An unknown `/api` path answers
  `404 ROUTE_NOT_FOUND`.
- **Validation.** `server/utils/validators.ts` holds the shared Zod schemas and
  `validateBody(schema)`, which replaces `req.body` with the parsed value or
  throws a `ValidationError`. Routes parse query strings with Zod too, such as
  `parseInteractionSearchQuery`. The schemas cap names, child arrays (100
  items) and id lists (5,000 ids).

For the envelope and the codes, see [Conventions](api-reference.md#conventions).

## Data model

The Drizzle schema is `src/db/schema.ts`. At boot, `server/db.ts` runs the
Drizzle migrations, then creates the tables, virtual tables and triggers that
the migrations do not hold. To change the schema, edit `schema.ts` and run
`npm run db:generate`.

| Group            | Tables                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts         | `users` (the local owner has `credentialState = 'none'`), `sessions` (keyed by the SHA-256 of the cookie secret), `api_tokens` (the SHA-256 of each token), `passkeys`, `auth_challenges`, `auth_links` (reset and sign-in links), `invitations`, `user_settings` (one row for each preference), `audit_log`. |
| Instance         | `app_settings`: instance settings, and saved AI keys sealed by the secret box.                                                                                                                                                                                                                                |
| Contacts         | `contacts`, with the flags `isGhost`, `isArchived`, `isTracked`, `deletedAt` (the trash) and `canonicalId` (the losing side of a merge).                                                                                                                                                                      |
| Contact details  | `contact_emails`, `contact_phones`, `contact_addresses`, `contact_social_links`, `contact_education`, `contact_experience`, `contact_sources` (import origin and raw payload), `contact_tags`, `contact_interests`, `contact_attributes`.                                                                     |
| Timeline         | `interactions`, `interaction_mentions` (@mention links), `action_items` (follow-ups).                                                                                                                                                                                                                         |
| Lists and scores | `lists`, `list_members`, `score_snapshots` (one score a week for each tracked contact).                                                                                                                                                                                                                       |
| Duplicates       | `dedupe_suggestions`, `dedupe_exclusions` (pairs never to suggest again), `dedupe_merge_log` (with the data an undo needs), `dedupe_embedding_meta`.                                                                                                                                                          |
| Search           | `search_passages` (slices of long fields, with offsets and a source hash), `search_passage_state` (the marker of a finished index), `search_index_queue`, `search_revision` (a counter for each owner), `search_history`.                                                                                     |
| Imports and sync | `imports`, `import_rows`, `connectors` (secret sealed), `connector_runs`, `connector_links` (external ids and correspondents), `upcoming_events`, `oauth_states`.                                                                                                                                             |
| Other            | `map_views`, `ai_invocations` (the AI usage log), `geocode_cache`.                                                                                                                                                                                                                                            |

| Virtual table            | Kind | What it holds                                                                                                                                                                                     |
| ------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contacts_fts`           | FTS5 | One row for every visible contact: name, company, role, headline, location, about, industry, tags, interests, emails, phone digits, addresses and the owner token. Prefixes of 2 to 4 characters. |
| `interactions_fts`       | FTS5 | The title and the plain text of each note, with an owner token. The tokenizer stems and folds accents.                                                                                            |
| `search_passages_fts`    | FTS5 | The text of each search passage, with an owner token.                                                                                                                                             |
| `search_embeddings`      | vec0 | One int8 vector for each contact, partitioned by `ownerId`. 384 dimensions with the built-in model.                                                                                               |
| `search_passage_vectors` | vec0 | One int8 vector for each passage, partitioned by `ownerId`.                                                                                                                                       |
| `contact_embeddings`     | vec0 | One vector for each contact, for duplicate detection. Its width follows the embeddings model.                                                                                                     |

`PRAGMA user_version` holds the full-text schema version, 6. A new version
rebuilds both FTS tables once at boot. A new embeddings model rebuilds the
vector tables and embeds every contact again.

The triggers that matter:

- **Full text.** Triggers on `contacts` delete and insert the FTS row by rowid.
  A change to a tag, interest, email, phone, job or school refreshes the
  contact's row. A trashed, merged, archived or ghost contact has no row.
- **Notes.** Three triggers keep `interactions_fts` in step. They call the SQL
  function `contrack_note_text`, so no HTML tag becomes a search word.
- **Vectors.** A change to a searchable field deletes the contact's vectors and
  passages and queues it for indexing. Status triggers copy the ghost, archive
  and trash flags into the vector tables.
- **Search revision.** A contact change bumps its owner's `search_revision`.
  The search caches include the revision, so an edit makes older answers stale.
- **Stamps and derived columns.** Triggers stamp `updatedAt`, and set or clear
  `trackedAt` with `isTracked`. `nextFollowUpAt` is always the earliest due
  date of the open follow-ups. Writes set `scoreDirty` for the hourly sweep.

## Accounts and isolation

Many accounts can share one instance. These rules keep each account's data
apart.

- **Every request has a principal.** `attachPrincipal`
  (`server/middleware/auth.ts`) resolves a session, a personal token, the
  deprecated `API_TOKEN` (the first admin), or the local owner when sign-in is
  off. The local owner is a real account, so every row has an owner.
- **The Scope is the isolation.** `scopeOf(req)` returns a `Scope` with a typed
  `ownerId` (`server/tenancy/scope.ts`). Every function that reads or writes an
  owned table takes a Scope first.
- **The owner is in the same statement.** A query puts the id and the owner
  together: `WHERE id = ? AND ownerId = ?`. Code never reads a row by id and
  then compares the owner in JavaScript.
- **Another owner's row is a 404.** The body equals the body for an id that
  does not exist, so a caller cannot learn which ids are real.
  `tests/integration/tenancy.isolation.test.ts` checks every scoped route with
  three accounts.
- **The request context is for attribution only.**
  `server/tenancy/requestContext.ts` carries the caller in AsyncLocalStorage,
  so an insert can stamp `ownerId` and an AI call can bill the right account.
  It never decides what a query returns. A stream reads its Scope before it
  subscribes to events, and a background job that calls AI runs one account
  at a time inside `runWithContext`.
- **Triggers guard the owner column.** `<table>_owner_required` refuses a row
  with no owner. On tables whose rows hang off a contact, `<table>_owner_fill`
  copies the contact's owner, and `<table>_owner_check` refuses a row whose
  owner differs from the contact's.
- **Indexes, files and memory carry the owner.** Every FTS row holds an owner
  token, and every `MATCH` starts with it. The vector tables are partitioned by
  `ownerId`, and every KNN query names the owner. Uploads live under
  `uploads/u/<ownerId>/`, checked by `guardUploads`. In-memory queues keep each
  record beside its owner, and a cache built from one account's rows is keyed
  by that owner (`ownerKey` in `server/utils/aiCache.ts`).
- **Every route is classified.** `server/tenancy/routeManifest.ts` gives each
  route a class: `public`, `session-self`, `scoped`, `admin`, `instance-read`
  or `static`. `tests/integration/tenancy.routeManifest.test.ts` fails on an
  unclassified route, a stale row, a scoped route with no isolation test, and
  an admin row whose handler does not carry `requireAdmin`.
- **The tenant lint reads the SQL.** `scripts/tenant-lint.mjs` runs in
  `npm run lint` and flags a statement on an owned table with no owner
  predicate. A deliberate instance-wide sweep carries a
  `// tenant-lint: allow <reason>` comment on the line above. Composite indexes
  start with `ownerId`, and `tests/integration/tenancy.queryPlans.test.ts`
  fails when a core statement scans a table.

Three guards keep an instance manageable. The local owner of an instance with
sign-in off cannot be disabled or deleted. The last active admin cannot lose
the role. No admin can disable or delete their own account. For the routes,
see [Administration](api-reference.md#administration).

## Search

The code is in `server/services/searchService.ts` and `server/services/search/`.

### How Ask Contrack answers

`runSearch` in `searchService.ts` answers `POST /api/search/semantic`, for the
JSON and the streaming callers alike.

1. **L1 cache.** The key holds the owner, the search revision, a five-minute
   bucket, the model that answers (or `local`), the cross-encoder state, the
   facets and the normalized question.
2. **Facets.** `parseFacetQuery` (`shared/facetQuery.ts`) reads facets typed in
   the question and adds the request's facets. `compileFacets` (`facetSql.ts`)
   turns them into one SQL predicate that every stage applies before its limit.
   A question made only of facets is answered by the database, in name order.
3. **Strict keyword search.** `lexicalSearch` (`lexical.ts`) requires every
   word. `classifyQuery` (`intent.ts`) then names the kind: `email`, `phone`,
   `quoted`, `name`, `conceptual` or `mixed`.
4. **Local kinds.** For a name, an email, a phone number or a quoted phrase,
   the strict result is the answer. It is verified, and no model runs.
5. **Implicit facets.** `findImplicitFacets` (`implicitFacets.ts`) finds a
   company, a place or an industry that the owner's contacts hold. When the
   question asks for nothing else, the facet answer is final.
6. **The local list.** `localRetrieval` (`hybridRetrieval.ts`) fuses the BM25
   keyword list and the vector list by weighted reciprocal rank, with
   `RRF_K = 15`. Keyword and vector weigh 0.7 and 0.3 for the local kinds, 0.3
   and 0.7 for `conceptual`, and 0.5 each for `mixed`. A `conceptual` question
   adds a passage list, and the cross-encoder reorders its top 30 within 25 ms.
   The list streams as the `instant` chunk.
7. **AI off or no provider.** The local list is the answer, with
   `fallback: true`.
8. **L2 cache.** With the built-in embedding model, `semanticCache.ts` returns
   a verified answer from the last five minutes when the question vector has a
   cosine of 0.97 or more, and the revision, facets, model, named entities and
   constraint words match.
9. **Model stages,** in the AI queue's search lane, within 12 seconds. The
   planner (`parseSearchQuery`) writes a query plan, and
   `server/ai/queryConstraints.ts` checks its hard filters against the
   question. The local list runs inside the hard filter. When the database
   proves the whole plan, the filtered contacts are the answer. Otherwise the
   reranker reads the top 30. The server keeps a match only when the quoted
   value is in the named field or passage, and the hard filters hold.
   `buildReason` (`reasons.ts`) writes each reason from the proven fields.
10. **Failure.** An error, a timeout, or an edit in the account during the
    model stages ends with a fresh local list and `fallback: true`. The caches
    do not keep it.

Every match on every path carries `matchedOn` (`search/matchedOn.ts`): the
fields that answer the question, with the question's words marked in the
contact's own text. Proven fields come first, then fields that hold the
words, then a passage close in meaning. It runs no model.

The **Try asking** questions come from `search/starterQuestions.ts`: a pool of
up to 500 questions about values that two of the account's contacts share,
and seven general questions from `shared/generalQuestions.ts`. The pool is
kept per account and search revision, and built again after boot and after an
import. A general question is in the pool only when its facets find a
contact, and `implicitFacets.ts` reads the same question as those facets, so
the search answers it with no model. The page draws six with `suggestions.ts`
and the palette's AI mode draws four, both through `useStarterDraw`. A draw
takes one question from each kind before it takes a second from any.

### Indexes and local models

- **Contacts.** `contacts_fts` ranks with BM25 weights (`WEIGHTS` in
  `lexical.ts`): name 10, company 5, role 3, tags 3, headline 2, location 2,
  about 1, industry 1, extras 1, addresses 0.5, search expansion 0.5. An
  address is the least of the text, so a street finds a contact while a name,
  a company or a role that holds the same word ranks first. A phone number is
  indexed with all its digits, its last 10 and its last 7, so a number with or
  without a country code finds its contact.
- **Passages.** `passages.ts` cuts the about text, preferences, jobs and
  schools into slices of 480 characters that overlap by 80. Each slice keeps
  its source, a hash and its offsets, so a reranker quote can be checked.
- **Notes.** `interactions_fts` stems English words and folds accents. The date
  phrase parser (`datePhrases.ts`) is deterministic and reads the caller's time
  zone. Notes on hidden contacts are filtered at query time.
- **The index queue.** `indexQueue.ts` keeps the embedding work in
  `search_index_queue`, so a restart resumes it. Keyword search works while the
  vectors build.
- **Local models.** Two models run on one worker thread
  (`server/workers/cpuHost.ts`): `Xenova/all-MiniLM-L6-v2`, the built-in
  embedding model (384 dimensions, stored as int8), and
  `Xenova/ms-marco-TinyBERT-L-2-v2`, the cross-encoder
  (`SEARCH_RERANK_MODEL=off` turns it off). `npm run models:fetch` downloads
  both, the Docker image ships them, and `MODEL_DOWNLOADS=false` stops any
  download at run time. See
  [Model files and offline installs](configuration.md#model-files-and-offline-installs).

### Eval gates

The eval tests run in `npm test` with recorded vectors and model answers, so
they need no model, no key and no network. Each one fails when a number moves
from its committed baseline, up or down.

| Test                               | What it measures                                                                                                                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/eval/search.eval.test.ts`   | Recall at 10 and mean reciprocal rank for 79 questions over 300 contacts, for five rankings: the sidebar search, keyword, fused, the local answer, and the local answer with the cross-encoder. Record with `npm run eval:record`. |
| `tests/eval/answer.eval.test.ts`   | The whole Ask pipeline with recorded model answers: filters, results, empty answers, prompt-injection cases and grounded briefs. Record with `npm run eval:record:answer`, or run live with `npm run eval:answer:live`.            |
| `tests/eval/passages.eval.test.ts` | Questions whose answer sits late in a long field, through the passage index.                                                                                                                                                       |
| `tests/eval/dedupe.eval.test.ts`   | Precision and recall of the duplicate passes with AI off, on a labelled corpus with hard negatives. Record with `npm run eval:record:dedupe`.                                                                                      |

## AI

Every AI feature is optional. The AI layer is `server/ai/`. The features live
in `server/ai/services/` (contact parsing, briefings and summaries, mentions,
search) and `server/services/aiSearch/` (contact research).

- **Capabilities.** Code asks for a kind of work, not a model
  (`server/ai/capabilities.ts`). `quick` covers parsing, mentions, search
  planning and checking, and the daily insight. `deep` covers briefings, email
  summaries, duplicate checks and extraction. `research` covers web research.
  `embeddings` covers the search and duplicate vectors (`server/ai/embeddings.ts`).
- **Resolution.** At call time a capability takes a pin from Settings, then an
  environment pin (`AI_QUICK_MODEL`, `AI_DEEP_MODEL`, `AI_RESEARCH_MODEL`,
  `AI_EMBEDDINGS_MODEL`), then Auto: `AI_PROVIDER` first, then a fixed order.
  The providers come from environment keys, keys saved in Settings and custom
  endpoints (`server/ai/providerRegistry.ts`). While AI is off for the
  instance, no provider resolves.
- **Gateway.** `generateFor` and `streamFor` (`server/ai/gateway.ts`) are the
  only way to run a generation. They check the instance switch, resolve the
  capability, and run the call in the queue under one deadline. The deadline is
  60 seconds by default and 150 at most, and it counts the wait for a slot. The
  default output cap is 4,096 tokens.
- **Queue.** `GenerationQueue` (`server/ai/workQueue.ts`) runs 2 calls at once
  and holds at most 16 waiting. Interactive work goes first, and the accounts
  take turns. Ask Contrack's planner, reranker and brief use the search lane,
  which has 2 slots of its own. A full queue answers `429 AI_BUSY`.
- **Adapters.** `server/ai/adapters/` holds `gemini.ts`, `openai.ts`,
  `anthropic.ts` and `openaiCompatible.ts`. The Gemini adapter picks its model
  with `routing/SmartRouter.ts`, and pauses a model that answers 429, a 5xx or
  a timeout for the delay Google names (30 seconds by default). The
  OpenAI-compatible adapter falls back from a JSON schema to a JSON object to a
  prompt when a server refuses the format.
- **Resilience.** `server/ai/resilience.ts` gives every adapter `withTimeout`,
  `withRetry` (at most one retry, with jittered backoff) and `parseAIJson`. The
  SDKs' own retries are off. A cancelled request stops its queued work.
- **Prompt safety.** `wrapUntrusted` (`server/ai/promptSafety.ts`) fences
  contact fields, files and web text inside `<untrusted_data>` tags, and each
  such prompt carries `UNTRUSTED_DATA_RULE`. `sanitizeAiOutputValue` checks
  model text before it is shown or saved. Research merges only validated,
  additive changes (`server/services/aiSearch/mergeEngine.ts`).
- **Caches.** `server/utils/aiCache.ts` keeps LRU tiers in memory: `briefing`,
  `mentions`, `dailyInsight` and `queryParse` for 24 hours, and `rerank` (the
  L1 search cache) and `synthesis` for 12 hours. Tiers built from one account's
  rows are keyed by owner. `queryParse` and `mentions` depend only on the text
  the caller sent, so they are shared.
- **Cost limits.** The AI routes allow 60 requests a minute for each client
  address and 30 for each account. One research batch runs at a time on the
  instance. Every call is logged in `ai_invocations`, which feeds the AI usage
  pages with a cost estimate from `server/ai/pricing.ts`.
- **Switches.** `AI_DISABLED` or the admin switch turns AI off for the
  instance, and the `aiAssist` preference turns it off for one account.
  `requireAiAllowed` then refuses the AI routes, except Ask Contrack, which
  answers from local data. The work that runs outside a route reads
  `aiAllowedForUser` itself: mention detection, `.eml` summaries, connector
  summaries, auto-enrichment, the MCP search, and hosted embeddings
  (`mayEmbedContactsFor`).

For the settings a person sees, see [Models for each task](ai.md#models-for-each-task).

## Background work

`server.ts` starts this work after the server listens.
`DISABLE_BACKGROUND_JOBS=true` skips all of it, which the integration tests use.

| Work                                                                                                                                                                                                          | When                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Geocode contacts that have an address and no pin, one Nominatim request every 1.1 seconds                                                                                                                     | At start                                                       |
| Copy stored Google photo URLs into uploads                                                                                                                                                                    | Once, a few seconds after start                                |
| Sync the due connectors, 2 at a time and one for each account                                                                                                                                                 | Every 60 seconds                                               |
| Take a database snapshot, check it, and rotate old ones                                                                                                                                                       | Every 24 hours by default                                      |
| Purge trashed contacts after the retention period, 30 days by default                                                                                                                                         | At start, then daily                                           |
| Delete expired and old rows (audit entries, sessions, sign-in links, revoked tokens, dead invitations, AI usage, finished imports, old score snapshots, OAuth states, connector runs), and checkpoint the WAL | At start, then daily                                           |
| Refresh the model lists of the AI providers                                                                                                                                                                   | At start, then daily                                           |
| Run `PRAGMA optimize`                                                                                                                                                                                         | Daily, at shutdown, and after each search index drain          |
| Score the contacts marked dirty                                                                                                                                                                               | At start, then hourly                                          |
| Score every tracked contact and take the weekly snapshot                                                                                                                                                      | Daily. The snapshot is also taken at start when it is missing. |
| Load the local models, rebuild the vector tables when the model changed, and fill missing vectors for search and duplicates                                                                                   | At start                                                       |

The embedding backfills take turns between accounts in rounds of 200
contacts. On `SIGTERM` or `SIGINT` the server stops taking connections, lets
open requests finish, and closes the database. It forces a close after 8
seconds.

## Security

- **Headers.** Every response carries `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, a referrer policy, a permissions policy and a
  Content-Security-Policy (`server/utils/securityHeaders.ts`). An HTTPS request
  also gets `Strict-Transport-Security`.
- **Outgoing requests.** `safeFetch` (`server/utils/urlSafety.ts`) fetches only
  public `http` and `https` addresses. It checks the address again at connect
  time and on each of at most 3 redirects, and it caps the response size. Link
  previews, remote images, calendar feeds and SearXNG research pages use it.
- **Uploads.** `guardUploads` (`server/middleware/uploads.ts`) serves only the
  caller's own folder, shared logos and account photos, and answers `404` for
  everything else. Files that are not images download instead of rendering.
- **Secrets and credentials.** `server/utils/secretBox.ts` seals SMTP
  passwords, AI keys and connector credentials with AES-256-GCM. The key is
  `CONTRACK_SECRET_KEY`, or `secret.key` in the data folder, which the server
  creates. Passwords use scrypt. Sessions, tokens and emailed links are stored
  only as hashes.
- **File modes.** At boot the server sets its umask to `077` and removes group
  and other access from the database, its WAL files, `secret.key`, `uploads/`,
  `backups/`, `.cache/` and `models/` (`server/utils/privateFiles.ts`).

## Quality gates

| Command                 | What it checks                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm run lint`          | oxlint, the TypeScript compiler (`tsc --noEmit`) and the tenant lint.                                              |
| `npm run format:check`  | Prettier, over the whole repository, these pages included.                                                         |
| `npm test`              | The unit, integration and eval projects of Vitest. The tests use a temporary data folder, never your `curator.db`. |
| `npm run test:e2e`      | Playwright journeys in `tests/e2e/`, including the accessibility checks.                                           |
| `npm run test:contract` | Optional live checks against the configured AI providers. They can cost money.                                     |
| `npm run knip`          | Files, exports and types in `src/` that nothing uses.                                                              |

CI runs the lint, the format check, the tests with coverage, a production
build and the Playwright journeys. For the workflow, see the
[contributing guide](../CONTRIBUTING.md).

## Related

- [REST API reference](api-reference.md#conventions)
- [Search and Ask Contrack](search.md#ask-contrack)
- [AI](ai.md#privacy)
- [Configuration reference](configuration.md#environment-variables)
- [Self-hosting](self-hosting.md#where-your-data-lives)
