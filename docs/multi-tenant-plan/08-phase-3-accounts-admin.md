# 08. Phase 3: Accounts, Roles, and the Admin API

**Goal:** an admin can create, invite, disable, and delete users, and manage
instance settings. Members get personal API tokens. Roles are enforced on
every route the manifest marks `admin`. Every admin action is audit-logged.
One daily maintenance interval sweeps expired and old rows.

**Lands on:** the `v2.0` branch, one PR (or two: accounts, then tokens and
audit) from `v2.0/phase-3-accounts-admin`.

**Size:** L (about 7 to 10 engineering days).

**Depends on:** Phase 2 (so that every new endpoint is scoped from the start
and the `admin` class exists in the manifest).

This document is written so that an implementer can work from it alone.
Every request and response shape is in [13-api-changes.md](13-api-changes.md);
the ones needed here are repeated in section 2.

---

## 0. Context for the implementer

### 0.1 Repository, commands, and workflow

Same as [05-phase-0-foundations.md](05-phase-0-foundations.md) sections 0.1
and 0.2. Feature branch into `v2.0`, squash-merge, `npm run lint` and
`npm test` green, raw vitest summary in the PR, no AI attribution,
`package.json` stays at `1.5.5`.

### 0.2 State at the start of this phase (after Phase 2)

- Every scoped route filters by owner. The matrix is green. `tenant-lint --strict` covers `server/`.
- `requireSession` (403 `SESSION_REQUIRED`) and `requireAdmin` (403 `ADMIN_REQUIRED`) exist in `server/middleware/auth.ts`. `requireAdmin` is not mounted anywhere.
- `attachPrincipal` already resolves `Bearer ctk_...` against `api_tokens` (Phase 1). No endpoint creates tokens.
- Tables `api_tokens`, `invitations`, `user_settings`, `audit_log` exist and are empty. `users` has `status`, `credentialState`, `mustChangePassword`, `passwordChangedAt`, `disabledAt`, `createdBy`.
- `exportService.buildFullExport(scope)` exists.
- `aiEndpointRateLimit` (per IP, 60 per minute on `AI_COST_PATTERNS`) mounts **before** `attachPrincipal` in `server/app.ts`. `req.requestId` is assigned above it (Phase 0). `createRateLimiter({ windowMs, max, name })` (`server/middleware/rateLimit.ts:37-41`) keys by `req.ip` and has no `keyBy` option. `RateLimitedError` (`server/utils/AppError.ts:100-104`) accepts `details`. No `Retry-After` header is set anywhere.
- `credentialLimiter` (10 per minute per IP) and `setupLimiter` (5 per minute) are module-private in `server/routes/auth.ts:60-71`, with `__resetAuthRateLimits()` at `:74`.
- `cleanupOldInvocations` runs once at boot (`server.ts:170-174`). The session sweep is boot-only (`server/db.ts:193-198`). There is no daily interval to attach to.
- `AI_COST_PATTERNS` (`rateLimit.ts:82-91`) covers `/api/search/semantic`, `/api/search/synthesize`, `/api/parse-contact`, `/api/contacts/:id/enrich`, `/api/contacts/:id/briefing`, `/api/ai-search` (exact), `/api/dedupe/backfill-embeddings`, and the `/api/link-preview` prefix. It does not cover `GET /api/dashboard/insight`, `POST /api/dedupe/scan`, or `POST /api/contacts/bulk`, all of which call a provider.
- `validateBody` with zod schemas lives in `server/utils/validators.ts`. `AppError` subclasses: `NotFoundError`, `ValidationError`, `ConflictError`, `RateLimitedError`, `ServiceUnavailableError`, `UpstreamTimeoutError`.
- `passwords.ts` exports `hashPassword` and `verifyPassword` (scrypt, self-describing hash).
- FK behavior that matters for delete: `sessions.userId`, `api_tokens.userId`, `user_settings.userId`, `invitations.invitedBy` are `ON DELETE CASCADE`; `audit_log.actorUserId`, `invitations.acceptedBy`, `users.createdBy` are `ON DELETE SET NULL`; every `ownerId` is `ON DELETE RESTRICT`; `search_embeddings`, `contact_embeddings`, `dedupe_embedding_meta`, and `dedupe_merge_log` have **no** FK to `contacts` or `users` and must be deleted explicitly.
- FTS triggers delete by `cidTok` (Phase 1). An owner purge of 5,000 contacts with 10,000 emails measured 0.2 s; with the old triggers it took 77 s.

