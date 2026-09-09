# 16. Implementation Prompts

Twelve prompts that hand the 2.0 work to an implementing model, one prompt
per pull request (Phase 2 is five PRs, so five prompts). Each prompt names
what to read, what to build, what not to touch, what to report, and what
success looks like. The phase documents carry the detail; the prompts point
into them by section so the model reads what it needs and nothing more.

## How to use this file

1. Run the prompts in order. Each one assumes the previous PR is merged into `v2.0` and starts from a fresh branch off `v2.0`.
2. Paste **Block A** (the common context) and then the prompt you want, as one message. Block A is written once here so the prompts stay short. Never send a prompt without it. Paste **Block B** (the branch runbook) as well for Prompts 1 and 12, and for any prompt where the model is expected to create branches and open pull requests itself.
3. Fill the two placeholders in Block A: the absolute repository path and the decision answers from [14-risks-and-open-questions.md](14-risks-and-open-questions.md) section 1 (Q13 to Q16) and [15-additional-v2-features.md](15-additional-v2-features.md) section 9.
4. When the model finishes, read its final report against the prompt's success checklist before merging. The checklist is the acceptance test for the PR, not a suggestion. Then run the operator checklist at the end of Block B.
5. If a prompt's work needs two sessions, start the second with Block A, the same prompt, and a line saying what is already done on the branch.

The plan folder must exist in the checkout the model works in. It is
gitignored on `main`; Prompt 1 commits it on `v2.0`. Until Prompt 1 merges,
copy the folder into the working tree by hand.

---

## Block A. Common context (paste above every prompt)

```text
You are implementing part of the Contrack 2.0 multi-tenant project. Work in the
repository at <ABSOLUTE_PATH_TO_REPO>. Read this block fully before the task.

THE PRODUCT
Contrack is a local-first, AI-powered personal CRM: Express 5.2.1 API in server/,
React 19 SPA in src/, one SQLite database through better-sqlite3 (SQLite 3.53.2)
with the sqlite-vec 0.1.9 extension and FTS5. Drizzle ORM supplies types in
src/db/schema.ts and two early migrations in drizzle/; most DDL is idempotent raw
SQL in server/db.ts that runs at import time. TypeScript 6 strict. Vitest 4 with
three projects: unit (mocked database), integration (a real database in a temp
DATA_DIR per test file, createApp() under supertest, AI mocked, AUTH_REQUIRED=""
by default), and contract (real providers, not part of npm test). Node 22.

THE PLAN
docs/multi-tenant-plan/ holds the design. Read README.md there first (five
minutes). The documents you will be pointed at:
  03-architecture.md          decisions, principal model, Scope, guards, names
  04-data-model-and-migration.md  exact DDL, boot order, verification queries
  05..10-phase-*.md           one per phase: context, tasks, acceptance, contract
  12-testing-strategy.md      test inventory, harness, matrix shape
  13-api-changes.md           every endpoint and error code
  14-risks-and-open-questions.md  answered questions; decisions Q1..Q16
  15-additional-v2-features.md    extras and headline features, decision record
  appendix-a-query-inventory.md   every query site with v1.5.5 line numbers
  appendix-b-route-manifest.md    every route and its class
  bench/review-2026-09-08/    measured evidence behind the design
Line numbers in the plan are from v1.5.5. When one has drifted, search for the
function name. If the code disagrees with the plan in a way that changes the
design, stop and report it instead of improvising.

DECISIONS ALREADY MADE (fill in before sending)
  Q13 BM25 offset:        <fix | preserve today's effective weights>
  Q14 mentions cache:     <shared | prefixed>
  Q15 MCP route:          <reorder mount | rename path>
  Q16 per-user limiter:   <add insight and scan | pattern list only>
  Accepted extras (F1..F6) and 2.0 stories: <list, or "none yet">

BRANCH AND PR RULES
- All work lands on the integration branch v2.0. Never push to main. Never
  force-push v2.0. Branch from a fresh v2.0: git fetch && git checkout -b
  v2.0/<phase>-<slug> origin/v2.0. The exact git and gh commands for every
  branch operation are in Block B of this file; follow them as written.
- One PR per prompt unless the prompt says otherwise, into v2.0, squash-merged
  by a human. Title: feat(tenancy): <phase>, <what>. Commit subjects use
  type(area): subject. No AI attribution anywhere: no Co-Authored-By trailers,
  no "generated with" lines, no session links, in commits or in the PR body.
- package.json stays at 1.5.5 until the release prompt. Add your CHANGELOG
  lines under ## [Unreleased] prefixed with the phase.
- PR body: one plain sentence saying what the PR adds and why; then short
  sections in this order as they apply: what users or the API see, how it
  works, operational behavior, guarantees; nested bullets for reviewer
  context; a Testing section with the exact commands and the raw vitest
  summary lines. No semicolons. No em-dashes. Short sentences.
- Before opening the PR: npm run lint, npm test, npm run build, and
  npm run format:check all pass locally. Paste the vitest summary line
  (Test Files N passed (N) / Tests N passed (N)) into the PR and into your
  final report. "Green" without that line is not green.

CODING RULES FOR THIS PROJECT
- Every repository or service function that reads or writes an owned table
  takes scope: Scope as its FIRST parameter. A user-supplied id and the scope go
  in the SAME SQL statement (WHERE id = ? AND ownerId = ?). Never select by id
  and compare in JavaScript. A miss is NotFoundError (404), identical body for a
  foreign id and a nonexistent id.
- Routes call scopeOf(req) once and pass it down. Routes never read ownerId
  from the body or query string.
- SSE and NDJSON handlers capture scope in the closure before subscribing or
  awaiting. Never call currentScope() inside an EventEmitter listener; the
  listener runs in the emitter's async context, not the request's.
- Background jobs run per owner inside runWithContext({ scope:
  scopeForOwnerId(id), principal: null, requestId: "job-..." }, fn).
- sqlite-vec 0.1.9: filter KNN with AND ownerId = ?; never IN (...) on a
  partition column; k at most 4096; upserts are DELETE then INSERT; never
  UPDATE a partition column; never ALTER TABLE RENAME a vec0 table.
- Statements over owned tables that legitimately carry no owner predicate get
  // tenant-lint: allow <reason> on the line above, reason one of: instance
  sweep, owner-checked by caller, boot migration, admin cross-user, derived table.
- Keep existing patterns: prepared statements in module-level stmts objects,
  asyncHandler on every route, AppError subclasses, validateBody with zod,
  log.info/warn/error with a component tag.
- Do not widen scope. If you find a bug outside the prompt, note it in the
  report; fix it only if the prompt or the phase document says so.

WHEN TO STOP AND REPORT INSTEAD OF CONTINUING
- A test in the existing suite fails for a reason you do not understand.
- A migration step would need to run in a different order than the phase
  document specifies.
- A sqlite-vec, FTS5, or Express behavior differs from what the plan states.
- You would need a new runtime dependency the prompt did not authorize.
- The work would take a different shape than the phase document's acceptance
  criteria describe.

FINAL REPORT FORMAT
1. What you built, in five lines or fewer.
2. The PR title and the full PR body you propose.
3. The raw vitest, lint, and build output summaries.
4. The success checklist from the prompt with each box ticked or explained.
5. Anything you found that the plan did not anticipate.
```

---

## Block B. Branch and release operations runbook

For the operator and for the model. Every command is for this repository:
GitHub `arvarik/contrack`, default branch `main`, `gh` installed and
authenticated, CI workflow `.github/workflows/ci.yml` with the job
`build-and-test`. Ordinary PRs are squash-merged. The release PR is merged
with a merge commit. Nothing is ever force-pushed.

### B.1 Names

| Thing | Convention | Example |
| ----- | ---------- | ------- |
| Integration branch | `v2.0` | `v2.0` |
| Work branch | `v2.0/<phase>-<slug>` | `v2.0/phase-2e-dedupe`, `v2.0/extra-nudges` |
| PR title | `feat(tenancy): <phase>, <what>` | `feat(tenancy): phase 2e, scope the dedupe engine` |
| Extras | `feat(<area>): <what>` | `feat(capture): quick capture inbox` |
| Commit subject | `type(area): subject`, imperative, no trailer | `fix(db): drop FTS triggers around the claim` |
| Labels | `2.0`, plus `phase-0` to `phase-5` or `extra` | |
| Release PR | `release: v2.0.0, multi-user Contrack` | |
| Tag | `v2.0.0` | |

### B.2 One-time setup (operator, before Prompt 1)

```bash
cd <repo>
git checkout main && git pull --ff-only
git checkout -b v2.0
git push -u origin v2.0
```

Protect the branch so nothing lands without a PR and a green check. In
GitHub: Settings, Branches, Add rule for `v2.0`: require a pull request,
require the `build-and-test` status check, block force pushes. The same
rule already applies to `main`. Until Prompt 1's first PR merges, CI does
not run on PRs into `v2.0`, so merge that PR on the strength of a local
`npm run lint && npm test`.

Optional labels:

```bash
for l in 2.0 phase-0 phase-1 phase-2 phase-3 phase-4 phase-5 extra release; do
  gh label create "$l" --color 1d76db --force
done
```

