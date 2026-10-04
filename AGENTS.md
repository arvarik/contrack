# AGENTS.md

Instructions for coding agents that work on Contrack. People read
[CONTRIBUTING.md](CONTRIBUTING.md) first, and the same rules apply to you.

Contrack is a self-hosted personal CRM. One Node process serves a React app and
an Express API over one SQLite file. AI is optional, and search runs on local
models.

## Read before you change code

| File                                             | What it holds                                         |
| ------------------------------------------------ | ----------------------------------------------------- |
| [.agent/ARCHITECTURE.md](.agent/ARCHITECTURE.md) | The stack, the layers, accounts, AI, search and jobs  |
| [.agent/STYLE.md](.agent/STYLE.md)               | The visual rules and the code rules, with their tests |
| [.agent/TESTING.md](.agent/TESTING.md)           | The test projects and the rules a change must follow  |
| [.agent/PHILOSOPHY.md](.agent/PHILOSOPHY.md)     | Why Contrack exists, for a feature or design decision |
| [.agent/STATUS.md](.agent/STATUS.md)             | Where version 2 stands, and the open issues           |
| [CONTRIBUTING.md](CONTRIBUTING.md)               | Set up, commands, review rules and how a change ships |
| [docs/README.md](docs/README.md)                 | The user docs, which a change to behavior must update |

When a file here and the code disagree, the code and its tests win. Fix the
file in the same change.

## Set up

Node.js 26.10 or later is required (`.nvmrc` pins it). Check `node --version`
first, because an older Node on `PATH` makes every npm command fail with
`EBADDEVENGINES`. No API key is needed.

```bash
npm install
npm run dev   # http://localhost:3210
```

Use a scratch `DATA_DIR` and a free `PORT` for a second instance. Never point a
test or a script at somebody's own `curator.db`.

## Check your work

Run these before you say a change is done:

```bash
npm run lint           # Oxlint, tsc --noEmit and the tenant lint
npm run format:check   # Prettier
npm test               # unit, integration and eval tests
```

After a change to a page, a dialog, a form or sign-in, also run
`npm run build && npm run test:e2e`. CI runs `npm run test:coverage`, which
also enforces the coverage floor.

## Rules that agents break most

- Branch from `v2.0`, and target `v2.0` with the pull request.
- A function that touches owned data takes a `Scope`, and every route has a
  row in `server/tenancy/routeManifest.ts`.
- AI calls go through `server/ai/gateway.ts`. Outside URLs go through
  `safeFetch`.
- A relative import in `server/`, `shared/` or `scripts/` names its file
  extension, such as `./geo.ts`.
- `any` is an error, and app code logs with `log`, never `console.log`.
- A schema change is a new migration from `npm run db:new <name>`. Never edit
  a shipped migration.
- Generated files, such as the brand icons and `docs/openapi.json`, change
  only through their script.
- Commit subjects and pull request titles are plain sentences that say what
  the change does.
