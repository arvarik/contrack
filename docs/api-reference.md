# API Reference

All endpoints are prefixed with `/api`. Request and response bodies are `application/json` unless noted otherwise. The server runs on `http://localhost:3210` by default.

**Authentication:** off by default. When `AUTH_REQUIRED=true` or `API_TOKEN` is configured, every `/api` and `/uploads` request needs either `Authorization: Bearer ctk_…` (a personal token, for scripts and MCP) or the session cookie set by `POST /api/auth/login` (the web app). The environment `API_TOKEN` still works and is deprecated: it belongs to no account, acts as the first admin, and is removed in 3.0. Reachable without a credential even when gated: `/api/auth/*` (sign-in must work), `GET /healthz` (health checks hold no secrets), and the static frontend bundle (the SPA must load to show the sign-in screen). See [Configuration](configuration.md#authentication--remote-access).

**Rate limits:** endpoints that trigger billable AI calls or outbound fetches are limited to 60 requests/minute per client IP (`429 RATE_LIMITED`).

**Body size:** JSON bodies are capped at **1 MB**; the one exception is `POST /api/contacts/bulk` (50 MB) for imports. Over the limit the server responds `413` with code `PAYLOAD_TOO_LARGE`. Unknown `/api` paths return 404; non-GET requests to non-API paths are not swallowed by the SPA fallback and also 404.

**Validation and errors:** Every response includes `X-Request-Id`. Error bodies include the same identifier in `error.requestId`. Invalid input returns `400`. Missing or trashed parents return `404` before child writes or uploads. Contact flags such as `isGhost` and `isArchived` use JSON booleans.

Dates accept a valid ISO date or timestamp. Timestamps include an offset or use the server's local time. Contact names must contain text. Latitude and longitude use their geographic ranges. Empty updates return `400`.

Bulk operations accept up to 5,000 unique IDs and report the number of rows they change. Bulk updates accept scalar profile fields. They reject child arrays such as tags, emails, and phones. Lists exclude archived, ghost, merged, and trashed members from their counts and contact results.

`GET /api/search` accepts a literal prefix query in `q`. Its optional `filters` parameter contains a JSON array of up to eight `{field, value}` facets. Supported fields are `company`, `role`, `location`, `industry`, `tag`, `score`, and `updated`. The server applies facets before its result limit. The command palette uses the same facet predicate.

---

## Health

### `GET /healthz`

Unauthenticated, and outside `/api` so the credential gate never touches it.
Docker's `HEALTHCHECK` and any uptime monitor hold no credential.

```bash
curl http://localhost:3210/healthz
```

```json
{
  "status": "ok",
  "schema": { "tenancy": 2, "fts": 3 },
  "vec": "v0.1.9",
  "expects": { "tenancy": 2, "fts": 3 }
}
```

`schema` is what this database is on and `expects` is what this build wants.
The pair is the point: one number alone cannot tell an operator whether the
migration they just ran finished. Added by extra F4.

Version numbers and nothing else. An unauthenticated endpoint must not
describe the instance, so there are no counts, no configuration, no accounts
and no name here. That picture is at `GET /api/admin/health`, which needs an
admin.

`503 { "status": "unavailable" }` when the database does not answer. A process
can accept sockets long after SQLite has stopped responding, which is why the
probe runs a query rather than just returning.

## Contacts

### `GET /api/contacts`

Fetch all active (non-archived, non-ghost, non-merged) contacts.

**Query Parameters:**

| Param  | Description                                                                       |
| ------ | --------------------------------------------------------------------------------- |
| `view` | Set to `slim` for lightweight response (id, name, company, avatarUrl, themeColor) |

```bash
# All contacts
curl http://localhost:3210/api/contacts

# Prefix search
curl "http://localhost:3210/api/search?q=engineer"

# Slim view (for caches, pickers)
curl "http://localhost:3210/api/contacts?view=slim"
```

```javascript
const contacts = await fetch("/api/contacts?view=slim").then((r) => r.json());
```

---

### `GET /api/contacts/:id`

Fetch a single contact with all hydrated child arrays (emails, phones, tags, lists, education, experience, etc.).

```bash
curl http://localhost:3210/api/contacts/abc123
```

**Response shape:**

```json
{
  "id": "abc123",
  "name": "Jane Smith",
  "company": "Acme Corp",
  "role": "VP Engineering",
  "emails": [
    { "id": "e1", "email": "jane@acme.com", "label": "work", "isPrimary": true }
  ],
  "phones": [
    {
      "id": "p1",
      "phone": "+14155551234",
      "label": "mobile",
      "isPrimary": true
    }
  ],
  "tags": [{ "id": "t1", "tag": "investor" }],
  "lists": [{ "id": "l1", "name": "Board Members", "icon": "👥" }],
  "interactionCount": 12,
  "relationshipScore": 85,
  "...": "all other fields"
}
```

---

### `POST /api/contacts`

Create a new contact.

**Request Body:**

```json
{
  "name": "Jane Smith",
  "company": "Acme Corp",
  "role": "VP Engineering",
  "location": "San Francisco, CA",
  "emails": [{ "value": "jane@acme.com", "label": "work" }],
  "phones": [{ "value": "+14155551234", "label": "mobile" }],
  "tags": [{ "tag": "investor" }]
}
```

```bash
curl -X POST http://localhost:3210/api/contacts \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane Smith","company":"Acme Corp","role":"VP Engineering"}'
```

```javascript
const contact = await fetch("/api/contacts", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Jane Smith",
    company: "Acme Corp",
    role: "VP Engineering",
  }),
}).then((r) => r.json());
```

**Returns:** `201` with the created contact object.

---

### `PUT /api/contacts/:id`

Full update with nested child arrays. Replaces child arrays entirely.

```bash
curl -X PUT http://localhost:3210/api/contacts/abc123 \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane Smith-Johnson","emails":[{"value":"jane@newco.com","label":"work"}]}'
```

---

### `PATCH /api/contacts/:id`

Partial scalar update. Does **not** support child arrays — use `PUT` for those.

```bash
curl -X PATCH http://localhost:3210/api/contacts/abc123 \
  -H "Content-Type: application/json" \
  -d '{"company":"NewCo","role":"CTO"}'
```

---

### `DELETE /api/contacts/:id`

Cascade delete including vec0 embeddings, FTS5 entries, and interaction mentions.

```bash
curl -X DELETE http://localhost:3210/api/contacts/abc123
```

---

### `POST /api/contacts/bulk`

Bulk create contacts from an import. Supports SSE streaming for multi-phase import progress.

**Request Body:**

```json
{
  "contacts": [
    { "name": "Alice Johnson", "company": "TechCorp" },
    { "name": "Bob Williams", "role": "Designer" }
  ]
}
```

**Standard mode:**

```bash
curl -X POST http://localhost:3210/api/contacts/bulk \
  -H "Content-Type: application/json" \
  -d '{"contacts":[{"name":"Alice Johnson"},{"name":"Bob Williams"}]}'
```

**SSE streaming mode** (for progress tracking):

```bash
curl -X POST http://localhost:3210/api/contacts/bulk \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"contacts":[...]}'
```

The SSE stream sends progress events through 4 phases:

1. `importing` — Contact creation progress
2. `embedding` — Generating contact fingerprints
3. `scanning` — Looking for duplicates
4. `done` — Summary with counts (imported, auto-merged, needs-review, new-unique)

Both modes run the same duplicate scan over the imported contacts, against the
caller's own contacts only. It compares each new contact with the existing
ones and with the rest of the import, so the same person on two rows of one
spreadsheet is found. A shared email address or phone number is merged
automatically; a matching name, a nickname, or a close profile becomes a
suggestion to review.

The difference between the two modes is when the scan runs. In streaming mode
it runs before the `done` event, and the counts in the summary are its result.
In standard mode the response returns first and the scan starts a few seconds
later, so `GET /api/dedupe/suggestions` is where its result appears.

**Every import has an id and a record.** Send one as `X-Import-Id`, a UUID
the client makes when a file is chosen. A request without the header gets
one made by the server. The id comes back in the first stream event and in
the standard response, and `GET /api/imports/:id` reads the record it names.

```bash
curl -X POST http://localhost:3210/api/contacts/bulk \
  -H "Content-Type: application/json" \
  -H "X-Import-Id: 6f6a4c1e-0c1b-4a9c-9f61-2d8b1f3e7a10" \
  -d '[{"name":"Alice Johnson"},{"name":"Bob Williams"}]'
```

The stream begins with `{"phase":"accepted","importId":"…"}` and ends with
`{"done":true,"importId":"…","status":"complete","count":2,"failed":0,"summary":{…}}`.
A stream that ends without a `done` event is a dropped connection, not a
finished import. The record says what happened.

**The same id twice imports once.** A second request with a known id writes
nothing and answers from the record: the stream sends `accepted` and then a
`done` event with `"repeated": true`, and the standard mode answers `200`
with `"repeated": true`. While the server is still running the import the
answer is `409 IMPORT_IN_PROGRESS`. An import that failed before any contact
was saved runs again under the same id. An id another account used answers
`409 IMPORT_ID_IN_USE`.

**A row that fails does not fail the import.** The rest of the batch is
saved, the row is recorded with its error, and `POST /api/imports/:id/retry`
runs it again. Without an import id, as when the service is called directly,
the batch is all or nothing.

---

### `GET /api/imports`

Fetch the newest 50 imports for the active account.

```bash
curl http://localhost:3210/api/imports
```

```json
{
  "imports": [
    {
      "id": "6f6a4c1e-0c1b-4a9c-9f61-2d8b1f3e7a10",
      "status": "complete",
      "phase": "done",
      "message": null,
      "total": 42,
      "processed": 42,
      "imported": 40,
      "failed": 2,
      "summary": {
        "imported": 40,
        "autoMerged": 1,
        "needsReview": 2,
        "newUnique": 37,
        "failed": 2
      },
      "error": null,
      "createdAt": "2026-09-14 16:40:02",
      "updatedAt": "2026-09-14 16:40:05",
      "completedAt": "2026-09-14 16:40:05"
    }
  ]
}
```

Stale abandoned imports settle automatically on read.

---

### `GET /api/imports/:id`

The record of one import.

```json
{
  "id": "6f6a4c1e-0c1b-4a9c-9f61-2d8b1f3e7a10",
  "status": "complete",
  "phase": "done",
  "message": null,
  "total": 2,
  "processed": 2,
  "imported": 2,
  "failed": 0,
  "summary": {
    "imported": 2,
    "autoMerged": 0,
    "needsReview": 0,
    "newUnique": 2,
    "failed": 0
  },
  "error": null,
  "createdAt": "2026-09-14 16:40:02",
  "updatedAt": "2026-09-14 16:40:03",
  "completedAt": "2026-09-14 16:40:03"
}
```

| `status`   | Meaning                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `running`  | The contacts are being written. Nothing is saved yet.                                                    |
| `imported` | The contacts are saved. The duplicate check is running, and `summary` is null.                           |
| `complete` | Everything finished. `error` carries a note if the duplicate check failed after the contacts were saved. |
| `failed`   | Nothing was saved. `error` says why, and the same request can be sent again with the same id.            |

The record settles itself. A `running` import whose server process died is
answered as `failed` on the next read. An `imported` one whose process died
is finished on the next read: the duplicate check runs again in the
background and the record moves to `complete`.

Answers `404` for an id this account did not use.

---

### `GET /api/imports/:id/rows`

The rows of one import in one status. `status` is `failed` (the default) or
`done`, and `limit` is 1 to 500 (default 200).

```json
{
  "rows": [
    {
      "index": 3,
      "status": "failed",
      "name": "Broken Row",
      "error": "…",
      "contactId": null
    }
  ]
}
```

---

### `POST /api/imports/:id/retry`

Run every failed row again, from the payload the server kept. The rows are
written before the answer, and the duplicate check for the new contacts runs
afterwards, so the record moves `imported` and then `complete`.

```json
{
  "importId": "…",
  "status": "imported",
  "retried": 1,
  "imported": 2,
  "failed": 0
}
```

Answers `400 NOTHING_TO_RETRY` when no row is failed, or when the import
never saved anything, and `409 IMPORT_IN_PROGRESS` while the import or a
retry is running.

---

### `POST /api/contacts/bulk-delete`

Bulk delete by ID array.

```bash
curl -X POST http://localhost:3210/api/contacts/bulk-delete \
  -H "Content-Type: application/json" \
  -d '{"ids":["abc123","def456"]}'
```

---

### `PUT /api/contacts/bulk-update`

Bulk update shared fields across multiple contacts.

```bash
curl -X PUT http://localhost:3210/api/contacts/bulk-update \
  -H "Content-Type: application/json" \
  -d '{"ids":["abc123","def456"],"data":{"company":"NewCo"}}'
```

---

### `POST /api/parse-contact`

AI-parse unstructured text into a structured contact record.

```bash
curl -X POST http://localhost:3210/api/parse-contact \
  -H "Content-Type: application/json" \
  -d '{"text":"Met Jane Smith at the TechCrunch event. She is VP of Engineering at Acme Corp. jane@acme.com, (415) 555-1234."}'
```

**Response:**

```json
{
  "name": "Jane Smith",
  "role": "VP of Engineering",
  "company": "Acme Corp",
  "emails": [{ "value": "jane@acme.com", "label": "work" }],
  "phones": [{ "value": "+14155551234", "label": "work" }]
}
```

---

### `GET /api/contacts/archived`

Fetch all archived contacts.

```bash
curl http://localhost:3210/api/contacts/archived
```

---

### `GET /api/contacts/map`

Fetch geocoded contacts for the map view (only those with lat/lng coordinates). Archived contacts, trashed contacts, ghost contacts and every other account's contacts are left out.

```bash
curl http://localhost:3210/api/contacts/map
# → [ { "id": "abc123", "name": "Jane Smith", "company": "Acme Corp",
#       "avatarUrl": "/uploads/avatars/abc123.webp", "location": "Berlin",
#       "lat": 52.52, "lng": 13.405, "geoSource": "geocoder" } ]
```

The row shape is the eight fields above and nothing more. `shared/geo.ts` declares it as `MapContact`. `geoSource` says who placed the pin: `"geocoder"`, `"manual"` for a pin a person placed, or `null` for coordinates that arrived with the contact.

---

### `PATCH /api/contacts/:id/location`

Move a contact's pin by hand, or hand it back to the geocoder. The body is one of two shapes and nothing else.

```bash
# Put the pin where a person dropped it
curl -X PATCH http://localhost:3210/api/contacts/abc123/location \
  -H "Content-Type: application/json" \
  -d '{"lat": 52.52, "lng": 13.405}'

# Hand the pin back to the geocoder
curl -X PATCH http://localhost:3210/api/contacts/abc123/location \
  -H "Content-Type: application/json" \
  -d '{"regeocode": true}'
```

| Body                  | Effect                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `{ lat, lng }`        | Sets the coordinates and `geoSource = "manual"`. The geocoder never overwrites the row again, until the address text changes.     |
| `{ regeocode: true }` | Clears `lat`, `lng` and `geoSource`, and queues the geocoder on the address. A cached answer is back in the row before the reply. |

`lat` must be in `[-90, 90]` and `lng` in `[-180, 180]`. A body with both shapes, a missing field, or a value out of range answers `400`. The reply is the whole contact, as `GET /api/contacts/:id` returns it.

**Error codes:** `400` (invalid body), `404` (unknown id, a contact in the trash, or another account's contact, all with the same body).

---

## Geocoding

### `GET /api/geo/search`

Search for a place or city by name to resolve geographic coordinates. Backed by the local geocoding cache and Nominatim (or Mapbox if configured). Does not access or modify contacts.

**Query Parameters:**

| Param | Type   | Required | Description                              |
| ----- | ------ | -------- | ---------------------------------------- |
| `q`   | string | Yes      | Place query string (2 to 120 characters) |

**Rate limiting:** 30 requests/minute per account (`429 RATE_LIMITED`).

```bash
curl "http://localhost:3210/api/geo/search?q=London"
```

```json
{
  "query": "London",
  "lat": 51.5074,
  "lng": -0.1278,
  "provider": "Nominatim",
  "cached": false
}
```

**Error codes:**

- `400 VALIDATION_ERROR`: `q` parameter missing or shorter than 2 / longer than 120 characters.
- `404 NO_RESULT`: Nothing found for that place (the negative result is cached for 7 days to avoid repeated provider hits).
- `429 RATE_LIMITED`: Exceeded 30 requests per minute.

---

### `POST /api/contacts/:id/avatar`

Upload an avatar image. Uses `multipart/form-data`.

```bash
curl -X POST http://localhost:3210/api/contacts/abc123/avatar \
  -F "avatar=@photo.jpg"
```

---

### `POST /api/auth/me/avatar` _(account)_

Upload a profile photo for the signed-in account. Uses `multipart/form-data` with field `avatar`.
Normalised through sharp to a 512 px cover JPEG at quality 82 (EXIF rotated, metadata stripped) stored in `/uploads/u/<userId>/profile/`.
Any previous profile photo is unlinked.

```bash
curl -X POST http://localhost:3210/api/auth/me/avatar \
  -b cookies.txt \
  -F "avatar=@photo.jpg"
```

**Response:**

```json
{
  "user": {
    "id": "abc12345-...",
    "email": "user@example.com",
    "username": "user",
    "displayName": "User Name",
    "role": "member",
    "createdAt": "2026-09-18T00:00:00.000Z",
    "lastLoginAt": "2026-09-18T09:00:00.000Z",
    "status": "active",
    "credentialState": "password",
    "mustChangePassword": false,
    "avatarUrl": "/uploads/u/abc12345-.../profile/profile-1789750000000.jpg"
  }
}
```

**Error codes:** `400` (missing file, unsupported MIME type, or invalid image bytes), `401` (not authenticated), `413` (file exceeds 10 MB limit).

---

### `DELETE /api/auth/me/avatar` _(account)_

Remove the profile photo for the signed-in account. Idempotent. Unlinks the file on disk and resets `users.avatarUrl` to `null`.

```bash
curl -X DELETE http://localhost:3210/api/auth/me/avatar \
  -b cookies.txt
```

**Response:**

```json
{
  "user": {
    "id": "abc12345-...",
    "email": "user@example.com",
    "username": "user",
    "displayName": "User Name",
    "role": "member",
    "createdAt": "2026-09-18T00:00:00.000Z",
    "lastLoginAt": "2026-09-18T09:00:00.000Z",
    "status": "active",
    "credentialState": "password",
    "mustChangePassword": false,
    "avatarUrl": null
  }
}
```

**Error codes:** `401` (not authenticated).

---

### `POST /api/contacts/:id/enrich`

Single-contact enrichment via AI web grounding. Uses the provider-appropriate strategy (two-pass for Gemini, single-pass for OpenAI/Anthropic).

```bash
curl -X POST http://localhost:3210/api/contacts/abc123/enrich
```

**Response:**

```json
{
  "success": true,
  "fieldsUpdated": 5,
  "latencyMs": 2340,
  "models": ["gemini-2.5-flash"],
  "tokenCount": 1250
}
```

The server accepts one active research request per contact. It validates the
result before it writes any fields. It fills empty fields and adds missing
child records. It preserves existing contact data.

The request has a 90-second deadline. A disconnected client cancels further
work. The provider can still charge for a request it already accepted.

**Error codes:** `409` (research already active, contact unavailable, or contact
changed during research), `429` (queue or quota full), `502` (invalid AI output),
`503` (research or extraction model unavailable).

Two-pass research requires source links. Missing provider sources return
`502 AI_GROUNDING_MISSING` before extraction or database changes.

---

## Timeline & Interactions

### `GET /api/contacts/:id/timeline`

Fetch chronological timeline with @mention links.

```bash
curl http://localhost:3210/api/contacts/abc123/timeline
```

---

### `POST /api/contacts/:id/interactions`

Log a new interaction. Triggers async @mention extraction.

**Request Body:**

```json
{
  "type": "note",
  "title": "Coffee meeting",
  "content": "Discussed the Series B with @John Doe. Great progress on the product roadmap.",
  "date": "2025-01-15T10:00:00Z"
}
```

Supported types: `note`, `call`, `meeting`, `email`, `message`, `sms`.

Optional `actionItem` field to create a linked follow-up:

```json
{
  "type": "call",
  "title": "Quarterly check-in",
  "content": "Need to follow up on proposal.",
  "date": "2025-01-15T10:00:00Z",
  "actionItem": {
    "title": "Send proposal draft",
    "dueAt": "2025-01-22T00:00:00Z"
  }
}
```

```bash
curl -X POST http://localhost:3210/api/contacts/abc123/interactions \
  -H "Content-Type: application/json" \
  -d '{"type":"note","title":"Meeting notes","content":"Great discussion.","date":"2025-01-15T10:00:00Z"}'
```

---

### `PATCH /api/interactions/:id`

Edit an existing interaction.

```bash
curl -X PATCH http://localhost:3210/api/interactions/int123 \
  -H "Content-Type: application/json" \
  -d '{"content":"Updated meeting notes with corrections."}'
```

---

### `DELETE /api/interactions/:id`

Remove an interaction.

```bash
curl -X DELETE http://localhost:3210/api/interactions/int123
```

---

### `POST /api/contacts/:id/briefing`

Generate an AI "Catch-Me-Up" briefing from the contact's timeline history.

```bash
curl -X POST http://localhost:3210/api/contacts/abc123/briefing
```

**Response:**

```json
{
  "briefing": "**Wins:** Closed Series B at $12M valuation...\n**Projects:** Building out the platform team...\n**Open Loops:** Waiting on legal review for partnership agreement..."
}
```

The cache key includes the contact facts, recent interaction content, and model.
Concurrent requests for the same input share one generation. A contact edit
during generation returns `409` and prevents a stale briefing from entering the
database. Missing AI configuration returns `503`.

---

### `POST /api/contacts/:id/promote`

Promote a Ghost contact to a full contact.

```bash
curl -X POST http://localhost:3210/api/contacts/ghost123/promote
```

---

### `POST /api/contacts/:id/attachments`

Upload a file attachment to a contact. Uses `multipart/form-data`.

```bash
curl -X POST http://localhost:3210/api/contacts/abc123/attachments \
  -F "attachment=@document.pdf"
```

---

## Search

### `GET /api/search?q=`

FTS5 keyword search (used by the sidebar search bar).

```bash
curl "http://localhost:3210/api/search?q=engineer+san+francisco"
```

---

### `POST /api/search/semantic`

Hybrid semantic search (Ask Contrack v3). Supports NDJSON streaming for progressive results.

**Request Body:**

```json
{
  "query": "who works in fintech and I haven't talked to recently"
}
```

**Standard JSON response:**

```bash
curl -X POST http://localhost:3210/api/search/semantic \
  -H "Content-Type: application/json" \
  -d '{"query":"fintech contacts in San Francisco"}'
```

**NDJSON streaming** (two-phase progressive results):

```bash
curl -X POST http://localhost:3210/api/search/semantic \
  -H "Content-Type: application/json" \
  -H "Accept: application/x-ndjson" \
  -d '{"query":"fintech contacts"}'
```

The `instant` event returns local keyword candidates before AI refinement.
The `complete` event returns verified matches or explicit keyword fallback results.
A valid empty result ends the search. AI refinement has a 12-second deadline.
Both JSON and streaming callers use the same pipeline.

---

### `GET /api/search/interactions`

Search your notes. Returns each matching interaction with the person it is
about, the date, and the passage that matched. Local FTS5 only, no model is
called. See [Note Search](features/interaction-search.md).

```bash
curl "http://localhost:3210/api/search/interactions?q=who+discussed+hiring+last+month&tz=America/Los_Angeles"
```

**Query parameters** (all optional):

| Parameter   | Meaning                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `q`         | The question, up to 500 characters. A date phrase in it (`last month`, `since March`, `in 2025`, …) is lifted out and applied as a filter.             |
| `from`/`to` | A calendar date (`2026-08-01`, a whole day in `tz`) or an ISO instant. `from` is inclusive, `to` is exclusive. An explicit range overrides the phrase. |
| `type`      | Exact interaction type, for example `note` or `call`.                                                                                                  |
| `contactId` | Notes on one contact only.                                                                                                                             |
| `sort`      | `relevance` (default) or `date`.                                                                                                                       |
| `mode`      | `auto` (default: every word, then any word when nothing has every word), `all`, or `any`.                                                              |
| `limit`     | 1 to 50, default 20.                                                                                                                                   |
| `offset`    | 0 to 5000.                                                                                                                                             |
| `tz`        | Your IANA time zone, so `last month` is your month. Default `UTC`. An unknown zone is `400`.                                                           |

**Response:**

```json
{
  "query": {
    "text": "hiring",
    "tokens": ["hiring"],
    "mode": "all",
    "phrase": "last month",
    "range": {
      "from": "2026-08-01T07:00:00.000Z",
      "to": "2026-09-01T07:00:00.000Z",
      "source": "phrase"
    },
    "timeZone": "America/Los_Angeles"
  },
  "total": 1,
  "limit": 20,
  "offset": 0,
  "hits": [
    {
      "id": "3f2c…",
      "contactId": "9a84…",
      "type": "meeting",
      "title": "Coffee with Sam",
      "date": "2026-08-12T10:00:00.000Z",
      "excerpt": "We discussed hiring plans for the Berlin office.",
      "highlights": { "title": [], "excerpt": [[13, 19]] },
      "contact": {
        "id": "9a84…",
        "name": "Sam Rivera",
        "avatarUrl": null,
        "themeColor": "brand",
        "company": "Acme",
        "role": "CTO"
      }
    }
  ]
}
```

`query.mode` says how the words were combined, and `none` means the search
was a period or a kind with no words. `highlights` holds `[start, end]`
offsets into `title` and `excerpt`. Notes on archived, trashed, merged and
ghost contacts are not returned. A search with no words and no filter
answers with `total: 0`.

---

### `POST /api/search/synthesize`

Synthesize search results into an executive brief. Streams via NDJSON.
The body contains a query and 1 to 30 contact IDs. The server reads current, active contacts.
It rejects missing contacts with `409` and rejects malformed input with `400`.
It checks for concurrent edits before it returns the summary.

```bash
curl -X POST http://localhost:3210/api/search/synthesize \
  -H "Content-Type: application/json" \
  -H "Accept: application/x-ndjson" \
  -d '{"query":"fintech contacts","contactIds":["abc123","def456"]}'
```

---

### Search history

Search history stores every question asked by an account, across People, Notes, and Command Palette modes. Entries are deduplicated per mode and normalised query, tracking run count, pinned status, and the most recent result snapshot.

#### `GET /api/search/history`

List search history entries for the authenticated account, ordered newest first (`lastRunAt DESC, id DESC`). On the first request for an account with no history, legacy searches from user preferences are automatically backfilled.

**Query parameters** (all optional):

- `mode`: `"people" | "notes" | "palette"` filter.
- `q`: search filter matched against normalised query.
- `pinned`: `1` (or `true`) / `0` (or `false`) filter.
- `cursor`: base64 cursor (`lastRunAt|id`) from `nextCursor` of previous page.
- `limit`: page size (default 50, maximum 200).

**Response:**

```json
{
  "entries": [
    {
      "id": "c1f7…",
      "ownerId": "usr_…",
      "mode": "people",
      "query": "who likes coffee",
      "normalizedQuery": "who likes coffee",
      "resultCount": 5,
      "resultIds": ["cont_1", "cont_2"],
      "fallback": false,
      "pinned": false,
      "runCount": 1,
      "createdAt": "2026-09-17T12:00:00.000Z",
      "lastRunAt": "2026-09-17T12:00:00.000Z"
    }
  ],
  "nextCursor": "MjAyNi0wOS0xN1QxMjowMDowMC4wMDBafGMxZjflfg==",
  "total": 1
}
```

#### `POST /api/search/history`

Record a completed search question. Upserts on `(ownerId, mode, normalizedQuery)`: increments `runCount`, updates `lastRunAt` to the current timestamp, and replaces the result snapshot.

**Request body:**

- `query` (required string, 1 to 500 characters)
- `mode` (required `"people" | "notes" | "palette"`)
- `resultCount` (optional integer)
- `resultIds` (optional array of contact IDs, trimmed to at most 30 items)
- `fallback` (optional boolean)

**Response:** `{ "entry": HistoryEntry }`

#### `PATCH /api/search/history/:id`

Pin or unpin a search history entry. Returns 404 if the entry does not exist or belongs to another account.

**Request body:**

```json
{
  "pinned": true
}
```

**Response:** `{ "entry": HistoryEntry }`

#### `DELETE /api/search/history/:id`

Delete a single search history entry. Returns 404 if the entry does not exist or belongs to another account.

**Response:** `{ "success": true }`

#### `DELETE /api/search/history`

Clear search history for the authenticated account, optionally scoped to a single mode.

**Query parameters:**

- `mode` (optional `"people" | "notes" | "palette"`): when specified, deletes only entries in that mode. When omitted, deletes all entries for the account.

**Response:** `{ "deleted": 4 }`

---

## Contact enrichment (batch)

These routes power the Contact enrichment page in Settings. The routes keep
their `ai-search` path.

### `POST /api/ai-search`

Start a batch enrichment job for selected contacts.

**Request Body:**

```json
{
  "contactIds": ["abc123", "def456", "ghi789"],
  "strategy": "two-pass"
}
```

Strategy defaults to the provider-appropriate strategy if omitted.

Use 1 to 100 unique, nonempty contact IDs. Supported strategies are `two-pass`,
`single-pass`, and `searxng`. The server checks the selected strategy and every
contact before it creates a batch. Invalid input returns `400`. An unavailable
contact returns `409`. Missing provider configuration returns `503`.

```bash
curl -X POST http://localhost:3210/api/ai-search \
  -H "Content-Type: application/json" \
  -d '{"contactIds":["abc123","def456"]}'
```

**Response:**

```json
{
  "batchId": "batch-abc123",
  "jobCount": 2
}
```

---

### `GET /api/ai-search/status?batchId=`

Poll the current status of a batch enrichment job.

The batch status is `processing`, `complete`, or `cancelled`. Each job reports
`queued`, `searching`, `merging`, `success`, `error`, or `cancelled`.
A missing batch returns `404`. Batch progress lives in server memory and does
not survive a restart. Completed contact updates remain in the database.

```bash
curl "http://localhost:3210/api/ai-search/status?batchId=batch-abc123"
```

---

### `GET /api/ai-search/stream?batchId=`

Subscribe to real-time batch progress via Server-Sent Events (SSE).

The server validates the batch before it opens the stream. A missing batch
returns a JSON `404` response. The stream sends a heartbeat every 15 seconds
and closes when the batch completes or stops. The frontend also polls status
to recover from a lost stream.

```bash
curl -N "http://localhost:3210/api/ai-search/stream?batchId=batch-abc123"
```

```javascript
const eventSource = new EventSource(`/api/ai-search/stream?batchId=${batchId}`);
eventSource.onmessage = (event) => {
  const batch = JSON.parse(event.data);
  console.log(`Status: ${batch.status}, Jobs: ${batch.jobs.length}`);
  if (batch.status !== "processing") eventSource.close();
};
```

---

### `POST /api/ai-search/:batchId/cancel`

Stop an active batch. The response contains the current batch with status
`cancelled`. Queued jobs never start. Active jobs stop before the next step
or database write. Completed contact updates remain available.

```bash
curl -X POST http://localhost:3210/api/ai-search/batch-abc123/cancel
```

A missing batch returns `404`. Repeating cancellation returns the current
batch. Provider charges can still apply to requests it already accepted.

---

## Deduplication

### `POST /api/dedupe/scan`

Trigger a full deduplication scan. Streams progress via SSE.

**Request Body:**

```json
{
  "mode": "full"
}
```

Supported modes: `deterministic`, `ai`, `both`, `quick`, `deep`, `full`.

The scan merges pairs at or above the account's sensitivity preset
(`dedupePreset` in `GET /api/auth/preferences`), which is the same threshold
an import uses. An optional `autoMergeThreshold` between `0.85` and `0.99`
overrides it for this one scan.

```bash
curl -X POST http://localhost:3210/api/dedupe/scan \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"mode":"full"}'
```

---

### `GET /api/dedupe/suggestions`

Fetch pending dedupe clusters awaiting review.

```bash
curl http://localhost:3210/api/dedupe/suggestions
```

---

### `GET /api/dedupe/suggestions/count`

Get the count of pending suggestions (for badges).

```bash
curl http://localhost:3210/api/dedupe/suggestions/count
```

---

### `POST /api/dedupe/suggestions/:id/merge`

Merge a suggestion cluster.

**Request Body:**

```json
{
  "primaryId": "abc123"
}
```

```bash
curl -X POST http://localhost:3210/api/dedupe/suggestions/sug123/merge \
  -H "Content-Type: application/json" \
  -d '{"primaryId":"abc123"}'
```

---

### `POST /api/dedupe/suggestions/:id/dismiss`

Dismiss a suggestion (adds to exclusion list — won't be suggested again).

```bash
curl -X POST http://localhost:3210/api/dedupe/suggestions/sug123/dismiss
```

---

### `POST /api/contacts/merge`

Manual 2-contact merge.

```bash
curl -X POST http://localhost:3210/api/contacts/merge \
  -H "Content-Type: application/json" \
  -d '{"primaryId":"abc123","duplicateId":"def456"}'
```

---

### `POST /api/contacts/merge-cluster`

Merge an N-contact cluster.

```bash
curl -X POST http://localhost:3210/api/contacts/merge-cluster \
  -H "Content-Type: application/json" \
  -d '{"primaryId":"abc123","duplicateIds":["def456","ghi789"]}'
```

---

### `GET /api/dedupe/merge-log`

Fetch the audit trail of past merges.

```bash
curl http://localhost:3210/api/dedupe/merge-log
```

---

### `POST /api/dedupe/merge-log/:id/undo`

Undo a previous merge.

```bash
curl -X POST http://localhost:3210/api/dedupe/merge-log/ml123/undo
```

---

## Action Items

### `GET /api/action-items`

Fetch all pending (incomplete) action items.

```bash
curl http://localhost:3210/api/action-items
```

---

### `GET /api/action-items/completed`

Fetch completed action items.

```bash
curl http://localhost:3210/api/action-items/completed
```

---

### `GET /api/action-items/count`

Get count of urgent (due/overdue) action items (for badges).

```bash
curl http://localhost:3210/api/action-items/count
```

---

### `POST /api/contacts/:id/action-items`

Create an action item for a contact.

```bash
curl -X POST http://localhost:3210/api/contacts/abc123/action-items \
  -H "Content-Type: application/json" \
  -d '{"title":"Send follow-up email","dueAt":"2025-02-01T00:00:00Z"}'
```

---

### `GET /api/contacts/:id/action-items`

Fetch action items for a specific contact.

```bash
curl http://localhost:3210/api/contacts/abc123/action-items
```

---

### `PATCH /api/action-items/:id`

Update an action item.

```bash
curl -X PATCH http://localhost:3210/api/action-items/ai123 \
  -H "Content-Type: application/json" \
  -d '{"title":"Updated title","dueAt":"2025-02-15T00:00:00Z"}'
```

---

### `PATCH /api/action-items/:id/complete`

Mark an action item as complete.

```bash
curl -X PATCH http://localhost:3210/api/action-items/ai123/complete
```

---

### `DELETE /api/action-items/:id`

Delete an action item.

```bash
curl -X DELETE http://localhost:3210/api/action-items/ai123
```

---

## Dashboard

### `GET /api/dashboard`

Fetch the metrics for the Pulse page. Returns action items, ghosts, network metrics, at-risk contacts, recently added contacts, composition breakdowns, 30-day timelines, data hygiene counts (`missingCompany`, `missingLocation`, `missingEmail`, `stale`), upcoming meetings for the next 7 days, and correspondent count.

```bash
curl http://localhost:3210/api/dashboard
```

---

### `GET /api/dashboard/activity`

Fetch deterministic activity aggregates for the logged-in owner. Returns 84 days of activity ending today, 12 rolling week totals, 12 previous rolling week totals, interaction streak metrics, today's counts (logged, completed, due), and current week counts.

All calendar days, week starts, and streaks are computed in the server's local time.

```bash
curl http://localhost:3210/api/dashboard/activity
```

**Response shape:**

```json
{
  "days": [
    { "day": "2026-06-25", "count": 2, "byType": { "email": 1, "call": 1 } }
  ],
  "weekTotals": [12, 15, 8, 14, 20, 11, 16, 9, 13, 10, 18, 14],
  "prevWeekTotals": [10, 12, 7, 11, 15, 9, 14, 8, 12, 9, 15, 11],
  "streak": {
    "current": 4,
    "best": 12,
    "lastDay": "2026-09-17"
  },
  "today": {
    "logged": 2,
    "completed": 1,
    "due": 3
  },
  "thisWeek": {
    "logged": 8,
    "byType": { "email": 5, "call": 3 }
  }
}
```

---

### `GET /api/dashboard/momentum`

Fetch relationship score momentum and cadence monitoring for the logged-in owner. Returns `snapshotWeeks` count, `rising` contacts (score delta >= +3 over 4 weeks), `cooling` contacts (score delta <= -3 over 4 weeks), and `silent` contacts (contacts with an active cadence overdue for contact, excluding contacts already flagged at risk).

Rising and cooling require at least 4 recorded weekly snapshot weeks to evaluate.

```bash
curl http://localhost:3210/api/dashboard/momentum
```

**Response shape:**

```json
{
  "snapshotWeeks": 6,
  "rising": [
    {
      "id": "c1",
      "name": "Jane Smith",
      "company": "Acme Corp",
      "avatarUrl": null,
      "themeColor": "emerald",
      "relationshipScore": 82,
      "score": 82,
      "delta": 14
    }
  ],
  "cooling": [],
  "silent": [
    {
      "id": "c2",
      "name": "Bob Jones",
      "company": null,
      "avatarUrl": null,
      "themeColor": "sky",
      "relationshipScore": 65,
      "cadenceDays": 14,
      "daysSinceContact": 25,
      "overshootDays": 11
    }
  ]
}
```

---

### `GET /api/dashboard/insight`

Get AI-generated daily insight about your network.

```bash
curl http://localhost:3210/api/dashboard/insight
```

---

### `GET /api/command-palette/zero-state`

CRM intelligence signals for the Command Palette zero-state (action items due, at-risk contacts, ghosts, stale data, dedupe suggestions).

```bash
curl http://localhost:3210/api/command-palette/zero-state
```

**Response:**

```json
{
  "insights": [
    { "type": "action_items", "label": "3 action items due today", "count": 3 },
    {
      "type": "at_risk",
      "label": "Haven't contacted Sarah Chen in 45 days",
      "contact": { "id": "...", "name": "Sarah Chen" },
      "daysSince": 45
    },
    {
      "type": "ghost",
      "label": "John mentioned 5 times but not in contacts",
      "contact": { "id": "...", "name": "John" },
      "mentionCount": 5
    }
  ]
}
```

---

## Lists

### `GET /api/lists`

Fetch all lists with member counts.

```bash
curl http://localhost:3210/api/lists
```

---

### `POST /api/lists`

Create a new list.

```bash
curl -X POST http://localhost:3210/api/lists \
  -H "Content-Type: application/json" \
  -d '{"name":"Board Members","icon":"👥"}'
```

---

### `PATCH /api/lists/:id`

Update a list (name, icon).

```bash
curl -X PATCH http://localhost:3210/api/lists/list123 \
  -H "Content-Type: application/json" \
  -d '{"name":"Advisory Board","icon":"🎯"}'
```

---

### `DELETE /api/lists/:id`

Delete a list (members are unlinked, not deleted).

```bash
curl -X DELETE http://localhost:3210/api/lists/list123
```

---

### `PUT /api/lists/reorder`

Reorder lists via an ordered ID array.

```bash
curl -X PUT http://localhost:3210/api/lists/reorder \
  -H "Content-Type: application/json" \
  -d '{"orderedIds":["list2","list1","list3"]}'
```

---

### `GET /api/lists/:id/contacts`

Fetch contacts in a specific list.

```bash
curl http://localhost:3210/api/lists/list123/contacts
```

---

### `POST /api/lists/:id/members`

Add a contact to a list.

```bash
curl -X POST http://localhost:3210/api/lists/list123/members \
  -H "Content-Type: application/json" \
  -d '{"contactId":"abc123"}'
```

---

### `DELETE /api/lists/:id/members/:contactId`

Remove a contact from a list.

```bash
curl -X DELETE http://localhost:3210/api/lists/list123/members/abc123
```

---

### `POST /api/lists/:id/members/bulk`

Bulk add contacts to a list.

```bash
curl -X POST http://localhost:3210/api/lists/list123/members/bulk \
  -H "Content-Type: application/json" \
  -d '{"contactIds":["abc123","def456","ghi789"]}'
```

---

## AI Configuration

Backs **Settings → Administration → AI providers**. Capabilities are `quick`, `deep`, `embeddings`, and
`research`. See [Configuration](configuration.md#ai-configuration) for what each
one powers.

### `GET /api/settings/ai`

The full configuration view: connected providers (with redacted key previews),
built-in providers not yet configured, custom endpoints, every capability's
assignment plus what it currently resolves to, and the SearXNG URL.

```bash
curl http://localhost:3210/api/settings/ai
```

```json
{
  "providers": [
    {
      "id": "gemini",
      "label": "Google Gemini",
      "kind": "gemini",
      "source": "env",
      "keyPreview": "••••YJWY",
      "modelCount": 45,
      "supportsDiscovery": true,
      "supportsGrounding": true
    }
  ],
  "availableProviders": [{ "id": "openai", "label": "OpenAI" }],
  "customEndpoints": [],
  "capabilities": {
    "quick": {
      "assignment": { "mode": "auto" },
      "resolved": { "providerId": "gemini" }
    },
    "embeddings": { "assignment": { "mode": "auto" }, "resolved": null }
  },
  "searxngUrl": null
}
```

A raw API key is never returned — only `keyPreview`.

---

### `GET /api/settings/ai/models/:capability`

Models eligible for a capability, grouped by provider. Chat models for
`quick`/`deep`/`research`, embedding models for `embeddings`.

```bash
curl http://localhost:3210/api/settings/ai/models/deep
```

```json
{
  "groups": [
    {
      "providerId": "gemini",
      "providerLabel": "Google Gemini",
      "models": [
        {
          "id": "gemini-3.6-flash",
          "label": "Gemini 3.6 Flash",
          "capabilities": ["chat"],
          "capabilityConfidence": "declared"
        }
      ]
    }
  ]
}
```

`capabilityConfidence` is `declared` when the provider reports what a model can
do (Gemini, Anthropic) and `guessed` when it was inferred from the model name
(OpenAI and OpenAI-compatible servers return bare ids).

---

### `PUT /api/settings/ai/providers/:id/key`

Store an API key for a built-in provider (`gemini`, `openai`, `anthropic`) and
immediately validate it by discovering models. Returns `502 DISCOVERY_FAILED` if
the provider rejects the key — the key is still stored so it can be corrected.

```bash
curl -X PUT http://localhost:3210/api/settings/ai/providers/anthropic/key \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"sk-ant-..."}'
```

```json
{ "success": true, "modelCount": 11 }
```

Keys set via environment variable take precedence and cannot be overwritten here.

---

### `DELETE /api/settings/ai/providers/:id/key`

Remove a stored key. Environment-provided keys are unaffected.

---

### `POST /api/settings/ai/providers/:id/refresh-models`

Re-query a provider's model list, bypassing the 24-hour cache.

```json
{ "modelCount": 45, "fetchedAt": "2026-08-05T00:00:00.000Z" }
```

---

### `PUT /api/settings/ai/capabilities/:capability`

Assign a capability. `mode` is `auto`, `pinned`, or `disabled`; `pinned`
requires `providerId`. Assigning `embeddings` triggers a background vector-store
rebuild if the model's dimension differs.

```bash
curl -X PUT http://localhost:3210/api/settings/ai/capabilities/deep \
  -H "Content-Type: application/json" \
  -d '{"mode":"pinned","providerId":"anthropic","model":"claude-sonnet-5"}'
```

```json
{ "success": true, "view": { "...": "the full settings view" } }
```

---

### `PUT /api/settings/ai/endpoints`

Add or update a custom OpenAI-compatible endpoint (Ollama, vLLM, LM Studio,
llama.cpp, OpenRouter…). Validates connectivity by listing models; the endpoint
is stored even when that fails, so an offline server can be configured ahead of
time.

`baseUrl` must include the API prefix the server actually serves — `/v1` for
Ollama. The endpoint becomes the provider id `custom:<id>`, which is what the
other routes take: `POST /api/settings/ai/providers/custom:homelab/refresh-models`,
`{"providerId": "custom:homelab"}` when pinning a capability.

A capability left on `auto` resolves to the first **chat** model in the
discovered catalog. Until discovery finds one, the endpoint is skipped and the
capability reports itself unavailable rather than being called with no model.

```bash
curl -X PUT http://localhost:3210/api/settings/ai/endpoints \
  -H "Content-Type: application/json" \
  -d '{"id":"homelab","label":"Homelab Ollama","baseUrl":"http://alpha:11434/v1"}'
```

---

### `DELETE /api/settings/ai/endpoints/:id`

Remove a custom endpoint. Any capability pinned to it returns to `auto`, so a
removed endpoint cannot leave embeddings pointing at a provider that no longer
exists.

---

### `PUT /api/settings/ai/searxng`

Set the SearXNG base URL for self-hosted web research. An empty string clears it.

```bash
curl -X PUT http://localhost:3210/api/settings/ai/searxng \
  -H "Content-Type: application/json" \
  -d '{"url":"http://searxng.local:8080"}'
```

---

## AI Diagnostics

### `GET /api/ai/diagnostics`

Get AI model routing and quota diagnostics.

```bash
curl http://localhost:3210/api/ai/diagnostics
```

---

### `GET /api/ai/grounding-capacity`

Check the grounding RPD quota for contact enrichment (Gemini only).

```bash
curl http://localhost:3210/api/ai/grounding-capacity
```

---

## AI Stats

### `GET /api/ai/stats/summary`

Get aggregated AI usage statistics (token counts, cache performance, estimated costs).

```bash
curl http://localhost:3210/api/ai/stats/summary
```

---

### `GET /api/ai/stats/feed`

Get the AI invocation feed (paginated).

**Query Parameters:**

| Param    | Description                             |
| -------- | --------------------------------------- |
| `limit`  | Number of items to return (default: 50) |
| `offset` | Pagination offset                       |

```bash
curl "http://localhost:3210/api/ai/stats/feed?limit=20&offset=0"
```

---

## Utilities

### `GET /api/link-preview/unfurl?url=`

Extract OpenGraph metadata (title, image, description) from a URL using Cheerio HTML parsing. No headless browser required.

```bash
curl "http://localhost:3210/api/link-preview/unfurl?url=https://example.com"
```

---

### `GET /api/logos/:domain`

Fetch a company logo by domain. Proxies through Google S2 Favicons and caches locally for offline access.

```bash
curl http://localhost:3210/api/logos/stripe.com
```

Returns the image binary with appropriate content-type headers.

---

## MCP (Machine Interface)

Machine-readable interfaces for programmatic access and external LLM agents.

### `POST /api/mcp`

The official Model Context Protocol (MCP) server endpoint running Streamable HTTP transport. Accepts standard JSON-RPC 2.0 requests for tool calls, resources, and prompt execution.

**Authentication:** Requires `Authorization: Bearer ctk_...` (or legacy `API_TOKEN`). Gated by account scope; returns 401 when unauthenticated on gated instances.

**Rate Limiting:** 120 requests/minute per authenticated user (`429 RATE_LIMITED`).

**Headers:**

- `Accept: application/json, text/event-stream`
- `Content-Type: application/json`

**Methods:**

- `POST`: Supported.
- `GET` / `DELETE`: Returns `405 Method Not Allowed` with `Allow: POST`.

```bash
curl -X POST http://localhost:3210/api/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

See [MCP Feature Guide](features/mcp.md) for full tool, prompt, and resource specifications.

---

### Legacy REST Endpoints

The following REST endpoints are preserved for backward compatibility and scripting. For LLM agents, use `POST /api/mcp` above.

### `GET /api/query/contacts`

Query contacts with filter parameters.

```bash
curl "http://localhost:3210/api/query/contacts?q=engineer&limit=10"
```

---

### `GET /api/contacts/action-items`

Fetch action items across all contacts.

```bash
curl http://localhost:3210/api/contacts/action-items
```

---

### `GET /api/tags`

Get all unique tags as an array of strings.

```bash
curl http://localhost:3210/api/tags
```

---

### `GET /api/tags/summary`

Get all tags with contact counts for the active account. Ordered by contact count descending, then tag ascending.

```bash
curl http://localhost:3210/api/tags/summary
```

```json
{
  "tags": [
    { "tag": "investor", "count": 14 },
    { "tag": "founder", "count": 8 },
    { "tag": "advisor", "count": 3 }
  ]
}
```

---

### `PATCH /api/tags/:tag`

Rename a tag across all contacts owned by the caller in a single transaction.

```bash
curl -X PATCH http://localhost:3210/api/tags/investor \
  -H "Content-Type: application/json" \
  -d '{"newTag":"vc"}'
```

```json
{
  "updated": 14
}
```

If a contact already has the target tag, the old tag is removed to avoid duplicates.

---

### `DELETE /api/tags/:tag`

Remove a tag from all contacts owned by the caller in a single transaction.

```bash
curl -X DELETE http://localhost:3210/api/tags/investor
```

```json
{
  "deleted": 14
}
```

---

### `GET /api/industries`

Get all unique industries.

```bash
curl http://localhost:3210/api/industries
```

---

### `GET /api/interactions/search`

Search your notes, for an MCP client or a personal token. The same engine and
the same query parameters as [`GET /api/search/interactions`](#get-apisearchinteractions),
answered as a plain array of hits. Each hit also carries `contactName`.

```bash
curl "http://localhost:3210/api/interactions/search?q=proposal&from=2026-08-01&to=2026-08-31"
```

In 1.x this route matched `q` as a substring of the title or body and returned
raw rows. It now matches by word and stem, applies date phrases and filters,
returns a plain-text `excerpt` rather than the HTML `content`, and hides notes
on contacts the app hides.

---

### `GET /api/timeline`

Fetch the global timeline (all interactions across all contacts).

```bash
curl http://localhost:3210/api/timeline
```

---

## Connectors

Background data connectors that sync interactions, meetings, and contacts from external services. Mutations require an interactive session cookie (`403 SESSION_REQUIRED`).

### `GET /api/connectors/kinds`

Lists connector adapters available on this server and platform.

```bash
curl http://localhost:3210/api/connectors/kinds
```

```json
{
  "kinds": [
    {
      "kind": "ics",
      "label": "Calendar",
      "description": "Sync meetings and see what is coming up from a private ICS URL.",
      "capabilities": { "schedule": true }
    }
  ]
}
```

### `GET /api/connectors`

Returns all configured connectors for the authenticated account.

```bash
curl http://localhost:3210/api/connectors
```

### `POST /api/connectors` _(session)_

Creates and configures a new connector.

**Body:**

```json
{
  "kind": "ics",
  "name": "Work Calendar",
  "config": {
    "url": "https://calendar.google.com/calendar/ical/.../basic.ics",
    "lookbackDays": 90,
    "maxAttendees": 25,
    "includeDescription": false
  },
  "intervalMinutes": 30
}
```

### `POST /api/connectors/test` _(session)_

Validates credentials or feed connectivity without saving.

**Body:**

```json
{
  "kind": "ics",
  "config": {
    "url": "https://calendar.google.com/calendar/ical/.../basic.ics"
  }
}
```

### `GET /api/connectors/:id`

Retrieves connector configuration, status, and recent sync runs. Stored secrets are stripped.

### `PATCH /api/connectors/:id` _(session)_

Updates connector name, configuration, secret, status, or schedule interval.

### `DELETE /api/connectors/:id` _(session)_

Deletes a connector. Optional JSON body `{ "deleteImported": true }` purges all interactions and ghost contacts generated by this connector.

### `POST /api/connectors/:id/sync`

Triggers an immediate manual sync run. When `DISABLE_BACKGROUND_JOBS=true`, runs inline and returns HTTP `202` upon completion.

### `GET /api/connectors/:id/runs`

Retrieves sync run history for a connector (up to `limit=100`, default 20).

### `GET /api/connectors/correspondents`

Lists external contacts seen across connector feeds who do not match an existing contact in the caller's network.

---

## Authentication

Every endpoint under `/api/auth` is mounted **before** the auth gate, so it stays reachable to a caller with no credential. Endpoints marked _(account)_ additionally require a signed-in session — a bearer token is not enough, because a token proves which account it belongs to but not that a person is present (`403 SESSION_REQUIRED`).

### `GET /api/auth/status`

Always reachable. One round trip for everything the client needs to pick a screen.

```bash
curl http://localhost:3210/api/auth/status
# → { "authRequired": true, "authenticated": false, "setupRequired": true,
#     "hasAccounts": false, "user": null, "registrationOpen": false,
#     "localOwnerPresent": false, "legacyTokenConfigured": false,
#     "deviceContacts": 0, "existingContacts": 0,
#     "map": { "light": "https://tiles.openfreemap.org/styles/positron",
#              "dark": "https://tiles.openfreemap.org/styles/dark" } }
```

`setupRequired` is true only on a gated instance with no accounts.
`registrationOpen` says whether the sign-in screen should offer to create an
account. `localOwnerPresent` is true while the instance has never been
secured. `legacyTokenConfigured` is true while the deprecated environment
`API_TOKEN` is set. `existingContacts` is the old name for `deviceContacts`
and is removed in 3.0. `mailConfigured` indicates whether outgoing SMTP mail is
available. `magicLinkSignIn` is true only when passwordless magic-link sign-in is
both enabled in instance settings and outgoing mail is configured.

`map` names the basemap style the map loads in each palette, from
`MAP_STYLE_LIGHT` and `MAP_STYLE_DARK`. It rides on this endpoint because the
map must know the style before anyone signs in, and because the production CSP
allows the origin of each of these two URLs. One source answers both, so the
style the browser asks for is always an origin the header allows.

---

### `POST /api/auth/setup`

Create the first account. Returns `409 SETUP_COMPLETE` once any account exists, so this is not a standing registration endpoint. The new account is an admin, is signed in immediately, and claims every unowned row in the database.

```bash
curl -X POST http://localhost:3210/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","username":"you","password":"a long passphrase","displayName":"You"}'
```

Rate limited to 5/minute per IP.

---

### `POST /api/auth/login`

Exchange credentials for an HttpOnly `SameSite=Strict` session cookie. `identifier` accepts either the username or the email.

```bash
curl -X POST http://localhost:3210/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier": "you", "password": "a long passphrase"}'
```

Returns `401 INVALID_CREDENTIALS` for both a wrong password and an unknown account — the two are deliberately indistinguishable. Rate limited to 10/minute per IP.

`POST /api/auth/logout` destroys the session server-side and clears the cookie.

---

### `GET /api/auth/me` _(account)_

The signed-in account. `PATCH /api/auth/me` updates `displayName`, `username`, or `email`; omitted fields are left alone. Profile photos are uploaded via `POST /api/auth/me/avatar` and removed via `DELETE /api/auth/me/avatar`.

---

### `GET /api/auth/preferences` _(account)_

Every per-account preference, with defaults filling anything the account has
not chosen, plus `stored`: the keys it actually chose. `PATCH` writes any
subset and returns the whole set again.

```bash
curl -b cookies.txt http://localhost:3210/api/auth/preferences
curl -X PATCH http://localhost:3210/api/auth/preferences \
  -H "Content-Type: application/json" -b cookies.txt \
  -d '{"theme": "dark", "accent": "#b45309"}'
```

```json
{
  "preferences": {
    "theme": "system",
    "accent": "#006a91",
    "listDensity": "comfortable",
    "recentLimit": 3,
    "dedupePreset": "default",
    "tempUnit": "celsius",
    "searchHistory": []
  },
  "stored": []
}
```

A key the server does not know refuses the whole request with `400`, rather
than being stripped: a client asking for `colorScheme` instead of `theme`
should be told, not quietly ignored. `theme` is `light`, `dark` or `system`;
`accent` is a six-digit hex colour, from which the primary and container
tokens are derived; `searchHistory` holds at most twenty entries of
`{ query, mode, timestamp }`.

These three are the only routes under `/api/auth` that a personal token can
reach, and the only ones that work on an instance with sign-in switched off —
which runs as the local owner, who has no session to require.

---

### `DELETE /api/auth/preferences/:key` _(account)_

Resets a single preference to its default value by removing it from the user's stored preferences. Returns the updated `{ preferences, stored }` object, identical to `GET`. Returns `404` if the key is unknown to the server.

```bash
curl -X DELETE http://localhost:3210/api/auth/preferences/theme -b cookies.txt
```

---

### `POST /api/auth/change-password` _(account)_

```bash
curl -X POST http://localhost:3210/api/auth/change-password \
  -H "Content-Type: application/json" -b cookies.txt \
  -d '{"currentPassword": "old one", "newPassword": "a new long passphrase"}'
```

Ends every session except the one making the request.

---

### `GET /api/auth/sessions` _(account)_

Live sessions for this account, newest first, with `current: true` on the one making the request. Each row carries `id`, `createdAt`, `lastSeenAt`, `expiresAt`, `ip`, `userAgent`, `current`, and `method` (`"password"`, `"passkey"`, or `null`). `DELETE /api/auth/sessions` revokes all the others and returns `{ "revoked": n }`.

---

### `POST /api/auth/register`

Create an account without an invitation. Answers `403 REGISTRATION_CLOSED` unless an admin has turned registration on through `PUT /api/admin/settings`. The account is always a member, and is signed in immediately. Rate limited to 10/minute per IP.

---

### `POST /api/auth/accept-invitation`

Turn an invitation link into an account. The `token` is the query parameter from the link an admin sent. The account takes the role the invitation carried and is signed in immediately.

```bash
curl -X POST http://localhost:3210/api/auth/accept-invitation \
  -H "Content-Type: application/json" \
  -d '{"token":"…","email":"you@example.com","username":"you","password":"a long passphrase"}'
```

`404` for a token that is unknown, malformed or empty, with one body for all three. `410 INVITATION_USED`, `410 INVITATION_EXPIRED` or `410 INVITATION_REVOKED` for a link that is real but dead. Rate limited to 10/minute per IP.

---

### `POST /api/auth/passkeys/register/options` _(account)_

Generate WebAuthn creation options for registering a new passkey. The account must have a live session (a bearer token returns `403 SESSION_REQUIRED`). If the account has a temporary password, returns `403 PASSWORD_CHANGE_REQUIRED`. Returns `{ ceremonyId, options }`. Challenges expire in 5 minutes.

---

### `POST /api/auth/passkeys/register/verify` _(account)_

Verify a WebAuthn creation ceremony and store the passkey. Request body: `{ ceremonyId, name?, response }`. On success, stores the credential and returns `201 { passkey }`.

---

### `GET /api/auth/passkeys` _(account)_

List all registered passkeys for the signed-in account, and whether the post-creation nudge was dismissed. Returns `{ passkeys: PasskeySummary[], nudgeDismissed: boolean }`.

---

### `PATCH /api/auth/passkeys/:id` _(account)_

Rename an existing passkey. Request body: `{ name: string }`. Returns `{ passkey: PasskeySummary }`. Returns `404` if the passkey does not exist or belongs to another account.

---

### `DELETE /api/auth/passkeys/:id` _(account)_

Remove an existing passkey. Returns `{ ok: true }`. Returns `404` if the passkey does not exist or belongs to another account.

---

### `POST /api/auth/passkeys/login/options`

Generate WebAuthn request options for signing in with a passkey. Publicly reachable. Returns `{ ceremonyId, options }` with `allowCredentials: []` to permit resident passkeys. Rate limited to 10/minute per IP.

---

### `POST /api/auth/passkeys/login/verify`

Verify a passkey authentication assertion response and issue a session cookie. Request body: `{ ceremonyId, remember?, response }`. The session is stamped with `method: "passkey"`. Rate limited to 10/minute per IP.

---

### `POST /api/auth/passkey-nudge/dismiss` _(account)_

Dismiss the first-run passkey nudge for the signed-in account. Stores `{ dismissed: true }` in `user_settings` under `auth.passkeyNudge`. Returns `{ ok: true }`.

---

### `POST /api/auth/password-reset/request`

Request a password reset link by email.

```bash
curl -X POST http://localhost:3210/api/auth/password-reset/request \
  -H "Content-Type: application/json" \
  -d '{"email":"alex@example.com"}'
# → 202 {}
```

Always answers `202 {}`, preventing account enumeration. When outgoing mail is configured and the email belongs to an active account, creates a hashed single-use token valid for 1 hour and sends an email. Subject to an hourly limit of 3 link creations per account. Rate limited to 3 requests per 15 minutes per IP (`linkLimiter`).

---

### `POST /api/auth/password-reset/complete`

Complete a password reset with a one-time token.

```bash
curl -X POST http://localhost:3210/api/auth/password-reset/complete \
  -H "Content-Type: application/json" \
  -d '{"token":"...","password":"correct horse battery staple"}'
# → 200 { "user": { ... } } (plus Set-Cookie for session)
```

Redeems the token, validates the new password, updates the password hash, clears `mustChangePassword`, revokes all other active sessions, establishes a new session with method `"email-link"`, sets the session cookie, and records the `auth.password.reset` audit event. Rate limited by `credentialLimiter` (10 per minute per IP).

**Error codes:** `400` (missing token or password, or password fails validation), `404 LINK_INVALID`, `410 LINK_EXPIRED`, `410 LINK_USED`.

---

### `POST /api/auth/magic-link/request`

Request a passwordless sign-in link by email.

```bash
curl -X POST http://localhost:3210/api/auth/magic-link/request \
  -H "Content-Type: application/json" \
  -d '{"email":"alex@example.com"}'
# → 202 {}
```

Answers `404 MAGIC_LINK_OFF` when `auth.magicLinkSignIn` is not enabled or outgoing mail is not configured. When enabled, always answers `202 {}`. If the email belongs to an active account, creates a hashed single-use token valid for 15 minutes and emails the sign-in link. Subject to an hourly limit of 3 link creations per account. Rate limited to 3 requests per 15 minutes per IP (`linkLimiter`).

---

### `POST /api/auth/magic-link/complete`

Complete magic link sign-in using a one-time token.

```bash
curl -X POST http://localhost:3210/api/auth/magic-link/complete \
  -H "Content-Type: application/json" \
  -d '{"token":"..."}'
# → 200 { "user": { ... } } (plus Set-Cookie for session)
```

Redeems the token, creates a new session with method `"email-link"`, sets the session cookie, and records audit actions `auth.login.success` (`details.method: "magic-link"`) and `auth.magic_link.used`. Rate limited by `credentialLimiter` (10 per minute per IP).

**Error codes:** `400` (missing token), `404 LINK_INVALID`, `410 LINK_EXPIRED`, `410 LINK_USED`.

---

### `GET /api/auth/tokens` _(account)_

The personal tokens this account holds, newest first. Each row carries `tokenPrefix` (the first 12 characters, enough to tell two apart), `lastUsedAt`, `expiresAt` and `revokedAt`. The token itself is never returned again.

---

### `POST /api/auth/tokens` _(account)_

Mint a personal token. The plaintext is in this response and nowhere else — the database holds only its SHA-256.

```bash
curl -X POST http://localhost:3210/api/auth/tokens \
  -H "Content-Type: application/json" -b cookies.txt \
  -d '{"name":"My laptop MCP client","expiresInDays":365}'
# → { "id":"…", "name":"My laptop MCP client", "token":"ctk_…",
#     "tokenPrefix":"ctk_AbCdEfG", "expiresAt":"…" }
```

Use it as `Authorization: Bearer ctk_…`. It acts as its own account for every scoped endpoint and reaches no `_(account)_` route, so a script cannot mint a second token or change the password that would revoke it. Limited to 10 per hour per account.

---

### `DELETE /api/auth/tokens/:id` _(account)_

Revoke one of your own tokens. `404` for a token belonging to somebody else. The row stays, with `revokedAt` set, so the list still explains why a script stopped working.

---

## Administration

Every route under `/api/admin` needs an account with the `admin` role and answers `403 ADMIN_REQUIRED` otherwise.

| Method | Path                                  | What it does                                                              |
| ------ | ------------------------------------- | ------------------------------------------------------------------------- |
| GET    | `/api/admin/users`                    | Every account, with contact, session and token counts                     |
| POST   | `/api/admin/users`                    | Create an account. Returns a one-time temporary password                  |
| GET    | `/api/admin/users/:id`                | One account plus what it owns                                             |
| PATCH  | `/api/admin/users/:id`                | Change a role or a display name                                           |
| POST   | `/api/admin/users/:id/reset-password` | New temporary password. Revokes every session and token                   |
| POST   | `/api/admin/users/:id/reset-link`     | Send 24-hour reset link by email (requires outgoing mail)                 |
| POST   | `/api/admin/users/:id/disable`        | Reversible. Ends sessions, refuses tokens                                 |
| POST   | `/api/admin/users/:id/enable`         | Gives the tokens back, not the sessions                                   |
| GET    | `/api/admin/users/:id/export`         | That account's data, for offboarding. Audit-logged                        |
| DELETE | `/api/admin/users/:id`                | Two steps: `409 USER_HAS_DATA` with counts, then `{"decision":"purge"}`   |
| GET    | `/api/admin/invitations`              | Every invitation with its derived status                                  |
| POST   | `/api/admin/invitations`              | Returns a one-time link, optionally sends it by email                     |
| DELETE | `/api/admin/invitations/:id`          | Revoke a pending invitation                                               |
| GET    | `/api/admin/settings`                 | `registrationOpen`, `sessionTtlDays`, `instanceName`, lifecycle settings  |
| PUT    | `/api/admin/settings`                 | Update settings (refuses env-locked keys: `409 SET_BY_ENVIRONMENT`)       |
| GET    | `/api/admin/integrations`             | Mapbox and SearXNG status without secrets (`configured`, `source`, `url`) |
| PUT    | `/api/admin/integrations`             | Update Mapbox key / SearXNG URL (password current; env-locked: `409`)     |
| GET    | `/api/admin/audit`                    | Every administrative action, newest first                                 |
| GET    | `/api/admin/mail`                     | Outgoing mail status and configuration without secrets                    |
| PUT    | `/api/admin/mail`                     | Save SMTP configuration (seals password with secretBox)                   |
| DELETE | `/api/admin/mail`                     | Clear stored SMTP configuration                                           |
| POST   | `/api/admin/mail/test`                | Send a test email to verify SMTP delivery (5/10m rate limit)              |

Three guards protect the instance, in this order: the local account that owns
an unsecured instance's data cannot be disabled or deleted
(`409 LOCAL_OWNER_PROTECTED`), the last active admin cannot be demoted,
disabled or deleted (`409 LAST_ADMIN`), and no admin may disable or delete
their own account (`400 CANNOT_TARGET_SELF`).

`GET /api/admin/audit?limit=&before=` pages newest first. `before` is the
opaque cursor a previous page returned as `nextBefore`.

`GET` and `PUT /api/admin/settings` carry `instanceName` and
`instanceNameMax`. The name is 60 characters or fewer, trimmed, with control
characters replaced by spaces; an empty string clears it. It is reported
read-only by `GET /api/auth/status`, which is unauthenticated, because the
sign-in and join screens are where it matters and neither has a credential
yet. Added by extra F3.

An account created or reset by an admin holds a password that admin chose, so
every route outside the six the sign-in flow needs answers
`403 PASSWORD_CHANGE_REQUIRED` until the person replaces it.

### `GET /api/admin/integrations`

Admin only. Read current configuration status and sources for third-party integrations (Mapbox geocoding and SearXNG search). Never returns raw or sealed API keys.

```bash
curl http://localhost:3210/api/admin/integrations
# → 200 { "mapbox": { "configured": true, "source": "setting" }, "searxng": { "url": "http://searxng.local:8080", "source": "setting" } }
```

### `PUT /api/admin/integrations`

Admin only. Requires a current non-temporary password (`requirePasswordCurrent`). Store or clear integration settings. Mapbox keys are sealed using AES-256-GCM (`secretBox`). An empty string clears the setting. Answers `409 SET_BY_ENVIRONMENT` if the key or URL is locked by environment variables.

```bash
curl -X PUT http://localhost:3210/api/admin/integrations \
  -H "Content-Type: application/json" \
  -d '{ "mapboxKey": "pk.ey...", "searxngUrl": "http://searxng.local:8080" }'
```

### `POST /api/admin/users/:id/reset-link`

Admin only. Send a 24-hour password reset link to a user's email address.

```bash
curl -X POST http://localhost:3210/api/admin/users/usr_12345/reset-link
# → 200 { "sentTo": "user@example.com", "expiresAt": "2026-09-19T18:00:00.000Z" }
```

Answers `409 MAIL_NOT_CONFIGURED` if outgoing mail is not configured. When mail is available, creates a 24-hour reset token, emails the link to the user, and logs the `user.password.reset` audit event (`details.via: "email"`).

### `POST /api/admin/invitations`

Admin only. Create an invitation to join the instance.

```bash
curl -X POST http://localhost:3210/api/admin/invitations \
  -H "Content-Type: application/json" \
  -d '{ "email": "colleague@example.com", "role": "member", "expiresInDays": 7, "send": true }'
```

- Request body fields:
  - `email` (string, optional): Email hint for the recipient
  - `role` (`"member"` | `"admin"`, default `"member"`)
  - `expiresInDays` (number, default 7)
  - `send` (boolean, optional, default `false`): When `true` and outgoing mail is configured, dispatches an email containing the invitation link to `email`.
- Response:
  ```json
  {
    "id": "inv_12345",
    "link": "http://localhost:3210/accept-invitation?token=...",
    "expiresAt": "2026-09-24T18:00:00.000Z",
    "sent": true
  }
  ```
  `sent` indicates whether the email was successfully sent. If mail was unconfigured or delivery failed, `sent` is `false` and the admin can copy the link manually.

### `GET /api/admin/mail`

Admin only. Returns the current outgoing mail configuration without secrets.

```bash
curl http://localhost:3210/api/admin/mail
```

```json
{
  "source": "settings",
  "host": "smtp.example.com",
  "port": 587,
  "secure": false,
  "user": "smtp-user",
  "from": "noreply@example.com",
  "replyTo": "support@example.com",
  "hasPassword": true
}
```

`source` is `"env"` (configured via `SMTP_URL`), `"settings"` (configured in database), or `"none"`. Passwords are never returned in this response.

### `PUT /api/admin/mail`

Admin only. Save SMTP settings to the database. Encrypts the password with AES-256-GCM via `secretBox`. Returns `409 MAIL_CONFIGURED_BY_ENV` if `SMTP_URL` is configured in the environment.

```bash
curl -X PUT http://localhost:3210/api/admin/mail \
  -H "Content-Type: application/json" \
  -d '{
    "host": "smtp.example.com",
    "port": 587,
    "secure": false,
    "user": "smtp-user",
    "password": "secret-password",
    "from": "noreply@example.com",
    "replyTo": "support@example.com"
  }'
```

Omitting or leaving `password` blank when `hasPassword` is `true` preserves the existing sealed password.

### `DELETE /api/admin/mail`

Admin only. Removes stored SMTP configuration from the database. Answers `409 MAIL_CONFIGURED_BY_ENV` if `SMTP_URL` is set in the environment.

```bash
curl -X DELETE http://localhost:3210/api/admin/mail
```

```json
{ "deleted": true }
```

### `POST /api/admin/mail/test`

Admin only. Sends a test email to verify SMTP delivery. Rate-limited to 5 requests per 10 minutes per account (`429 RATE_LIMITED`).

```bash
curl -X POST http://localhost:3210/api/admin/mail/test \
  -H "Content-Type: application/json" \
  -d '{ "to": "admin@example.com" }'
```

```json
{ "sent": true, "to": "admin@example.com" }
```

If omitted, `to` defaults to the calling administrator's email address. Returns `502 MAIL_SEND_FAILED` with connection or authentication diagnostics if SMTP delivery fails.

### `GET /api/admin/health`

Admin only. Everything this instance can say about itself. Read only, safe to
poll, and deliberately separate from `GET /healthz`, which anybody who can
reach the port may ask and which therefore stays two states and no detail.

```bash
curl http://localhost:3210/api/admin/health
```

```json
{
  "uptimeSeconds": 93142,
  "startedAt": "2026-09-09T18:02:11.004Z",
  "schema": {
    "tenancy": 2,
    "tenancyExpected": 2,
    "fts": 3,
    "ftsExpected": 3,
    "vec": "v0.1.9",
    "upToDate": true
  },
  "database": {
    "bytes": 18452480,
    "walBytes": 1204224,
    "truncateAtBytes": 67108864,
    "lastCheckpoint": {
      "at": "…",
      "mode": "passive",
      "busy": false,
      "logPages": 294,
      "checkpointedPages": 294,
      "bytesBefore": 1204224,
      "bytesAfter": 1204224
    },
    "busyErrors": 0,
    "lastBusyErrorAt": null,
    "rows": { "contacts": 431, "users": 3, "…": 0 }
  },
  "backup": {
    "filename": "…",
    "sizeBytes": 0,
    "createdAt": "…",
    "verification": {}
  },
  "queues": {
    "dedupe": { "running": { "id": "…", "username": "maya" }, "pending": [] },
    "aiSearch": { "running": null, "activeBatches": 0, "contactsRemaining": 0 }
  },
  "embeddings": {
    "available": true,
    "byUser": [
      {
        "user": { "id": "…", "username": "maya" },
        "contacts": 431,
        "embedded": 431
      }
    ]
  },
  "aiCache": {
    "briefing": { "entries": 12, "hits": 40, "misses": 8, "hitRate": 0.83 }
  },
  "provider": {
    "aiTier": "FREE",
    "circuitBreakers": [],
    "grounding": { "rpd": 12, "limit": 500, "remaining": 488 }
  }
}
```

- `schema.upToDate` is false while a migration has not finished, which
  explains a great many other symptoms.
- `queues` names the account each job is running for, and who is waiting
  behind the dedupe scan. "A scan is running" is not something an operator can
  act on when several people share an instance.
- `embeddings.byUser` is two numbers rather than a percentage, because the
  useful question is which account has contacts search cannot reach yet.
- `database.busyErrors` counts requests refused with `503 DB_BUSY` since the
  process started. `startedAt` is the window those counts cover.
- **No secrets.** No key, no token, no invitation link, no contact of
  anybody's. The most identifying value is a username beside a queue position,
  and the caller can already list every account.

---

## Trash (Undoable Deletes)

`DELETE /api/contacts/:id` and `POST /api/contacts/bulk-delete` are **soft deletes** — contacts move to the trash and are hard-deleted after `TRASH_RETENTION_DAYS` (default 30).

### `GET /api/trash`

```bash
curl http://localhost:3210/api/trash
# → { "items": [{ "id", "name", "company", "avatarUrl", "deletedAt" }], "retentionDays": 30 }
```

### `POST /api/trash/:id/restore`

Restore a trashed contact to the active list (re-indexes search and embeddings). Returns the hydrated contact; `404` if the contact isn't in the trash.

### `DELETE /api/trash/:id`

"Delete forever" — immediately hard-deletes a trashed contact and its entire history. Refuses (`404`) for contacts that are not in the trash.

---

## Backups

SQLite snapshots (online backup API — safe while the app runs) written to `DATA_DIR/backups/`, rotated to the `BACKUP_KEEP` most recent. A schedule runs every `BACKUP_INTERVAL_HOURS` (default 24).

### `GET /api/backups`

Admin only. A snapshot is the whole database, so it holds every account's rows.

```bash
curl http://localhost:3210/api/backups
# → { "backups": [{ "filename", "sizeBytes", "createdAt", "verification" }] }
```

Every snapshot is opened again as soon as it is written: read only, through
`PRAGMA quick_check`, and counted against the live database. `verification`
carries the answer.

```json
{
  "ok": true,
  "checkedAt": "2026-09-10T18:04:11.204Z",
  "integrity": "ok",
  "rows": { "contacts": 431, "users": 3, "interactions": 1904 },
  "liveRows": { "contacts": 431, "users": 3, "interactions": 1904 }
}
```

- `ok` is false when the file does not open, when `quick_check` reports
  damage, when a counted table is missing, or when a table that has rows in
  the live database has none in the snapshot. The last is the one an integrity
  check cannot see: a sound, readable snapshot that restores nothing.
- `problem` is present only when `ok` is false and says which of those it was.
- `rows` and `liveRows` cover the eight owned tables and `users`.
- `verification` is `null` for a snapshot taken before 2.0. That is not a
  failed check and is shown differently.

### `POST /api/backups`

Admin only. Take a snapshot now. Returns `201` with the new backup's metadata,
including its `verification`. A snapshot that fails verification is still
written and still returned: the file may be salvageable, and deleting the
evidence helps nobody.

---

## Export

### `GET /api/export/json`

Downloads the entire database — contacts (hydrated), interactions, lists, action items, and the merge audit log — as a single JSON attachment.

### `GET /api/export/csv`

Downloads a flat, RFC-4180-escaped CSV of all non-trashed contacts.

```bash
curl -OJ http://localhost:3210/api/export/csv
```

### `GET /api/export/vcard`

Downloads the caller's contacts as a vCard 3.0 `.vcf` — the format Apple
Contacts, Google Contacts, Outlook and every phone import. Trashed contacts
and ghosts are left out: one is a contact the person deleted, and the other
is a name pulled out of a note with no card to write.

```bash
curl -OJ http://localhost:3210/api/export/vcard
```

The same module writes this file and parses one dropped on the import modal,
so a file exported from Contrack and imported back into it is the same
contacts rather than nearly.

---

## Additional Endpoints

Smaller surfaces, documented compactly. Shapes follow the conventions above.

| Endpoint                                    | What it does                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /api/contacts/:id/score`               | The contact's relationship-score breakdown (the five signals behind the number)        |
| `GET /api/contacts/:id/relationships`       | The contact's @mention relationship graph                                              |
| `GET /api/avatar/:style`                    | Generated avatar SVG for a style + seed (query `seed=`, `bg=1`, `theme=light\|dark`)   |
| `POST /api/contacts/merge-batch`            | Merge many independent pairs in one call                                               |
| `POST /api/contacts/merge-clusters`         | Merge many clusters in one call (auto-merge flow)                                      |
| `GET /api/dedupe/stream`                    | SSE progress stream for a running scan (query `scanId=`)                               |
| `GET /api/dedupe/active`                    | The in-progress scan, if any (page-refresh recovery)                                   |
| `GET /api/dedupe/status`                    | Status of a scan by id (query `scanId=`)                                               |
| `GET /api/dedupe/suggestion-for/:contactId` | Pending duplicate suggestion involving a contact                                       |
| `POST /api/dedupe/backfill-embeddings`      | Kick off dedupe-embedding backfill (rate-limited)                                      |
| `GET /api/dedupe/embedding-status`          | Embedding coverage for the dedupe index                                                |
| `POST /api/trash/bulk-restore`              | Restore many trashed contacts (`{"ids": [...]}`)                                       |
| `GET /api/auth/session-policy`              | Current session lifetime in days _(account session required)_                          |
| `PUT /api/auth/session-policy`              | Set session lifetime, 1–365 days; applies to new sign-ins _(account session required)_ |

---

## Debug (Dev Only)

### `GET /api/debug/cache-stats`

Exposes hit/miss counters for all aiCache tiers. Only available when `NODE_ENV !== production`.

```bash
curl http://localhost:3210/api/debug/cache-stats
```
