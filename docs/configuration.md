# Configuration

All configuration is done through environment variables in a `.env` file at the project root. Copy `.env.example` to get started:

```bash
cp .env.example .env
```

## Environment Variables

| Variable                | Description                                                                                                                                      | Default                 | Required |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | -------- |
| `AI_PROVIDER`           | Preferred provider when a capability is set to Auto: `gemini`, `openai`, or `anthropic`                                                          | `gemini`                | No       |
| `GEMINI_API_KEY`        | Google Gemini API key                                                                                                                            | —                       | No       |
| `OPENAI_API_KEY`        | OpenAI API key                                                                                                                                   | —                       | No       |
| `ANTHROPIC_API_KEY`     | Anthropic API key                                                                                                                                | —                       | No       |
| `AI_TIER`               | Rate limit profile: `FREE` or `PAID`                                                                                                             | `FREE`                  | No       |
| `APP_URL`               | Host URL for self-referential links                                                                                                              | `http://localhost:3210` | No       |
| `PORT`                  | Express listening port                                                                                                                           | `3210`                  | No       |
| `HOST`                  | Interface to bind. Authentication is off by default, so it binds localhost; set `0.0.0.0` to expose on your LAN (Docker sets this automatically) | `127.0.0.1`             | No       |
| `CORS_ORIGIN`           | Enables CORS for the given origin. Off by default — the SPA is same-origin                                                                       | — (disabled)            | No       |
| `DATA_DIR`              | Root directory for runtime data (SQLite DB, uploads, embedding model cache). Set to `/app/data` in Docker                                        | project root            | No       |
| `MAPBOX_API_KEY`        | Mapbox geocoding API key (higher accuracy)                                                                                                       | —                       | No       |
| `AUTH_REQUIRED`         | `true` requires everyone to sign in with an account. First visit walks through creating one                                                      | `false`                 | No       |
| `API_TOKEN`             | Machine credential for scripts and MCP clients (`Authorization: Bearer <token>`). Setting it also gates the instance                             | — (auth off)            | No       |
| `AUTH_TOKEN`            | Deprecated alias for `API_TOKEN`, honoured with a startup warning                                                                                | —                       | No       |
| `TRASH_RETENTION_DAYS`  | Days a deleted contact stays restorable before permanent purge                                                                                   | `30`                    | No       |
| `BACKUP_INTERVAL_HOURS` | Automatic SQLite snapshot cadence (`0` disables)                                                                                                 | `24`                    | No       |
| `BACKUP_KEEP`           | How many rotated snapshots to keep in `DATA_DIR/backups`                                                                                         | `7`                     | No       |
| `AI_QUICK_MODEL`        | Pin the Quick-tasks model: `model` or `provider:model` (e.g. `gemini:gemini-3.6-flash`)                                                          | — (auto)                | No       |
| `AI_DEEP_MODEL`         | Pin the Deep-tasks model                                                                                                                         | — (auto)                | No       |
| `AI_RESEARCH_MODEL`     | Pin the Web-research model                                                                                                                       | — (auto)                | No       |
| `AI_EMBEDDINGS_MODEL`   | Pin the Embeddings model (governs search and dedupe vectors); defaults to a local model needing no key                                           | — (built-in)            | No       |

> **Rate limiting:** endpoints that trigger billable AI calls or outbound fetches
> (semantic search, synthesis, parse-contact, enrich, briefing, AI search,
> link unfurling, embedding backfill) are limited to 60 requests/minute per
> client IP. Exceeding the window returns `429 RATE_LIMITED`.

---

## AI Configuration

Contrack routes AI work by **capability**, not by "the AI provider". You connect
whichever providers you have keys for, and each kind of task is served by a
suitable model. Everything is configurable in the app under
**Settings → AI Configuration**; no restart or file editing required.

| Capability       | Powers                                                                                        | Default          |
| ---------------- | --------------------------------------------------------------------------------------------- | ---------------- |
| **Quick tasks**  | Magic Paste parsing, @mention extraction, search understanding & verification, daily insights | Auto             |
| **Deep tasks**   | Email (.eml) summaries, duplicate adjudication, research extraction                           | Auto             |
| **Embeddings**   | Semantic search ranking, duplicate similarity                                                 | Built-in (local) |
| **Web research** | AI Search enrichment against the live web                                                     | Auto             |

