# Dedupe Strategies — Root Cause Analysis, Architecture Redesign & UX Vision

> **Author:** Principal Software Engineering Analysis  
> **Date:** April 9, 2026  
> **Scope:** Deep-dive diagnosis of current dedupe engine failures, proposed multi-tier funnel architecture, and product-level UX redesign for Contrack CRM.

---

## Table of Contents

0. [Current Implementation — How It Works Today](#0-current-implementation--how-it-works-today)
1. [Problem 1: Why Deterministic Scan Fails](#1-why-deterministic-scan-fails)
2. [Problem 2: Strategy Redesign — The Funnel Architecture](#2-strategy-redesign--the-funnel-architecture)
3. [Problem 3: UX Vision — From Scan Button to Proactive Intelligence](#3-ux-vision--from-scan-button-to-proactive-intelligence)
4. [Implementation Roadmap](#4-implementation-roadmap)
5. [Appendices](#5-appendices)

---

## 0. Current Implementation — How It Works Today

This section is a complete technical walkthrough of the existing dedupe engine as it stands before any proposed changes. Every file, function, data structure, and design decision is documented here.

### 0.1. Architecture Overview

The dedupe engine follows a **fire-and-forget async scan** pattern with real-time SSE progress streaming. The architecture spans three layers:

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND (React)                                                    │
│                                                                       │
│  DedupeView.tsx ───► DedupeContext.tsx ───► api/dedupe.ts             │
│  (UI / swipe cards)  (global state)         (React Query hooks)       │
│                                              ├── useStartDedupeScan  │
│                                              ├── useDedupeStream     │
│                                              ├── useMergeCluster     │
│                                              └── useMergeClusters    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP POST + SSE stream
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  API LAYER (Express)                                                 │
│                                                                       │
│  routes/dedupe.ts                                                    │
│  ├── POST /api/dedupe/scan          → Start async scan               │
│  ├── GET  /api/dedupe/stream        → SSE progress stream            │
│  ├── GET  /api/dedupe/active        → Recover in-progress scan       │
│  ├── GET  /api/dedupe/status        → Polling fallback               │
│  ├── POST /api/contacts/merge       → Merge single pair              │
│  ├── POST /api/contacts/merge-batch → Bulk merge pairs               │
│  ├── POST /api/contacts/merge-cluster  → Merge N contacts into one   │
│  └── POST /api/contacts/merge-clusters → Bulk merge clusters         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SERVICE LAYER                                                       │
│                                                                       │
│  services/dedupeService.ts  ─── Core detection + merge logic         │
│  services/dedupeJobQueue.ts ─── In-memory scan state + EventEmitter  │
│  utils/nlp.ts               ─── Name similarity, nicknames, phones   │
│  utils/unionFind.ts         ─── Disjoint Set Union for clustering    │
│  ai/aiService.ts            ─── Gemini API wrapper for AI batch eval │
└─────────────────────────────────────────────────────────────────────┘
```

### 0.2. Data Model — What a Contact Looks Like

Contacts are stored in SQLite with a **normalized child-table schema**. The core `contacts` table stores scalar fields, while multi-value fields are in separate tables:

| Table | Fields | Relevance to Dedupe |
|---|---|---|
| `contacts` | id, name, firstName, lastName, company, role, location, industry, avatarUrl, about, aiHydratedAt, ... | Primary comparison fields |
| `contact_emails` | contactId, email, label, source | **Identity anchor** — exact email overlap |
| `contact_phones` | contactId, phone, label, source | **Identity anchor** — exact phone overlap |
| `contact_sources` | contactId, platform, externalId | Import provenance (apple, linkedin) |
| `contact_social_links` | contactId, platform, url, handle | Potential identity anchor (unused by dedupe) |
| `contact_tags` | contactId, tag | Merged during merge |
| `contact_education` | contactId, school, degree, ... | Merged during merge |
| `contact_experience` | contactId, company, role, ... | Merged during merge |
| `contact_interests` | contactId, interest | Merged during merge |
| `contact_attributes` | contactId, name, value | Merged during merge |
| `contact_addresses` | contactId, address | Merged during merge |

> [!NOTE]
> The `contact_sources` table tracks which platform each contact was imported from. This is critical context that the current dedupe engine **does not** use during matching — a key gap identified in Section 1.

### 0.3. Scan Lifecycle

When a user clicks "Begin Scan", the following sequence occurs:

```
User clicks "Begin Scan" (mode: 'both')
  │
  ├─► POST /api/dedupe/scan { mode: 'both' }
  │     └─► dedupeQueue.createScan('both')        → scanId generated
  │     └─► dedupeService.runScan(scanId, 'both')  → fire-and-forget
  │     └─► Response: { scanId, mode }
  │
  ├─► Frontend opens SSE: GET /api/dedupe/stream?scanId=xxx
  │     └─► Server emits scan state on every update
  │
  └─► dedupeService.runScan() proceeds:
        │
        ├─ Phase: 'starting'
        │   └─ buildPassContext(rid)
        │       └─ SQL: SELECT * FROM contacts WHERE isGhost=0
        │       └─ Build contactMap: Map<id, rawContact>
        │
        ├─ Phase: 'deterministic'
        │   └─ runDeterministicPass(ctx) → RawPair[]
        │       ├─ 1a: Email overlap (SQL JOIN)
        │       └─ 1b: Phone overlap (in-memory hash map)
        │
        ├─ Phase: 'ai'
        │   └─ runAIPass(ctx, scanId) → RawPair[]
        │       ├─ O(n²) pairwise name comparison
        │       ├─ Filter: nameSimilarity ≥ 0.70 (or ≥ 0.45 + same company)
        │       ├─ Hydrate candidates with emails/phones
        │       └─ Batch AI evaluation via Gemini (50 pairs per batch)
        │
        ├─ Phase: 'clustering'
        │   └─ buildClusters(allPairs, contactMap, rid) → DedupeCluster[]
        │       ├─ Union-Find transitive grouping
        │       ├─ Hydrate contacts (contactRepo.hydrate)
        │       ├─ Auto-select best primary (computePrimaryScore)
        │       ├─ Generate human-readable summary
        │       └─ Compute aggregate/min confidence
        │
        └─ Phase: 'complete'
            └─ dedupeQueue.complete(scanId, clusters)
            └─ SSE emits final state with clusters
```

### 0.4. Pass 1 — Deterministic Detection (runDeterministicPass)

**File:** `server/services/dedupeService.ts` — lines 106–173

This pass finds contacts that share exact identity anchors. It produces `RawPair[]` with high confidence scores.

#### 1a: Email Overlap

```sql
SELECT e1.contactId AS id1, e2.contactId AS id2, e1.email AS matchedField
FROM contact_emails e1
JOIN contact_emails e2
  ON LOWER(TRIM(e1.email)) = LOWER(TRIM(e2.email))
WHERE e1.contactId < e2.contactId
GROUP BY e1.contactId, e2.contactId
```

- Confidence: **0.98**
- Reasoning: `"Both contacts share the email address: {email}"`
- This is the strongest signal — two contacts with the same email are almost certainly the same person

#### 1b: Phone Overlap

```typescript
// 1. Load all phones: SELECT contactId, phone FROM contact_phones
// 2. Build map: normalizePhone(phone) → [contactId, ...]
// 3. For each normalized phone with 2+ contact IDs, emit pairs
```

Phone normalization strips all non-digits and keeps the last 10:
```typescript
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}
// "(555) 867-5309"  → "5558675309"
// "+1 555-867-5309" → "5558675309"  (same!)
```

- Confidence: **0.95**
- Minimum phone length: 7 digits (filters out extensions and short numbers)
- Reasoning: `"Both contacts share the phone number: {phone}"`

#### What This Pass Does NOT Check

| Signal | Status | Impact |
|---|---|---|
| Exact name match | ❌ Not checked | Misses 115 pairs in current data |
| Name + company | ❌ Not checked | Would catch same-person across sources |
| Social URL overlap | ❌ Not checked | LinkedIn profile URLs are in `contact_social_links` |
| External ID overlap | ❌ Not checked | `contact_sources.externalId` is available |
| Nickname equivalence | ❌ Not checked | "Bobby" ↔ "Robert" deferred to AI pass |

### 0.5. Pass 2 — AI-Based Fuzzy Detection (runAIPass)

**File:** `server/services/dedupeService.ts` — lines 203–306

This pass finds contacts with similar names and optionally the same company, then sends them to Gemini for AI adjudication.

#### Step 1: Candidate Generation — O(n²) Brute Force

```typescript
for (let i = 0; i < allContacts.length; i++) {
  for (let j = i + 1; j < allContacts.length; j++) {
    const sim = nameSimilarity(a.name, b.name);
    const sameCompany = a.company && b.company &&
      a.company.toLowerCase().trim() === b.company.toLowerCase().trim();

    if (sim >= 0.70 || (sim >= 0.45 && sameCompany)) {
      fuzzyCandidates.push({ idx, a, b, sim, sameCompany });
    }
  }
}
```

**Thresholds:**
- `nameSimilarity ≥ 0.70` → candidate (standalone name match)
- `nameSimilarity ≥ 0.45 AND sameCompany` → candidate (low name similarity but shared company context)

**Complexity:** O(n²) — with 1,082 contacts, this evaluates **584,721 pairs**. Each evaluation calls `nameSimilarity()` which involves tokenization and Jaro-Winkler computation.

#### Step 2: Hydrate Candidates

For each candidate pair, load their emails and phones from the database for AI context:

```typescript
for (const c of fuzzyCandidates) {
  c.a._emails = sqlite.prepare("SELECT email FROM contact_emails WHERE contactId = ?")...
  c.b._emails = sqlite.prepare("SELECT email FROM contact_emails WHERE contactId = ?")...
  c.a._phones = sqlite.prepare("SELECT phone FROM contact_phones WHERE contactId = ?")...
  c.b._phones = sqlite.prepare("SELECT phone FROM contact_phones WHERE contactId = ?")...
}
```

> [!WARNING]
> This performs **4 SQL queries per candidate pair**. With hundreds of candidates, this can be a significant I/O bottleneck. The data could be pre-loaded in bulk during `buildPassContext()`.

#### Step 3: Batched AI Evaluation

Candidates are sent to Gemini in batches of 50:

```typescript
const AI_BATCH_SIZE = 50;
const AI_BATCH_TIMEOUT_MS = 60_000;  // 60 second timeout per batch

for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
  const batch = fuzzyCandidates.slice(start, start + AI_BATCH_SIZE);
  const aiResults = await withTimeout(
    evaluateBatchWithAI(batch, rid),
    AI_BATCH_TIMEOUT_MS,
    `AI batch ${batchIdx + 1}/${totalBatches}`,
  );
  // ... filter results where isDuplicate && confidence >= 0.6
}
```

**AI Prompt** (sent to Gemini for each batch):
```
System: You are a contact de-duplication expert for a personal CRM.
        You determine if two contact records represent the same real-world person.
        You are conservative — only flag as duplicate when genuinely confident.

User: For each pair below, determine if they represent the SAME real-world person.
      Consider: common nickname variants (Bob/Robert), abbreviations, typos,
      and professional context (same company, role, location).

      Pair 0:
        Contact A: "Bobby Johnson" | Company: Acme Corp | Role: VP Sales | ...
        Contact B: "Robert Johnson" | Company: Acme Corporation | Role: VP Sales | ...
        Signal: Name similarity = 85%, same company

      [... up to 50 pairs ...]
```

**AI Response Schema:**
```typescript
{ idx: number, isDuplicate: boolean, confidence: number, reasoning: string }[]
```

**Acceptance criteria:** `isDuplicate === true && confidence >= 0.60`

#### Fallback When AI Is Unavailable

If `GEMINI_API_KEY` is not configured, the AI pass falls back to a heuristic:

```typescript
if (candidate.sim >= 0.80) {
  pairs.push({
    matchType: 'ai',
    confidence: candidate.sim * 0.7,  // Penalized score
    reasoning: `High name similarity (${sim}%). AI evaluation unavailable.`,
  });
}
```

### 0.6. NLP Engine (nlp.ts) — Name Comparison Deep Dive

**File:** `server/utils/nlp.ts` — 363 lines

The NLP engine provides the foundation for all name-based comparison. It's a pure-functional module with zero database dependencies.

#### Name Similarity Pipeline

```
Input: "Dr. Bobby Johnson III", "Robert A. Johnson"
                    │
  ┌─────────────────▼──────────────────┐
  │  tokenizeName()                     │
  │  - lowercase                        │
  │  - normalize apostrophes            │
  │  - strip punctuation                │
  │  - remove titles/suffixes           │
  │  "Dr. Bobby Johnson III"            │
  │     → ["bobby", "johnson"]          │
  │  "Robert A. Johnson"                │
  │     → ["robert", "a", "johnson"]    │  (note: "a" kept as initial)
  └─────────────────┬──────────────────┘
                    │
  ┌─────────────────▼──────────────────┐
  │  tokenSimilarity()                  │
  │  Greedy best-pair matching:         │
  │  "bobby" ↔ "robert" → nickname     │
  │    areNicknameEquivalent → 0.95     │
  │  "johnson" ↔ "johnson" → exact     │
  │    singleTokenScore → 1.00         │
  │  "a" → unmatched (penalty -0.05)   │
  │  Raw score: (0.95 + 1.00) / 2      │
  │  After penalty: 0.975 - 0.05       │
  │  Token score: 0.925                 │
  └─────────────────┬──────────────────┘
                    │
  ┌─────────────────▼──────────────────┐
  │  Full-string Jaro-Winkler           │
  │  jaroWinkler("bobby johnson",       │
  │              "robert a. johnson")   │
  │  JW score: ~0.73                    │
  └─────────────────┬──────────────────┘
                    │
  ┌─────────────────▼──────────────────┐
  │  nameSimilarity() returns           │
  │  max(tokenScore, jwScore)           │
  │  max(0.925, 0.73) = 0.925          │
  └────────────────────────────────────┘
```

#### Single Token Comparison (singleTokenScore)

Each pair of name tokens is scored using a priority cascade:

| Check | Score | Example |
|---|---|---|
| Exact match | 1.00 | `"johnson" = "johnson"` |
| Nickname equivalent | 0.95 | `"bobby" ↔ "robert"` (via NICKNAME_GROUPS) |
| Initial match | 0.85 | `"j" → "james"` (first letter) |
| Jaro-Winkler | 0.0–1.0 | `"jhonson" ↔ "johnson"` → ~0.96 |

#### Nickname Dictionary

67 groups covering English, Spanish, and Indian names:

```typescript
const NICKNAME_GROUPS: string[][] = [
  ["robert", "bob", "bobby", "rob", "robbie", "berto", "beto"],
  ["william", "bill", "billy", "will", "willy"],
  ["michael", "mike", "mikey", "mick", "micky"],
  // ... 64 more groups
  ["arvind", "arv"],
  ["priyanka", "priya"],
  // ...
];
```

Lookup is O(1) via a pre-built `Map<string, number>` mapping each name to its group index.

#### Title/Suffix Stripping

```typescript
const TITLE_SUFFIXES = new Set([
  "dr", "dr.", "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "prof", "prof.",
  "sir", "jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "phd", "md", "esq",
  "cpa", "dds", "dvm",
]);
// "Dr. Sarah Chen III" → ["sarah", "chen"]
```

### 0.7. Clustering (Union-Find)

**File:** `server/utils/unionFind.ts` — 85 lines

After both passes produce `RawPair[]`, the pairs are grouped into transitive clusters using Union-Find with path compression and union-by-rank:

```
Input pairs: (A↔B), (B↔C), (D↔E)
     │
     ▼
Union-Find:
  union(A, B)  → {A, B}
  union(B, C)  → {A, B, C}  (B already connected to A, so C joins the set)
  union(D, E)  → {D, E}
     │
     ▼
Output clusters:
  Cluster 1: {A, B, C}  — 3 contacts, same person
  Cluster 2: {D, E}     — 2 contacts, same person
```

#### Cluster Enrichment (buildClusters)

Each cluster is enriched with:

1. **Hydrated contacts** — Each contact loaded once via `contactRepo.hydrate()` (with all child records: emails, phones, tags, etc.)
2. **Auto-selected primary** — The contact with the highest "fitness score" is suggested as the keeper
3. **Aggregate confidence** — `Math.max(...pairConfidences)`
4. **Weak link detection** — `hasWeakLink: minConfidence < 0.60`
5. **Human-readable summary** — Generated from match type signals

#### Primary Auto-Selection Heuristic (computePrimaryScore)

The "best" contact for a cluster is scored by data richness:

| Signal | Weight | Rationale |
|---|---|---|
| `avatarUrl` present | +10 | Photos make contacts feel "real" |
| `aiHydratedAt` present | +8 | Preserves expensive AI enrichment work |
| `about` present | +5 | Rich profile bio |
| Each interaction | +5 per | User's historical engagement |
| Each email | +3 per | Core contact data |
| Each phone | +3 per | Core contact data |
| `role` present | +3 | Professional context |
| `company` present | +3 | Professional context |
| Each social link | +2 per | Online presence |
| Each education entry | +2 per | Background data |
| Each experience entry | +2 per | Career history |
| `location` present | +2 | Geography |
| `industry` present | +2 | Sector data |
| `website` present | +2 | Web presence |
| Recently updated (< 30 days) | +5 | Freshness |
| Each tag | +1 per | User-applied metadata |

### 0.8. Merge Logic (mergeContacts)

**File:** `server/services/dedupeService.ts` — lines 576–713

The merge operation runs in a single SQLite transaction. It transfers all child records from the duplicate to the primary, deduplicating along the way:

```
mergeContacts(primaryId, duplicateId):
  │
  ├─ Guard: primary must exist (hard error if not)
  ├─ Guard: duplicate already gone → return primary (idempotent)
  │
  └─ BEGIN TRANSACTION:
       │
       ├─ Interactions:       UPDATE contactId → primaryId
       ├─ Interaction mentions: UPDATE (skip existing)
       │
       ├─ Emails:    Move non-duplicate emails to primary
       ├─ Phones:    Move non-duplicate phones (compare normalized)
       ├─ Social:    Move non-duplicate social links
       ├─ Education: Move non-duplicate entries (school+degree key)
       ├─ Experience: Move non-duplicate entries (company+role key)
       ├─ Sources:   Move non-duplicate source records
       ├─ Tags:      Move non-duplicate tags
       ├─ Interests: Move non-duplicate interests
       ├─ Attributes: Move non-duplicate attributes
       ├─ Addresses: Move non-duplicate addresses
       │
       ├─ Scalar fields: Copy from duplicate → primary (only if primary is null)
       │   Fields: firstName, lastName, headline, role, company, location,
       │           birthday, preferences, avatarUrl, about, pronouns,
       │           industry, website, lat, lng,
       │           aiHydratedAt, aiBriefing, aiBackground, aiSummary, aiBriefingAt
       │
       ├─ List memberships: INSERT OR IGNORE into primary's lists
       │
       ├─ addedAt: Keep the earlier date (oldest provenance wins)
       │
       ├─ UPDATE contacts SET {merged fields} WHERE id = primaryId
       └─ DELETE FROM contacts WHERE id = duplicateId
  
  COMMIT TRANSACTION
  
  return contactRepo.hydrate(primary)  // Return the enriched primary
```

> [!TIP]
> The merge is **additive-only** — it never overwrites existing data on the primary. If the primary already has a `company` but the duplicate has a different one, the primary's value is preserved. This is the safest strategy for a personal CRM where the user's manually-entered data should take precedence.

### 0.9. Job Queue & SSE Streaming

**File:** `server/services/dedupeJobQueue.ts` — 200 lines

The job queue is an in-memory singleton (not persisted to disk) using Node's `EventEmitter`:

```typescript
class DedupeJobQueue extends EventEmitter {
  private scans = new Map<string, DedupeScanProgress>();
  private processing = false;  // Only one scan at a time

  // Lifecycle:
  canStartScan()  → check if idle
  createScan()    → initialize scan state, return scanId
  update()        → partial state update + emit to SSE listeners
  complete()      → set phase='complete', attach clusters, release lock
  fail()          → set phase='error', release lock
  
  // GC: scans older than 30 minutes are garbage collected
}
```

**SSE Connection Flow:**
```
Browser:  EventSource('/api/dedupe/stream?scanId=xxx')
Server:   Send current state immediately
          Subscribe handler to dedupeQueue.on(scanId, handler)
          Each update() emits → handler writes to SSE
          On 'complete' or 'error' → close SSE, unsubscribe
Client:   Built-in retry on disconnect (max 3 retries, 2s delay)
```

**Progress State Shape:**

```typescript
interface DedupeScanProgress {
  scanId: string;
  mode: 'deterministic' | 'ai' | 'both';
  phase: 'starting' | 'deterministic' | 'ai' | 'clustering' | 'complete' | 'error';
  phaseName: string;           // Human-readable phase description
  contactsScanned: number;
  totalContacts: number;
  deterministicFound: number;  // Pairs from Pass 1
  aiCandidatesFound: number;   // Pairs from Pass 2
  aiEvaluated: number;         // How many AI candidates processed so far
  clustersFound: number;       // Final cluster count
  totalPairs: number;          // Total raw pairs before clustering
  clusters: DedupeCluster[];   // Final results (populated on 'complete')
  suggestions: any[];          // DEPRECATED — always empty
  error?: string;
  startedAt: string;
  completedAt?: string;
}
```

### 0.10. Frontend UX — Current Interaction Model

**Files:**
- `src/views/dedupe/DedupeView.tsx` — 688 lines (main orchestrator)
- `src/views/dedupe/components/` — ClusterSwipeCard, ClusterList, ManualMerge
- `src/contexts/DedupeContext.tsx` — 150 lines (global state)
- `src/api/dedupe.ts` — 261 lines (React Query hooks)

#### User Flow

```
1. Navigate to Settings → Dedupe Engine
       │
2. Select scan mode:
       ├─ "Deterministic Only" — email & phone matches, fast, no AI
       ├─ "AI Only" — fuzzy name analysis via Gemini
       └─ "Both (Recommended)" — two-pass scan
       │
3. Click "Begin Scan"
       │
4. Progress card appears with:
       ├─ Phase pipeline (Deterministic → AI → Clustering)
       ├─ Progress bar (contacts scanned / total)
       └─ "You can navigate away — scan continues in background"
       │
5. Scan completes → results appear in two views:
       │
       ├─ SWIPE VIEW (default):
       │   ├─ One cluster card at a time
       │   ├─ Shows all contacts in the cluster with avatars
       │   ├─ Suggested primary highlighted with ★
       │   ├─ Evidence panel (why they matched)
       │   ├─ Actions: [← Keep Separate] [Merge All →]
       │   ├─ Keyboard: Arrow keys, h/l for dismiss/merge, ⌘Z for undo
       │   └─ Progress: "3 of 12" with progress bar
       │
       └─ LIST VIEW:
           ├─ All clusters in a scrollable list
           ├─ Expandable rows showing cluster details
           └─ Per-row merge/dismiss actions
```

#### Tabs

| Tab | Purpose |
|---|---|
| **Auto Scan** | The primary flow: select mode → scan → review clusters |
| **Manual Merge** | Search for two specific contacts and merge them manually |

#### State Recovery

If the user refreshes the page during a scan, `DedupeContext` checks for an active scan on mount:

```typescript
useEffect(() => {
  fetchActiveScan().then(activeScan => {
    if (activeScan && !scanId) {
      setScan(activeScan);
      setScanId(activeScan.scanId);
      // Re-subscribes to SSE stream automatically
    }
  });
}, []);
```

### 0.11. Key Design Decisions & Trade-offs

| Decision | Rationale | Trade-off |
|---|---|---|
| **In-memory scan state** | Simple, fast, no schema migration needed | Lost on server restart — scan must be re-run |
| **Fire-and-forget async** | Non-blocking API response, user can navigate away | No persistent job recovery |
| **Sequential cluster merge** | Transactional safety, each duplicate merged independently | Slower than parallel (but safe) |
| **Additive-only field merge** | Never overwrites user data | May keep stale data if primary was manually entered long ago |
| **O(n²) AI candidate generation** | Simple, guaranteed full coverage | Doesn't scale beyond ~2K contacts |
| **60s batch timeout** | Prevents hanging on slow Gemini calls | May skip valid candidates on timeout |
| **Batch size of 50** | Balances token limits vs API call count | Large batches may degrade AI quality |
| **0.70 name similarity threshold** | Catches most fuzzy matches | May miss initials-only names ("J. Smith") |
| **0.60 AI confidence threshold** | Conservative — reduces false positives | May miss valid matches with low AI confidence |

### 0.12. File Index

| File | Lines | Purpose |
|---|---|---|
| [dedupeService.ts](file:///Users/arvind/Documents/github/contrack/server/services/dedupeService.ts) | 743 | Core engine: detection passes, clustering, merge, primary selection |
| [dedupeJobQueue.ts](file:///Users/arvind/Documents/github/contrack/server/services/dedupeJobQueue.ts) | 200 | In-memory scan state, EventEmitter for SSE |
| [dedupe.ts (routes)](file:///Users/arvind/Documents/github/contrack/server/routes/dedupe.ts) | 288 | Express API endpoints |
| [nlp.ts](file:///Users/arvind/Documents/github/contrack/server/utils/nlp.ts) | 363 | Name similarity, Jaro-Winkler, nicknames, phone normalization |
| [unionFind.ts](file:///Users/arvind/Documents/github/contrack/server/utils/unionFind.ts) | 85 | Union-Find for transitive clustering |
| [DedupeView.tsx](file:///Users/arvind/Documents/github/contrack/src/views/dedupe/DedupeView.tsx) | 688 | Main UI orchestrator (scan modes, progress, swipe/list views) |
| [DedupeContext.tsx](file:///Users/arvind/Documents/github/contrack/src/contexts/DedupeContext.tsx) | 150 | Global React context (scan state, SSE subscription, cluster management) |
| [dedupe.ts (api)](file:///Users/arvind/Documents/github/contrack/src/api/dedupe.ts) | 261 | React Query hooks (mutations, SSE stream, active scan recovery) |
| [aiService.ts](file:///Users/arvind/Documents/github/contrack/server/ai/aiService.ts) | 569 | Gemini AI wrapper (used by evaluateBatchWithAI) |

---

## 1. Why Deterministic Scan Fails

### 1.1. The Smoking Gun — Live Data Analysis

Current database state (1,082 active contacts):

| Metric | Count |
|---|---|
| Total active contacts | 1,082 |
| Apple source records | 383 |
| LinkedIn source records | 802 |
| Contacts with **zero emails** | 966 (89%) |
| Contacts with **zero phones** | 828 (77%) |
| Contacts with **both** email and phone | 69 (6%) |
| **Exact** name duplicates (case-insensitive) | 115 pairs |
| Of those, **cross-platform** (Apple ↔ LinkedIn) | 106 pairs |
| Email-based matches found by deterministic scan | **0** |
| Phone-based matches found by deterministic scan | **1** |

> [!CAUTION]
> **89% of contacts have no email. 77% have no phone.** The deterministic engine relies *exclusively* on email and phone overlap. It is structurally incapable of matching the vast majority of contacts.

### 1.2. Root Cause: The Deterministic Engine Has No Name-Based Matching

The current `runDeterministicPass()` performs only two checks:

1. **Exact email overlap** — SQL JOIN on `LOWER(TRIM(e1.email)) = LOWER(TRIM(e2.email))`
2. **Exact phone overlap** — In-memory normalized phone comparison (`normalizePhone()`)

**What it does NOT do:**

- ❌ Exact name matching (case-insensitive)
- ❌ Name + company matching
- ❌ Name + source cross-referencing
- ❌ Phonetic name encoding (Soundex/Metaphone)
- ❌ Any name similarity at all

### 1.3. Why This Matters for Apple + LinkedIn Imports

The classic cross-source duplicate pattern:

```
Apple Contact:     "Praneeth Gottipati" | emails: 2 | phones: 1 | company: (none)
LinkedIn Contact:  "Praneeth Gottipati" | emails: 0 | phones: 0 | company: "Verisk"
```

- **No shared email** → deterministic misses
- **No shared phone** → deterministic misses
- **Exact same name** → deterministic doesn't check names at all

This pattern repeats for **106 of 115 exact-name duplicate pairs** in the database. They are all Apple ↔ LinkedIn cross-source duplicates where LinkedIn has zero contact info (emails/phones), making email/phone overlap impossible.

### 1.4. The "AI Pass" Catches Some — But Shouldn't Have To

The AI pass (`runAIPass()`) does check name similarity using `nameSimilarity()` from `nlp.ts`, but:

1. It uses a **0.70 threshold** for standalone name similarity, or **0.45 + same company**
2. An exact name match like `"Praneeth Gottipati" = "Praneeth Gottipati"` scores **1.0** and would qualify
3. But it then **sends these pairs to Gemini** for AI evaluation — which is:
   - Slow (60s timeout per batch of 50)
   - Expensive (API token costs)
   - Unnecessary for what are clearly exact name matches

> [!IMPORTANT]
> **Exact name matches should NEVER reach the AI pass.** They are deterministic by definition and should be caught in Pass 1.

### 1.5. The Fix: Expand Deterministic Pass with Name-Based Tiers

The deterministic pass should be expanded to include **multiple confidence tiers** of name-based matching, all of which are computable without AI:

| Tier | Signal | Confidence | Example |
|---|---|---|---|
| D1 | Exact email overlap | 0.98 | `bob@gmail.com = bob@gmail.com` |
| D2 | Exact phone overlap | 0.95 | `(555) 867-5309 = 555-867-5309` |
| **D3** | **Exact name match** (case-insensitive, title-stripped) | **0.90** | `"Praneeth Gottipati" = "praneeth gottipati"` |
| **D4** | **Exact name + same company** | **0.95** | `"Bob Johnson" @ "Acme" = "Bob Johnson" @ "Acme Corp"` |
| **D5** | **Nickname-equivalent name** (full last name match + first name nickname) | **0.88** | `"Bobby Johnson" ↔ "Robert Johnson"` |
| **D6** | **Name + source cross-ref** (exact name across different import sources) | **0.92** | Apple "John Smith" ↔ LinkedIn "John Smith" |

**Tiers D3–D6 are deterministic computations.** They use the existing `nameSimilarity()`, `areNicknameEquivalent()`, and `tokenizeName()` functions. They require zero AI API calls.

### 1.6. How to Implement D3–D6

#### D3: Exact Name Match

```sql
SELECT c1.id AS id1, c2.id AS id2, c1.name AS matchedName
FROM contacts c1
JOIN contacts c2
  ON LOWER(TRIM(c1.name)) = LOWER(TRIM(c2.name))
WHERE c1.id < c2.id
  AND c1.isGhost = 0 AND (c1.isArchived = 0 OR c1.isArchived IS NULL)
  AND c2.isGhost = 0 AND (c2.isArchived = 0 OR c2.isArchived IS NULL);
```

This single SQL query would immediately find **all 115 exact name duplicates** that the engine currently misses.

#### D4: Exact Name + Same Company Normalization

Same as D3, but with a secondary company similarity check. Company names need normalization:

```typescript
function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|group|plc|gmbh|ag)\b\.?/g, '')
    .replace(/[.,]/g, '')
    .trim();
}
```

This catches `"Acme Corp"` ↔ `"Acme Corporation"` ↔ `"ACME"`.

#### D5: Nickname-Equivalent Full Name Match

For each pair of contacts, tokenize both names and check:
1. Last name tokens match exactly
2. First name tokens are nickname-equivalent (using the existing `NICKNAME_GROUPS` dictionary)

```typescript
function isNicknameMatch(nameA: string, nameB: string): boolean {
  const tokA = tokenizeName(nameA);
  const tokB = tokenizeName(nameB);
  if (tokA.length < 2 || tokB.length < 2) return false;
  
  // Last token must match exactly
  if (tokA[tokA.length - 1] !== tokB[tokB.length - 1]) return false;
  
  // First token must be nickname-equivalent
  return areNicknameEquivalent(tokA[0], tokB[0]);
}
```

This catches `"Bobby Johnson"` ↔ `"Robert Johnson"` without any AI call.

#### D6: Cross-Source Name Match

A higher-confidence variant of D3: if two contacts have the exact same name AND come from different sources (Apple vs LinkedIn), the probability of them being the same person is very high — higher than two manually-created contacts with the same name (which might be different "John Smiths").

```typescript
// After finding an exact name match, boost confidence if cross-source
const sourceA = sqlite.prepare(
  "SELECT platform FROM contact_sources WHERE contactId = ?"
).all(idA);
const sourceB = sqlite.prepare(
  "SELECT platform FROM contact_sources WHERE contactId = ?"
).all(idB);
const platformsA = new Set(sourceA.map(s => s.platform));
const platformsB = new Set(sourceB.map(s => s.platform));
const isCrossSource = ![...platformsA].some(p => platformsB.has(p));
// If cross-source: confidence = 0.92, else: 0.90
```

### 1.7. Estimated Impact

With the expanded deterministic pass:

| Before | After |
|---|---|
| 0 email matches, 1 phone match | Same |
| 0 name matches | **115 exact name matches** |
| 0 nickname matches | **~5–15 nickname matches** (estimated) |
| Total deterministic: **1 pair** | Total deterministic: **~120+ pairs** |
| All name duplicates pushed to AI pass (slow, expensive) | AI pass only handles genuinely fuzzy cases |

---

## 2. Strategy Redesign — The Funnel Architecture

### 2.1. What's Wrong With the Current Architecture

The current engine has **two flat passes** that run independently:

```
Pass 1: Deterministic (email + phone only)
Pass 2: AI (O(n²) pairwise name comparison → batch Gemini)
```

Problems:
1. **Pass 1 is too narrow** — only email/phone, missing obvious name matches
2. **Pass 2 is too broad** — O(n²) all-pairs comparison even for 1000+ contacts → 500,000+ comparisons
3. **No blocking/indexing** — every contact is compared against every other contact
4. **AI is used as a crutch** — exact name matches are sent to Gemini when they shouldn't be
5. **No embedding layer** — no semantic understanding of contact similarity

### 2.2. The Proposed Funnel Architecture

The new architecture follows the industry-standard **Entity Resolution Funnel**, adapted for a personal CRM context. A key improvement over a naive funnel is the addition of **negative constraint filtering** — where the engine actively eliminates impossible matches before expensive scoring, not just after.

```
┌─────────────────────────────────────────────────────────────────┐
│  TIER 0: DATA NORMALIZATION + PERSISTENT INDEXING               │
│  Normalize names, phones, emails, companies. Store phonetic     │
│  hashes and embeddings as indexed columns on save.              │
│  Output: standardized contact records                           │
│  Cost: O(n) — one pass through all contacts                     │
│  Trigger: on save (incremental) or on scan (batch)              │
└────────────────────────────┬────────────────────────────────────┘
                             │ 1,082 contacts
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  TIER 1: DETERMINISTIC — Identity Anchors (High Confidence)     │
│  Exact email, phone, social profile URL, external ID overlap    │
│  Output: RawPair[] with confidence 0.95–0.99                    │
│  Cost: O(n) via SQL JOINs and hash maps                         │
│  Expected: ~1–5 pairs (sparse email/phone data)                 │
└────────────────────────────┬────────────────────────────────────┘
                             │ Pairs found, but 99% of contacts unpaired
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  TIER 2: DETERMINISTIC — Name-Based Rules (Medium Confidence)   │
│  Exact name match, nickname equivalence, name+company,          │
│  cross-source boosting, initial expansion                       │
│  Output: RawPair[] with confidence 0.85–0.95                    │
│  Cost: O(n) via SQL JOINs + O(n·k) nickname checks              │
│  Expected: ~120 pairs (the missing Apple↔LinkedIn matches)      │
└────────────────────────────┬────────────────────────────────────┘
                             │ Most obvious duplicates caught
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  TIER 3: BLOCKING — Candidate Generation (Reduce Search Space)  │
│  Phonetic encoding (Double Metaphone), n-gram blocking, and/or  │
│  embedding-based ANN to find candidate pairs (~5-10% of n²)     │
│  Output: CandidatePair[] — potential matches for deeper analysis │
│  Cost: O(n·log(n)) or O(n·k) with blocking                     │
│  Expected: ~200–500 candidate pairs                             │
└────────────────────────────┬────────────────────────────────────┘
                             │ Only candidates (not all-pairs) pass through
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  TIER 3.5: NEGATIVE CONSTRAINTS — Anti-Match Filter (NEW)       │
│  Remove pairs that are KNOWN to be different people:            │
│  - Co-occurred in the same interaction (physics rule)           │
│  - User previously dismissed (dedupe_exclusions table)          │
│  - Contradictory identity anchors (same email domain, diff ID)  │
│  Output: Pruned CandidatePair[]                                 │
│  Cost: O(k) — simple SQL lookups against known_distinct pairs   │
└────────────────────────────┬────────────────────────────────────┘
                             │ Impossible matches eliminated
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  TIER 4: FUZZY SCORING — Pairwise Similarity (No AI Yet)        │
│  Jaro-Winkler name similarity, company fuzzy match,             │
│  location overlap, combined weighted scoring                    │
│  Output: ScoredPair[] with similarity 0.0–1.0                   │
│  Filter: Only pairs scoring ≥ 0.60 pass to Tier 5               │
│  Cost: O(k) where k = candidate pairs from blocking             │
│  Expected: ~50–100 pairs above threshold                        │
└────────────────────────────┬────────────────────────────────────┘
                             │ Only genuinely ambiguous pairs
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  TIER 5: AI VERIFICATION — LLM as "Supreme Court"               │
│  Send ambiguous pairs to Gemini with full context + timeline    │
│  Smaller batches (10-15 pairs) for higher reasoning accuracy    │
│  Output: RawPair[] with AI confidence 0.0–1.0                   │
│  Filter: Only pairs where isDuplicate && confidence ≥ 0.60      │
│  Cost: 2-3 API calls (batched), only for truly ambiguous cases  │
│  Expected: ~10–30 confirmed AI pairs                            │
└────────────────────────────┬────────────────────────────────────┘
                             │ All pairs from all tiers
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  TIER 6: CLUSTERING — Transitive Grouping                       │
│  Union-Find over all pairs from Tiers 1–5                       │
│  Output: DedupeCluster[] (already implemented)                   │
│  Cost: O(n·α(n)) — nearly O(n)                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3. Tier 0 — Data Normalization + Persistent Indexing

Before any comparison, normalize all contact data once. A key architectural decision: **persist phonetic hashes as indexed columns** computed on save, not at scan time. This shifts normalization from O(n) batch overhead to O(1) per-write amortized cost.

```typescript
interface NormalizedContact {
  id: string;
  // Name components
  nameNorm: string;            // lowercase, title-stripped, trimmed
  nameTokens: string[];        // tokenized name
  firstNameNorm: string;       // first token
  lastNameNorm: string;        // last token
  nameMetaphone: string;       // Double Metaphone encoding of full name
  firstNameMetaphone: string;  // Double Metaphone of first name
  lastNameMetaphone: string;   // Double Metaphone of last name
  // Other identifiers
  emailsNorm: string[];        // lowercase, trimmed
  phonesNorm: string[];        // last 10 digits
  companyNorm: string;         // suffix-stripped, lowercase
  // Blocking keys
  blockKeys: string[];         // computed blocking keys for candidate gen
}
```

#### Persistent Phonetic Hash Column

Add a `phoneticHash` column to the `contacts` table, computed on every insert/update:

```sql
ALTER TABLE contacts ADD COLUMN phoneticHash TEXT;
CREATE INDEX idx_contacts_phonetic ON contacts(phoneticHash);
```

```typescript
// In contactService.create() and contactService.update():
const hash = doubleMetaphone(contact.name);
await sqlite.prepare(
  "UPDATE contacts SET phoneticHash = ? WHERE id = ?"
).run(hash.primary, contact.id);
```

This enables **instant** phonetic blocking during scans:

```sql
-- Find all contacts with the same phonetic hash (O(1) index lookup)
SELECT id FROM contacts WHERE phoneticHash = ? AND id != ?
```

Compare this to computing Metaphone for all 1,082 contacts at scan time — the persistent column eliminates the batch normalization step entirely for phonetic matching.

**Why normalize upfront?** Currently, normalization is repeated inside every comparison. With 1,082 contacts and O(n²) comparisons, that's 580,000+ redundant `toLowerCase().trim()` calls. Normalizing once gives O(n) prep + O(1) comparison. Persisting phonetic hashes goes further — O(1) amortized, computed once per write.

### 2.4. Tier 3 — Blocking Strategy (New Layer)

This is the key architectural addition. Currently, the AI pass does an **all-pairs** O(n²) comparison:

```
1,082 contacts → C(1082, 2) = 584,721 pairs to evaluate
```

With 1,000+ contacts, this becomes the performance bottleneck. **Blocking** reduces this to a manageable subset.

#### Multi-Key Blocking

Generate multiple blocking keys per contact and only compare contacts that share at least one blocking key:

```typescript
function generateBlockKeys(contact: NormalizedContact): string[] {
  const keys: string[] = [];
  
  // Key 1: Last name (exact)
  if (contact.lastNameNorm) {
    keys.push(`LN:${contact.lastNameNorm}`);
  }
  
  // Key 2: Last name Metaphone
  if (contact.lastNameMetaphone) {
    keys.push(`LNM:${contact.lastNameMetaphone}`);
  }
  
  // Key 3: First 3 chars of first name + last name
  if (contact.firstNameNorm && contact.lastNameNorm) {
    keys.push(`FL3:${contact.firstNameNorm.slice(0, 3)}:${contact.lastNameNorm}`);
  }
  
  // Key 4: Company + first name initial
  if (contact.companyNorm && contact.firstNameNorm) {
    keys.push(`CF:${contact.companyNorm}:${contact.firstNameNorm[0]}`);
  }
  
  // Key 5: Emails (each email is a blocking key)
  for (const email of contact.emailsNorm) {
    keys.push(`EM:${email}`);
  }
  
  // Key 6: Phones (each normalized phone is a blocking key)
  for (const phone of contact.phonesNorm) {
    keys.push(`PH:${phone}`);
  }
  
  return keys;
}
```

**Build inverted index → candidate pairs:**

```typescript
function buildCandidatePairs(
  contacts: NormalizedContact[]
): Map<string, Set<string>> {
  const blockIndex = new Map<string, string[]>();
  
  // Build inverted index: blockKey → [contactIds]
  for (const c of contacts) {
    for (const key of c.blockKeys) {
      if (!blockIndex.has(key)) blockIndex.set(key, []);
      blockIndex.get(key)!.push(c.id);
    }
  }
  
  // Generate unique candidate pairs from shared blocks
  const candidates = new Map<string, Set<string>>();
  for (const [, ids] of blockIndex) {
    if (ids.length < 2 || ids.length > 100) continue; // Skip singletons and mega-blocks
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i] < ids[j] ? ids[i] : ids[j];
        const b = ids[i] < ids[j] ? ids[j] : ids[i];
        if (!candidates.has(a)) candidates.set(a, new Set());
        candidates.get(a)!.add(b);
      }
    }
  }
  
  return candidates;
}
```

**Estimated reduction:**

| Without blocking | With blocking |
|---|---|
| C(1082, 2) = 584,721 pairs | ~2,000–5,000 candidate pairs |
| All pairs evaluated | 99.3% elimination |

### 2.5. Tier 3.5 — Negative Constraints / Anti-Match Filter (New)

Before running expensive fuzzy scoring or AI, eliminate candidate pairs that are **provably different people**. This is the "immune system" of the funnel — it prevents false positives at scale.

#### The Physics Rule: Co-Occurrence in Interactions

If two contacts were ever mentioned in the **same interaction** (e.g., "Lunch with Bobby and Robert"), Newtonian physics dictates they are two different people.

```sql
-- Find contacts that co-occur in the same interaction
SELECT DISTINCT
  im1.contactId AS id1, im2.contactId AS id2
FROM interaction_mentions im1
JOIN interaction_mentions im2
  ON im1.interactionId = im2.interactionId
  AND im1.contactId < im2.contactId;
```

```typescript
// Build a Set<string> of known-distinct pairs at scan start
const distinctPairs = new Set<string>();
const coOccurrences = sqlite.prepare(`
  SELECT DISTINCT im1.contactId AS id1, im2.contactId AS id2
  FROM interaction_mentions im1
  JOIN interaction_mentions im2 ON im1.interactionId = im2.interactionId
  AND im1.contactId < im2.contactId
`).all();
for (const row of coOccurrences) {
  distinctPairs.add(`${row.id1}|${row.id2}`);
}

// In the candidate filtering step:
function isKnownDistinct(idA: string, idB: string): boolean {
  const [a, b] = idA < idB ? [idA, idB] : [idB, idA];
  return distinctPairs.has(`${a}|${b}`);
}
```

#### User-Dismissed Exclusions

Already covered in [Section 3.9](#39-never-merge-safeguard--user-corrections) — pairs the user explicitly dismissed are stored in `dedupe_exclusions` and checked before any scoring.

#### Contradictory Identity Anchors

If two contacts share the same email **domain** but have different **usernames** on a personal domain (e.g., `john@smithfamily.com` vs `jane@smithfamily.com`), they are likely different members of the same household. This doesn't apply to generic domains (gmail, yahoo, etc.).

> [!TIP]
> The Anti-Match filter is cheap (SQL lookups + Set checks) and eliminates false positives that would otherwise waste AI tokens or confuse users in the review queue. It should run immediately after blocking, before fuzzy scoring.

---

### 2.6. Embedding-Based Matching (Tier 3b)

For an even more intelligent blocking layer, we generate embeddings for each contact and use Approximate Nearest Neighbor (ANN) search via `sqlite-vec`.

> [!WARNING]
> **Embeddings are powerful but have a critical limitation for name matching.** Vector models group semantically similar text — meaning "John Smith" and "Jane Smith" end up close together because they are both common Anglo names, and "Apple" and "Microsoft" cluster because they are both tech companies. Embeddings excel at catching contextual/career-based matches ("Dave, met at Web3 event" ↔ "David Chen, Blockchain investor") but should **never** be the sole signal for name-based deduplication. Always combine with lexical distance (Jaro-Winkler / Metaphone) to filter out false positives from semantic proximity.

#### Contact Record → Embedding String

For `gemini-embedding-2-preview`, task instructions are specified **in the prompt itself** (not via a `task_type` enum). For contact deduplication, we use symmetric `task: clustering` format:

```typescript
function contactToEmbeddingString(c: NormalizedContact, raw: any): string {
  const parts: string[] = [];
  if (raw.name) parts.push(`Name: ${raw.name}`);
  if (raw.company) parts.push(`Company: ${raw.company}`);
  if (raw.role) parts.push(`Role: ${raw.role}`);
  if (raw.location) parts.push(`Location: ${raw.location}`);
  if (raw.industry) parts.push(`Industry: ${raw.industry}`);
  if (c.emailsNorm.length) parts.push(`Emails: ${c.emailsNorm.join(', ')}`);
  if (c.phonesNorm.length) parts.push(`Phones: ${c.phonesNorm.join(', ')}`);
  
  const content = parts.join(' | ');
  // Prepend task instruction for gemini-embedding-2-preview
  return `task: clustering | query: ${content}`;
}
```

> [!NOTE]
> **Why `task: clustering` and not `task: sentence similarity`?** In entity resolution, we're grouping records that represent the same entity — this is a clustering task, not a similarity ranking. The clustering task type optimizes the embedding space for grouping semantically equivalent records together.

#### Storage: sqlite-vec Extension

For a local SQLite-based CRM, the `sqlite-vec` extension is the ideal vector storage solution — it adds native vector similarity search directly to SQLite without requiring a separate vector database:

```typescript
// Install: npm install sqlite-vec
import * as sqliteVec from 'sqlite-vec';

// Load the extension into your existing better-sqlite3 connection
sqliteVec.load(sqlite);

// Create a virtual table for contact embeddings
// Using 768 dimensions (MRL truncated) for storage efficiency
sqlite.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS contact_embeddings USING vec0(
    contactId TEXT PRIMARY KEY,
    embedding FLOAT[768]
  );
`);

// Insert/update an embedding
sqlite.prepare(`
  INSERT OR REPLACE INTO contact_embeddings (contactId, embedding)
  VALUES (?, ?)
`).run(contact.id, embeddingBuffer);

// ANN search: find top 5 nearest neighbors
const neighbors = sqlite.prepare(`
  SELECT contactId, distance
  FROM contact_embeddings
  WHERE embedding MATCH ?
  ORDER BY distance
  LIMIT 5
`).all(targetEmbeddingBuffer);
```

This eliminates the need for FAISS, Annoy, or any external vector DB. The embeddings live in the same SQLite database as everything else, participate in transactions, and are backed up together.

#### Gemini Embedding 2 API

**Model:** `gemini-embedding-2-preview` — Google's latest multimodal embedding model (text, images, video, audio, PDFs mapped to a unified embedding space).

| Property | Value |
|---|---|
| **Default dimensions** | 3,072 |
| **MRL dimensions** | 128–3,072 (we use **768** for storage efficiency) |
| **Max input tokens** | 8,192 per request |
| **Pricing (Free Tier)** | Free |
| **Pricing (Paid)** | $0.20 per 1M tokens |
| **Task instructions** | In-prompt (`task: clustering \| query: ...`) not `task_type` enum |
| **Normalization** | Only the full 3,072 output is auto-normalized; 768 requires manual normalization |

```typescript
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const EMBED_DIMENSIONS = 768; // MRL: use 768 for storage, 3072 for max quality

async function generateContactEmbeddings(
  contacts: { id: string; text: string }[]
): Promise<Map<string, number[]>> {
  const embeddings = new Map<string, number[]>();
  
  // Batch embed — pass multiple strings in one call
  const BATCH_SIZE = 100;
  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    const response = await ai.models.embedContent({
      model: 'gemini-embedding-2-preview',
      contents: batch.map(c => c.text), // task instruction is already in the text
      config: { outputDimensionality: EMBED_DIMENSIONS },
    });
    
    for (let j = 0; j < batch.length; j++) {
      // Normalize sub-3072 embeddings manually (MRL requirement)
      const raw = response.embeddings[j].values;
      const norm = Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0));
      const normalized = raw.map(v => v / norm);
      embeddings.set(batch[j].id, normalized);
    }
  }
  
  return embeddings;
}
```

**Cost analysis for Contrack:**
- 1,082 contacts × ~30 tokens per contact embedding string = ~32,460 tokens
- At **$0.20/1M tokens** = **$0.006** for a full re-embed of all contacts
- Free tier: $0.00
- Incremental (1 contact on save): negligible

#### Cosine Similarity (Fallback Without sqlite-vec)

If `sqlite-vec` is not available, use a simple brute-force approach with the blocking keys as a pre-filter:

```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Within each block, compute embedding similarity as an additional signal
function scoreWithEmbeddings(
  candidates: CandidatePair[],
  embeddings: Map<string, number[]>
): ScoredPair[] {
  return candidates.map(pair => {
    const embA = embeddings.get(pair.idA);
    const embB = embeddings.get(pair.idB);
    const embSim = embA && embB ? cosineSimilarity(embA, embB) : 0;
    return {
      ...pair,
      embeddingSimilarity: embSim,
      combinedScore: pair.nameSimilarity * 0.4 + embSim * 0.4 + pair.metadataScore * 0.2,
    };
  });
}
```

#### What Embeddings Catch vs. Miss

| Signal Type | Embeddings Catch? | Example |
|---|---|---|
| **Career context match** | ✅ Excellent | "Dave, met at Web3 event" ↔ "David Chen, Blockchain investor" |
| **Role/company semantic similarity** | ✅ Good | "SWE at Stripe" ↔ "Software Engineer at Stripe Inc" |
| **Cross-language names** | ✅ Good | "José" ↔ "Joseph" (multilingual awareness) |
| **Common name disambiguation** | ❌ False positives | "John Smith" ↔ "Jane Smith" (too close in vector space) |
| **Company co-location** | ❌ False positives | "Steve at Apple" ↔ "Tim at Apple" (semantically similar, different people) |
| **Name typos/phonetics** | ⚠️ Inconsistent | Metaphone + Jaro-Winkler are more reliable for this |

**Recommendation:** Use embeddings as an **additional blocking key** (Tier 3b), not as the primary scoring signal. Always validate embedding candidates through the Tier 4 fuzzy scoring sieve before AI.

| Dataset Size | Embeddings? |
|---|---|
| < 500 contacts | No — blocking + fuzzy scoring is sufficient |
| 500–5,000 contacts | Optional — useful for catching semantic/contextual matches |
| 5,000+ contacts | Yes — replaces O(n²) fuzzy comparison |

### 2.7. Updated Scoring Model

Instead of a single `nameSimilarity` score, use a **weighted multi-signal score**:

```typescript
interface MatchSignals {
  // Identity anchors (deterministic)
  emailOverlap: boolean;       // 0 or 1
  phoneOverlap: boolean;       // 0 or 1
  socialUrlOverlap: boolean;   // 0 or 1
  
