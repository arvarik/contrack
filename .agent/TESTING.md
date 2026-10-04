# Testing

How Contrack v2 is tested, and the rules a change must follow. The commands
and the pull request checklist are in `CONTRIBUTING.md`.

## 1. Test projects

| Project       | Where                               | Database                                          | In `npm test`               |
| ------------- | ----------------------------------- | ------------------------------------------------- | --------------------------- |
| `unit`        | `tests/unit/**/*.test.{ts,tsx}`     | `server/db.ts` mocked by `tests/setup.ts`         | Yes                         |
| `integration` | `tests/integration/**/*.test.ts`    | Real SQLite in a temp `DATA_DIR` per file         | Yes                         |
| `eval`        | `tests/eval/*.eval.test.ts`         | Real SQLite, recorded vectors and model answers   | Yes                         |
| `contract`    | `tests/contract/*.contract.test.ts` | Real provider APIs, each skips without its key    | No: `npm run test:contract` |
| e2e           | `tests/e2e/*.spec.ts` (Playwright)  | Its own server per worker on a throwaway data dir | No: `npm run test:e2e`      |

Vitest 5 runs the first four (`vitest.config.ts`) in the Node environment. A
unit test that renders React starts with the comment
`// @vitest-environment jsdom`.

## 2. Where a test goes

- **Unit**: `tests/unit/<root>/<area>/`, where the root is `server`,
  `frontend` (for `src/`), `shared`, `scripts` or `repo`. The file takes the
  name of the module it tests. `tests/unit/README.md` has the table.
- **Integration**: anything that needs real SQL, a route, a migration or a
  trigger. `makeTestApp()` in `tests/integration/helpers.ts` mounts the real
  app from `createApp()`, and the test calls it with supertest. Tenancy suites are
  `tests/integration/tenancy.*.test.ts`.
- **The response check**: `makeTestApp()` parses every 2xx JSON answer of a
  route with a contract in `shared/contracts/` with its `response` schema,
  and compares the status with the contract's. A mismatch fails the test
  that caused it when the test ends, with the route and the Zod issues, even
  when the test never read the body. So every integration test that uses
  `makeTestApp()` is a contract test too. A test that builds its own app with
  `createApp()`, such as the rate limit tests, skips the check. The check
  lives in the test app only: production never parses an answer.
- **Eval**: a quality number with a committed baseline.
- **e2e**: a journey a person takes in the built app, an axe scan, or a
  measurement in the browser. Use the fixtures in `tests/e2e/fixtures/`
  (`test`, `gatedTest`, `completeSetup`, the a11y and metrics helpers).

## 3. Never touch real data

- `tests/setup.ts` mocks `server/db.ts` and gives each unit file its own temp
  `DATA_DIR`.
- `tests/integration-setup.ts` sets a temp `DATA_DIR` before any server module
  loads, sets every provider key to an empty string (not deleted, so `.env`
  cannot refill it), and sets `DISABLE_BACKGROUND_JOBS=true`.
- Under Vitest, `server/db.ts` refuses to open `./curator.db` when `DATA_DIR`
  is unset.
- A script that imports anything under `server/` needs `DATA_DIR`, or it opens
  the checkout's database and runs the boot steps on it.

## 4. AI in tests

No test needs an API key.

- Unit tests mock adapters and the gateway.
- Integration tests run with every key blank, so AI features take their
  no-provider path.
- Eval tests replay recorded embeddings and model answers from
  `tests/fixtures/`. The database, FTS5, KNN, fusion and filters are real.
- Contract tests call real APIs. Each provider block skips when its key is
  absent or rejected. Run them before a release and after any adapter change.

## 5. Quality gates

- **Search** (`search.eval.test.ts`): 300 contacts and 79 queries. recall@10
  and MRR per channel against `search.baseline.json`.
- **Dedupe** (`dedupe.eval.test.ts`): precision and recall on an adversarial
  corpus, with AI off, against `dedupe.baseline.json`.
- **Answer** (`answer.eval.test.ts`): the whole Ask Contrack pipeline: plans,
  results, empty answers, prompt injection in contact data, grounded briefs.
- **Passages** (`passages.eval.test.ts`): the passage index as search evidence.

The gates fail on an improvement as well as a regression. When a change moves
a number on purpose, re-record (`npm run eval:record`,
`eval:record:dedupe`, `eval:record:answer`) and commit the baseline diff with
the change. Say why in the pull request.

