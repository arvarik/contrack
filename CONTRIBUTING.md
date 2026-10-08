# Contributing to Contrack

Contrack is a self-hosted personal CRM. One Node process serves a React app and
an Express API over one SQLite file. AI is optional, and search runs on local
models. This page says how to set up, the rules a review checks, and how a
change ships. The user docs are in [`docs/`](docs/README.md), and
[Architecture](docs/architecture.md) explains the system.

## Set up

You need Node.js 26.10 or later (`.nvmrc` pins it) and npm 11.19 or later. You
need no API key.

```bash
git clone https://github.com/arvarik/contrack.git
cd contrack
npm install
npm run models:fetch   # optional: the two local search models, about 29 MB
npm run db:seed        # optional: about 30 fictional demo contacts
npm run dev            # http://localhost:3210, with hot reload
```

- Node runs the TypeScript itself. `npm run dev` is `node server.ts`, with
  Vite as middleware on the same port.
- A dev container does all of this for you. Open the repository in a GitHub
  Codespace, or in VS Code with the Dev Containers extension.
  `.devcontainer/devcontainer.json` installs the Node version in `.nvmrc`,
  runs `npm ci`, adds 400 fictional people tagged `demo` with
  `npm run db:enrich`, and starts `npm run dev`. Port 3210 opens in your
  browser, with sign-in off. The container adds `.app.github.dev` to
  `ALLOWED_HOSTS` and to Vite's allowed hosts, so a Codespace's forwarded
  address gets through the host checks.
- Copy `.env.example` to `.env` only to change a default or add a key. The
  [Configuration reference](docs/configuration.md) lists every variable.
- Your data is `curator.db` in the project root. For a second, test instance,
  set `DATA_DIR` to a scratch folder and `PORT` to a free port. Each dev server
  keeps its hot reload on its own port.

## Where things live

| Path       | What it holds                                                        |
| ---------- | -------------------------------------------------------------------- |
| `server/`  | Routes, services, the AI layer, connectors, the MCP server, `db.ts`  |
| `shared/`  | Code that the server and the app both import                         |
| `src/`     | The React app: `views/`, `components/`, `api/` hooks, `db/schema.ts` |
| `scripts/` | Seeds, model fetch, eval recorders, brand icons, docs tools          |
| `tests/`   | Unit, integration, eval, contract and browser tests                  |
| `.agent/`  | Notes for coding agents: architecture, style, testing, status        |

