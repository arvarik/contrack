# 13. API Changes

Every endpoint added, changed, or removed by this plan. Request and response
bodies use the existing conventions: JSON, `{ error: { message, code } }` on
failure, `requestId` in the error envelope.

---

## 1. Error codes added

| Status | `code` | When |
| ------ | ------ | ---- |
| 403 | `ADMIN_REQUIRED` | member calls an `admin` route |
| 403 | `SESSION_REQUIRED` | token or implicit principal calls a `session-self` route. **Replaces `USER_REQUIRED`**, which `requireUser` returns today and `api.auth.test.ts` asserts. Breaking for scripts that match on the code. |
| 403 | `ACCOUNT_DISABLED` | sign-in or request by a disabled account |
| 403 | `PASSWORD_CHANGE_REQUIRED` | any data route while `mustChangePassword` |
| 403 | `REGISTRATION_CLOSED` | `POST /api/auth/register` while closed |
| 409 | `LAST_ADMIN` | demote, disable, or delete the last active admin |
| 409 | `USER_HAS_DATA` | delete without `decision: "purge"` |
| 400 | `CANNOT_TARGET_SELF` | admin disables or deletes their own account |
| 409 | `LOCAL_OWNER_PROTECTED` | admin disables or deletes the local owner while `isAuthRequired()` is false. Added during Phase 3: [08-phase-3-accounts-admin.md](08-phase-3-accounts-admin.md) section 3.2 requires the guard and names no code. |
| 410 | `INVITATION_USED`, `INVITATION_EXPIRED`, `INVITATION_REVOKED` | accept flow |
| 429 | `RATE_LIMITED` (existing) with `details.yours: false` and a `Retry-After` header | dedupe or AI Search lock held by another user, or the per-user AI limiter. **The dedupe and AI Search `429` bodies change shape**: today `POST /api/dedupe/scan` and `POST /api/ai-search` return `{ error: string }` and bypass the envelope; in 2.0 they return the standard `{ error: { message, code, details, requestId } }`. |
| 500 | `NO_SCOPE` | programmer error, a scoped path ran without a scope |

`404 NOT_FOUND` is returned for any owned id that does not belong to the
caller. This is unchanged in shape and deliberate in semantics.

---

## 2. Changed endpoints

| Endpoint | Change |
| -------- | ------ |
| `GET /api/auth/status` | adds `registrationOpen`, `localOwnerPresent`, `legacyTokenConfigured`, `user.role`, `user.status`, `user.mustChangePassword`. `existingContacts` renamed `deviceContacts`; both names are sent in 2.0 and `existingContacts` is removed in 3.0. `setupRequired` is true only when no account has `credentialState = 'password'`. On an auth-off instance `user` is the local owner. |
| `POST /api/auth/setup` | converts the local owner when present, else creates. Same body. |
| `GET /api/auth/me` | adds `role`, `status`, `mustChangePassword`, `credentialState`, `via` (`session`, `token`, `implicit`, `legacy-env-token`). Returns `403 SESSION_REQUIRED` (was `USER_REQUIRED`) for a token. |
| `POST /api/auth/change-password` | clears `mustChangePassword`. |
| `GET /api/auth/session-policy` | unchanged, aliased by `GET /api/admin/settings`. |
| `PUT /api/auth/session-policy` | now `admin`. Aliased by `PUT /api/admin/settings`. Removed in 3.0. |
| Every route in class `scoped` | returns only the caller's rows. Ids from other owners give `404`. |
| `POST /api/contacts/bulk-delete`, `PUT /api/contacts/bulk-update`, `POST /api/trash/bulk-restore`, `PUT /api/lists/reorder`, `POST /api/lists/:id/members/bulk`, `POST /api/contacts/merge-batch`, `merge-cluster`, `merge-clusters` | operate on the caller's subset of the supplied ids. `count` reflects rows actually affected. `reorder` returns `404` if any id is foreign. |
| `POST /api/dedupe/scan` | `429` moves into the standard error envelope and gains `details: { yours: boolean, queued: boolean }`. |
| `GET /api/dedupe/active`, `GET /api/dedupe/status`, `GET /api/dedupe/stream` | scoped to the caller's scans. |
| `POST /api/ai-search` | per-user cooldown. `429` moves into the standard error envelope and gains `details: { yours, queued: false, retryAfterSeconds }`. |
| `GET /api/ai-search/status`, `/stream` | scoped. |
| `GET /api/dashboard/insight` | per user. |
| `GET /api/ai/stats/summary`, `GET /api/ai/stats/feed` | scoped. `?scope=all` for admins returns instance totals plus `byUser[]`. `cacheTiers` admin-only. |
| `GET /api/export/json`, `GET /api/export/csv` | caller's data. Filename includes the username. |
| `GET /api/backups`, `POST /api/backups` | `admin`. |
| `PUT`, `DELETE`, `POST` under `/api/settings/ai` | `admin`. |
| `GET /api/ai/diagnostics`, `GET /api/ai/grounding-capacity` | `admin`. |
| `POST /api/dedupe/backfill-embeddings` | `admin`. |
| `GET /api/dedupe/embedding-status` | caller's counts. |
| MCP routes (`/api/query/contacts`, `/api/contacts/action-items`, `/api/tags`, `/api/industries`, `/api/interactions/search`, `/api/timeline`) | scoped to the token's user. `GET /api/contacts/action-items` becomes reachable (it was shadowed by `GET /api/contacts/:id` in 1.5.5). `GET /api/query/contacts` excludes trashed and ghost contacts. |
| `GET /healthz` | unchanged in the plan; optionally gains `schema` and `vec` versions (features document F4). |
| Every `429` | carries a `Retry-After` header. |
| `/uploads/u/<ownerId>/...` | new URL shape. Served only to that owner. `/uploads/logos/*` unchanged. Old flat URLs `404`. |
| `Authorization: Bearer <API_TOKEN>` | acts as the primary admin. Deprecated. |

