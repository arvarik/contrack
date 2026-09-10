# Phase 2 benchmark

Measured on `v2.0` after sub-phase 2i, with every query scoped. The Phase 0
file next to this one is the same script on the same machine before any query
carried an owner, so the two are directly comparable.

Reproduce with:

```
npx tsx scripts/bench-tenancy.ts
OWNERS=10 CONTACTS_PER_OWNER=2000 npx tsx scripts/bench-tenancy.ts
```

Two things changed in the script itself, and both are corrections rather than
new measurements:

- `POST /api/dedupe/scan` is timed to completion. The route answers as soon as
  the scan is queued, so timing the request alone measured the enqueue. The
  Phase 0 number happened to be a real scan time because the scan blocked the
  event loop for its whole run, and the scan no longer does. The script now
  polls `/api/dedupe/status` until the scan reaches a terminal phase. At
  `1 x 5000` that reproduces the Phase 0 number to within three percent,
  3419.5 ms against 3507.0 ms, which is the run-to-run spread this shape
  already shows.
- The sample contact for `GET /api/contacts/:id` is owner 0's own. It was the
  first row in `contacts`, which belongs to whichever account seeded first, so
  the multi-owner run answered `404` once that route started checking.

---

# Tenancy benchmark: 10 owner(s) x 2000 contacts

- Machine: Apple M5 Pro, 18 cores, 52 GB
- Platform: darwin 25.6.0 (arm64)
- Node: v22.23.2
- SQLite: 3.53.2
- sqlite-vec: v0.1.9
- Contacts in the database: 20000
- Interactions per contact: 3
- Seed time: 31.3s
- Measured as one signed-in owner, 50 iterations unless noted.

| Endpoint | p50 ms | p95 ms | n | Note |
| -------- | -----: | -----: | -: | ---- |
| `GET /api/contacts?view=slim` | 18.7 | 19.9 | 50 |  |
| `GET /api/contacts/:id` | 0.4 | 0.6 | 50 |  |
| `GET /api/search?q=` | 1.0 | 1.3 | 50 |  |
| `POST /api/search/semantic` | 2.6 | 3.2 | 50 | mock AI, so this is FTS plus vector |
| `GET /api/dashboard` | 4.9 | 5.2 | 50 |  |
| `GET /api/command-palette/zero-state` | 0.5 | 0.6 | 50 |  |
| `GET /api/contacts/:id/timeline` | 1.0 | 1.1 | 50 |  |
| `GET /api/action-items` | 0.3 | 0.3 | 50 |  |
| `PATCH /api/contacts/:id` | 0.6 | 1.1 | 20 | one FTS trigger delete plus reinsert per update |
| `POST /api/dedupe/scan` | 1338.4 | 1346.4 | 3 | wall time to completion, mock AI |

## Isolation spot check

Measured as owner 0 of 10, who owns 2000 of the 20000 contacts.

| Endpoint | rows returned | verdict |
| -------- | ------------: | ------- |
| `GET /api/contacts?view=slim` | 2000 | own rows only |
| `GET /api/search?q=Acme` | 20 | own rows only |
| `POST /api/search/semantic` | 20 | own rows only |
| `GET /api/timeline` | 200 | own rows only |
| `GET /api/query/contacts` | 200 | own rows only |
| `GET /api/export/json` | 2000 | own rows only |

# Tenancy benchmark: 1 owner(s) x 5000 contacts

- Machine: Apple M5 Pro, 18 cores, 52 GB
- Platform: darwin 25.6.0 (arm64)
- Node: v22.23.2
- SQLite: 3.53.2
- sqlite-vec: v0.1.9
- Contacts in the database: 5000
- Interactions per contact: 3
- Seed time: 6.9s
- Measured as one signed-in owner, 50 iterations unless noted.

| Endpoint | p50 ms | p95 ms | n | Note |
| -------- | -----: | -----: | -: | ---- |
| `GET /api/contacts?view=slim` | 49.2 | 55.4 | 50 |  |
| `GET /api/contacts/:id` | 0.4 | 0.6 | 50 |  |
| `GET /api/search?q=` | 1.3 | 1.6 | 50 |  |
| `POST /api/search/semantic` | 3.4 | 4.4 | 50 | mock AI, so this is FTS plus vector |
| `GET /api/dashboard` | 12.1 | 13.8 | 50 |  |
| `GET /api/command-palette/zero-state` | 0.6 | 0.9 | 50 |  |
| `GET /api/contacts/:id/timeline` | 1.9 | 2.2 | 50 |  |
| `GET /api/action-items` | 0.3 | 0.5 | 50 |  |
| `PATCH /api/contacts/:id` | 0.7 | 1.1 | 20 | one FTS trigger delete plus reinsert per update |
| `POST /api/dedupe/scan` | 3419.5 | 3489.2 | 3 | wall time to completion, mock AI |

