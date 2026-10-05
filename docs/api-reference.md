# REST API reference

This page lists every HTTP endpoint the Contrack server registers. Use it to
write scripts and tools against your own instance.

The routes with a contract are also in [`openapi.json`](openapi.json), an
OpenAPI 3.1 file with the JSON Schema of each request and answer. They are the
contacts, notes, follow-ups, lists, tags and personal tokens, the read-only
query routes and the background jobs route. `npm run api:openapi` writes the
file from `shared/contracts/`, and a test fails when it is out of date. This
page stays the reference for every route, for signing in and for errors.

## Conventions

### Base URL

A local install listens on `http://localhost:3210`. Every API path starts with
`/api`. Two paths live outside `/api`: the health probe `GET /healthz` and the
uploaded files under `/uploads`.

Requests and responses are JSON unless an endpoint says otherwise. Send
`Content-Type: application/json` with every JSON body.

### Credentials

Sign-in is off by default. Every request then acts as the local owner, and you
need no credential.

Sign-in is on when `AUTH_REQUIRED=true` is set, or when the deprecated
`API_TOKEN` is set. The server also turns it on by itself when an account with
a password exists. Every `/api` and `/uploads` request then needs one of two
credentials:

- **A personal token.** Send `Authorization: Bearer ctk_...`. Create one in
  **Settings → Account**, or with `POST /api/auth/tokens`. A token acts as
  the account that created it. A read-only token may send `GET` and `HEAD`
  requests and call the MCP server, which then lists only its read-only
  tools. Every other request gets `403 TOKEN_READ_ONLY`, and so does the
  Google sign-in at `/api/connectors/google/`, which adds a connector.
- **The session cookie.** The browser gets `contrack_session` when it signs in.
  The cookie is `HttpOnly` and `SameSite=Strict`. It is `Secure` when the
  request arrived over HTTPS.

The environment `API_TOKEN` still works as a bearer token. It belongs to no
account, acts as the first admin, and is removed in 3.0. A request with no
valid credential gets `401 UNAUTHORIZED`.

An account whose password an admin set gets `403 PASSWORD_CHANGE_REQUIRED` on
every route until it sets its own password. Six routes stay open for that
flow: `GET /api/auth/status`, `POST /api/auth/setup`, `POST /api/auth/login`,
`POST /api/auth/logout`, `GET /api/auth/me` and `POST /api/auth/change-password`.

### Access

The **Access** column in each table uses these words. They come from the route
manifest, `server/tenancy/routeManifest.ts`.

| Access               | Who can call it                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| public               | Anyone who can reach the port. No credential.                                                                                                                                                  |
| your session         | You, for your own account. It needs the session cookie: a personal token gets `403 SESSION_REQUIRED`. With sign-in off, the local owner passes. The three preference routes also take a token. |
| your data            | You, for the data your account owns. An id that belongs to another account answers `404` with the same body as an id that does not exist.                                                      |
| admin                | An account with the admin role. Other accounts get `403 ADMIN_REQUIRED`. A personal token of an admin account works.                                                                           |
| any signed-in caller | Any caller with a valid credential. The route reads no owned data.                                                                                                                             |
| dev only             | Registered only when `NODE_ENV` is not `production`.                                                                                                                                           |

Some "your data" routes also need a session, because they store external
credentials. The tables say so in the description.

### Errors