---

## 3. New endpoints: authentication

| Method | Path | Class | Body | Response |
| ------ | ---- | ----- | ---- | -------- |
| POST | `/api/auth/register` | public, `credentialLimiter` | `{ email, username, password, displayName? }` | `201 { user }` and session cookie. `403 REGISTRATION_CLOSED`. |
| POST | `/api/auth/accept-invitation` | public, `credentialLimiter` | `{ token, email, username, password, displayName? }` | `201 { user }` and session cookie. `404` unknown token. `410` used, expired, revoked. |
| GET | `/api/auth/tokens` | session-self | | `{ tokens: [{ id, name, tokenPrefix, createdAt, lastUsedAt, expiresAt, revokedAt }] }` |
| POST | `/api/auth/tokens` | session-self, 10 per hour | `{ name, expiresInDays? }` | `201 { id, token, tokenPrefix, expiresAt }`. `token` appears only here. |
| DELETE | `/api/auth/tokens/:id` | session-self | | `{ revoked: true }`. `404` if not the caller's. |

---

## 4. New endpoints: administration

All under `/api/admin`, class `admin`.

| Method | Path | Body | Response |
| ------ | ---- | ---- | -------- |
| GET | `/users` | | `{ users: AdminUserSummary[] }` |
| POST | `/users` | `{ email, username, displayName?, role, temporaryPassword? }` (server generates when omitted) | `201 { user, temporaryPassword }` |
| GET | `/users/:id` | | `{ user: AdminUserSummary, counts: { contacts, interactions, lists, files } }` |
| PATCH | `/users/:id` | `{ role?, displayName? }` | `{ user }`. `409 LAST_ADMIN`. |
| POST | `/users/:id/reset-password` | | `{ temporaryPassword }`. Revokes sessions and tokens. |
| POST | `/users/:id/disable` | | `{ user }`. `409 LAST_ADMIN`. `400 CANNOT_TARGET_SELF`. |
| POST | `/users/:id/enable` | | `{ user }` |
| GET | `/users/:id/export` | | JSON export of that user's data as a download. Audit-logged. |
| DELETE | `/users/:id` | `{ decision: "purge" }` | `{ deleted: true, counts }`. Without the decision: `409 USER_HAS_DATA` with `details.counts`. `409 LAST_ADMIN`. `400 CANNOT_TARGET_SELF`. |
| GET | `/invitations` | | `{ invitations: [{ id, email, role, createdAt, expiresAt, acceptedAt, acceptedBy, revokedAt, invitedBy }] }` |
| POST | `/invitations` | `{ email?, role, expiresInDays? }` | `201 { id, link, expiresAt }`. `link` appears only here. |
| DELETE | `/invitations/:id` | | `{ revoked: true }` |
| GET | `/settings` | | `{ registrationOpen, sessionTtlDays, sessionTtlRange: { min, max, default } }` |
| PUT | `/settings` | `{ registrationOpen?, sessionTtlDays? }` | same shape |
| GET | `/audit?limit=&before=` | | `{ entries: [{ id, actor: { id, username } \| null, action, targetType, targetId, details, ip, createdAt }], nextBefore }`. `before` is the opaque cursor a previous page returned as `nextBefore`, which is `<createdAt>\|<id>`: `createdAt` alone has one-second resolution and a bare timestamp cursor would skip every row sharing a second with the last row of the page. |

`AdminUserSummary`:

```json
{
  "id": "…", "email": "…", "username": "…", "displayName": "…",
  "role": "admin", "status": "active", "credentialState": "password",
  "mustChangePassword": false, "createdAt": "…", "lastLoginAt": "…",
  "passwordChangedAt": "…", "contactCount": 431, "sessionCount": 2, "tokenCount": 1,
  "isLocalOwner": false, "isSelf": false
}
```

---

## 5. Removed

Nothing is removed in 2.0. `PUT /api/auth/session-policy` and the environment
`API_TOKEN` are deprecated with a removal note for 3.0. The `AUTH_TOKEN`
alias is removed if feature F5 in
[15-additional-v2-features.md](15-additional-v2-features.md) is accepted.

## 5a. Changed shapes, for script authors

| What | 1.5.5 | 2.0 |
| ---- | ----- | --- |
| Account endpoint called with a token | `403 { error: { code: "USER_REQUIRED" } }` | `403 { error: { code: "SESSION_REQUIRED" } }` |
| `POST /api/dedupe/scan` while busy | `429 { error: "<string>" }` | `429 { error: { message, code: "RATE_LIMITED", details: { yours, queued } } }` plus `Retry-After` |
| `POST /api/ai-search` while busy or cooling down | `429 { error: "<string>" }` | same envelope with `details: { yours, queued, retryAfterSeconds }` |
| Upload URLs | `/uploads/avatars/<file>`, `/uploads/<file>` | `/uploads/u/<ownerId>/avatars/<file>`, `/uploads/u/<ownerId>/files/<file>` |
| `GET /api/export/json` | every row on the instance | the caller's rows |
| `GET /api/query/contacts` | includes trashed and ghost contacts | excludes them |
| `GET` and `POST /api/backups` | `{ filename, sizeBytes, createdAt }` | the same plus `verification`, which is `{ ok, checkedAt, integrity, rows, liveRows, problem? }` or `null` for a snapshot taken before 2.0 |

---

## 6. MCP note

MCP clients configured with the environment `API_TOKEN` keep working and see
the primary admin's contacts. The documented path is a personal token created
in Settings → Account → API tokens, used the same way:
`Authorization: Bearer ctk_...`.
