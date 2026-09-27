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
2. Choose the **Research depth**, Standard or Deep (see below)
3. Narrow the list with the two rows of filters (see below), then select contacts, one by one or with **Select all**
4. Read the batch's time and cost at that depth under **Start enrichment**, then click it. The confirmation gives them again
5. Watch real-time progress via the SSE-powered progress overlay

For one contact, choose **Enrich contact** or **Enrich deeply** in the
contact's actions menu. In its Dossier tab, **Enrich contact** in an empty
dossier and **Enrich again** on the Research card open a menu of the two
depths, each with its time.

<!-- Screenshot: batch-enrichment.png -->

### Automatic Enrichment and Page Controls

Under **Settings → Contact enrichment**:

- **Never-enriched banner:** Displays the count of contacts that have never been researched on the web, with a **Select them** button that selects them for immediate batch enrichment. It also empties the search box and sets the filters to All and Not yet, so the list shows exactly the contacts it selects.
- **Filters:** Two rows of pills narrow the list, with one choice in each row. **Contacts** is All, Tracked, Has links, Has email or No data. **Research** is Any, Not yet, 6+ months ago (the last research is more than 183 days old) or Found nothing (the last research found no page). A contact shows when it matches both rows. Each pill counts the contacts it would show beside the other row's choice. A new choice clears the selection, so a contact the list hides is never started. A row whose last research found no page has a **No page** badge. The slim contact list carries the last run's outcome as `researchOutcome` for the filter and the badge.
- **Batch estimate:** Under **Start enrichment**, the depth, time and cost of the selection, such as "Standard · About 2 min and $0.45 in all".
- **Research depth:** Standard or Deep, for the next batch, with what each does and its time and cost per contact. The page opens on Standard each time.
- **Enrich new contacts automatically (`autoEnrich`):** When enabled (default `false`), creating a contact by hand queues background web research at Standard depth if AI assist is turned on for the account and grounding quota is available. While the account's batch runs, the new contact joins it.
- **Grounding meter:** For administrators with Gemini configured, a live meter tracks daily grounding search usage and remaining requests.

### How research runs

Every provider runs the two-pass strategy (`server/services/aiSearch/strategies/twoPass.ts`):

1. **Search.** The research model searches the web and reports what the matching pages say, one fact per line with the site it came from: `- Past role: Associate, Harbor Point Partners, 2018 to 2020 [finra.org]`. The prompt starts from the contact's own details and where they came from (for a LinkedIn import, the connections list, the import date and the date the user connected). The place is the contact's location, or else the first address in Details with no digit in it, such as "Austin, TX", the primary address first. A street address or a postcode is never sent. It suggests four to six searches built from them: the company, the role, the formal first name behind a short one ("Thomas" for "Tom"), past employers, schools and profile handles. A page counts only when it names the person and matches at least one of those details, and a page that links to the person's own profile is about them. When a page calls another employer current, the job is reported as a past one, because pages about people go out of date. Relatives, health, religion, politics, sexuality, home addresses and home purchases are left out.
2. **Extraction.** The quick model reads those lines into the contact's fields. The answer is checked field by field, so one bad value, such as a malformed email address, drops only that value. Broker registrations (FINRA "Registered Representative" records) become a **Registrations** fact rather than jobs, and only a job at the contact's recorded company stays current. Dates are stored as `YYYY` or `YYYY-MM`.

The model decides for itself whether to search, and Gemini has no setting that forces a search. The search pass therefore runs at thinking level `medium`: at the adapter's usual `low`, Gemini 3.8 Flash answered research prompts without searching, and at `high` it came back empty for the same two contacts of five on every try. A search pass that cites no pages, or returns nothing, is asked twice more at the same time: once with the searches first, and once in a short form. The first of those answers that cites pages is used. An answer with no pages behind it is refused and changes nothing, unless the model answers `NO MATCHING PAGES`, which records the plain outcome **No public information**. An empty answer from every ask returns `502 AI_NO_ANSWER`, and a later try can succeed.

