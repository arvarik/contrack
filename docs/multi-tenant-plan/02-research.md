# 02. Research: How Self-Hosted Apps Do Multi-User

This document records what was researched online before the architecture was
chosen, and what was taken from each source. Sources are listed at the end.
Claims that could not be verified online are marked as such.

---

## 1. Tenancy models

Microsoft's Azure Architecture Center describes a spectrum from "fully
isolated (shared nothing)" to "fully shared (shared everything)". The key
sentence for this plan: "When multiple tenants share a single deployment (a
set of infrastructure), you typically rely on your application code and a
tenant identifier that's in a database to keep each tenant's data separate."
The stated risks of the fully shared model are data leakage between tenants,
noisy neighbors, and scale limits of one shared database. The stated benefit
is cost, and that moving a user between tenants is a key update, not a data
migration. [1]

The Azure SaaS patterns page adds that a shared multitenant database "must
have one or more tenant identifier columns so that the data from any given
tenant can be selectively retrieved", and that row-level security is the
mitigation for lost isolation where the database supports it. [2]

SQLite does not support row-level security. Its `ATTACH DATABASE` limit is 10
by default and 125 at compile time, and it can only be lowered at runtime, so
a database-per-user design would also need a connection-per-user design in
the process. [3]

**Taken for this plan:** shared schema with an `ownerId` discriminator column
(D1). Isolation moves into the application layer and needs structural guards,
not just discipline (section 3).

---

## 2. How well-known self-hosted apps model users and admins

