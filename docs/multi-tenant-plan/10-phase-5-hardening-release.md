# 10. Phase 5: Hardening, Performance, Docs, and Release

**Goal:** prove the isolation and the performance claims with evidence, close
the security review, update every document, merge `v2.0` into `main`, and
publish `2.0.0` with an upgrade guide.

**Lands on:** `v2.0` for the hardening PRs, then `main` through the release
PR (section 4).

**Size:** M (about 5 to 7 engineering days).

**Depends on:** Phases 1 to 4, and any extras accepted from
[15-additional-v2-features.md](15-additional-v2-features.md).

This document is written so that an implementer can work from it alone.
Section 4 is the exact release procedure for this repository.

---

## 0. Context for the implementer

### 0.1 Repository, commands, and workflow

Same as [05-phase-0-foundations.md](05-phase-0-foundations.md) sections 0.1
and 0.2. Hardening work is one or more PRs into `v2.0`. The release itself
is one PR from `v2.0` into `main`, merged with a merge commit, then a tag.

### 0.2 How CI and releases work in this repository

From `docs/ci-and-release.md` and `.github/workflows/ci.yml`:

| Event | Tests | Container image | GitHub release |
| ----- | ----- | --------------- | -------------- |
| Pull request into `main` or `v2.0` (the branch was added in Phase 0) | yes | no | no |
| Push to `main` | yes | `latest`, `<sha>` | no |
| Push of a `v*` tag | yes | `X.Y.Z`, `X.Y` | yes, unless one exists |
| Manual dispatch | yes | no | no |

`build-and-test` runs `npm run lint`, `npm run format:check`,
`npm run test:coverage`, and `npm run build` on Node 22. `build-image` runs
only for `refs/heads/main` and `refs/tags/v*`, builds `linux/amd64` and
`linux/arm64` on native runners, and `merge-image` asserts both
architectures are present. `release` runs only on tags and creates a GitHub
release only if none exists, so hand-written notes must be published before
the job gets there. `npm run test:contract` (real provider calls, skips
without keys) is run by hand before a release, per `CONTRIBUTING.md`.

### 0.3 State at the start of this phase

Phases 0 to 4 are merged into `v2.0`. `package.json` still says `1.5.5`.
`CHANGELOG.md` has one `Unreleased` section with a block per phase.
`bench/` holds `baseline-phase-0.md`, `tenant-lint-baseline.txt`,
`rollback-rehearsal.md`, `phase-2.md`, and `ui-walkthrough.md`.

---

## 1. Performance

### 1.1 Benchmarks

Run `scripts/bench-tenancy.ts` at four shapes and record in `bench/phase-5.md`:

| Shape | Purpose |
| ----- | ------- |
| `1 × 5000` | single-user regression against the Phase 0 baseline |
| `10 × 2000` | typical household or small team |
| `25 × 2000` | upper bound this release targets |
| `5 × 10000` | heavy per-owner slices, checks index selectivity within an owner |

Targets (p95, laptop-class hardware, mock AI):

| Endpoint or operation | Target |
| --------------------- | ------ |
| `GET /api/contacts?view=slim` (2,000 owned) | 40 ms |
| `GET /api/contacts/:id` | 5 ms |
| `GET /api/search?q=` | 10 ms |
| `POST /api/search/semantic` (FTS + vector, no AI) | 30 ms |
| `GET /api/dashboard` | 60 ms |
| `GET /api/command-palette/zero-state` | 30 ms |
| `GET /api/contacts/:id/timeline` | 10 ms |
| `GET /api/action-items` | 10 ms |
| `PATCH /api/contacts/:id` (the FTS trigger cost) | 5 ms, and lower than the Phase 0 baseline |
| dedupe scan, 2,000 contacts, deterministic passes only | 3 s wall |
| owner purge, 10,000 contacts | 2 s |
| boot migration on the 10,000-contact fixture, excluding the backup copy | 5 s |

Any endpoint that misses its target gets an `EXPLAIN QUERY PLAN` review and
either a new composite index or a query rewrite, recorded in the same file.

