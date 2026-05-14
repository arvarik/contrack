# Configuration

All configuration is done through environment variables in a `.env` file at the project root. Copy `.env.example` to get started:

```bash
cp .env.example .env
```

## Environment Variables

| Variable            | Description                                              | Default                 | Required                      |
| ------------------- | -------------------------------------------------------- | ----------------------- | ----------------------------- |
| `AI_PROVIDER`       | LLM provider adapter: `gemini`, `openai`, or `anthropic` | `gemini`                | No                            |
| `GEMINI_API_KEY`    | Google Gemini API key                                    | —                       | Yes (if provider = gemini)    |
| `OPENAI_API_KEY`    | OpenAI API key                                           | —                       | Yes (if provider = openai)    |
| `ANTHROPIC_API_KEY` | Anthropic API key                                        | —                       | Yes (if provider = anthropic) |
| `AI_TIER`           | Rate limit profile: `FREE` or `PAID`                     | `FREE`                  | No                            |
| `APP_URL`           | Host URL for self-referential links                      | `http://localhost:3000` | No                            |
| `PORT`              | Express listening port                                   | `3000`                  | No                            |
| `MAPBOX_API_KEY`    | Mapbox geocoding API key (higher accuracy)               | —                       | No                            |

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