Every error uses one envelope:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Contact not found",
    "requestId": "321c5292",
    "details": { "entity": "Contact" }
  }
}
```

- `code` is stable. Branch on it, not on `message`.
- `details` is optional. For `VALIDATION_ERROR` it holds the list of Zod issues.
- `stack` is added outside production. The server never sends the cause of an
  unexpected error.
- A `429` that knows when to retry sends a `Retry-After` header in seconds.

| Code                       | Status | Meaning                                                          |
| -------------------------- | ------ | ---------------------------------------------------------------- |
| `VALIDATION_ERROR`         | 400    | The body, query or path failed validation.                       |
| `INVALID_JSON`             | 400    | The body is not valid JSON.                                      |
| `BAD_REQUEST`              | 400    | A rule the route checks itself, such as child arrays on `PATCH`. |
| `DB_CONSTRAINT`            | 400    | A database constraint refused the write.                         |
| `INVALID_UPLOAD`           | 400    | A multipart upload had bad fields.                               |
| `UNSUPPORTED_FILE_TYPE`    | 400    | The attachment type is not allowed.                              |
| `UNAUTHORIZED`             | 401    | No valid credential.                                             |
| `SESSION_REQUIRED`         | 403    | The route needs the session cookie, not a token.                 |
| `ADMIN_REQUIRED`           | 403    | The route needs an admin account.                                |
| `PASSWORD_CHANGE_REQUIRED` | 403    | Set your own password first.                                     |
| `TOKEN_READ_ONLY`          | 403    | A read-only token sent a request that changes data.              |
| `AI_OFF_FOR_ACCOUNT`       | 403    | You turned AI off for your account.                              |
| `AI_OFF_FOR_INSTANCE`      | 403    | An admin turned AI off for the instance.                         |
| `NOT_FOUND`                | 404    | The row does not exist, or it is not yours.                      |
| `ROUTE_NOT_FOUND`          | 404    | No route has this method and path.                               |
| `CONFLICT`                 | 409    | The request conflicts with the current state.                    |
| `PAYLOAD_TOO_LARGE`        | 413    | The body or the file is over its limit.                          |
| `RATE_LIMITED`             | 429    | A rate limit or a run lock refused the request.                  |
| `AI_BUSY`                  | 429    | The AI queue is full. Try again shortly.                         |
| `INTERNAL`                 | 500    | An unexpected error. The server logs it.                         |
| `SERVICE_UNAVAILABLE`      | 503    | A dependency is missing, for example no AI provider.             |
| `DB_BUSY`                  | 503    | The database stayed locked. Retry.                               |
| `DB_READONLY`              | 503    | The database is read-only.                                       |
| `UPSTREAM_TIMEOUT`         | 504    | A call to a provider ran out of time.                            |

Routes add their own codes, such as `NOT_TRACKED` or `USER_HAS_DATA`. The
tables name them. A few answers do not use the envelope:

- `GET /api/mcp` and `DELETE /api/mcp` answer `405` with `{ "error", "message" }`.
- `GET /api/ai/stats/feed` answers a bad query with `400 { "error", "details" }`.
- `POST /api/search/refresh-index` answers `400` with a confirmation request,
  not an error (see [Search](#search)).
- MCP errors are JSON-RPC errors.

### Request IDs

Every response carries `X-Request-Id`, an 8-character id. An error body repeats
it in `error.requestId`. The server log prints the same id on every line for
that request, so quote it when you report a problem.

### Rate limits

Each limit counts requests in a fixed window. An exceeded limit answers
`429 RATE_LIMITED` with `Retry-After`.

| What                                                                                    | Limit           | Counted per                       |
| --------------------------------------------------------------------------------------- | --------------- | --------------------------------- |
| Routes that call an AI provider or fetch a URL (list below)                             | 60 a minute     | client address                    |
| The same routes                                                                         | 30 a minute     | account                           |
| `POST /api/mcp`                                                                         | 120 a minute    | account (address with no account) |
| `GET /api/geo/search`                                                                   | 30 a minute     | account (address with no account) |
| Sign-in routes: login, register, invitation, passkeys, password change, link completion | 10 a minute     | client address                    |
| `POST /api/auth/setup`                                                                  | 5 a minute      | client address                    |
| `POST /api/auth/tokens`                                                                 | 10 an hour      | account                           |
| `POST /api/auth/password-reset/request`, `POST /api/auth/magic-link/request`            | 3 in 15 minutes | client address                    |
| `POST /api/admin/mail/test`                                                             | 5 in 10 minutes | account                           |

The AI and fetch limits cover these paths, in any letter case:
`POST /api/search/semantic`, `POST /api/search/synthesize`,
`POST /api/parse-contact`, `POST /api/contacts/:id/enrich`,
`POST /api/contacts/:id/briefing`, `POST /api/ai-search`,
`POST /api/dedupe/backfill-embeddings`, `POST /api/dedupe/scan`,
`GET /api/dashboard/insight` and `GET /api/link-preview/unfurl`.

Two other answers look like rate limits:

- `429 AI_BUSY`: the AI queue holds 2 running calls and 16 waiting calls, and
  Ask Contrack has 2 slots of its own. A full queue refuses new work.
- `429 RATE_LIMITED` with `details.yours` and `details.queued`: a duplicate scan
  or a research batch of another account holds the run lock.

### Body sizes and uploads

| What                                  | Limit                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| A JSON body                           | 1 MB                                                                                      |
| The body of `POST /api/contacts/bulk` | 50 MB                                                                                     |
| A contact photo, field `avatar`       | 10 MB. JPEG, PNG, GIF, WebP or AVIF.                                                      |
| Your account photo, field `avatar`    | 10 MB. The same types.                                                                    |
| An attachment, field `attachment`     | 50 MB. `.eml`, `.txt`, `.md`, `.csv`, `.pdf`, `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp`. |

A body or file over its limit answers `413 PAYLOAD_TOO_LARGE`. Uploads use
`multipart/form-data`.

### Bulk limits

| What                                                                | Limit                                |
| ------------------------------------------------------------------- | ------------------------------------ |
| Id lists: bulk delete, bulk update, bulk restore, bulk list members | 1 to 5,000 ids. Duplicates collapse. |
| `POST /api/contacts/bulk`                                           | 5,000 contacts                       |
| Child arrays on a contact (emails, phones, tags and the rest)       | 100 items each                       |
| `POST /api/contacts/merge-cluster`                                  | 10 duplicates                        |
| `POST /api/contacts/merge-clusters`                                 | 250 merges in all                    |
| `POST /api/ai-search`                                               | 1 to 100 unique contact ids          |
| `POST /api/search/synthesize`                                       | 1 to 30 contact ids                  |
| Search facets                                                       | 8 per request                        |

A bulk route acts only on ids you own and reports the number of rows it changed.

### Dates and times

- A date field takes a calendar date (`2026-10-06`) or an ISO timestamp.
  A timestamp with an offset is stored in UTC. A timestamp with no offset is
  read in the server's time zone.
- An interaction date cannot be in the future. The server allows five
  minutes of clock drift, and one day for a date with no time.
- The server writes timestamps in two forms: `2026-09-30 04:59:17` (UTC, from
  SQLite) and `2026-09-30T04:59:17.114Z`. Parse both.

### Paging

Most list routes return the whole list. These routes page:

| Route                          | Parameters                                                    |
| ------------------------------ | ------------------------------------------------------------- |
| `GET /api/search/history`      | `limit` (1 to 200, default 50) and `cursor` from `nextCursor` |
| `GET /api/admin/audit`         | `limit` (1 to 200, default 50) and `before` from `nextBefore` |
| `GET /api/ai/stats/feed`       | `offset` and `limit` (1 to 200, default 50)                   |
| `GET /api/search/interactions` | `offset` (0 to 5,000) and `limit` (1 to 50, default 20)       |
| `GET /api/query/contacts`      | `offset` and `limit` (1 to 200, default 50)                   |

### Streaming

Two routes stream NDJSON, one JSON object per line:

- `POST /api/search/semantic` when you send `Accept: application/x-ndjson`.
  Without that header it answers with one JSON object.
- `POST /api/search/synthesize`, always.

Three routes stream Server-Sent Events. Each event is one `data: <json>` line
and a blank line:

- `POST /api/contacts/bulk` when you send `Accept: text/event-stream`.
- `GET /api/ai-search/stream?batchId=`. It also sends a `: heartbeat` comment
  every 15 seconds.
- `GET /api/dedupe/stream?scanId=`.

A stream that fails after its first byte ends without an error body. For
the search stream, the server writes a final `error` line when it can.

### Caching

Responses under `/api/auth`, `/api/admin`, `/api/ai/stats` and `/api/export`
send `Cache-Control: no-store`. Uploaded files send
`Cache-Control: private, max-age=0, must-revalidate`.

## Health

| Endpoint       | What it does                                                                                                                                                                                                                                                                                                                                                                                                                   | Access |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `GET /healthz` | Liveness probe. Runs one query and answers `{ "status": "ok", "schema": { "migration", "expects" }, "vec" }`. `schema.migration` is the last migration the database applied, such as `0002_events_and_jobs`, and `schema.expects` is the last one this build holds. They are equal when an upgrade is complete. `vec` is the sqlite-vec version. Answers `503 { "status": "unavailable" }` when the database does not respond. | public |

For sizes, queues, backups and the version of each search index, use
`GET /api/admin/health`.

## Authentication

Every route under `/api/auth` stays reachable with no credential, so sign-in
works. Each route then checks what it needs.

### Sign in and sign up

| Endpoint                                 | What it does                                                                                                                                                                                                                                                                                                                                         | Access |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `GET /api/auth/status`                   | Everything the sign-in screen needs: `authRequired`, `authenticated`, `setupRequired`, `hasAccounts`, `user`, `registrationOpen`, `mailConfigured`, `magicLinkSignIn`, `localOwnerPresent`, `legacyTokenConfigured`, `publicUrl`, `instanceName`, `deviceContacts`, and the basemap style URLs in `map`.                                             | public |
| `POST /api/auth/setup`                   | Create the first account: `email`, `username`, `password`, `displayName`. The account is an admin and is signed in (`201 { user }`). On a used instance it takes over the local owner and keeps its data. `409 SETUP_COMPLETE` once an account with a password exists.                                                                               | public |
| `POST /api/auth/login`                   | Sign in with `identifier` (username or email) and `password`. `remember: false` sets a cookie that ends with the browser. Answers `{ user }`. `401 INVALID_CREDENTIALS` for a wrong password and for an unknown account alike. `403 ACCOUNT_DISABLED` for a disabled account. With sign-in off it answers `{ "authRequired": false, "user": null }`. | public |
| `POST /api/auth/logout`                  | End this session and clear the cookie.                                                                                                                                                                                                                                                                                                               | public |
| `POST /api/auth/register`                | Create a member account without an invitation. `403 REGISTRATION_CLOSED` unless an admin opened registration.                                                                                                                                                                                                                                        | public |
| `POST /api/auth/accept-invitation`       | Turn an invitation into an account: `token`, `email`, `username`, `password`, `displayName`. The account takes the invitation's role and is signed in. `404 INVITATION_NOT_FOUND`, or `410 INVITATION_USED`, `INVITATION_REVOKED` or `INVITATION_EXPIRED`.                                                                                           | public |
| `POST /api/auth/password-reset/request`  | Send a reset link to `email`. Always answers `202 {}`. It sends mail only when outgoing mail and `PUBLIC_URL` are set. The link lasts 1 hour, and an account gets at most 3 links an hour.                                                                                                                                                           | public |
| `POST /api/auth/password-reset/complete` | Set a new `password` with the link's `token`. Ends your other sessions and signs you in. `404 LINK_INVALID`, `410 LINK_EXPIRED` or `410 LINK_USED`.                                                                                                                                                                                                  | public |
| `POST /api/auth/magic-link/request`      | Send a sign-in link to `email`. Answers `202 {}`. `404 MAGIC_LINK_OFF` when the instance has emailed sign-in links off, or cannot send them. The link lasts 15 minutes.                                                                                                                                                                              | public |
| `POST /api/auth/magic-link/complete`     | Sign in with the link's `token`. Same errors as the reset link.                                                                                                                                                                                                                                                                                      | public |
| `POST /api/auth/passkeys/login/options`  | Start a passkey sign-in. Answers `{ ceremonyId, options }`.                                                                                                                                                                                                                                                                                          | public |
| `POST /api/auth/passkeys/login/verify`   | Finish a passkey sign-in with `{ ceremonyId, response, remember }`. Sets the session cookie.                                                                                                                                                                                                                                                         | public |

### Your account

| Endpoint                                   | What it does                                                                                                                                                                     | Access       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `GET /api/auth/me`                         | Your account as `{ user, via }`.                                                                                                                                                 | your session |
| `PATCH /api/auth/me`                       | Change `displayName`, `username` or `email`. Fields you leave out stay.                                                                                                          | your session |
| `POST /api/auth/me/avatar`                 | Upload your account photo. The server stores a 512 px JPEG.                                                                                                                      | your session |
| `DELETE /api/auth/me/avatar`               | Remove your account photo.                                                                                                                                                       | your session |
| `POST /api/auth/change-password`           | Change your password with `currentPassword` and `newPassword`. Ends every other session.                                                                                         | your session |
| `GET /api/auth/sessions`                   | Your live sessions, with `current: true` on this one.                                                                                                                            | your session |
| `DELETE /api/auth/sessions`                | Sign out everywhere else. Answers `{ "revoked": n }`.                                                                                                                            | your session |
| `GET /api/auth/preferences`                | Every preference with its default, as `{ preferences, stored }`. `stored` names the keys you chose. A token may call it.                                                         | your session |
| `PATCH /api/auth/preferences`              | Change one or more preferences. An unknown key refuses the request with `400`. A token may call it.                                                                              | your session |
| `DELETE /api/auth/preferences/:key`        | Reset one preference to its default. `404` for an unknown key. A token may call it.                                                                                              | your session |
| `GET /api/auth/tokens`                     | Your personal tokens, newest first. Never shows a token again.                                                                                                                   | your session |
| `POST /api/auth/tokens`                    | Create a personal token: `name` (1 to 60 characters), `expiresInDays` (1 to 3,650, optional) and `readOnly` (optional, default `false`). The answer holds the token once. `201`. | your session |
| `DELETE /api/auth/tokens/:id`              | Revoke one of your tokens. Answers `{ "revoked": true }`. The row stays with `revokedAt` set.                                                                                    | your session |
| `POST /api/auth/passkeys/register/options` | Start adding a passkey. Answers `{ ceremonyId, options }`.                                                                                                                       | your session |
| `POST /api/auth/passkeys/register/verify`  | Finish adding a passkey with `{ ceremonyId, response, name }`. `201 { passkey }`.                                                                                                | your session |
| `GET /api/auth/passkeys`                   | Your passkeys, and whether you dismissed the passkey prompt.                                                                                                                     | your session |
| `PATCH /api/auth/passkeys/:id`             | Rename a passkey with `{ name }`.                                                                                                                                                | your session |
| `DELETE /api/auth/passkeys/:id`            | Remove a passkey.                                                                                                                                                                | your session |
| `POST /api/auth/passkey-nudge/dismiss`     | Stop the prompt that suggests a passkey.                                                                                                                                         | your session |

### Personal tokens

A token is the credential for a script. It needs a session to create it, so a
token cannot create another token or revoke itself. For the steps in the app,
see [Create a token](mcp.md#create-a-token).

```bash
curl -X POST http://localhost:3210/api/auth/tokens \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"name":"Nightly export","expiresInDays":365,"readOnly":true}'
```

```json
{
  "id": "2b40fbbe-dee6-4c42-ac5a-beefe9944289",
  "name": "Nightly export",
  "token": "ctk_...",
  "tokenPrefix": "ctk_AbCdEfGh",
  "expiresAt": "2027-09-30T04:59:17.151Z",
  "readOnly": true
}
```

Keep `token` somewhere safe. The server stores only its SHA-256 hash, and it
never shows the token again. `GET /api/auth/tokens` answers `{ tokens }`. Each
row has `id`, `name`, `tokenPrefix`, `createdAt`, `lastUsedAt`, `expiresAt`,
`revokedAt`, `readOnly` and `kind`. `kind` is `personal` for a token you made
and `oauth` for an app you approved, whose `tokenPrefix` is the host it signs
in from. `DELETE /api/auth/tokens/:id` disconnects such an app.

### Apps that sign in with OAuth

An MCP client such as Claude or ChatGPT can sign in with OAuth 2.1 instead of
a token. OAuth is on when sign-in is on and `PUBLIC_URL` is an `https`
address, or an `http` address on `localhost` for a local client. While it is
off, every route below answers `404`. Each answer to a client uses OAuth's
own field names and errors, such as `{"error":"invalid_grant"}`.

| Route                                               | What it does                                                                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /.well-known/oauth-protected-resource/api/mcp` | The MCP endpoint's metadata (RFC 9728): its resource, its authorization server and its scopes. A `401` from `/api/mcp` names this URL    |
| `GET /.well-known/oauth-protected-resource`         | The same metadata at the root                                                                                                            |
| `GET /.well-known/oauth-authorization-server`       | The authorization server's metadata (RFC 8414)                                                                                           |
| `GET /oauth/authorize`                              | Starts a sign-in with PKCE (S256). It sends the browser to the consent page, or back to the client with an error                         |
| `POST /oauth/token`                                 | A form body. Trades a code for an access token and a refresh token, or rotates a refresh token                                           |
| `POST /oauth/register`                              | Registers a public client (RFC 7591). A client may instead use the https URL of its metadata document as its `client_id`                 |
| `POST /oauth/revoke`                                | Gives a token back (RFC 7009). The whole grant ends                                                                                      |
| `GET /api/auth/oauth/requests/:id`                  | For the consent page: the app, where it sends you back, and whether it asked to write                                                    |
| `POST /api/auth/oauth/requests/:id`                 | For the consent page: `{"decision":"allow","access":"read"}` or `"deny"`. Answers `{ redirectTo }`, the address the browser goes to next |