Gemini's source links are Google redirects. Each one is resolved once to the page it names (a HEAD request to Google; the page itself is not fetched), and Gemini's grounding supports link each fact to its page.

`single-pass` (search and schema in one request, OpenAI and Anthropic only) can still be asked for by name in `POST /api/ai-search`.

### Research depth

Every start names one of two depths, and Standard is the default. The API takes it as `depth`, the job and the research record keep it, the progress panel marks a Deep job, and the Research card's history names the depth of each run.

|                          | Standard                                                                           | Deep                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| What it runs             | One search ask at thinking `medium`, for the main facts, with four to six searches | The same ask, and beside it one at thinking `high` for a complete profile, with ten or more searches. What both cite is kept |
| Time per contact         | about 40 s                                                                         | about 1 min                                                                                                                  |
| Web searches per contact | about 8                                                                            | about 18                                                                                                                     |
| Cost per contact         | about $0.15                                                                        | about $0.32                                                                                                                  |
| Time limit               | 4 min                                                                              | 5 min                                                                                                                        |

Measured on five contacts from real records, with Gemini 3.8 Flash and Gemini 3.5 Flash-Lite (2026-09-26). The figures are means over the runs that found pages: ten Standard runs in three rounds of the five, and six Deep runs in two rounds. Standard added 11 to 40 details to a contact, and Deep 8 to 40: about a fifth more for the same person, from nearly twice the pages. A contact no page is about costs $0.01 to $0.06. The cost is Google's prices: $14 per 1,000 web searches after 5,000 free a month, $0.75 and $3.75 per million input and output tokens for Gemini 3.8 Flash through 2026, and $0.30 and $2.50 for Flash-Lite. The figures live in `shared/researchDepth.ts`, which the Enrichment page reads.

When no first ask cites a page, two more are asked at once, at `medium`, and every answer that cites pages is kept. Deep does not ask at `high` alone: `high` found more when it answered (32 details for one contact where `medium` found 20), but it answered with nothing for two of the five contacts on every try, all three asks for one of them. Beside the `medium` ask, an empty `high` answer costs its tokens, and the `medium` one still stands. A second search after the first, told what it found, was tried and ran no searches: with the first answer's facts in front of it, the model answered from them.

The Enrichment page describes both depths and their figures. A contact's actions menu has **Enrich contact** (Standard) and **Enrich deeply** (Deep). The dossier's **Enrich contact** and **Enrich again** open both. Automatic enrichment and the command palette's refresh run at Standard.

### What Gets Enriched

The research can add, when the contact does not have them yet:

- Role, company, headline, industry and location
- A professional summary (about)
- Past roles with employers, cities and dates; schools with degrees and dates
- Profiles (LinkedIn, GitHub, X and others; a post is not a profile)
- Facts such as awards, licences, registrations, publications, talks, volunteer roles and a hometown
- Interests and tags

Enrichment preserves existing values. It rejects the result if the contact
changes during research.

### The research record

Every enrichment is recorded on the contact, in `contacts.aiResearch` (shape: `shared/researchRecord.ts`): when it ran, which models, what it added field by field, the searches it ran, the facts it reported and the pages it cited. The **Research** card at the bottom of the Dossier tab shows it:

- **History:** each enrichment and what it added, like "Added 25 from 9 pages: Roles ×6, Education ×3, Location", "Read 10 pages, nothing new" or "No web page about this person"
- **What the research found:** the latest facts, each linked to its page
- **Sources:** every page the research cited, by site and address

Before this record existed, enrichment wrote a dossier text into `aiBackground` that copied the about, career and education cards and listed its sources as "Source 1" links. The next enrichment of such a contact replaces that text with the record, and the history counts the earlier enrichment. Notes in `aiBackground` from anywhere else stay, under **Research notes**.

### When research finds no page

