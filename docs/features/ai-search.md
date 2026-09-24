# Ask Contrack and contact enrichment

Ask Contrack finds people in your network from a question in plain words. Contact enrichment researches contacts on the web and fills in their profiles. Both combine local-first retrieval with AI.

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

2. **Phase 2 — AI Enrichment (~500ms):** The AI provider re-ranks results and generates contextual reasons explaining _why_ each contact matches the query. These stream in via NDJSON and replace the Phase 1 results.

This progressive approach ensures the UI feels instant while AI enrichment loads in the background.

<!-- Screenshot: ai-search-results.png -->

### Query Examples

| Query                                     | What it finds                                          |
| ----------------------------------------- | ------------------------------------------------------ |
| "fintech contacts in SF"                  | Contacts at fintech companies located in San Francisco |
| "people I haven't talked to in 3 months"  | Contacts with stale interaction history                |
| "investors who might be interested in AI" | Investor-tagged contacts with AI-related interests     |
| "Jane's coworkers at Stripe"              | Contacts who share Stripe as their company             |
| "engineers who went to Stanford"          | Contacts with matching education + role                |

A role in the question finds the other forms of its word in a title
(`roleVariants` in `server/ai/queryConstraints.ts`): "engineers" finds a
contact whose role is Engineering, "designers" finds Design, and "who works
in marketing" finds a Marketer. The first words of a role stay as they are,
so "software engineers" still means software. The hard filter and the check
after the rerank read the same forms, so a contact the filter lets in is not
dropped later. They matched whole words only, and "engineer" found nobody in
an Engineering role.

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

| Contact                             | Generated Expansion                        |
| ----------------------------------- | ------------------------------------------ |
| "Jane Smith, Stripe Engineer"       | `fintech, payments, developer, saas, api`  |
| "Dr. Sarah Chen, Stanford Hospital" | `healthcare, medicine, research, academic` |

These terms are stored in a `searchExpansion` column indexed by FTS5, dramatically improving search recall for natural language queries.

---

## Contact enrichment

Contact enrichment (Settings → Contact enrichment) fills in contact profiles with data from the web, in bulk. The API routes keep their `ai-search` path.

### How to Use

1. Navigate to **Settings → Contact enrichment**
2. Select contacts to enrich (individually or "Select All")
3. Click **Start enrichment**
4. Watch real-time progress via the SSE-powered progress overlay

<!-- Screenshot: batch-enrichment.png -->

### Automatic Enrichment and Page Controls

Under **Settings → Contact enrichment**:

- **Never-enriched banner:** Displays the count of contacts that have never been researched on the web, with an "Enrich them" button that selects them in the table for immediate batch enrichment.
- **Enrich new contacts automatically (`autoEnrich`):** When enabled (default `false`), creating a contact by hand queues background web research if AI assist is turned on for the account and grounding quota is available.
- **Grounding meter:** For administrators with Gemini configured, a live meter tracks daily grounding search usage and remaining requests.

### Search Strategies

The enrichment strategy varies by AI provider:

| Provider  | Strategy    | How it works                                                                                               |
| --------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| Gemini    | Two-Pass    | **Pass 1:** Discover facts via grounding-based web search. **Pass 2:** Merge and validate discovered data. |
| OpenAI    | Single-Pass | Single prompt with context to generate enrichment data                                                     |
| Anthropic | Single-Pass | Single prompt with context to generate enrichment data                                                     |

### What Gets Enriched

The AI searches the internet for each contact and can update:

- Role and company when the fields are empty
- Headline / professional summary
- Social links (LinkedIn, GitHub, Twitter)
- Education and experience history
- Industry classification
- Website
- AI-generated summary and background

Enrichment preserves existing values. It rejects the result if the contact
changes during research. Gemini source links appear under **Dossier → Research
notes and sources**. The section also shows research for contacts with no other
dossier fields.

### Progress Tracking

Each batch job streams real-time progress via SSE (`GET /api/ai-search/stream`):

- Per-contact status: `queued` → `searching` → `merging` → `success` / `error` / `cancelled`
- Error classification: rate_limit, validation, network, auth, ambiguous
- Token usage tracking
- Latency per contact

The overlay supports scrolling, visible error text, and **Stop research**.
Minimizing the overlay keeps a progress button available. Status polling
continues if the stream disconnects. A server restart clears progress, while
completed contact updates remain in the database.

### Rate Limiting

- Maximum 100 contacts per batch
- 5-minute cooldown between batches
- Two concurrent AI generations and 16 waiting generations per server
- One workflow per contact, with a 90-second deadline
- At most one retry for a transient provider failure within the deadline
- No repeated research workflow after empty or invalid model output

**APIs:**