  // Name signals (computable, no AI)
  nameExactMatch: boolean;     // exact case-insensitive
  nicknameMatch: boolean;      // via NICKNAME_GROUPS
  nameJaroWinkler: number;     // 0.0–1.0
  nameMetaphoneMatch: boolean; // phonetic equivalence
  lastNameExactMatch: boolean; // surname match
  
  // Context signals (computable, no AI)
  companyMatch: boolean;       // normalized company overlap
  companyFuzzy: number;        // fuzzy company similarity
  locationOverlap: boolean;    // same city/region
  isCrossSource: boolean;      // different import platforms
  
  // Negative constraints (Tier 3.5)
  isKnownDistinct: boolean;    // co-occurred in interaction OR user-excluded
  
  // Embedding signal (optional)
  embeddingSimilarity: number; // 0.0–1.0 cosine similarity
}

function computeCompositeScore(signals: MatchSignals): number {
  // Hard veto — known-distinct pairs can NEVER match
  if (signals.isKnownDistinct) return 0;
  
  let score = 0;
  
  // Identity anchors — near-certain matches
  if (signals.emailOverlap) return 0.98;
  if (signals.phoneOverlap) return 0.95;
  if (signals.socialUrlOverlap) return 0.93;
  
  // Name signals (primary weight)
  if (signals.nameExactMatch) score += 0.60;
  else if (signals.nicknameMatch && signals.lastNameExactMatch) score += 0.55;
  else score += signals.nameJaroWinkler * 0.45;
  
  if (signals.nameMetaphoneMatch) score += 0.08;
  
  // Context boosters
  if (signals.companyMatch) score += 0.12;
  else if (signals.companyFuzzy > 0.7) score += 0.08;
  if (signals.locationOverlap) score += 0.05;
  if (signals.isCrossSource) score += 0.08;
  
  // Embedding signal (if available)
  if (signals.embeddingSimilarity > 0) {
    score += signals.embeddingSimilarity * 0.15;
  }
  
  return Math.min(1.0, score);
}
```

### 2.8. AI as "Supreme Court" — Upgraded Prompting Strategy

The AI tier should be treated as a high-accuracy final adjudicator, not a bulk classifier. Key improvements over the current approach:

#### Smaller Batch Size (10–15 Pairs)

The current batch size of 50 pairs risks **"Lost in the Middle" hallucination** — a well-documented LLM failure mode where items in the center of a long prompt receive degraded attention. Since the funnel now sends only ~20–40 pairs to AI (vs. hundreds), we can afford higher-quality smaller batches:

```typescript
const AI_BATCH_SIZE = 12;        // Down from 50 — dramatically better accuracy
const AI_BATCH_TIMEOUT_MS = 30_000;  // Shorter timeout — smaller batches finish faster
```

#### Timeline-Aware "Detective" Prompt

Stop asking Gemini to compare strings. Ask it to reason about **career trajectories and real-world plausibility**:

```typescript
const SYSTEM_PROMPT = `You are a contact de-duplication expert for a personal CRM.
You determine if two contact records represent the same real-world person.
You are conservative — only flag as duplicate when genuinely confident.

IMPORTANT REASONING GUIDELINES:
- Consider career progression: a person may have changed companies, titles, or locations
  (e.g., "SWE at Stripe" in 2022 → "Founder of Acme AI" in 2024 is plausible)
- Consider name evolution: married names, preferred names, cultural naming patterns
- Consider data staleness: Apple Contacts may have outdated info vs. LinkedIn's current profile
- If contacts were imported from DIFFERENT sources (Apple vs LinkedIn), the same person
  appearing in both is expected and common`;