[Repository layout](docs/architecture.md#repository-layout) has the full map.

## Commands

| Command                         | What it does                                                     |
| ------------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                   | Start the dev server on port 3210                                |
| `npm run build`                 | Build the app into `dist/`                                       |
| `npm test`                      | Run the unit, integration and eval tests (`test:watch` to watch) |
| `npm run test:coverage`         | The same, with the coverage floor enforced                       |
| `npm run test:e2e`              | Run the browser suite against `dist/`                            |
| `npm run test:contract`         | Call real provider APIs. Each block skips without its key        |
| `npm run lint`                  | Oxlint, `tsc --noEmit` and the tenant lint                       |
| `npm run knip`                  | Find files, exports and types that nothing uses                  |
| `npm run api:openapi`           | Write `docs/openapi.json` from the route contracts               |
| `npm run format`                | Format with Prettier. CI runs `format:check`                     |
| `npm run db:new <name>`         | Start the next schema migration from the template                |
| `npm run db:enrich -- --apply`  | Make a test network of 5,000 people. Stop the server first       |
| `npm run brand:icons`           | Redraw every icon and brand file from the corvid's paths         |
| `npm run docs:wiki -- <folder>` | Write the docs as a GitHub wiki                                  |

A pre-commit hook runs Oxlint and Prettier on the staged files.

## Make a change

1. Branch from `main`, and target `main` with the pull request.
2. Keep one change per pull request.
3. Add or change tests with the code. A bug fix comes with a test that fails
   without it.
4. Update the docs page the change affects. When users or operators notice
   the change, add one short line under `[Unreleased]` in `CHANGELOG.md`.
   Say what changes for them, not how the code does it. The pull request
   holds the details.
5. Run `npm run lint`, `npm run format:check` and `npm test`. After a change to
   a page, a dialog, a form or sign-in, also run
   `npm run build && npm run test:e2e`.

## Rules a review checks

These break most often. `.agent/ARCHITECTURE.md` and `.agent/STYLE.md` have
the full lists.

- **Routes are thin.** Validate with the route's contract, wrap the handler in
  `asyncHandler`, and call a service. A service throws an `AppError`
  subclass, never a plain `Error`.
- **Accounts stay apart.** A function that touches owned data takes a `Scope`,
  and the id and the owner go in the same SQL statement. Another account's row
  answers `404`. Every route has a row in `server/tenancy/routeManifest.ts`, a
  scoped route has an isolation test, and an admin route mounts
  `requireAdmin` itself.
- **Writes are atomic.** Multi-step writes run in `sqlite.transaction(...)`.
- **AI goes through the gateway.** Call `generateFor` or `streamFor` in
  `server/ai/gateway.ts`. Only `server/ai/adapters/` imports a provider SDK.
- **Outside data is untrusted.** Fetch URLs through `safeFetch`, and resolve
  stored upload paths with `resolveUploadPath()`.
- **The image ships only what the server loads.** A package that only the
  browser uses goes in `devDependencies`, as the build bundles it into
  `dist/`. `tests/unit/repo/dockerRuntime.test.ts` fails on a dependency the
  server never loads, and on a package the server loads that the image would
  not install.
- **Imports name their file.** A relative import in `server/`, `shared/` or
  `scripts/` carries the extension, such as `./geo.ts`.
- **The app fetches with React Query.** Use the hooks in `src/api/`, never a
  `useEffect` fetch.
- **The UI uses the design system.** Use the primitives in
  `src/components/ui/` and the tokens in `src/lib/styles.ts`: no borders for
  sections, one focus ring, 44 px touch targets, no text under 11 px,
  sentence case, and no period at the end of a statement. Tests scan for
  these. Every key binding is a row in `src/lib/shortcuts.ts`.
- **Types are strict.** `any` is an error. Narrow `unknown` instead.
- **Errors are logged.** Use `log.info`, `log.warn` and `log.error`. No
  `console.log` in app code and no empty `.catch(() => {})`.

## Add a route

A route has a contract: one Zod schema for what it reads and one for what it
answers. [API contract](docs/architecture.md#api-contract) explains who reads
it.

1. Add the route's row to `server/tenancy/routeManifest.ts`.
2. In `shared/contracts/<area>.ts`, declare it with `route()`: its method, its
   path as the manifest writes it, a one-line `summary`, its `query` or
   `body`, and its `response`. A response object is a `z.strictObject` that
   lists every field the route sends. Add a new area's routes to `CONTRACTS`
   in `shared/contracts/index.ts`.
3. In the route, check the body with `validateBody(contract.body)` and the
   query with `parseQuery(contract.query, req.query)`.
4. In `src/api/`, call it with `apiJson(contract, path, init)`. The answer
   takes the contract's type, and the method comes from the contract.
5. Run `npm run api:openapi` and commit `docs/openapi.json`.
6. Add a line to `docs/api-reference.md`. A scoped route also needs a case in
   `tests/integration/tenancy.isolation.test.ts`.

Every integration test that uses `makeTestApp()` checks a contracted route's
answers against its contract, so a field the contract does not declare fails
the test that sent it. `UNCONTRACTED` in `shared/contracts/index.ts` lists the
older routes with no contract yet. Take a route off that list when you give
it a contract, and lower `UNCONTRACTED_CEILING` by one in the same change.

## Tests

`npm test` needs no key and no network, and it never opens your database.

- **Unit** tests in `tests/unit/` follow the source tree (see its README).
- **Integration** tests run routes, SQL and triggers on real SQLite.
- **Eval** tests hold search, duplicate and answer quality to a baseline. A
  gate fails when a number moves either way. When the move is intended,
  re-record with `npm run eval:record` (or `:dedupe`, `:answer`) and explain
  the baseline diff in the pull request.
- **Browser** tests drive the production build with Playwright. The first run
  needs `npx playwright install chromium`. See
  [Accessibility](docs/accessibility.md).
- **Contract** tests call real providers. Run them before a release and after
  an adapter change.

The coverage floor is statements 75, branches 62, functions 74 and lines 76,
with its own floor for `server/`. `.agent/TESTING.md` has the rest.

## Docs, the database and the brand

- **Docs** are flat pages in `docs/`, listed in `docs/README.md`, with
  screenshots and GIFs of fictional data in `docs/images/`. Tests fail on a
  broken link or anchor, when `configuration.md`, `api-reference.md` or
  `keyboard-shortcuts.md` misses a variable, a route or a shortcut, and when
  `openapi.json` is not what `npm run api:openapi` writes.
  - Take a screenshot from a production build on a scratch `DATA_DIR` that
    `npm run db:enrich -- --apply --count 400` filled with fictional people.
    Never use real contacts. Docs images are 8-bit palette PNGs.
- **A schema change** is a new migration. `npm run db:new <name>` writes
  `server/db/migrations/NNNN_<name>.ts` and adds it to the list. Write the
  SQL in its `up(db)`, mirror each new table and column in
  `server/db/schema.ts`, and add each new object name to
  `ADDED_SINCE_FIXTURE` in `tests/integration/db.migrations.test.ts`. The
  server applies each migration once, in order, when it starts. Never edit a
  migration that has shipped. Write a new one.
  - The FTS tables, the vector stores and their triggers are rebuilt from
    code, not migrated. Raise their version in `server/db/indexes.ts`, for
    example `FTS_SCHEMA_VERSION` when the full-text columns or triggers
    change.
  - A new owned table needs `ownerId`, a `<table>_owner_required` trigger in
    its migration, and an index that leads with `ownerId`. Its name goes in
    `OWNED_TABLES` in `server/db.ts` and `scripts/tenant-lint.mjs`, and in the
    delete loop of `purgeOwner`.
  - A new `contacts` column also rebuilds the `contacts_auto_updated_at` and
    `contacts_score_dirty` triggers with the new column list
    (`contactEditColumns`). `tests/integration/scoring.incremental.test.ts`
    fails until it does.
- **A new feature** is a folder in `server/modules/` whose `index.ts` exports
  `defineModule({ id, routers, mcpTools, jobs, subscribers, onStart })`, and
  one line in `server/modules/index.ts`. The list order is the order the
  routers mount in. Each route still needs its row in
  `server/tenancy/routeManifest.ts` and its contract (see
  [Add a route](#add-a-route)).
- **Background work** is a job, never a new `setInterval`. Declare it with
  `defineJob({ kind, run, every, atStart })` and list it in its module. A
  job runs only when `DISABLE_BACKGROUND_JOBS` is not `true`, so a test calls
  `runJobNow` or `pollJobs` (`server/jobs/runner.ts`).
- **A reaction to a write** is a subscriber: `{ id, types, handle }` listed in
  its module. The write records the event inside its transaction with
  `recordEvent`, and calls `dispatchEvents()` after it. A new event type gets
  its payload schema in `shared/contracts/events.ts`. A handler schedules
  work and returns. Never rename a subscriber's id after it ships.
- **Brand files** in `public/` and `docs/brand/` are generated from
  `src/assets/corvidPaths.ts` and the rig. Change the source, run
  `npm run brand:icons`, and commit what it writes. Never edit a generated
  file.

## Commits and pull requests

- Write the subject as a plain sentence that says what the change does, such
  as "Search finds nicknames, phone digits and misspelled names".
- The repository squash-merges, so the pull request title becomes the commit.
- The description says what changed and why, then lists the test commands
  with their counts, and what did not run.

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests into `main`, on pushes to it,
on `v*` tags, and by hand.

- `checks`: lint, the format check and a production build.
- `unit-tests`: the tests with coverage, split across four runners with
  `--shard`. Each shard uploads a blob report.
- `coverage`: merges the four blob reports, shows every failure in one place
  and checks the coverage floor.
- `browser-a11y`: the Playwright suite, split across four runners. Each shard
  uploads its report on every run.
- `build-image` and `merge-image`: on a push to `main` or a `v*` tag, one
  image for linux/amd64 and linux/arm64 at `ghcr.io/arvarik/contrack`. `main`
  is tagged `latest` and the short SHA, and a release its version, its
  `major.minor` and its `major`. Each image carries an SBOM, and a signed
  provenance record that `gh attestation verify` checks.
- `scan-image`: Grype scans the pushed image, and its findings go to the
  Security tab. The scan never fails the run.
- `release`: on a `v*` tag, a GitHub release, unless one exists already.

Every job gets a read-only token unless it names more. Every action is pinned
to a commit, with its version in a comment. Dependabot
(`.github/dependabot.yml`) proposes npm, action and dev container updates each
Monday, a week after their release. `.github/workflows/scorecard.yml` runs
OpenSSF Scorecard on `main` each week and feeds the README badge.

A manual run can use the `hppc` self-hosted runner when the hosted pool is
slow. Pull requests from forks never reach it.

## Releases (maintainers)

1. Set the version in `package.json` and move the `[Unreleased]` entries in
   `CHANGELOG.md` under it.
2. Merge to `main`, then tag: `git tag -a vX.Y.Z -m "vX.Y.Z"` and
   `git push origin vX.Y.Z`.
3. Publish the notes before the release job runs, or it writes a commit list:
   `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file notes.md --verify-tag`.

## Report a problem

Open an [issue](https://github.com/arvarik/contrack/issues/new/choose). The bug
form asks for the steps, what you expected, what happened, your version and
install, and the log lines around the error. Every error response has a
request id that the server log repeats. Questions go to
[Discussions](https://github.com/arvarik/contrack/discussions/categories/q-a),
and you can email the maintainer at
[arvind.arikatla@gmail.com](mailto:arvind.arikatla@gmail.com).

For a security problem, post no details in public. [SECURITY.md](SECURITY.md)
says how to report it privately.

Everyone who takes part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Contrack is licensed under the [GNU AGPL v3](LICENSE), and so is every
contribution.
