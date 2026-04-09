# Dedupe Engine V2 — Cluster-Based Deduplication

> **Author:** Senior Principal Engineering Analysis  
> **Date:** April 8, 2026  
> **Scope:** Full implementation plan for migrating Contrack CRM from pairwise to cluster-based contact deduplication.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)  
2. [Architecture Overview](#2-architecture-overview)  
3. [Phase 1 — Backend: Union-Find Cluster Engine](#3-phase-1--backend-union-find-cluster-engine)  
4. [Phase 2 — Type System & Data Pipeline](#4-phase-2--type-system--data-pipeline)  
5. [Phase 3 — Frontend: Cluster-Based UI](#5-phase-3--frontend-cluster-based-ui)  
6. [Phase 4 — Polish, Edge Cases & Safety](#6-phase-4--polish-edge-cases--safety)  
7. [Appendix A: Current Architecture Reference](#7-appendix-a-current-architecture-reference)  
8. [Appendix B: File Index](#8-appendix-b-file-index)

---

## 1. Executive Summary

### The Problem

When a user imports contacts from Google, LinkedIn, Facebook, Apple Contacts, and also manually creates entries, the same real-world person can appear as up to 5 separate contacts. The current pairwise dedupe engine produces **C(5,2) = 10 individual suggestions** for this one person. This causes:

- **Review fatigue** — 10 swipe decisions for 1 conceptual merge
- **Stale-state bugs** — Merging pair (A,B) leaves dangling references to deleted contact B in pairs (B,C), (B,D), etc.
- **Wrong mental model** — Users think in people, not pairs

### The Solution

Replace the pairwise suggestion output with **cluster-based grouping**. The detection layer (deterministic email/phone matching + AI fuzzy name analysis) stays unchanged. A new **Union-Find clustering layer** groups transitively-connected pairs into clusters of N contacts. The UI presents one card per real-world person, with a single "Merge All" action.

### What Stays Unchanged

- `runDeterministicPass()` — exact email/phone overlap detection
- `runAIPass()` — fuzzy name similarity + Gemini batch evaluation
- `nlp.ts` — Jaro-Winkler, nickname dictionary, initial expansion, phone normalization
- `mergeContacts()` — transactional sequential merge with child-record deduplication
- `dedupeJobQueue.ts` — SSE-based async progress streaming pattern
- `server/routes/dedupe.ts` — route structure (endpoints stay the same, payload shape changes)
- Manual Merge tab — already supports N-way merge

---

## 2. Architecture Overview

### Before → After

```
CURRENT (Pairwise):
  Detect Pairs → Flat list of DedupeSuggestion[] → Swipe pair-by-pair

PROPOSED (Cluster-Based):
  Detect Pairs → Union-Find grouping → DedupeCluster[] → Review cluster-by-cluster
```

### Data Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                         SCAN REQUEST                                │
│                     mode: both / deterministic / ai                 │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                ┌────────────▼─────────────┐
                │  Pass 1: Deterministic   │   ← UNCHANGED
                │  Exact email/phone JOIN  │
                │  Output: RawPair[]       │
                └────────────┬─────────────┘
                             │
                ┌────────────▼─────────────┐
                │  Pass 2: Fuzzy + AI      │   ← UNCHANGED
                │  Name similarity →       │
                │  Gemini batch eval       │
                │  Output: RawPair[]       │
                └────────────┬─────────────┘
                             │
                ┌────────────▼─────────────┐
                │  NEW — Phase: Clustering │   Phase 1 of this plan
                │  Union-Find over pairs   │
                │  Output: RawCluster[]    │
                └────────────┬─────────────┘
                             │
                ┌────────────▼─────────────┐
                │  NEW — Cluster Enrichment│   Phase 1 of this plan
                │  Auto-select primary     │
                │  Generate summary        │
                │  Compute aggregate conf  │
                │  Output: DedupeCluster[] │
                └────────────┬─────────────┘
                             │
                ┌────────────▼─────────────┐
                │  SSE → Frontend          │   Phase 2 of this plan
                │  DedupeScanProgress now  │
                │  has clusters field      │
                └────────────┬─────────────┘
                             │
                ┌────────────▼─────────────┐
                │  Cluster Review UI       │   Phase 3 of this plan
                │  Swipe card per cluster  │
                │  List view per cluster   │
                │  Merge All action        │
                └──────────────────────────┘
```

---

## 3. Phase 1 — Backend: Union-Find Cluster Engine

> **Goal:** Add the clustering layer to `dedupeService.ts` so that `runScan()` outputs `DedupeCluster[]` instead of `DedupeSuggestion[]`.

### 3.1. Create Union-Find Utility

**File:** `server/utils/unionFind.ts` **(NEW)**

Create a standalone, reusable Union-Find (Disjoint Set Union) class with path compression and union-by-rank.

```typescript
// Data structure that groups elements into disjoint sets.
// Used by the dedupe engine to cluster transitively-connected contacts.
//
// Example: if pair (A,B) and pair (B,C) are detected,
// Union-Find groups them into a single cluster {A, B, C}.

class UnionFind {
  private parent: Map<string, string>;
  private rank: Map<string, number>;

  find(x): string       // with path compression
  union(a, b): void     // with union-by-rank
  connected(a, b): bool // are a and b in the same set?
  getClusters(): Map<string, string[]>  // root → member IDs
}
```

**Implementation details:**
- `find(x)` — If `x` hasn't been seen, initialize it as its own parent. Walk up the parent chain with path compression (set each node's parent directly to the root).
- `union(a, b)` — Find roots of both, merge by rank. The smaller-rank tree becomes a child of the larger.
- `getClusters()` — Iterate all known elements, group by `find()` result. Return only clusters with 2+ members (singletons are not duplicates).

**Why a separate file:** This is a general-purpose data structure. Keeping it out of `dedupeService.ts` follows the project's existing pattern of utility modules (`nlp.ts`, `logger.ts`, `validators.ts`).

### 3.2. Internal Pair Type

Currently, each detection pass directly builds fully-hydrated `DedupeSuggestion` objects (with full `Contact` objects embedded in `contactA`/`contactB`). For the clustering pipeline, we need a lighter intermediate representation.

**Add to `dedupeService.ts` (internal, not exported):**

```typescript
/** Internal pair output from detection passes — lightweight, pre-hydration. */
interface RawPair {
  idA: string;           // contact ID
  idB: string;           // contact ID
  matchType: 'email' | 'phone' | 'ai';
  confidence: number;
  reasoning: string;
  matchedField?: string;
}
```

**Changes to `runDeterministicPass`:**
- Currently pushes objects with `contactA: contactRepo.hydrate(...)` and `contactB: contactRepo.hydrate(...)`.
- Refactor to push `RawPair` objects instead (just `idA: m.id1, idB: m.id2`). Hydration moves to the cluster-enrichment step, avoiding redundant hydration of the same contact across multiple pairs.
- The function signature changes from `function runDeterministicPass(ctx): any[]` to `function runDeterministicPass(ctx): RawPair[]`.

**Changes to `runAIPass`:**
- Same refactoring. Push `RawPair` objects instead of hydrated suggestions.
- The fuzzy candidate building loop and AI batch evaluation stay identical. Only the final `.push()` changes from a hydrated suggestion to a `RawPair`.

**Why this matters:** When 5 contacts form 10 pairs, the current code hydrates each contact up to 4 times (once per pair it appears in). With `RawPair`, each contact is hydrated exactly once during cluster enrichment.

### 3.3. Cluster Builder Function

**Add to `dedupeService.ts`:**

```typescript
function buildClusters(
  pairs: RawPair[],
  contactMap: Map<string, any>,
  rid: string,
): DedupeCluster[] {
  // 1. Build union-find from all pairs
  // 2. Get clusters (groups of contact IDs)
  // 3. For each cluster with 2+ members:
  //    a. Hydrate all member contacts (contactRepo.hydrate)
  //    b. Collect all pairs that belong to this cluster
  //    c. Auto-select the best primary via scoring heuristic
  //    d. Generate a human-readable summary
  //    e. Compute aggregate confidence (max pairwise confidence)
  // 4. Sort clusters by aggregate confidence descending
  // 5. Return DedupeCluster[]
}
```

**Cluster summary generation logic:**
- If any pair has `matchType === 'email'`: `"These contacts share the email address {email}"`
- If any pair has `matchType === 'phone'`: `"These contacts share the phone number {phone}"`
- If all pairs are AI: `"AI detected similar names: {list unique names}"`
- For mixed clusters: combine the above into a sentence like `"Shared email (x@y.com) and similar names (Bobby ↔ Robert)"`

### 3.4. Primary Auto-Selection Heuristic

**Add to `dedupeService.ts`:**

```typescript
/** Score a contact for primary-candidate fitness. Higher = better keeper. */
function computePrimaryScore(contact: any): number {
  let score = 0;

  // Data richness — prefer the most complete record
  if (contact.avatarUrl) score += 10;
  if (contact.about) score += 5;
  if (contact.role) score += 3;
  if (contact.company) score += 3;
  if (contact.location) score += 2;
  if (contact.industry) score += 2;
  if (contact.website) score += 2;

  // Child record counts
  const emails = sqlite.prepare("SELECT COUNT(*) as c FROM contact_emails WHERE contactId = ?").get(contact.id) as any;
  const phones = sqlite.prepare("SELECT COUNT(*) as c FROM contact_phones WHERE contactId = ?").get(contact.id) as any;
  const socials = sqlite.prepare("SELECT COUNT(*) as c FROM contact_social_links WHERE contactId = ?").get(contact.id) as any;
  const tags = sqlite.prepare("SELECT COUNT(*) as c FROM contact_tags WHERE contactId = ?").get(contact.id) as any;
  score += (emails?.c ?? 0) * 3;
  score += (phones?.c ?? 0) * 3;
  score += (socials?.c ?? 0) * 2;
  score += (tags?.c ?? 0) * 1;

  // Interaction history — prefer the contact the user has engaged with
  const interactions = sqlite.prepare("SELECT COUNT(*) as c FROM interactions WHERE contactId = ?").get(contact.id) as any;
  score += (interactions?.c ?? 0) * 5;

  // Recency — prefer recently updated records
  if (contact.updatedAt) {
    const ageMs = Date.now() - new Date(contact.updatedAt).getTime();
    if (ageMs < 30 * 24 * 60 * 60 * 1000) score += 5;
  }

  // AI enrichment — strongly prefer already-enriched records
  if (contact.aiHydratedAt) score += 8;

  return score;
}

function selectBestPrimary(contacts: any[]): any {
  return contacts.reduce((best, c) =>
    computePrimaryScore(c) > computePrimaryScore(best) ? c : best
  );
}
```

**Why these weights:**
- `avatarUrl (+10)` — The most visually distinctive attribute. A contact with a photo "feels" more real than a name-only stub.
- `interactionCount (+5 each)` — Directly measures the user's historical engagement. This contact has real relationship equity.
- `aiHydratedAt (+8)` — AI enrichment is expensive (Gemini API calls). Preserving it as primary avoids losing the hydration work.
- `emails/phones (+3 each)` — Core contact data. More = richer record.
- Scalar fields like `role`, `company` (+3) — Structural data that enriches the profile.

### 3.5. Modify `runScan()` to Use Clustering

**File:** `server/services/dedupeService.ts`

The `runScan()` method currently:
1. Collects all suggestions into `allSuggestions: any[]`
2. Sorts by confidence
3. Calls `dedupeQueue.complete(scanId, allSuggestions)`

**Change to:**
1. Collect all `RawPair[]` from both passes into `allPairs`
2. Add a new progress phase: `'clustering'` with phaseName `'Grouping duplicates into clusters…'`
3. Call `buildClusters(allPairs, ctx.contactMap, rid)`
4. Update progress with `clustersFound: clusters.length`
5. Call `dedupeQueue.complete(scanId, clusters)` (now passing `DedupeCluster[]` instead of `DedupeSuggestion[]`)

**New progress phase emission:**
```typescript
dedupeQueue.update(scanId, {
  phase: 'clustering',
  phaseName: 'Grouping duplicates into clusters…',
});

const clusters = buildClusters(allPairs, ctx.contactMap, rid);

dedupeQueue.update(scanId, {
  clustersFound: clusters.length,
  totalPairs: allPairs.length,
});
```

### 3.6. New API Endpoint: Merge Cluster

**File:** `server/routes/dedupe.ts`

Add a new route that merges an entire cluster in one request:

```
POST /api/contacts/merge-cluster
Body: { primaryId: string, duplicateIds: string[] }
```

**Implementation:**
- Validate that `primaryId` is not in `duplicateIds`, all IDs are non-empty, and `duplicateIds.length >= 1`.
- Cap `duplicateIds.length` at 10 (safety guard against unreasonably large clusters).
- Sequentially call `dedupeService.mergeContacts(primaryId, dupId, rid)` for each duplicate ID.
- If any individual merge fails (e.g., contact already deleted), log the error, skip it, and continue with the remaining.
- Return: `{ success: true, merged: number, failed: number, contact: HydratedContact }`.

**Why a new endpoint instead of reusing `merge-batch`:**
- `merge-batch` takes an array of `{ primaryId, duplicateId }` pairs — each pair can have a *different* primary. It's designed for bulk-approving independent pairwise suggestions.
- `merge-cluster` takes a single `primaryId` and an array of `duplicateIds` — everything merges *into one contact*. This is semantically cleaner and avoids the client having to construct the merge pairs array from the cluster data.
- `merge-batch` continues to exist for backwards compatibility and the list-view bulk action.

### 3.7. Update `merge-batch` for Cluster Compatibility

The existing `POST /api/contacts/merge-batch` endpoint should still work, but we should also add a new `POST /api/contacts/merge-clusters` endpoint for bulk-merging multiple clusters in one call:

```
POST /api/contacts/merge-clusters
Body: { clusters: { primaryId: string, duplicateIds: string[] }[] }
```

**Implementation:**
- For each cluster in the array, run the sequential merge logic from 3.6.
- Return per-cluster results: `{ results: { primaryId, merged, failed }[], totalMerged, totalFailed }`.
- Cap total operations at 50 (same as existing `merge-batch` cap).

This powers the list-view "Select All → Merge Selected" workflow with clusters.

---

## 4. Phase 2 — Type System & Data Pipeline

> **Goal:** Update all TypeScript types, the job queue, the SSE stream, the React Query hooks, and the DedupeContext to carry `DedupeCluster[]` instead of `DedupeSuggestion[]`.

### 4.1. New Types

**File:** `src/types.ts`

Add new types alongside the existing ones (do not remove `DedupeSuggestion` yet — it may still be used in legacy test code or the Manual Merge flow):

```typescript
// ─── Cluster-Based Dedupe Types ─────────────────────────────────────

/** A single piece of evidence connecting two contacts within a cluster. */
export interface ClusterPair {
  contactIdA: string;
  contactIdB: string;
  matchType: 'email' | 'phone' | 'ai';
  confidence: number;
  reasoning: string;
  matchedField?: string;
}

/** A group of contacts that the engine believes represent the same person. */
export interface DedupeCluster {
  id: string;                     // Unique cluster ID (UUID)
  contacts: Contact[];            // All contacts in this cluster (2+)
  suggestedPrimaryId: string;     // Auto-selected best candidate
  pairs: ClusterPair[];           // The individual pair evidence
  aggregateConfidence: number;    // Highest pairwise confidence
  summary: string;                // Human-readable description
  size: number;                   // contacts.length (convenience)
}
```

**Update `DedupeScanPhase`:**
```typescript
// Add 'clustering' to the union:
export type DedupeScanPhase = 'starting' | 'deterministic' | 'ai' | 'clustering' | 'complete' | 'error';
```

**Update `DedupeScanProgress`:**
```typescript
export interface DedupeScanProgress {
  scanId: string;
  mode: DedupeScanMode;
  phase: DedupeScanPhase;
  phaseName: string;
  contactsScanned: number;
  totalContacts: number;
  deterministicFound: number;
  aiCandidatesFound: number;
  aiEvaluated: number;
  // NEW: cluster-based output
  clustersFound: number;          // Number of clusters generated
  totalPairs: number;             // Total raw pairs before clustering
  clusters: DedupeCluster[];      // Final clusters (populated on 'complete')
  // DEPRECATED: kept for type compat, will be empty
  suggestions: DedupeSuggestion[];
  error?: string;
  startedAt: string;
  completedAt?: string;
}
```

### 4.2. Update Job Queue

**File:** `server/services/dedupeJobQueue.ts`

**Changes to `DedupeScanProgress` (server-side mirror of the frontend type):**
- Add `clustersFound: number` field (default `0`)
- Add `totalPairs: number` field (default `0`)
- Add `clusters: any[]` field (default `[]`)
- The `suggestions` field stays but will be set to `[]` — this ensures any old client code that reads `suggestions` doesn't crash; it just sees an empty array.

**Update `createScan()`:** Initialize the new fields:
```typescript
clustersFound: 0,
totalPairs: 0,
clusters: [],
```

**Update `complete()`:** The method currently takes `suggestions: any[]`. Change the parameter name to `clusters: any[]` and set both:
```typescript
scan.clusters = clusters;
scan.suggestions = []; // backward compat — always empty now
scan.clustersFound = clusters.length;
```

**Update `DedupeScanPhase` type:** Add `'clustering'` to the union. This is the server-side mirror of the `src/types.ts` change.

### 4.3. Update SSE Stream and Polling

**File:** `server/routes/dedupe.ts`

No changes needed — the routes are format-agnostic. They serialize whatever `DedupeScanProgress` object the queue holds. Since we're adding fields to the progress object (not changing the route structure), the SSE `data:` payloads automatically include the new fields.

The polling endpoint `GET /api/dedupe/status` similarly just calls `dedupeQueue.getScan(scanId)` and returns it.

### 4.4. Update React Query Hooks

**File:** `src/api/dedupe.ts`

**`useStartDedupeScan`:** No change needed — it just POST's to `/dedupe/scan` and returns `{ scanId, mode }`.

**`useDedupeStream`:** No change needed — it already deserializes the SSE `data` into a `DedupeScanProgress` object. Since the TypeScript type now includes `clusters`, the hook's callers can immediately access `scan.clusters`.

**Add new hook `useMergeCluster`:**
```typescript
export const useMergeCluster = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ primaryId, duplicateIds }: { primaryId: string; duplicateIds: string[] }) => {
      const res = await fetch(`${API_BASE}/contacts/merge-cluster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryId, duplicateIds }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Cluster merge failed');
      }
      return res.json() as Promise<{
        success: boolean;
        merged: number;
        failed: number;
        contact: any;
      }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
};
```

**Add new hook `useMergeClusters` (bulk):**
```typescript
export const useMergeClusters = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (clusters: { primaryId: string; duplicateIds: string[] }[]) => {
      const res = await fetch(`${API_BASE}/contacts/merge-clusters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusters }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Bulk cluster merge failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
};
```

**Update barrel export:** Add the new hooks to `src/api/index.ts` (they're already auto-exported via `export * from './dedupe'`).

### 4.5. Update DedupeContext

**File:** `src/contexts/DedupeContext.tsx`

**Rename state:**
- `suggestions` → `clusters`
- `removeSuggestion` → `removeCluster`

**Update interface:**
```typescript
interface DedupeContextValue {
  startScan: (mode: DedupeScanMode) => void;
  scan: DedupeScanProgress | null;
  clusters: DedupeCluster[];          // was: suggestions
  isScanning: boolean;
  isStarting: boolean;
  reset: () => void;
  removeCluster: (id: string) => void; // was: removeSuggestion
}
```

**Update `handleUpdate` callback:** Change from reading `updatedScan.suggestions` to `updatedScan.clusters`:
```typescript
const handleUpdate = useCallback((updatedScan: DedupeScanProgress) => {
  setScan(updatedScan);
  if (updatedScan.phase === 'complete' && updatedScan.clusters) {
    setClusters(updatedScan.clusters);
  }
}, []);
```

**Update `removeCluster`:**
```typescript
const removeCluster = useCallback((id: string) => {
  setClusters(prev => prev.filter(c => c.id !== id));
}, []);
```

---

## 5. Phase 3 — Frontend: Cluster-Based UI

> **Goal:** Redesign the auto-scan UI to present clusters instead of pairs. The Manual Merge tab stays unchanged. The swipe card evolves from 2-contact comparison to N-contact group review.

### 5.1. Update `DedupeView.tsx` — Main Orchestrator

**File:** `src/views/dedupe/DedupeView.tsx`

This is the largest UI file and the primary orchestrator. Key changes:

#### 5.1.1. State Renaming

Replace all occurrences:
- `suggestions` → `clusters` (from context)
- `removeSuggestion` → `removeCluster` (from context)
- `activeSuggestions` → `activeClusters`
- `currentSuggestion` → `currentCluster`
- `nextSuggestion` → `nextCluster`

#### 5.1.2. Merge Handler

Replace the current `handleMerge(primaryId, duplicateId)` which merges a single pair, with:

```typescript
const handleMerge = useCallback(async (primaryId: string, duplicateIds: string[]) => {
  if (!currentCluster || mergeCluster.isPending) return;
  try {
    const result = await mergeCluster.mutateAsync({ primaryId, duplicateIds });
    setMergedIds(prev => new Set(prev).add(currentCluster.id));
    removeCluster(currentCluster.id);
    toast.success(`Merged ${result.merged} contact${result.merged > 1 ? 's' : ''} successfully`);
    if (result.failed > 0) {
      toast.warning(`${result.failed} merge(s) were skipped`);
    }
  } catch (err: any) {
    toast.error(`Merge failed: ${err.message}`);
  }
}, [currentCluster, mergeCluster, removeCluster]);
```

Note: `mergeCluster` comes from the new `useMergeCluster()` hook.

#### 5.1.3. Keyboard Shortcuts

The current shortcuts are:
- `ArrowRight` / `l` → merge (calls `handleMerge(contactA.id, contactB.id)`)
- `ArrowLeft` / `h` → dismiss

Update the merge shortcut to use the cluster merge:
```typescript
case 'ArrowRight':
case 'l':
  if (currentCluster) {
    const primaryId = currentCluster.suggestedPrimaryId;
    const duplicateIds = currentCluster.contacts
      .filter(c => c.id !== primaryId)
      .map(c => c.id);
    handleMerge(primaryId, duplicateIds);
  }
  break;
```

#### 5.1.4. Progress Card Update

Add the new `'clustering'` phase to the phase pipeline visualization:

```tsx
{(scan.mode === 'both') && (
  <PhaseRow
    icon={<Layers className="w-3.5 h-3.5" />}
    label="Clustering"
    status={
      scan.phase === 'clustering' ? 'active' :
      scan.phase === 'complete' ? 'done' : 'pending'
    }
    detail={scan.clustersFound > 0 ? `${scan.clustersFound} groups` : undefined}
  />
)}
```

Update the "findings so far" stat to show clusters instead of raw pairs:
```tsx
{scan.clustersFound > 0 && (
  <span>
    <span className="font-bold">{scan.clustersFound}</span>
    {' '}duplicate group{scan.clustersFound !== 1 ? 's' : ''} found
    {' '}({scan.totalPairs} matching pairs)
  </span>
)}
```

#### 5.1.5. Counter and Progress Bar

Change counter from `"1 of 10"` (suggestions) to `"1 of 3"` (clusters):
```tsx
<span className="text-sm font-bold text-on-surface">
  {currentIndex + 1} of {totalActive}
  {currentCluster && currentCluster.size > 2 && (
    <span className="text-xs text-on-surface-variant ml-2">
      ({currentCluster.size} contacts in group)
    </span>
  )}
</span>
```

### 5.2. Replace `SwipeCard.tsx` → `ClusterSwipeCard.tsx`

**File:** `src/views/dedupe/components/ClusterSwipeCard.tsx` **(NEW)**

This replaces `SwipeCard.tsx` as the primary review card for auto-scan results.

#### 5.2.1. Props

```typescript
interface ClusterSwipeCardProps {
  cluster: DedupeCluster;
  onMerge: (primaryId: string, duplicateIds: string[]) => Promise<void>;
  onDismiss: () => void;
  isMerging: boolean;
  nextCluster?: DedupeCluster | null;
}
```

#### 5.2.2. Internal State

```typescript
const [primaryId, setPrimaryId] = useState(cluster.suggestedPrimaryId);
const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

// Derived
const activeContacts = cluster.contacts.filter(c => !removedIds.has(c.id));
const primary = activeContacts.find(c => c.id === primaryId) ?? activeContacts[0];
const duplicates = activeContacts.filter(c => c.id !== primaryId);
```

#### 5.2.3. Layout — Cluster Summary + Contact Strip

```
┌─────────────────────────────────────────────────────────────────────┐
│  ✨ Cluster Summary                                    96% match   │
│  "These 4 contacts share the email bob@gmail.com and have          │
│   similar names: Bobby Johnson, Robert Johnson, Bob Johnson."      │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Contact strip (horizontal scroll on mobile, grid on desktop) │ │
│  │                                                                │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │ │
│  │  │ ★ Primary   │  │  Duplicate  │  │  Duplicate  │  ...      │ │
│  │  │  Bobby J.   │  │  Robert J.  │  │  Bob J.     │           │ │
│  │  │  Apple      │  │  LinkedIn   │  │  Facebook   │           │ │
│  │  │  📱 📧 💼   │  │  📧 💼      │  │  (sparse)   │           │ │
│  │  │ [Primary ✓] │  │ [Set Prim.] │  │ [Set Prim.] │  [✕]     │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─── Evidence Panel (collapsible) ─────────────────────────────┐  │
│  │  📧 Email Match (98%): Both share bob.johnson@gmail.com      │  │
│  │  🧠 AI Match (85%): "Bobby" ↔ "Robert" — nickname variant   │  │
│  │  🧠 AI Match (80%): "Bob" ↔ "Robert" — nickname variant     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──── Actions ─────────────────────────────────────────────────┐  │
│  │  [← Keep Separate]              [Merge All into Primary →]  │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

#### 5.2.4. Contact Strip Subcomponent

Create a new `ClusterContactChip` subcomponent. Each chip in the strip shows:
- Avatar (using `fallbackAvatarUrl` for contacts without photos)
- Name (truncated)
- Source badge (from `contact.sources[0].platform` — e.g., "Apple", "LinkedIn", "Google")
- Data richness indicator (icons for which data fields are populated: 📧 📱 💼 📍)
- "Set as Primary" button (or "★ Primary" badge if currently selected)
- "✕ Remove" button (to pull a contact out of the cluster — handles false positives)

**Source badge logic:**
```typescript
const sourceLabel = contact.sources?.[0]?.platform
  ? contact.sources[0].platform.charAt(0).toUpperCase() + contact.sources[0].platform.slice(1)
  : 'Manual';
```

#### 5.2.5. "Remove from Cluster" Behavior

When the user clicks ✕ on a contact in the cluster:
- Add the contact ID to `removedIds` state
- If the removed contact was the primary, auto-select the next best primary from remaining contacts
- If only 1 contact remains after removal, auto-dismiss the cluster (can't merge 1 contact)
- Show a toast: `"Removed {name} from this group"` with an undo option

#### 5.2.6. Swipe Mechanics

Keep the existing Framer Motion drag mechanics from `SwipeCard.tsx`:
- `drag="x"` with elastic constraints
- `useMotionValue(x)` for tracking position
- `useTransform` for rotate/opacity on approval/rejection overlays
- `handleDragEnd` with offset + velocity thresholds

On swipe right (merge): call `onMerge(primaryId, duplicates.map(c => c.id))`.
On swipe left (dismiss): call `onDismiss()`.

### 5.3. Create Evidence Panel Component

**File:** `src/views/dedupe/components/shared/EvidencePanel.tsx` **(NEW)**

A collapsible panel showing the individual pairwise evidence within a cluster.

```typescript
interface EvidencePanelProps {
  pairs: ClusterPair[];
  contacts: Contact[];  // for name lookup
}
```

Each pair renders as a row:
```
📧 Email Match · 98%  —  Bobby Johnson ↔ Robert Johnson: shared bob@gmail.com
🧠 AI Match · 85%     —  Bobby Johnson ↔ Bob Johnson: "Bobby" ↔ "Bob" nickname
```

Use the existing `MatchBadge` component for the match type indicator. The contact names are resolved from the `contacts` array using the pair's `contactIdA`/`contactIdB`.

### 5.4. Update `SuggestionList.tsx` → `ClusterList.tsx`

**File:** Rename `src/views/dedupe/components/SuggestionList.tsx` → `ClusterList.tsx` **(RENAME + MODIFY)**

#### 5.4.1. Props

```typescript
interface ClusterListProps {
  clusters: DedupeCluster[];
  onRemoveCluster: (id: string) => void;
}
```

#### 5.4.2. Row Layout

Each cluster row shows:
```
☐  Bobby Johnson (4 contacts)   📧 phone + AI   96%   [Merge All]   ▼
```

- **Checkbox** — for bulk selection
- **Contact avatars** — stacked avatar group (up to 5, like GitHub collaborator avatars)
- **Primary name** — the suggested primary contact's name
- **Cluster size** — "(4 contacts)"
- **Match type badges** — one badge per unique match type in the cluster
- **Confidence** — aggregate confidence %
- **Merge button** — single-row "Merge All" action
- **Expand chevron** — expands to show the full cluster detail

#### 5.4.3. Expanded Detail

When a row is expanded, show:
1. **All contacts** in a horizontal grid (reusing `ContactCard` component — already supports `isPrimary` and `onSetPrimary` props)
2. **Evidence panel** (the new `EvidencePanel` component)
3. **Per-contact remove button** (✕ to remove from cluster)
4. **Merge Preview** (using existing `MergePreview` component which already takes `primary` + `duplicates: Contact[]`)

#### 5.4.4. Bulk Merge

The "Select All → Merge Selected" button calls the new `useMergeClusters` hook with:
```typescript
const mergePayload = clusters
  .filter(c => selected.has(c.id))
  .map(c => ({
    primaryId: c.suggestedPrimaryId,
    duplicateIds: c.contacts.filter(ct => ct.id !== c.suggestedPrimaryId).map(ct => ct.id),
  }));
```

### 5.5. Update Component Barrel Export

**File:** `src/views/dedupe/components/index.ts`

```typescript
export * from './ManualMerge';
export * from './ClusterSwipeCard';         // was: SwipeCard
export * from './MergePreview';
export * from './ContactPicker';
export * from './ClusterList';              // was: SuggestionList
export * from './shared/ContactCard';
export * from './shared/ContactMiniCard';
export * from './shared/EngineInfoCard';
export * from './shared/FieldRow';
export * from './shared/MatchBadge';
export * from './shared/EvidencePanel';     // NEW
```

**Note on old files:** `SwipeCard.tsx` and `SuggestionList.tsx` can either be deleted or kept alongside the new files during transition. If kept, stop exporting them from the barrel.

### 5.6. `MergePreview.tsx` — No Major Changes

This component already accepts `primary: Contact` and `duplicates: Contact[]`. It renders a merge preview showing:
- The merge diagram (all duplicates → primary)
- The merged scalar fields
- Combined emails, phones, tags
- Interaction count sum

This works perfectly for cluster-based merge. The only potential enhancement: if the cluster has 5+ contacts, the merge diagram's horizontal layout might need to wrap. Add `flex-wrap` to the diagram container (line 100: it already has `flex-wrap`).

### 5.7. `ManualMerge.tsx` — No Changes

The Manual Merge tab is already cluster-based:
- `SelectStage` — pick 2-3 contacts from a searchable list
- `CompareStage` — compare them side-by-side, pick primary
- `PreviewStage` — show merge preview
- Sequential merge: `for (const dup of duplicates) { mergeContacts.mutateAsync(...) }`

No changes needed. It continues to work independently of the auto-scan refactor.

However, one minor enhancement: increase `maxSelection` from 3 to 5 in `ContactPicker` and update the "3-Way Merge" warning in `CompareStage` to generalize:

```tsx
// CompareStage.tsx — change the 3-way warning to N-way:
{selected.length > 2 && (
  <div className="...">
    <AlertTriangle ... />
    <div>
      <div className="text-sm font-bold text-amber-600 mb-1">{selected.length}-Way Merge</div>
      <p className="text-xs text-on-surface-variant">
        {selected.length - 1} contacts will be merged sequentially into the primary.
        All data from every duplicate will be preserved and combined.
      </p>
    </div>
  </div>
)}
```

---

## 6. Phase 4 — Polish, Edge Cases & Safety

> **Goal:** Harden the system against edge cases, add UX polish, and ensure production readiness.

### 6.1. Large Cluster Warning

When a cluster has more than 5 contacts, it may contain false positives from transitive chaining. Add a visual warning:

**In `ClusterSwipeCard.tsx`:**
```tsx
{cluster.size > 5 && (
  <div className="flex items-start gap-3 p-3 bg-amber-500/8 rounded-xl">
    <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
    <div>
      <div className="text-sm font-bold text-amber-600">Large Group ({cluster.size} contacts)</div>
      <p className="text-xs text-on-surface-variant">
        This group is unusually large. Please verify all contacts are truly the same person.
        Use ✕ to remove any that don't belong.
      </p>
    </div>
  </div>
)}
```

### 6.2. Weak-Link Detection

After clustering, analyze each cluster's internal connectivity. If the minimum pairwise confidence within a cluster is below a threshold (e.g., 0.60), flag it:

**In `buildClusters()` — `dedupeService.ts`:**
```typescript
// For each cluster, find the weakest link
const minConfidence = Math.min(...clusterPairs.map(p => p.confidence));
const hasWeakLink = minConfidence < 0.60;
```

Add `hasWeakLink: boolean` and `minConfidence: number` to the `DedupeCluster` type. The UI can then show a subtle warning badge:
```tsx
{cluster.hasWeakLink && (
  <span className="text-[10px] bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full font-bold">
    Uncertain link · {Math.round(cluster.minConfidence * 100)}%
  </span>
)}
```

### 6.3. Post-Merge Re-Scan Prompt

After the user finishes reviewing all clusters, offer a re-scan:

```tsx
{totalActive === 0 && mergedIds.size > 0 && (
  <div className="text-xs text-on-surface-variant/60 mt-4 text-center">
    <p className="mb-2">
      Merging contacts may have created new matches.
    </p>
    <button
      onClick={handleNewScan}
      className="text-primary font-bold hover:underline"
    >
      Run another scan to check
    </button>
  </div>
)}
```

### 6.4. Stale Contact Guard in Merge

The merge endpoint should gracefully handle the case where a duplicate contact has already been deleted (by a prior merge in the same cluster or a concurrent operation):

**In `dedupeService.mergeContacts()`:**
```typescript
const primary = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(primaryId) as any;
const duplicate = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(duplicateId) as any;
if (!primary) throw new Error(`Primary contact ${primaryId} not found`);
if (!duplicate) {
  // Duplicate already merged/deleted — skip gracefully instead of throwing
  log.warn("DedupeService", `[${rid}] Duplicate ${duplicateId} already deleted, skipping merge`);
  return contactRepo.hydrate(primary);
}
```

**Currently** (line 326): `if (!duplicate) throw new Error(...)`. Change this to a warning log + early return. This prevents a partial cluster merge from failing because a duplicate in the cluster was already deleted by a previous merge step in the same batch.

### 6.5. Undo Cluster Dismiss

The current undo logic (`dismissHistory` in `DedupeView.tsx`) tracks dismissed suggestion IDs. Update to track dismissed cluster IDs — functionally identical, just a rename.

### 6.6. Cluster Persistence Across Navigation

The `DedupeContext` is mounted at the App root, so scan state persists across route changes. The `clusters` state replaces `suggestions` with the same lifecycle. No changes needed for persistence.

### 6.7. Scan Progress Phase Pipeline Update

The `PhaseRow` component in `DedupeView.tsx` needs to handle the new `'clustering'` phase. The ordering is:

```
deterministic → ai → clustering → complete
```

The `status` logic for each row:
```typescript
// Deterministic row
status={
  scan.phase === 'starting' ? 'pending' :
  scan.phase === 'deterministic' ? 'active' : 'done'
}

// AI row
status={
  ['starting', 'deterministic'].includes(scan.phase) ? 'pending' :
  scan.phase === 'ai' ? 'active' : 'done'
}

// Clustering row (NEW)
status={
  ['starting', 'deterministic', 'ai'].includes(scan.phase) ? 'pending' :
  scan.phase === 'clustering' ? 'active' : 'done'
}
```

### 6.8. Accessibility

- All cluster card actions must be keyboard-accessible
- The "Remove from cluster" button needs `aria-label="Remove {contact.name} from this group"`
- The "Set as Primary" button needs `aria-label="Set {contact.name} as the primary contact"`
- Focus management: after a merge or dismiss, focus should move to the next cluster card

### 6.9. Mobile Responsiveness

The cluster card's contact strip should:
- On **desktop** (lg+): display as a horizontal grid (`grid-cols-2` for 2 contacts, `grid-cols-3` for 3, `grid-cols-4` for 4, `grid-cols-5` for 5+)
- On **mobile**: display as a vertical stack with compact cards, or a horizontal scroll container with snap points

The swipe gesture already works on mobile. The cluster card just needs to ensure the contact strip doesn't overflow the viewport.

### 6.10. Test Seed Update

**File:** `server/services/dedupeService.ts` — `seedDuplicates()` method

Update the dev-only seed utility to create a 4-contact cluster instead of a single pair, to properly test the clustering logic:

```typescript
seedDuplicates() {
  // Create 4 contacts representing the same person from different sources
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];

  const insertContact = sqlite.prepare("INSERT INTO contacts (id, name, company, role, themeColor) VALUES (?, ?, ?, ?, ?)");
  const insertEmail = sqlite.prepare("INSERT INTO contact_emails (id, contactId, email, isPrimary) VALUES (?, ?, ?, 1)");
  const insertPhone = sqlite.prepare("INSERT INTO contact_phones (id, contactId, phone, isPrimary) VALUES (?, ?, ?, 1)");
  const insertSource = sqlite.prepare("INSERT INTO contact_sources (id, contactId, platform) VALUES (?, ?, ?)");

  // Contact 1: Apple Contacts
  insertContact.run(ids[0], "Bobby Johnson", "Acme Corp", "VP Sales", "brand");
  insertPhone.run(crypto.randomUUID(), ids[0], "(555) 867-5309");
  insertSource.run(crypto.randomUUID(), ids[0], "apple");

  // Contact 2: Google Contacts (shared email links to Contact 1)
  insertContact.run(ids[1], "Robert A. Johnson", "Acme Corp", "Vice President of Sales", "indigo");
  insertEmail.run(crypto.randomUUID(), ids[1], "bob.johnson@gmail.com");
  insertSource.run(crypto.randomUUID(), ids[1], "google");

  // Contact 3: LinkedIn (name similarity links to Contact 2)
  insertContact.run(ids[2], "Robert Johnson", "Acme Corporation", "VP Sales", "violet");
  insertEmail.run(crypto.randomUUID(), ids[2], "bob.johnson@gmail.com"); // shared email with #2
  insertSource.run(crypto.randomUUID(), ids[2], "linkedin");

  // Contact 4: Manual entry (initial name)
  insertContact.run(ids[3], "R. Johnson", null, null, "teal");
  insertPhone.run(crypto.randomUUID(), ids[3], "555-867-5309"); // shared phone with #1
  insertSource.run(crypto.randomUUID(), ids[3], "manual");
}
```

This creates a 4-contact cluster linked by:
- Contacts 2 ↔ 3: shared email `bob.johnson@gmail.com` (deterministic)
- Contacts 1 ↔ 4: shared phone `5558675309` (deterministic, after normalization)
- Contacts 1 ↔ 2: AI name match ("Bobby" ↔ "Robert A." + same company)
- Contacts 3 ↔ 4: AI name match ("Robert Johnson" ↔ "R. Johnson")

Union-Find should group all 4 into a single cluster.

---

## 7. Appendix A: Current Architecture Reference

### Detection Pipeline (UNCHANGED)

| Pass | Method | Signal | Output |
|------|--------|--------|--------|
| Deterministic | `runDeterministicPass()` | Exact email overlap via SQL JOIN on `LOWER(TRIM(email))` | Pairs with confidence 0.98 |
| Deterministic | `runDeterministicPass()` | Exact phone overlap via normalized phone map (last 10 digits) | Pairs with confidence 0.95 |
| Fuzzy + AI | `runAIPass()` | `nameSimilarity()` ≥ 0.70 or (≥ 0.45 + same company) → Gemini batch eval | AI-confirmed pairs with confidence ≥ 0.60 |
| Fuzzy fallback | `runAIPass()` | If Gemini unavailable: `nameSimilarity()` ≥ 0.80 → heuristic confidence | Heuristic pairs |

### NLP Engine (UNCHANGED)

- `nameSimilarity(a, b)` → 0..1 — multi-signal: token-level Jaro-Winkler + nickname dictionary + initial expansion
- `normalizePhone(phone)` → last 10 digits
- `NICKNAME_GROUPS` — 200+ entries covering Western, Latin American, and South Asian names
- `tokenizeName(name)` — lowercase, strip titles/suffixes, remove punctuation

### Merge Engine (UNCHANGED)

Transactional merge that:
1. Moves all `interactions` from duplicate to primary
2. Moves `interaction_mentions` (avoiding duplicates)
3. Moves child records with dedup: `emails`, `phones`, `social_links`, `education`, `experience`, `sources`, `tags`, `interests`, `attributes`, `addresses`
4. Fills forward scalar fields (primary wins, duplicate fills empty)
5. Transfers `list_members` (INSERT OR IGNORE)
6. Preserves earliest `addedAt`
7. Deletes the duplicate contact

---

## 8. Appendix B: File Index

### Files Created (NEW)

| File | Phase | Purpose |
|------|-------|---------|
| `server/utils/unionFind.ts` | 1 | Union-Find data structure |
| `src/views/dedupe/components/ClusterSwipeCard.tsx` | 3 | Cluster review swipe card |
| `src/views/dedupe/components/ClusterList.tsx` | 3 | Cluster list view |
| `src/views/dedupe/components/shared/EvidencePanel.tsx` | 3 | Pairwise evidence display |

### Files Modified

| File | Phase | Changes |
|------|-------|---------|
| `server/services/dedupeService.ts` | 1 | Add `RawPair` type, refactor passes to output `RawPair[]`, add `buildClusters()`, `computePrimaryScore()`, `selectBestPrimary()`, update `runScan()` to produce clusters, update `seedDuplicates()` |
| `server/services/dedupeJobQueue.ts` | 2 | Add `clusters`, `clustersFound`, `totalPairs` fields to progress type; add `'clustering'` phase; update `createScan()` defaults and `complete()` signature |
| `server/routes/dedupe.ts` | 1 | Add `POST /contacts/merge-cluster` and `POST /contacts/merge-clusters` endpoints |
| `src/types.ts` | 2 | Add `DedupeCluster`, `ClusterPair` types; update `DedupeScanPhase` and `DedupeScanProgress` |
| `src/api/dedupe.ts` | 2 | Add `useMergeCluster()` and `useMergeClusters()` hooks |
| `src/contexts/DedupeContext.tsx` | 2 | Rename `suggestions` → `clusters`, `removeSuggestion` → `removeCluster`, read `scan.clusters` |
| `src/views/dedupe/DedupeView.tsx` | 3 | Replace `SwipeCard` with `ClusterSwipeCard`, replace `SuggestionList` with `ClusterList`, update merge handler, update progress card, update keyboard shortcuts |
| `src/views/dedupe/components/index.ts` | 3 | Update barrel exports |
| `src/views/dedupe/components/manual/CompareStage.tsx` | 3 | Generalize N-way merge warning |
| `src/views/dedupe/components/ContactPicker.tsx` | 3 | Increase `maxSelection` from 3 to 5 |

### Files Deprecated / Deletable

| File | Notes |
|------|-------|
| `src/views/dedupe/components/SwipeCard.tsx` | Replaced by `ClusterSwipeCard.tsx` |
| `src/views/dedupe/components/SuggestionList.tsx` | Replaced by `ClusterList.tsx` |

### Files Unchanged

| File | Reason |
|------|--------|
| `server/utils/nlp.ts` | Detection primitives are unchanged |
| `server/routes/dedupe.ts` (existing routes) | SSE/polling is format-agnostic |
| `src/views/dedupe/components/MergePreview.tsx` | Already supports N contacts |
| `src/views/dedupe/components/ManualMerge.tsx` | Already cluster-based |
| `src/views/dedupe/components/manual/SelectStage.tsx` | Works as-is |
| `src/views/dedupe/components/manual/PreviewStage.tsx` | Works as-is |
| `src/views/dedupe/components/manual/SuccessStage.tsx` | Works as-is |
| `src/views/dedupe/components/shared/ContactCard.tsx` | Reused in cluster detail |
| `src/views/dedupe/components/shared/ContactMiniCard.tsx` | Used by ContactPicker |
| `src/views/dedupe/components/shared/FieldRow.tsx` | Used by ContactCard |
| `src/views/dedupe/components/shared/MatchBadge.tsx` | Used by EvidencePanel |
| `src/views/dedupe/components/shared/EngineInfoCard.tsx` | Used by pre-scan view |
| `src/views/dedupe/components/ContactPicker.tsx` | Used by Manual Merge (minor tweak only) |