### B.3 Starting a prompt's work (model)

```bash
git fetch origin
git checkout -b v2.0/<phase>-<slug> origin/v2.0
git status                      # clean tree, on the new branch
npm ci                          # only if package-lock changed upstream
npm test                        # green before you touch anything
```

Commit in small steps with `type(area): subject`. Never add `Co-Authored-By`,
`Claude-Session`, or any generated-with line. If a hook adds one, remove it
with `git commit --amend` before pushing.

### B.4 Opening the PR (model or operator)

```bash
npm run lint && npm test && npm run build && npm run format:check
git push -u origin v2.0/<phase>-<slug>
gh pr create --base v2.0 --head v2.0/<phase>-<slug> \
  --title "feat(tenancy): <phase>, <what>" \
  --body-file /tmp/pr-body.md --label 2.0 --label <phase-label>
gh pr checks --watch            # wait for build-and-test
```

The body file follows the format in Block A. The Testing section carries
the raw `Test Files ... / Tests ...` lines. If the PR also ticks acceptance
boxes or adds `bench/` files, say so in the body.

A PR whose diff passes about 1,500 lines is a candidate for splitting, as
several prompts note. Split by the prompt's own sub-lists, never by file
type.

### B.5 Merging a PR (operator only)

```bash
gh pr view <n> --json title,statusCheckRollup,reviewDecision
gh pr merge <n> --squash --delete-branch --subject "<PR title> (#<n>)"
git checkout v2.0 && git pull --ff-only
```

Rules: the model never merges. Merge only when `build-and-test` is green and
the report's checklist is satisfied. The squash subject is the PR title, so
`v2.0` reads as one commit per prompt. After the merge, watch the push to
`v2.0` run CI once more; it must stay green (see B.9).

### B.6 Keeping `v2.0` current with `main` (operator)

Do this at every phase boundary, whenever a hotfix lands on `main`, and once
more before the release PR.

```bash
git checkout v2.0 && git pull --ff-only
git fetch origin main
git merge --no-ff origin/main -m "merge: main into v2.0 after <what landed on main>"
npm ci && npm run lint && npm test && npm run build
git push origin v2.0
```

This is a merge commit on `v2.0`, and that is intended: the branch is
shared, so it is never rebased. If the merge conflicts, see B.7. Never
resolve a conflict by taking one side wholesale in `server/db.ts` or
`server/app.ts`.

### B.7 Conflicts in the files that will conflict

| File | Why it conflicts | How to resolve |
| ---- | ---------------- | -------------- |
| `server/db.ts` | Section order is load-bearing (tenancy block before FTS, triggers dropped around the claim) | Keep the `v2.0` order. Re-apply the `main` change inside the right section. Run the migration test and `npm run tenancy:verify` on a fresh database before committing. |
| `server/app.ts` | Middleware order (request id, limiters, `attachPrincipal`, `attachRequestContext`, guards, router mounts) | Keep the `v2.0` order. Re-run `tenancy.routeManifest.test.ts`. |
| `CHANGELOG.md` | Both sides add under `Unreleased` | Keep both. Phase blocks stay grouped; `main` entries go under their own heading. |
| `package.json`, `package-lock.json` | Scripts and dependency bumps | Keep both script sets. For the lock file, take `main`'s version bumps, then `npm install` and commit the regenerated lock. |
| `src/api/*.ts` | Phase 4 migrates every module to the shared handler | Keep the shared handler and re-apply the `main` change on top. |
| `docs/api-reference.md`, `docs/configuration.md` | Phase 5 rewrites sections | Keep the 2.0 text and fold the `main` change in by hand. |
| `tests/integration/*.test.ts` | New assertions on both sides | Keep both. Run the file alone, then the suite. |

After any conflict resolution: full `npm test`, plus `npm run tenancy:verify`
if `server/db.ts` was involved.

### B.8 What may run in parallel

Prompts share files, so most of them are sequential. This is the whole
allowed overlap:

| Can start | After | Notes |
| --------- | ----- | ----- |
| Prompt 2 | Prompt 1 merged | |
| Prompts 3 to 7 | the previous one merged | Sequential. They share `contactRepository`, `contactService`, the dedupe files, and `aiCache`. |
| Prompt 8 | Prompt 7 merged | |
| Prompt 9, PR 1 | Prompt 8's endpoints stubbed or merged | The UI can be built against `13-api-changes.md` shapes. |
| Prompt 9, PR 2 | Prompt 8 merged | |
| Prompt 10 items | their listed dependency phase merged | The MCP server needs Phase 3 tokens; Quick Capture needs 2a and 2b; Nudges need 3.8 and Phase 4 for the UI. Extras can run alongside Prompts 8 and 9 on their own branches when they touch no shared file. |
| Prompt 11 | every accepted item merged | |
| Prompt 12 | Prompt 11 merged | |

Two work branches open at once must touch disjoint files. If in doubt,
serialize.

### B.9 When `v2.0` goes red

A push to `v2.0` (a squash merge) can fail CI even though the PR was green,
usually because two PRs merged close together. Fix forward within the day
or revert:

```bash
git checkout v2.0 && git pull --ff-only
git revert <squash-sha> --no-edit
git push origin HEAD:refs/heads/revert-<n>      # then open a PR into v2.0
```

Revert through a PR, not by pushing to `v2.0`. `v2.0` is the base for the
next prompt, so it must be green before that prompt starts.

### B.10 Hotfixes to 1.5.x during the project

A production bug on `main` is fixed on `main` first, in the normal way:

```bash
git checkout -b fix/<slug> origin/main
# fix, test
gh pr create --base main ...
# after merge, release a 1.5.x patch per docs/ci-and-release.md if needed
```

Then merge `main` into `v2.0` (B.6) so the fix is not lost in 2.0. Never
cherry-pick from `v2.0` to `main` before the release.

### B.11 Running 2.0 locally against real data

Never point a `v2.0` build at the production `DATA_DIR`. The first boot
migrates the database in place (with a backup) and rewrites upload URLs.

```bash
cp -R /path/to/production/data /tmp/contrack-2.0-trial
DATA_DIR=/tmp/contrack-2.0-trial AUTH_REQUIRED=false npm run dev
# watch the boot log for the tenancy steps and their durations
DATA_DIR=/tmp/contrack-2.0-trial npm run tenancy:verify
```

Repeat with `AUTH_REQUIRED=true` on a second copy. Both runs are part of
the Phase 1 and Phase 5 rehearsals.

### B.12 Recovery

- **A work branch is broken beyond repair.** Delete it and start the prompt again from `origin/v2.0`. Nothing on a work branch is authoritative until it merges.
- **Someone force-pushed `v2.0`.** Find the last good commit from the merged PRs (`gh pr list --base v2.0 --state merged --json mergeCommit,title`) or from a local `git reflog`, restore it with a normal push from a machine that has it, and re-enable the branch protection rule that should have stopped it.
- **A merged PR must be undone.** B.9. Never rewrite `v2.0` history.
- **The plan folder and the code disagree.** The code that merged wins for what exists; fix the document in the next PR that touches that area, and say so in that PR's body.

### B.13 Release and retirement

The full procedure with commands is section 4 of
[10-phase-5-hardening-release.md](10-phase-5-hardening-release.md) and
Prompt 12. In one screen:

```bash
# freeze
git checkout v2.0 && git pull --ff-only && git merge --no-ff origin/main
npm run lint && npm test && npm run build && npm run test:contract
# version PR into v2.0 (squash-merged): npm version major --no-git-tag-version, CHANGELOG [2.0.0]
# release PR into main, merged with a merge commit by the operator:
gh pr create --base main --head v2.0 --title "release: v2.0.0, multi-user Contrack" --body-file /tmp/release.md
gh pr merge <n> --merge --subject "release: v2.0.0"
# tag and notes, before the workflow's release job:
git checkout main && git pull --ff-only
git tag -a v2.0.0 -m "v2.0.0" && git push origin v2.0.0
gh release create v2.0.0 --title "v2.0.0" --notes-file /tmp/notes.md --verify-tag
```

After the first patch release or two weeks: delete `v2.0`
(`git push origin --delete v2.0`), remove `"v2.0"` from
`.github/workflows/ci.yml` and `docs/ci-and-release.md`, and move
`docs/multi-tenant-plan/` to `docs/archive/multi-tenant-2.0/`, restoring the
ignore line. One `chore(ci)` PR.

### B.14 Operator checklist between prompts

- [ ] The model's final report has the vitest, lint, and build summaries, and every checklist box is ticked or explained.
- [ ] `gh pr checks <n>` shows `build-and-test` green.
- [ ] The PR body follows the format (no semicolons, no em-dashes, no AI attribution, Testing section with raw summaries).
- [ ] Acceptance boxes in the phase document are ticked in the PR, and any `bench/` file the prompt required is present.
- [ ] Squash-merge with the PR title as subject. Confirm the resulting push to `v2.0` is green.
- [ ] At a phase boundary: merge `main` into `v2.0` (B.6) and confirm green.
- [ ] Record decisions the model asked for in `14-risks-and-open-questions.md` or the decision record in `15-additional-v2-features.md`.
- [ ] Start the next prompt from a fresh `origin/v2.0`.

