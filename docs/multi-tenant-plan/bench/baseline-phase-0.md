# Phase 0 benchmark baseline

Measured on `v2.0` before any query is scoped. Phase 5 re-runs the same
script and compares. The 10 owner run is the interesting one: nothing is
scoped yet, so all 20,000 contacts are returned to each of the ten owners.

Reproduce with:

```
npx tsx scripts/bench-tenancy.ts
OWNERS=10 CONTACTS_PER_OWNER=2000 npx tsx scripts/bench-tenancy.ts
```

---

# Tenancy benchmark: 1 owner(s) x 5000 contacts

- Machine: Apple M5 Pro, 18 cores, 52 GB
- Platform: darwin 25.6.0 (arm64)
- Node: v22.23.2
- SQLite: 3.53.2
- sqlite-vec: v0.1.9
- Contacts in the database: 5000
- Interactions per contact: 3
- Seed time: 7.4s
- Measured as one signed-in owner, 50 iterations unless noted.

| Endpoint | p50 ms | p95 ms | n | Note |
| -------- | -----: | -----: | -: | ---- |
| `GET /api/contacts?view=slim` | 51.8 | 59.5 | 50 |  |
| `GET /api/contacts/:id` | 0.4 | 2.9 | 50 |  |
| `GET /api/search?q=` | 1.5 | 2.5 | 50 |  |
| `POST /api/search/semantic` | 4.2 | 9.7 | 50 | mock AI, so this is FTS plus vector |
| `GET /api/dashboard` | 13.9 | 16.7 | 50 |  |
| `GET /api/command-palette/zero-state` | 1.0 | 3.9 | 50 |  |
| `GET /api/contacts/:id/timeline` | 0.4 | 0.5 | 50 |  |
| `GET /api/action-items` | 0.3 | 0.4 | 50 |  |
| `PATCH /api/contacts/:id` | 0.6 | 1.7 | 20 | one FTS trigger delete plus reinsert per update |
| `POST /api/dedupe/scan` | 3507.0 | 3538.0 | 3 | wall time, mock AI |

---

# Tenancy benchmark: 10 owner(s) x 2000 contacts

- Machine: Apple M5 Pro, 18 cores, 52 GB
- Platform: darwin 25.6.0 (arm64)
- Node: v22.23.2
- SQLite: 3.53.2
- sqlite-vec: v0.1.9
- Contacts in the database: 20000
- Interactions per contact: 3
- Seed time: 31.0s
- Measured as one signed-in owner, 50 iterations unless noted.

| Endpoint | p50 ms | p95 ms | n | Note |
| -------- | -----: | -----: | -: | ---- |
| `GET /api/contacts?view=slim` | 242.7 | 272.8 | 50 |  |
| `GET /api/contacts/:id` | 0.5 | 2.1 | 50 |  |
| `GET /api/search?q=` | 3.2 | 5.9 | 50 |  |
| `POST /api/search/semantic` | 9.2 | 16.0 | 50 | mock AI, so this is FTS plus vector |
| `GET /api/dashboard` | 67.0 | 75.1 | 50 |  |
| `GET /api/command-palette/zero-state` | 3.2 | 5.3 | 50 |  |
| `GET /api/contacts/:id/timeline` | 0.4 | 0.5 | 50 |  |
| `GET /api/action-items` | 0.4 | 3.4 | 50 |  |
| `PATCH /api/contacts/:id` | 0.8 | 4.0 | 20 | one FTS trigger delete plus reinsert per update |
| `POST /api/dedupe/scan` | 70995.7 | 76342.1 | 3 | wall time, mock AI |

---

## What this shows

The two runs hold total work roughly constant, so the difference is what
tenancy costs today.

- **The list endpoints carry every owner's rows.** `GET /api/contacts?view=slim`
  goes from 51.8 ms to 242.7 ms, because the ten-owner instance returns all
  20,000 contacts to each of the ten people. `GET /api/dashboard` does the same,
  13.9 ms to 67.0 ms. Phase 2 should make both **faster** than the single-owner
  numbers, because each owner then reads a tenth of the rows.
- **Keyed lookups are already flat.** `GET /api/contacts/:id` and
  `GET /api/contacts/:id/timeline` sit at 0.4 ms in both runs. Adding
  `AND ownerId = ?` to an indexed lookup should not move them, and Phase 5
  can check that here.
- **The dedupe scan is the outlier: 3.5 s to 71.0 s.** Four times the contacts
  costs twenty times the wall clock, so the blocking stage is superlinear. This
  is a single-owner scan reading every owner's contacts. Phase 2e scoping the
  scan is a correctness fix that should also remove most of this.
- **The `PATCH` cost is smaller than the plan expected.** The phase document
  predicted several milliseconds from the FTS trigger scan. It measures 0.6 ms
  at 5,000 contacts and 0.8 ms at 20,000. The `contacts_fts` delete scan that
  T10 measured at 4 ms was taken at 40,000 rows, so the cost is real but does
  not bite at this size.