**Auto** picks the first available provider, preferring `AI_PROVIDER` — so an
existing single-key deployment behaves exactly as it did before. Set one API key
and everything works; configure further only if you want to.

### Connecting providers

Add a key in the UI (stored in the app database) or via environment variable.
Env keys always win and are shown read-only in the UI, so a Docker deployment
can pin credentials while still exposing model choice.

| Provider  | Key                                                              | Notes                                            |
| --------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| Gemini    | [Google AI Studio](https://aistudio.google.com/apikey)           | Grounded web search; declared model capabilities |
| OpenAI    | [OpenAI Platform](https://platform.openai.com/api-keys)          | Chat + embeddings                                |
| Anthropic | [Anthropic Console](https://console.anthropic.com/settings/keys) | Chat only (no embeddings endpoint)               |

### Custom endpoints (self-hosted & other vendors)

Anything that speaks the OpenAI API format can be added as a custom endpoint
with a base URL and optional key — Ollama, vLLM, LM Studio, llama.cpp,
OpenRouter, xAI, DeepSeek, Mistral:

```
Label:    Homelab Ollama
Base URL: http://alpha:11434/v1
API key:  (blank for Ollama)
```

There is no separate "Ollama provider" and no base-URL override on the built-in
OpenAI provider: a local server is a custom endpoint. `OPENAI_API_KEY` always
talks to OpenAI itself.

**The base URL must end in `/v1`.** Ollama serves its OpenAI-compatible API
under `/v1` (`http://host:11434/v1`), not at the root. Without the suffix,
model discovery requests `/models`, Ollama answers 404, and the endpoint saves
but finds no models.

**In Docker, `localhost` is the container.** A server running on the host
machine is not reachable at `http://localhost:11434/v1` from inside the
Contrack container. Use `http://host.docker.internal:11434/v1`, or the host's
LAN address. Ollama must also be listening on more than loopback for this to
work — set `OLLAMA_HOST=0.0.0.0` on the host.

These can serve Quick, Deep, and Embeddings. They cannot serve Online research —
there is no standard grounding API in the OpenAI format — so use SearXNG for
self-hosted web research.

Structured output is negotiated automatically: Contrack tries strict JSON
schema, falls back to JSON mode, then to prompt-based JSON, and remembers what
each model supports.

#### What Auto picks on a custom endpoint

The built-in providers map each capability onto a model they choose themselves.
A custom endpoint has no such map — its models are whatever you have pulled —
so Auto uses **the first chat model in the endpoint's discovered list**, and
uses the same one for both Quick and Deep. Nothing in the OpenAI-compatible
model list says which of your models is the cheap one, so Contrack does not
guess. Pin Quick and Deep in **Settings → AI** to split them, which is worth
doing if you run both a small and a large model.

If discovery found no chat models, Auto skips the endpoint entirely and the
capability reports itself unavailable, rather than calling a model that does
not exist. Refresh the endpoint's model list to fix it.

### Model discovery

Saving a key immediately queries the provider's list-models API. This validates
the credential and fills the model dropdowns, so new releases appear without a
Contrack update. Lists are cached for 24 hours and can be refreshed on demand.

Gemini and Anthropic report what each model can do; OpenAI and OpenAI-compatible
servers return bare ids, so capability is inferred from the model name and
marked with `?` in the UI.

### Self-hosted web research (SearXNG)

Set a SearXNG base URL to enable online research with no cloud provider.
Contrack queries its JSON API, fetches the top results (SSRF-guarded and
size-capped), and runs the normal structured extraction on the Deep-tasks model.
Combined with a local chat model and the built-in embeddings, this is a fully
self-hosted AI stack.

### Changing the embeddings model

One setting governs both vector indexes — semantic search and duplicate
detection — so "built-in (local)" genuinely means nothing leaves the machine.

The indexes are fixed-width, so switching models rebuilds them and re-embeds
every contact in the background. Search falls back to keyword (FTS5) matching
while that runs. The built-in local model needs no key and works offline.

---

## AI Tier Configuration

The `AI_TIER` variable controls rate limiting and model access:

| Tier   | Behavior                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------- |
| `FREE` | Conservative routing, limits matching free-tier quotas (~10 RPM). Avoids paid spillover. Default.           |
| `PAID` | Aggressive routing, full paid-tier limits (10K+ RPM). Includes paid-only models (e.g., Gemini 3.x preview). |

> **Note:** `AI_TIER` only affects Gemini's SmartRouter, which picks a concrete
> Gemini model whenever a capability is left on Auto. Other providers use their
> own default rate limits, and an explicitly pinned model bypasses routing.

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

Contrack is single-account. There are two kinds of credential, because people
and scripts want different things:

|                | People                                    | Scripts, cron, MCP                             |
| -------------- | ----------------------------------------- | ---------------------------------------------- |
| Credential     | Username or email + password              | `API_TOKEN`                                    |
| How it travels | HttpOnly session cookie                   | `Authorization: Bearer <token>`                |
| Turned on by   | `AUTH_REQUIRED=true`                      | setting `API_TOKEN` (which also gates the app) |
| Revocable      | Yes — per device, from Settings → Account | No; rotate the variable                        |

- **Local (default):** no auth, server bound to `127.0.0.1` — nothing else on
  your machine or network can reach it.
- **LAN / remote:** set `HOST=0.0.0.0` **and** `AUTH_REQUIRED=true`. The first
  visit shows a one-time setup screen that creates your account; everything
  already in the database is assigned to it. After that the app asks you to
  sign in.
- **Docker:** auth is **off** by default, because the usual setup reaches the
  container from the host only, or through a reverse proxy that authenticates
  for it. The container binds `0.0.0.0`, though, so if you publish the port
  anywhere your LAN can reach, set `AUTH_REQUIRED=true`. The server logs a
  warning at startup whenever it binds a non-loopback address with auth off.

Sessions are stored server-side and last 30 days. The cookie holds a random
secret; the database stores only its SHA-256, so a leaked database (or one of
the rotating backups) does not hand over live sessions. `Secure` is set
whenever the request arrived over HTTPS, and `SameSite=Strict` is the CSRF
defence. Changing your password ends every other session.

Passwords are hashed with scrypt (N=2^16, r=8, p=1). The parameters are stored
alongside each hash, so raising them later upgrades passwords silently on next
sign-in rather than locking anyone out.

**Forgot your password?** A self-hosted Contrack has no mail server, so there
is no reset email. Recover by deleting the account row and letting the setup
screen run again — your data is not attached to the deletion:

```bash
# Stop the container first so nothing is mid-write.
docker stop contrack
sqlite3 data/curator.db "
  UPDATE contacts SET ownerId=NULL;  UPDATE lists SET ownerId=NULL;
  UPDATE ai_invocations SET ownerId=NULL;  UPDATE dedupe_merge_log SET ownerId=NULL;
  DELETE FROM sessions;  DELETE FROM users;"
docker start contrack   # first visit shows the setup screen again
```

The `UPDATE`s are required, not optional: `ownerId` is `ON DELETE RESTRICT`, so
SQLite refuses to delete an account that still owns contacts. That is
deliberate — it means no stray `DELETE FROM users` can take your contacts with
it. Un-owned rows are re-claimed by the next account you create.

For access outside your LAN, prefer a private overlay network (e.g. Tailscale)
or a reverse proxy with TLS in front of the container — the app itself serves
plain HTTP.

## Data Lifecycle

- **Trash:** deleting a contact is a soft delete. Restore it from
  **Settings → Trash** (or the undo toast, or `POST /api/trash/:id/restore`);
  "Delete forever" purges immediately (`DELETE /api/trash/:id`). Trash is
  permanently purged after `TRASH_RETENTION_DAYS` (default 30).
- **Backups:** SQLite snapshots are written to `DATA_DIR/backups` every
  `BACKUP_INTERVAL_HOURS` (online backup API — safe while the app runs),
  keeping the `BACKUP_KEEP` most recent. Trigger one manually with
  `POST /api/backups`; list them with `GET /api/backups`.
- **Export:** `GET /api/export/json` downloads the full database (contacts,
  interactions, lists, action items, merge log); `GET /api/export/csv`
  downloads a flat contacts spreadsheet.