## Isolation spot check

Measured as owner 0 of 1, who owns 5000 of the 5000 contacts.

| Endpoint | rows returned | verdict |
| -------- | ------------: | ------- |
| `GET /api/contacts?view=slim` | 5000 | own rows only |
| `GET /api/search?q=Acme` | 20 | own rows only |
| `POST /api/search/semantic` | 20 | own rows only |
| `GET /api/timeline` | 200 | own rows only |
| `GET /api/query/contacts` | 200 | own rows only |
| `GET /api/export/json` | 5000 | own rows only |

---

## Against the Phase 2 targets

The acceptance list names four numbers at `10 x 2000`. All four are met, with
room.

| Target | Limit | Measured p95 |
| ------ | ----: | -----------: |
| Slim contacts list | 40 ms | **19.9 ms** |
| Full-text search | 10 ms | **1.3 ms** |
| Semantic search (mock AI) | 30 ms | **3.2 ms** |
| Dashboard | 60 ms | **5.2 ms** |

## What changed against Phase 0

At `10 x 2000`, which is the shape the plan cares about:

| Endpoint | Phase 0 p50 / p95 | Phase 2 p50 / p95 | Change |
| -------- | ----------------: | ----------------: | ------ |
| `GET /api/contacts?view=slim` | 242.7 / 272.8 | 18.7 / 19.9 | 13x faster |
| `GET /api/contacts/:id` | 0.5 / 2.1 | 0.4 / 0.6 | unchanged |
| `GET /api/search?q=` | 3.2 / 5.9 | 1.0 / 1.3 | 3x faster |
| `POST /api/search/semantic` | 9.2 / 16.0 | 2.6 / 3.2 | 4x faster |
| `GET /api/dashboard` | 67.0 / 75.1 | 4.9 / 5.2 | 14x faster |
| `GET /api/command-palette/zero-state` | 3.2 / 5.3 | 0.5 / 0.6 | 6x faster |
| `GET /api/contacts/:id/timeline` | 0.4 / 0.5 | 1.0 / 1.1 | 2x slower |
| `GET /api/action-items` | 0.4 / 3.4 | 0.3 / 0.3 | unchanged |
| `PATCH /api/contacts/:id` | 0.8 / 4.0 | 0.6 / 1.1 | unchanged |
| `POST /api/dedupe/scan` | 70995.7 / 76342.1 | 1338.4 / 1346.4 | 53x faster |

- **The list endpoints got much faster, as the plan predicted.** Ten accounts
  sharing one instance used to hand all 20,000 contacts to each of them. Each
  now reads its own 2,000. The slim list is faster at `10 x 2000` (18.7 ms)
  than at `1 x 5000` (49.2 ms), which is the point: the cost follows one
  person's data, not the instance's.
- **Keyed lookups did not move.** `GET /api/contacts/:id` is 0.5 ms p50 in
  Phase 0 and 0.4 ms now, on the same run. Adding `AND ownerId = ?` to an indexed lookup costs nothing
  measurable, which is what
  `tests/integration/tenancy.queryPlans.test.ts` asserts structurally.
- **The dedupe scan is the largest change.** A scan reads one account's
  contacts now, and the blocking stage is superlinear in the corpus, so a tenth
  of the rows is far more than a tenth of the time. It is also correct now,
  which is what sub-phase 2e was for.
- **`GET /api/contacts/:id/timeline` is the one endpoint that got slower**, 0.4
  ms to 1.0 ms at `10 x 2000` and 1.9 ms at `1 x 5000`. It is not the owner
  predicate. The statement measures 0.031 ms on a 15,000-interaction corpus and
  takes the same `MULTI-INDEX OR` plan over `idx_interactions_contact` with the
  predicate as without it, so the extra time is in the handler above the query
  rather than in the query. The endpoint is well inside any budget and is not
  one of the four the acceptance list names; the cause is worth finding in
  Phase 5, where the whole bench is re-run.

## Single-account instances paid nothing

The `1 x 5000` run is the same shape as the Phase 0 single-owner run, and the
numbers are the same within noise: the slim list 51.8 to 49.2 ms, the dashboard
13.9 to 12.1 ms, the dedupe scan 3507 to 3419 ms. Threading a scope through
every query costs a single-account instance nothing, which matters because most
instances are single-account.

## Isolation

Each run ends with a spot check that reads six endpoints as owner 0 and looks
up the real owner of every row that comes back. A row belonging to another
account is reported as a leak in the table itself, so a fast number can never
be a fast number for the wrong rows.