### 1.2 Concurrency test

`scripts/bench-concurrency.ts`: 10 owners, each running a loop of list, detail,
search, and one write (create interaction) with 5 ms think time, for 60
seconds, while one owner runs a dedupe scan and one admin runs a 5,000-contact
purge midway. Record: p95 per endpoint, count of `503 SQLITE_BUSY`, and the
longest write wait. `busy_timeout` is 5 s. The expectation is zero 503s. If
any appear, the fix is to shorten long transactions (the purge and the
dedupe scan are the candidates), not to raise the timeout.

### 1.3 Index audit

With the benchmark database open, run `PRAGMA index_list` and `sqlite_stat1`
after `ANALYZE`. Drop any index the plan tests prove unused. Confirm the
single-column owner indexes were dropped in Phase 2i. Record the final index
list in `bench/phase-5.md`.

### 1.4 Memory

Measure RSS at `25 × 2000` after a full dedupe scan for one owner and after
`backfillSearchEmbeddings`. The per-owner `normalizeContacts` maps should hold
2,000 entries, not 50,000. Record.

---

## 2. Security review

Run the `security-review` skill against the whole `v2.0` diff (`git diff
main...v2.0`), then walk this checklist by hand:

| Area | Check |
| ---- | ----- |
| IDOR | Matrix test green. Spot-check 10 routes by hand with two accounts and copied ids. |
| Enumeration | Cross-owner ids return `404` with the same body and timing as a nonexistent id. `POST /login` unchanged. `accept-invitation` returns the same `404` for an unknown token and a malformed one. |
| CSRF | Cookies are `HttpOnly; SameSite=Strict` (`server/middleware/auth.ts:144`). Token endpoints require a session. `POST /api/auth/register` and `accept-invitation` are pre-auth and only create accounts. |
| Uploads | `guardUploads` regex. Path traversal on `ownerId` rejected by the pattern. `resolveUploadPath` unchanged. Multer `destination` uses the principal, not the body. |
| Tokens | `ctk_` prefix, 256-bit random, SHA-256 at rest, equality on a hash lookup, shown once. Revoked, expired, disabled all refused. |
| Invitations | 256-bit random, hashed, 7-day expiry, single use. |
| Passwords | Temporary passwords 20 chars from a 62-char alphabet (about 119 bits). Forced change. scrypt unchanged. |
| Sessions | Disable revokes. Reset revokes. Role change does not revoke (the next request reads the fresh row). |
| Rate limits | Per IP on pre-auth. Per user on AI-cost routes, mounted after `attachPrincipal`. Token creation. `Retry-After` set. |
| Admin | Every `admin` route has `requireAdmin` at route level (manifest test). Last-admin and self guards. Audit rows. |
| Local owner | `passwordHash = 'none$'` never verifies (unit test). Forced-auth rule when accounts exist. The local account cannot be disabled or deleted while auth is off. `local` username reserved. |
| Legacy token | Maps to the primary admin only. Warning at boot. |
| Streams | Every SSE and NDJSON handler captures the scope in its closure (grep for `currentScope()` inside listeners: none). |
| Logs | No password, token, invitation secret, or provider key in any log line or audit row (grep the test output for `ctk_` and for the seeded passwords). |
| Backups | Admin only. The pre-tenancy backup file is documented and its name is logged. |
| Errors | Production error handler strips stacks (unchanged). New codes documented. |

Findings go into `docs/multi-tenant-plan/bench/security-review.md` with a
status each.

---

## 3. Documentation