---

## Prompt 1. Phase 0: foundations and safety net

```text
TASK
Implement Phase 0 as specified in docs/multi-tenant-plan/05-phase-0-foundations.md.
This is three PRs, in this order:
  PR 1  task 0.0 only: the v2.0 branch, CI for it, and the plan folder committed.
  PR 2  task 0.10 only: the BM25 weight offset fix (skip this PR if Q13 says "preserve").
  PR 3  everything else in the phase.
Branches: v2.0/phase-0-branch-ci, v2.0/phase-0-bm25, v2.0/phase-0-foundations.

READ FIRST
- 05-phase-0-foundations.md, all of it. Section 0.3 lists the v1.5.5 facts the
  tasks depend on; section 8 lists the names you must use.
- 03-architecture.md sections 4, 5, and 14.
- appendix-b-route-manifest.md (the seed for ROUTE_MANIFEST) and its review notes.
- 12-testing-strategy.md sections 2, 4, and 5.
- Code: server/app.ts, server/middleware/auth.ts, server/middleware/rateLimit.ts,
  server/services/authService.ts, server/services/contactService.ts (buildInsertValues),
  server/services/search/hybridRetrieval.ts:113, tests/integration/helpers.ts,
  tests/integration-setup.ts, .github/workflows/ci.yml, .gitignore.

FACTS THAT SHAPE THE WORK
- CI runs only for pull requests into main today. Until PR 1 merges, nothing
  you open against v2.0 is tested by CI. Verify the build-and-test job runs on
  PR 1 before merging it.
- docs/multi-tenant-plan/ is gitignored. PR 1 removes that line and commits the
  folder. Every later PR ticks acceptance boxes in these documents.
- Express 5 does not store mount path strings. app.router is a lazy getter,
  layers have no regexp, and layer.path is set only after layer.match(). The
  manifest test must record mount paths by wrapping Router.prototype.use and
  app.use while createApp() runs (task 0.3). Do not try to rebuild prefixes
  from the stack alone.
- GET /api/debug/cache-stats is registered in server.ts, outside createApp().
  Move it inside createApp() behind the same NODE_ENV guard and mark it devOnly.
- The AI rate limiter mounts before req.requestId is assigned and before
  attachPrincipal. Move the request id assignment above the limiter (task 0.2).
- An EventEmitter listener sees the emitter's async context. The context unit
  test must prove this (task 0.2). A multipart upload with one text field must
  keep the context in the handler after multer, or the fallback in the phase
  document applies (multer issue #1111).
- bm25() weights are positional and include UNINDEXED columns. Task 0.10's
  unit test pins that rule.

DO THIS, IN ORDER
1. PR 1: create v2.0 from main; add "v2.0" to on.pull_request.branches and
   on.push.branches in .github/workflows/ci.yml without touching the image or
   release job conditions; remove docs/multi-tenant-plan/ from .gitignore and
   commit the folder. Open the PR, confirm CI ran, stop and report so a human
   can merge before you continue.
2. PR 2 (if Q13 is "fix"): task 0.10. Ten weights, position 0 is 0.0. Add the
   positional unit test. Its own CHANGELOG line marked as a ranking change.
3. PR 3: tasks 0.1 to 0.9, 0.11, 0.12 in the order the document lists them.
   Build server/tenancy/scope.ts and requestContext.ts exactly as written
   (names in section 8). Build the route recorder and the manifest test.
   Build the tenant lint in report mode and commit its baseline to bench/.
   Stamp ownership from the request context at every insert site in task 0.5.
   Build the two-user harness and the it.todo matrix skeleton. Write the
   benchmark script and commit bench/baseline-phase-0.md. Apply the comment
   and doc corrections in task 0.9. Reorder the router mounts (task 0.11)
   and add the reachability test.
4. Tick the acceptance boxes in section 4 of the phase document in PR 3.

CONSTRAINTS
- No WHERE ownerId = ? on any read. No change to the Principal union. No
  schema change. A single-account instance must behave exactly as before.
- All 575 existing tests must still pass unchanged.

DELIVER
Three PRs as above, each with the body format from Block A, plus the final
report.

SUCCESS CHECKLIST
- [ ] PR 1 merged first; a later PR into v2.0 shows the build-and-test job.
- [ ] docs/multi-tenant-plan/ is tracked on v2.0, bench/ included.
- [ ] server/tenancy/scope.ts exports Scope, OwnerId, scopeOf, scopeForUser, scopeForOwnerId, ownerToken, contactToken; the token unit test compares against SQLite's replace().
- [ ] server/tenancy/requestContext.ts exports runWithContext, getContext, currentScope, currentScopeOrNull, attachRequestContext; mounted after attachPrincipal; req.requestId assigned before the AI limiter; a limiter 429 carries a requestId.
- [ ] Context tests prove: survives await/setTimeout/setImmediate/Promise.all; emitter rule; NO_SCOPE outside a context; multipart-with-text-field case passes or the fallback is recorded.
- [ ] tenancy.routeManifest.test.ts passes with every route classified, including the devOnly rows and the USE /uploads static row; the recorder is used, not a naive stack walk.
- [ ] scripts/tenant-lint.mjs runs in npm run lint in report mode; bench/tenant-lint-baseline.txt committed; the unit test covers flag, allow, unknown reason, non-owned table.
- [ ] Stamping test: contacts, lists, ghost from a mention, merge log, AI invocation all carry the signed-in user's id with auth on, without a restart.
- [ ] tests/integration/tenancy/helpers.ts exports createActor, asUser, seedOwner, rowsOwnedBy, resetAccounts.
- [ ] tenancy.isolation.test.ts has one it.todo per scoped route.
- [ ] bench/baseline-phase-0.md committed with 1 x 5000 and 10 x 2000, including the PATCH cost.
- [ ] GET /api/contacts/action-items returns the MCP payload; GET /api/contacts/<uuid> still works.
- [ ] Corrections applied: auth.ts comments, schema.ts "ten" tables, db.ts second 2a label, ARCHITECTURE.md invariant, TESTING.md three projects, STATUS.md test count.
- [ ] npm test: all previous 575 tests pass plus the new files; lint, build, format:check green; summaries pasted.
- [ ] CHANGELOG Unreleased has a Phase 0 block (and a separate BM25 line if PR 2 shipped).
- [ ] Acceptance boxes in 05-phase-0-foundations.md section 4 are ticked in the PR.
```

---

## Prompt 2. Phase 1: storage and migration