```

**Example enhanced AI prompt:**
```
Pair 3:
  Contact A: "Sarah Chen" | Company: Stripe | Role: Product Manager | Source: Apple (added 2023)
  Contact B: "Sarah L. Chen" | Company: Notion | Role: Head of Product | Source: LinkedIn (added 2025)
  Signal: Name similarity = 89%, different companies, cross-source
  
  Question: Could Contact B be the same person as Contact A, having changed jobs?
```

This prompt style lets Gemini apply world knowledge about typical career moves, rather than just string comparison — which `nlp.ts` already does better.

---

### 2.9. Soft Merge Architecture — Reversible Resolution (Alternative)

The current merge logic **hard-deletes** the duplicate contact. For auto-merges (where the user didn't explicitly approve), this is high-risk. An alternative: **soft merge via `canonical_id`**.

#### How It Works

```sql
ALTER TABLE contacts ADD COLUMN canonicalId TEXT REFERENCES contacts(id);
```

Instead of deleting the duplicate:
1. Set `duplicate.canonicalId = primary.id`
2. Transfer child records (emails, phones, etc.) to the primary — same as today
3. **Do NOT delete** the duplicate row

```typescript
// Soft merge: point duplicate to primary
sqlite.prepare(
  "UPDATE contacts SET canonicalId = ? WHERE id = ?"
).run(primaryId, duplicateId);
```

All CRM read queries filter on `canonicalId IS NULL`:

```sql
-- Existing: SELECT * FROM contacts WHERE isGhost = 0
-- Updated:  SELECT * FROM contacts WHERE isGhost = 0 AND canonicalId IS NULL
```

#### Why This Is Better for Auto-Merges

| Aspect | Hard Delete (current) | Soft Merge (canonical_id) |
|---|---|---|
| **Undo** | Requires JSON snapshot + complex re-creation | `SET canonicalId = NULL` — instant |
| **Audit trail** | Must store full duplicate snapshot | Original row still exists |
| **Data loss risk** | Permanent if undo snapshot is incomplete | Zero — row is never deleted |
| **Query overhead** | None | Minimal — `AND canonicalId IS NULL` added to WHERE |
| **Storage** | Reclaims disk space | Retains deleted contact rows (~100 bytes each) |

> [!IMPORTANT]
> **Recommendation:** Use soft merge for **auto-merges** (background, no user approval) and hard delete for **user-initiated merges** (explicit approval implies confidence). This gives the best of both worlds: safe automation + clean manual merges.

#### Undo Flow

```typescript
async function undoMerge(duplicateId: string, rid: string): Promise<void> {
  const dup = sqlite.prepare(
    "SELECT * FROM contacts WHERE id = ? AND canonicalId IS NOT NULL"
  ).get(duplicateId);
  if (!dup) throw new Error('Contact not found or not soft-merged');
  
  const primaryId = dup.canonicalId;
  
  sqlite.transaction(() => {
    // 1. Unlink: remove canonical pointer
    sqlite.prepare(
      "UPDATE contacts SET canonicalId = NULL WHERE id = ?"
    ).run(duplicateId);
    
    // 2. Re-transfer child records that belong to this contact
    //    (Use source tracking in dedupe_merge_log to know which records moved)
    // ... restore emails, phones, etc. back to duplicateId
  })();
}
```

---

### 2.10. How Tiers Work Together — A Practical Example

Let's trace a real duplicate through the funnel:

```
Contact A (Apple):    "Bobby Johnson"    | phone: (555) 867-5309 | email: bob@gmail.com
Contact B (LinkedIn): "Robert Johnson"   | phone: none           | email: none           | company: Acme Corp  
Contact C (LinkedIn): "Robert A. Johnson"| phone: none           | email: bob@gmail.com  | company: Acme Corporation
Contact D (Manual):   "R. Johnson"       | phone: 555-867-5309   | email: none
```

**Tier 1 — Identity Anchors:**
- A ↔ C: shared email `bob@gmail.com` → pair (0.98)
- A ↔ D: shared phone `5558675309` → pair (0.95)

**Tier 2 — Name Rules:**
- B ↔ C: exact last name "Johnson" + nickname "Robert" = "Robert" → pair (0.88)
- A ↔ B: nickname "Bobby" ↔ "Robert" + exact last name "Johnson" → pair (0.88)

**Tier 3 — Blocking:**
- D ("R. Johnson") shares blocking key `LN:johnson` with A, B, C
- D is a candidate pair with A, B, C

**Tier 4 — Fuzzy Scoring:**
- B ↔ D: `nameSimilarity("Robert Johnson", "R. Johnson")` → initial match 0.85 → passes threshold
- A ↔ B: already caught in Tier 2, skip

**Tier 5 — AI Verification:**
- B ↔ D only: "Is 'Robert Johnson' at Acme Corp the same as 'R. Johnson' with no company?" → AI says yes (0.75)

**Tier 6 — Clustering:**
- Union-Find: A↔C, A↔D, B↔C, A↔B, B↔D → single cluster: {A, B, C, D}
- Auto-select primary: A (has email + phone + avatar)

**Result: 1 cluster, 4 contacts, resolved with 1 AI call instead of 6.**

### 2.11. Comparison: Current vs. Proposed

| Aspect | Current | Proposed |
|---|---|---|
| **Deterministic signals** | Email, phone only | Email, phone, name, nickname, company, cross-source, external IDs |
| **Name matching in deterministic** | None | Exact, nickname, initial, Metaphone |
| **Blocking/indexing** | None (O(n²) brute force) | Multi-key blocking + persistent phonetic hashes → O(n·k) |
| **Negative constraints** | None | Co-occurrence anti-match, user exclusions, contradictory IDs |
| **AI usage** | All fuzzy pairs (~500K candidates) | Only genuinely ambiguous (~20–40 pairs) |
| **AI batch size** | 50 pairs (hallucination risk) | 10–15 pairs (higher accuracy) |
| **AI prompt quality** | String comparison | Timeline-aware career reasoning |
| **Embedding support** | None | Optional Gemini + sqlite-vec for contextual matching |
| **Merge safety** | Hard delete (permanent) | Soft merge (canonical_id) for auto-merges, hard delete for manual |
| **API cost for 1K contacts** | ~10–20 Gemini batch calls | ~2–3 Gemini batch calls |
| **Scan time (1K contacts)** | 30–120 seconds | 5–15 seconds |
| **Recall on exact-name dupes** | 0% in deterministic, partial in AI | 100% in deterministic |

---

## 3. UX Vision — From Scan Button to Proactive Intelligence

### 3.1. What's Wrong With the Current UX

The current dedupe UX follows a **manual scan model**:

1. User navigates to Settings → Dedupe Engine
2. User selects a scan mode (Deterministic / AI / Both)
3. User clicks "Begin Scan"
4. User waits for scan to complete
5. User reviews clusters one-by-one (swipe or list view)
6. User manually merges or dismisses each cluster

**Problems with this approach:**

- **Discovery friction** — Users don't know they have duplicates until they actively go looking
- **Time-investment barrier** — Scanning + reviewing requires the user to dedicate time
- **Import-time gap** — After importing 400 LinkedIn contacts, the user must remember to go run a dedupe scan
- **No continuous monitoring** — New duplicates introduced by manual entry or subsequent imports go undetected until the next manual scan
- **Cognitive load** — 115+ clusters to review is overwhelming for a "quick cleanup"

### 3.2. The Vision: "Contrack Suggestions" — Proactive Deduplication

Instead of a manual scan button, dedupe should work like:

1. **Automatic** — Runs in the background, triggered by data changes
2. **Proactive** — Shows suggestions to the user without them asking
3. **Ambient** — Lives in the sidebar as a persistent notification badge
4. **Progressive** — High-confidence matches are auto-merged; only ambiguous cases need human review
5. **Non-blocking** — Never interrupts the user's workflow

#### The New Mental Model

```
╔═══════════════════════════════════════════════════════════════════════╗
║                    CONTRACK SUGGESTIONS                              ║
║                                                                       ║
║  ┌─────────────────────────────────────────────────────────────────┐  ║
║  │  🔔  12 suggestions waiting for review                          │  ║
║  │                                                                   │  ║
║  │  ┌── High Confidence (auto-merged) ──────────────────────────┐  │  ║
║  │  │  ✅ 87 contacts auto-merged (exact name + cross-source)   │  │  ║
║  │  │  View audit log  →                                         │  │  ║
║  │  └────────────────────────────────────────────────────────────┘  │  ║
║  │                                                                   │  ║
║  │  ┌── Review Queue (needs your eyes) ─────────────────────────┐  │  ║
║  │  │                                                             │  │  ║
║  │  │  1. Bobby Johnson ↔ Robert Johnson       88% match    [▶]  │  │  ║
║  │  │  2. Sarah Chen ↔ S. Chen                 75% match    [▶]  │  │  ║
║  │  │  3. Mike Smith ↔ Michael Smith            72% match    [▶]  │  │  ║
║  │  │  ...                                                        │  │  ║
║  │  │                                                             │  │  ║
║  │  │  [Merge All High-Confidence]  [Review One-by-One]          │  │  ║
║  │  └─────────────────────────────────────────────────────────────┘  │  ║
║  │                                                                   │  ║
║  │  ┌── Recent Activity ────────────────────────────────────────┐  │  ║
║  │  │  📋 Last scan: 2 hours ago · 12 new suggestions           │  │  ║
║  │  │  📋 Yesterday: auto-merged 3 exact matches                │  │  ║
║  │  │  📋 Last week: you reviewed 8 suggestions                 │  │  ║
║  │  └────────────────────────────────────────────────────────────┘  │  ║
║  └─────────────────────────────────────────────────────────────────┘  ║
╚═══════════════════════════════════════════════════════════════════════╝
```

### 3.3. Trigger-Based Background Scanning

Instead of a manual "Begin Scan" button, deduplication runs automatically:

| Trigger | What Runs | Why |
|---|---|---|
| **Import complete** (CSV, LinkedIn, etc.) | Full scan (Tiers 1–5) | New bulk contacts likely overlap with existing ones |
| **Contact created/edited** | Incremental scan (Tiers 1–4 for the changed contact only) | Check if the new/edited contact matches anyone |
| **Daily cron** (midnight) | Full scan (Tiers 1–5) | Catch any drift or missed matches |
| **User opens Suggestions page** | Surface cached results (no new scan) | Instant, no waiting |

#### Incremental Scan Architecture

```typescript
async function incrementalDedupeCheck(contactId: string, rid: string): Promise<void> {
  const ctx = buildPassContext(rid);
  const target = ctx.contactMap.get(contactId);
  if (!target) return;
  
  const normalized = normalizeContact(target);
  const pairs: RawPair[] = [];
  
  // Only compare the new/changed contact against all others
  // This is O(n) instead of O(n²)
  for (const other of ctx.allContacts) {
    if (other.id === contactId) continue;
    const otherNorm = normalizeContact(other);
    
    // Run Tiers 1–4 for this single pair
    const score = computeCompositeScore(
      computeMatchSignals(normalized, otherNorm)
    );
    
    if (score >= SUGGESTION_THRESHOLD) {
      pairs.push({
        idA: contactId,
        idB: other.id,
        matchType: score >= 0.90 ? 'email' : 'ai', // TODO: more granular
        confidence: score,
        reasoning: generateMatchReasoning(normalized, otherNorm),
      });
    }
  }
  
  if (pairs.length > 0) {
    // Store suggestions in a persistent table (not ephemeral queue)
    storeSuggestions(pairs, rid);
  }
}
```

### 3.4. Persistent Suggestions Table

Currently, dedupe results are ephemeral (in-memory, lost on restart). For proactive deduplication, we need persistent storage:

```sql
CREATE TABLE dedupe_suggestions (
  id TEXT PRIMARY KEY,
  contactIdA TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  contactIdB TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  matchType TEXT NOT NULL,           -- 'email' | 'phone' | 'name' | 'nickname' | 'ai'
  confidence REAL NOT NULL,
  reasoning TEXT NOT NULL,
  matchedField TEXT,
  
  -- Lifecycle management
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'merged' | 'dismissed' | 'auto_merged'
  createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  reviewedAt TEXT,
  reviewedBy TEXT,                    -- 'user' | 'auto'
  
  -- Prevent duplicate suggestions
  UNIQUE(contactIdA, contactIdB)     -- only one suggestion per pair
);