When the latest research found no page about the person, the Research card says so under its heading, and offers the next step:

- **No web page matched Mara**, and the kinds of detail research searched with: "Research searched with Mara’s name, company, role and LinkedIn profile". It names kinds, not values, because a role or a city can hold a comma of its own.
- A button for each detail the contact lacks that helps research find the right person. **Add a city** shows when there is no location and no address that names a city. **Add a work email** shows when no email is at an employer's domain. **Add a link** shows when there is no link other than LinkedIn, since LinkedIn pages do not come back in the research search. Beside a LinkedIn profile it reads **Add another link**.
- Each button opens its field on the contact page, with the input focused. The city and the work email open in Details, labelled work. The link opens in the header. On a phone the page moves to the Details tab first.
- The last line says what to do next: choose Enrich again, and after a Standard run, Deep runs a longer search.

The card offers only what the page can take. Schools and past jobs help as much, but the contact page has no field for them. The rules for a work email and a city are the prompt's own (`shared/researchIdentity.ts`), so the card asks for what research reads. The Enrichment page's **Found nothing** filter lists every contact in this state.

### Enriching again

A second enrichment is told what the contact already has, which sites the earlier rounds read, and what is still missing, and it prefers searches and sites the earlier rounds did not use. It adds only what is new, so it usually adds less than the first. A detail written another way counts as known: one school under two names, "AB" and "BA" at one school in one year, one employer and start month under two job titles, and "Distance running coach" for "Distance running".

Measured on three contacts from real records, with Gemini 3.8 Flash and Gemini 3.5 Flash-Lite (2026-09-26): the first round added 0, 22 and 23 fields, and the second added 0, 4 and 4. No web page matched the first contact's records, and both rounds recorded that. One of the second round's additions was a job the contact already had, under a shorter title. The merge now reads the same employer and start month as one job.

### Progress Tracking

Each batch job streams real-time progress via SSE (`GET /api/ai-search/stream`):

- Per-contact status: `queued` → `searching` → `merging` → `success` / `error` / `cancelled`
- Per-contact outcome when done: `added`, `nothing-new` or `no-public-info`, and the models that ran
- Error classification: rate_limit, validation, network, auth, ambiguous
- Token usage tracking
- Latency per contact

The overlay supports scrolling, visible error text, and **Stop research**.
Minimizing the overlay keeps a progress button available. Status polling
continues if the stream disconnects. A server restart clears progress, while
completed contact updates remain in the database. Starting a batch shows no
toast: the overlay opens in the toasts' corner and says it.

### Limits

- Maximum 100 contacts per batch
- One batch runs at a time on a server, because the provider's limits belong to the API key the server shares. A second start by the same account joins the running batch. A start by another account is refused with `429 RATE_LIMITED` (`details.yours: false`) until the batch ends.
- There is no cooldown between batches. A provider's own 429 pauses that model in the adapter, and the router moves to another.
- Two concurrent AI generations and 16 waiting generations per server
- One workflow per contact, with a deadline of 4 minutes at Standard and 5 at Deep: a search ask takes from 15 s to over a minute
- No repeated research workflow after a failed provider call or invalid output. Only the search pass is asked again, and only when it cites no pages

**APIs:**

- `POST /api/ai-search` — Start a batch at a `depth`, or add to the running one (`appended: true`)
- `GET /api/ai-search/status?batchId=` — Poll status
- `GET /api/ai-search/stream?batchId=` — SSE stream
- `POST /api/ai-search/:batchId/cancel` — Stop a batch

---

## Single-Contact Enrichment

Enrich a single contact at a depth, Standard when the body names none:

```bash
curl -X POST http://localhost:3000/api/contacts/abc123/enrich \
  -H "Content-Type: application/json" \
  -d '{"depth":"deep"}'
```

This uses the same pipeline as batch enrichment but for one contact. Returns the number of fields updated, the outcome, latency, models used, and token count.

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