```text
TASK
Implement Phase 1 as specified in docs/multi-tenant-plan/06-phase-1-storage.md.
One PR from v2.0/phase-1-storage. This PR changes the schema, the boot
sequence, the principal model, uploads layout, and the FTS triggers. It is
the riskiest PR of the project. Work in the task order the document gives.

READ FIRST
- 06-phase-1-storage.md, all of it. Section 0.3 is a map of server/db.ts;
  section 0.4 lists the verified engine behaviors; section 2 has the exact DDL.
- 04-data-model-and-migration.md sections 1, 3, 4, 5, 6, 10, 11, 14.
- 03-architecture.md sections 4.1, 4.2, 6, 7.
- bench/review-2026-09-08/README.md, and run script 01 as your day-one smoke test.
- Code: server/db.ts (whole file), server/services/authService.ts,
  server/services/passwords.ts, server/middleware/auth.ts,
  server/services/search/localEmbeddings.ts, server/services/dedupe/embeddings.ts,
  server/utils/paths.ts, server/routes/contacts.ts:60-80,
  server/routes/interactions.ts:30-55, tests/integration/api.auth.test.ts,
  scripts/seed.ts, scripts/seedMock.ts, src/db/schema.ts.

FACTS THAT SHAPE THE WORK
- Order is not negotiable. The tenancy block runs before the FTS block because
  the FTS backfill references contacts.ownerId and fails at prepare time on a
  fresh database if the column is missing. Every integration file boots a
  fresh database, so a wrong order fails the whole suite.
- The claim UPDATE and the child backfill must run with the eleven FTS
  triggers, the three _auto_updated_at triggers, and the three
  action_items_sync_* triggers dropped. Otherwise the claim costs 5 ms per
  contact and stamps updatedAt on every row, which makes the next deep dedupe
  scan re-embed the corpus through the paid provider. Sections 3 to 6 of
  db.ts recreate all seventeen on the same boot.
- VACUUM INTO fails inside a transaction. The backup runs before
  sqlite.transaction() opens.
- authService.ts imports from db.ts, so db.ts cannot import authService.
  ensureLocalOwner, primaryAdminId, and claimUnownedData live in db.ts as raw
  SQL and are exported.
- Every FTS trigger delete becomes MATCH 'cidTok:...'. Never WHERE contactId = ?.
- dedupe_exclusions has no id column; its fill trigger keys on the composite
  primary key.
- vec0: copy-rebuild only. UPDATE of a partition column is refused. An INSERT
  without ownerId silently gets a NULL partition, so the verify script counts
  those. vec_version() returns "v0.1.9"; parse the numbers.
- requireUser becomes requireSession and returns 403 SESSION_REQUIRED (was
  USER_REQUIRED). Seven call sites in routes/auth.ts. api.auth.test.ts:379
  asserts the old code.
- wipeAccounts() in api.auth.test.ts runs DELETE FROM users, which fails once
  the local owner owns rows. Task 1.13 gives the new reset shape.
- scripts/seed.ts and seedMock.ts insert contacts with no ownerId and will hit
  the required trigger (task 1.14).

DO THIS, IN ORDER
1. Run bench/review-2026-09-08/01-vec-fts-smoke.cjs against node_modules and
   also run INSERT OR REPLACE against a partitioned vec0 table. Paste both
   outputs into the PR. If INSERT OR REPLACE fails, the dedupe upsert becomes
   DELETE then INSERT (task 1.5).
2. Tasks 1.1 to 1.16 in the document's order. Build the tenancy block with the
   exact section order in task 1.8's table. Generate the FTS triggers from one
   template (task 1.4) and snapshot-test the SQL.
3. Build tests/fixtures/make-v1-database.ts and the migration test (task 1.12)
   before you consider the migration done. It must assert updatedAt unchanged,
   embedBatch never called, seventeen triggers present, second boot silent, and
   the auth-on variant.
4. Write scripts/tenancy-verify.ts and scripts/tenancy-rollback-uploads.mjs.
5. Run the full suite with AUTH_REQUIRED="" (default) and once with
   AUTH_REQUIRED=true set in tests/integration-setup.ts locally, to exercise
   both principal paths. Report both summaries.
6. Do the rollback rehearsal on a copy of a real 1.5.5 database if one is
   available to you, else on the fixture, and write bench/rollback-rehearsal.md.
7. Tick the acceptance boxes in section 3 of the phase document.

CONSTRAINTS
- No WHERE ownerId = ? on reads. requireAdmin exists but is mounted nowhere.
  No /uploads guard yet. Do not drop the single-column owner indexes.
- No provider API call may happen during boot on the migration fixture.

DELIVER
One PR with the body format from Block A, the smoke outputs, both suite
summaries, the boot log of the migration test showing per-step durations,
and the final report.

SUCCESS CHECKLIST
- [ ] Fresh database boots; every integration file passes; the boot order matches task 1.8's table.
- [ ] tenancy.migration.test.ts passes: verification queries 1 to 11 pass, vector counts and the fixed KNN result unchanged, updatedAt byte-identical, embedBatch never called, backup file present and opens with the old shape, second boot logs no change, auth-on variant keeps the real account.
- [ ] npm run tenancy:verify passes on a fresh database and on the migrated fixture.
- [ ] Updating 1,000 contacts on a 5,000-contact database takes under 500 ms (trigger cost test).
- [ ] FTS rebuild time is logged and under 1 s for 10,000 contacts.
- [ ] Boot refuses to start with a clear message when vec_version() is below 0.1.6 (unit test with a stubbed statement).
- [ ] Day-one smoke output and the INSERT OR REPLACE result are in the PR.
- [ ] Uploads: relocated files exist under uploads/u/<ownerId>/..., URLs rewritten, orphans under uploads/orphaned/, multer destinations use req.principal.
- [ ] Principal union is the four-variant user union; requireSession returns SESSION_REQUIRED; requireAdmin exists; the local owner is the implicit principal when auth is off; a disabled account is refused; the forced-auth boot rule works; "local" username is rejected.
- [ ] api.auth.test.ts green with the updated assertions; the harness reset survives the local owner.
- [ ] npm run seed works on a fresh DATA_DIR.
- [ ] src/db/schema.ts mirrors every new column and table; tsc passes.
- [ ] bench/rollback-rehearsal.md committed with commands and output.
- [ ] Both suite runs (auth off, auth on) green; lint, build, format:check green; summaries pasted.
- [ ] CHANGELOG Unreleased has a Phase 1 block including the SESSION_REQUIRED breaking change and the measured trigger fix.
- [ ] Acceptance boxes in 06-phase-1-storage.md section 3 ticked.
```

---

## Prompt 3. Phase 2a: contacts core and the uploads guard

```text
TASK
Implement sub-phase 2a from docs/multi-tenant-plan/07-phase-2-scoping.md.
One PR from v2.0/phase-2a-contacts. This is the first sub-phase that adds
owner predicates, and it defines the helpers every later sub-phase reuses.

READ FIRST
- 07-phase-2-scoping.md sections 0.2, 0.3, 0.4, and 2a.
- 03-architecture.md section 5 (Scope rules) and section 10 (uploads).
- 12-testing-strategy.md section 3 (matrix shape).
- appendix-a-query-inventory.md rows for contactService, contactRepository,
  routes/contacts.ts, and section A2.
- Code: server/repositories/contactRepository.ts, server/services/contactService.ts,
  server/routes/contacts.ts, server/utils/avatarProcessor.ts, server/app.ts,
  server/utils/AppError.ts, tests/integration/api.contacts.test.ts.

FACTS THAT SHAPE THE WORK
- Add findOwned, findOwnedActive, findManyOwned, requireOwned to
  contactRepository first. Every later sub-phase calls them.
- hydrate and hydrateMany do not change, but they read lists and interactions
  by contact id; those statements get // tenant-lint: allow owner-checked by caller.
- getSlimContacts is seven statements; pass 2 has an inner
  SELECT id FROM contacts subselect that needs the owner predicate.
- hardDeleteContact, the Doc2Query fire-and-forget blocks, and the non-stream
  bulk import tail were missed by the first inventory; the 2a table lists them
  with line numbers.
- The import-time duplicate matching in routes/contacts.ts calls three dedupe
  functions (normalizeContacts, loadNegativeConstraints, normalizeContactById).
  Change only those three signatures in this PR so routes/contacts.ts can go
  strict; the rest of dedupe waits for 2e.
- explainScore writes relationshipScore; the allow comment covers that UPDATE.
- The uploads guard is a regex on req.path against req.principal.user.id, no
  database read, mounted between requireAuth and express.static.

DO THIS
1. Repository helpers, then contactService functions in the 2a table order,
   then routes/contacts.ts, then avatarProcessor, then the guard.
2. Move server/repositories/contactRepository.ts, server/services/contactService.ts,
   server/routes/contacts.ts, server/utils/avatarProcessor.ts, and
   server/middleware/uploads.ts into the tenant-lint --strict glob.
3. Replace every it.todo for routes in server/routes/contacts.ts and for
   /uploads with real matrix tests per section 0.4. Flip isolated: true for
   each in ROUTE_MANIFEST.
4. Run the existing api.contacts, api.lifecycle, api.avatar suites; they run
   as the local owner and must pass unchanged.
5. Tick the 2a-relevant items in the phase's acceptance list and add the
   Phase 2a CHANGELOG line.

CONSTRAINTS
- Do not convert interactions, lists, search, dashboard, dedupe (beyond the
  three functions), AI, export, or MCP. Do not mount requireAdmin.
- invalidateAllCaches may keep the whole-tier flush with a TODO(2f) comment.

SUCCESS CHECKLIST
- [ ] findOwned, findOwnedActive, findManyOwned, requireOwned exist and are used; no service selects by id then compares in JavaScript.
- [ ] Every function in the 2a table takes scope first; every owned-table statement in the five files carries ownerId or an allow comment with a listed reason.
- [ ] tenant-lint --strict passes for the five files.
- [ ] Matrix tests for every contacts route and /uploads are real and green: foreign id 404 with a body identical to a random UUID's 404; bulk operations affect only the caller's rows and report the right count; A's rows unchanged after B's attempts.
- [ ] guardUploads: B fetching A's avatar 404, A 200, /uploads/logos/* 200 for both, any other /uploads path 404.
- [ ] Doc2Query and the bulk-import tail run inside runWithContext with the captured scope; recordInvocation rows from them carry the owner.
- [ ] Existing contacts, lifecycle, and avatar suites pass unchanged.
- [ ] isolated: true flipped for every route in this PR.
- [ ] lint, test, build, format:check green; summaries pasted.
```

---

## Prompt 4. Phase 2b and 2d: interactions, action items, lists, dashboard, zero-state