CREATE INDEX idx_dedupe_status ON dedupe_suggestions(status);
CREATE INDEX idx_dedupe_confidence ON dedupe_suggestions(confidence DESC);
```

### 3.5. Confidence-Based Auto-Merge

Not all suggestions need human review. High-confidence matches can be auto-merged:

```typescript
const AUTO_MERGE_THRESHOLD = 0.93;      // Auto-merge without asking
const REVIEW_THRESHOLD = 0.60;          // Show in review queue
const DISMISS_THRESHOLD = 0.60;         // Below this, don't even suggest

async function processNewSuggestions(pairs: RawPair[], rid: string): Promise<void> {
  for (const pair of pairs) {
    if (pair.confidence >= AUTO_MERGE_THRESHOLD) {
      // Auto-merge: deterministic match, no human needed
      try {
        const primaryId = selectBestPrimaryId(pair.idA, pair.idB);
        const duplicateId = pair.idA === primaryId ? pair.idB : pair.idA;
        dedupeService.mergeContacts(primaryId, duplicateId, rid);
        storeSuggestion(pair, 'auto_merged');
        log.info('Dedupe', `Auto-merged ${duplicateId} into ${primaryId} (${pair.confidence})`);
      } catch (err) {
        storeSuggestion(pair, 'pending'); // Fallback to review queue
      }
    } else if (pair.confidence >= REVIEW_THRESHOLD) {
      // Add to review queue for user
      storeSuggestion(pair, 'pending');
    }
    // Below REVIEW_THRESHOLD: ignore
  }
}
```

### 3.6. The Sidebar Badge

The sidebar should show a persistent notification when suggestions are pending:

```
┌─────────────────────────┐
│  🏠 Dashboard           │
│  👥 Network             │
│  📊 Pulse               │
│  ────────────────────── │
│  ✨ Suggestions  (12)   │  ← Badge with count
│  ⚙️ Settings            │
└─────────────────────────┘
```

The badge count comes from a simple query:

```sql
SELECT COUNT(*) FROM dedupe_suggestions WHERE status = 'pending';
```

### 3.7. The Suggestions Page

A new top-level page (not buried in Settings) that surfaces all actionable intelligence:

```
/suggestions  →  SuggestionsView
```

This page has multiple sections:

#### Section 1: Auto-Merged Activity Feed

```
Today
  ✅ "Praneeth Gottipati" (Apple) merged into "Praneeth Gottipati" (LinkedIn)
  ✅ "Trevor Holmgren" (Apple) merged into "Trevor Holmgren" (LinkedIn)
  ✅ ... 85 more auto-merges
  
  [View Full Audit Log]
