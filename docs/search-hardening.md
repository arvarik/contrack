# Search reliability

Keyword search treats input as literal Unicode tokens. It matches token prefixes across contact fields.
Every search channel excludes ghost, archived, merged, and trashed contacts.
The retrieval query applies contact filters before the result limit.

The FTS migration uses each contact's SQLite rowid for its index row.
An edit deletes one index row through that rowid. It does not scan every contact ID.
The migration installs triggers and rebuilds the index in one transaction.
Child inserts, edits, moves, and deletes refresh both affected contacts.

Contact edits remove obsolete vectors in the same transaction.
An asynchronous embedding write compares its source text and model with the current values before saving.
Search cache keys include the database revision and a five-minute time window.
An Ask Contrack key also holds the provider and the model, or `local` when AI is off or no provider is set.
An AI-off request therefore never reads an entry that a model verified.
An older request cannot repopulate the current search cache after a contact change.
The semantic cache (L2) keeps verified answers by question vector, with the same revision in each entry.
An edit or a merge bumps the revision, so no older entry matches a later question.
Each entry also carries the facets, the provider and model, and the question's entity key, and one account never reads another's.
The constraint key preserves word order and comparison operators after proven facets and leading request words are removed.
This rejects similar vectors for different questions, including opposite career transitions and changed logical operators.
The cache lookup rechecks the revision after embedding to reject stale answers after an edit during that wait.

Automatic contact refreshes use local embeddings of saved fields.
Contact edits no longer request AI keyword expansion. The migration clears older inferred expansion terms.
This reduces AI work and prevents inferred keywords from becoming search evidence.
Pinned provider embeddings remain available through the embedding-store backfill path.
Automatic local refreshes skip provider embeddings. Until a backfill runs, keyword search covers those edited contacts.

## Ask Contrack's local answers

A name, an email, a phone number or one quoted phrase gets its answer from the keyword index.
A question that is only facets gets its answer from the database.
So does a question that names a known place, company or industry and asks for nothing more.
No model runs for these queries, so a provider outage cannot delay them.
`classifyQuery` in `server/services/search/intent.ts` decides the kind before any model runs.
Every other question gets a local list first. `localRetrieval` fuses the keyword and vector channels, with no planner.
That list is the final answer when AI is off for the account or no provider is set.
An error, a timeout or an edit in the account during the model stages ends with a fresh local list.
The keyword-only list (`searchFts`, recall@10 0.52) is never the Ask answer now.
`hybridRetrieval` keeps its signature and runs `localRetrieval` inside the plan's hard filter.
The search gate's `fused` channel therefore measures the same arithmetic that Ask runs.
The planner, the reranker and the brief run in the AI queue's search lane, which has two slots of its own.
Research calls hold only the shared slots, so an Ask question does not wait behind them.

## The contact index

Every row carries the owner's token, "o" and the owner's id in hex, and every query matches it first.
The query's words never match that column: `scopedMatch` excludes it with `- {ownerTok} :`.
Before, the word "of" matched the token of every owner whose id starts with f, in every one of that owner's rows.
The note index shares the same rule.

`contacts_fts` is at FTS version 5 (`FTS_SCHEMA_VERSION` in `server/services/search/ftsIndex.ts`).
Version 5 gives tags and interests a column of their own, `tags`.
It also adds the digit forms of each phone number to `extras`.
The first boot on version 5 rebuilds both FTS tables once.

`bm25()` reads one weight per column, by position (`WEIGHTS` in `server/services/search/lexical.ts`):

| Column            | Holds                                                     | Weight |
| ----------------- | --------------------------------------------------------- | ------ |
| `contactId`       | The contact id, `UNINDEXED`                               | 0      |
| `name`            | The name                                                  | 10     |
| `company`         | The company                                               | 5      |
| `role`            | The role                                                  | 3      |
| `headline`        | The headline                                              | 2      |
| `location`        | The location                                              | 2      |
| `about`           | The about text                                            | 1      |
| `industry`        | The industry                                              | 1      |
| `tags`            | Tags and interests                                        | 3      |
| `extras`          | Emails, and each phone number followed by its digit forms | 1      |
| `searchExpansion` | Search expansion terms                                    | 0.5    |
| `ownerTok`        | The owner token, a filter only                            | 0      |

Tags and interests were in `extras` before, with weight 1. Now they weigh 3, as much as a role.

