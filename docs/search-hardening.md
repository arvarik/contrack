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
An older request cannot repopulate the current search cache after a contact change.

Automatic contact refreshes use local embeddings of saved fields.
Contact edits no longer request AI keyword expansion. The migration clears older inferred expansion terms.
This reduces AI work and prevents inferred keywords from becoming search evidence.
Pinned provider embeddings remain available through the embedding-store backfill path.
Automatic local refreshes skip provider embeddings. Until a backfill runs, keyword search covers those edited contacts.

## Verification

Run `npm test` for keyword syntax, visibility, child updates, migration, filtered retrieval, and asynchronous write regressions.
Run `npx tsx scripts/benchmark-search.ts` for a temporary database with 10,000 synthetic contacts.
The benchmark measures 100 contact edits and 100 keyword searches. It never opens the user's database.

On the development machine, the edit p95 decreased from 3.094 ms to 0.113 ms.
Keyword search p95 decreased from 0.464 ms to 0.235 ms.
These measurements describe this benchmark, not a production latency guarantee.

The implementation follows [SQLite FTS5](https://www.sqlite.org/fts5.html) and [sqlite-vec KNN guidance](https://alexgarcia.xyz/sqlite-vec/features/knn.html).
The regression suite also checks the installed sqlite-vec version with a text-primary-key filter.