```text
TASK
Implement sub-phases 2b and 2d from docs/multi-tenant-plan/07-phase-2-scoping.md
as one PR from v2.0/phase-2b-2d-timeline-dashboard, or two PRs if the diff
passes 1,500 lines (2b first).

READ FIRST
- 07-phase-2-scoping.md sections 0.3, 0.4, 2b, and 2d.
- appendix-a-query-inventory.md rows for interactionService, actionItemService,
  listService, dashboardService, zeroStateService, relationshipService, and A2.
- Code: server/services/interactionService.ts, server/services/actionItemService.ts,
  server/services/listService.ts, server/routes/interactions.ts,
  server/routes/actionItems.ts, server/routes/lists.ts,
  server/services/dashboardService.ts, server/services/zeroStateService.ts,
  server/routes/dashboard.ts, server/utils/aiCache.ts:100-110,
  tests/integration/api.interactions.test.ts.

FACTS THAT SHAPE THE WORK
- interactionService has 18 Drizzle calls, not 6. Two mention paths exist: the
  AI path resolves names with eq(contacts.name, m.name) and writes
  interactions.mentions JSON; the explicit data-id path inserts client-supplied
  ids into interaction_mentions with INSERT OR IGNORE and no check. Both need
  the owner guard. The mention-extraction setTimeout captures scope and runs
  inside runWithContext.
- actionItemService keeps its JOIN contacts for the payload columns; only the
  owner predicate moves to action_items using the composite indexes.
- listService.createList's MAX(sortOrder) is unscoped; removeMember checks
  nothing today; bulkAddMembers checks the list only.
- dashboardService: nine statements in getDashboardPayload (:57-191), six in
  getInsight (:232-295). The dailyInsight cache key becomes the owner id and
  its maxEntries goes from 1 to 100.
- zeroStateService has five statements, not six.
- relationshipService does not change beyond allow comments (its UPDATE in
  explainScore included).

DO THIS
1. 2b in the table order, then 2d.
2. Move the nine files into the strict glob.
3. Replace the it.todo entries for every route in routes/interactions.ts,
   routes/actionItems.ts, routes/lists.ts, and routes/dashboard.ts with real
   tests; flip isolated: true.
4. Add the 2d isolation tests: B's dashboard totals are zero after A seeds 50
   contacts; B's zero-state lists none of A's contacts; B's insight is not A's
   cached insight.
5. Existing api.interactions and list tests pass unchanged. CHANGELOG lines.

CONSTRAINTS
- MCP routes stay for 2g, but mcpService statements for interactions may gain
  the predicate here only if it keeps the file compiling; otherwise leave
  mcpService untouched.
- No changes to search, dedupe, AI Search, export.

SUCCESS CHECKLIST
- [ ] Every function in the 2b and 2d tables takes scope first with the predicate in the same statement.
- [ ] Both mention paths guard ownership; a ghost from a mention carries the caller's owner; a client-supplied foreign contact id in data-id is dropped, not linked.
- [ ] Each owner's lists number from zero; reorder with a foreign id returns 404; removeMember and bulkAddMembers verify both list and contact.
- [ ] Pending, completed, and urgent action item queries use idx_action_items_owner_due or idx_action_items_owner_done (check with EXPLAIN QUERY PLAN in a quick test).
- [ ] Dashboard, insight, and zero-state scoped; dailyInsight keyed per owner with maxEntries 100.
- [ ] tenant-lint --strict passes for all nine files.
- [ ] Matrix tests real and green for every route in the four route files; isolated flipped.
- [ ] Existing interaction, action item, list, and dashboard tests pass unchanged.
- [ ] lint, test, build, format:check green; summaries pasted.
```

---

## Prompt 5. Phase 2c and 2f: search, embeddings, AI cache, AI stats, AI Search batches

```text
TASK
Implement sub-phases 2c and 2f from docs/multi-tenant-plan/07-phase-2-scoping.md
as one PR from v2.0/phase-2c-2f-search-ai, or two PRs (2c first) if the diff
passes 1,500 lines.

READ FIRST
- 07-phase-2-scoping.md sections 0.3 (rules 6, 7, 10 especially), 2c, and 2f.
- 03-architecture.md sections 6, 7, and 9.
- appendix-a-query-inventory.md rows for searchService, hybridRetrieval,
  localEmbeddings, dedupe/embeddings, aiCache, aiStatsService, aiSearch/*, and A2.
- Code: server/services/searchService.ts, server/services/search/hybridRetrieval.ts,
  server/services/search/localEmbeddings.ts, server/services/dedupe/embeddings.ts,
  server/services/dedupe/blocking.ts:160-180, server/services/dedupe/context.ts:69-99,
  server/routes/search.ts, server/utils/aiCache.ts, server/services/aiStatsService.ts,
  server/routes/aiStats.ts, server/services/aiSearch/jobQueue.ts,
  server/services/aiSearch/mergeEngine.ts, server/routes/aiSearch.ts,
  server/ai/services/searchIntel.ts (cache key sites only).

FACTS THAT SHAPE THE WORK
- The FTS entry point for GET /api/search is searchService.searchFts, one
  "<q>"* query with ORDER BY rank; the three-strategy list is in
  hybridRetrieval.ftsRetrieval. Both get the ownerTok:<token> AND (...) wrapper.
  BM25_WEIGHTS already has twelve values from Phase 1.
- The rerank cache key is built in aiCache.getCachedSearch and setCachedSearch,
  called from seven sites in searchService.ts, not in searchIntel.ts. rerank,
  synthesis, briefing, dailyInsight get the owner prefix. queryParse, hyde, and
  mentions stay shared unless Q14 says "prefixed".
- There are three private contact_embeddings MATCH statements outside
  _stmts.knn: blocking.addEmbeddingCandidates and context.getEmbeddingSimilarity
  (both in 2c's table). All KNN statements gain AND ownerId = ?; the
  preFilterIds JavaScript post-filter stays for the hard-filter case.
- POST /api/search/semantic streams NDJSON when Accept asks for it and
  /synthesize always streams. Capture scope before the stream starts. The test
  asserts recordInvocation rows written during the stream carry the owner.
- aiSearch: the batch stores ownerId; cooldown becomes per owner; the global
  lock stays; processBatch wraps the run in runWithContext. The 429 at
  routes/aiSearch.ts:75-78 bypasses AppError today and becomes
  next(new RateLimitedError(message, { yours, queued: false, retryAfterSeconds })).
  Patch src/api/aiSearch.ts:29 to read error.error.message so the UI keeps
  showing the message; Phase 4 does the rest.
- mergeEngine.invalidateSearchCache() flushes the whole rerank tier; it becomes
  an owner-prefix invalidation.
- 25 recordInvocation call sites do not change; the context does the work.
  getSummary and getFeed take scope; cacheTiers is omitted for members.

DO THIS
1. 2c in table order, then 2f. Add ownerKey and invalidateForOwner to aiCache.
2. Move the listed files into the strict glob (leave the dedupe files other
   than embeddings.ts for 2e, but the two private MATCH statements in
   blocking.ts and context.ts gain the predicate now).
3. Matrix tests: A has "Zebulon Quarrington"; B's GET /api/search, semantic
   (JSON and NDJSON), and synthesize never return it even when it is the only
   match. A's cached rerank is a miss for B. B's ai-search status and stream
   for A's batchId return 404 before any event. B's AI stats count only B's
   invocations. Flip isolated for the search, ai-search, and ai/stats routes.
4. Run tests/unit/search.test.ts and the api.aiSearch suite unchanged.

CONSTRAINTS
- Do not change dedupe scan logic, suggestions, or merging (2e).
- No new dependencies.

SUCCESS CHECKLIST
- [ ] Every FTS query wraps the strategy with the owner token; EXPLAIN QUERY PLAN shows only the MATCH index scan.
- [ ] Every KNN statement (search, dedupe _stmts.knn, addEmbeddingCandidates, getEmbeddingSimilarity) filters by owner; getSearchEmbeddingCount is per owner with an unscoped boot-log variant behind an allow comment.
- [ ] Candidate hydration uses findManyOwned or findOwned, including buildCompressedCandidates.
- [ ] rerank, synthesis, briefing, dailyInsight keys are owner-prefixed; invalidateForOwner exists; mergeEngine uses it; Q14 applied to mentions.
- [ ] NDJSON and SSE handlers capture scope in the closure; the attribution test passes.
- [ ] aiSearch batches carry ownerId, cooldown is per owner, the lock is global, the 429 uses the standard envelope with details.yours, and the frontend reads the new shape.
- [ ] AI stats summary and feed are scoped; cacheTiers omitted for members.
- [ ] tenant-lint --strict passes for every file this PR touches.
- [ ] Matrix tests real and green; isolated flipped for the routes in this PR.
- [ ] Existing search and aiSearch suites pass; lint, test, build, format:check green; summaries pasted.
```

---

## Prompt 6. Phase 2e: dedupe

