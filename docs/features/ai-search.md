# Ask Contrack and contact enrichment

Ask Contrack finds people in your network from a question in plain words. Contact enrichment researches contacts on the web and fills in their profiles. Both combine local-first retrieval with AI.

## Ask Contrack v3 (Semantic Search)

The flagship search experience — a hybrid retrieval-augmented generation (RAG) pipeline that finds anyone in your network using natural language queries.

### How It Works

```
User Query: "who in Lisbon goes rock climbing"
    │
    ▼
L1 cache ──────────────→ hit: the cached answer
    │
    ▼
Facets: the request's filters and the facets typed in the question
    │
    ├──→ Only facets: the matching contacts, verified, no model call
    │
    ▼
Strict keyword search (top 30)
    │
    ▼
classifyQuery ─────────→ email, phone, quoted or name:
    │                    the keyword result, verified, no model call
    ▼
Implicit facets ───────→ a known place, company or industry, and nothing
    │                    more: the matching contacts, verified, no model call
    ▼
L2 cache, when a model would run ──→ the same question in other words:
    │                                 the cached answer, no model call
    ▼
Local retrieval (about 10 ms)
FTS5 + vector KNN (384-dim MiniLM, int8), fused by weighted RRF (k = 15)
    │
    ▼
Cross-encoder, questions only, 25 ms budget: reorders the top 30
    │
    ├──→ AI off or no provider: this list is the answer, unverified
    │
    ▼
Instant chunk: the top 30, unverified
    │
    ▼
Search lane, 12 s budget: the planner, then filtered retrieval
    │
    ├──→ Database proof: the filtered contacts, verified, no reranker
    ├──→ Any other plan: the compact reranker checks the top 30
    ├──→ Error, timeout or edit: a fresh local list, unverified
    │
    ▼
Complete chunk, streamed via NDJSON to the client
```

`runSearch` in `server/services/searchService.ts` runs these steps. The JSON
and the NDJSON callers use the same steps.

1. **The L1 cache.** The key holds the owner, the account's
   `search_revision`, a 5-minute bucket, the provider, the model, the facets,
   the cross-encoder once it has loaded, and the normalized query. With AI
   off or no provider, the key holds `local` in place of the provider and the
   model. An AI-off request therefore never reads an answer that a model
   verified.