| Document | Change |
| -------- | ------ |
| `README.md` | Feature list: "Multi-user with an admin". Quick start: mention that auth off is single-user and how to turn it on. Version 2.0. |
| `docs/configuration.md` | Rewrite "Authentication & Remote Access": accounts and roles, the local owner account, the forced-auth rule, invitations vs temporary passwords, personal tokens, `API_TOKEN` deprecation, registration setting, forgot-password recovery for a member (admin resets) and for the last admin (the `sqlite3` recipe, which today `NULL`s `ownerId` on four tables and deletes users; rewrite it for eight owned tables and the `contacts_owner_required` trigger, or better, replace it with a documented CLI step). Upgrade section pointing at the guide. |
| `docs/api-reference.md` | New sections: Admin, Invitations, API tokens, Registration. Updated Authentication section. Error code table including `SESSION_REQUIRED`. Every scoped endpoint gets one sentence: "Returns only the caller's data." |
| `docs/architecture.md` | New "Tenancy" section: owner column, Scope, request context, FTS owner and contact tokens, `vec0` partition keys, uploads layout, the three guards, the daily maintenance interval. Schema tables updated. |
| `docs/ci-and-release.md` | `v2.0` in the "what runs when" table while the branch exists; `lint:tenant` and `tenancy:verify` in the test description. |
| `docs/features/deduplication.md` | Per-user scans and the queue behavior. |
| `docs/features/ai-search.md` | Per-user cooldown, global lock. |
| `docs/features/dashboard-pulse.md` | Per-user insight. |
| `docs/getting-started.md` | New scripts: `tenancy:verify`, `lint:tenant`. |
| `docs/upgrade-2.0.md` (new) | Backup, what the migration does and its measured durations, how to verify, how to roll back, what changes for auth-off and for token users, the `USER_REQUIRED` and `429` envelope changes for script authors. |
| `CONTRIBUTING.md` | The Scope rule, the tenant lint, how to add a route (classify it in the manifest, add the isolation test), the `v2.0` branch note removed after release. |
| `.agent/ARCHITECTURE.md` | Tenancy section, invariants, new tables, new middleware order. |
| `.agent/PHILOSOPHY.md` | "What This Is NOT": replace "no multi-user sync" with "no cloud sync. Multiple people can share one self-hosted instance, each with a private CRM." |
| `.agent/TESTING.md` | Three projects, new test files, the route coverage matrix columns for `403 admin` and `404 cross-owner`, the real test count. |
| `.agent/STATUS.md` | Current state and test count. |
| `CHANGELOG.md` | The `Unreleased` blocks become the `2.0.0` entry: Breaking, Added, Changed, Fixed, Migration notes. |
| `.env.example` | `API_TOKEN` block marked deprecated with the replacement. |

### Breaking changes to state plainly

- `API_TOKEN` now acts as the first administrator's identity. Scripts see only that user's contacts. Create personal tokens instead.
- `GET /api/auth/me` and the other account endpoints return `403 SESSION_REQUIRED` (was `USER_REQUIRED`) when called with a token.
- The dedupe and AI Search `429` bodies are the standard error envelope, not `{ error: string }`.
- Auth-off instances get a hidden local owner account. Nothing changes for the person using the instance. `GET /api/auth/status` now reports a `user`.
- `GET /api/export/*` return the caller's data, not the instance. Admins export other users from the admin API.
- Members cannot change AI configuration, session policy, or backups.
- Upload URLs changed shape. Any external tool that stored `/uploads/avatars/...` URLs must re-read the contact.
- `GET /api/query/contacts` no longer returns trashed or ghost contacts.
- Search ranking changed when the BM25 weight offset was fixed (Phase 0).

---

## 4. Release procedure

Follow these steps in order. Do not skip the rehearsals.

### 4.1 Freeze and rehearse on `v2.0`

1. Merge `main` into `v2.0` one last time: `git checkout v2.0 && git pull && git merge origin/main`. Resolve conflicts, run `npm run lint && npm test && npm run build`, push.
2. Run `npm run test:contract` with whatever provider keys are available. Record the summary in `bench/phase-5.md`.
3. Upgrade rehearsal on a copy of a real 1.5.5 database, both auth modes: boot the `v2.0` build against the copy, capture the boot log with step durations, run `npm run tenancy:verify`, record everything in `bench/upgrade-rehearsal.md`.
4. Rollback rehearsal on the same copy: restore `backups/pre-tenancy-<stamp>.db`, run `scripts/tenancy-rollback-uploads.mjs`, boot the 1.5.5 image, confirm it works. Record in `bench/rollback-rehearsal.md` (append to the Phase 1 record).
5. Confirm every acceptance box in this document is ticked and every document in section 3 is updated.