```

#### Section 2: Review Queue (Swipe/List view — existing UI reused)

The existing ClusterSwipeCard and ClusterList components are reused here, fed by the persistent suggestions table instead of the ephemeral scan results.

#### Section 3: Suggestion History

```
  🕐 "Bobby Johnson" ↔ "Robert Johnson" — merged 2 days ago
  ❌ "John Smith" ↔ "John Smith" — kept separate (different people)
```

### 3.8. "Delta-Merge" Swipe Card — Solving User Anxiety

The #1 fear preventing users from hitting "Merge" is **data loss**. The current side-by-side comparison forces users to play "Spot the Difference" — a cognitively expensive task that makes them feel uncertain.

#### The Redesign: Unified Preview Card

Instead of showing two separate profiles, show **ONE unified card** representing what the final merged contact will look like — with highlights showing what's being gained:

```
┌─────────────────────────────────────────────────────────────────────┐
│  🤖 AI Theory: "Bobby likely left Stripe to co-found Acme Corp"    │
│                                                                       │
│  ┌── Merged Result Preview ──────────────────────────────────────┐  │
│  │                                                                 │  │
│  │    👤  Bobby Johnson                                            │  │
│  │    🏢  Acme Corp · VP Engineering                               │  │
│  │    📍  San Francisco, CA                                        │  │
│  │                                                                 │  │
│  │    📧  bobby@gmail.com                                          │  │
│  │  ✨📧  robert.johnson@acme.com        ← NEW from LinkedIn      │  │
│  │    📱  (555) 867-5309                                           │  │
│  │  ✨🔗  linkedin.com/in/bobjohnson     ← NEW from LinkedIn      │  │
│  │  ✨🏫  Stanford University · CS       ← NEW from LinkedIn      │  │
│  │                                                                 │  │
│  │  ┌─── Conflict ───────────────────────────────────────────┐    │  │
│  │  │  Title: ○ VP Sales (Apple)   ● VP Engineering (LinkedIn) │    │  │
│  │  └─────────────────────────────────────────────────────────┘    │  │
│  │                                                                 │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  🛡️ Safe Merge: No existing data will be lost                       │
│                                                                       │
│  [← Keep Separate]                         [Merge All →]             │
└─────────────────────────────────────────────────────────────────────┘
```

**Key UI elements:**

| Element | Purpose |
|---|---|
| **✨ NEW badges** | Green-highlighted rows showing additive data from the duplicate. Users see exactly what they *gain* by merging. |
| **Conflict toggles** | For fields where both contacts have different values (e.g., different job titles), show an inline radio toggle so the user picks the correct one *before* swiping. |
| **🛡️ Trust badge** | Always-visible "Safe Merge: No existing data will be lost" reassurance at the bottom. (This is true — our merge is additive-only.) |
| **🤖 AI Theory** | If available, show Gemini's reasoning ("Bobby likely changed jobs from Stripe to Acme") to give context for *why* these might be the same person. |

This transforms the merge decision from "Am I losing data?" to "Look at all the data I'm gaining!" — a psychological shift that dramatically increases merge confidence and speed.

### 3.9. Point-of-Action Contextual Interception

Don't trap deduplication inside a dedicated queue page. Intercept users **at the moment they're already thinking about a specific contact**.

#### Contact Profile Banner

When a user visits a contact's profile page, check if that contact has a pending suggestion:

```typescript
// In ContactDetail.tsx — on mount or contact change
const pendingSuggestion = useQuery({
  queryKey: ['dedupe-suggestion', contact.id],
  queryFn: () => fetch(`/api/dedupe/suggestion-for/${contact.id}`).then(r => r.json()),
  staleTime: 60_000,
});
```

If a pending suggestion exists, render a subtle glowing banner:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ✨ We found another contact that might be Bobby Johnson.           │
│     Robert Johnson (LinkedIn · VP Engineering at Acme Corp)         │
│                                                                       │
│  [Review Match]                    [Not the same person]             │
└─────────────────────────────────────────────────────────────────────┘
```

