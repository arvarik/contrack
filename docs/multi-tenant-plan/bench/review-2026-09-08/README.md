# Review evidence, 2026-09-08

Scripts and measurements produced while reviewing the plan against `v1.5.5`.
Run each script from the repository root with the project's `node_modules`
on the path:

```bash
mkdir -p /tmp/contrack-review
NODE_PATH=$PWD/node_modules node docs/multi-tenant-plan/bench/review-2026-09-08/<script>.cjs
```

Machine: Apple Silicon laptop. Node v22.23.2, better-sqlite3 12.11.1 (SQLite
3.53.2), sqlite-vec v0.1.9, Express 5.2.1, multer 2.2.0.

| Script | What it proves |
| ------ | -------------- |
| `01-vec-fts-smoke.cjs` | `TEXT PARTITION KEY` works on 0.1.9. KNN with `ownerId = ?` returns one owner's rows. `DELETE`, `SELECT`, and `COUNT` by partition key work. `UPDATE` of a partition key fails. The 33-character owner token is one FTS5 token. `ownerTok:X AND (...)` wraps all three strategies. `ALTER TABLE ADD COLUMN ... REFERENCES` works with `foreign_keys = ON`. `VACUUM INTO` works. `fs.statfsSync` exists. |
| `02-sqlite-triggers-tx.cjs` | `VACUUM INTO` fails inside a transaction. A `vec0` drop-and-recreate works inside a transaction. The fill, mismatch, and propagate triggers behave as specified. `ON DELETE RESTRICT` refuses to delete an owner with data. FK cascades fire child-table triggers. Nested `sqlite.transaction` is a savepoint. Porter stemming (not used today) would still match the owner token. |
| `03-als-multer-sse.cjs` | `AsyncLocalStorage` context survives multer `destination` and `filename`, `await`, `setTimeout`, and `Promise.all`. An `EventEmitter` listener sees the emitter's context, not the subscriber's: an emit from outside any request context yields `null`. |
| `04-fts-vec-purge-bench.cjs` | The numbers in the table below. 50,000 contacts across 10 owners, two emails each, 384-dim vectors. |
| `05-fts-delete-cidtok.cjs` | `DELETE FROM contacts_fts WHERE contactId = ?` scans the whole FTS table (`contactId` is `UNINDEXED`). An indexed `cidTok` column with `MATCH` is about 400 times faster. Re-runs the claim and the purge with the fixed triggers. |
| `06-live-db-inventory.cjs` | Dumps every table, column, foreign key, index, and trigger from the development database. Read-only. |

## Measurements (script 04 and 05)

Seed: 50,000 contacts, 100,000 emails, 10 owners of 5,000 contacts each.

| Measurement | Result |
| ----------- | ------ |
| Seed 50,000 contacts + 100,000 emails through today's FTS triggers | 271 s (5.4 ms per contact, see the trigger finding below) |
| FTS bulk backfill `INSERT ... SELECT` of 50,000 rows | 233 ms |
| `vec0` copy-rebuild of 50,000 × 384-dim rows into a partitioned table | 923 ms |
| `UPDATE contacts SET ownerId` on 5,000 rows, today's `contacts_au` trigger | 27.1 s |
| `UPDATE contacts SET ownerId` on 5,000 rows, triggers using `cidTok` | 230 ms |
| Purge one owner (5,000 contacts, 10,000 cascaded emails), today's triggers | 77.1 s |
| Purge one owner, triggers using `cidTok` | 198 ms |
| `DELETE FROM contacts_fts WHERE contacts_fts MATCH 'ownerTok:...'` (5,000 rows) | 17 ms |

FTS query latency, owner of 5,000 among 50,000, `LIMIT 50`, p50 / p95:

| Query | Indexed `ownerTok AND (...)` | `UNINDEXED` post-filter | `JOIN contacts` | No owner filter (today) |
| ----- | ---------------------------- | ----------------------- | --------------- | ----------------------- |
| `"john"` | 1.03 / 1.07 ms | 4.96 / 5.17 ms | 10.70 / 11.44 ms | 3.33 / 3.42 ms |
| `"john"* OR "smith"*` | 2.69 / 2.77 ms | 9.35 / 9.87 ms | 18.66 / 19.68 ms | 6.78 / 7.05 ms |
| `design OR studio OR labs` | 2.42 / 2.57 ms | 11.31 / 11.97 ms | 22.18 / 23.31 ms | 8.36 / 8.56 ms |

Vector search, `k = 50`, p50 / p95:

| Query | Result |
| ----- | ------ |
| Partitioned KNN, owner has 5,000 of 50,000 | 1.02 / 1.12 ms |
| Flat KNN over 50,000 (today) | 10.43 / 10.92 ms |
| Flat KNN `k = 500` then JavaScript filter (today's `preFilterIds` path) | 23.54 / 26.13 ms |
| Rows of the global top 100 that belong to the queried owner (expected about 10) | 4 |

The last row is the correctness problem the plan describes in the
architecture document, section 7: a small owner's contacts fall out of the
global top-k.

## The trigger finding

Every FTS trigger in `server/db.ts` begins with
`DELETE FROM contacts_fts WHERE contactId = old.id`. The `contactId` column is
`UNINDEXED`, so FTS5 cannot use its index and SQLite scans every row of the
virtual table. At 40,000 rows that scan costs about 4 ms, and it runs once per
contact update and once per child-row insert or delete. The measured
consequences at 50,000 contacts:

- A contact update costs about 5 ms of FTS work.
- The ownership claim in the migration costs 5.4 ms per contact.
- An owner purge costs about 15 ms per contact (one scan for the contact row
  and one per cascaded child row).

The fix is the same technique the plan already uses for the owner: an indexed
`cidTok` column holding `'c' || replace(id, '-', '')`, and
`DELETE FROM contacts_fts WHERE contacts_fts MATCH 'cidTok:' || ...` in every
trigger. Measured: 0.011 ms per delete instead of 4 ms. The data model document
section 5 adopts this.
