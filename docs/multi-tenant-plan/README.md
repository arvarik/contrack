# Contrack Multi-Tenant Implementation Plan

Working design documents for making Contrack multi-user: one self-hosted
instance, one SQLite database, an administrator, and any number of members,
each with a private CRM. This folder is gitignored on `main`. Phase 0 task
0.0 commits it on the `v2.0` branch so every implementer and reviewer has
it, and Phase 5 retires it to `docs/archive/` at release. It is a plan, not
shipped documentation. The implementation prompts that drive each PR are in
[16-implementation-prompts.md](16-implementation-prompts.md).

Written against `v1.5.5` on 2026-09-07. Reviewed against the source, the
installed engines, and the cited references on 2026-09-08. The review's
evidence is in [bench/review-2026-09-08/](bench/review-2026-09-08/README.md)
and its corrections are summarized in
[14-risks-and-open-questions.md](14-risks-and-open-questions.md) section 5.

---

## Read in this order

| # | Document | What it answers |
| - | -------- | --------------- |
| 1 | [01-current-state.md](01-current-state.md) | What exists today, what is missing, how big the job is |
| 2 | [02-research.md](02-research.md) | How other self-hosted apps do it, and what the plan takes from each, with sources |
| 3 | [03-architecture.md](03-architecture.md) | The target design and every decision, with reasons |
| 4 | [04-data-model-and-migration.md](04-data-model-and-migration.md) | Exact DDL, triggers, indexes, FTS and vector rebuilds, the boot migration, verification, rollback |
| 5 | [05-phase-0-foundations.md](05-phase-0-foundations.md) | Branch and CI setup, scaffolding with no user-visible change, three small 1.5.5 fixes. Lands on `v2.0` |
| 6 | [06-phase-1-storage.md](06-phase-1-storage.md) | Schema, local owner account, migration |
| 7 | [07-phase-2-scoping.md](07-phase-2-scoping.md) | Every query, cache, queue, and upload scoped by owner. Nine sub-phases |
| 8 | [08-phase-3-accounts-admin.md](08-phase-3-accounts-admin.md) | Roles, admin API, invitations, temporary passwords, tokens, audit log |
| 9 | [09-phase-4-frontend.md](09-phase-4-frontend.md) | Admin area, account tokens, new auth screens, identity in the UI |
| 10 | [10-phase-5-hardening-release.md](10-phase-5-hardening-release.md) | Benchmarks, security review, docs, 2.0.0 release |
| 11 | [11-future.md](11-future.md) | Deferred: sharing, proxy auth, OIDC, per-user keys, and more |
| 12 | [12-testing-strategy.md](12-testing-strategy.md) | The tests that prove isolation and the definition of done |
| 13 | [13-api-changes.md](13-api-changes.md) | Every endpoint added or changed, and the new error codes |
| 14 | [14-risks-and-open-questions.md](14-risks-and-open-questions.md) | Decisions to confirm, every technical question with its answer and evidence, effort, what the review changed |
| 15 | [15-additional-v2-features.md](15-additional-v2-features.md) | The 2.0 story beyond tenancy: ten headline features and ten performance, accuracy, and stability stories, each ranked and split between 2.0 and 2.1, plus the small extras and a decision record |
| 16 | [16-implementation-prompts.md](16-implementation-prompts.md) | Twelve prompts, one per PR, that hand each phase to an implementing model with its context, its references, and a success checklist, plus the branch and release operations runbook |
| A | [appendix-a-query-inventory.md](appendix-a-query-inventory.md) | Every query site, shared-state singleton, job, file path, route, and frontend touchpoint with line numbers |
| B | [appendix-b-route-manifest.md](appendix-b-route-manifest.md) | Every route classified as public, self, scoped, admin, instance-read, or static |
| bench | [bench/](bench/README.md) | Evidence: the review's scripts and measurements now, benchmark and rehearsal records as the phases produce them |

---

## The design in one paragraph

Keep one SQLite file. Every owned row carries `ownerId`, which is a `users.id`.
Every repository and service function takes a `Scope` as its first argument,
and every statement over an owned table filters on it in the same `WHERE`
clause as the id. An `AsyncLocalStorage` request context carries the scope to
deep code for attribution. Auth-off mode gets a hidden local owner account so
`NULL` owners never exist. Full-text search gets an indexed owner token
column so FTS5 intersects in the index, and an indexed contact-id token so
the FTS triggers stop scanning the whole index on every contact update. Vector search gets a `vec0` partition
key so KNN scans only the owner's vectors. Composite indexes lead with
`ownerId`. Cross-owner ids return `404`. A tenant lint, a route manifest test,
and a two-user matrix test make a missed filter a red build. Admins manage
accounts and instance settings and cannot read member data. Machine access
moves to per-user hashed tokens. The whole thing ships as 2.0.0 with an
idempotent boot migration that backs up first.

---

## Phases at a glance

