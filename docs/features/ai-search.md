# AI Search & Batch Enrichment

Contrack's AI search system combines local-first hybrid retrieval with AI-powered enrichment to find, understand, and enrich contacts in your network.

## Ask Contrack v3 (Semantic Search)

The flagship search experience — a hybrid retrieval-augmented generation (RAG) pipeline that finds anyone in your network using natural language queries.

### How It Works

```
User Query: "who works in fintech and I haven't talked to recently"
    │
    ├──→ FTS5 Keyword Search (SQLite)     ──→ Top-N results
    │                                          │
    ├──→ Vector KNN Search (sqlite-vec)   ──→ Top-N results
    │    384-dim MiniLM local embeddings       │
    │                                          │
    └──→ Reciprocal Rank Fusion (RRF)    ←────┘
              │
              ▼
         Fused Results (Phase 1 — <15ms)
              │
              ▼
         AI Re-ranking + Reason Generation (Phase 2 — ~500ms)
              │
              ▼
         Streamed via NDJSON to client
```

### Two-Phase Streaming

Results stream to the UI in two phases:

1. **Phase 1 — Instant Retrieval (<15ms):** FTS5 keyword matches and vector KNN results are fused via Reciprocal Rank Fusion and sent immediately. These appear with no AI reason.

2. **Phase 2 — AI Enrichment (~500ms):** The AI provider re-ranks results and generates contextual reasons explaining *why* each contact matches the query. These stream in via NDJSON and replace the Phase 1 results.

This progressive approach ensures the UI feels instant while AI enrichment loads in the background.

<!-- Screenshot: ai-search-results.png -->

### Query Examples

| Query | What it finds |
|-------|--------------|
| "fintech contacts in SF" | Contacts at fintech companies located in San Francisco |
| "people I haven't talked to in 3 months" | Contacts with stale interaction history |
| "investors who might be interested in AI" | Investor-tagged contacts with AI-related interests |
| "Jane's coworkers at Stripe" | Contacts who share Stripe as their company |
| "engineers who went to Stanford" | Contacts with matching education + role |

**API:** `POST /api/search/semantic`

---

## Local Embeddings

Every contact gets a 384-dimension vector embedding generated locally using Transformers.js (`all-MiniLM-L6-v2`). These embeddings:

- Are generated on first boot and when contacts are created/updated
- Power the vector KNN arm of the search pipeline
- Run entirely locally — no API calls, no network dependency
- Are stored in a `vec0` virtual table (`search_embeddings`)

---

## Doc2Query (Write-Time Enrichment)

When contacts are created or updated, an async background job generates synthetic search terms using the AI provider's Lite model. For example:

| Contact | Generated Expansion |
|---------|-------------------|
| "Jane Smith, Stripe Engineer" | `fintech, payments, developer, saas, api` |
| "Dr. Sarah Chen, Stanford Hospital" | `healthcare, medicine, research, academic` |

These terms are stored in a `searchExpansion` column indexed by FTS5, dramatically improving search recall for natural language queries.

---

## Batch Enrichment (AI Search)

The AI Search feature (Settings → AI Search) enriches contact profiles with internet-sourced data in bulk.

### How to Use

1. Navigate to **Settings → AI Search**
2. Select contacts to enrich (individually or "Select All")
3. Click **Start Enrichment**
4. Watch real-time progress via the SSE-powered progress overlay

<!-- Screenshot: batch-enrichment.png -->

### Search Strategies

The enrichment strategy varies by AI provider:

| Provider | Strategy | How it works |
|----------|----------|-------------|
| Gemini | Two-Pass | **Pass 1:** Discover facts via grounding-based web search. **Pass 2:** Merge and validate discovered data. |
| OpenAI | Single-Pass | Single prompt with context to generate enrichment data |
| Anthropic | Single-Pass | Single prompt with context to generate enrichment data |

### What Gets Enriched

The AI searches the internet for each contact and can update:

- Role and company (if changed)
- Headline / professional summary
- Social links (LinkedIn, GitHub, Twitter)
- Education and experience history
- Industry classification
- Website
- AI-generated summary and background

### Progress Tracking

Each batch job streams real-time progress via SSE (`GET /api/ai-search/stream`):

- Per-contact status: `queued` → `searching` → `merging` → `success` / `error`
- Error classification: rate_limit, validation, network, auth, ambiguous
- Token usage tracking
- Latency per contact

### Rate Limiting

- Maximum 100 contacts per batch
- 5-minute cooldown between batches
- Provider-specific RPM limits are respected via the Parallel Queue

**APIs:**
- `POST /api/ai-search` — Start a batch
- `GET /api/ai-search/status?batchId=` — Poll status
- `GET /api/ai-search/stream?batchId=` — SSE stream

---

## Single-Contact Enrichment

Enrich a single contact via the **Enrich** button on their profile:

```bash
curl -X POST http://localhost:3000/api/contacts/abc123/enrich
```

This uses the same pipeline as batch enrichment but for one contact. Returns the number of fields updated, latency, models used, and token count.

---

## Group Synthesis

From the search results view or Command Palette, click **"✨ Synthesize"** to generate an executive brief from the matched contacts:

- Summarizes the group composition
- Highlights common themes and connections
- Streams in real-time via NDJSON

**API:** `POST /api/search/synthesize`