```text
TASK
Implement sub-phase 2e from docs/multi-tenant-plan/07-phase-2-scoping.md. One
PR from v2.0/phase-2e-dedupe. This is the largest sub-phase. Convert
merging.ts last.

READ FIRST
- 07-phase-2-scoping.md sections 0.3, 0.4, and 2e (both rules and the table).
- 03-architecture.md section 9 (dedupeQueue row) and section 5.4.
- appendix-a-query-inventory.md rows for every server/services/dedupe/* file,
  server/routes/dedupe/*, and section A2.
- Code: every file under server/services/dedupe/ and server/routes/dedupe/,
  server/services/contactService.ts:61-84 (scheduleIncrementalDedupe),
  tests/integration/dedupe.test.ts, tests/integration/api.merge.test.ts.

FACTS THAT SHAPE THE WORK
- Two rules: a scan runs for one owner over that owner's active contacts only,
  and every merge asserts both contacts share the scope before any child
  statement runs (so the error is a 404, not a trigger 500).
- normalizeContacts, loadNegativeConstraints, and normalizeContactById already
  take scope from 2a; finish their bodies here (the five child-table batch
  loads join contacts on owner; the interaction_mentions self-join in
  loadNegativeConstraints joins interactions on owner).
- Full-mode scan runs DELETE FROM contact_embeddings with no predicate and
  clearEmbeddingMeta(), which wipes every owner's dedupe index; scope both.
  Deep mode's findStaleEmbeddings and reEmbedStaleContacts are instance-wide;
  scope them.
- incrementalDedupeCheck has no request; it loads the contact's ownerId, builds
  scopeForOwnerId, and runs inside runWithContext.
- merging.ts has 59 statements and never inserts a contact. The up-front
  two-row owner check must run first; parent contacts statements gain
  AND ownerId = ?; child statements get the allow comment. Re-parenting
  interactions keeps ownerId unchanged, which the mismatch trigger accepts
  because both contacts share the owner.
- dedupeQueue: scans carry ownerId; getScan and getActiveScan filter by owner;
  the run lock stays global with a per-owner FIFO. The 429 at
  routes/dedupe/scan.ts:47-49 bypasses AppError and becomes RateLimitedError
  with details { yours, queued }. Patch src/api/dedupe.ts:40-43 to read
  error.error.message. GET /stream captures scope before dedupeQueue.on(...)
  and never reads the context inside the listener.
- POST /backfill-embeddings is classed admin (mounted in Phase 3); it stays
  an instance operation. GET /embedding-status returns the owner's counts.

DO THIS
1. normalization, blocking, context, passes, engine, suggestions, jobQueue,
   routes, then merging last.
2. Move all dedupe service and route files into the strict glob.
3. Isolation tests per the 2e paragraph: identical "Jane Doe" pairs under A
   and B; A's scan finds one cluster with A's two contacts; B's suggestions are
   empty; B merging A's ids gets 404; B reading A's scan status gets 404; B
   undoing A's merge-log id gets 404; a full-mode scan by A leaves B's
   contact_embeddings count unchanged. Flip isolated for every dedupe and
   merge route.
4. Run the existing dedupe.test.ts and api.merge.test.ts unchanged, then run
   them a second time with two seeded owners to check the merge logic.
5. CHANGELOG line for the 429 envelope change (breaking shape).

CONSTRAINTS
- Do not change merge semantics, thresholds, or pass logic. Predicates and
  signatures only, plus the queue state.
- No requireAdmin mounting.

SUCCESS CHECKLIST
- [ ] A scan by one owner reads only that owner's contacts, child rows, exclusions, mention constraints, and embeddings; the normalized maps hold only that owner's rows.
- [ ] Full-mode and deep-mode scans touch only the scanning owner's embeddings and meta rows.
- [ ] Every suggestion, exclusion, and merge-log row is inserted with the scope's owner; every read filters by it.
- [ ] mergeContacts and softMergeContacts reject a pair that is not both owned by the caller with 404 before any child statement; the existing merge tests pass as two owners.
- [ ] dedupeQueue state is per owner; the FIFO starts the next owner's scan; status, stream, and active return 404 or nothing for a foreign scan; the stream handler never calls currentScope() inside the listener.
- [ ] The scan 429 uses the standard envelope with details.yours and details.queued; the frontend shows the message.
- [ ] incrementalDedupeCheck and seedDuplicates carry the right owner.
- [ ] tenant-lint --strict passes for every dedupe file, with allow comments only on child statements after the owner check.
- [ ] Matrix and cross-owner dedupe tests real and green; isolated flipped for every dedupe and merge route.
- [ ] lint, test, build, format:check green; summaries pasted.
```

---

## Prompt 7. Phase 2g, 2h, 2i: export, MCP, settings classes, background jobs, strict lint, plan tests

```text
TASK
Implement sub-phases 2g, 2h, and 2i from docs/multi-tenant-plan/07-phase-2-scoping.md
as one PR from v2.0/phase-2g-2i-closing. This PR ends Phase 2: the matrix
has no it.todo left and tenant-lint --strict covers all of server/.

READ FIRST
- 07-phase-2-scoping.md sections 2g, 2h, 2i, and the acceptance list in section 2.
- 12-testing-strategy.md sections 4 and 6.
- 04-data-model-and-migration.md section 8 (the indexes to drop).
- appendix-b-route-manifest.md (classes for export, backups, settings, ai, mcp).
- Code: server/services/exportService.ts, server/routes/dataLifecycle.ts,
  server/services/mcpService.ts, server/routes/mcp.ts, server/routes/aiSettings.ts,
  server/routes/ai.ts, server/routes/auth.ts (session-policy), server.ts,
  server/services/search/localEmbeddings.ts:322-408,
  server/services/dedupe/embeddings.ts:373-450, server/db.ts (tenancy block),
  scripts/tenant-lint.mjs, package.json.

FACTS THAT SHAPE THE WORK
- buildFullExport takes no argument today; it becomes buildFullExport(scope)
  and every table filters by owner (list_members through lists.ownerId).
- mcpService.queryContacts has no deletedAt or isGhost filter; add both while
  rewriting the statement and note it in the CHANGELOG as a fix. getTags
  joins contact_tags to contacts.
- Backups, AI settings writes, session-policy PUT, ai diagnostics, grounding
  capacity, and dedupe backfill are classed admin in the manifest here; the
  middleware is mounted in Phase 3. Set the class, do not mount.
- Background jobs: backfillSearchEmbeddings and backfillEmbeddings iterate
  SELECT DISTINCT ownerId FROM contacts and run each owner's batch inside
  runWithContext, interleaving owners in rounds of 200. Sweeps that do
  uniform per-row work stay instance-wide with allow comments.
- 2i drops the four single-column owner indexes with a TENANCY_SCHEMA_VERSION
  = 2 step (see 2i for the mechanics) after the plan tests prove the
  composites are used.

DO THIS
1. 2g in table order, then 2h.
2. 2i: package.json lint:tenant with --strict "server/**/*.ts" inside npm run
   lint; tests/integration/tenancy.queryPlans.test.ts with the eleven
   statements in the 2i table (seed two owners with 500 contacts each, ANALYZE,
   assert the named index and no SCAN); the manifest assertion that every
   scoped route is isolated; zero it.todo left; the index-drop step and its
   migration test case; bench-tenancy at 10 x 2000 committed as bench/phase-2.md.
3. Tick every box in section 2 of the phase document.

CONSTRAINTS
- Do not mount requireAdmin. Do not add admin endpoints.
- The frontend changes only where a response shape changed (export filename
  is additive; nothing else here).

SUCCESS CHECKLIST
- [ ] Export JSON and CSV contain only the caller's rows in every table; filename includes the username.
- [ ] Every mcpService function is scoped; queryContacts excludes trashed and ghost rows; MCP routes work with a personal-token principal inserted directly (Phase 3 adds creation).
- [ ] Manifest classes set for backups, AI settings writes, session-policy PUT, diagnostics, grounding capacity, backfill-embeddings, and the instance-read routes.
- [ ] Both embedding backfills run per owner inside a context; recordInvocation rows from a boot backfill carry the owner.
- [ ] npm run lint includes tenant-lint --strict "server/**/*.ts" and passes.
- [ ] tenancy.queryPlans.test.ts passes for all eleven statements.
- [ ] tenancy.isolation.test.ts has zero it.todo; every scoped route has isolated: true; the manifest test asserts it.
- [ ] The four single-column owner indexes are dropped by the version-2 step; the loop no longer recreates them; the migration test covers a version-1 database.
- [ ] bench/phase-2.md committed; at 10 x 2000 the slim list p95 is under 40 ms, FTS search under 10 ms, semantic (mock AI) under 30 ms, dashboard under 60 ms, or the deviation is explained with a fix.
- [ ] Every box in 07-phase-2-scoping.md section 2 is ticked.
- [ ] lint, test, build, format:check green; summaries pasted.
```

---

## Prompt 8. Phase 3: accounts, roles, and the admin API