| Phase | Lands on | Size | Depends on | Outcome |
| ----- | -------- | ---- | ---------- | ------- |
| 0 Foundations | `v2.0` (cherry-pick to `main` as `1.6.0` is optional) | M | | Branch and CI, `Scope`, request context, route manifest with a mount recorder, tenant lint (report), ownership stamped on create, two-user test harness, benchmark baseline, BM25 offset fix, MCP route mount fix |
| 1 Storage | `v2.0` | L | 0 | New columns and tables, local owner, child `ownerId` with triggers, triggers dropped around the claim, FTS v2 (`ownerTok`; `cidTok` proposed, not built), `vec0` partitions, uploads relocation, composite indexes, backup-then-migrate, verify script, seed scripts |
| 2 Scoping | `v2.0`, nine PRs | XL | 1 | About 240 owned-table statements scoped, caches and queues per owner, uploads guard, standard `429` envelopes, strict lint, matrix green, plan tests |
| 3 Accounts and admin | `v2.0` | L | 2 | `requireAdmin`, admin API, invitations, temporary passwords, disable and purge, tokens, registration flag, audit log, daily maintenance interval, per-user rate limits |
| 4 Frontend | `v2.0` | L | 3 | Admin area (lazy-loaded), tokens UI, join and register and forced-change screens, identity on desktop and mobile, one shared response handler, per-identity cache reset |
| Extras and 2.0 headline features | `v2.0` | XS to M each | 4 | Accepted rows from [15-additional-v2-features.md](15-additional-v2-features.md) |
| 5 Hardening and release | `v2.0`, then `main` | M | 1 to 4 | Benchmarks at four shapes, concurrency run, security review, every doc updated, upgrade and rollback rehearsals, release PR merged with a merge commit, `v2.0.0` tagged and published |

Estimated total: 45 to 64 engineer-days for tenancy, plus about 12 to 18 for
the four 2.0 headline features and 6 to 10 for the five 2.0 quality stories
in [15-additional-v2-features.md](15-additional-v2-features.md), if all are
accepted. Details in
[14-risks-and-open-questions.md](14-risks-and-open-questions.md) section 4.

---

## Decisions that need the owner's confirmation

Listed with alternatives in [14-risks-and-open-questions.md](14-risks-and-open-questions.md) section 1. The three that shape the most work:

1. **Admins cannot read member contacts.** Only an audit-logged offboarding export.
2. **Auth-off mode uses a hidden local owner account** rather than `NULL` owners.
3. **The environment `API_TOKEN` maps to the primary admin and is deprecated**, not refused.

---

## Branch and release workflow

- All of this work lands on one integration branch, `v2.0`, created from `main` at the start of Phase 0. The first PR on it adds `v2.0` to the CI workflow's branch lists, because CI runs only for pull requests into `main` today.
- Each phase (each sub-phase in Phase 2, each accepted extra) is one PR from a `v2.0/<phase>-<slug>` branch into `v2.0`, squash-merged, with the raw vitest summary in the description and no AI attribution.
- `main` is merged into `v2.0` at every phase boundary. `package.json` stays at `1.5.5` until Phase 5. `CHANGELOG.md` collects one block per phase under `Unreleased`.
- Phase 5 merges `v2.0` into `main` with a merge commit, tags `v2.0.0`, publishes hand-written release notes before the workflow's release job, and retires the branch after the first patch release. The exact commands are in [10-phase-5-hardening-release.md](10-phase-5-hardening-release.md) section 4.

## How to use this plan

- Each phase document is written to be handed to an implementer on its own. Its section 0 carries the repository facts, the workflow, and the state the previous phases left behind; its last sections carry the acceptance criteria, the contract for the next phase, and what not to do.
- One PR per phase, or per sub-phase in Phase 2. Each phase document's acceptance criteria are the PR's checklist.
- Names in code must match [03-architecture.md](03-architecture.md) section 14.
- Line numbers in appendix A and in the phase documents are from `v1.5.5`. When they drift, search for the function name. Appendix A section A2 lists the sites the review added.
- Every "green" claim in a PR carries the raw vitest summary, per `.agent/TESTING.md`.
- Benchmarks, rehearsal logs, and the security checklist are committed under `bench/` in this folder as they are produced.

---

## Glossary

| Term | Meaning |
| ---- | ------- |
| Owner | The user who owns a row. The tenant. `ownerId` is a `users.id`. |
| Scope | The typed object `{ ownerId }` that every data-access function requires. |
| Local owner | The hidden admin account that owns everything on an instance running with `AUTH_REQUIRED=false`. Converted into a real account by the setup screen. |
| Owned table | A table with an `ownerId` column. |
| Derived table | A child table whose owner is its parent contact's owner. Read only through an owner-checked parent id. |
| Owner token | `'o' + uuid without hyphens`, the indexed FTS5 column that scopes full-text search. |
| Contact token | `'c' + uuid without hyphens`, the indexed FTS5 column the triggers use to delete one contact's index row without scanning the table. |
| Partition key | The sqlite-vec `vec0` column that scopes KNN to one owner's vectors. |
| Manifest | `server/tenancy/routeManifest.ts`, the classified list of every route. |
| Matrix | `tests/integration/tenancy.isolation.test.ts`, the two-user cross-access test suite. |