The scopes are `contrack:read` and `contrack:write`. An access token lasts an
hour and works on `/api/mcp` only. A refresh token lasts 30 days from its last
use and works once: the next one replaces it. A refresh token that comes back
after its replacement was used ends the grant.

The examples below use a token in the `CONTRACK_TOKEN` variable. With sign-in
off, leave out the `Authorization` header.

## Contacts

A contact carries its child records: `emails`, `phones`, `addresses`,
`socialLinks`, `education`, `experience`, `sources`, `tags`, `interests` and
`attributes`. It also carries `lists` and `interactionCount`.

| Endpoint                              | What it does                                                                                                                                                              | Access               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `GET /api/contacts`                   | Every contact that is not archived, trashed or merged, ghosts included, newest first. `?view=slim` returns lighter rows for caches and pickers.                           | your data            |
| `POST /api/contacts`                  | Create a contact. `201` with the contact.                                                                                                                                 | your data            |
| `GET /api/contacts/:id`               | One contact with all its child records. Archived contacts are included. A trashed contact answers `404`.                                                                  | your data            |
| `PATCH /api/contacts/:id`             | Change scalar fields, such as `company`, `role` or `isTracked`. Child arrays answer `400`: use `PUT`.                                                                     | your data            |
| `PUT /api/contacts/:id`               | Change fields and child arrays. Each child array you send replaces the old one. Fields you leave out stay.                                                                | your data            |
| `DELETE /api/contacts/:id`            | Move a contact to the trash. Answers `{ success, retentionDays }`. Restore it with `POST /api/trash/:id/restore`.                                                         | your data            |
| `GET /api/contacts/archived`          | Archived contacts, most recently changed first.                                                                                                                           | your data            |
| `GET /api/contacts/map`               | Your placed contacts, for API clients: `id`, `name`, `company`, `avatarUrl`, `location`, `lat`, `lng` and `geoSource`. Archived, trashed, merged and ghosts are left out. | your data            |
| `PATCH /api/contacts/:id/location`    | Place the pin by hand with `{ lat, lng }`, or give it back to the geocoder with `{ "regeocode": true }`. Nothing else may be in the body. Answers the contact.            | your data            |
| `POST /api/contacts/:id/avatar`       | Upload a contact photo in the field `avatar`. Answers the contact.                                                                                                        | your data            |
| `GET /api/contacts/:id/score`         | The score breakdown: `{ score, components }`, one entry for each of the five signals. `404 NOT_TRACKED` for a contact you do not track.                                   | your data            |
| `GET /api/contacts/:id/relationships` | Contacts linked to this one by @mentions. `limit` 1 to 200, default 50.                                                                                                   | your data            |
| `POST /api/contacts/:id/promote`      | Turn a ghost into a full contact. Answers the contact.                                                                                                                    | your data            |
| `POST /api/contacts/:id/briefing`     | Write an AI briefing from the timeline. Answers `{ points }`, a list of strings. `409` when the contact changes during the run. `503` with no AI provider.                | your data            |
| `POST /api/contacts/:id/enrich`       | Research one contact on the web. Body `{ "depth": "standard" }` or `"deep"`, or no body. See [Contact enrichment](#contact-enrichment).                                   | your data            |
| `POST /api/contacts/bulk`             | Import many contacts. See [Imports](#imports).                                                                                                                            | your data            |
| `POST /api/contacts/bulk-delete`      | Move many contacts to the trash: `{ ids }`. Answers `{ success, count, retentionDays }`.                                                                                  | your data            |
| `PUT /api/contacts/bulk-update`       | Set the same scalar fields on many contacts: `{ ids, data }`. Child arrays are refused. Answers `{ success, count }`.                                                     | your data            |
| `POST /api/contacts/merge`            | Merge two contacts: `{ primaryId, duplicateId }`. Answers `{ success, contact }`.                                                                                         | your data            |
| `POST /api/contacts/merge-cluster`    | Merge up to 10 contacts into one: `{ primaryId, duplicateIds }`. Answers `{ success, merged, failed, contact }`.                                                          | your data            |
| `POST /api/contacts/merge-clusters`   | Merge many clusters: `{ clusters: [{ primaryId, duplicateIds }] }`, 250 merges at most.                                                                                   | your data            |
| `POST /api/parse-contact`             | Read a contact out of free text with AI: `{ text }`. Answers the parsed fields and saves nothing.                                                                         | any signed-in caller |

The timeline, follow-up and attachment routes under `/api/contacts/:id/` are in
[Timeline and notes](#timeline-and-notes) and [Follow-ups](#follow-ups).

### Tracking

Only a tracked contact has a score, a place in Pulse and a ring. A contact you
create starts untracked, unless your **Track new contacts** preference is on.
An imported contact starts untracked unless its row sets `isTracked`.

- `PATCH` with `{ "isTracked": true }` starts tracking. `cadenceDays` comes
  from the body, or from your default cadence. The server stamps `trackedAt`
  and scores the contact before it answers.
- `{ "isTracked": false }` stops tracking and clears `trackedAt`.
- `PUT /api/contacts/bulk-update` with `{ "data": { "isTracked": true } }`
  tracks many contacts and scores them before it answers.

### List contacts

```bash
curl "http://localhost:3210/api/contacts?view=slim" \
  -H "Authorization: Bearer $CONTRACK_TOKEN"
```

```json
[
  {
    "id": "f60e8536-37f4-41d7-ac09-ac16f7018c2f",
    "name": "Jane Smith",
    "company": "Acme Corp",
    "role": "VP Engineering",
    "location": "Berlin, Germany",
    "avatarUrl": "/api/avatar/avataaars?seed=Jane+Smith",
    "isTracked": false,
    "relationshipScore": 50,
    "tags": [{ "id": "investor", "tag": "investor" }],
    "emails": [{ "email": "jane@acme.example" }],
    "phones": [{ "phone": "+49 30 1234567" }],
    "interactionCount": 0
  }
]
```

A slim row has fewer fields than a full contact. Its child arrays hold only the
values that search and pickers read.

### Get a contact

```bash
curl http://localhost:3210/api/contacts/f60e8536-37f4-41d7-ac09-ac16f7018c2f \
  -H "Authorization: Bearer $CONTRACK_TOKEN"
```

```json
{
  "id": "f60e8536-37f4-41d7-ac09-ac16f7018c2f",
  "name": "Jane Smith",
  "role": "VP Engineering",
  "company": "Acme Corp",
  "location": "Berlin, Germany",
  "cadenceDays": 90,
  "isTracked": false,
  "trackedAt": null,
  "relationshipScore": 50,
  "addedAt": "2026-09-30 04:59:17",
  "emails": [
    { "id": "3e5f...", "email": "jane@acme.example", "label": "work" }
  ],
  "phones": [{ "id": "d8a0...", "phone": "+49 30 1234567", "label": "mobile" }],
  "tags": [{ "id": "17c3...", "tag": "investor" }],
  "lists": [],
  "interactionCount": 0
}
```

The real answer has more fields. Each email and phone also has `isPrimary`,
`sortOrder` and `source`. `relationshipScore` means nothing while `isTracked`
is false.

### Create a contact

`name` is required, up to 300 characters. Every other field is optional. A
child item is a plain string or an object:

| Array         | Object form                                                                             |
| ------------- | --------------------------------------------------------------------------------------- |
| `emails`      | `{ "email", "label", "isPrimary" }`                                                     |
| `phones`      | `{ "phone", "label", "isPrimary" }`                                                     |
| `addresses`   | `{ "address", "label", "isPrimary" }`                                                   |
| `socialLinks` | `{ "url", "platform", "handle" }`                                                       |
| `tags`        | `{ "tag" }` (1 to 100 characters)                                                       |
| `interests`   | `{ "interest", "isAiGenerated" }`                                                       |
| `education`   | `{ "school", "degree", "fieldOfStudy", "startDate", "endDate", "description" }`         |
| `experience`  | `{ "company", "role", "startDate", "endDate", "isCurrent", "description", "location" }` |
| `attributes`  | `{ "name", "value" }`                                                                   |
| `sources`     | `{ "platform", "externalId", "connectedOn", "rawData" }`                                |

```bash
curl -X POST http://localhost:3210/api/contacts \
  -H "Authorization: Bearer $CONTRACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Smith",
    "company": "Acme Corp",
    "role": "VP Engineering",
    "location": "Berlin, Germany",
    "emails": [{ "email": "jane@acme.example", "label": "work" }],
    "phones": ["+49 30 1234567"],
    "tags": ["investor"]
  }'
```

The answer is `201` with the new contact, in the shape above. An object such
as `{ "value": "jane@acme.example" }` is not a valid email item and answers
`400 VALIDATION_ERROR`.

### Update a contact

Change scalar fields with `PATCH`:

```bash
curl -X PATCH http://localhost:3210/api/contacts/f60e8536-37f4-41d7-ac09-ac16f7018c2f \
  -H "Authorization: Bearer $CONTRACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"company":"NewCo","role":"CTO","isTracked":true,"cadenceDays":30}'
```

Replace a child array with `PUT`. This call replaces the emails and keeps the
phones and tags:

```bash
curl -X PUT http://localhost:3210/api/contacts/f60e8536-37f4-41d7-ac09-ac16f7018c2f \
  -H "Authorization: Bearer $CONTRACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"emails":[{"email":"jane@newco.example","label":"work","isPrimary":true}]}'
```

Both answer the whole contact. An empty body answers `400`.

## Imports

`POST /api/contacts/bulk` takes a JSON array of contacts in the create shape.
Every import has an id and a record.

| Endpoint                      | What it does                                                                                                                                                                | Access    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `POST /api/contacts/bulk`     | Import up to 5,000 contacts. Send `X-Import-Id: <uuid>` to make a retry safe. JSON mode answers `201 { success, count, failed, importId }`. Stream mode sends SSE progress. | your data |
| `GET /api/imports`            | Your newest 50 imports: `{ imports }`.                                                                                                                                      | your data |
| `GET /api/imports/:id`        | One import record: `status`, `phase`, counts, `summary` and `error`.                                                                                                        | your data |
| `GET /api/imports/:id/rows`   | Rows in one `status`: `failed` (default) or `done`. `limit` 1 to 500, default 200.                                                                                          | your data |
| `POST /api/imports/:id/retry` | Run the failed rows again from the payload the server kept. `400 NOTHING_TO_RETRY` when no row can run again.                                                               | your data |

How an import behaves:

- **Same id twice.** A known id writes nothing and answers from the record,
  with `"repeated": true`. `409 IMPORT_IN_PROGRESS` while that import runs.
  `409 IMPORT_ID_IN_USE` when another account used the id.
- **A failed row.** The other rows save. The row keeps its error, and
  `POST /api/imports/:id/retry` runs it again.
- **A stop part way.** Rows save in batches of 250. An import that stops
  after a batch keeps what it saved. Its other rows become failed rows that a
  retry runs, and its status is `imported`.
- **Duplicates.** When your `dedupeOnImport` preference is on (the default), a
  check compares the new contacts with your contacts and with the rest of the
  file. Pairs at or above your sensitivity preset merge at once. The rest
  become suggestions. In JSON mode the check starts a few seconds after the
  answer.
- **Stream mode.** Send `Accept: text/event-stream`. The stream sends
  `{"phase":"accepted","importId":"..."}`, then `importing`, `embedding` and
  `scanning` events, then a last event with `"done": true`, `status`, `count`,
  `failed` and `summary`. A stream with no `done` event lost its connection.
  Read `GET /api/imports/:id` to see what happened.

| `status`   | Meaning                                                          |
| ---------- | ---------------------------------------------------------------- |
| `running`  | The contacts are being written.                                  |
| `imported` | The contacts are saved, and the duplicate check runs.            |
| `complete` | Everything finished.                                             |
| `failed`   | Nothing was saved. Send the same request again with the same id. |

## Timeline and notes

An interaction is one timeline entry: a note, a call, a meeting or an email.
The app logs `note`, `call`, `meeting` and `email`. Connectors write `meeting`
and `email`. The server accepts any non-empty `type`.

| Endpoint                              | What it does                                                                                                                                                       | Access    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `GET /api/contacts/:id/timeline`      | The contact's interactions. Each entry carries its linked `actionItems`.                                                                                           | your data |
| `POST /api/contacts/:id/interactions` | Log an interaction. `actionItem: { title, dueAt }` also creates a linked follow-up. `201` with the interaction.                                                    | your data |
| `POST /api/contacts/:id/attachments`  | Attach a file in the field `attachment`. An `.eml` file becomes an `email` entry, with an AI summary while AI is on for you. Any other file becomes a note. `201`. | your data |
| `PATCH /api/interactions/:id`         | Change `title` or `content`. Nothing else can change.                                                                                                              | your data |
| `DELETE /api/interactions/:id`        | Delete an interaction.                                                                                                                                             | your data |
| `GET /api/timeline`                   | Your whole timeline, newest first, with `contactName`. `limit` 1 to 200 (default 50), `since` (a date) and `type`.                                                 | your data |

### Log an interaction

The body takes `type` and `title` (both required), `content` (HTML is allowed),
`date`, `duration` in minutes, and `actionItem`.

```bash
curl -X POST http://localhost:3210/api/contacts/f60e8536-37f4-41d7-ac09-ac16f7018c2f/interactions \
  -H "Authorization: Bearer $CONTRACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "call",
    "title": "Quarterly check-in",
    "content": "<p>Talked about the proposal.</p>",
    "date": "2026-09-20T10:00:00Z",
    "actionItem": { "title": "Send proposal draft", "dueAt": "2026-10-06" }
  }'
```

```json
{
  "id": "fda18b7f-fa96-4043-905c-401177e9717d",
  "contactId": "f60e8536-37f4-41d7-ac09-ac16f7018c2f",
  "type": "call",
  "title": "Quarterly check-in",
  "content": "<p>Talked about the proposal.</p>",
  "date": "2026-09-20T10:00:00.000Z",
  "duration": null,
  "fileUrl": null,
  "mentions": null,
  "updatedAt": "2026-09-30 04:59:17"
}
```

A `date` in the future answers `400` with "Date cannot be in the future".

### Read the timeline

```bash
curl http://localhost:3210/api/contacts/f60e8536-37f4-41d7-ac09-ac16f7018c2f/timeline \
  -H "Authorization: Bearer $CONTRACK_TOKEN"
```

```json
[
  {
    "id": "fda18b7f-fa96-4043-905c-401177e9717d",
    "type": "call",
    "title": "Quarterly check-in",
    "content": "<p>Talked about the proposal.</p>",
    "date": "2026-09-20T10:00:00.000Z",
    "actionItems": [
      {
        "id": "233a868b-1f7c-48c6-b6b3-9b51af32ab9d",
        "title": "Send proposal draft",
        "dueAt": "2026-10-06",
        "completedAt": null
      }
    ]
  }
]
```

## Follow-ups

A follow-up (an action item) is a task with a due date on one contact.

| Endpoint                               | What it does                                                                                                                                                                                        | Access    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `GET /api/action-items`                | Your open follow-ups, soonest due first, with `contactName`, `contactCompany`, `contactAvatarUrl` and `contactThemeColor`. Follow-ups on archived, trashed, merged and ghost contacts are left out. | your data |
| `GET /api/action-items/completed`      | Your 50 most recently completed follow-ups.                                                                                                                                                         | your data |
| `GET /api/action-items/count`          | The number of open follow-ups due today or earlier: `{ count }`.                                                                                                                                    | your data |
| `GET /api/contacts/:id/action-items`   | One contact's follow-ups.                                                                                                                                                                           | your data |
| `POST /api/contacts/:id/action-items`  | Create a follow-up: `{ title, dueAt }`. `201`.                                                                                                                                                      | your data |
| `POST /api/action-items/bulk`          | The same follow-up for many contacts: `{ contactIds, title, dueAt }`, up to 500 ids. `201 { count }`. An id you cannot use refuses the whole call, and nothing is written.                          | your data |
| `PATCH /api/action-items/:id`          | Change `title` or `dueAt`. A later `dueAt` snoozes it.                                                                                                                                              | your data |
| `PATCH /api/action-items/:id/complete` | Mark a follow-up done.                                                                                                                                                                              | your data |
| `DELETE /api/action-items/:id`         | Delete a follow-up.                                                                                                                                                                                 | your data |

```bash
curl -X POST http://localhost:3210/api/contacts/f60e8536-37f4-41d7-ac09-ac16f7018c2f/action-items \
  -H "Authorization: Bearer $CONTRACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Book dinner","dueAt":"2026-10-02T18:00:00Z"}'
```

```json
{
  "id": "52b907e9-6f64-478a-8ec0-d160e19f29d0",
  "contactId": "f60e8536-37f4-41d7-ac09-ac16f7018c2f",
  "interactionId": null,
  "title": "Book dinner",
  "dueAt": "2026-10-02T18:00:00.000Z",
  "completedAt": null,
  "createdAt": "2026-09-30 04:59:17",
  "updatedAt": "2026-09-30 04:59:17"
}
```

Complete it:

```bash
curl -X PATCH http://localhost:3210/api/action-items/52b907e9-6f64-478a-8ec0-d160e19f29d0/complete \
  -H "Authorization: Bearer $CONTRACK_TOKEN"
```

The answer is the follow-up with `completedAt` set. A contact's
`nextFollowUpAt` always holds the earliest due date of its open follow-ups.
A contact write (`POST`, `PUT`, `PATCH` or a bulk update) that sends
`nextFollowUpAt` changes the follow-ups, and the field follows them. A date
moves the earliest open follow-up to that date, or adds a "Follow up" when
there is none. `null` completes the open follow-ups.

## Lists

| Endpoint                                   | What it does                                                                      | Access    |
| ------------------------------------------ | --------------------------------------------------------------------------------- | --------- |
| `GET /api/lists`                           | Your lists in order, each with `memberCount`.                                     | your data |
| `POST /api/lists`                          | Create a list: `name` (1 to 60 characters) and `icon`. `201`.                     | your data |
| `PATCH /api/lists/:id`                     | Change `name` or `icon`.                                                          | your data |
| `DELETE /api/lists/:id`                    | Delete a list. Its contacts stay. A list that is already gone also answers `200`. | your data |
| `PUT /api/lists/reorder`                   | Set the order: `{ orderedIds }`.                                                  | your data |
| `GET /api/lists/:id/contacts`              | The list's contacts, without archived, trashed, merged or ghost contacts.         | your data |
| `POST /api/lists/:id/members`              | Add one contact: `{ contactId }`.                                                 | your data |
| `DELETE /api/lists/:id/members/:contactId` | Remove one contact from the list.                                                 | your data |
| `POST /api/lists/:id/members/bulk`         | Add many contacts: `{ contactIds }`. Answers `{ success, count }`.                | your data |

## Tags

| Endpoint                | What it does                                                                                                                              | Access    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `GET /api/tags`         | Every tag you use, as a plain array of strings.                                                                                           | your data |
| `GET /api/tags/summary` | Each tag with the number of contacts that carry it, by name: `{ tags: [{ tag, count }] }`. Archived and trashed contacts do not count.    | your data |
| `PATCH /api/tags/:tag`  | Rename a tag on all your contacts: `{ "to": "new-name" }`. A contact that already has the new tag keeps one copy. Answers `{ affected }`. | your data |
| `DELETE /api/tags/:tag` | Remove a tag from all your contacts. Answers `{ affected }`.                                                                              | your data |
| `GET /api/industries`   | Every industry your contacts name, as a plain array of strings.                                                                           | your data |

## Search

Three kinds of search: the quick keyword search, Ask Contrack, and the note
search. All of them hide archived, trashed, merged and ghost contacts. For how
the pipeline works, see [Search](architecture.md#search) in the architecture
page.

| Endpoint                         | What it does                                                                                                                         | Access    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `GET /api/search`                | Keyword search over your contacts: `q` (up to 500 characters) and `filters`. At most 20 results. An empty `q` answers `[]`.          | your data |
| `POST /api/search/semantic`      | Ask Contrack: `{ query, filters }`. Answers JSON, or NDJSON with `Accept: application/x-ndjson`. Works with AI off.                  | your data |
| `POST /api/search/synthesize`    | Stream a short brief about 1 to 30 contacts: `{ query, contactIds }`. `409` when a contact is gone.                                  | your data |
| `GET /api/search/interactions`   | Search your notes. No model runs.                                                                                                    | your data |
| `GET /api/search/starters`       | Your pool of starter questions for **Try asking**. See [Starter questions](#starter-questions).                                      | your data |
| `GET /api/search/coverage`       | How much of your data the local search index covers.                                                                                 | your data |
| `POST /api/search/refresh-index` | Queue your contacts for indexing: `{ allowProvider, forceAll }`.                                                                     | your data |
| `GET /api/search/history`        | Your past questions, newest first. `mode` (`people`, `notes` or `palette`), `q`, `pinned`, `cursor` and `limit`.                     | your data |
| `POST /api/search/history`       | Record a question: `query`, `mode`, `resultCount`, `resultIds` and `fallback`. The same question in the same mode updates its entry. | your data |
| `PATCH /api/search/history/:id`  | Pin or unpin an entry: `{ pinned }`.                                                                                                 | your data |
| `DELETE /api/search/history/:id` | Delete one entry.                                                                                                                    | your data |
| `DELETE /api/search/history`     | Clear your history, or one `mode`. Answers `{ deleted }`.                                                                            | your data |

### Facets

`GET /api/search` and `POST /api/search/semantic` take up to 8 facets. Each
facet is `{ field, value, operator, km, point }`:

- `field` is one of `role`, `company`, `location`, `industry`, `tag`, `score`,
  `updated`, `contacted`, `missing`, `list`, `near` and `tracked`.
- `value` holds 1 to 100 characters.
- `operator` is `>` or `<`, for `score`, `updated` and `contacted`.
- A `near` facet carries its resolved `point`, `{ lat, lng, km }`. Without a
  point, `near` keeps everyone.

Every facet must hold. The server applies the facets in SQL before its result
limit. `GET /api/search` takes the facets as a JSON string of at most 4,000
characters. A bad facet list answers `400` "Invalid search filters". For what
each facet means, see [Facets](search.md#facets).

```bash
curl -G http://localhost:3210/api/search \
  -H "Authorization: Bearer $CONTRACK_TOKEN" \
  --data-urlencode "q=engineer" \
  --data-urlencode 'filters=[{"field":"contacted","value":"90d","operator":">"}]'
```

The answer is an array of full contacts. Each one adds `approximate` and
`matchType` (`exact` or `approximate`, for a close name).

### Ask Contrack

`query` holds up to 500 characters. It can hold typed facets, such as
`tag:investor contacted:>90d`. A facet in `query` and the same facet in
`filters` count once.

```bash
curl -X POST http://localhost:3210/api/search/semantic \
  -H "Authorization: Bearer $CONTRACK_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/x-ndjson" \
  -d '{"query":"founders I have not talked to in three months"}'
```

The stream sends one JSON object per line:

```json
{"phase":"instant","matches":[{"id":"2200196c-84e8-4ada-9819-086984e41b6f","name":"Sam Rivera","verified":false}],"fallback":true,"latencyMs":14}
{"phase":"complete","matches":[{"id":"2200196c-84e8-4ada-9819-086984e41b6f","name":"Sam Rivera","verified":true,"aiReason":"Tagged founder."}],"fallback":false}
```

- `instant` is the local list: keyword and vector search, fused, at most 30.
  Nothing verified it.
- `complete` is the final answer, and the last line. It replaces `instant`.
  For a question made only of facets it also holds `total`, how many
  contacts the facets find. The list stops at 30. `facets` holds the same
  question as a Network query, for example `tracked:yes`, when the Network
  list can read it. When the list stops short of `total`, `refine` holds at
  most six facets that split it, each as `{ facet, label, count }`. `count`
  is how many contacts the question finds with `facet` added.
- `error` takes the place of `complete` when the search fails:
  `{"phase":"error","error":"Search failed. Please try again.","requestId":"..."}`.

The JSON answer is the `complete` object without `phase`. Each match is a full
contact with these fields added:

| Field                      | Meaning                                                                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verified`                 | `true` when a local exact match, a facet, a database filter or the reranker proved the match.                                                         |
| `aiReason`                 | One sentence built from the proven fields, or `null`.                                                                                                 |
| `aiEvidence`               | The passage a verified match quoted: `passageId`, `field`, `sourceId`, `startOffset`, `endOffset` and `quote`. Present only when a passage proved it. |
| `approximate`, `matchType` | Only on a local name answer. They mark a close name.                                                                                                  |
| `matchedOn`                | The fields that answer the question, at most three, the most telling first. See below.                                                                |

`matchedOn` says why each person is in the list, with no model call. Each
entry is `{ field, text, marks, how }`:

- `field` is `role`, `headline`, `company`, `industry`, `location`,
  `interest`, `tag`, `about`, `preferences`, `experience`, `education`,
  `address` or `lastContact`.
- `text` is the contact's own text for the field, cut to one line. A list
  field joins its matching items.
- `marks` holds `[start, end)` offsets into `text` where the question's words
  are. Matching ignores case and accents, and finds a word's other forms.
- `how` is `filter` when a facet or the plan's filter proved the field, `ai`
  when the reranker cited it, `words` when the question's words are in it,
  and `meaning` for a passage close in meaning. Proven fields come first.

A name, an email or a phone number gets `[]`. Every match carries the list,
the `instant` ones too.

`fallback: true` means no model verified the list. `cached: true` means a cache
answered. These questions get a `complete` line only, with no model call:

- A name, an email address, a phone number, or one quoted phrase.
- A question that is only facets, such as `tag:founder`.
- A question that only names a company, a place or an industry your contacts
  have, such as "people in Lisbon".
- Any question while AI is off for you or for the instance, or with no
  provider. The local list is then the answer, with `fallback: true`.

The model stages share a 12-second budget. An error, a timeout or an edit in
your account during that time ends with a fresh local list and
`fallback: true`.

### Search your notes

`GET /api/search/interactions` and `GET /api/interactions/search` run the same
note search. All parameters are optional.

| Parameter         | Meaning                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `q`               | The question, up to 500 characters. A date phrase in it, such as `last month`, becomes a date filter.        |
| `from`, `to`      | A calendar date or an ISO timestamp. `from` is inclusive and `to` is exclusive. They override a date phrase. |
| `type`            | One interaction type, such as `call`.                                                                        |
| `contactId`       | One contact's notes only.                                                                                    |
| `sort`            | `relevance` (default) or `date`.                                                                             |
| `mode`            | `auto` (default: every word, then any word), `all` or `any`.                                                 |
| `limit`, `offset` | 1 to 50 (default 20), and 0 to 5,000.                                                                        |
| `tz`              | Your IANA time zone, so `last month` is your month. Default `UTC`.                                           |

```bash
curl -G http://localhost:3210/api/search/interactions \
  -H "Authorization: Bearer $CONTRACK_TOKEN" \
  --data-urlencode "q=who discussed hiring last month" \
  --data-urlencode "tz=Europe/Berlin"
```

The answer is `{ query, total, limit, offset, hits }`. `query` says how the
server read the question: `text`, `tokens`, `mode`, `phrase`, `range` and
`timeZone`. Each hit has `id`, `contactId`, `type`, `title`, `date`, a plain
text `excerpt`, `highlights` and a short `contact`. `highlights` holds
`[start, end]` offsets into `title` and `excerpt`.

`GET /api/interactions/search` answers the `hits` array alone, and each hit adds
`contactName`.

### The brief

`POST /api/search/synthesize` always streams NDJSON: `{"phase":"start"}`, then
`delta` lines with the next piece of text, then `complete` with the whole brief.
An `error` line takes the place of `complete` when the model fails, when the
contacts change during the run, or when the text fails the output check. A
cached brief sends no `delta` lines.

### Starter questions

`GET /api/search/starters` answers `{ questions }`, each `{ text, kind }`, such
as `{ "text": "Who do I know in Lisbon?", "kind": "city" }`. The kinds are
`industry`, `city`, `company`, `role`, `interest`, `tag`, `pair` (an
industry and a city together) and `general`.

- Each question names a value that two of your active contacts share, or one
  contact in an account of under ten. A `general` question names no value.
  There are seven, such as `Who do I track?`, and each is in the pool only
  when its facets find a contact. The search reads each as its facets.
- The pool holds at most 500 questions, and no more than you have contacts,
  except a `general` question that finds some of your contacts and not all,
  which is in the pool whatever its size. With no contacts it is `[]`.
- The server keeps the pool per account and search revision, and builds it
  again after an import.

### Index coverage

`GET /api/search/coverage` answers `total`, `indexed`, `missing`, `pending`,
`failed`, `coverage` (a percentage), `isIndexing`, `evidenceIndexed`,
`representationVersion`, `embeddingSignature`, the embedding `provider`
(`kind`, `providerId`, `model`, `isPaid`) and up to 10 `failedItems`.

`POST /api/search/refresh-index` queues the contacts that miss an index entry.
`forceAll: true` drops your index and queues every contact. When a paid
provider model makes the embeddings, send `allowProvider: true`. Without it the
route answers `400` with `requiresExplicitConfirmation: true`, the provider,
the model and `missingCount`, and queues nothing. With a paid provider model
and AI off for you, it answers `403 AI_OFF_FOR_ACCOUNT`. Success answers
`{ ok, queued, message }`.

## Contact enrichment

Research finds public pages about a contact and fills empty fields. It needs
a web search model, or SearXNG and a Strong model. See
[Research contacts](ai.md#research-contacts).

| Endpoint                              | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                        | Access    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `POST /api/ai-search`                 | Start a batch: `contactIds` (1 to 100, unique), `strategy` (`two-pass`, `searxng`, or `combined` for the web search model's search and SearXNG's at once), or `technique` (`provider-search`, `search-and-read` or `combined`) and `webSearch` (`searxng`), not both, and your web search engine when absent, and `depth` (`standard` or `deep`). Answers `{ batchId, jobCount }`. A start while your batch runs joins it, with `"appended": true`. | your data |
| `GET /api/ai-search/status`           | Poll a batch: `?batchId=`. `404` when the batch is gone.                                                                                                                                                                                                                                                                                                                                                                                            | your data |
| `GET /api/ai-search/stream`           | The batch as SSE: `?batchId=`. It closes when the batch stops.                                                                                                                                                                                                                                                                                                                                                                                      | your data |
| `POST /api/ai-search/:batchId/cancel` | Stop a batch. Queued jobs never start. Answers the batch.                                                                                                                                                                                                                                                                                                                                                                                           | your data |

One batch runs at a time on the instance, one contact at a time. Another
account's batch answers `429 RATE_LIMITED`. A batch lives in memory, so a
restart loses its progress. Finished contact updates stay.

The batch `status` is `processing`, `complete` or `cancelled`. Each job is
`queued`, `searching`, `merging`, `success`, `error` or `cancelled`, and a
finished job has an `outcome`. Every job names its `technique` and the same
choice as a `strategy`, and its `webSearch` when its technique uses one.

When an AI switch turns off during a batch, the job that runs fails with the
switch's message and the `errorType` `auth`. The batch stops there: each job
not started yet fails with the same reason, and the batch is `complete`.

`POST /api/contacts/:id/enrich` researches one contact and answers
`{ success, fieldsUpdated, outcome, latencyMs, models, tokenCount }`:

- `outcome` is `added`, `nothing-new` or `no-public-info`.
- The run has 240 seconds at Standard and 290 seconds at Deep.
- It searches with your web search engine, unless the body names a
  `technique` (`provider-search`, `search-and-read` or `combined`) or a
  `webSearch` (`searxng`). The engine is your `webSearchEngine` preference,
  or the instance's engine while it is `default`. When that engine cannot
  run, the first engine that can run searches.
- A `webSearch` named alone runs with your engine's technique when it
  searches the web, and with `search-and-read` when it does not. What the
  body names is used or refused, never replaced by another search.
- `400 VALIDATION_ERROR` for a technique or a web search that does not
  exist. `400` for a `webSearch` with a technique that uses none, such as
  `provider-search`. `503` for a choice that is not set up, such as
  `503 SEARXNG_NOT_CONFIGURED`.
- `403 AI_OFF_FOR_ACCOUNT`, `503 AI_OFF_FOR_INSTANCE` or `503 RESEARCH_OFF`
  when a switch turns off during the run.
- `409` when research on the contact is already running, or the contact
  changed. `502 AI_GROUNDING_MISSING` when no search cited a page.
  `502 AI_NO_ANSWER` when no search answered. `503` when no engine can run,
  and `503 RESEARCH_OFF` while an admin has web search off.
- Research fills empty fields and adds missing child records. It never
  overwrites what you wrote.

## Duplicates

| Endpoint                                    | What it does                                                                                                                                                      | Access    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `POST /api/dedupe/scan`                     | Start a scan: `mode` is `quick`, `deep` (default) or `full`. `autoMergeThreshold` (0.85 to 0.99) overrides your preset for this scan. Answers `{ scanId, mode }`. | your data |
| `GET /api/dedupe/stream`                    | A scan's progress as SSE: `?scanId=`. It closes when the scan completes or fails.                                                                                 | your data |
| `GET /api/dedupe/status`                    | A scan's progress: `?scanId=`.                                                                                                                                    | your data |
| `GET /api/dedupe/active`                    | Your running scan: `{ active, queued, scan }`.                                                                                                                    | your data |
| `GET /api/dedupe/suggestions`               | Pending suggestions: `{ suggestions, total }`. `limit` up to 500, default 100.                                                                                    | your data |
| `GET /api/dedupe/suggestions/count`         | `{ count, pairs }`: the cards the review shows, and the raw pairs.                                                                                                | your data |
| `GET /api/dedupe/suggestion-for/:contactId` | The pending suggestion that includes a contact: `{ suggestion }`.                                                                                                 | your data |
| `POST /api/dedupe/suggestions/:id/merge`    | Merge a suggestion: `{ primaryId }`, one of its two contacts.                                                                                                     | your data |
| `POST /api/dedupe/suggestions/:id/dismiss`  | Dismiss a suggestion. The pair is not suggested again.                                                                                                            | your data |
| `GET /api/dedupe/merge-log`                 | Past merges: `{ entries, total }`. `limit` up to 200, default 50.                                                                                                 | your data |
| `POST /api/dedupe/merge-log/:id/undo`       | Undo a merge. `409 ALREADY_UNDONE` the second time.                                                                                                               | your data |
| `GET /api/dedupe/embedding-status`          | Your duplicate-index coverage: `{ embedded, total, missing, coverage }`.                                                                                          | your data |
| `POST /api/dedupe/backfill-embeddings`      | Fill missing duplicate vectors for every account. Answers `{ "started": true }`.                                                                                  | admin     |

A scan runs in the background. One scan runs at a time on the instance, and a
scan by another account books your turn: the answer is `429 RATE_LIMITED`
with `details.queued`. The merge routes for two or more contacts are in
[Contacts](#contacts).

## Pulse

| Endpoint                              | What it does                                                                                                                                                                                                                                                                                                           | Access    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `GET /api/dashboard`                  | The Pulse data: `overdue`, `dueToday`, `upcoming`, `ghosts`, `metrics`, `catchUp`, `tracking`, `recentlyAdded`, the composition lists, 30-day timelines, `hygiene`, `meetings` and `correspondents`. `tz` is your IANA time zone, for the days of `overdue`, `dueToday` and `upcoming`. Without it, the server's zone. | your data |
| `GET /api/dashboard/activity`         | Activity counts: 84 `days`, 12 `weekTotals` and `prevWeekTotals`, `streak`, `today` and `thisWeek`, in the server's time zone.                                                                                                                                                                                         | your data |
| `GET /api/dashboard/insight`          | The daily insight, written by AI. Answers `null` with no provider.                                                                                                                                                                                                                                                     | your data |
| `GET /api/command-palette/zero-state` | What the command palette shows before you type: `{ insights }`, such as follow-ups due, catch-ups and ghosts. No model runs.                                                                                                                                                                                           | your data |

In `GET /api/dashboard`, `catchUp` lists up to ten tracked contacts past their
cadence, the furthest first. `tracking` holds `count`, the score `bands`,
`catchUpCount`, `startedLast30d`, `snapshotWeeks`, and three `rising` and three
`cooling` contacts. `rising` and `cooling` stay empty until four weekly
snapshots exist.

## Map and places

| Endpoint                    | What it does                                                                                                                                                                     | Access               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `GET /api/geo/search`       | Find a place by name: `q` (2 to 120 characters). See the answers below. It reads no contacts.                                                                                    | any signed-in caller |
| `GET /api/geo/status`       | Your contacts with address text and no pin: `{ contacts }`. See the rows below.                                                                                                  | your data            |
| `GET /api/map/views`        | Your saved map views: `{ views }`.                                                                                                                                               | your data            |
| `POST /api/map/views`       | Save a view: `name` (1 to 60 characters), `query` (up to 200), `layer` (`pins` or `heat`) and `bounds` `[west, south, east, north]`. `201`. `409 TOO_MANY_VIEWS` past 100 views. | your data            |
| `PATCH /api/map/views/:id`  | Change `name`, `query`, `layer` or `bounds`. `sortOrder` moves the view to that place in the list (0 is first), and the others keep their order.                                 | your data            |
| `DELETE /api/map/views/:id` | Delete a saved view.                                                                                                                                                             | your data            |

In `bounds`, west must be less than east, and south less than north. The Map
page reads its contacts from `GET /api/contacts?view=slim`.
`GET /api/contacts/map` and the pin routes are in [Contacts](#contacts).
`PATCH /api/contacts/:id/location` with `regeocode` answers `400 NO_ADDRESS`
when the contact has no address text to read.

A place search answers `{ query, lat, lng, provider, cached, displayName }`.
`displayName` is the place Nominatim matched. `404 NO_RESULT` means nothing
matches, and `503 GEOCODER_UNAVAILABLE` means Nominatim is busy or does not
answer. A search that finds nothing is remembered for 7 days. A search that
gets no answer is not.

Each row of `GET /api/geo/status` has `id`, `name`, `company`, `avatarUrl`,
`location` (the text the geocoder reads), `isTracked`, `lat` and `lng` (both
null), and `reason`: `pending` (not tried yet, or queued) or `not-found` (the
geocoder found nothing).

## Connectors

Connectors sync meetings, mail and contacts from a calendar feed, a mailbox or
Google. Stored credentials are encrypted. See [Connectors](import-and-sync.md#connectors).

| Endpoint                                     | What it does                                                                                                                                                                                         | Access               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `GET /api/connectors/kinds`                  | The connector kinds this server offers: `{ platform, docker, kinds }`. The Google kind says whether an admin set its OAuth client.                                                                   | any signed-in caller |
| `GET /api/connectors`                        | Your connectors, without secrets: `{ connectors }`.                                                                                                                                                  | your data            |
| `POST /api/connectors`                       | Create a connector: `kind`, `name`, `config`, `secret` and `intervalMinutes` (5 to 10,080). The server tests the credentials first. `201`. Needs a session.                                          | your data            |
| `POST /api/connectors/test`                  | Test `kind`, `config` and `secret` without saving. Needs a session.                                                                                                                                  | your data            |
| `GET /api/connectors/:id`                    | One connector, with its recent runs.                                                                                                                                                                 | your data            |
| `PATCH /api/connectors/:id`                  | Change `name`, `config`, `secret`, `intervalMinutes` or `status` (`active` or `paused`). Needs a session.                                                                                            | your data            |
| `DELETE /api/connectors/:id`                 | Delete a connector. `deleteImported: true` (body or query) also deletes what it imported. Answers `204`. Needs a session.                                                                            | your data            |
| `POST /api/connectors/:id/sync`              | Sync now. Answers `202 { runId }`. Needs a session.                                                                                                                                                  | your data            |
| `GET /api/connectors/:id/runs`               | Run history: `{ runs }`. `limit` up to 100, default 20.                                                                                                                                              | your data            |
| `GET /api/connectors/correspondents`         | People your connectors saw who are not contacts yet, most seen first: `{ correspondents }`. `limit` up to 100, default 50.                                                                           | your data            |
| `POST /api/connectors/correspondents/ignore` | Ignore a correspondent, so they do not become a ghost: `{ connectorId, externalId }`. Answers `{ ok, updated }`. `updated` is false when nothing matched. Needs a session.                           | your data            |
| `GET /api/connectors/google/start`           | Start the Google sign-in. Redirects to Google's consent screen. `?summaries=true` asks for mail read access. `400 GOOGLE_NOT_CONFIGURED` with no OAuth client.                                       | your session         |
| `GET /api/connectors/google/callback`        | Google sends the browser back here. The server checks the state (15 minutes, same account), stores the tokens, creates or updates your Google connector, and redirects to **Settings → Connectors**. | your session         |

The Google routes are for a browser. The callback address is
`<your origin>/api/connectors/google/callback`, and the Google OAuth client
must list it.

## Trash, backups, and export

| Endpoint                       | What it does                                                                                                  | Access    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- | --------- |
| `GET /api/trash`               | Your trashed contacts and the retention: `{ items, retentionDays }`.                                          | your data |
| `POST /api/trash/:id/restore`  | Restore a trashed contact. Answers the contact. `404` when it is not in the trash.                            | your data |
| `POST /api/trash/bulk-restore` | Restore many: `{ ids }`. Skips ids that are not in the trash. Answers `{ success, count }`.                   | your data |
| `DELETE /api/trash/:id`        | Delete a trashed contact and its history now.                                                                 | your data |
| `GET /api/backups`             | Every database snapshot, with its `verification`: `{ backups }`.                                              | admin     |
| `POST /api/backups`            | Take a snapshot now. `201` with its details.                                                                  | admin     |
| `GET /api/export/json`         | Your data as one JSON file: `contacts`, `interactions`, `lists`, `listMembers`, `actionItems` and `mergeLog`. | your data |
| `GET /api/export/csv`          | Your contacts as CSV, trashed contacts left out.                                                              | your data |
| `GET /api/export/vcard`        | Your contacts as a vCard 3.0 file, trashed and ghost contacts left out.                                       | your data |

A trashed contact is deleted for good after the retention period, 30 days by
default. A snapshot holds every account, so the backup routes are for admins.
Each snapshot is opened again and checked right after it is written.

### Export

Each export is an attachment. The file name holds your username and the date,
for example `contrack-contacts-maya-2026-09-30.csv`.

```bash
curl -OJ http://localhost:3210/api/export/json \
  -H "Authorization: Bearer $CONTRACK_TOKEN"
```

The JSON file starts with `exportedAt` and `version`. Its contacts keep their
import sources, experience and education. The CSV has one row per contact, with
emails, phones and tags joined by `; `. A cell that could run as a spreadsheet
formula starts with `'`.

## AI settings

These routes back **Settings → Administration → AI**. The capabilities are
`quick` (the Fast model), `deep` (the Strong model), `research` (the web
search model) and `embeddings` (the embedding model). See
[The AI page](ai.md#the-ai-page).

| Endpoint                                             | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Access               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `GET /api/settings/ai`                               | The whole view: connected `providers` with a masked key and the `envVariable` that set an environment key, `availableProviders`, `customEndpoints`, and each capability's assignment and what it resolves to. `resolved.source` says what chose the model (`pinned`, `env` or `auto`), and `envDefault` names a set `AI_*_MODEL` variable. `webSearch` holds the switch (`allowed`), the instance's `engine`, whether each of the `engines` can run and what it lacks, and `searxng`. Then the read-only `reranker`, `multipleAccounts` and the instance switch. Only an admin gets the SearXNG address. It never returns a key. | any signed-in caller |
| `GET /api/settings/ai/models/:capability`            | The models a capability can use, grouped by provider: `{ groups }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | any signed-in caller |
| `PUT /api/settings/ai/providers/:id/key`             | Save a key for `gemini`, `openai` or `anthropic`: `{ apiKey }`. The server lists the models to test it and answers `{ success, modelCount }`. A failed test keeps the key.                                                                                                                                                                                                                                                                                                                                                                                                                                                       | admin                |
| `DELETE /api/settings/ai/providers/:id/key`          | Remove a saved key. A key from the environment stays.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | admin                |
| `POST /api/settings/ai/providers/:id/refresh-models` | List the provider's models again: `{ modelCount, fetchedAt }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | admin                |
| `PUT /api/settings/ai/capabilities/:capability`      | Assign a capability: `mode` (`auto` or `pinned`), `providerId` and `model`. A pin is tested first. A new embeddings model rebuilds both vector indexes in the background. `disabled` answers `400`: web search has its own switch.                                                                                                                                                                                                                                                                                                                                                                                               | admin                |
| `PUT /api/settings/ai/endpoints`                     | Add or change an OpenAI-compatible server: `id`, `label`, `baseUrl` and `apiKey`. Its provider id is `custom:<id>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | admin                |
| `DELETE /api/settings/ai/endpoints/:id`              | Remove an OpenAI-compatible server.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | admin                |
| `PUT /api/settings/ai/web-search`                    | Turn web search on or off, or set the instance's engine: `{ allowed, engine }`, one or both. `engine` is `provider`, `searxng` or `combined`. Answers `{ success, view }`, the whole view.                                                                                                                                                                                                                                                                                                                                                                                                                                       | admin                |
| `PUT /api/settings/ai/searxng`                       | Set the SearXNG address for web search: `{ url }`. An empty string clears it. A cloud metadata or a link-local address answers `400`. `409 SET_BY_ENVIRONMENT` when `SEARXNG_URL` is set.                                                                                                                                                                                                                                                                                                                                                                                                                                        | admin                |
| `PUT /api/settings/ai/instance`                      | Turn AI off or on for every account: `{ aiOff }`. `409 AI_LOCKED_BY_ENV` when `AI_DISABLED` holds it off.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | admin                |

An OpenAI-compatible server's `baseUrl` must include the API prefix it serves,
for example `http://localhost:11434/v1` for Ollama. Every write records an
audit entry with the setting name, never its value.

## AI usage and diagnostics

| Endpoint                         | What it does                                                                                                                                                                | Access               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `GET /api/ai/instance`           | Whether AI is off for the instance: `{ aiOff, lockedByEnv }`.                                                                                                               | any signed-in caller |
| `GET /api/ai/stats/summary`      | Your AI usage: calls, cached calls, tokens and an estimated cost. An admin also sees the cache tiers, and `?scope=all` gives the whole instance.                            | your data            |
| `GET /api/ai/stats/feed`         | Your AI calls, newest first: `offset`, `limit`, `operation` (a comma list), `cached` (`true` or `false`) and `sort` (`newest` or `oldest`). An admin can send `?scope=all`. | your data            |
| `GET /api/ai/diagnostics`        | What `quick`, `deep` and `research` resolve to, Gemini's usage meter and the paused Gemini models.                                                                          | admin                |
| `GET /api/ai/grounding-capacity` | Whether contact research can run now: `{ hasCapacity, provider, researchRuns24h }`.                                                                                         | admin                |

`?scope=all` from a member answers `403 ADMIN_REQUIRED`. The cost is an
estimate from list prices.

## MCP and read-only routes

`POST /api/mcp` is the Model Context Protocol server. It runs the Streamable
HTTP transport with no session, and it takes JSON-RPC 2.0. For clients and
tools, see [Connect a client](mcp.md#connect-a-client).

| Endpoint                         | What it does                                                                                                                                                                                                                 | Access    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `POST /api/mcp`                  | The MCP endpoint. Send `Accept: application/json, text/event-stream`. 120 requests a minute per account.                                                                                                                     | your data |
| `GET /api/mcp`                   | Answers `405` with `Allow: POST`.                                                                                                                                                                                            | your data |
| `DELETE /api/mcp`                | Answers `405` with `Allow: POST`.                                                                                                                                                                                            | your data |
| `GET /api/query/contacts`        | Your contacts as raw rows, newest first. Filters `role` and `company` (contains) and `industry` (exact). `fields` is a comma list of columns to keep. `limit` and `offset`. Trashed, merged and ghost contacts are left out. | your data |
| `GET /api/contacts/action-items` | Your contacts that are due for contact: a follow-up date that has come, or a tracked contact past its cadence, by the rule Pulse uses. Archived, trashed, merged and ghost contacts are left out. Answers full contacts.     | your data |

An MCP client and a script share the token rules: a token reads and writes the
data of the account that created it.

## Avatars, logos, and link previews

| Endpoint                       | What it does                                                                                                                                                                                         | Access               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `GET /api/avatar/:style`       | A generated avatar as SVG. Styles: `avataaars`, `lorelei`, `bottts` and `initials`. `seed` is required. Optional `bg=1`, `theme` (`light` or `dark`) and `look` (`f`, `m` or `n`). Cached for a day. | any signed-in caller |
| `GET /api/logos/:domain`       | A company logo as PNG, at most 128 px. The server fetches it once and keeps it. `404` when the domain has no logo, and `503` for a failure that may pass.                                            | any signed-in caller |
| `GET /api/link-preview/unfurl` | The title, description and image of a web page: `?url=`. The server fetches the page, keeps the image in your uploads, and answers a local `image` path.                                             | your data            |

The server fetches pages and logos, so the browser never contacts those sites.
Every fetch goes to public addresses only, with at most 3 redirects.

## Administration

Every route below needs an admin account. An admin also needs a current
password: an account with a temporary password gets
`403 PASSWORD_CHANGE_REQUIRED`. See [Administration](accounts.md#administration).

| Endpoint                                   | What it does                                                                                                                                                                               | Access |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `GET /api/admin/users`                     | Every account, with contact, session and token counts: `{ users }`.                                                                                                                        | admin  |
| `POST /api/admin/users`                    | Create an account: `email`, `username`, `displayName`, `role` and `temporaryPassword`. The answer holds the temporary password once. `201`.                                                | admin  |
| `GET /api/admin/users/:id`                 | One account and what it owns.                                                                                                                                                              | admin  |
| `PATCH /api/admin/users/:id`               | Change `role` or `displayName`.                                                                                                                                                            | admin  |
| `POST /api/admin/users/:id/reset-password` | Set a new temporary password. Ends the account's sessions and revokes its tokens.                                                                                                          | admin  |
| `POST /api/admin/users/:id/reset-link`     | Email a reset link that lasts 24 hours. Answers `{ sentTo, expiresAt }`. `409 MAIL_NOT_CONFIGURED`, or `409 PUBLIC_URL_REQUIRED`.                                                          | admin  |
| `POST /api/admin/users/:id/disable`        | Disable an account. Its sessions end and its tokens stop working.                                                                                                                          | admin  |
| `POST /api/admin/users/:id/enable`         | Enable an account again. Its tokens work again. Its old sessions do not come back.                                                                                                         | admin  |
| `GET /api/admin/users/:id/export`          | The account's data as a JSON file.                                                                                                                                                         | admin  |
| `DELETE /api/admin/users/:id`              | Delete an account in two steps. The first call answers `409 USER_HAS_DATA` with the counts. Send `{ "decision": "purge" }` to delete.                                                      | admin  |
| `GET /api/admin/invitations`               | Every invitation with its status: `{ invitations }`.                                                                                                                                       | admin  |
| `POST /api/admin/invitations`              | Create an invitation: `email`, `role`, `expiresInDays` (1 to 90, default 7) and `send`. Answers `{ id, link, expiresAt, sent }`. `201`.                                                    | admin  |
| `DELETE /api/admin/invitations/:id`        | Revoke an invitation.                                                                                                                                                                      | admin  |
| `GET /api/admin/settings`                  | Instance settings: registration, session length, instance name, emailed sign-in links, trash retention and backups. Each lifecycle value says where it comes from.                         | admin  |
| `PUT /api/admin/settings`                  | Change one or more settings. `409 SET_BY_ENVIRONMENT` for a value the environment sets.                                                                                                    | admin  |
| `GET /api/admin/integrations`              | The Google OAuth client, with the secret masked. The SearXNG address is under `GET /api/settings/ai`.                                                                                      | admin  |
| `PUT /api/admin/integrations`              | Set `googleOAuth: { clientId, clientSecret }` (`null` clears it). The SearXNG address is set with `PUT /api/settings/ai/searxng`.                                                          | admin  |
| `GET /api/admin/mail`                      | Outgoing mail settings without the password, and `publicUrl`.                                                                                                                              | admin  |
| `PUT /api/admin/mail`                      | Save SMTP settings: `host`, `port`, `secure`, `user`, `password`, `from` and `replyTo`. A blank `password` keeps the saved one. `409 MAIL_CONFIGURED_BY_ENV` when `SMTP_URL` is set.       | admin  |
| `DELETE /api/admin/mail`                   | Remove the saved SMTP settings.                                                                                                                                                            | admin  |
| `POST /api/admin/mail/test`                | Send a test message to `to`, or to you. Answers `{ sentTo }`. `502 MAIL_SEND_FAILED` with the reason.                                                                                      | admin  |
| `GET /api/admin/audit`                     | The audit log, newest first: `{ entries, nextBefore }`. `limit`, `before` and `action` (a comma list of known actions).                                                                    | admin  |
| `GET /api/admin/health`                    | The instance's state: uptime, schema versions, database and WAL size, the last backup, the queues, index coverage per account, cache tiers and the AI provider state. It holds no secrets. | admin  |
| `GET /api/admin/jobs`                      | The background jobs: `{ recurring, failed }`. Each recurring job with `every` in milliseconds, its last run, its result and its next run, then the jobs that failed in the last day.       | admin  |

`PUT /api/admin/settings` takes `registrationOpen`, `sessionTtlDays`,
`instanceName` (up to 60 characters, an empty string clears it),
`magicLinkSignIn`, `trashRetentionDays` (1 to 365), `backupIntervalHours`
(0 to 168) and `backupKeep` (1 to 50).

Three guards keep the instance manageable, checked in this order:

1. The local owner of an instance with sign-in off cannot be disabled or
   deleted: `409 LOCAL_OWNER_PROTECTED`.
2. The last active admin cannot be demoted, disabled or deleted:
   `409 LAST_ADMIN`.
3. An admin cannot disable or delete their own account:
   `400 CANNOT_TARGET_SELF`.

An invitation link has the form `<origin>/join?token=...`. A mailed link always
uses `PUBLIC_URL`, never the request's host.

## Uploaded files

| Endpoint       | What it does                                                                                                                           | Access    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `USE /uploads` | Serves files under `/uploads` for any `GET /uploads/...` request: contact photos, attachments, link-preview images and account photos. | your data |

The files live in `uploads/` inside the data folder. Each account has its own
folder, `/uploads/u/<your account id>/...`. The rules:

- Your own files are served to you only.
- Account photos (`/uploads/u/<id>/profile/...`) are served to any signed-in
  caller.
- Company logos (`/uploads/logos/...`) are shared.
- Any other path, including another account's files, answers `404`.
- Images show in the browser. Every other file type downloads.

## Development

| Endpoint                     | What it does                                                                            | Access          |
| ---------------------------- | --------------------------------------------------------------------------------------- | --------------- |
| `GET /api/debug/cache-stats` | Hit, miss and entry counts for every AI cache tier. Registered only outside production. | admin, dev only |

## Related

- [MCP and API tokens](mcp.md)
- [Accounts and sign-in](accounts.md#turn-on-sign-in)
- [Configuration reference](configuration.md#environment-variables)
- [Architecture](architecture.md#accounts-and-isolation)
- [Self-hosting](self-hosting.md)