---

## 1. Deliverables

| # | Deliverable | Files |
| - | ----------- | ----- |
| 3.1 | `requireAdmin` mounted on every `admin` route. Member gets `403 ADMIN_REQUIRED`. | `server/middleware/auth.ts`, route files |
| 3.2 | `adminService` and `/api/admin/users/*` | `server/services/adminService.ts` (new), `server/routes/admin.ts` (new) |
| 3.3 | `invitationService`, `/api/admin/invitations/*`, `POST /api/auth/accept-invitation` | `server/services/invitationService.ts` (new), `server/routes/admin.ts`, `server/routes/auth.ts` |
| 3.4 | Temporary password and forced change | `adminService`, `server/middleware/auth.ts` (`requirePasswordCurrent`), `server/routes/auth.ts` |
| 3.5 | Disable and enable. Delete with a data decision. Last-admin and self guards. | `adminService` |
| 3.6 | `apiTokenService` and `/api/auth/tokens/*` | `server/services/apiTokenService.ts` (new), `server/routes/auth.ts` |
| 3.7 | Open registration setting and `POST /api/auth/register` | `server/services/settingsService.ts` (key), `server/routes/auth.ts`, `server/routes/admin.ts` |
| 3.8 | `auditService`, `GET /api/admin/audit`, and the daily maintenance interval | `server/services/auditService.ts` (new), `server.ts` |
| 3.9 | Per-user rate limiter on AI-cost routes, mounted after `attachPrincipal` | `server/middleware/rateLimit.ts`, `server/app.ts` |
| 3.10 | Admin views of AI stats and cache tiers | `server/routes/aiStats.ts` |
| 3.11 | `/api/auth/status` and `/api/auth/me` additions | `server/routes/auth.ts` |
| 3.12 | Legacy `API_TOKEN` deprecation path | `server/middleware/auth.ts`, docs |
| 3.13 | Route manifest rows for every new route, `api.admin.test.ts` | `server/tenancy/routeManifest.ts`, `tests/integration/api.admin.test.ts` (new) |
| 3.14 | CHANGELOG entry | `CHANGELOG.md` |

---

## 2. Tasks

### 3.1 Role enforcement

Mount `requireAdmin` at **route level** (not with `router.use`) on every
route classed `admin` in the manifest, so the manifest test can see it in
`route.stack`:

- `server/routes/admin.ts`: every route.
- `server/routes/dataLifecycle.ts`: `GET /backups`, `POST /backups`.
- `server/routes/aiSettings.ts`: every `PUT`, `DELETE`, `POST`.
- `server/routes/auth.ts`: `PUT /session-policy`.
- `server/routes/ai.ts`: `GET /diagnostics`, `GET /grounding-capacity`.
- `server/routes/dedupe/embeddings.ts`: `POST /backfill-embeddings`.
- `GET /api/debug/cache-stats` (dev only, inside `createApp()` since Phase 0).

Test: a member calling each of these gets `403 ADMIN_REQUIRED`. The route
manifest test asserts every `admin` route's `route.stack` contains a handler
named `requireAdmin` (the function must be a named function, not an arrow
assigned to a const, or `handle.name` is empty).

### 3.2 User management

`server/services/adminService.ts`:

```ts
listUsers(): AdminUserSummary[]
// id, email, username, displayName, role, status, credentialState, mustChangePassword,
// createdAt, lastLoginAt, passwordChangedAt, contactCount, sessionCount, tokenCount, isLocalOwner
getUser(id): { user: AdminUserSummary; counts: { contacts, interactions, lists, files } }
createUser(actor, input: { email, username, displayName?, role, temporaryPassword? })
//   validates like authService.createUser (reuse its validators), generates a 20-char password from a
//   62-char alphabet when omitted, sets mustChangePassword = 1, createdBy = actor.id
updateUser(actor, id, patch: { role?, displayName? })
//   role change: LAST_ADMIN guard when demoting the last active admin
resetPassword(actor, id): { temporaryPassword }
//   new hash, mustChangePassword = 1, revoke every session and every token for the user
disableUser(actor, id) / enableUser(actor, id)
//   disable: status = 'disabled', disabledAt, revoke sessions; tokens stay but are refused while disabled
//   LAST_ADMIN guard on disable. CANNOT_TARGET_SELF.
deleteUser(actor, id, decision?: "purge"): { deleted: true, counts } | throws USER_HAS_DATA with counts
exportUserData(actor, id): FullExport
//   exportService.buildFullExport(scopeForOwnerId(id)), audit-logged. The one admin read of member data.
```

`contactCount` uses `idx_contacts_owner_deleted`:
`SELECT COUNT(*) FROM contacts WHERE ownerId = ? AND deletedAt IS NULL`.
`files` counts rows with a non-null `fileUrl` under `interactions` plus
contacts with an `/uploads/` avatar.

`server/routes/admin.ts` is mounted at `/api/admin` in `server/app.ts` after
`requireAuth`. Every handler uses `validateBody` with zod schemas added to
`server/utils/validators.ts` and `asyncHandler`.

The local owner account (`credentialState = 'none'`) appears in the list with
`isLocalOwner: true` and cannot be disabled or deleted while
`isAuthRequired()` is false. When auth is on it has been converted by setup
and is a normal admin account.

### 3.3 Invitations

`server/services/invitationService.ts`:

```ts
createInvitation(actor, { email?, role, expiresInDays = 7 }, origin): { id, link, expiresAt }
//   secret = 32 random bytes base64url. Store sha256 hex. Return the link once.
listInvitations(): InvitationSummary[]   // pending, accepted, revoked, expired (derived from expiresAt)
revokeInvitation(actor, id)
acceptInvitation({ token, email, username, password, displayName? }): User
//   hash lookup, check not accepted/revoked/expired, createUser with role from the row,
//   mark acceptedAt/acceptedBy, create session.
```

The link format is `${origin}/join?token=${secret}`. `origin` comes from the
request (`x-forwarded-proto` and `host`, which `trust proxy` in `app.ts`
already honors), so it is right behind a proxy. The admin copies it. There
is no mail.

`POST /api/auth/accept-invitation` lives in `server/routes/auth.ts` so it can
reuse the module-private `credentialLimiter`. It returns `404` for an unknown
or malformed token (same body for both, no enumeration), `410` with
`INVITATION_USED`, `INVITATION_EXPIRED`, or `INVITATION_REVOKED` otherwise.

Deleting an admin cascades their pending invitations
(`invitations.invitedBy ON DELETE CASCADE`). Accepted invitations keep their
row with `invitedBy` gone. Document this in the admin UI copy (Phase 4).

### 3.4 Temporary password and forced change

- `users.mustChangePassword = 1` is set by `createUser` (admin path) and `resetPassword`.
- `requirePasswordCurrent` middleware, mounted after `requireAuth` on `/api` and `/uploads`: when `principal.user.mustChangePassword` is set, every path except `/api/auth/*` returns `403 PASSWORD_CHANGE_REQUIRED`. This applies to `session`, `token`, and `legacy-env-token` principals alike, because the temporary password is not a credential the user chose. The `implicit` principal never has the flag.
- `POST /api/auth/change-password` clears the flag and sets `passwordChangedAt`. For a `mustChangePassword` user, `currentPassword` is still required (it is the temporary one).
- `GET /api/auth/status` and `/me` return `mustChangePassword`.

### 3.5 Disable and delete

**Disable** is the recommended first step and is reversible. Sessions are
revoked immediately. The next request from a disabled user's cookie or token
is refused because `resolveSession` and the token lookup check `status`
(Phase 1).