2. **The facets.** The request's `filters` and the facets typed in the
   question make one set. A facet sent both ways counts once. Every later
   stage applies the facets before its limit. See [Facets](#facets).
3. **A facet-only answer.** A question that holds only facets, such as
   `tag:investor contacted:>90d`, is a filter. The answer is the matching
   contacts in name order, at most 30. Every match is verified, and no model
   runs.
4. **Strict keyword search.** `lexicalSearch` requires every token to match,
   then adds approximate names. It keeps the top 30. The names in this
   result give the name signals for the next step.
5. **The query kind.** `classifyQuery` sorts the question into one of six
   kinds before any model runs. See [Query kinds](#query-kinds).
6. **A local answer.** For an email, a phone number, a quoted phrase or a
   name, the strict keyword result is the final answer. Every match is
   verified, and no model runs. The L1 cache keeps the answer.
7. **Implicit facets.** `findImplicitFacets` reads a company, a place or an
   industry from the words of the question. When the other words ask for
   nothing more, the answer is a facet answer, as in step 3, and no model
   runs. Otherwise the implicit facets join the facets of step 2. See
   [Implicit facets](#implicit-facets).
8. **The L2 cache.** When a model would run, the question's vector first
   looks for a verified answer to the same question in other words. A hit
   is the answer, with no model call. See
   [The semantic cache](#the-semantic-cache).
9. **The local list.** For the other questions, `localRetrieval` runs FTS5
   in broad mode and a vector KNN search. Weighted reciprocal rank fusion
   (k = 15) joins the two lists, with the weights of the query's kind. See
   [Ranking](#ranking). No planner runs, and the step takes about 10 ms. For
   a question, the local cross-encoder then reorders the top 30. See
   [The local cross-encoder](#the-local-cross-encoder). The top 30 go to the
   client as the instant chunk.
10. **AI off.** When AI is off for the account, or no provider is set, the
    local list is the final answer. No instant chunk goes out, because no
    model stage follows.
11. **The model stages.** The planner (`parseSearchQuery`) runs in the AI
    queue's search lane, and the filtered retrieval follows it. These stages
    and the reranker share a 12-second budget. The planner starts before
    step 9 builds the local list, so its request is on the network while the
    list is built. The local list then adds no time to the answer. The
    planner reads the question without its typed facets. The facets hold
    for the plan's hard filter, the retrieval and the trait lists.
    - **Database proof, filters.** A plan with confidence "high" and no
      soft traits, whose hard filters hold every constraint, needs no
      reranker. The answer is the filtered contacts in retrieval order, then
      the other filtered contacts by name, top 30. Every match is verified.
    - **Database proof, recency.** A plan whose only constraint is recency
      needs no reranker either, unless its confidence is "low". The answer
      is the filtered contacts by last contact, never contacted first.
    - **The reranker.** Any other plan goes to the compact reranker with the
      top 30 candidates. See [Evidence and reasons](#evidence-and-reasons).
12. **A failure.** An error, a timeout or an edit in the account during the
    search ends with a fresh local list. The old keyword-only fallback
    (`searchFts`, recall@10 0.52) is never the Ask answer now.

### Two-Phase Streaming

Results stream to the UI as NDJSON chunks, in two phases:

1. **Phase 1, the instant chunk:** the local list from step 9, top 30. Every match carries `verified: false`, and the chunk carries `fallback: true`. The p95 at 5,000 contacts is 25.1 ms for a question, which the cross-encoder reorders, and 13.2 ms for any other query.

2. **Phase 2, the complete chunk:** the final answer. It replaces the Phase 1 list. A match that a filter or the reranker proved carries `verified: true` and a reason that the server built.

A local answer, a facet answer, an AI-off answer and a cached answer send the complete chunk only. A chunk's `fallback` means that the model did not verify its list. See the PR for the live numbers of the model stages.

On screen, a match that nobody verified wears the **Unverified** badge, on the Ask page's cards and in the palette. It replaces the Keyword and Fallback badges. **Approximate** still wins over it. An older server sends no `verified`, and then the chunk's `fallback` decides the badge.

- **Ask page headings:** "Unverified candidates" while AI works, and "Unverified results" when AI was unavailable.
- **Palette headings:** "Unverified candidates · checking with AI" and "Unverified results".
- **Warning line:** under the heading, it says that AI is unavailable and that the matches are unverified.
- **Screen reader:** "4 unverified candidates for “q”. Enriching with AI…" while AI works, and "AI unavailable. 2 unverified matches for “q”." for an unverified final list.
- **History pane:** a question whose last answer was unverified says "unverified" in its row.

<!-- Screenshot: ai-search-results.png -->

### Query kinds

`classifyQuery(query, signals)` in `server/services/search/intent.ts` reads
the question before any model runs. It is deterministic and takes under a
millisecond. The signals come from the names in the strict keyword result.

| Kind         | When                                                                                   |
| ------------ | -------------------------------------------------------------------------------------- |
| `email`      | The query is an email address.                                                         |
| `phone`      | The query has at least 7 digits, and only digits, spaces and `+()-.` make it up.       |
| `quoted`     | The query is one quoted phrase.                                                        |
| `name`       | The query has at most 4 tokens, no question word, and a name signal.                   |
| `conceptual` | The query starts with a question word or has 5 or more tokens, and has no name signal. |
| `mixed`      | Every other query.                                                                     |

The question words are who, which, what, find, show, list, people, anyone,
someone and somebody. A name signal is one of these:

- Every result's name starts with the query tokens.
- The best approximate name score is 0.85 or more.
- The first token is a known given name or nickname, and a result's name
  carries it.

The first four kinds are local kinds. For them, the strict keyword result is
the final answer, and no model runs. "Jonathon Smyth" finds Jonathan Smith
with the **Approximate** badge. "Morgan Stanley" is not a name when the
people it finds carry neither word in their names. A question that contains
a name, such as "who is Ada Lovelace", is never a `name` query.

`classifyQuery` also returns fusion weights for each kind. The local kinds
get lexical 0.7 and dense 0.3, `conceptual` gets 0.3 and 0.7, and `mixed`
gets 0.5 and 0.5. The fusion of the local list reads them. See
[Ranking](#ranking).

`queryIntent(scope, query, facets)` in `hybridRetrieval.ts` runs the strict
keyword search inside the facets, then `classifyQuery` on its names. Ask
Contrack uses it for steps 4 and 5.

### Facets

Ask Contrack reads the palette's facets, such as `tag:investor`,
`location:lisbon` and `contacted:>90d`. See
[Command Palette](command-palette.md#faceted-filters) for each facet.

- **From the request.** `POST /api/search/semantic` takes `filters`, a list
  of up to 8 facets. The palette's AI (`?`) mode sends its pills there. A
  pill that you add or remove asks the question again.
- **From the question.** The server reads the facets typed in the question
  with `parseFacetQuery` (`shared/facetQuery.ts`). The palette's tokenizer
  uses the same parser. On the Ask page, type the facets in the question.

`compileFacets` (`server/services/search/facetSql.ts`) turns the facets into
one SQL predicate. The keyword search in both modes, the approximate
names, the vector KNN, the plan's hard filter and the trait lists all apply
it before their limit. A contact that the facets keep is therefore never lost to a
cut. The facets are part of the L1 cache key, in a fixed order. They are
also part of the key that lets two identical requests share one search.

A question that is only facets gets its answer from the database: the
matching contacts in name order, at most 30. Every match is verified, and no
model runs. The reason comes from the facets. See
[Evidence and reasons](#evidence-and-reasons).

### Implicit facets

`findImplicitFacets` (`server/services/search/implicitFacets.ts`) reads
facets from the words of a question. It reads these phrases only:

| Phrase                                     | Facet      | Rule                                                                                  |
| ------------------------------------------ | ---------- | ------------------------------------------------------------------------------------- |
| "at X", "works at X"                       | `company`  | X is a company in your contacts.                                                      |
| "in X", "based in X", "near X", "around X" | `location` | X is a place in your contacts: a whole location, or one of its comma-separated parts. |
| "in X"                                     | `industry` | X is an industry in your contacts.                                                    |

X must be equal to a known value. The comparison ignores case and accents.
A value that only contains X does not count, so "at Sequoia" does not find
the company "Sequoia Capital". The server reads the known values from your
active contacts once per search revision. It keeps them for at most 50
accounts.

The planner decides these cases, because a facet here could be wrong:

- A place with a comma and another word after it: "Paris, Texas" when only
  "Paris" is known. A question word or a filler word after the comma is the
  one exception.
- A place with "and" or "or" after it: "New York and London".
- A place with a word such as "State", "City" or "County" after it:
  "Washington State".
- A place with another known place after it.
- A value that is both a place and an industry.

A comma with a question word after it ends a clause. "In Lisbon, who
climbs?" therefore still gives the Lisbon facet.

When the other words of the question ask for nothing, the answer is a facet
answer, and no model runs. Question words and filler words such as "who",
"people", "works", "lives", "based" and "the" ask for nothing. These
questions need no model:

- "people in Lisbon"
- "who works at Northwind Logistics"
- "who works in fintech"

In "who in Lisbon goes rock climbing", the words "goes rock climbing" ask
for more. The planner reads the whole question, and the Lisbon facet holds
for every stage. Every list then has only contacts whose location names
Lisbon.

### Ranking

`lexicalSearch` (`server/services/search/lexical.ts`) is the keyword search.
It has two modes:

- **Strict mode** is the sidebar search and the check that decides the
  query's kind. It returns the contacts that match every token, then
  approximate names by score.
- **Broad mode** is the keyword list of the local list. It ranks four tiers,
  each in its own order:
  1. Every token matched, by BM25.
  2. Approximate names with a score of 0.85 or more, by score.
  3. Partial matches, with some tokens but not all, by BM25. A one-letter
     token, such as the O of O'Callahan, counts only when the query has no
     longer token.
  4. Approximate names with a score from 0.75 to 0.85, by score.

Before this change, every partial match ranked above every approximate
name. At 5,000 contacts a misspelled name then fell behind the people who
shared one word of it.

**Nicknames.** When the first token of a query is in a nickname group, the
other names of the group also match, on the name column only. "Bob
Castellanos" finds Robert Castellanos, and "Peggy Ellington" finds Margaret
Ellington. Only the first token gets the other names, so a sentence such as
"people I will meet" does not look for William. The query as typed matches
first, and the nickname matches follow it. A rare nickname scores higher in
BM25 than a common name, so "Margaret" would otherwise list Maggie and Peggy
above every Margaret. Partial matches use the query as typed only. The
approximate-name step uses the other names of every token.

**Phone numbers.** A query is a phone number when it has at least 7 digits
and nothing but digits, spaces and `+()-.` (`isPhoneQuery` in
`server/utils/nlp/phone.ts`). The index keeps each stored number with its
digit forms: all its digits, its last 10 digits and its last 7 digits. The
query looks for its own digits, its last 10 digits and its last 7 digits. A
number typed with or without its country code, with a trunk zero, or as a
local number therefore finds its contact. "4155550142", "14155550123",
"01614960321" and "5550147" all work. A phone number that matches is the
whole keyword answer.

**Approximate names.** `findApproximateNameMatches`
(`server/services/search/approximateName.ts`) gets its candidates from two
sources:

1. One FTS query on the name column. It asks for each token's 3-letter
   prefix (for tokens of 4 letters or more), its 2-letter prefix and its
   nickname variants. BM25 sorts the rows, and the first 200 stay. The
   2-letter prefix stays because "Kristof" and "Krzysztof" share only "kr".
2. The Double Metaphone codes of the whole query and of each token. The
   index on (ownerId, phoneticHash) finds the contacts whose stored code is
   equal, in id order, at most 200.

`nameScorer` then scores each candidate, and a score of 0.75 or more is a
match. Before this change, the step took 50 prefix rows in no order and
compared the phonetic codes with `LIKE`.

**Weighted fusion.** `reciprocalRankFusion` joins ranked lists. Each list
has a channel and a weight. A contact's score is the sum of
`weight / (k + rank)` over the lists that rank it, and ranks start at 1. The
query's kind gives the keyword (`lexical`) and vector (`dense`) lists their
weights. In Ask Contrack a local kind never reaches the fusion, because the
strict keyword result answers it.

Each soft trait of a plan (`should.traits`) adds a `trait` list. The trait
lists share a weight of 0.3. Each trait list ranks its contacts in the fused
order of the keyword and vector lists. Before this change, every trait match
had rank 1, under the `vector` label. Equal scores keep the order in which
the lists reached the contacts, so every run gives the same order.

`RRF_K` stays 15. On the 70 golden queries, k = 15, 30 and 60 all gave
recall@10 1.00, and k = 15 gave the best fused MRR. See
[Search reliability](../search-hardening.md#ranking-and-the-fusion-constant).

### The local cross-encoder

A cross-encoder reads the question and one profile together and scores how
well they fit. `rerankLocal` (`server/services/search/crossEncoder.ts`)
scores the top 30 of the local list for a question and sorts them by that
score. The rest of the list stays in its fused order. The model is
`Xenova/ms-marco-TinyBERT-L-2-v2`, 4.5 MB at 8 bits, and it runs on the CPU
worker beside the embedding model. It loads once when the server starts.

- **Questions only.** The stage runs for the `conceptual` kind: a question
  word or five words or more. A name, an email, a phone number and a quoted
  phrase never reach it. A short `mixed` query keeps its fused order too,
  because it is usually a misspelled name or the first letters of one, and
  a cross-encoder is not typo-tolerant. On the search gate's corpus at 5,000
  contacts it moved "Shivaun Murphey" from 2nd to 9th and "Thwa" from 1st
  to 4th.
- **What it reads.** The name, role, company, location, industry, headline,
  the first 200 characters of the about text, the tags and the interests,
  cut to 128 tokens with the question. Without the about text, the golden
  questions that quote a note ("lorry full of rose stuck at the border")
  lost their contact.
- **The budget.** `SEARCH_RERANK_BUDGET_MS`, 25 ms by default. The scores
  that come back later are dropped, and the list keeps its fused order. A
  job still waiting behind an embedding backfill is cancelled.
- **Off.** `SEARCH_RERANK_MODEL=off`. With no model, or a worker that did
  not start, the stage is skipped.
- **Where it runs.** On the instant chunk, and on every local final answer:
  AI off, a failed or slow model, an edit during the search. The planner's
  answer is not reordered.

Measured with `node scripts/benchmark-search.ts --rerank-sweep`: the stage's
p95 on the golden questions, and recall@10 / MRR of the local answer on all
70 golden queries.

| Model                 | Candidates | p95, 5,000 contacts | 300 contacts  | 5,000 contacts |
| --------------------- | ---------- | ------------------- | ------------- | -------------- |
| none (fused order)    |            |                     | 1.000 / 0.983 | 1.000 / 0.983  |
| TinyBERT-L-2 (chosen) | 10         | 3.3 ms              | 1.000 / 1.000 | 1.000 / 0.993  |
| TinyBERT-L-2 (chosen) | 30         | 10.5 ms             | 1.000 / 1.000 | 1.000 / 0.993  |
| TinyBERT-L-2          | 50         | 17.7 ms             | 1.000 / 1.000 | 1.000 / 0.993  |
| MiniLM-L-6            | 10         | 30.8 ms             | 1.000 / 1.000 | 1.000 / 0.993  |
| MiniLM-L-6            | 30         | 100.4 ms            | 1.000 / 1.000 | 1.000 / 0.993  |

Both models give the same answers here, so the budget decides: MiniLM-L-6
does not fit 25 ms even for 10 candidates. 30 candidates reorder the whole
instant list with no extra retrieval.

### Evidence and reasons

The compact reranker (`rerankCandidates` in
`server/ai/services/searchIntel.ts`) returns three values for each match:
`contact_id`, `verified_field` and `verified_value`. It writes no reason
sentence. Its output limit is 1,200 tokens, where it was 3,000. The server
checks each match before it keeps it:

1. The id is one of the candidates.
2. The value is a literal substring of the named field.
3. The hard constraints of the plan hold.
4. The value passes `sanitizeAiOutputValue`.

The candidates go to the model with short ids, `c1` to `c30`, and the server
maps each short id back to the contact. A contact id is a UUID of about 25
tokens. With UUIDs, 30 matches overran the 1,200-token limit, the answer
array was cut off, and the whole answer failed its check.

Verified matches keep the candidate order, which is the retrieval order.
When the plan has a recency constraint, the prompt tells the model that the
database already checked it. Candidates carry no dates. Before this change,
the model rejected every recency match. The prompt also tells the model to
cite a name as the candidate's field spells it. A misspelled name that
reaches the model then passes the substring check.

The server builds each reason with `buildReason(contact, evidence)` in
`server/services/search/reasons.ts`. The evidence names the fields that a
filter, a facet or the reranker proved. Each proven field adds one part:

| Proven field         | Part                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ |
| Role                 | The role as written. With a proven company: "Product Manager at Northwind Logistics" |
| Company              | "Works at X"                                                                         |
| Location             | "Based in X"                                                                         |
| Industry             | "Works in X"                                                                         |
| Tag                  | "Tagged X"                                                                           |
| Interest             | "Interested in X"                                                                    |
| Headline             | The headline text                                                                    |
| About or preferences | "Profile mentions “X”"                                                               |
| Last contact         | "Last contact 4 months ago." or "No contact logged."                                 |

A reason joins at most two parts: "Product Manager at Northwind Logistics,
based in Lisbon, Portugal." A reranker match starts with the field that the
model cited, then the filter's evidence. The text comes from the contact's
own fields, so it is exact. When no evidence is left, the card shows no
reason line. A name match is one example.

A facet proves its field too. `tag:rare` gives "Tagged rare.", and
`location:lisbon` gives "Based in Lisbon, Portugal." when that is the
contact's location. `contacted:` proves the last contact. A facet on a
score, an edit date, a list, a distance, a missing field or tracking adds
no part.

### Speed and the search lane

Measured p95 at 5,000 contacts, with
`node scripts/benchmark-search.ts --contacts 5000`:

| Step                                                     | p95            |
| -------------------------------------------------------- | -------------- |
| A name, answered locally                                 | 4.5 ms         |
| An email, answered locally                               | 3.2 ms         |
| A phone number, answered locally                         | 0.8 ms         |
| A question that is only facets                           | 2.7 ms         |
| A known place, company or industry, answered locally     | 4.4 ms         |
| `localRetrieval`                                         | 8.7 to 14.5 ms |
| The instant chunk for a question, with the cross-encoder | 25.1 ms        |
| The instant chunk for any other query                    | 13.2 ms        |

The benchmark calls `localRetrieval` with no kind, so the row also holds
the strict keyword search that decides the kind. Ask Contrack passes the
kind it already has. See the PR for the live numbers of the model stages.

The planner, the reranker and the brief run in the AI queue's search lane
(`GenerationQueue` in `server/ai/workQueue.ts`). The lane has 2 slots of its
own and one first-in, first-out queue. At most 16 calls wait in it, and the
next call gets `429 AI_BUSY`. An Ask search that meets this error answers
with the local list. The lane has no priorities and no fair share, because a
person waits for every call in it. The shared lane keeps its 2 slots, its
priorities and its fair share. One server can therefore send up to 4 calls
at once to a provider. On 2026-09-26 an Ask question waited 12 s behind two
research calls and answered with nothing.

### The semantic cache

L1 answers a question typed the same way twice. L2
(`server/services/search/semanticCache.ts`) answers the same question asked
in other words, such as "founders of Berlin startups" after "Berlin startup
founders", with no model call. It keeps the verified answers of the last 5
minutes, at most 100 per account, with the question's vector. A new
question reuses one when all of these hold:

- the same account and the same `search_revision`, so no contact has
  changed and no merge has happened since;
- the same facets, and the same provider and model;
- the same entity key: the capitalized words, numbers, quoted phrases and
  email addresses of the question, with case and accents folded, and without
  the words that only ask ("Who", "Find", "I");
- a cosine similarity of 0.97 or more between the two question vectors.

The entity key keeps "founders in Munich" from the answer to "founders in
Berlin", however close their vectors are. Measured on the built-in model,
city swaps score 0.79 to 0.85 and word-order paraphrases 0.96 to 0.99. The
threshold holds for the built-in model only, so a provider's embedding
model leaves L2 off. The question is embedded once, in about 1 ms, before
the planner starts, and the local list and the planner stage read the same
vector.

An answer is kept only when a model or the database verified it. A hit goes
into L1 for its exact words, but not into L2 again, so a chain of near
questions cannot drift away from the one that was answered. An edit or a
merge bumps the revision, and every older entry stops matching. A change of
AI settings empties both tiers.

### Query Examples

| Query                                     | What it finds                                            |
| ----------------------------------------- | -------------------------------------------------------- |
| "fintech contacts in SF"                  | Contacts at fintech companies located in San Francisco   |
| "people I haven't talked to in 3 months"  | Contacts with stale interaction history                  |
| "investors who might be interested in AI" | Investor-tagged contacts with AI-related interests       |
| "Jane's coworkers at Stripe"              | Contacts who share Stripe as their company               |
| "engineers who went to Stanford"          | Contacts with matching education + role                  |
| "Jonathon Smyth"                          | Jonathan Smith, marked Approximate, with no model call   |
| "+1 (415) 555-1234"                       | The contact with that phone number, with no model call   |
| "4155551234"                              | The same contact, from the digits alone                  |
| "Peggy Ellington"                         | Margaret Ellington, from her nickname                    |
| "people in Lisbon"                        | The contacts based in Lisbon, with no model call         |
| "tag:investor contacted:>90d"             | Investors with no contact in 90 days, with no model call |

A role in the question finds the other forms of its word in a title
(`roleVariants` in `server/ai/queryConstraints.ts`): "engineers" finds a
contact whose role is Engineering, "designers" finds Design, and "who works
in marketing" finds a Marketer. The first words of a role stay as they are,
so "software engineers" still means software. The hard filter and the check
after the rerank read the same forms, so a contact the filter lets in is not
dropped later. They matched whole words only, and "engineer" found nobody in
an Engineering role.

Some place phrases in a question are places only because a planner matcher
sits inside them (`extractQueryLocations` in `server/ai/searchLocations.ts`).
Such a phrase now ends where the matcher ends. "who in Lisbon goes rock
climbing" gives the place "Lisbon". It gave "Lisbon goes rock climbing"
before, and that place matched nobody. "Cambridge, Massachusetts" still
parses whole.

**API:** `POST /api/search/semantic`

---

## Local Embeddings

Every contact gets a 384-dimension vector embedding generated locally using Transformers.js (`all-MiniLM-L6-v2`). These embeddings:

- Are generated on first boot and when contacts are created/updated
- Power the vector KNN arm of the search pipeline
- Run entirely locally — no API calls, no network dependency
- Are stored in a `vec0` virtual table (`search_embeddings`), one byte per component

**int8 storage.** `search_embeddings` is `INT8[384]`: 384 bytes per vector,
a quarter of the 1,536 a float vector takes. One scale for the whole table
turns a component into a byte, `round(component × scale)`, clamped to ±90.
The scale is 90 over the largest component the table held when it was set,
and `app_settings` keeps it as `search.vectorScale`. The query goes through
the same scale, so the order of the neighbours is kept up to rounding
(`server/services/search/vectorScale.ts`).

The range stops at ±90, not ±127, because sqlite-vec 0.1.9 squares each
byte difference in 16 bits on its NEON path. A difference of 182 or more
overflows, and the distance comes back NULL or small: at ±127 a vector
pointing the opposite way could rank as the nearest. At ±90 no difference
passes 180.

- **The boot migration.** A float table is read out, quantized with one
  scale over all its vectors, recreated as int8 and written back, in one
  transaction. Nothing is re-embedded, and the owner partition and the
  status columns carry across.
- **A new table.** The first write to an empty table sets the scale from
  the vectors it carries: the first backfill batch of 64, or a whole
  evaluation corpus. A later vector with a larger component is clamped.
- **A new model.** Changing the embedding model rebuilds the table and
  drops the scale. The first write after it sets a new one.
- `contact_embeddings`, the dedupe store, stays float. Dedupe compares its
  distances with fixed thresholds.

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
- **Filters:** Two rows of pills narrow the list, with one choice in each row. **Contacts** is All, Tracked, Has links, Has email or No data. **Research** is Any, Not yet, 6+ months ago (the last research is more than 183 days old) or Found nothing (the last research found no page). A contact shows when it matches both rows. Each pill counts the contacts it would show beside the other row's choice. A new choice clears the selection, so a contact the list hides is never started. Both choices stay in the page's address, such as `?contacts=tracked&research=stale`, so the browser's Back from a contact returns to the same list. A row whose last research found no page has a **No page** badge. On a phone a row's date is short: "Jan 20" within this year, "Dec 2025" before it. The slim contact list carries the last run's outcome as `researchOutcome` for the filter and the badge.
- **Open a contact:** Each row ends with a link, "Open" and the contact's name, beside the row's checkbox control. The contact page's Back then says **Contact enrichment** and returns to the filtered list, which is the way to add a detail for a contact research found nothing on.
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

The figures describe research on Gemini, where they were measured. When research runs on another provider, the Enrichment page, its confirmation and the enrich menus say what each depth does and show no time or cost. The note under the tiles says "Costs are Google's 2026 Gemini prices": Gemini 3.8 Flash's token prices double in January 2027, and the figures need measuring again then.

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

- **One LinkedIn profile.** When the contact has a LinkedIn profile, a researched profile under another handle is someone else with the same name, and it is left out. The same handle at another address, such as `uk.linkedin.com`, is the profile the contact has. A contact with none gets the first researched profile.
- **A removed entry stays removed.** The research record keeps every list entry research added (`addedEntries`, up to 150). A new entry that matches one of them, the way the merge matches a saved entry, is left out: the contact does not have it, so the person removed it. This holds for schools, jobs, links, emails, phones, addresses, facts, interests and tags. A field such as the location or the headline, once cleared, can be filled again.

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
- Two concurrent AI generations and 16 waiting generations per server, in the shared slots. Ask Contrack's model calls have a lane of their own (see [Speed and the search lane](#speed-and-the-search-lane))
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

From the search results view or Command Palette, click **Synthesize these results** to generate an executive brief from the matched contacts:

- Summarizes the group composition
- Highlights common themes and connections
- Streams via NDJSON as the model writes it: the text grows in one box, and the final text replaces it
- Starts only when you press the button, never by itself

The server sends each piece of the brief as the model writes it. Each piece
loses its control characters. The pieces stop when the text so far matches
an injection pattern or passes 2,000 characters. The final text is the whole
brief after `sanitizeAiOutputValue`. The stream ends with an error when the
contacts changed while the model wrote the brief, or when the sanitizer
rejects the text. The client then removes the provisional text. A cached
brief arrives whole, with no pieces. The "Summary status" live region
announces only the final text. The brief runs in the search lane.

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

- Outbound requests to generative AI endpoints return `403 AI_OFF_FOR_ACCOUNT` (enforced by `requireAiAllowed` middleware on all AI-cost routes). `POST /api/search/semantic` is the one exception.
- Ask Contrack still answers, on the Ask page and in the palette's `?` mode. `requireAiAllowed` lets `POST /api/search/semantic` through. The route reads the caller's `aiAssist` with `aiAllowedFor(req)` and passes `aiAllowed` to the service. The service skips every model stage: the planner, the reranker and a provider embedding of the query. The built-in local model still embeds the query. The answer is the local list, marked unverified. The AI rate limiters still count the path. Before this change, the Ask page and the palette's `?` mode failed with 403.
- The client suppresses AI generation triggers including Dossier briefing buttons, contact enrichment buttons, command palette enrichment actions, and group synthesis buttons.
- The Dashboard daily insight card displays an informative message explaining that AI is disabled for the account, with a link to Privacy settings.
- Fast local retrieval remains fully operational: SQLite FTS5 full-text search, local vector embeddings, and direct query filtering continue running entirely on your machine with zero external network requests.

---

## Indexing Coverage and Empty State

The page leads with the search box: the mode's glyph, the question, Clear, and a square search button with the magnifying glass alone. Enter or the button asks. Notes mode uses the same box (see [Note Search](interaction-search.md#the-page)). The header is the title and the People and Notes switch, with no line of description. Below `lg` a History button sits beside the switch.

- **One status line:** In People mode, while contacts are missing from the index, indexing runs, or a contact failed, one line sits under the search box: a thin progress bar, the words ("12 of 30 contacts indexed", or "Indexing 12 of 30…" while it runs) and quiet text buttons for **Index missing**, **Inspect failed** and **Retry failed**. The line is a region named "Semantic search coverage". It hides at 100 percent with nothing running. The paid-provider confirmation and the failed-contacts dialog open from its buttons.
- **Try asking:** Before a search, the page shows suggested questions as flat chips. A click fills the box and runs the search. In People mode the first three come from your own network, its most common industry, city and company ("Who works in Music Streaming?", "Who do I know in Sydney?", "Who works at TechNova?"), so a press always finds someone. Fixed examples fill the rest. People search reads profiles, not dates, so no suggestion asks about when you last spoke. Notes mode shows no suggestions.
- **No results:** "No one matches" with "Try other words." The status line above already says when the index is incomplete.
