# Configuration

All configuration is done through environment variables in a `.env` file at the project root. Copy `.env.example` to get started:

```bash
cp .env.example .env
```

## Environment Variables

| Variable                | Description                                                                                                                                                 | Default                 | Required                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------- |
| `AI_PROVIDER`           | LLM provider adapter: `gemini`, `openai`, or `anthropic`                                                                                                    | `gemini`                | No                            |
| `GEMINI_API_KEY`        | Google Gemini API key                                                                                                                                       | —                       | Yes (if provider = gemini)    |
| `OPENAI_API_KEY`        | OpenAI API key                                                                                                                                              | —                       | Yes (if provider = openai)    |
| `ANTHROPIC_API_KEY`     | Anthropic API key                                                                                                                                           | —                       | Yes (if provider = anthropic) |
| `AI_TIER`               | Rate limit profile: `FREE` or `PAID`                                                                                                                        | `FREE`                  | No                            |
| `APP_URL`               | Host URL for self-referential links                                                                                                                         | `http://localhost:3000` | No                            |
| `PORT`                  | Express listening port                                                                                                                                      | `3210`                  | No                            |
| `HOST`                  | Interface to bind. The server has no authentication, so it binds localhost by default; set `0.0.0.0` to expose on your LAN (Docker sets this automatically) | `127.0.0.1`             | No                            |
| `CORS_ORIGIN`           | Enables CORS for the given origin. Off by default — the SPA is same-origin                                                                                  | — (disabled)            | No                            |
| `DATA_DIR`              | Root directory for runtime data (SQLite DB, uploads, embedding model cache). Set to `/app/data` in Docker                                                   | project root            | No                            |
| `MAPBOX_API_KEY`        | Mapbox geocoding API key (higher accuracy)                                                                                                                  | —                       | No                            |
| `AUTH_TOKEN`            | Enables authentication: every `/api` and `/uploads` request must present this token (SPA sign-in, or `Authorization: Bearer`)                               | — (auth off)            | No                            |
| `AUTH_REQUIRED`         | `true` enforces auth with an auto-generated token (persisted to `DATA_DIR/auth-token`, printed in logs on first boot). Set by the Docker image              | `false`                 | No                            |
| `TRASH_RETENTION_DAYS`  | Days a deleted contact stays restorable before permanent purge                                                                                              | `30`                    | No                            |
| `BACKUP_INTERVAL_HOURS` | Automatic SQLite snapshot cadence (`0` disables)                                                                                                            | `24`                    | No                            |
| `BACKUP_KEEP`           | How many rotated snapshots to keep in `DATA_DIR/backups`                                                                                                    | `7`                     | No                            |

> **Rate limiting:** endpoints that trigger billable AI calls or outbound fetches
> (semantic search, synthesis, parse-contact, enrich, briefing, AI search,
> link unfurling, embedding backfill) are limited to 60 requests/minute per
> client IP. Exceeding the window returns `429 RATE_LIMITED`.

---

## AI Provider Setup

Contrack supports three AI providers through a provider-agnostic adapter architecture. Only one provider is active at a time.

### Gemini (Default)

1. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Set in `.env`:
   ```
   AI_PROVIDER="gemini"
   GEMINI_API_KEY="your-key-here"
   ```
3. The SmartRouter automatically selects the optimal Gemini model (Lite, Flash, or Pro) per use case

**Gemini-exclusive features:**

- SmartRouter model-class routing (Lite → Flash → Pro)
- Grounding-based web search for AI Search enrichment (two-pass strategy)
- Quota tracking with RPD limits
- 768-dim embedding generation for deduplication

### OpenAI

1. Get an API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Set in `.env`:
   ```
   AI_PROVIDER="openai"
   OPENAI_API_KEY="your-key-here"
   ```
3. Uses GPT models with a single-pass search strategy

### Anthropic

1. Get an API key from [Anthropic Console](https://console.anthropic.com/settings/keys)
2. Set in `.env`:
   ```
   AI_PROVIDER="anthropic"
   ANTHROPIC_API_KEY="your-key-here"
   ```
3. Uses Claude models with a single-pass search strategy

---

## AI Tier Configuration

The `AI_TIER` variable controls rate limiting and model access:

| Tier   | Behavior                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------- |
| `FREE` | Conservative routing, limits matching free-tier quotas (~10 RPM). Avoids paid spillover. Default.           |
| `PAID` | Aggressive routing, full paid-tier limits (10K+ RPM). Includes paid-only models (e.g., Gemini 3.x preview). |

> **Note:** `AI_TIER` only affects Gemini's SmartRouter. OpenAI and Anthropic adapters use their own default rate limits.

---

## Mapbox Geocoding

By default, Contrack uses Nominatim (OpenStreetMap) for geocoding contact addresses. For higher accuracy:

1. Get an API key from [Mapbox](https://account.mapbox.com/access-tokens/)
2. Set in `.env`:
   ```
   MAPBOX_API_KEY="your-key-here"
   ```

Mapbox becomes the primary geocoder; Nominatim serves as the fallback.

---

## Database

Contrack uses **SQLite** in WAL (Write-Ahead Logging) mode for maximum local-first performance:

- **Database file:** `curator.db` in the project root
- **ORM:** Drizzle ORM with auto-migrations on startup
- **Virtual tables:** FTS5 (full-text search), vec0 (vector embeddings)

**Docker deployment:** Mount the project root as a persistent volume to preserve the database across container restarts.

---

## Authentication & Remote Access

Contrack is single-user. Auth is a single secret token:

- **Local (default):** no auth, server bound to `127.0.0.1` — nothing else on
  your machine or network can reach it.
- **LAN / remote:** set `HOST=0.0.0.0` **and** `AUTH_TOKEN=<long random string>`
  (or `AUTH_REQUIRED=true` to have one generated and printed on first boot).
  The web app shows a sign-in screen; scripts and MCP clients send
  `Authorization: Bearer <token>`.
- **Docker:** auth is on by default (`AUTH_REQUIRED=true` in the image). Read
  the generated token with `docker logs contrack | grep "Access token"`, or
  set `AUTH_TOKEN` in your compose environment.

The session cookie is HttpOnly + SameSite=Strict. For access outside your LAN,
prefer a private overlay network (e.g. Tailscale) or a reverse proxy with TLS
in front of the container — the app itself serves plain HTTP.

## Data Lifecycle

- **Trash:** deleting a contact is a soft delete. Restore it via the undo
  toast, `POST /api/trash/:id/restore`, or purge immediately with
  `DELETE /api/trash/:id`. Trash is permanently purged after
  `TRASH_RETENTION_DAYS` (default 30).
- **Backups:** SQLite snapshots are written to `DATA_DIR/backups` every
  `BACKUP_INTERVAL_HOURS` (online backup API — safe while the app runs),
  keeping the `BACKUP_KEEP` most recent. Trigger one manually with
  `POST /api/backups`; list them with `GET /api/backups`.
- **Export:** `GET /api/export/json` downloads the full database (contacts,
  interactions, lists, action items, merge log); `GET /api/export/csv`
  downloads a flat contacts spreadsheet.