**Delete** requires `decision: "purge"` in the body. Without it, the response
is `409 USER_HAS_DATA` with the counts, so the admin knows what will go. The
UI shows the export button next to the delete button.

Purge order, in one transaction, for `ownerId = target`:

1. `DELETE FROM search_embeddings WHERE ownerId = ?` and the same for `contact_embeddings` (a `vec0` delete by partition key, verified). Then `DELETE FROM dedupe_embedding_meta WHERE contactId IN (SELECT id FROM contacts WHERE ownerId = ?)`.
2. `DELETE FROM dedupe_suggestions`, `dedupe_exclusions`, `dedupe_merge_log`, `ai_invocations` `WHERE ownerId = ?`.
3. `DELETE FROM action_items`, `interactions` `WHERE ownerId = ?` (cascades `interaction_mentions`).
4. `DELETE FROM lists WHERE ownerId = ?` (cascades `list_members`).
5. `DELETE FROM contacts WHERE ownerId = ?` (cascades the ten child tables; the FTS triggers remove index rows by `cidTok`).
6. `DELETE FROM users WHERE id = ?` (cascades `sessions`, `api_tokens`, `user_settings`, and the user's pending `invitations`; `audit_log.actorUserId`, `invitations.acceptedBy`, and `users.createdBy` become `NULL`).
7. After commit: `fs.rm(ownerUploadDir(target, "avatars"), { recursive: true, force: true })` and the same for `files`.

Guards: cannot delete self (`400 CANNOT_TARGET_SELF`). `409 LAST_ADMIN` when
the target is the last active admin. Audit log entry with the counts.

Cost: 5,000 contacts with 10,000 emails purged in 0.2 s on the synthetic
schema with the `cidTok` triggers (measured). The acceptance criterion is
10,000 contacts in under 2 s on the real schema. If a real database exceeds
that, chunk step 5 at 1,000 contacts per transaction; a crash between chunks
leaves a partially deleted but consistent owner that the next purge call
finishes.

### 3.6 API tokens

`server/services/apiTokenService.ts`:

```ts
createToken(user, { name, expiresInDays? }): { id, token, tokenPrefix, expiresAt }
//   token = "ctk_" + base64url(32 random bytes). Store sha256 hex. Return the token once.
listTokens(userId): TokenSummary[]   // id, name, tokenPrefix, createdAt, lastUsedAt, expiresAt, revokedAt
revokeToken(userId, id)              // WHERE id = ? AND userId = ?, 404 otherwise
resolveToken(presented): { user, tokenId } | null
//   hash lookup, reject revoked/expired, reject disabled user, touch lastUsedAt at most hourly
```

Routes under `/api/auth/tokens` with `requireSession`. A token cannot create
or list tokens. Token creation is limited to 10 per hour per user with the
`keyBy` limiter from 3.9. `attachPrincipal` already calls `resolveToken`
(Phase 1); move that lookup into this service.

### 3.7 Open registration

- Setting key `auth.registrationOpen` in `app_settings`, default `false`, added to `SETTING_KEYS` in `settingsService.ts`.
- `GET /api/admin/settings` and `PUT /api/admin/settings` expose it, alongside `sessionTtlDays` (which moves from `/api/auth/session-policy` to here; the old endpoint stays as an alias for one release).
- `POST /api/auth/register` lives in `server/routes/auth.ts`, uses `credentialLimiter`, and returns `403 REGISTRATION_CLOSED` when the flag is off. Creates a `member`.
- `/api/auth/status` returns `registrationOpen`.

### 3.8 Audit log and the daily maintenance interval

`server/services/auditService.ts`: `record(actor, action, target?, details?, ip?)`.
Synchronous insert inside a `try/catch` that logs and never throws into the
caller.

Events recorded:

| Action | Where |
| ------ | ----- |
| `auth.login.success`, `auth.login.failed` (username only, no password), `auth.logout` | `routes/auth.ts` |
| `auth.password.changed` | `routes/auth.ts` |
| `auth.token.created`, `auth.token.revoked` | `apiTokenService` |
| `user.created`, `user.invited`, `user.invitation.accepted`, `user.invitation.revoked` | `adminService`, `invitationService` |
| `user.role.changed`, `user.disabled`, `user.enabled`, `user.password.reset`, `user.deleted`, `user.exported` | `adminService` |
| `settings.changed` (key names only) | `routes/aiSettings.ts`, `routes/admin.ts` |
| `backup.created` | `routes/dataLifecycle.ts` |

`GET /api/admin/audit?limit=&before=` paginates newest first with
`idx_audit_created`.

**Daily maintenance interval.** Add one `setInterval` in `server.ts`, gated
by `DISABLE_BACKGROUND_JOBS` like the trash purge, that runs at boot and
every 24 h:

1. `DELETE FROM audit_log WHERE createdAt < datetime('now', '-90 days')`.
2. `DELETE FROM sessions WHERE expiresAt <= datetime('now')` (today boot-only).
3. `DELETE FROM api_tokens WHERE revokedAt IS NOT NULL AND revokedAt < datetime('now', '-30 days')` (expired tokens stay listed as expired; revoked ones age out).
4. `DELETE FROM invitations WHERE (revokedAt IS NOT NULL OR expiresAt < datetime('now')) AND createdAt < datetime('now', '-30 days')`.
5. `cleanupOldInvocations()` (move the boot-only call here so it runs daily).

Log one line with the five counts.

### 3.9 Per-user rate limits

- `createRateLimiter` gains `keyBy?: (req) => string | null` (default `req.ip`). A `null` key skips the limiter for that request.
- A second limiter `aiUserLimiter` keyed by `req.principal?.user.id ?? null` at 30 requests per minute, applied to the same `AI_COST_PATTERNS` plus `GET /api/dashboard/insight` and `POST /api/dedupe/scan` (risks document Q16). It is mounted in `server/app.ts` **after** `attachPrincipal` and `attachRequestContext`, before the routers. The existing per-IP limiter stays where it is (before `attachPrincipal`) and its pattern list gains the same two paths.
- Both limiters set a `Retry-After` header (seconds until the window resets) on the `429`.
- The `disableRateLimit` test option disables both.
- Token creation (3.6) uses `createRateLimiter({ windowMs: 3_600_000, max: 10, keyBy: user id, name: "token creation" })`.

### 3.10 Admin AI stats

`GET /api/ai/stats/summary?scope=all` and `GET /api/ai/stats/feed?scope=all`
return instance totals and a `byUser` breakdown for admins. Members get
`403 ADMIN_REQUIRED` for `scope=all`. The `cacheTiers` block is admin-only
(omitted for members since Phase 2f).

### 3.11 Status and me

`/api/auth/status` adds: `registrationOpen`, `localOwnerPresent`,
`legacyTokenConfigured`, `user.role` (already present), `user.status`,
`user.mustChangePassword`. `setupRequired` semantics from Phase 1.
`existingContacts` becomes `deviceContacts` (count owned by the local owner);
keep both names in the payload for this release so the current frontend
works until Phase 4 switches.

`/api/auth/me` adds `role`, `status`, `mustChangePassword`, `credentialState`,
and `via`.

### 3.12 Legacy token

- Boot warning when `API_TOKEN` or `AUTH_TOKEN` is set (Phase 1 added the once-only warning; keep it).
- Docs: "Create a personal token in Settings → Account → API tokens and remove `API_TOKEN` from your environment. The environment token maps to the first admin and will be removed in 3.0."
- `GET /api/auth/status` reports `legacyTokenConfigured: true` so the admin UI can show a banner.

### 3.13 Manifest and tests

Add every new route to `ROUTE_MANIFEST` with its class (appendix B, "Routes
added in Phase 3"). `tests/integration/api.admin.test.ts` covers the
acceptance list below with the two-user harness plus a third actor for the
"two admins" cases.

---

## 3. Acceptance criteria

- [ ] Every `admin` route returns `403 ADMIN_REQUIRED` to a member and `200` to an admin. Tested by iterating the manifest. The manifest test asserts `requireAdmin` in each route's stack.
- [ ] Create user with temporary password: user signs in, every data route returns `403 PASSWORD_CHANGE_REQUIRED`, change succeeds, data routes work. A token created before the reset is refused with the same code until the change.
- [ ] Invite: link accepted once. Second acceptance `410 INVITATION_USED`. Expired `410 INVITATION_EXPIRED`. Revoked `410 INVITATION_REVOKED`. Unknown and malformed token both `404` with identical bodies.
- [ ] Disable: live session refused on next request. Token refused. Enable restores the token; the session stays revoked.
- [ ] Delete without decision `409 USER_HAS_DATA` with counts. With `purge`: every owned row gone, upload directory gone, FTS and `vec0` rows gone, `dedupe_embedding_meta` rows gone, verified by counting. Other owners' rows untouched (counted before and after). 10,000 contacts purge in under 2 s.
- [ ] Last admin: demote, disable, delete each return `409 LAST_ADMIN`. Two admins: allowed.
- [ ] Self: disable and delete return `400 CANNOT_TARGET_SELF`.
- [ ] Tokens: created token works on `GET /api/contacts` and on every MCP route, is refused on `GET /api/auth/me` (`403 SESSION_REQUIRED`), revoked token `401`, expired token `401`, token of a disabled user `401`. `lastUsedAt` updates at most hourly. Eleventh token in an hour `429`.
- [ ] Registration: closed by default `403 REGISTRATION_CLOSED`. Open: creates a member, closes again when toggled off.
- [ ] Audit: each listed action produces one row. `GET /api/admin/audit` paginates. Details never contain a password, token, invitation secret, or provider key (grep the test output for `ctk_` and for the seeded passwords).
- [ ] Per-user AI rate limit: user A hitting 31 semantic searches in a minute gets `429` with `Retry-After`. User B on the same IP is unaffected. `GET /api/dashboard/insight` and `POST /api/dedupe/scan` are covered.
- [ ] Daily maintenance interval: with the clock advanced, old audit rows, expired sessions, aged revoked tokens, aged dead invitations, and old invocations are gone. Gated by `DISABLE_BACKGROUND_JOBS`.
- [ ] Legacy `API_TOKEN` still works, maps to the primary admin, and logs one warning.
- [ ] `tenant-lint --strict` still green. Route manifest green with the new routes classified.
- [ ] CHANGELOG Unreleased has a `Phase 3` block.

---

## 4. Risks

| Risk | Mitigation |
| ---- | ---------- |
| Admin deletes the wrong user | Two-step: `409` with counts first, then `purge`. Export button next to delete. Audit row. The docs recommend disabling for a week before deleting, in line with Immich's 7-day model. |
| Purge transaction holds the write lock | Measured 0.2 s per 5,000 contacts with the `cidTok` triggers. `busy_timeout` is 5 s. The chunking fallback is described in 3.5. |
| Invitation link leaked | 7-day expiry, single use, revocable. The secret is only in the link. |
| Temporary password visible to the admin | By design and documented. The forced change is what makes it acceptable. |
| A route-level `requireAdmin` is forgotten on a new admin route | The manifest test checks `route.stack` for every `admin` row. |

---

## 5. Contract this phase delivers to Phase 4

- Every endpoint in [13-api-changes.md](13-api-changes.md) sections 3 and 4 exists with the documented shapes.
- `/api/auth/status` and `/me` carry the new fields; `deviceContacts` and `existingContacts` are both present.
- The `429` bodies carry `details.yours` (Phase 2) and a `Retry-After` header.
- `403` codes: `ADMIN_REQUIRED`, `SESSION_REQUIRED`, `ACCOUNT_DISABLED`, `PASSWORD_CHANGE_REQUIRED`, `REGISTRATION_CLOSED`.

---

## 6. Do not do in this phase

- Do not build UI. Phase 4.
- Do not add reverse-proxy auth, OIDC, or email. [11-future.md](11-future.md).
- Do not remove `PUT /api/auth/session-policy` or the environment `API_TOKEN`. Both are deprecated, not removed, in 2.0.
- Do not bump `package.json` version.
