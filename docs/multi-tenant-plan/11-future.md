# 11. Future Work (Not in 2.0)

Items considered during design and deliberately deferred. Each has the
decision it depends on and the cost it would add now.

## 1. Shared workspaces

Sharing a CRM between two people (a household, a two-person firm). The
upgrade path is in [03-architecture.md](03-architecture.md) section 12: a
`workspaces` table whose personal workspace id equals the user id, so
`ownerId` becomes a workspace id with no data migration. `Scope` gains
`actorUserId`. Needs a product decision on per-contact vs per-workspace
sharing, and a UI for switching workspaces. Not started until someone asks
for it.

## 2. Reverse-proxy header authentication

Gitea, Miniflux, and Grafana accept a trusted header such as
`X-WEBAUTH-USER` from an authenticating proxy (Authelia, Authentik, Tailscale
serve). Requirements recorded from their docs: a trusted-proxy CIDR list is
mandatory, auto-registration is a separate flag, and local password login can
be disabled. Implementation is about 150 lines in `attachPrincipal` plus
three settings. Deferred because the session model works behind any proxy
already, and the trusted-CIDR mistake is the most common self-hosting
security hole.

## 3. OIDC

Same shape as above with an OAuth code flow. Depends on a decision to add a
dependency (`openid-client`). Deferred.

## 4. Per-user AI keys and budgets

Some operators want each member to bring their own provider key or to cap
each member's spend. `user_settings` is the home for the key, and
`ai_invocations.ownerId` with `tokenCount` already supports a budget check.
The provider registry would need to resolve per owner, which changes the
`instances` cache key from credential fingerprint to owner plus fingerprint.
Deferred: instance keys paid by the operator is the common case for a home
server.

## 5. Per-owner job concurrency

The dedupe scan and the AI Search batch keep a global run lock in 2.0. A
per-owner concurrency cap of 1 with a global cap of 2 would let two users run
scans at once. The SQLite writer would serialize their writes anyway, and the
scan is CPU-bound on one thread. Revisit with evidence from the concurrency
benchmark.

## 6. User quotas

Immich lets the admin cap storage per user. The equivalent here is a maximum
contact count or upload size per user. The `contacts_owner_required` trigger
is the place a count check would go, or the service layer. Deferred until
there is a reason.

## 7. Soft-delete users with a grace period

Immich disables immediately and purges after 7 days. 2.0 has disable and
purge as separate manual steps. A scheduled purge with `users.deleteAfter`
is a small addition on top.

## 8. Move all DDL into Drizzle migrations

`server/db.ts` holds most of the schema as idempotent boot DDL. Consolidating
it into numbered Drizzle migrations would need the snapshot reconciled (it
lacks `users`, `sessions`, and every `ownerId` column, and it contains the
three dedupe tables that no migration file creates) and a one-time
"baseline" migration that is a no-op on existing databases. Worth doing, in
a release that has no schema change of its own.

## 9. Admin impersonation

Some admin consoles offer "sign in as user" for support. Rejected for this
product: it contradicts D10 (an admin does not read member data). The export
endpoint covers offboarding.

## 10. Passkeys and two-factor

WebAuthn on top of the session model. Miniflux added passkeys recently. No
dependency on tenancy. Separate project.

## 11. Email delivery for invitations and resets

A self-hosted app usually has no mail server. If SMTP settings are ever
added, invitations and resets can send the link instead of showing it. The
token flow is the same.

## 12. Per-owner backups and scheduled exports

Backups are whole-database snapshots for the operator. A member who wants a
scheduled export of their own data can use a personal token and the export
endpoint from cron. A built-in scheduler is a convenience for later.

## 13. Per-user server-side preferences

Weather unit, list density, and the dedupe threshold preset live in browser
`localStorage` today. `user_settings` gets its first rows in 2.0 (the per-user notification
settings in [15-additional-v2-features.md](15-additional-v2-features.md)),
so these three values can follow with a small settings UI per value.

## 14. sqlite-vec 0.1.10

The 0.1.10 pre-releases add ANN indexes, `ALTER TABLE RENAME` for `vec0`
tables, and `INSERT OR REPLACE`. The plan pins 0.1.9 and uses copy-rebuilds
and `DELETE` plus `INSERT`. When 0.1.10 is a stable release, the rebuild
helpers can use `RENAME` and the dedupe upsert can go back to
`INSERT OR REPLACE`.

## 15. An FTS external-content table

`contacts_fts` stores its own copy of every indexed column. An
external-content table keyed by `contacts.rowid` would halve the storage and
make the trigger delete a rowid lookup with no token column. It needs
`contacts` to have a stable `INTEGER PRIMARY KEY`, which it does not (its
key is a `TEXT` UUID), so it is a larger change than `cidTok` and is not
worth it for 2.0.
