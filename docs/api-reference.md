# API Reference

All endpoints are prefixed with `/api`. Request and response bodies are `application/json` unless noted otherwise. The server runs on `http://localhost:3210` by default.

**Authentication:** off by default locally. When `AUTH_TOKEN` / `AUTH_REQUIRED` is configured (Docker default), every `/api` and `/uploads` request needs `Authorization: Bearer <token>` or the session cookie set by `POST /api/auth/login`. See [Configuration](configuration.md#authentication--remote-access).

**Rate limits:** endpoints that trigger billable AI calls or outbound fetches are limited to 60 requests/minute per client IP (`429 RATE_LIMITED`).

---

## Contacts

### `GET /api/contacts`

Fetch all active (non-archived, non-ghost, non-merged) contacts.

**Query Parameters:**

| Param  | Description                                                                       |
| ------ | --------------------------------------------------------------------------------- |
| `q`    | FTS5 full-text search query                                                       |
| `view` | Set to `slim` for lightweight response (id, name, company, avatarUrl, themeColor) |

```bash
# All contacts
curl http://localhost:3210/api/contacts

# FTS5 search
curl "http://localhost:3210/api/contacts?q=engineer"

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

Fetch geocoded contacts for the map view (only those with lat/lng coordinates).

```bash
curl http://localhost:3210/api/contacts/map
```

---

### `POST /api/contacts/:id/avatar`

Upload an avatar image. Uses `multipart/form-data`.

```bash
curl -X POST http://localhost:3210/api/contacts/abc123/avatar \
  -F "avatar=@photo.jpg"
```

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

**Error codes:** `429` (grounding quota exhausted), `503` (AI not configured).

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

Phase 1 (instant retrieval <15ms): returns matches with `aiReason: null`.
Phase 2 (~500ms later): returns matches with AI-generated reasons.

---

### `POST /api/search/synthesize`

Synthesize search results into an executive brief. Streams via NDJSON.

```bash
curl -X POST http://localhost:3210/api/search/synthesize \
  -H "Content-Type: application/json" \
  -H "Accept: application/x-ndjson" \
  -d '{"query":"fintech contacts","contactIds":["abc123","def456"]}'
```

---

## AI Search (Batch Enrichment)

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

```bash
curl "http://localhost:3210/api/ai-search/status?batchId=batch-abc123"
```

---

### `GET /api/ai-search/stream?batchId=`

Subscribe to real-time batch progress via Server-Sent Events (SSE).

```bash
curl -N "http://localhost:3210/api/ai-search/stream?batchId=batch-abc123"
```

```javascript
const eventSource = new EventSource(`/api/ai-search/stream?batchId=${batchId}`);
eventSource.onmessage = (event) => {
  const batch = JSON.parse(event.data);
  console.log(`Status: ${batch.status}, Jobs: ${batch.jobs.length}`);
  if (batch.status === "complete") eventSource.close();
};
```

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

Fetch Relationship Pulse Dashboard metrics.

```bash
curl http://localhost:3210/api/dashboard
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

Backs **Settings → AI**. Capabilities are `quick`, `deep`, `embeddings`, and
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

```bash
curl -X PUT http://localhost:3210/api/settings/ai/endpoints \
  -H "Content-Type: application/json" \
  -d '{"id":"homelab","label":"Homelab Ollama","baseUrl":"http://alpha:11434/v1"}'
```

---

### `DELETE /api/settings/ai/endpoints/:id`

Remove a custom endpoint.

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

Check AI Search grounding RPD quota (Gemini only).

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

Machine-readable query endpoints for programmatic access.

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

Get all unique tags.

```bash
curl http://localhost:3210/api/tags
```

---

### `GET /api/industries`

Get all unique industries.

```bash
curl http://localhost:3210/api/industries
```

---

### `GET /api/interactions/search`

Search interactions by content.

```bash
curl "http://localhost:3210/api/interactions/search?q=proposal"
```

---

### `GET /api/timeline`

Fetch the global timeline (all interactions across all contacts).

```bash
curl http://localhost:3210/api/timeline
```

---

## Authentication

### `GET /api/auth/status`

Always reachable (even unauthenticated). Reports whether auth is enforced and whether the current request is authenticated.

```bash
curl http://localhost:3210/api/auth/status
# → { "authRequired": true, "authenticated": false }
```

---

### `POST /api/auth/login`

Exchange the access token for an HttpOnly `SameSite=Strict` session cookie (used by the web app).

```bash
curl -X POST http://localhost:3210/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"token": "<your token>"}'
```

`POST /api/auth/logout` clears the cookie.

---

## Trash (Undoable Deletes)

`DELETE /api/contacts/:id` and `POST /api/contacts/bulk-delete` are **soft deletes** — contacts move to the trash and are hard-deleted after `TRASH_RETENTION_DAYS` (default 30).

### `GET /api/trash`

```bash
curl http://localhost:3210/api/trash
# → { "items": [{ "id", "name", "company", "avatarUrl", "deletedAt" }] }
```

### `POST /api/trash/:id/restore`

Restore a trashed contact to the active list (re-indexes search and embeddings). Returns the hydrated contact; `404` if the contact isn't in the trash.

### `DELETE /api/trash/:id`

"Delete forever" — immediately hard-deletes a trashed contact and its entire history. Refuses (`404`) for contacts that are not in the trash.

---

## Backups

SQLite snapshots (online backup API — safe while the app runs) written to `DATA_DIR/backups/`, rotated to the `BACKUP_KEEP` most recent. A schedule runs every `BACKUP_INTERVAL_HOURS` (default 24).

### `GET /api/backups`

```bash
curl http://localhost:3210/api/backups
# → { "backups": [{ "filename", "sizeBytes", "createdAt" }] }
```

### `POST /api/backups`

Take a snapshot now. Returns `201` with the new backup's metadata.

---

## Export

### `GET /api/export/json`

Downloads the entire database — contacts (hydrated), interactions, lists, action items, and the merge audit log — as a single JSON attachment.

### `GET /api/export/csv`

Downloads a flat, RFC-4180-escaped CSV of all non-trashed contacts.

```bash
curl -OJ http://localhost:3210/api/export/csv
```

---

## Debug (Dev Only)

### `GET /api/debug/cache-stats`

Exposes hit/miss counters for all aiCache tiers. Only available when `NODE_ENV !== production`.

```bash
curl http://localhost:3210/api/debug/cache-stats
```