| App | First user | Registration | Admin creates or invites | Per-user API credential | Data model | Proxy auth |
| --- | ---------- | ------------ | ------------------------ | ----------------------- | ---------- | ---------- |
| **Gitea** | Web installer creates the first admin. `INSTALL_LOCK` then closes the installer. | `DISABLE_REGISTRATION` (default `false`): "Disable registration, after which only admin can create accounts." | Admin panel or `gitea admin user create --random-password`. | Personal access tokens per user. | Per-user and per-org ownership with explicit sharing. | `ENABLE_REVERSE_PROXY_AUTHENTICATION` with `REVERSE_PROXY_AUTHENTICATION_USER = X-WEBAUTH-USER` and `REVERSE_PROXY_TRUSTED_PROXIES = 127.0.0.0/8,::1/128`. [4] |
| **Miniflux** | `CREATE_ADMIN=1` with `ADMIN_USERNAME` and `ADMIN_PASSWORD` bootstraps the admin from env. | No open registration. Admin creates users through the UI or `POST /v1/users` (admin only). | Admin creates with username, password, `is_admin`. | "Settings > API Keys > Create a new API key", sent as `X-Auth-Token`. | Strictly per-user. No sharing. | `AUTH_PROXY_HEADER` with `TRUSTED_REVERSE_PROXY_NETWORKS` required. `AUTH_PROXY_USER_CREATION=1` to auto-create. `DISABLE_LOCAL_AUTH` hides the password form. Sessions swept after `CLEANUP_REMOVE_SESSIONS_DAYS` (30). [5] |
| **Vaultwarden** | First registered user. | `SIGNUPS_ALLOWED=false` hides the create-account link. `SIGNUPS_DOMAINS_WHITELIST` overrides it for listed domains. `INVITATIONS_ALLOWED` controls org invites separately. | Admin page "Users" section creates users shown as "Invited", which works "regardless of any of the restrictions above". | Bitwarden client tokens. | Per-user vaults, orgs for sharing. | Not applicable. [6] |
| **Immich** | "The first user to register will be the admin user." | Closed after the first user. | Admin creates users. "Reset Password" sets "a random password and they have to change it next time they sign in." Delete: "The user account will immediately become disabled and their library and all associated data will be removed after 7 days by default", with an option for immediate deletion. Per-user storage quota. | Per-user API keys. | Per-user libraries with explicit sharing. | OAuth. [7] |
| **Grafana** | `admin`/`admin` default. | Configurable. | Server admin creates users and orgs. | Per-user and service-account tokens. | Organizations as tenants, users belong to orgs with roles. | `[auth.proxy]` with `header_name = X-WEBAUTH-USER`, `auto_sign_up = true`, and `whitelist` "to prevent users spoofing the X-WEBAUTH-USER header". [8] |
| **Paperless-ngx** | `PAPERLESS_ADMIN_USER` env or `createsuperuser`. | Closed. | Admin creates users and groups. | Per-user API tokens. | Every object has an owner plus view and edit grants. Superusers see everything. Documents consumed from the folder have no owner and are visible to all. | Remote-user header support. [9] |
| **Monica** (personal CRM) | First registration creates the account. | `APP_DISABLE_SIGNUP` closes it (documented in the project's `.env.example`, not on the user-management page). | Administrator enters an email, picks a permission level, and "the invited person receives a link to create their account." | Per-user tokens. | Accounts contain users and vaults. Administrators manage users, billing, and settings. Regular users manage their own vaults. | Not applicable. [10] |
| **Mealie** | Default admin from env, must be changed. | Configurable. | "You can add new users with sign-up links or simply create a new user in the admin panel." Invite links are listed in a table where the admin can delete or copy them. | Per-user tokens. | Groups and households. | OIDC. [11] |
| **Navidrome** | "Create your first user, which will be your admin user." | Closed after the first user. | Admin UI and CLI. | Subsonic tokens per user. | Shared library, per-user playlists and state. | Reverse-proxy header auth. [12] |
| **Audiobookshelf** | The first account is "Root", which admins cannot edit. | Closed. | Admins create users. | Per-user tokens. | Shared libraries with per-user permissions. | OIDC. [13] |

Patterns that appear in almost every app:

1. **The first user is the admin and the door closes behind them.** Contrack already does this (`countUsers() === 0` makes the first account an admin, then `/setup` returns 409).
2. **Open registration is a flag that defaults to closed.** Gitea, Vaultwarden, Monica, Miniflux, Immich all default closed on a fresh install. This plan adds `auth.registrationOpen`, default `false`.
3. **Admins create users through two paths:** a temporary password with a forced change on first sign-in (Immich, Gitea's `--random-password`), or an invitation link the admin copies (Mealie, Monica, Vaultwarden). A self-hosted app has no mail server, so the link must be shown to the admin, not emailed. This plan supports both.
4. **API credentials are per user, created in account settings.** Gitea, Miniflux, Immich, Paperless. A shared instance token is not a pattern any of them use.
5. **Delete is two-step.** Immich disables first and purges after seven days. Paperless and Gitea refuse to delete an owner that still holds objects unless the admin decides what happens to them. This plan requires an explicit data decision (`purge` or `export-then-purge`) and keeps `ON DELETE RESTRICT` as the safety rail.
6. **Reverse-proxy header auth is the common "SSO for self-hosters" path**, and every app that offers it pairs it with a trusted-proxy IP list because the header is trivially spoofable otherwise. This is deferred to [11-future.md](11-future.md) with that constraint recorded.
7. **Personal-data apps do not let the admin browse member data.** Miniflux and Monica keep user data private to the user. Paperless is the counterexample, and its own discussions list superuser visibility as a surprise for new operators. This plan chooses privacy (D10).

---

## 3. Data isolation enforcement in application code

The OWASP IDOR prevention cheat sheet states: "implement access control checks
for each object that users try to access" and "Verify the user's permission
every time an access attempt is made." On random identifiers it says to "use
complex identifiers as a defense-in-depth measure, but remember that access
control is crucial even with these identifiers." Its Rails example scopes the
query to "projects related to the current user rather than all projects". The
sheet does not prescribe a status code for a denied object. [14]

Contrack already uses UUIDs for every id. That is the defense-in-depth layer.
It is not the control. The control is the scoped query.

The Postgres row-level-security literature is the gold standard for
"impossible to forget". Crunchy Data's pattern sets a session variable per
request and lets a `CREATE POLICY ... USING (org_id = current_setting(...))`
filter every query automatically: "any queries executed within the request
will automatically be filtered based on the current tenant ID". [15]

SQLite has no policies. The closest equivalents in application code are:

- A repository boundary whose functions require the scope as a parameter, so the type checker rejects a call that forgets it. This is what the existing schema comment in `src/db/schema.ts` already asks for.
- A request-scoped context that carries the principal to code that is too deep to thread a parameter through. Node's `AsyncLocalStorage` is stable since 16.4 and is O(1) to read. One published HTTP benchmark measured about 10 percent lower throughput with it enabled on Node 22 and about 7 percent on Node 24, where the `AsyncContextFrame` implementation is the default. [16] [22] The cost per request is microseconds. This app spends its request time in SQLite and in AI calls, so the Phase 0 baseline is the number that matters. The Node documentation also states that an `EventEmitter` listener runs in the context of the code that emits, not the code that subscribed, unless bound with `AsyncResource.bind()`. [16] This is why the plan captures the scope in a closure for every SSE handler.
- Tests that try cross-tenant access for every route, and a lint that fails on a statement over a tenant table without the tenant predicate.

**Taken for this plan:** explicit `Scope` at the repository and service boundary as the control, `AsyncLocalStorage` for attribution, and the three structural guards in [03-architecture.md](03-architecture.md) section 5.3.

**On 404 versus 403:** OWASP does not prescribe it. The plan chooses `404` for cross-owner ids because a `403` confirms that the id exists, which is exactly the enumeration signal the cheat sheet warns about. GitHub, for example, returns `404` for private repositories the caller cannot see.

---

## 4. Indexes, FTS5, and sqlite-vec

**Composite indexes.** The multi-tenant Postgres guidance is uniform:
"Every table with an RLS policy needs `tenant_id` as the leading column in
its primary access indexes", with shapes like `(tenant_id, created_at DESC)`
and `(tenant_id, status, updated_at)`. One write-up measured two orders of
magnitude difference when the leading column was missing. [17] SQLite's
planner works the same way for a B-tree: the leading column must be an
equality predicate for the index to narrow the scan. Section 8 of
[03-architecture.md](03-architecture.md) applies this to every owned table.

**FTS5.** From the SQLite FTS5 documentation: columns marked `UNINDEXED` "are
not added to the FTS index", so they cannot be used in `MATCH`. Column
filters use the syntax `colname : phrase`, filters can wrap arbitrary
expressions such as `(b : "hello") AND ({a b} : "world")`, and `AND` binds
tighter than `OR`. `bm25(ft, w1, w2, ...)` assigns weights left to right,
**counting every column including `UNINDEXED` ones**, and a weight of `0.0`
removes that column from the score. The `unicode61` tokenizer treats Unicode
letters and numbers as token characters and everything else, including `-`
and `_`, as separators. [18]

Two facts from the FTS5 source that the documentation does not state. First,
`xBestIndex` consumes only `MATCH`, `rowid`, and `rank` constraints, so an
`=` predicate on any regular column, indexed or not, is evaluated by the
SQLite core after the virtual table returns each row. This applies to the
`DELETE FROM contacts_fts WHERE contactId = ?` in today's triggers, which
scans the whole table because `contactId` is `UNINDEXED`. Second, an `AND`
node advances the child with the smaller rowid to the larger one (a leapfrog
intersection), not a full read of both doclists, so an `AND` with a very
common term costs about the rarer side plus seeks. [18] The review measured
both (section 2 of the risks document).

Consequences for the design in section 6 of the architecture document: an
`UNINDEXED` owner column would be filtered by the SQLite core after the
virtual table returns rows, which is a post-filter. An indexed owner token
column lets FTS5 intersect posting lists. A raw UUID would split into five
tokens on the hyphens, so the token is the UUID with hyphens removed and a
letter prefix. A weight of `0.0` on that column removes it from ranking. The
same technique, applied to the contact id, turns the trigger delete from a
table scan into an index probe. There is no documented "tenant token"
precedent for FTS5; the approach is justified by the leapfrog evaluation and
by measurement.

**sqlite-vec.** The `vec0` documentation shows partition keys declared as
`user_id integer partition key`, with `TEXT` also shown as a supported type,
and a KNN query filtered as `where contents_embedding match :query and k = 20
and user_id = 123`. "Any `=` constraint in a `WHERE` clause on a partition key
column will restrict the search to that clause." Limits: at most 4 partition
keys per table (with a caution above 1), at most 16 metadata columns.
Performance guidance: "every unique partition key value has ~100s of vectors"
to avoid over-sharding. [19] Partition keys, metadata columns, and auxiliary
columns shipped in v0.1.6, and "partition key columns can only be `TEXT` or
`INTEGER` values". [20] The installed package is 0.1.9, which is the latest
stable release. [24]

Limits verified on 0.1.9 during the review, from the issue tracker and by
test: `UPDATE` of a partition key column is refused ("not supported yet"),
and an `UPDATE` of another column whose `WHERE` uses `EXISTS` trips the same
error (issue #261). `partitionCol IN (...)` is not supported (issue #142).
`k` has a maximum of 4096 (issue #157). Before 0.1.7, `DELETE` did not
reclaim space. `ALTER TABLE ... RENAME` on a `vec0` table returns OK on 0.1.9
but leaves the shadow tables under the old name, so the table is broken
afterward; rename support arrives in 0.1.10, which is a pre-release. An
`INSERT` that omits the partition column succeeds with a `NULL` partition.
`DELETE`, `SELECT`, and `COUNT(*)` with `WHERE partitionCol = ?` work. [24]

---

## 5. Admin user management conventions

Collected from the apps above:

| Concern | Convention | Source |
| ------- | ---------- | ------ |
| Create user | Admin sets a temporary password and the user must change it on first sign-in | Immich [7], Gitea `--random-password` [4] |
| Invite user | Admin generates a link with an expiry, copies it, and can revoke it from a list | Mealie [11], Monica [10], Vaultwarden [6] |
| Reset password | Admin resets to a random value and forces a change | Immich [7] |
| Disable vs delete | Disable is immediate and reversible. Delete waits or requires an explicit choice about data | Immich [7] |
| Last admin | Gitea refuses to delete or demote the last admin (`auth.last_admin`) and refuses self-deletion. Grafana refuses with "cannot remove last grafana admin". Immich and Keycloak do not protect the last admin; Immich blocks self-deletion only. The plan follows Gitea and Grafana, and adds the self-target guard all three apply. | [25] |
| Roles | Two roles (admin, user) is the norm for personal-data apps. Grafana and Gitea add org-level roles only because they have sharing. | [5], [7], [8] |
| Registration | Flag, default closed | [4], [6], [10] |
| Audit | Grafana and Gitea keep admin audit trails. Miniflux logs to stdout. | [4], [8] |

---

## 6. Auth details

- **Sessions over JWT.** Contrack already stores sessions server-side so revocation works. Miniflux does the same and sweeps sessions after 30 days. [5] No change.
- **Token format.** GitHub moved to prefixed tokens such as `ghp_` so that secret scanners can identify them. The old 40-hex format was "indistinguishable from other encoded data like SHA hashes". [21] GitHub's audit log identifies tokens by their SHA-256, which is how the stored form is known to be a hash. [23] This plan uses `ctk_` and stores a SHA-256. Since the token is 32 random bytes, a fast hash is correct, the same reasoning the existing `sessions` table applies.
- **Reverse-proxy auth.** Gitea, Miniflux, and Grafana all support a trusted header from an authenticating proxy, and all three require an allowlist of proxy addresses. [4], [5], [8] Deferred, with the allowlist requirement recorded.

---

## 7. Background jobs and caches

No primary source gives a recipe for single-process, single-writer job
fairness. The reasoning in this plan is first-principles:

- SQLite has one writer at a time. Two owners' scans cannot run in parallel on one connection anyway, so a global run lock is not a regression. Per-owner **state** is what prevents information leaks and wrong 429s.
- Provider rate limits are per API key. With instance-level keys, a global concurrency cap is the correct model for the AI Search batch queue.
- Caches keyed by content that depends on the owner's data must include the owner in the key. Caches keyed by a pure function of the input (query parse, HyDE) can be shared and sharing saves paid calls.

---

## Sources

1. Tenancy models for a multitenant solution, Azure Architecture Center. https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenancy-models
2. Multitenant SaaS patterns, Azure SQL Database. https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns
3. Implementation limits for SQLite (`SQLITE_MAX_ATTACHED`). https://sqlite.org/limits.html
4. Gitea configuration cheat sheet. https://docs.gitea.com/administration/config-cheat-sheet/ and command line reference https://docs.gitea.com/administration/command-line/
5. Miniflux configuration parameters. https://miniflux.app/docs/configuration.html and API reference https://miniflux.app/docs/api.html
6. Vaultwarden wiki, disable registration of new users. https://github.com/dani-garcia/vaultwarden/wiki/Disable-registration-of-new-users and disable invitations https://github.com/dani-garcia/vaultwarden/wiki/Disable-invitations
7. Immich user management. https://docs.immich.app/administration/user-management/ and post-install steps https://docs.immich.app/install/post-install/
8. Grafana, configure auth proxy authentication. https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/auth-proxy/
9. Paperless-ngx usage and permissions. https://docs.paperless-ngx.com/usage/ and multi-user discussion https://github.com/paperless-ngx/paperless-ngx/discussions/5878
10. Monica, manage users. https://docs.monicahq.com/user-and-account-settings/manage-users
11. Mealie user management (invite links). https://docs.mealie.io/ (User Management section)
12. Navidrome getting started. https://www.navidrome.org/docs/getting-started/
13. Audiobookshelf user management. https://audiobookshelf.org/docs/documentation/server-management/user-management/
14. OWASP Insecure Direct Object Reference Prevention Cheat Sheet. https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html
15. Row Level Security for tenants in Postgres, Crunchy Data. https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres
16. Node.js asynchronous context tracking. https://nodejs.org/api/async_context.html and a production guide https://www.hirenodejs.com/blog/nodejs-async-local-storage-2026
17. Postgres RLS multi-tenant patterns and index guidance. https://queryplane.com/blog/postgres-row-level-security-in-practice/ and https://patotski.com/blog/postgres-row-level-security-multi-tenant/
18. SQLite FTS5 extension. https://www.sqlite.org/fts5.html
19. sqlite-vec `vec0` documentation, partition keys and metadata. https://alexgarcia.xyz/sqlite-vec/features/vec0.html
20. sqlite-vec metadata release post (v0.1.6). https://alexgarcia.xyz/blog/2024/sqlite-vec-metadata-release/index.html
21. Behind GitHub's new authentication token formats. https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/
22. The hidden cost of context (AsyncLocalStorage HTTP benchmark on Node 22 and 24), Platformatic. https://blog.platformatic.dev/the-hidden-cost-of-context
23. Identifying audit log events performed by an access token (`hashed_token` is the SHA-256), GitHub Docs. https://docs.github.com/en/enterprise-cloud@latest/admin/monitoring-activity-in-your-enterprise/reviewing-audit-logs-for-your-enterprise/identifying-audit-log-events-performed-by-an-access-token
24. sqlite-vec releases and issues. https://github.com/asg017/sqlite-vec/releases, https://github.com/asg017/sqlite-vec/issues/261, https://github.com/asg017/sqlite-vec/issues/142, https://github.com/asg017/sqlite-vec/issues/157. Virtual table rename rule: https://www.sqlite.org/vtab.html section 2.19.
25. Last-admin protection in Gitea (`routers/web/admin/users.go`, `IsErrDeleteLastAdminUser`) https://github.com/go-gitea/gitea/blob/main/routers/web/admin/users.go and Grafana (`ErrLastGrafanaAdmin`) https://github.com/grafana/grafana/blob/main/pkg/services/user/error.go. Immich `user-admin.service.ts` blocks self-delete only. Keycloak issue #20662 closed as not planned.
26. Express 5 migration guide (`app.router` returns) https://expressjs.com/en/guide/migrating-5.html and the mount-path discussion https://github.com/expressjs/express/discussions/5961. `express-route-parser` records mount paths by patching `Router.prototype.use` https://github.com/nklisch/express-route-parser.
27. multer issue #1111, AsyncLocalStorage lost after the multer middleware when the multipart body carries text fields. https://github.com/expressjs/multer/issues/1111
28. SQLite `ALTER TABLE` restrictions https://www.sqlite.org/lang_altertable.html, `VACUUM INTO` https://www.sqlite.org/lang_vacuum.html, triggers https://www.sqlite.org/lang_createtrigger.html, foreign key actions https://www.sqlite.org/foreignkeys.html.