- **Coverage floor** (`npm run test:coverage`): statements 75, branches 62,
  functions 74, lines 76, and a separate floor for `server/**`. Raise it when
  the real number rises. Lowering it is a decision for the pull request text.
- **Source scans that run as unit tests**: the style floor and copy rules
  (`tests/unit/frontend/style/`), environment docs (`repo/envDocs.test.ts`),
  docs links and API docs coverage (`repo/docs*.test.ts`), native TypeScript
  imports, the Docker runtime, and the route manifest.
- **Tenancy**: every `scoped` route has a case in
  `tenancy.isolation.test.ts`; `tenancy.queryPlans.test.ts` keeps the owner
  predicate an index seek; `npm run lint:tenant` scans the server's SQL.
- **Contracts** (`tests/integration/contracts.test.ts`): every manifest route
  has a contract or a line in `UNCONTRACTED`, never both, and the list's
  length equals `UNCONTRACTED_CEILING`. A change that contracts a route
  lowers the number, so the list only shrinks. A second test fails when
  `docs/openapi.json` differs from what `npm run api:openapi` writes.
- **Lint**: `npm run lint` (Oxlint, `tsc --noEmit`, the tenant lint) and
  `npm run knip`.
- **Migrations** (`db.migrations.test.ts`): a new database ends at the last
  migration with the schema of `tests/fixtures/schema/v2.0-d67c8a9.sql` plus
  what later migrations add, byte for byte. A database built from that
  fixture upgrades to the same schema and keeps its FTS index. A migration
  that throws keeps nothing. `server/db/schema.ts` names every table and
  column. A new migration adds the name of each object it creates to
  `ADDED_SINCE_FIXTURE`. `tenancy.schema.test.ts` boots the same database
  twice and checks that the second boot changes nothing.
- **Events** (`events.test.ts`): a rename through `PATCH` and through `PUT`
  gets the same reactions, an event in a transaction that rolls back is
  never dispatched, and a subscriber that throws runs again without undoing
  the write.
- **Jobs** (`jobs.test.ts`): `runJobNow` runs with background jobs off, a
  `running` row is queued again at boot, a failing job retries and then ends
  `failed`, and two accounts' jobs take turns. `pollJobs(now)` takes the
  clock as an argument, so a retry an hour out needs no waiting.

## 6. The browser suite

`npm run build && npm run test:e2e`. The first run needs
`npx playwright install chromium`. It drives the production build: axe scans of
every screen in both palettes, the keyboard, dialog, search announcement,
phone form and account journeys, and the 44 px and 11 px measurements. See
`docs/accessibility.md`.

Screenshots that belong in the docs are written to `docs/screenshots/` only
when `DOCS_SCREENSHOTS=1` is set. Otherwise they go to `test-results/`.

## 7. Writing a test that earns its place

- Assert what a person or a client sees: a status, a body, a row, a label.
- A negative control must fail for the right reason. Check that the test fails
  when you break the code it guards.
- Do not replay the implementation in the test, and do not mirror a constant
  back to itself.
- A bug fix comes with a test that failed before the fix.
- No retries. The integration project has none, on purpose: a flaky test is a
  bug to find.
- A new route needs a manifest row and a contract, and a scoped route needs
  an isolation case.
- A new test covers the happy path and the one failure that guards data. The
  suite stays small on purpose.

### When a unit test goes

A unit test goes when one of these holds:

1. Another test asserts the same behaviour through a public interface: an
   integration test, an e2e journey or a more public unit test. Open that
   owner before you delete, and name it in the pull request. Two audits once
   deleted both copies.
2. It tests a test-only seam or dead code. The seam goes with it, and a test
   that needed the seam goes through the public interface instead.
3. It replays the implementation, or mirrors a constant back to itself.

Near duplicates become one `it.each` that keeps every assertion. Keep a test
whatever it overlaps when it guards tenancy, security, the route manifest, a
source scan, an eval gate, a migration or an upgrade, or when it names a
fixed bug. No coverage measure may fall to less than one point above its
floor.

## 8. Reporting results

In a pull request, list the exact commands and their counts, for example
"`npm test`: 351 files, 4,872 tests passed". Say what did not run locally and
why (the browser suite runs in CI). Put a baseline diff and its reason beside
any eval change.
