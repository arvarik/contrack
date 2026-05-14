# Deduplication Engine

Contrack's deduplication engine finds and merges duplicate contacts using a multi-pass, cluster-based approach combining deterministic matching with AI-powered analysis.

## Overview

The engine runs through several detection passes, each targeting a different type of duplicate:

```
Contacts
    │
    ├──→ Normalization (names, emails, phones)
    │
    ├──→ Deterministic Passes
    │    ├── Email overlap (99% confidence)
    │    ├── Phone overlap with E.164 normalization (95%)
    │    ├── Exact name match (92%)
    │    ├── Name + Company match (90%)
    │    └── Nickname match (88%)
    │
    ├──→ Fuzzy / Scoring Passes
    │    ├── Phonetic matching (Double Metaphone)
    │    ├── Levenshtein distance
    │    ├── Jaccard similarity
    │    └── 768-dim Gemini embedding cosine similarity
    │
    └──→ Clustering → Auto-merge / Manual Review
```

## Triggering a Scan

### From the UI

Navigate to **Settings → Dedupe Engine** and click **Scan for Duplicates**.

### From the API

```bash
curl -X POST http://localhost:3000/api/dedupe/scan \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"mode":"full"}'
```

**Scan modes:**

| Mode            | What it does                                 |
| --------------- | -------------------------------------------- |
| `quick`         | Deterministic passes only (fast)             |
| `deep`          | Deterministic + fuzzy scoring                |
| `full`          | All passes including AI embedding comparison |
| `deterministic` | Only exact-match passes                      |
| `ai`            | Only AI-powered passes                       |
| `both`          | Deterministic + AI                           |

The scan streams progress via SSE through these phases:
`starting` → `normalizing` → `deterministic` → `blocking` → `scoring` → `ai` → `clustering` → `persisting` → `complete`

---

## Detection Algorithms

### Deterministic Matching

| Algorithm             | Confidence | What it detects                                                      |
| --------------------- | ---------- | -------------------------------------------------------------------- |
| Email overlap         | 99%        | Contacts sharing an email address                                    |
| Phone overlap (E.164) | 95%        | Contacts sharing a phone number (normalized to international format) |
| Exact name match      | 92%        | Contacts with identical normalized names                             |
| Name + Company        | 90%        | Same name at the same company                                        |
| Nickname match        | 88%        | Common nickname variations ("Bob" ↔ "Robert", "Mike" ↔ "Michael")    |

### Fuzzy / Probabilistic Matching

| Algorithm                | Use case                                        |
| ------------------------ | ----------------------------------------------- |
| **Double Metaphone**     | Phonetic similarity ("Smith" ≈ "Smyth")         |
| **Levenshtein distance** | Character-level edit distance for typos         |
| **Jaccard similarity**   | Token overlap between names                     |
| **Gemini embeddings**    | 768-dim cosine similarity for semantic matching |

---

## Sensitivity Presets

Configure auto-merge behavior in **Settings → Dedupe Engine**:

| Preset           | Auto-merge threshold | Behavior                                      |
| ---------------- | -------------------- | --------------------------------------------- |
| **Conservative** | ≥99% confidence      | Only near-certain matches merge automatically |
| **Default**      | ≥95% confidence      | High-confidence matches auto-merge            |
| **Aggressive**   | ≥90% confidence      | More auto-merges, fewer manual reviews        |

Matches below the auto-merge threshold are sent to the manual review queue.

---

## Cluster Review

Duplicate clusters appear as **swipeable cards** in the dedupe view:

<!-- Screenshot: dedupe-review.png -->

Each cluster card shows:

- All contacts in the cluster
- The **suggested primary** (the most complete contact, determined by a scoring algorithm)
- **Evidence pairs** — what matched and why (e.g., "Shared email: jane@acme.com")
- **Aggregate confidence** — weighted average across all pairs

### Actions

| Action             | Description                                                       |
| ------------------ | ----------------------------------------------------------------- |
| **Merge**          | Merge all contacts into the primary. Data is combined (not lost). |
| **Dismiss**        | Mark as not-duplicates. These contacts won't be suggested again.  |
| **Change Primary** | Select a different contact as the merge target                    |

Large clusters (>10 contacts) require explicit confirmation before merging.

---

## Merge Behavior

When contacts are merged:

1. All child data (emails, phones, tags, social links, etc.) is combined into the primary contact
2. Interactions and @mentions are transferred
3. List memberships are inherited
4. The duplicate's `canonicalId` is set to the primary's ID (soft delete)
5. FTS5 and vec0 entries are cleaned up
6. A record is created in the `merge_log` for undo support

---

## Merge Log & Undo

View the merge audit trail in the dedupe view's **History** tab:

<!-- Screenshot: merge-log.png -->

Each merge log entry shows:

- Who was merged into whom
- When the merge occurred
- The match type and confidence
- An **Undo** button

**Undo** restores the duplicate contact and reverses the data merge.

**APIs:**

- `GET /api/dedupe/merge-log` — Fetch merge history
- `POST /api/dedupe/merge-log/:id/undo` — Undo a merge

---

## Import-Time Deduplication

When contacts are imported via CSV/vCard, the system automatically runs a targeted deduplication scan:

1. Each imported contact is checked against all existing contacts
2. **Email overlap** → auto-merge (99% confidence)
3. **Phone overlap** → auto-merge (95% confidence)
4. **Exact name match** → auto-merge (95% confidence)
5. **Nickname match** → queued for manual review (88% confidence)

This prevents duplicate inflation during bulk imports.

---

## Manual Merge

Select 2+ contacts from the contact list and use the **Merge** option in the bulk action toolbar:

```bash
# Merge two contacts
curl -X POST http://localhost:3000/api/contacts/merge \
  -H "Content-Type: application/json" \
  -d '{"primaryId":"abc123","duplicateId":"def456"}'

# Merge a cluster
curl -X POST http://localhost:3000/api/contacts/merge-cluster \
  -H "Content-Type: application/json" \
  -d '{"primaryId":"abc123","duplicateIds":["def456","ghi789"]}'
```
