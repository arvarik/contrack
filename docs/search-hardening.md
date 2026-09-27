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

Automatic contact refreshes use local embeddings of saved fields.
Contact edits no longer request AI keyword expansion. The migration clears older inferred expansion terms.
This reduces AI work and prevents inferred keywords from becoming search evidence.
Pinned provider embeddings remain available through the embedding-store backfill path.
Automatic local refreshes skip provider embeddings. Until a backfill runs, keyword search covers those edited contacts.

## Ask Contrack's local answers

A name, an email, a phone number or one quoted phrase gets its answer from the keyword index.
No model runs for these queries, so a provider outage cannot delay them.
`classifyQuery` in `server/services/search/intent.ts` decides the kind before any model runs.
Every other question gets a local list first. `localRetrieval` fuses the keyword and vector channels, with no planner.
That list is the final answer when AI is off for the account or no provider is set.
An error, a timeout or an edit in the account during the model stages ends with a fresh local list.
The keyword-only list (`searchFts`, recall@10 0.52) is never the Ask answer now.
`hybridRetrieval` keeps its signature and runs `localRetrieval` inside the plan's hard filter.
The search gate therefore measures the same arithmetic that Ask runs.
The planner, the reranker and the brief run in the AI queue's search lane, which has two slots of its own.
Research calls hold only the shared slots, so an Ask question does not wait behind them.

## The note index

`interactions_fts` mirrors `interactions` by rowid, the way `contacts_fts` mirrors `contacts`.
Three triggers keep it in step inside the note's own transaction. A contact's deletion cascades to its notes, and the cascade fires the delete trigger.
The body is indexed as plain text. The triggers call a SQL function the server registers, so every write path is covered and no HTML tag or mention id becomes a searchable word.
The tokenizer stems and folds diacritics. The contact index does not stem, because names are not prose.
Every search statement carries the owner three times: in the FTS5 match expression, on the interaction row, and on the contact row.
Notes on archived, trashed, merged and ghost contacts are hidden at query time, so restoring a contact needs no index change.
The date filter normalises every stored date shape with `strftime` before it compares, because a space sorts before a `T`.
The date phrase parser is deterministic and works in the caller's zone. It calls no model.
Both FTS tables live under one version gate, `PRAGMA user_version`, now 4. See [Note Search](features/interaction-search.md).

## Verification

Run `npm test` for keyword syntax, visibility, child updates, migration, filtered retrieval, and asynchronous write regressions.
`tests/integration/search.interactions.test.ts` covers the note index: every write path, hidden contacts, HTML stripping, stemming, every stored date shape, date phrases by zone, paging, validation, and the MCP route.
`tests/integration/search.fastPath.test.ts` covers the local answers, the local list with AI off, and the local list after a provider failure.

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
It also gives p50 and p95 for the local answer or the instant chunk, as a person gets it.
It ends with recall@10 and MRR per channel for the 50 golden queries.

Run `--live` for the real pipeline with the configured provider.
It builds the same database, then runs ten queries, three cold runs each.
It takes each model stage's time from the adapter's own latency.
Then it runs one query again while two 15-second background jobs hold both shared AI slots.
Load the provider key first: `(set -a; . ../contrack/.env; set +a; node scripts/benchmark-search.ts --live)`.
A live run costs a few cents. The script never prints a key.
`--json` prints one JSON document, `--runs N` sets the timed repetitions per query (default 5, 3 for `--live`), and `--verbose` keeps the server's log lines.

Measured locally at 5,000 contacts on an Apple M5 Pro:

| Stage                         | p95            |
| ----------------------------- | -------------- |
| Sidebar keyword search        | 3.6 to 4.2 ms  |
| Lexical search, an exact name | 3.5 ms         |
| Query embedding               | 1.1 ms         |
| KNN                           | 0.8 ms         |
| `localRetrieval`              | 8.3 to 11.5 ms |

The answers as a person gets them, at 5,000 contacts:

| Answer                           | p95             |
| -------------------------------- | --------------- |
| A name, answered locally         | 4.9 ms          |
| An email, answered locally       | 5.0 ms          |
| A phone number, answered locally | 1.0 ms          |
| The instant chunk                | 15.6 to 17.6 ms |

See the PR for the live numbers.

The implementation follows [SQLite FTS5](https://www.sqlite.org/fts5.html) and [sqlite-vec KNN guidance](https://alexgarcia.xyz/sqlite-vec/features/knn.html).
The regression suite also checks the installed sqlite-vec version with a text-primary-key filter.