```text
TASK
Implement Phase 3 as specified in docs/multi-tenant-plan/08-phase-3-accounts-admin.md.
One PR from v2.0/phase-3-accounts-admin, or two (accounts and admin routes
first; tokens, registration, audit, limiter, maintenance interval second).

READ FIRST
- 08-phase-3-accounts-admin.md, all of it. Section 0.2 lists the exact state
  and the FK behaviors the purge depends on.
- 13-api-changes.md sections 1, 3, and 4 (every shape you implement).
- 03-architecture.md sections 4.3, 4.4, and 5.4.
- 04-data-model-and-migration.md section 2 (the identity tables you fill).
- Code: server/middleware/auth.ts, server/middleware/rateLimit.ts,
  server/routes/auth.ts, server/services/authService.ts, server/services/passwords.ts,
  server/services/settingsService.ts, server/services/exportService.ts,
  server/routes/dataLifecycle.ts, server/routes/aiSettings.ts, server/routes/ai.ts,
  server/routes/dedupe/embeddings.ts, server/routes/aiStats.ts, server.ts,
  server/utils/validators.ts, server/tenancy/routeManifest.ts.

FACTS THAT SHAPE THE WORK
- requireAdmin goes on each route at route level, not router.use, so the
  manifest test can find it in route.stack. It must be a named function.
- The per-IP AI limiter mounts before attachPrincipal. The new per-user
  limiter (keyBy on principal.user.id, 30 per minute) mounts after
  attachPrincipal and attachRequestContext. Apply Q16 to the pattern list.
  Both limiters set Retry-After.
- credentialLimiter is module-private to routes/auth.ts; register and
  accept-invitation live in that file.
- There is no daily sweep today. Task 3.8 adds one interval in server.ts,
  gated by DISABLE_BACKGROUND_JOBS, for audit_log, expired sessions, aged
  revoked tokens, aged dead invitations, and old invocations (move the
  boot-only cleanupOldInvocations call into it).
- Purge order in 3.5 is exact. search_embeddings, contact_embeddings,
  dedupe_embedding_meta, and dedupe_merge_log have no FK and are deleted by
  hand. vec0 DELETE by partition key works. Acceptance is 10,000 contacts
  under 2 s; the chunking fallback is described.
- Deleting an admin cascades their pending invitations (invitedBy CASCADE).
- The local owner row cannot be disabled or deleted while auth is off.
- /api/auth/status keeps both existingContacts and deviceContacts in 2.0.

DO THIS
1. Tasks 3.1 to 3.14 in the document's order. Use validateBody with zod for
   every admin body. Every admin action writes an audit row through auditService.
2. Add every new route to ROUTE_MANIFEST with its class. Extend the manifest
   test to assert requireAdmin in every admin route's stack.
3. Write tests/integration/api.admin.test.ts covering the whole acceptance
   list in section 3 with the two-user harness plus a third actor.
4. Measure the purge on a 10,000-contact owner and record the time in the PR.
5. Tick the acceptance boxes in section 3.

CONSTRAINTS
- No UI. No reverse-proxy auth, OIDC, or email. Do not remove
  PUT /api/auth/session-policy or the environment API_TOKEN.
- Audit details never contain a password, token, invitation secret, or key.

SUCCESS CHECKLIST
- [ ] Every admin route returns 403 ADMIN_REQUIRED to a member and 200 to an admin; the manifest test proves requireAdmin is on each one.
- [ ] Temporary password flow: forced 403 PASSWORD_CHANGE_REQUIRED on every data route (session and token), change succeeds, routes work.
- [ ] Invitations: single use; used, expired, revoked return 410 with their codes; unknown and malformed tokens return the same 404 body.
- [ ] Disable revokes sessions and refuses tokens; enable restores tokens only.
- [ ] Delete without decision returns 409 USER_HAS_DATA with counts; purge removes every owned row, vector row, meta row, FTS row, and the upload directory; other owners' counts unchanged; 10,000 contacts under 2 s (time recorded).
- [ ] Last-admin and self guards return 409 LAST_ADMIN and 400 CANNOT_TARGET_SELF.
- [ ] Tokens: work on contacts and every MCP route; refused on /me with SESSION_REQUIRED; revoked, expired, disabled all 401; lastUsedAt at most hourly; eleventh token in an hour 429.
- [ ] Registration closed by default (403 REGISTRATION_CLOSED); open creates a member.
- [ ] Every listed audit action produces one row; GET /api/admin/audit paginates; a grep of the test output finds no ctk_ token or seeded password.
- [ ] Per-user AI limiter: 31st request in a minute is 429 with Retry-After; another user on the same IP unaffected; Q16 routes covered.
- [ ] Daily maintenance interval sweeps the five tables under an advanced clock and is gated by DISABLE_BACKGROUND_JOBS.
- [ ] Legacy API_TOKEN maps to the primary admin and warns once; status reports legacyTokenConfigured.
- [ ] tenant-lint --strict green; manifest green with the new rows; lint, test, build, format:check green; summaries pasted.
- [ ] CHANGELOG Phase 3 block; acceptance boxes in 08 section 3 ticked.
```

---

## Prompt 9. Phase 4: frontend

```text
TASK
Implement Phase 4 as specified in docs/multi-tenant-plan/09-phase-4-frontend.md.
Two PRs from v2.0/phase-4-auth-account (tasks 4.1 to 4.6, 4.10, 4.11, 4.12)
and v2.0/phase-4-admin (tasks 4.7 to 4.9), in that order.

READ FIRST
- 09-phase-4-frontend.md, all of it. Section 0.2 is a table of the exact
  frontend facts with v1.5.5 line numbers; read it twice.
- 13-api-changes.md sections 2, 3, and 4 (the contracts you consume).
- .agent/STYLE.md, src/components/ui/Modal.tsx, src/components/ui/IconButton.tsx.
- Code: src/main.tsx, src/components/auth/*, src/api/*.ts, src/lib/appEvents.ts,
  src/App.tsx, src/views/SettingsView.tsx, src/views/settings/*, src/contexts/*,
  src/views/dedupe/DedupeView.tsx, src/views/ai-search/*, src/views/ai-stats/*,
  src/components/layout/Sidebar.tsx, tests/unit/frontend.*.test.ts,
  scripts/contrast-audit.mjs.

FACTS THAT SHAPE THE WORK
- AuthContext.Provider wraps children only in the open state today; move it
  above the screen switch so the new screens can call useAuth().
- AuthGate mounts outside BrowserRouter. The join state reads window.location,
  not useLocation, and calls history.replaceState before handleAuthenticated.
- One rule hides account UI: !authRequired. The client does not need via.
- Ten of twelve API modules call fetch directly. Task 4.11 adds
  handleResponse in src/api/client.ts and migrates every module; a unit test
  scans src/api/ to keep it that way. emitAuthExpired becomes a CustomEvent
  with detail.reason; a new emitPasswordChangeRequired exists. EventSource
  streams fall back to status polling after an error event.
- The sidebar is desktop only; the identity row also renders at the top of
  SettingsHome for mobile.
- SettingsView uses static imports; the admin routes become React.lazy inside
  it. No backups UI exists today; BackupsView is new. /settings/ai-config
  becomes a Navigate.
- The "Signed in on" section is where the API tokens section goes; session
  length moves to the admin Instance view.
- Dedupe and AI Search 429 bodies are the standard envelope with details.yours
  since Phase 2; enrichment.ts:67 must stop labelling every 429 as a grounding
  quota error.
- Write the bottom-sheet and 44 px rules into .agent/STYLE.md; they exist in
  the primitives but not in the document.

DO THIS
1. PR 1: tasks 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.10, 4.11, 4.12. Start with 4.11
   (the shared handler) because everything else reports errors through it.
2. PR 2: tasks 4.7, 4.8, 4.9 with src/api/admin.ts following the aiSettings.ts
   pattern.
3. Record the manual walkthrough with screenshots in bench/ui-walkthrough.md
   and the two-browser check.
4. Run npm run audit:contrast and npm run build; confirm the admin chunk is
   separate in the build output.
5. Tick the acceptance boxes in section 3.

CONSTRAINTS
- Server enforcement is the real gate; RequireAdmin only hides UI.
- No per-user preferences UI. No instance branding beyond what the features
  decision record accepted.
- Follow STYLE.md: surface shifts not borders, pill buttons, glass-panel,
  the Modal and IconButton primitives.

SUCCESS CHECKLIST
- [ ] Gate states: setup (with "Secure this instance" when localOwnerPresent), signin with expired and disabled reasons, join from /join?token=, register when open, password-change when forced, open.
- [ ] useAuth exposes user, authRequired, isAdmin, mustChangePassword, registrationOpen, legacyTokenConfigured, localOwnerPresent, refresh, signOut; available on every screen.
- [ ] Account UI (identity, tokens, sign-out) hidden when !authRequired everywhere.
- [ ] Prefetch of ["contacts"] happens after the gate opens; identity change remounts AppScope and clears the query cache.
- [ ] API tokens section: create shows the token once, list, revoke; legacy banner when legacyTokenConfigured.
- [ ] tests/unit/frontend.apiClient.test.ts passes: no module under src/api/ except auth.ts and client.ts calls fetch without the shared handler; 401, 403 codes, and 429 details flow to the gate or the UI; EventSource error falls back to polling.
- [ ] Admin area: Users (with "This device" badge), Create user, Invitations with one-time link display, Instance (registration, session length, AI configuration, SearXNG), Backups (new), Audit with load more; all lazy-loaded; RequireAdmin redirects members; /settings/ai-config redirects.
- [ ] Delete flow shows counts from the 409 then requires the checkbox and sends decision: "purge"; reset flow shows the temporary password once.
- [ ] AI stats "Mine / All users" for admins; members see only their own.
- [ ] Dedupe queued state polls until the owner's scan appears; AI Search cooldown uses retryAfterSeconds; enrichment 429 message is correct.
- [ ] Mobile: identity row at the top of Settings; admin tables as cards; modals as bottom sheets; 44 px targets.
- [ ] bench/ui-walkthrough.md with screenshots; two-browser check recorded; audit:contrast passes; build output shows a separate admin chunk.
- [ ] .agent/STYLE.md gains the two mobile rules; new unit tests for invite link parsing and temporary-password formatting.
- [ ] lint, test, build, format:check green; summaries pasted; CHANGELOG Phase 4 block; acceptance boxes in 09 section 3 ticked.
```