### 4.2 Version and notes PR (into `v2.0`)

1. On a branch from `v2.0`: `npm version major --no-git-tag-version` sets `package.json` and `package-lock.json` to `2.0.0`.
2. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [2.0.0] — <YYYY-MM-DD>` and regroup the phase blocks under `### Breaking`, `### Added`, `### Changed`, `### Fixed`, `### Migration`. Add a fresh empty `## [Unreleased]` above it.
3. Write `notes.md` (not committed) from the CHANGELOG entry plus a link to `docs/upgrade-2.0.md`.
4. Commit `chore(release): v2.0.0`, open the PR into `v2.0`, squash-merge.

### 4.3 Release PR (`v2.0` into `main`)

1. `gh pr create --base main --head v2.0 --title "release: v2.0.0, multi-user Contrack" --body-file <summary>`. The body is a short plain summary: what 2.0 adds, the breaking changes list from section 3, the link to the upgrade guide, and the test evidence.
2. CI runs on the PR. It must be green.
3. Merge with a **merge commit**, not a squash: `gh pr merge --merge --subject "release: v2.0.0" <pr>`. Reason: each phase is already one squashed commit on `v2.0`; a merge commit keeps those commits on `main`, so `git bisect` and `git blame` can point at a phase. The repository squashes ordinary PRs, and this is the one deliberate exception.
4. The push to `main` publishes the `latest` and `<sha>` images. Watch the `merge-image` job confirm both architectures.

### 4.4 Tag and publish

```bash
git checkout main && git pull
git tag -a v2.0.0 -m "v2.0.0"
git push origin v2.0.0

# Publish hand-written notes before the workflow's release job runs, otherwise
# the job creates a release with an auto-generated commit list.
gh release create v2.0.0 --title "v2.0.0" --notes-file notes.md --verify-tag
```

The tag push runs CI again and publishes the `2.0.0` and `2.0` images.
Confirm the release page shows the hand-written notes.

### 4.5 After the release

1. Keep `v2.0` until the first patch release (`2.0.1`) or for two weeks, whichever is first, as the hotfix source if `main` moves on. Hotfixes for 2.0.x branch from `main` after the merge and follow the normal PR flow.
2. Then delete the branch (`git push origin --delete v2.0`) and remove `"v2.0"` from `.github/workflows/ci.yml` and from `docs/ci-and-release.md` in a small `chore(ci)` PR.
3. **Retire the plan folder in that same PR.** `docs/multi-tenant-plan/` was un-ignored and committed on `v2.0` (Phase 0 task 0.0), so it lands on `main` with the release merge. The repository keeps finished project plans under `docs/archive/`, which `.gitignore` excludes (line 51), the same way earlier projects were archived per `.agent/STATUS.md`. Move the folder to `docs/archive/multi-tenant-2.0/` and restore the ignore line for `docs/multi-tenant-plan/`. The `v2.0.0` tag keeps the tracked copy forever, and `docs/upgrade-2.0.md` (which stays in `docs/`) links to it by tag path. `docs/README.md` needs no row for it.
4. Label incoming issues `2.0`. Watch for migration reports: the boot log step durations and `npm run tenancy:verify` output are the first things to ask for.

---

## 5. Acceptance criteria

- [ ] `bench/phase-5.md` with all four shapes, targets met or deviations explained with a fix, the contract test summary, and the final index list.
- [ ] `bench-concurrency` with zero 503s at 10 owners, including the scan and the purge.
- [ ] `security-review.md` with every checklist row closed.
- [ ] Every document in section 3 updated. Reviewed by reading, not by grep.
- [ ] `bench/upgrade-rehearsal.md` and the rollback record on the final build, both auth modes.
- [ ] Release PR merged with a merge commit. `v2.0.0` tagged. Images `2.0.0`, `2.0`, and `latest` published for both architectures. Release notes published by hand.
- [ ] Post-release cleanup PR opened when the branch is retired.