- `POST /api/ai-search` — Start a batch
- `GET /api/ai-search/status?batchId=` — Poll status
- `GET /api/ai-search/stream?batchId=` — SSE stream
- `POST /api/ai-search/:batchId/cancel` — Stop a batch

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

---

## History

The Ask Contrack page keeps the questions you ask across sessions. You can run a question again, pin it, or delete it:

- **Layout:** From `lg` the history is the page's right-hand panel (`SidePanel`). A square **History** button sits in the page's top-right corner, level with the title. The 320 px panel slides in from the window's edge under the button, over the page, so opening or closing it moves nothing in the column, and the button stays where it is. While the panel is open the button stays pressed in. The panel's heading row holds the title, the count and **Clear**, and ends where the button begins. Under it the filter, the switch and the list take the panel's full width, and the list's scroll bar sits on the window's edge. Below `lg` the same square button sits in the page header and opens the list in a bottom sheet, which has its own heading row and a **Close history** button.
- **Hide and show:** The History button opens and closes the panel. There is no second close button. Escape inside the panel closes it and puts the keyboard focus on the button. When the filter holds words, the first Escape clears them. Each of these saves the `askHistoryOpen` preference to the account. When single-key shortcuts are on, `h` outside a text field toggles the panel. With focus inside the panel, `h` closes the panel and focuses the button. Below `lg`, `h` opens the sheet.
- **Column width:** From `lg` the page column keeps the panel's width free on both sides. The open panel does not cover the search box or a result from about 1250 px up. The column is 48rem wide from about 1550 px, narrower below that, and 34rem from 1320 px down.
- **Groupings:** Questions are automatically organized into chronological groups:
  1. **Pinned** (pinned rows stay at the top and do not repeat in date groups)
  2. **Today**
  3. **Yesterday**
  4. **This week** (Monday-start)
  5. **Months** (e.g. "August 2026")
- **Row actions & re-running:** Clicking any question entry fills the search box and immediately re-runs the search. Hovering or focusing a row reveals Pin/Unpin and Delete at the end of its meta line ("7 people · 18 hours ago"), so they never cover the question. On a touch screen they always show. Deleting triggers an undo toast notification before sending a hard delete request.
- **Filtering & modes:** A quick search filter debounced at 200ms narrows questions in real time. A Segmented control filters between All, People, and Notes questions.
- **Palette unification:** Command palette searches read from and write to the same history. AI queries asked in the command palette (`? question`) appear in the Ask Contrack history with their prefix stripped, and Ask Contrack questions appear under Recent Searches in the palette zero state.
- **Clear history:** A "Clear" action in the history heading row and a "Clear history" button under **Settings → Privacy and AI** allow deleting all recorded history behind a confirmation dialog.

---

## Account AI Switch

Users can turn AI off for their account under **Settings → Privacy and AI** (`aiAssist` preference).

When AI is turned off for an account:

- Outbound requests to generative AI endpoints return `403 AI_OFF_FOR_ACCOUNT` (enforced by `requireAiAllowed` middleware on all AI-cost routes).
- The client suppresses AI generation triggers including Dossier briefing buttons, contact enrichment buttons, command palette enrichment actions, and group synthesis buttons.
- The Dashboard daily insight card displays an informative message explaining that AI is disabled for the account, with a link to Privacy settings.
- Fast local retrieval remains fully operational: SQLite FTS5 full-text search, local vector embeddings, and direct query filtering continue running entirely on your machine with zero external network requests.

---

## Indexing Coverage and Empty State

The page leads with the search box: the mode's glyph, the question, Clear, and a square search button with the magnifying glass alone. Enter or the button asks. Notes mode uses the same box (see [Note Search](interaction-search.md#the-page)). The header is the title and the People and Notes switch, with no line of description. Below `lg` a History button sits beside the switch.

- **One status line:** In People mode, while contacts are missing from the index, indexing runs, or a contact failed, one line sits under the search box: a thin progress bar, the words ("12 of 30 contacts indexed", or "Indexing 12 of 30…" while it runs) and quiet text buttons for **Index missing**, **Inspect failed** and **Retry failed**. The line is a region named "Semantic search coverage". It hides at 100 percent with nothing running. The paid-provider confirmation and the failed-contacts dialog open from its buttons.
- **Try asking:** Before a search, the page shows suggested questions as flat chips. A click fills the box and runs the search. In People mode the first three come from your own network, its most common industry, city and company ("Who works in Music Streaming?", "Who do I know in Sydney?", "Who works at TechNova?"), so a press always finds someone. Fixed examples fill the rest. People search reads profiles, not dates, so no suggestion asks about when you last spoke. Notes mode shows no suggestions.
- **No results:** "No one matches" with "Try other words." The status line above already says when the index is incomplete.