The digit forms of a phone number are all its digits, its last 10 digits and its last 7 digits, each once.
The trigger removes the separators that people type: spaces, `-`, `.`, `(`, `)`, `+`, `/`, `\`, a tab, and some Unicode spaces and dashes.
When only digits are left, the trigger adds the forms.
A number with another character left, such as an extension written "x12", gets no digit forms. Its written tokens still find it.
The forms use plain SQL, not a function that the server registers.
Every connection that writes a contact runs the triggers, and a backup check or `sqlite3` in a shell has no such function.

A phone query looks for its digits, its last 10 digits and its last 7 digits.
A number typed with or without its country code, with a trunk zero, or as a local number therefore finds its contact.

## Facets in SQL

`compileFacets(scope, filters)` in `server/services/search/facetSql.ts` turns facets into one predicate over the contacts alias `c`, with its parameters.
Every facet must hold.
The keyword search, the approximate-name step, the vector KNN, the plan's hard filter and the trait lists apply the predicate before their limit.
No filtered contact is therefore lost to a cut.
`searchService.searchFts` no longer scans every contact in JavaScript before the keyword search.

The SQL calls the JavaScript that the palette runs, so the server and the palette keep the same rows.
The server connection registers three SQL functions:

- `facet_contains` is the lower-casing and substring test of `matchesFacet`.
- `facet_time` reads a date as `matchesFacet` reads it, with `parseServerTime`.
- `haversine_km` is the distance of `shared/geo.ts`.

Three facets need more than one column:

- `missing:` compares blank values with the whitespace set of JavaScript's `trim()`. SQLite's `trim()` removes only spaces.
- `list:` finds the owner's list ids first, by id, by name, or by the name with dashes. Then it uses `EXISTS` on `list_members`.
- `near:` with no point adds no predicate. With a point, it checks a bounding box on the same sphere as `haversineKm`, then the exact distance. The box has no longitude bound when the circle reaches a pole or the 180th meridian.

`facetKey(filters)` is a cache key that does not change with the order of the facets.
Ask Contrack puts it in the L1 cache key and in the key that lets identical requests share one search.
`tests/unit/search.facetSql.test.ts` checks that every facet keeps the same rows in SQL as in `matchesFacet`.

## Local models and vector storage

A local cross-encoder reorders the top 30 of the local list for a `conceptual` question.
It runs on the CPU worker inside `SEARCH_RERANK_BUDGET_MS`, 25 ms by default.
Scores that arrive later are dropped, and the list keeps its fused order, so the stage cannot delay the list past its budget.
Names, emails, phone numbers, quoted phrases and short `mixed` queries keep their fused order, because a cross-encoder is not typo-tolerant.
See [The local cross-encoder](features/ai-search.md#the-local-cross-encoder) for the measurements.

`search_embeddings` stores int8 vectors, one byte per component at one scale for the table.
The scale lives in `app_settings` as `search.vectorScale`, and the query goes through the same scale.
A byte is at most ±90: sqlite-vec 0.1.9 squares each byte difference in 16 bits on its NEON path, and a difference of 182 or more overflows.
The boot migration turns a float table into int8 in one transaction, with no re-embedding, and keeps the partition key and the status columns.
Compared with float on the same vectors:

| Contacts | Bytes per vector | Table             | KNN p95, k = 100 | int8 top 10 in float's top 10 |
| -------- | ---------------- | ----------------- | ---------------- | ----------------------------- |
| 5,000    | 1,536 → 384      | 8.2 MB → 2.6 MB   | 0.6 ms → 0.5 ms  | 0.98                          |
| 50,000   | 1,536 → 384      | 80.1 MB → 24.9 MB | 6.0 ms → 4.3 ms  | 0.97                          |

The top 10 differ in near ties among look-alike generated profiles.
The contacts the golden questions expect stay in them: the vector channel alone scores recall@10 0.762 with both at 5,000, and 0.591 with both at 50,000.
The search gate's `hybrid` channel moved by one rank on one question, from MRR 0.983 to 0.982, inside the gate's tolerance.

## Ranking and the fusion constant

The local list fuses the keyword and vector lists by weighted reciprocal rank (`reciprocalRankFusion` in `server/services/search/hybridRetrieval.ts`).
The query's kind sets the weights: lexical 0.7 and dense 0.3 for the local kinds, 0.3 and 0.7 for `conceptual`, and 0.5 and 0.5 for `mixed`.
The trait lists of a plan share a weight of 0.3.
See [Ranking](features/ai-search.md#ranking) for the keyword tiers, nicknames and phone numbers.

`RRF_K` stays 15. `--rrf-k N` sets the constant for one benchmark run, and `measure(scope, queries, idByKey, { rrfK })` in the gate's harness takes it too.
A sweep over the 70 golden queries gave recall@10 1.00 at every k. The fused MRR was best at k = 15:

| k   | Fused MRR, 300 contacts | Fused MRR, 5,000 contacts |
| --- | ----------------------- | ------------------------- |
| 15  | 0.950                   | 0.917                     |
| 30  | 0.942                   | 0.915                     |
| 60  | 0.942                   | 0.906                     |

The hybrid MRR was 0.983 at every k.

Name scoring is faster, and its scores are the same.
`damerauLevenshtein` keeps three rows in place of the whole table.
`singleTokenScore` skips the table when two tokens differ in length by more than 2 and do not sound alike.
`nameScorer(query)` in `server/utils/nlp/names.ts` tokenizes the query once and keeps the score of each token pair. `nameSimilarity(a, b)` is `nameScorer(a)(b)`.
A comparison of 632,520 name pairs with the old code found 0 differences.

## The note index

`interactions_fts` mirrors `interactions` by rowid, the way `contacts_fts` mirrors `contacts`.
Three triggers keep it in step inside the note's own transaction. A contact's deletion cascades to its notes, and the cascade fires the delete trigger.
The body is indexed as plain text. The triggers call a SQL function the server registers, so every write path is covered and no HTML tag or mention id becomes a searchable word.
The tokenizer stems and folds diacritics. The contact index does not stem, because names are not prose.
Every search statement carries the owner three times: in the FTS5 match expression, on the interaction row, and on the contact row.
Notes on archived, trashed, merged and ghost contacts are hidden at query time, so restoring a contact needs no index change.
The date filter normalises every stored date shape with `strftime` before it compares, because a space sorts before a `T`.
The date phrase parser is deterministic and works in the caller's zone. It calls no model.
Both FTS tables live under one version gate, `PRAGMA user_version`, now 5. See [Note Search](features/interaction-search.md).

## Verification

Run `npm test` for keyword syntax, visibility, child updates, migration, filtered retrieval, and asynchronous write regressions.
`tests/integration/search.interactions.test.ts` covers the note index: every write path, hidden contacts, HTML stripping, stemming, every stored date shape, date phrases by zone, paging, validation, and the MCP route.
`tests/integration/search.fastPath.test.ts` covers the local answers, the local list with AI off, and the local list after a provider failure.
`tests/integration/search.lexical.test.ts` covers the forms of a name among 5,000 contacts: a nickname, phone digits, a hyphenated name, a prefix and a misspelling.
`tests/integration/search.filters.test.ts` covers the facets before the limit, every facet over HTTP, facets in Ask, and the implicit facets with their traps.

The search gate (`tests/eval/search.eval.test.ts`, with `tests/eval/harness.ts`) runs 70 golden queries over the 300 contacts of `scripts/search-eval/corpus.ts`.
It had 50. Five kinds are new, with 4 queries each.
They are a nickname and a surname, a phone number as digits, an email address, a hyphenated name, and the first letters of a rare name.
Eight targets now have emails or phone numbers, and "Anne-Marie Dubois-Laurent" is a new target.
The gate scores five channels:

- `sidebar` is `searchService.searchFts`, the sidebar search.
- `lexical` is `lexicalSearch` in broad mode.
- `fused` is `hybridRetrieval` with no plan: the keyword and vector lists, fused by weighted RRF. The weights and k move this number.
- `hybrid` is what Ask Contrack answers without a model, with the cross-encoder off. A name, an email or a phone number gets the strict keyword answer. A question that names a known place, company or industry gets its implicit facets. Every other question gets the fused list.
- `reranked` is `hybrid` with the cross-encoder on. It replays the scores recorded in `tests/fixtures/search-eval/rerank-scores.json`, so the gate needs no model, and a pair the recording lacks fails the gate.

The baseline at 300 contacts, as recall@10 / MRR:

| Channel    | Now           | v2.0, 50 queries                     |
| ---------- | ------------- | ------------------------------------ |
| `sidebar`  | 0.657 / 0.657 | 0.52 / 0.52                          |
| `lexical`  | 1.000 / 0.936 | 0.98 / 0.89                          |
| `fused`    | 1.000 / 0.949 | 1.00 / 0.86, under the name `hybrid` |
| `hybrid`   | 1.000 / 0.982 | No channel                           |
| `reranked` | 1.000 / 1.000 | No channel                           |

`scripts/benchmark-search.ts` has three modes. Each mode uses a temporary database and never opens the user's database.

Run `node scripts/benchmark-search.ts` for 10,000 simple rows.
This mode measures 100 contact edits and 100 keyword searches.
It had been broken since tenancy made `ownerId` required. It now inserts its rows under the local owner.

On the development machine, the edit p95 decreased from 3.094 ms to 0.113 ms.
Keyword search p95 decreased from 0.464 ms to 0.235 ms.
These measurements describe this benchmark, not a production latency guarantee.

Run `node scripts/benchmark-search.ts --contacts 5000` for the Ask Contrack numbers.
The database holds the search-gate corpus (300 contacts) plus generated contacts, 5,000 in all by default.
Faker generates the contacts from a fixed seed.
70 percent of them have an email, 50 percent have a phone, and 600 have a last-contact date in the last 14 months.
The vectors are real MiniLM vectors when the model is present. The script reads the bundled model from `node_modules/@huggingface/transformers/.cache`.
The report gives p50 and p95 for the sidebar search, lexical search, the query embedding, the KNN, and `localRetrieval` for each query kind.
A sidebar row with one facet uses a tag, an industry, a `contacted:` and a location facet in turn.
The "question" group holds the sentence kinds: a company and a role, a place and an interest, and a phrase from notes.
It also gives p50 and p95 for the local answer or the instant chunk, as a person gets it.
Two more rows time Ask answers with no model: a question that is only facets, and a question with implicit facets.
It ends with recall@10 and MRR for the four channels on the golden queries, and for the name-typo queries of `fused` and `hybrid`.

Run `--live` for the real pipeline with the configured provider.
It builds the same database, then runs ten queries, three cold runs each.
It takes each model stage's time from the adapter's own latency.
Then it runs one query again while two 15-second background jobs hold both shared AI slots.
Load the provider key first: `(set -a; . ../contrack/.env; set +a; node scripts/benchmark-search.ts --live)`.
A live run costs a few cents. The script never prints a key.
`--json` prints one JSON document, `--runs N` sets the timed repetitions per query (default 5, 3 for `--live`), and `--verbose` keeps the server's log lines.
`--rrf-k N` sets the fusion constant for a k sweep. The default is the code's `RRF_K`.

Measured locally at 5,000 contacts on an Apple M5 Pro:

| Stage                                 | p95            |
| ------------------------------------- | -------------- |
| Sidebar keyword search                | 2.5 to 3.7 ms  |
| Sidebar keyword search with one facet | 2.6 ms         |
| Lexical search, an exact name         | 3.2 ms         |
| Query embedding                       | 1.1 ms         |
| KNN                                   | 0.7 ms         |
| `localRetrieval`                      | 8.6 to 14.1 ms |

The sidebar search with one facet took 11.8 to 12.7 ms before, when a JavaScript scan of every contact ran first.
The benchmark calls `localRetrieval` with no kind, so the row also holds the strict keyword search that decides the kind.

The answers as a person gets them, at 5,000 contacts:

| Answer                           | p95             |
| -------------------------------- | --------------- |
| A name, answered locally         | 4.5 ms          |
| An email, answered locally       | 3.2 ms          |
| A phone number, answered locally | 0.8 ms          |
| A question that is only facets   | 2.7 ms          |
| A question with implicit facets  | 4.4 ms          |
| The instant chunk                | 13.0 to 13.1 ms |

The quality at 5,000 contacts, as recall@10 / MRR, is 1.000 / 0.936 for `lexical`, 1.000 / 0.917 for `fused` and 1.000 / 0.983 for `hybrid`.
Before this change, `lexical` read 0.96 / 0.80. The old `hybrid` line measured the fused list and read 0.96 / 0.77, on 50 queries.
On the name-typo queries, recall@10 is 1.00 for `fused` and for `hybrid`. It was 0.80.

See the PR for the live numbers.

The implementation follows [SQLite FTS5](https://www.sqlite.org/fts5.html) and [sqlite-vec KNN guidance](https://alexgarcia.xyz/sqlite-vec/features/knn.html).
The regression suite also checks the installed sqlite-vec version with a text-primary-key filter.
