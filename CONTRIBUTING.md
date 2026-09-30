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
- Copy `.env.example` to `.env` only to change a default or add a key. The
  [Configuration reference](docs/configuration.md) lists every variable.
- Your data is `curator.db` in the project root. Set `DATA_DIR` to a scratch
  folder for a test instance, and `DISABLE_HMR=true` for a second dev server.

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
| `npm run format`                | Format with Prettier. CI runs `format:check`                     |
| `npm run db:generate`           | Write a Drizzle migration after a schema change                  |
| `npm run brand:icons`           | Redraw every icon and brand file from the corvid's paths         |
| `npm run docs:wiki -- <folder>` | Write the docs as a GitHub wiki                                  |

A pre-commit hook runs Oxlint and Prettier on the staged files.

## Make a change

1. Branch from `v2.0`. Version 2 pull requests target `v2.0`, and `main` holds
   the 1.5 line.
2. Keep one change per pull request.
3. Add or change tests with the code. A bug fix comes with a test that fails
   without it.
4. Update the docs page the change affects, and add a line under
   `[Unreleased]` in `CHANGELOG.md`.
5. Run `npm run lint`, `npm run format:check` and `npm test`. After a change to
   a page, a dialog, a form or sign-in, also run
   `npm run build && npm run test:e2e`.

## Rules a review checks

These break most often. `.agent/ARCHITECTURE.md` and `.agent/STYLE.md` have
the full lists.

- **Routes are thin.** Validate with zod, wrap the handler in `asyncHandler`,
  and call a service. A service throws an `AppError` subclass, never a plain
  `Error`.
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
  screenshots of fictional data in `docs/images/`. Tests fail on a broken link
  or anchor, and when `configuration.md`, `api-reference.md` or
  `keyboard-shortcuts.md` misses a variable, a route or a shortcut.
- **A schema change** edits `src/db/schema.ts`, runs `npm run db:generate`, and
  commits the migration in `drizzle/`. The server applies it on start.
  Virtual tables and triggers live in `server/db.ts`. Bump
  `FTS_SCHEMA_VERSION` when the full-text columns or triggers change. A new
  owned table needs `ownerId`, the owner triggers and an index that leads with
  `ownerId`.
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

`.github/workflows/ci.yml` runs on pull requests into `main` and `v2.0`, on
pushes to them, on `v*` tags, and by hand.

- `build-and-test`: lint, the format check, the tests with coverage, and a
  production build.
- `browser-a11y`: the Playwright suite. Its report is uploaded on every run.
- `build-image` and `merge-image`: on a push to `main` or a `v*` tag, one
  image for linux/amd64 and linux/arm64 at `ghcr.io/arvarik/contrack`. `main`
  is tagged `latest` and the short SHA, a release its version and
  `major.minor`.
- `release`: on a `v*` tag, a GitHub release, unless one exists already.

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

Open an issue with the steps, what you expected, what happened, your Node
version and OS, and the log lines around the error. Every error response has
a request id that the server log repeats.

For a security problem, post no details in public. Open an issue that asks
for a private channel, and the maintainer will reply.

## License

Contrack is licensed under the [GNU AGPL v3](LICENSE), and so is every
contribution.