This pattern works because:
- The user is already cognitively invested in this contact
- They have full context (they were about to call/email them)
- The decision to merge requires near-zero additional mental effort
- It turns deduplication from "database chore" to "helpful nudge"

#### Search Results Inline Suggestion

Similarly, when the user searches for a name and gets multiple results that are pending suggestions, show a subtle link:

```
Search: "Bobby"   →   Bobby Johnson (Apple)  ← "⚡ Possible duplicate"
                      Robert Johnson (LinkedIn)
```

### 3.10. Import-Time Deduplication

The most impactful UX improvement: **deduplication at import time**.

When the user imports a CSV or LinkedIn export:

```
┌─────────────────────────────────────────────────────────────────────┐
│  📥 Import Complete                                                  │
│                                                                       │
│  Imported 402 contacts from LinkedIn                                  │
│                                                                       │
│  ┌── Duplicate Analysis ─────────────────────────────────────────┐  │
│  │  🟢 87 exact matches auto-merged                              │  │
│  │  🟡 12 likely matches (need your review)                      │  │
│  │  ⚪ 303 new unique contacts                                   │  │
│  │                                                                 │  │
│  │  [Review 12 Suggestions]    [Skip for Now]                    │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.11. "Never Merge" Safeguard — User Corrections

When a user dismisses a suggestion (keeps contacts separate), that decision should be persisted so the engine never re-suggests it:

```sql
CREATE TABLE dedupe_exclusions (
  contactIdA TEXT NOT NULL,
  contactIdB TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  PRIMARY KEY (contactIdA, contactIdB)
);
```

Every scan checks exclusions before suggesting. This feeds into the **Tier 3.5 Negative Constraints** filter ([Section 2.5](#25-tier-35--negative-constraints--anti-match-filter-new)):

```typescript
function isExcluded(idA: string, idB: string): boolean {
  const [a, b] = idA < idB ? [idA, idB] : [idB, idA];
  const row = sqlite.prepare(
    "SELECT 1 FROM dedupe_exclusions WHERE contactIdA = ? AND contactIdB = ?"
  ).get(a, b);
  return !!row;
}
```

### 3.12. Undo / Audit Trail for Auto-Merges

Since auto-merging happens without user consent, we need a safety net. The approach depends on whether we use **soft merge** or **hard delete**:

#### If Using Soft Merge (canonical_id — recommended for auto-merges)

Undo is trivial: `SET canonicalId = NULL`. The duplicate contact row was never deleted. See [Section 2.9](#29-soft-merge-architecture--reversible-resolution-alternative).

```sql
CREATE TABLE dedupe_merge_log (
  id TEXT PRIMARY KEY,
  primaryId TEXT NOT NULL,
  duplicateId TEXT NOT NULL,
  mergedBy TEXT NOT NULL,          -- 'user' | 'auto'
  mergeType TEXT NOT NULL,         -- 'soft' | 'hard'
  confidence REAL NOT NULL,
  reasoning TEXT NOT NULL,
  mergedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
```

No snapshot needed — the original data is still in the `contacts` row.

#### If Using Hard Delete (user-initiated merges)

```sql
CREATE TABLE dedupe_merge_log (
  id TEXT PRIMARY KEY,
  primaryId TEXT NOT NULL,
  duplicateId TEXT NOT NULL,
  mergedBy TEXT NOT NULL,          -- 'user' | 'auto'
  mergeType TEXT NOT NULL DEFAULT 'hard',
  confidence REAL NOT NULL,
  reasoning TEXT NOT NULL,
  mergedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  -- Snapshot for hard deletes only
  duplicateSnapshot TEXT            -- JSON blob of the deleted contact's full data
);
```

The activity feed surfaces these with an `[Undo]` action:

```
✨ Auto-merged "Praneeth Gottipati" (Apple → LinkedIn)  [Undo]
```

---

## 4. Implementation Roadmap

> [!IMPORTANT]
> This roadmap is the **build guide** for the new dedupe engine. Each phase has specific files to change, functions to create, SQL to run, and acceptance criteria. Phases are ordered by dependency — each builds on the previous.

---

### Phase 1: Data Normalization & Schema Upgrades

**Goal:** Establish the foundation layer — normalize contact data, add phonetic indexing, create all new database tables, and install embedding infrastructure.

**Dependencies:** None — this is the foundation.

#### 1a. Schema Migrations

Create or alter the following tables:

```sql
-- 1. Soft merge support
ALTER TABLE contacts ADD COLUMN canonicalId TEXT REFERENCES contacts(id);

-- 2. Phonetic indexing (computed on save, used for blocking)
ALTER TABLE contacts ADD COLUMN phoneticHash TEXT;
CREATE INDEX idx_contacts_phonetic ON contacts(phoneticHash);

-- 3. Persistent suggestion storage
CREATE TABLE IF NOT EXISTS dedupe_suggestions (
  id TEXT PRIMARY KEY,
  contactIdA TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  contactIdB TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  matchType TEXT NOT NULL,           -- 'email' | 'phone' | 'name' | 'nickname' | 'embedding' | 'ai'
  confidence REAL NOT NULL,
  reasoning TEXT NOT NULL,
  matchedField TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'merged' | 'dismissed' | 'auto_merged'
  createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  reviewedAt TEXT,
  reviewedBy TEXT,                    -- 'user' | 'auto'
  UNIQUE(contactIdA, contactIdB)
);
CREATE INDEX idx_dedupe_status ON dedupe_suggestions(status);
CREATE INDEX idx_dedupe_confidence ON dedupe_suggestions(confidence DESC);

-- 4. Never-merge exclusions
CREATE TABLE IF NOT EXISTS dedupe_exclusions (
  contactIdA TEXT NOT NULL,
  contactIdB TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  PRIMARY KEY (contactIdA, contactIdB)
);

-- 5. Merge audit log
CREATE TABLE IF NOT EXISTS dedupe_merge_log (
  id TEXT PRIMARY KEY,
  primaryId TEXT NOT NULL,
  duplicateId TEXT NOT NULL,
  mergedBy TEXT NOT NULL,             -- 'user' | 'auto'
  mergeType TEXT NOT NULL,            -- 'soft' | 'hard'
  confidence REAL NOT NULL,
  reasoning TEXT NOT NULL,
  mergedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  duplicateSnapshot TEXT              -- JSON blob (for hard deletes only)
);

-- 6. Embedding vector storage (requires sqlite-vec)
CREATE VIRTUAL TABLE IF NOT EXISTS contact_embeddings USING vec0(
  contactId TEXT PRIMARY KEY,
  embedding FLOAT[768]
);
```

**Files:**
- `src/db/schema.ts` — Add Drizzle schemas for new tables + columns
- `src/db/migrations/` — Create migration file for schema changes
- `server/db/index.ts` — Load `sqlite-vec` extension on boot

**Tasks:**
- [ ] Add `canonicalId` column to contacts table (Drizzle schema + migration)
- [ ] Add `phoneticHash` column to contacts table (Drizzle schema + migration)
- [ ] Create `dedupe_suggestions` table schema
- [ ] Create `dedupe_exclusions` table schema
- [ ] Create `dedupe_merge_log` table schema
- [ ] Install `sqlite-vec` npm package, load extension in DB init
- [ ] Create `contact_embeddings` virtual table
- [ ] Update **all** contact read queries to add `AND canonicalId IS NULL` filter
- [ ] Verify migration runs cleanly on existing 1,082-contact database

#### 1b. NLP Engine Upgrades

Add new utilities to the NLP module for the normalization pipeline:

**File:** `server/utils/nlp.ts`

**Tasks:**
- [ ] Add `normalizeCompany(name: string): string` — strips Inc/LLC/Corp/Ltd suffixes, lowercases, trims
- [ ] Add `isNicknameMatch(nameA: string, nameB: string): boolean` — checks last name exact + first name nickname equivalent
- [ ] Add `doubleMetaphone(name: string): { primary: string; alternate: string }` — install `natural` npm package or implement inline
- [ ] Export existing `normalizePhone()` (already exists, just ensure clean export)

#### 1c. Normalization Pipeline

Create the `NormalizedContact` pipeline that transforms raw DB contacts into comparison-ready structures.

**File:** `server/services/dedupeNormalization.ts` (NEW)

```typescript
export interface NormalizedContact {
  id: string;
  nameNorm: string;
  nameTokens: string[];
  firstNameNorm: string;
  lastNameNorm: string;
  phoneticHash: string;         // Double Metaphone primary code
  emailsNorm: string[];
  phonesNorm: string[];
  companyNorm: string;
  sources: string[];            // ['apple', 'linkedin', ...]
  blockKeys: string[];
  embeddingText: string;        // Pre-formatted for Gemini embedding API
}

export function normalizeContact(raw: RawContact): NormalizedContact { ... }
export function normalizeContacts(raws: RawContact[]): NormalizedContact[] { ... }
```

**Tasks:**
- [ ] Create `NormalizedContact` interface
- [ ] Implement `normalizeContact()` — tokenize name, compute Metaphone, normalize emails/phones/company, generate blocking keys, build embedding text string
- [ ] Implement bulk `normalizeContacts()` wrapper
- [ ] Write `generateBlockKeys(contact: NormalizedContact): string[]` — last name, Metaphone, first3+last, company+initial, emails, phones
- [ ] Write `contactToEmbeddingString(contact: NormalizedContact): string` — with `task: clustering | query:` prefix
- [ ] Write unit tests for normalization edge cases (titles, suffixes, empty names, single-name contacts)

#### 1d. Phonetic Hash Computation on Save

Hook into the contact save lifecycle to compute and persist `phoneticHash`:

**File:** `server/services/contactService.ts` (or equivalent)

**Tasks:**
- [ ] After `contactService.create()` — compute `doubleMetaphone(name).primary`, store in `phoneticHash` column
- [ ] After `contactService.update()` — recompute `phoneticHash` if name changed
- [ ] Backfill: Run a one-time migration to set `phoneticHash` for all 1,082 existing contacts

**Acceptance criteria:**
- [x] `SELECT COUNT(*) FROM contacts WHERE phoneticHash IS NOT NULL` = total contact count
- [x] `SELECT phoneticHash, COUNT(*) FROM contacts GROUP BY phoneticHash ORDER BY COUNT(*) DESC LIMIT 10` — shows expected clustering

---

### Phase 2: Embedding Layer

**Goal:** Generate and store Gemini embeddings for all contacts, enabling semantic blocking and contextual matching.

**Dependencies:** Phase 1 (schema + normalization pipeline)

#### 2a. Embedding Generation Service

**File:** `server/services/dedupeEmbeddings.ts` (NEW)

```typescript
import { GoogleGenAI } from '@google/genai';

const EMBED_MODEL = 'gemini-embedding-2-preview';
const EMBED_DIMENSIONS = 768;
const EMBED_BATCH_SIZE = 100;

export async function generateContactEmbeddings(
  contacts: NormalizedContact[],
  rid: string
): Promise<Map<string, number[]>> { ... }

export async function generateSingleEmbedding(
  contact: NormalizedContact,
  rid: string
): Promise<number[]> { ... }

export function storeEmbedding(contactId: string, embedding: number[]): void { ... }

export function findNearestNeighbors(
  contactId: string,
  limit?: number
): { contactId: string; distance: number }[] { ... }
```

**Tasks:**
- [ ] Implement `generateContactEmbeddings()` — batch embed via `ai.models.embedContent()`
  - Use `gemini-embedding-2-preview` model
  - Set `outputDimensionality: 768` (MRL truncation)
  - Normalize output vectors manually (divide by L2 norm)
  - Rate-limit aware: respect Gemini API rate limits, add exponential backoff
- [ ] Implement `generateSingleEmbedding()` — single contact, used on create/edit
- [ ] Implement `storeEmbedding()` — INSERT OR REPLACE into `contact_embeddings`
- [ ] Implement `findNearestNeighbors()` — `WHERE embedding MATCH ? ORDER BY distance LIMIT ?`
- [ ] Add error handling: if embedding API fails, log warning and continue without embedding (graceful degradation)
- [ ] Add progress callback parameter for batch embedding (to report to SSE stream)

#### 2b. Batch Backfill for Existing Contacts

**Tasks:**
- [ ] Create `backfillEmbeddings()` function that loads all contacts, normalizes, batches through Gemini, stores results
- [ ] Add progress logging: `"Embedding batch 3/11 (300/1082 contacts)..."`
- [ ] Expose via API endpoint: `POST /api/dedupe/backfill-embeddings`
- [ ] Also trigger automatically on first full scan if embeddings table is empty
- [ ] Add concurrency guard: only one backfill at a time

#### 2c. Incremental Embedding on Contact Save

**File:** `server/services/contactService.ts`

**Tasks:**
- [ ] After `contactService.create()` — fire background `generateSingleEmbedding()` and `storeEmbedding()`
- [ ] After `contactService.update()` — if name, company, role, or location changed, recompute embedding
- [ ] After bulk import — fire background `generateContactEmbeddings()` for all imported contacts

**Acceptance criteria:**
- [x] `SELECT COUNT(*) FROM contact_embeddings` = total active contact count
- [x] `findNearestNeighbors('some-contact-id', 5)` returns sensible results
- [x] Creating a new contact → embedding appears in `contact_embeddings` within 5 seconds
- [x] Editing a contact's company → embedding updates

---

### Phase 3: Expanded Deterministic Engine + Blocking

**Goal:** Fix the deterministic pass to catch name-based duplicates, implement multi-key + embedding-based blocking to replace O(n²) brute force.

**Dependencies:** Phase 1 (normalization), Phase 2 (embeddings)

#### 3a. Expanded Deterministic Pass

**File:** `server/services/dedupeService.ts` — rewrite `runDeterministicPass()`

The deterministic pass should now run through **6 tiers** of matching:

| Tier | Signal | Confidence | Implementation |
|---|---|---|---|
| D1 | Exact email overlap | 0.98 | SQL JOIN (existing) |
| D2 | Exact phone overlap | 0.95 | Hash map (existing) |
| D3 | Exact name match | 0.90 | SQL JOIN on `LOWER(TRIM(name))` |
| D4 | Exact name + same company | 0.95 | D3 + `normalizeCompany()` comparison |
| D5 | Nickname-equivalent name | 0.88 | `isNicknameMatch()` from nlp.ts |
| D6 | Cross-source exact name | 0.92 | D3 + `contact_sources` platform check |

**Tasks:**
- [ ] Add D3: exact name match — SQL `JOIN contacts c2 ON LOWER(TRIM(c1.name)) = LOWER(TRIM(c2.name)) WHERE c1.id < c2.id`
- [ ] Add D4: name + company — D3 results filtered by `normalizeCompany(a.company) === normalizeCompany(b.company)`
- [ ] Add D5: nickname equivalence — iterate D3 near-misses and check `isNicknameMatch()`
- [ ] Add D6: cross-source boosting — for D3 matches, check if platforms differ, boost confidence to 0.92
- [ ] Deduplicate pairs: if a pair is already caught by D1/D2, skip it in D3–D6
- [ ] Return all pairs as `RawPair[]` with correct `matchType` and `confidence`
- [ ] Update progress reporting to show name-based match counts

#### 3b. Multi-Key Blocking Engine

**File:** `server/services/dedupeBlocking.ts` (NEW)

```typescript
export function buildBlockIndex(
  contacts: NormalizedContact[]
): Map<string, string[]> { ... }

export function generateCandidatePairs(
  blockIndex: Map<string, string[]>,
  alreadyPaired: Set<string>
): Array<{ idA: string; idB: string }> { ... }
```

**Tasks:**
- [ ] Implement `buildBlockIndex()` — inverted index from blocking keys to contact IDs
  - Keys: `LN:${lastName}`, `LNM:${metaphone}`, `FL3:${first3}:${lastName}`, `CF:${company}:${firstInitial}`, `EM:${email}`, `PH:${phone}`
  - Skip mega-blocks (>100 contacts per key) to avoid O(k²) explosion on common last names
- [ ] Implement `generateCandidatePairs()` — iterate blocks, generate unique pairs, exclude already-matched pairs from deterministic pass
- [ ] Add embedding-based candidates: for each contact, query `findNearestNeighbors(id, 5)`, add resulting pairs to candidate pool
- [ ] Merge blocking candidates + embedding candidates into unified `Set<string>` of pair keys
- [ ] Log statistics: `"Blocking: 1,082 contacts → 6 block keys avg → 2,847 candidate pairs (vs 584,721 brute force)"`

#### 3c. Negative Constraint Filter (Anti-Match)

**File:** `server/services/dedupeBlocking.ts`

**Tasks:**
- [ ] Build co-occurrence set: `SELECT DISTINCT im1.contactId, im2.contactId FROM interaction_mentions im1 JOIN interaction_mentions im2 ON im1.interactionId = im2.interactionId AND im1.contactId < im2.contactId`
- [ ] Load exclusions: `SELECT contactIdA, contactIdB FROM dedupe_exclusions`
- [ ] Implement `filterNegativeConstraints(candidates, distinctPairs, exclusions): CandidatePair[]`
- [ ] Apply before fuzzy scoring — remove physically impossible matches

#### 3d. Fuzzy Scoring Sieve

**File:** `server/services/dedupeScoring.ts` (NEW)

```typescript
export interface MatchSignals { ... }  // From Section 2.7

export function computeMatchSignals(
  a: NormalizedContact, b: NormalizedContact,
  embeddingSimilarity: number,
  isKnownDistinct: boolean
): MatchSignals { ... }

export function computeCompositeScore(signals: MatchSignals): number { ... }
```

**Tasks:**
- [ ] Implement `computeMatchSignals()` — compute all signals from two NormalizedContacts
- [ ] Implement `computeCompositeScore()` — weighted scoring with hard veto for known-distinct
- [ ] For each candidate pair from blocking, compute composite score
- [ ] Filter: score ≥ 0.93 → auto-merge queue, 0.60–0.93 → AI verification queue, < 0.60 → discard
- [ ] Pair embedding similarity: load both embeddings from `contact_embeddings`, compute cosine similarity
- [ ] Bulk-load emails and phones in `buildPassContext()` to fix the N+1 query bottleneck

#### 3e. AI "Supreme Court" Pass

**File:** `server/services/dedupeService.ts` — rewrite `runAIPass()`

**Tasks:**
- [ ] Reduce batch size from 50 → 12 pairs per API call
- [ ] Reduce timeout from 60s → 30s (smaller batches are faster)
- [ ] Update system prompt to timeline-aware "detective" style (career progression, cross-source context)
- [ ] Only send pairs scoring 0.60–0.93 to AI (not all candidates)
- [ ] Include source platform info in AI prompt (`Source: Apple (added 2023)`)
- [ ] Include embedding similarity in AI context (`Embedding similarity: 87%`)
- [ ] Update fallback heuristic: if AI unavailable, use composite score thresholds directly

**Acceptance criteria:**
- [x] Full scan on 1,082 contacts completes in < 30 seconds (down from 30–120s)
- [x] Deterministic pass finds 115+ exact name matches
- [x] AI pass receives < 50 pairs (down from 500K+ candidates)
- [x] Total API cost per scan < $0.05

---

### Phase 4: Soft Merge + Persistent Suggestions

**Goal:** Replace ephemeral scan results with persistent suggestions, implement safe auto-merge with instant undo.

**Dependencies:** Phase 3 (detection engine produces pairs)

#### 4a. Soft Merge Implementation

**File:** `server/services/dedupeService.ts`

**Tasks:**
- [ ] Create `softMergeContacts(primaryId, duplicateId, rid)` function:
  - Transfer child records (emails, phones, tags, etc.) to primary — same logic as current `mergeContacts()`
  - Set `duplicate.canonicalId = primaryId` instead of DELETE
  - Record in `dedupe_merge_log` with `mergeType: 'soft'`
  - No `duplicateSnapshot` needed (row still exists)
- [ ] Update existing `mergeContacts()` to accept a `mergeType` parameter ('soft' | 'hard')
  - Default to 'hard' for user-initiated merges (backward compatible)
  - Use 'soft' for auto-merges
- [ ] Implement `undoSoftMerge(duplicateId, rid)`:
  - Set `canonicalId = NULL` on the duplicate
  - Re-transfer child records back using `dedupe_merge_log` tracking
  - Mark `dedupe_merge_log` entry as `undoneAt = NOW()`

#### 4b. Suggestion Pipeline

**File:** `server/services/dedupeSuggestions.ts` (NEW)

```typescript
export function storeSuggestion(pair: RawPair, status: string): void { ... }
export function storeSuggestions(pairs: RawPair[], status: string): void { ... }
export function getPendingSuggestions(): DedupesSuggestion[] { ... }
export function getPendingCount(): number { ... }
export function getSuggestionForContact(contactId: string): DedupeSuggestion | null { ... }
export function dismissSuggestion(id: string): void { ... }
export function markSuggestionMerged(id: string, mergedBy: 'user' | 'auto'): void { ... }
```

**Tasks:**
- [ ] Implement suggestion CRUD operations
- [ ] On scan complete: store all detected pairs as `pending` or `auto_merged`
- [ ] Implement confidence-based routing:
  - Score ≥ 0.93 → `softMergeContacts()` + store as `auto_merged`
  - Score 0.60–0.93 → store as `pending` (review queue)
  - Score < 0.60 → discard (don't store)
- [ ] On user dismiss → `INSERT INTO dedupe_exclusions` + `UPDATE status = 'dismissed'`
- [ ] On user merge → `mergeContacts(hard)` + `UPDATE status = 'merged'`
- [ ] Deduplicate: check `UNIQUE(contactIdA, contactIdB)` before inserting

#### 4c. API Endpoints

**File:** `server/routes/dedupe.ts`

**New endpoints:**
- [ ] `GET /api/dedupe/suggestions` — returns paginated pending suggestions
- [ ] `GET /api/dedupe/suggestions/count` — returns count of pending suggestions (for sidebar badge)
- [ ] `GET /api/dedupe/suggestion-for/:contactId` — returns pending suggestion involving this contact (for point-of-action banner)
- [ ] `POST /api/dedupe/suggestions/:id/dismiss` — dismiss a suggestion (adds to exclusions)
- [ ] `POST /api/dedupe/suggestions/:id/merge` — merge a suggestion pair
- [ ] `GET /api/dedupe/merge-log` — returns auto-merge audit log (paginated)
- [ ] `POST /api/dedupe/merge-log/:id/undo` — undo a soft merge

**Acceptance criteria:**
- [x] Auto-merge: exact-name + cross-source pairs are auto-merged silently
- [x] Review queue: ambiguous pairs appear as pending suggestions
- [x] Undo: auto-merged contacts can be un-merged via API
- [x] Exclusions: dismissed pairs are never re-suggested on subsequent scans

---

### Phase 5: Orchestration — Full Scan Rewrite

**Goal:** Wire together all the new components into a coherent scan lifecycle that replaces the current 2-pass engine.

**Dependencies:** Phase 3 (detection), Phase 4 (suggestions)

#### 5a. Rewrite `runScan()`

**File:** `server/services/dedupeService.ts`

Replace the current `runScan()` with the funnel architecture:

```
Phase 'normalizing'  → normalizeContacts() + ensure embeddings exist
Phase 'deterministic' → runDeterministicPass() [Tiers D1–D6]
Phase 'blocking'      → buildBlockIndex() + generateCandidatePairs() + findNearestNeighbors()
Phase 'filtering'     → filterNegativeConstraints()
Phase 'scoring'       → computeCompositeScore() for each candidate
Phase 'ai'            → runAIPass() on 0.60–0.93 scored pairs only
Phase 'clustering'    → buildClusters() [Union-Find, already exists]
Phase 'persisting'    → storeSuggestions() + auto-merge high-confidence
Phase 'complete'      → emit results
```

**Tasks:**
- [ ] Rewrite `runScan()` to follow the funnel phases above
- [ ] Update `dedupeJobQueue.ts` progress phases to match new pipeline
- [ ] Ensure SSE stream reports progress for each phase
- [ ] If `contact_embeddings` table is empty on scan start, trigger backfill first
- [ ] Handle "embeddings unavailable" gracefully: if Gemini API key is missing or API fails, skip embedding-based blocking and log warning
- [ ] After clustering: route clusters through suggestion pipeline (auto-merge vs review queue)
- [ ] Keep backward compatibility: scan modes 'deterministic' / 'ai' / 'both' still map to appropriate tier subsets

#### 5b. Incremental Resolution (Event-Driven)

**File:** `server/services/dedupeService.ts`

```typescript
export async function incrementalDedupeCheck(
  contactId: string,
  rid: string
): Promise<void> { ... }
```

**Tasks:**
- [ ] Implement `incrementalDedupeCheck()`:
  - Normalize the single contact
  - Run D1–D6 checks against all other contacts (O(n) via indexed lookups)
  - Find 5 nearest embedding neighbors, compute composite scores
  - Check against negative constraints
  - Store results as suggestions (auto-merge or pending)
- [ ] Hook into `contactService.create()` — fire `incrementalDedupeCheck()` in background (non-blocking)
- [ ] Hook into `contactService.update()` — fire if name, company, role, or location changed
- [ ] Hook into import completion — fire full scan for all imported contacts
- [ ] Add debouncing: if multiple edits to same contact within 5s, only run once

#### 5c. Scan Mode Mapping

Update how scan modes map to the funnel:

| User Selection | What Runs |
|---|---|
| "Quick Scan" (replaces "Deterministic") | Tiers 0–2 only (normalize + deterministic). No AI, no embeddings. ~2 seconds |
| "Deep Scan" (replaces "AI") | Tiers 0–5 (full funnel including blocking, scoring, AI). ~15 seconds |
| "Full Scan" (replaces "Both") | Same as Deep Scan + force re-embed all contacts. ~30 seconds (includes embedding backfill) |

**Tasks:**
- [ ] Rename scan modes in UI and API
- [ ] Update `DedupeView.tsx` scan mode selector to reflect new nomenclature
- [ ] Update `dedupeJobQueue.ts` mode enum

**Acceptance criteria:**
- [x] Quick Scan completes in < 5 seconds, catches 120+ name-based matches
- [x] Deep Scan completes in < 30 seconds, uses AI on < 50 pairs
- [x] Results are persisted: surviving a server restart, suggestions remain accessible
- [x] Incremental check fires on contact create/edit, produces suggestions within 5 seconds

---

### Phase 6: Proactive UX — Suggestions System

**Goal:** Transform the dedupe experience from a settings-buried manual scan into a proactive, ambient inbox.

**Dependencies:** Phase 4 (suggestions API), Phase 5 (orchestration)

#### 6a. Sidebar Badge

**File:** `src/components/layout/Sidebar.tsx` (or equivalent)

**Tasks:**
- [ ] Add React Query hook: `useDedupeCount()` → `GET /api/dedupe/suggestions/count`
  - Poll interval: 60 seconds (or invalidate on scan completion)
- [ ] Render badge next to "Suggestions" nav item: `✨ Suggestions (12)`
- [ ] Hide badge when count is 0
- [ ] Animate badge on count change (subtle pulse)
- [ ] Follow design system (per workflow `/design-system`)

#### 6b. Suggestions Page

**File:** `src/views/suggestions/SuggestionsView.tsx` (NEW)

**Tasks:**
- [ ] Create `/suggestions` route in router
- [ ] Build page with 3 sections:
  1. **Auto-Merged Activity Feed** — list of recent auto-merges with `[Undo]` buttons
  2. **Review Queue** — pending suggestions, reusing existing swipe card / list view components
  3. **History** — past merged/dismissed suggestions
- [ ] Reuse existing `ClusterSwipeCard` and `ClusterList` components, adapting them to consume from `dedupe_suggestions` API instead of ephemeral scan state
- [ ] Add "Merge All High-Confidence" batch action (merge all pending suggestions above user-chosen threshold)

#### 6c. Delta-Merge Swipe Card

**File:** `src/views/dedupe/components/ClusterSwipeCard.tsx` (MODIFY)

**Tasks:**
- [ ] Refactor swipe card to display **unified preview** of the merged result:
  - Show the primary contact's fields as the base
  - Highlight additive fields from duplicate with ✨ green NEW badge
  - Show conflict toggles for fields where both contacts have different values
- [ ] Add 🛡️ "Safe Merge: No data will be lost" trust badge at bottom
- [ ] Add 🤖 AI Theory section at top (when AI reasoning is available)
- [ ] Add match confidence percentage badge

#### 6d. Point-of-Action Banner

**File:** `src/views/contacts/ContactDetail.tsx` (MODIFY)

**Tasks:**
- [ ] Add `useQuery(['dedupe-suggestion', contact.id])` hook to check for pending suggestions
- [ ] If suggestion exists, render a subtle banner at top of contact detail:
  ```
  ✨ We found another contact that might be [Name]. [Review Match] [Not the same person]
  ```
- [ ] "Review Match" → navigate to suggestion review (or open inline modal)
- [ ] "Not the same person" → dismiss suggestion + add exclusion
- [ ] Banner styling: subtle gradient, dismissible, non-intrusive

#### 6e. Auto-Merge Activity Feed

**File:** `src/views/suggestions/components/ActivityFeed.tsx` (NEW)

**Tasks:**
- [ ] Render list of auto-merged contacts from `dedupe_merge_log WHERE mergedBy = 'auto'`
- [ ] Each entry shows: `✨ Auto-merged "Name" (Source A → Source B) [Undo]`
- [ ] `[Undo]` calls `POST /api/dedupe/merge-log/:id/undo`
- [ ] Group by date (Today / Yesterday / This Week / Older)

**Acceptance criteria:**
- [x] Sidebar badge shows accurate pending count
- [x] `/suggestions` page surfaces review queue, auto-merge log, and history
- [x] Swipe card shows unified preview with ✨ gain highlights
- [x] Contact detail page shows contextual banner for pending suggestions
- [x] Auto-merged contacts can be undone from the activity feed

---

### Phase 7: Import-Time Deduplication

**Goal:** Run deduplication immediately after a bulk import, showing immediate feedback.

**Dependencies:** Phase 5 (orchestration), Phase 6 (suggestions UI)

**File:** `server/routes/import.ts` and `src/views/settings/ImportView.tsx` (or equivalent)

**Tasks:**
- [ ] After a CSV/LinkedIn import completes, trigger a full scan scoped to the imported contacts
- [ ] Show import summary with dedupe results:
  ```
  🟢 87 exact matches auto-merged
  🟡 12 likely matches (need review)
  ⚪ 303 new unique contacts
  ```
- [ ] "Review 12 Suggestions" button → navigate to `/suggestions` page
- [ ] Generate embeddings for all imported contacts before running the scan
- [ ] Ensure import scan doesn't block the import completion response (fire in background, SSE progress)

**Acceptance criteria:**
- [x] Importing 400 LinkedIn contacts → auto-merges 80+ exact duplicates within 30 seconds
- [x] Import summary shows breakdown of auto-merged / review / new contacts
- [x] Review button navigates to the suggestions page with relevant suggestions

---

### Phase 8: Polish & Hardening

**Goal:** Edge cases, performance optimization, and production readiness.

**Dependencies:** All previous phases.

**Tasks:**
- [ ] **Idempotency:** Running a scan twice produces the same suggestions (no duplicates in `dedupe_suggestions`)
- [ ] **Concurrency:** Multiple simultaneous contact edits don't produce race conditions in embedding generation
- [ ] **Large cluster safety:** Clusters with > 10 contacts get a WARNING flag and require explicit confirmation
- [ ] **Embedding staleness:** On full scan, check if any contacts have been updated since their last embedding was generated; re-embed only stale ones
- [ ] **Performance benchmarks:**
  - Quick Scan < 3 seconds for 1K contacts
  - Deep Scan < 20 seconds for 1K contacts
  - Incremental check < 3 seconds per contact
  - Embedding backfill < 60 seconds for 1K contacts
- [ ] **Error recovery:** If embedding API fails mid-scan, continue with blocking-only (no embedding candidates), log warning
- [ ] **Settings UI:** Add user preference for auto-merge confidence threshold (default 0.93, adjustable 0.85–0.99)
- [ ] **Keyboard shortcuts:** Ensure existing swipe card keyboard nav (h/l, arrow keys, ⌘Z) works on the new suggestions page
- [ ] **Clean up deprecated code:** Remove the old scan mode selector UI, update DedupeContext to work with persistent suggestions

---

### Phase Summary

```
┌───────────────────────────────────────────────────────────────────┐
│  PHASE 1: Foundation (Day 1–2)                                     │
│  Schema migrations, NLP upgrades, normalization pipeline,          │
│  phonetic hashing, sqlite-vec setup                                │
├───────────────────────────────────────────────────────────────────┤
│  PHASE 2: Embedding Layer (Day 2–3)                                │
│  Gemini embedding-2-preview integration, batch generation,         │
│  sqlite-vec storage, incremental on save                           │
├───────────────────────────────────────────────────────────────────┤
│  PHASE 3: Detection Engine (Day 3–5)                               │
│  Expanded deterministic (D1–D6), multi-key + embedding blocking,   │
│  negative constraints, fuzzy scoring, AI Supreme Court             │
├───────────────────────────────────────────────────────────────────┤
│  PHASE 4: Persistence (Day 5–6)                                    │
│  Soft merge, suggestion pipeline, new API endpoints,               │
│  auto-merge routing, exclusion management                          │
├───────────────────────────────────────────────────────────────────┤
│  PHASE 5: Orchestration (Day 6–7)                                  │
│  Full scan rewrite, incremental resolution, event hooks,           │
│  scan mode mapping, SSE progress updates                           │
├───────────────────────────────────────────────────────────────────┤
│  PHASE 6: Proactive UX (Day 7–9)                                   │
│  Sidebar badge, suggestions page, delta-merge cards,               │
│  point-of-action banners, activity feed, undo flow                 │
├───────────────────────────────────────────────────────────────────┤
│  PHASE 7: Import Integration (Day 9–10)                            │
│  Import-time dedup, immediate feedback, scoped scanning            │
├───────────────────────────────────────────────────────────────────┤
│  PHASE 8: Polish (Day 10–12)                                       │
│  Edge cases, benchmarks, error recovery, settings, cleanup         │
└───────────────────────────────────────────────────────────────────┘
```

---

## 5. Appendices

### Appendix A: Current Data Distribution

```
Database: curator.db (1,082 active contacts)

Sources:
  apple:    383 contacts
  linkedin: 802 contacts

Contact completeness:
  Has email:        116 (10.7%)
  Has phone:        254 (23.5%)
  Has both:          69 (6.4%)
  Has neither:      781 (72.2%)
  Has company:     ~600 (LinkedIn provides this)
  Has role:        ~500 (LinkedIn provides this)

Duplicate landscape:
  Exact name matches:        115 pairs
  Cross-source name matches: 106 pairs (92% of all)
  Email overlap matches:       0 pairs
  Phone overlap matches:       1 pair
  
The deterministic engine catches 1 of 116 possible duplicates (0.86% recall).
```

### Appendix B: Nickname Dictionary Coverage

The existing `NICKNAME_GROUPS` in `nlp.ts` contains **67 groups** covering:

- English (38 groups): Robert/Bob/Bobby, William/Bill, James/Jim, etc.
- Spanish (12 groups): Francisco/Paco, Eduardo/Lalo, Jesus/Chuy, etc.
- Indian (17 groups): Abhishek/Abhi, Siddharth/Sid, Priyanka/Priya, etc.

This dictionary is already production-quality and should be used in the deterministic pass, not deferred to AI.

### Appendix C: Why Not Just Use AI for Everything?

| Concern | Impact |
|---|---|
| **Cost** | Gemini API calls cost money. 1K contacts → 585K pairs → 11,700 batch calls → significant cost |
| **Latency** | Each batch takes 2–5 seconds. 11,700 batches = 6.5–16 hours |
| **Rate limits** | Gemini has per-minute token/request limits. Large scans hit throttling |
| **Reliability** | AI can hallucinate, give inconsistent results across runs, or fail |
| **Unnecessary** | 90%+ of matches are deterministic. AI should handle the remaining 10% |
| **Privacy** | Sending all contact data to an external API has privacy implications |

The funnel architecture embodies a key principle: **use the cheapest, fastest, most reliable tool for each tier of matching, and only escalate to AI for genuinely ambiguous cases.**

### Appendix D: Double Metaphone for Name Blocking

Double Metaphone generates phonetic codes that group similarly-sounding names:

| Name | Primary Code | Alternate Code |
|---|---|---|
| Robert | RPRT | — |
| Robbert | RPRT | — |
| Rupert | RPRT | — |
| Schmidt | XMT | SMT |
| Smith | SM0 | XMT |
| Smythe | SM0 | XMT |
| Johnson | JNSN | ANSN |
| Jonson | JNSN | ANSN |
| Johnston | JNST | ANST |

Implementation options:
- Use the `natural` npm package (`natural.DoubleMetaphone`) — battle-tested, 0 dependencies
- Alternatively, implement a 200-line TypeScript function for zero-dependency builds

### Appendix E: Confidence Tier Summary

```
┌─────────────────────────────────────────────────────────────────┐
│  CONFIDENCE TIERS                                                │
│                                                                   │
│  0.98+ ───── Email overlap         ─── AUTO-MERGE ──────────── │
│  0.95  ───── Phone overlap         ─── AUTO-MERGE ──────────── │
│  0.93  ───── Social URL match      ─── AUTO-MERGE ──────────── │
│  0.92  ───── Exact name + cross-src─── AUTO-MERGE ──────────── │
│  0.90  ───── Exact name match      ─── AUTO-MERGE ──────────── │
│  ─────────── AUTO-MERGE THRESHOLD (0.93) ─────────────────────── │
│  0.88  ───── Nickname + last name  ─── REVIEW QUEUE ─────────── │
│  0.85  ───── Initial match (J. → James) ── REVIEW QUEUE ─────── │
│  0.80  ───── High fuzzy + company  ─── REVIEW QUEUE ─────────── │
│  0.70  ───── High fuzzy name only  ─── REVIEW QUEUE ─────────── │
│  0.60  ───── AI confirmed match    ─── REVIEW QUEUE ─────────── │
│  ─────────── REVIEW THRESHOLD (0.60) ─────────────────────────── │
│  < 0.60 ──── Not suggested                                      │
└─────────────────────────────────────────────────────────────────┘
```