---

## Prompt 10. Accepted 2.0 extras and quality stories

```text
TASK
Implement the items the decision record in
docs/multi-tenant-plan/15-additional-v2-features.md section 9 marks as
accepted for 2.0: any of F1 to F6 (section 2), the 2.0 headline features
(section 5), and the 2.0 quality stories (section 7). One PR per item, from
v2.0/extra-<slug>, in the order the decision record lists them. If the
record is empty, stop and ask which items are accepted.

READ FIRST
- 15-additional-v2-features.md: the rules at the top, the row and the detail
  paragraph for each accepted item, and section 9.
- For a headline feature: 13-api-changes.md (add your endpoints to it),
  appendix-b-route-manifest.md (add rows), 12-testing-strategy.md section 3.
- The phase document that owns the code you touch (for example 08 for the
  admin health panel, 07 section 2e for the import scan, 06 for anything near
  the migration).

FACTS THAT SHAPE THE WORK
- An extra must be additive. It may not change a table the migration touches
  and may not weaken an isolation guarantee. A new table gets ownerId, a
  required trigger, and a scoped repository from the first commit. Every new
  endpoint gets a manifest row and a matrix test in the same PR.
- The MCP server (feature 1) is a separate package that talks to the HTTP API
  with a personal token; it touches no database code. Its one dependency (the
  MCP SDK) is authorized by the features document.
- Quick Capture (feature 2) adds a captures table and a share_target to
  public/site.webmanifest; proposals are produced by the existing
  parseContactRecord and mention extraction.
- Nudges (feature 3) are outbound only, opt-in, per user, stored in
  user_settings, delivered by the Phase 3 maintenance interval, and every URL
  passes the existing urlSafety pinning.
- Reconnect drafts (feature 5) are a new capability in the capability router
  and are cached per owner.
- Quality stories name their file and line; do exactly what the paragraph says.

DO THIS
For each accepted item: read its paragraph, implement it, add tests (matrix
tests for any endpoint, an eval baseline for the search gate, a timing test
for the import scan), add its CHANGELOG bullet and its docs/api-reference.md
section if it has an endpoint, open the PR, and record the outcome in the
decision record table.

CONSTRAINTS
- Nothing here may start after the Phase 5 security review begins.
- No dependency other than the ones the features document names.

SUCCESS CHECKLIST (per item)
- [ ] The item does exactly what its paragraph in 15 describes; its "done when" line holds.
- [ ] New tables are owned and scoped; new endpoints have manifest rows and green matrix tests; tenant-lint --strict still passes.
- [ ] docs/api-reference.md and 13-api-changes.md updated for any endpoint.
- [ ] CHANGELOG bullet under Unreleased; decision record row filled with the PR number.
- [ ] lint, test, build, format:check green; summaries pasted.
```

---

## Prompt 11. Phase 5: hardening, performance, security review, documentation

```text
TASK
Implement sections 1, 2, and 3 of docs/multi-tenant-plan/10-phase-5-hardening-release.md
as one or more PRs from v2.0/phase-5-hardening. Do not perform the release
(section 4); that is the next prompt.

READ FIRST
- 10-phase-5-hardening-release.md sections 0 to 3 and 5.
- 12-testing-strategy.md sections 8 and 9.
- 14-risks-and-open-questions.md section 3 (the risks this phase closes).
- bench/baseline-phase-0.md and bench/phase-2.md (the before numbers).
- Every document in section 3's table, and .agent/PHILOSOPHY.md,
  .agent/ARCHITECTURE.md, .agent/TESTING.md, .agent/STATUS.md.

FACTS THAT SHAPE THE WORK
- The benchmark targets are p95 on laptop-class hardware with mock AI; the
  purge target is 10,000 contacts under 2 s and the boot migration on the
  10,000-contact fixture under 5 s excluding the backup copy.
- The concurrency run includes a dedupe scan and a 5,000-contact purge midway
  and expects zero SQLITE_BUSY 503s. If any appear, shorten the transaction,
  do not raise busy_timeout.
- The security checklist has a "Streams" row: grep for currentScope() inside
  listeners and expect none.
- docs/configuration.md's forgot-password recipe NULLs ownerId on four tables
  and deletes users; it cannot work in 2.0. Rewrite it per section 3.
- docs/upgrade-2.0.md is new and lists every breaking change from section 3,
  including SESSION_REQUIRED and the 429 envelope, with the measured
  migration durations.

DO THIS
1. Section 1: run bench-tenancy at the four shapes, write bench-concurrency
   and run it, do the index audit and the memory measurement; write
   bench/phase-5.md. Fix any target miss with an index or a rewrite and record it.
2. Section 2: run the security-review skill over git diff main...v2.0, then
   walk the checklist by hand; write bench/security-review.md with a status
   per row; fix findings in this PR or open follow-ups the release cannot
   ship without.
3. Section 3: update every listed document. Read each one end to end after
   editing; the acceptance criterion is "reviewed by reading, not by grep".
4. Tick the acceptance boxes in section 5 that belong to sections 1 to 3.

CONSTRAINTS
- No new features. No version bump. No release steps.

SUCCESS CHECKLIST
- [ ] bench/phase-5.md: four shapes, every target met or a deviation explained with the fix, contract test summary, final index list, memory numbers.
- [ ] bench-concurrency: zero 503s with 10 owners, a scan, and a purge; p95 and longest write wait recorded.
- [ ] bench/security-review.md: every checklist row closed or linked to a fix in this PR.
- [ ] Every document in section 3 updated, including the new docs/upgrade-2.0.md and the rewritten forgot-password recipe.
- [ ] CHANGELOG Unreleased blocks are complete and correct for every phase and accepted extra (the release prompt regroups them).
- [ ] lint, test, build, format:check green; summaries pasted; the section 5 boxes for hardening ticked.
```

---

## Prompt 12. Release 2.0.0

```text
TASK
Perform section 4 of docs/multi-tenant-plan/10-phase-5-hardening-release.md:
freeze and rehearse on v2.0, the version and notes PR, the release PR into
main merged with a merge commit, the tag, the hand-written release notes,
and the post-release plan. Several steps need a human to click merge or to
confirm; stop at each of those and report, then continue when told.

READ FIRST
- 10-phase-5-hardening-release.md sections 0.2, 4, and 5.
- docs/ci-and-release.md (the repository's release mechanics).
- CHANGELOG.md, package.json, docs/upgrade-2.0.md.

FACTS THAT SHAPE THE WORK
- CI publishes images on push to main and on v* tags, and creates a GitHub
  release on a tag only if none exists. Publish the hand-written notes before
  the workflow's release job runs, or you get an auto-generated commit list.
- The release PR is the one deliberate exception to squash-merging: merge
  with a merge commit so each squashed phase commit stays on main.
- The plan folder is retired in the post-release cleanup PR, not in the
  release PR, as section 4.5 describes.

DO THIS, STOPPING WHERE MARKED
1. Freeze: merge origin/main into v2.0, resolve, run lint, test, build,
   format:check, and test:contract with available keys. Run the upgrade
   rehearsal on a copy of a real 1.5.5 database in both auth modes and the
   rollback rehearsal on the final build; append to bench/upgrade-rehearsal.md
   and bench/rollback-rehearsal.md. STOP and report if any rehearsal step
   deviates from the documents.
2. Version and notes PR into v2.0: npm version major --no-git-tag-version;
   regroup CHANGELOG Unreleased into ## [2.0.0] with Breaking, Added, Changed,
   Fixed, Migration; add a fresh Unreleased heading; write notes.md
   (uncommitted). STOP for the human to merge.
3. Release PR from v2.0 into main with the title and body described in 4.3.
   Confirm CI is green. STOP for the human to merge with gh pr merge --merge.
4. After the merge: tag v2.0.0 on main, push the tag, run gh release create
   with notes.md and --verify-tag before the workflow's release job. Watch the
   tag run publish 2.0.0 and 2.0 images and the merge-image job confirm both
   architectures. STOP and report the release URL.
5. Open the post-release cleanup PR described in 4.5 as a draft (branch
   deletion, CI trigger cleanup, plan folder retirement), to be merged after
   the first patch release or two weeks.

CONSTRAINTS
- Never push to main directly; never force-push. Do not merge anything
  yourself. Do not delete v2.0 in this prompt.

SUCCESS CHECKLIST
- [ ] v2.0 contains main; lint, test, build, format:check, and contract tests are green on the frozen branch; summaries recorded.
- [ ] Upgrade and rollback rehearsals recorded for both auth modes on the final build.
- [ ] package.json and package-lock.json say 2.0.0; CHANGELOG has a complete [2.0.0] entry and an empty Unreleased.
- [ ] Release PR merged with a merge commit; main history shows each phase commit.
- [ ] Tag v2.0.0 exists on the merge commit; GitHub release shows the hand-written notes; images 2.0.0, 2.0, and latest exist for amd64 and arm64.
- [ ] Draft cleanup PR open with the branch, CI trigger, and plan-folder retirement steps.
- [ ] Section 5 boxes for the release ticked.
```
