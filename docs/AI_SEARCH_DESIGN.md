# AI Search — Comprehensive Design & Implementation Specification

> **Version:** 4.0 — Expert AI/LLM Review (API Compatibility + Resilience Pass)  
> **Status:** Design Phase — Revised & Approved  
> **Last Updated:** April 7, 2026

---

## 1. Problem Statement

Contrack CRM stores contacts imported from LinkedIn, Google Contacts, vCards, and manual entry. These imports typically contain **sparse, incomplete data** — a name, a company, maybe an email. Users must manually research each contact to fill education, experience, social profiles, interests, and biographical context.

**AI Search** automates this: given existing knowledge about a contact, ask an LLM with **Gemini Search Grounding** (live internet access) to find and return structured, schema-compliant data that hydrates the contact record automatically.

### Design Goals

| Goal | Metric |
|---|---|
| **Zero data loss** | Never overwrite user-entered data |
| **Transparent cost** | Always confirm before spending AI credits |
| **Non-blocking UX** | Search runs async; user can navigate freely |
| **Error resilience** | One contact failing never blocks others |
| **Extensible engine** | Strategy pattern for future multi-model/judge flows |

---

## 2. Feature Requirements Matrix

| # | Requirement | Implementation |
|---|---|---|
| 1 | Select contacts (non-archived) + select all | Extended `ContactPicker` with unlimited selection + select-all toggle |
| 2 | See who was previously AI-searched | Sparkle badge when `contact.aiHydratedAt` is non-null |
| 3 | Search N contacts with credit warning | Confirm modal: "This will use N AI credits" |
| 4 | Async progress overlay (Google Drive-style) | `position:fixed` bottom-right panel with per-job status |
| 5 | Prompt from template using known data | `promptTemplate.ts` serializes contact → grounded search prompt |
| 6 | Schema-compliant structured output | JSON schema matching `contactUpdateSchema` + child records |
| 7 | Isolated, extensible engine code | `AISearchStrategy` interface, `TwoPassStrategy` for v1 |
| 8 | Per-contact error tracking | Red `AlertCircle` icon on failed contacts in picker |

---

## 3. Philosophy & First Principles

### 3.1 — "Research, Don't Fabricate"
The LLM must use **search grounding** to verify facts via live internet search. The prompt explicitly instructs: return `null` for any field that cannot be verified. Never hallucinate.

### 3.2 — "Additive, Not Destructive"  
AI Search **merges** new data — it never overwrites existing user data. Strategy:
- **Scalar fields** (headline, about, industry): only fill if currently `null`/empty
- **Array fields** (emails, experience, education): append new entries, skip exact duplicates
- **Tags/interests**: upsert with `ON CONFLICT DO NOTHING`

### 3.3 — "Extensible by Design"
V1 is a single LLM pass. The architecture must cleanly support future strategies:
- **ConsensusStrategy**: Same prompt against 2-3 models, take intersection
- **JudgeStrategy**: Researcher model + validator model
- **SourceStrategy**: Pre-fetch from APIs (LinkedIn, Crunchbase) before LLM pass

### 3.4 — "Transparent Resource Cost"
Every invocation costs tokens. The UI always shows a confirmation, clear progress, and per-contact outcomes.

---

## 4. Architecture Overview

```
┌─────────────────────── FRONTEND ────────────────────────┐
│                                                          │
│  Settings Page ──▶ AISearchView ──▶ ContactPicker       │
│                         │              (unlimited sel)   │
│                         │                                │
│                    ConfirmModal ──▶ POST /api/ai-search  │
│                         │                                │
│                  ProgressOverlay ◀── SSE /ai-search/stream│
│                  (fixed bottom-right, portal at root)    │
│                  (GET /status poll as SSE fallback)      │
│                                                          │
├─────────────────────── SERVER ──────────────────────────┤
│                                                          │
│  routes/aiSearch.ts                                      │
│       │                                                  │
│       ▼                                                  │
│  services/aiSearch/                                      │
│  ├── index.ts          ← Public facade                   │
│  ├── jobQueue.ts       ← In-memory + EventEmitter        │
│  ├── promptTemplate.ts ← Contact → research prompt       │
│  ├── mergeEngine.ts    ← Zod-validated, additive merge   │
│  └── strategies/                                         │
│      ├── index.ts      ← Strategy registry               │
│      └── twoPass.ts   ← V1: Two-pass Gemini execution    │
│              │                                           │
│         [Pass 1] googleSearch tool → raw grounded text   │
│              │  (no responseSchema — API incompatible)   │
│              ▼                                           │
│         [Pass 2] responseSchema → structured JSON        │
│              │  (grounding disabled — schema enforced)   │
│              ▼                                           │
│      validateSearchResult() [Zod strict schema]          │
│              │                                           │
│      mergeEngine.mergeSearchResult()                     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 5. Data Model

### 5.1 — Existing Schema (No Migration)

The `contacts` table already has `aiHydratedAt TEXT` — set on successful AI Search. This is our "previously searched" indicator.

### 5.2 — In-Memory Job Tracking

Jobs are ephemeral — lost on server restart. This is acceptable because AI Search is a discrete action, not persistent state.

```typescript
// server/services/aiSearch/types.ts

/** Status lifecycle: queued → searching → merging → success | error */
type AISearchJobStatus = 'queued' | 'searching' | 'merging' | 'success' | 'error';

interface AISearchJob {
  id: string;                    // UUID
  contactId: string;             // FK → contacts.id
  contactName: string;           // Denormalized for UI
  status: AISearchJobStatus;
  error?: string;                // Set on status === 'error'
  fieldsUpdated: number;         // Count of fields/records merged
  startedAt?: string;            // ISO timestamp
  completedAt?: string;          // ISO timestamp
  latencyMs?: number;            // Wall-clock time for this job
}

interface AISearchBatch {
  id: string;                    // Batch UUID
  strategy: string;              // e.g., 'single-pass'
  jobs: AISearchJob[];           // Ordered list
  createdAt: string;             // ISO timestamp
  status: 'processing' | 'complete' | 'cancelled';
  // 'cancelled' covers edge cases: server restart mid-batch, or future
  // user-initiated cancel. Not used in V1 but prevents type changes later.
}

/** Result from a strategy execution for one contact */
interface AISearchResult {
  /** Partial update payload keyed by contact field/child table */
  data: Record<string, unknown>;
  /** All model IDs used (two-pass = [groundingModel, extractionModel]) */
  models: string[];
  /** Sum of token counts across all passes */
  tokenCount?: number;
  /** Wall-clock total across all passes */
  latencyMs: number;
  /** Grounding citations from Pass 1 groundingMetadata — for provenance */
  citations?: Array<{ title: string; uri: string }>;
}
```

---

## 6. AI Search Engine — Server Implementation

### 6.1 — File: `server/services/aiSearch/strategies/twoPass.ts`

The V1 strategy uses a **two-pass Gemini execution** to work around a hard API constraint.

> **⚠️ Critical API Incompatibility**: The Gemini API does **not** allow using
> `responseSchema` (structured JSON output) and `tools: [{ googleSearch: {} }]`
> (grounding) in the same request. Combining them throws a `400 Invalid Argument`
> error. This is a confirmed limitation as of April 2026. The two-pass architecture
> below is the canonical workaround.

**Pass 1 — Grounding Pass** (web search, text output):
```typescript
// Pass 1: Google Search grounding, text output only
const pass1 = await this.client.models.generateContent({
  model: 'gemini-2.5-flash',   // ← Must support googleSearch tool
  contents: researchPrompt,
  config: {
    responseMimeType: 'text/plain',  // ← NO responseSchema here
    tools: [{ googleSearch: {} }],   // ← Grounding enabled
  },
});
const groundedText = pass1.text ?? '';
const citations = pass1.candidates?.[0]?.groundingMetadata?.groundingChunks
  ?.map((c: any) => ({ title: c.web?.title, uri: c.web?.uri }))
  .filter((c: any) => c.uri) ?? [];
```

**Pass 2 — Extraction Pass** (schema enforcement, no grounding):
```typescript
// Pass 2: Structured extraction from the grounded text
const extractionPrompt = `
  Below is research text about a specific professional contact.
  Extract the information into the JSON schema provided.
  Only extract fields explicitly mentioned in the text.
  Return null for any field not clearly stated.

  Research text:
  ---
  ${groundedText}
  ---
`;

const pass2 = await this.client.models.generateContent({
  model: 'gemini-2.5-flash-lite',   // Cheaper — pure formatting task
  contents: extractionPrompt,
  config: {
    responseMimeType: 'application/json',
    responseSchema: translatedContactSchema,  // ← Schema enforced here
    // No tools — grounding already done in Pass 1
  },
});
const structuredData = JSON.parse(pass2.text ?? '{}');
```

**Required change to `AIGenerateOptions`** in `server/ai/types.ts`:

> **Design decision**: The `AIGenerateOptions` interface is **provider-agnostic** by design.
> Rather than leaking the Gemini-specific `tools` shape into the shared interface, we add
> a semantic boolean flag. Each adapter translates it to its native mechanism.

```typescript
export interface AIGenerateOptions {
  prompt: string;
  jsonSchema?: JsonSchemaNode;
  responseFormat: 'json' | 'text';
  /** Enable live web search grounding. Adapter-specific implementation. */
  enableSearchGrounding?: boolean;  // NEW — provider-agnostic
}
```

**Required change to `GeminiAdapter.generate()`** in `server/ai/adapters/gemini.ts`:
```typescript
// When grounding is enabled, responseSchema MUST NOT be set (API incompatible).
// The TwoPassStrategy handles schema enforcement in its own separate Pass 2 call.
if (options.enableSearchGrounding) {
  config.tools = [{ googleSearch: {} }];
  config.responseMimeType = 'text/plain';
  delete config.responseSchema;
}
```

**Model lists** — the `TwoPassStrategy` maintains its own lists, separate from the shared
`FALLBACK_MODELS` chain (which contains outdated model IDs that need auditing):

```typescript
// ✅ FALLBACK_MODELS in server/ai/adapters/gemini.ts has been corrected to use
// only verified stable 2.5-family models (gemini-2.5-flash-lite, gemini-2.5-flash, gemini-2.5-pro).

// Pass 1: Must support googleSearch tool — verified stable models only
const GROUNDING_MODELS = [
  'gemini-2.5-flash',       // Verified grounding-capable; best price-performance
  'gemini-2.5-pro',         // Fallback: most capable, lower RPM
];

// Pass 2: Any schema-capable model (cheaper models are fine here)
const EXTRACTION_MODELS = [
  'gemini-2.5-flash-lite',  // Cheapest — pure formatting task
  'gemini-2.5-flash',       // Fallback
  'gemini-2.5-pro',         // Last resort
];
```

> **Note**: The `TwoPassStrategy` calls the GeminiAdapter directly with explicit model
> overrides — it does NOT go through the standard `aiService.ts` facade,
> which uses the general-purpose fallback chain.

### 6.2 — File: `server/services/aiSearch/promptTemplate.ts`

Builds a research prompt from the full `HydratedContact`. Key design decisions:

1. **Include everything known** — helps the LLM disambiguate common names (e.g., "David Kim at Netflix" vs "David Kim at Google")
2. **Explicit grounding instructions** — "You MUST use Google Search"
3. **Null-safety** — only include non-null fields to keep the prompt clean
4. **Token efficiency** — strip IDs and metadata, keep only semantic data

```typescript
export function buildSearchPrompt(contact: HydratedContact): string {
  const known: string[] = [];
  
  // Build a "known facts" block from non-null contact data
  known.push(`Full Name: ${contact.name}`);
  if (contact.firstName) known.push(`First Name: ${contact.firstName}`);
  if (contact.lastName) known.push(`Last Name: ${contact.lastName}`);
  if (contact.company) known.push(`Company: ${contact.company}`);
  if (contact.role) known.push(`Current Role: ${contact.role}`);
  if (contact.headline) known.push(`Headline: ${contact.headline}`);
  if (contact.location) known.push(`Location: ${contact.location}`);
  if (contact.industry) known.push(`Industry: ${contact.industry}`);
  if (contact.website) known.push(`Website: ${contact.website}`);
  if (contact.about) known.push(`Bio: ${contact.about}`);
  
  if (contact.emails?.length) {
    known.push(`Emails: ${contact.emails.map(e => e.email).join(', ')}`);
  }
  if (contact.socialLinks?.length) {
    known.push(`Social Profiles:\n${contact.socialLinks.map(s => 
      `  - ${s.platform}: ${s.url}`).join('\n')}`);
  }
  if (contact.experience?.length) {
    known.push(`Known Work History:\n${contact.experience.map(e =>
      `  - ${e.role || '?'} at ${e.company}${e.isCurrent ? ' (current)' : ''}`
    ).join('\n')}`);
  }
  if (contact.education?.length) {
    known.push(`Known Education:\n${contact.education.map(e =>
      `  - ${e.degree || 'Degree'} in ${e.fieldOfStudy || '?'} at ${e.school}`
    ).join('\n')}`);
  }

  // Build disambiguation search hints to anchor the model to the right person.
  // Common names (e.g. "David Kim") are ambiguous without company/role context.
  const searchHints: string[] = [];
  if (contact.name && contact.company) {
    searchHints.push(`  - "${contact.name} ${contact.company}"`);
  }
  if (contact.name && contact.role) {
    searchHints.push(`  - "${contact.name} ${contact.role}"`);
  }
  if (contact.name && contact.location) {
    searchHints.push(`  - "${contact.name} ${contact.location}"`);
  }
  const searchHintsBlock = searchHints.length > 0
    ? `\n## Suggested Search Queries\nStart with these targeted queries to identify the correct person:\n${searchHints.join('\n')}`
    : '';

  return `
You are a professional researcher. Your task is to find accurate, publicly 
available information about the person described below.

CRITICAL RULES:
1. You MUST use Google Search to verify every piece of information you return.
2. Do NOT guess, infer, or hallucinate. If you cannot find a verifiable 
   source for any field, return null for that field.
3. Cross-reference multiple sources when possible.
4. For social links, return ONLY verified URLs that actually exist.
5. For interests, only include publicly stated interests or hobbies.
6. Mark all interests as isAiGenerated: true.
7. For experience entries, set isCurrent: true only for current roles.
8. IDENTITY VALIDATION: You MUST confirm this is the correct person (matching
   name AND company/role/location) before returning any data. If you find
   multiple people with this name and cannot determine which is correct,
   return null for all ambiguous fields.
9. CONFIDENCE THRESHOLD: Only return data you are at least 80% confident 
   about. For uncertain fields, return null rather than a best guess.

## What We Already Know

${known.join('\n')}
${searchHintsBlock}

## What To Search For

Find any additional information about this person that we don't already have.
Focus on: professional background, education history, social media profiles,
public contact information, industry expertise, and notable achievements.

Return a JSON object with ONLY the new information you found. Do not repeat
information we already have. Return null for fields you cannot verify.
  `.trim();
}
```

### 6.3 — File: `server/services/aiSearch/mergeEngine.ts`

The merge engine applies AI Search results to the database. It is **strictly additive**.

> **Critical**: All mutations are wrapped in a single SQLite transaction to:
> 1. Ensure atomicity (partial merge never persists)
> 2. Batch FTS5 trigger fires within one commit (reduces WAL sync overhead; note that
>    child-table triggers still fire N times within the transaction — see FTS note below)
> 3. Guarantee `aiHydratedAt` is always stamped on success

```typescript
import { sqlite } from '../../db.ts';
import { contactRepo } from '../../repositories/contactRepository.ts';
import { invalidateSearchCache } from '../../utils/searchCache.ts';
import type { HydratedContact, ChildRecordsPayload } from '../../repositories/types.ts';

export function mergeSearchResult(
  contactId: string,
  existing: HydratedContact,
  searchResult: Record<string, unknown>,
): number {
  let fieldsUpdated = 0;
  const scalarUpdate: Record<string, unknown> = {};

  // 1. Scalar fields — only fill if currently null/empty
  const scalarFields = [
    'headline', 'about', 'industry', 'website', 
    'location', 'pronouns', 'birthday',
  ] as const;
  
  for (const field of scalarFields) {
    const newVal = searchResult[field];
    const existingVal = existing[field];
    if (newVal && !existingVal) {
      scalarUpdate[field] = newVal;
      fieldsUpdated++;
    }
  }

  // 2. Array fields — build child payload, filtering out duplicates
  const childData: ChildRecordsPayload = {};
  
  if (Array.isArray(searchResult.emails)) {
    const existingEmails = new Set(existing.emails.map(e => e.email.toLowerCase()));
    childData.emails = searchResult.emails.filter(
      (e: any) => !existingEmails.has(e.email?.toLowerCase())
    );
    fieldsUpdated += childData.emails.length;
  }
  // ... same pattern for phones, socialLinks, education, 
  //     experience, tags, interests, attributes

  // 3. TRANSACTION: Apply all mutations atomically
  const txn = sqlite.transaction(() => {
    // Apply scalar updates via direct UPDATE (skip hydration overhead)
    if (Object.keys(scalarUpdate).length > 0) {
      // SECURITY: Validate field names against an explicit allowlist before
      // interpolating into SQL. The scalarFields const array already bounds this,
      // but this guard is defense-in-depth against future regressions.
      const ALLOWED_SCALAR_FIELDS = new Set([
        'headline', 'about', 'industry', 'website',
        'location', 'pronouns', 'birthday',
      ]);
      for (const key of Object.keys(scalarUpdate)) {
        if (!ALLOWED_SCALAR_FIELDS.has(key)) {
          throw new Error(`mergeEngine: disallowed field "${key}" in scalar update`);
        }
      }
      const setClauses = Object.keys(scalarUpdate).map(k => `${k} = ?`).join(', ');
      const values = Object.values(scalarUpdate);
      sqlite.prepare(
        `UPDATE contacts SET ${setClauses}, updatedAt = ? WHERE id = ?`
      ).run(...values, new Date().toISOString(), contactId);
    }

    // Insert new child records with source='ai-search'
    if (Object.values(childData).some(arr => arr?.length)) {
      contactRepo.insertChildRecords(contactId, childData, 'ai-search');
    }

    // ALWAYS stamp aiHydratedAt on successful search — even if no new
    // data was found (re-search confirms data is still current)
    sqlite.prepare('UPDATE contacts SET aiHydratedAt = ? WHERE id = ?')
      .run(new Date().toISOString(), contactId);
  });
  txn();

  // Invalidate the semantic search cache so updated data is searchable
  invalidateSearchCache();

  return fieldsUpdated;
}
```

> **Why direct SQL instead of `contactService.patchContact()`?**
> `patchContact()` calls `contactRepo.hydrate()` internally, which runs 12 prepared
> statements to fully join all child tables. The merge engine discards this return value,
> so the hydration is pure waste. Direct SQL avoids ~12 unnecessary queries per contact.

| Array | Duplicate Key | Strategy |
|---|---|---|
| `emails` | `email` (case-insensitive) | Skip if exists |
| `phones` | `phone` (normalized) | Skip if exists |
| `socialLinks` | `url` (normalized) | Skip if exists |
| `education` | `school + degree` | Skip if both match |
| `experience` | `company + role + startDate year` | Skip if all three match (prevents false positives for repeat employers) |
| `tags` | `tag` (exact) | Skip if exists |
| `interests` | `interest` (exact) | Upsert via `ON CONFLICT` |
| `attributes` | `name` (exact) | Upsert via `ON CONFLICT` |

> **FTS Trigger Note**: Child-table triggers (`fts_tags_ai`, `fts_interests_ai`, etc.)
> still fire N times within the transaction — one per inserted row. The transaction
> reduces WAL sync overhead but does not collapse FTS rebuilds. For high-volume merges
> (contacts with many tags/interests), consider a manual FTS refresh at the end of the
> transaction instead of relying on per-row triggers.

### 6.4 — File: `server/services/aiSearch/jobQueue.ts`

In-memory queue managing batch lifecycle:

```typescript
import { EventEmitter } from 'events';

class AISearchJobQueue extends EventEmitter {
  private batches = new Map<string, AISearchBatch>();
  private processing = false;
  private lastBatchCompletedAt: Date | null = null;

  /** 5-minute cooldown between batch starts to prevent token abuse */
  private readonly COOLDOWN_MS = 5 * 60 * 1000;

  canStartBatch(): { allowed: boolean; reason?: string } {
    if (this.processing) {
      return { allowed: false, reason: 'A batch is already in progress.' };
    }
    if (this.lastBatchCompletedAt) {
      const elapsed = Date.now() - this.lastBatchCompletedAt.getTime();
      if (elapsed < this.COOLDOWN_MS) {
        const waitSec = Math.ceil((this.COOLDOWN_MS - elapsed) / 1000);
        return { allowed: false, reason: `Please wait ${waitSec}s before starting another batch.` };
      }
    }
    return { allowed: true };
  }

  createBatch(contacts: Array<{id: string, name: string}>, strategy: string): AISearchBatch;

  async processBatch(batchId: string): Promise<void> {
    if (this.processing) {
      throw new Error('An AI Search batch is already in progress');
    }
    this.processing = true;
    
    try {
      // Sequential processing — one contact at a time. For each job:
      //   1. Set status → 'searching'  → emit(batchId, batch)
      //   2. Fetch full HydratedContact from contactService.getContactById()
      //   3. Build prompt via buildSearchPrompt(contact)
      //   4. Execute strategy.execute(contact, prompt)  [two-pass internally]
      //   5. Set status → 'merging'    → emit(batchId, batch)
      //   6. Run mergeEngine.mergeSearchResult(contactId, contact, result.data)
      //   7. Set status → 'success' + fieldsUpdated → emit(batchId, batch)
      //   CATCH: Set status → 'error' + error.message → emit(batchId, batch)
      //   The batch continues processing remaining jobs regardless of individual errors
    } finally {
      this.processing = false;
      this.lastBatchCompletedAt = new Date();
      // Final emit signals SSE clients to close
      const batch = this.batches.get(batchId);
      if (batch) this.emit(batchId, batch);
    }
  }
  
  getBatch(batchId: string): AISearchBatch | null;
  getActiveBatches(): AISearchBatch[];
  
  /** Cleanup completed batches older than 30 minutes */
  gc(): void;
}
```

**Concurrency**: V1 is strictly sequential (1 contact at a time) to avoid rate limits. The `processBatch` method can be upgraded to use `p-limit(2)` in the future. The `canStartBatch()` guard enforces both the concurrency lock and the 5-minute inter-batch cooldown — the API route returns HTTP 429 with a human-readable reason if either condition is not met.

**Rate limiting**: Additionally, add `express-rate-limit` on the `POST /api/ai-search` endpoint to prevent repeated batch submissions (e.g., `max: 5` per hour) as a second layer of defense independent of the in-memory cooldown.

### 6.5 — File: `server/services/aiSearch/strategies/index.ts`

```typescript
const STRATEGIES: Record<string, () => AISearchStrategy> = {
  'two-pass': () => new TwoPassStrategy(),
  // Future strategies plug in here:
  // 'consensus':  () => new ConsensusStrategy(),
  // 'judge':      () => new JudgeStrategy(),
};

export function getStrategy(name: string = 'two-pass'): AISearchStrategy {
  const factory = STRATEGIES[name];
  if (!factory) throw new Error(`Unknown strategy: ${name}`);
  return factory();
}
```

---

## 7. Output JSON Schema

The schema sent to Gemini (for Pass 2) must match the `contactUpdateSchema` shape so results can pass directly through the existing `updateContact` and `insertChildRecords` codepaths.

See `server/utils/validators.ts` — the `contactUpdateSchema` is `contactCreateSchema.partial()`. The AI Search output schema mirrors this but excludes fields the LLM should never set (name, id, avatarUrl, themeColor, cadenceDays, lat, lng, isGhost, isArchived).

The full JSON schema object for the Gemini `responseSchema` config is defined in `promptTemplate.ts` and covers: `headline`, `about`, `industry`, `website`, `location`, `pronouns`, `birthday`, plus child arrays for `emails`, `phones`, `socialLinks`, `education`, `experience`, `tags`, `interests`, `attributes`.

**Zod validation before merge**: The `TwoPassStrategy` validates Pass 2 output through a Zod schema with `.strict()` before it reaches `mergeEngine`. This rejects unexpected fields the LLM might hallucinate (e.g., `id`, `isArchived`) and enforces correct array shapes:

```typescript
import { z } from 'zod';

const aiSearchOutputSchema = z.object({
  headline: z.string().nullish(),
  about: z.string().nullish(),
  industry: z.string().nullish(),
  website: z.string().url().nullish(),
  location: z.string().nullish(),
  pronouns: z.string().nullish(),
  birthday: z.string().nullish(),
  emails: z.array(z.object({
    email: z.string().email(),
    label: z.string().optional(),
  })).optional(),
  phones: z.array(z.object({
    phone: z.string(),
    label: z.string().optional(),
  })).optional(),
  socialLinks: z.array(z.object({
    platform: z.string(),
    url: z.string().url(),
  })).optional(),
  // ... education, experience, tags, interests, attributes follow same pattern
}).strict(); // ← Rejects any field not in this allowlist

const validated = aiSearchOutputSchema.safeParse(rawParsed);
if (!validated.success) {
  throw new Error(`AI output schema validation failed: ${validated.error.message}`);
}
```

---

## 8. API Endpoints

### File: `server/routes/aiSearch.ts`

```typescript
import { z } from 'zod';
import { validateBody } from '../utils/validators.ts';
import rateLimit from 'express-rate-limit';

// Validation schema — caps batch size at 100 to prevent accidental mega-batches
const aiSearchBodySchema = z.object({
  contactIds: z.array(z.string().uuid()).min(1).max(100),
  strategy: z.string().optional().default('two-pass'),
});

// Rate limiter: max 5 batch starts per hour per IP
const aiSearchLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5,
  message: { error: 'Too many AI Search requests. Please wait before starting another batch.' }
});

// POST /api/ai-search — Start a new batch
// Body: { contactIds: string[], strategy?: string }
// Response: { batchId: string, jobCount: number }
router.post('/ai-search', aiSearchLimiter, validateBody(aiSearchBodySchema), asyncHandler(async (req, res) => {
  const { contactIds, strategy } = req.body;
  
  // Canary guard — checks both in-progress lock and cooldown
  const check = jobQueue.canStartBatch();
  if (!check.allowed) {
    return res.status(429).json({ error: check.reason });
  }
  
  // Fetch contact names for the job queue UI display
  // Create batch via jobQueue.createBatch()
  // Kick off processBatch() async (don't await — fire-and-forget)
  // Return batchId immediately
}));

// GET /api/ai-search/status?batchId=<uuid>
// Response: AISearchBatch (with all jobs and their statuses)
// (Kept for polling fallback — prefer SSE stream endpoint below)
router.get('/ai-search/status', asyncHandler(async (req, res) => {
  const batchId = req.query.batchId as string;
  // Return batch state, or 404 if not found
}));

// GET /api/ai-search/stream?batchId=<uuid>
// Response: text/event-stream — pushes AISearchBatch state on every job status change
// Preferred over polling: eliminates ~1500 unnecessary requests for a 100-contact batch
router.get('/ai-search/stream', (req, res) => {
  const batchId = req.query.batchId as string;
  if (!batchId) return res.status(400).json({ error: 'batchId required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send current state immediately
  const batch = jobQueue.getBatch(batchId);
  if (!batch) return res.status(404).end();
  res.write(`data: ${JSON.stringify(batch)}\n\n`);
  if (batch.status === 'complete') return res.end();

  // Subscribe to live updates from the job queue EventEmitter
  const handler = (updatedBatch: AISearchBatch) => {
    res.write(`data: ${JSON.stringify(updatedBatch)}\n\n`);
    if (updatedBatch.status === 'complete' || updatedBatch.status === 'cancelled') {
      res.end();
    }
  };

  jobQueue.on(batchId, handler);
  req.on('close', () => jobQueue.off(batchId, handler));
});
```

**Registration in `server.ts`:**
```typescript
import { aiSearchRouter } from "./server/routes/aiSearch.ts";
// Add after the dedupeRouter registration:
app.use("/api", aiSearchRouter);
```

---

## 9. Frontend — React Query Hooks

### File: `src/api/aiSearch.ts`

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const API_BASE = '/api';

/** Kick off AI Search for selected contacts */
export const useStartAISearch = () => {
  return useMutation({
    mutationFn: async (contactIds: string[]) => {
      const res = await fetch(`${API_BASE}/ai-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to start AI Search');
      }
      return res.json() as Promise<{ batchId: string; jobCount: number }>;
    },
  });
};

/**
 * SSE-based batch status hook. Connects to the stream endpoint for real-time
 * updates without polling. Falls back to adaptive polling if SSE is unavailable.
 */
export const useAISearchStatus = (
  batchId: string | null,
  onUpdate: (batch: AISearchBatch) => void,
) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!batchId) return;

    // Prefer SSE for real-time updates (no polling overhead)
    const source = new EventSource(`${API_BASE}/ai-search/stream?batchId=${batchId}`);

    source.onmessage = (event) => {
      const batch: AISearchBatch = JSON.parse(event.data);
      onUpdate(batch);
      if (batch.status === 'complete') {
        // Invalidate contacts cache so updated data appears everywhere
        queryClient.invalidateQueries({ queryKey: ['contacts'] });
        source.close();
      }
    };

    source.onerror = () => {
      // SSE failed — fall back to adaptive polling
      source.close();
    };

    return () => source.close();
  }, [batchId, queryClient, onUpdate]);
};

/** Polling fallback: only used when SSE is unavailable */
export const useAISearchStatusPoll = (batchId: string | null) => {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['ai-search-status', batchId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/ai-search/status?batchId=${batchId}`);
      if (!res.ok) throw new Error('Failed to fetch status');
      return res.json();
    },
    enabled: !!batchId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.status === 'complete') {
        if (data?.status === 'complete') {
          queryClient.invalidateQueries({ queryKey: ['contacts'] });
        }
        return false;
      }
      // Adaptive: fast when active, slower when idle between contacts
      const active = data.jobs.filter(
        (j: AISearchJob) => j.status === 'searching' || j.status === 'merging'
      ).length;
      return active > 0 ? 1000 : 3000;
    },
  });
};
```

**Update `src/api/index.ts`:**
```typescript
export * from './aiSearch';
```

---

## 10. Frontend — UI Architecture

### 10.1 — Settings Page Card (in `SettingsView.tsx`)

Insert as the **second card, immediately after the Dedupe Engine** card (peer power-tool placement):

```tsx
<Link to="/settings/ai-search" className={cn(CARD, "block hover:bg-surface-container-high transition-colors group cursor-pointer")}>
  <h3 className={cn(SECTION_HEADING, "mb-2 flex items-center gap-2 group-hover:text-primary transition-colors")}>
    <Sparkles className="w-5 h-5 text-primary" />
    AI Search
  </h3>
  <p className="text-sm text-on-surface-variant">
    Automatically research and enrich contact profiles using AI-powered internet search.
  </p>
</Link>
```

Import `Sparkles` from `lucide-react` (already imported in `App.tsx` and `Sidebar.tsx`).

**Settings route** (add to `SettingsView.tsx` Routes):
```tsx
<Route path="/ai-search" element={
  <div className="overflow-y-auto h-full">
    <AISearchView />
  </div>
} />
```

**Also update the header icon logic** to show the Sparkles icon when `isAISearch` is active:
```tsx
// Use includes() not endsWith() to survive future sub-routes
const isAISearch = location.pathname.includes('/ai-search');
// In the icon conditional:
isAISearch ? <Sparkles className="w-6 h-6 text-primary" /> : ...
// In the title conditional:
isAISearch ? 'AI Search' : ...
```

### 10.2 — File Structure

```
src/views/ai-search/
├── AISearchView.tsx              # Main page
├── index.ts                      # export { AISearchView } from './AISearchView'
└── components/
    ├── AISearchContactList.tsx    # Contact list with status badges  
    ├── AISearchConfirmModal.tsx   # Credit warning + start button
    └── AISearchProgressOverlay.tsx # Fixed bottom-right progress panel
```

### 10.3 — AISearchView Layout

The main view follows the same pattern as `ArchivedContactsView` — a styled list of contacts with action capabilities:

```
┌─────────────────────────────────────────────────────────┐
│  ✨ AI Search                                           │
│  Enrich your contacts with AI-powered web research.     │
│  Select contacts below, then click "Start AI Search".   │
│                                                         │
│  ┌ Search... (/filter)                          [All] ┐│
│  │                                                     ││
│  │ 14 contacts              ☑ Select All              ││
│  │─────────────────────────────────────────────────────││
│  │ ☑ [Avatar] David Kim           ✨ Apr 1   ○        ││
│  │            Architect · Netflix                      ││
│  │─────────────────────────────────────────────────────││
│  │ ☑ [Avatar] Marcus Sterling     NEW        ○        ││
│  │            Partner · Sterling Capital               ││
│  │─────────────────────────────────────────────────────││
│  │ ☐ [Avatar] Dr. Sarah Chen      🔴 Error   ○        ││
│  │            CTO · NeuroTech Labs                     ││
│  │─────────────────────────────────────────────────────││
│  │                    ... more contacts ...             ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │  ✨ Start AI Search (3 selected)                    ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

**Contact row status badges:**
- **✨ + date**: `aiHydratedAt` is non-null → previously searched. Shows relative date.
- **NEW**: `aiHydratedAt` is null → never searched. Use a subtle gray pill.
- **🔴**: Last AI search for this contact errored. Show `AlertCircle` icon in rose-500.

The status badge colors use the design system tokens only:
- Sparkle badge: `text-primary bg-primary/10`
- NEW badge: `text-on-surface-variant bg-surface-container-low`
- Error badge: `text-rose-500 bg-rose-500/10`

### 10.4 — AISearchConfirmModal

Triggered when user clicks "Start AI Search". Uses the existing `Modal` component (`src/components/ui/Modal.tsx`).

```
┌─────────────────────────────────────────────────┐
│                                                   │
│   ✨ Start AI Search                              │
│                                                   │
│   You're about to research 8 contacts using       │
│   AI-powered internet search.                     │
│                                                   │
│   • Uses approximately 8 AI search credits        │
│   • Takes about 2-3 minutes to complete           │
│   • Runs in the background — you can keep working │
│                                                   │
│   3 of these contacts have been previously         │
│   searched. New information will be added.         │
│                                                   │
│   ┌──────────┐  ┌──────────────────────────────┐  │
│   │  Cancel   │  │  ✨ Search 8 Contacts       │  │
│   └──────────┘  └──────────────────────────────┘  │
│                                                   │
│   New data fills empty fields. Your existing      │
│   data is never overwritten.                      │
└─────────────────────────────────────────────────┘
```

### 10.5 — AISearchProgressOverlay

A **persistent floating panel** rendered via React portal at the app root level. Inspired by Google Drive's file upload overlay.

**Visual spec:**
```
                                ┌────────────────────────────┐
                                │  ✨ AI Search              │
                                │  ▓▓▓▓▓▓▓░░░  5/8          │
                                │                            │
                                │  ✓ David Kim       1.2s   │
                                │  ✓ Carlos Rivera   2.1s   │
                                │  ✓ Elena Rostova   1.8s   │
                                │  ✓ Marcus Sterling 0.9s   │
                                │  ◉ Sophia Martinez ...     │
                                │  ○ Aisha Patel             │
                                │  ○ Anita Desai             │
                                │  ✕ Chloe Dubois   Error   │
                                │                            │
                                │        [Dismiss]           │
                                └────────────────────────────┘
```

**Implementation:**

```tsx
// Positioned fixed, bottom-right, z-50
// Does NOT block interaction with the rest of the app
<div className="fixed bottom-6 right-6 z-50 w-80">
  <motion.div className={cn(CARD, "shadow-2xl ring-1 ring-surface-container-highest/30")}>
    {/* Header with progress bar */}
    {/* Scrollable job list (max-h-64 overflow-y-auto) */}
    {/* Dismiss button */}
  </motion.div>
</div>
```

**State management**: The overlay state (active batchId, visibility) lives in a React context provider (`AISearchProvider`) placed inside `App.tsx` wrapping `ResponsiveLayout`. This allows any page to trigger a search and have the overlay persist across navigation.

```tsx
// src/App.tsx — wrap ResponsiveLayout:
<AISearchProvider>
  <ResponsiveLayout />
</AISearchProvider>
```

The provider renders the `AISearchProgressOverlay` via a portal, so it floats above all content regardless of routing.

**Job status icons and colors:**
| Status | Icon | Color |
|---|---|---|
| `queued` | `Circle` (outline) | `text-on-surface-variant/40` |
| `searching` | `Loader2` (spin) | `text-primary` |
| `merging` | `Loader2` (spin) | `text-amber-500` |
| `success` | `CheckCircle2` | `text-emerald-500` |
| `error` | `XCircle` | `text-rose-500` |

**Auto-dismiss behavior:**
- When all jobs complete, the overlay stays visible for 5 seconds showing the summary
- Then auto-minimizes to a compact badge: "✨ AI Search: 5 updated, 1 failed"
- Clicking the badge re-expands the overlay
- The "Dismiss" button removes the overlay entirely

**On completion**: The polling hook automatically calls `queryClient.invalidateQueries({ queryKey: ['contacts'] })` so updated contact data appears everywhere in the app immediately.

---

## 11. Error Handling

### 11.1 — Job-Level Errors

When any step fails for a contact (LLM timeout, JSON parse error, rate limit, merge failure):

1. The job transitions to `status: 'error'` with `error: errorMessage`
2. The batch **continues processing** remaining jobs
3. The overlay shows a red ✕ for that contact
4. The contact's `aiHydratedAt` is **not** updated (so it still shows as "not searched")

### 11.2 — Batch-Level Errors

If the entire batch API call fails (e.g., server down), the frontend mutation's `onError` shows a Sonner toast.

### 11.3 — Concurrency Rejection

If the user triggers a new batch while one is already processing, the API returns HTTP 429 with a clear message. The frontend should show a Sonner toast: "An AI Search batch is already running. Please wait for it to finish."

### 11.4 — Retry Flow

Users can retry failed contacts by selecting them again and starting a new batch. Since `aiHydratedAt` was not set on failure, they still appear as "not searched" in the picker.

### 11.5 — Rate Limit Handling

The `TwoPassStrategy` uses its own grounding-capable model list for Pass 1 and a schema-capable model list for Pass 2. If all grounding models are rate-limited, the error surfaces as a per-job failure. A future improvement could add exponential backoff with jitter between retry attempts.

---

## 12. Complete File Inventory

### New Files (14)

| File | Purpose |
|---|---|
| `server/services/aiSearch/types.ts` | Type definitions |
| `server/services/aiSearch/promptTemplate.ts` | Prompt builder + output Zod schema |
| `server/services/aiSearch/strategies/twoPass.ts` | V1 two-pass strategy (grounding + extraction) |
| `server/services/aiSearch/strategies/index.ts` | Strategy registry |
| `server/services/aiSearch/mergeEngine.ts` | Additive merge logic with allowlist guard |
| `server/services/aiSearch/jobQueue.ts` | In-memory batch queue + EventEmitter |
| `server/services/aiSearch/index.ts` | Public facade |
| `server/routes/aiSearch.ts` | API endpoints (POST, GET status, GET SSE stream) |
| `src/api/aiSearch.ts` | SSE hook + polling fallback hook |
| `src/contexts/AISearchContext.tsx` | Global context + overlay portal |
| `src/views/ai-search/AISearchView.tsx` | Main settings sub-view |
| `src/views/ai-search/index.ts` | Barrel export |
| `src/views/ai-search/components/AISearchConfirmModal.tsx` | Credit warning |
| `src/views/ai-search/components/AISearchProgressOverlay.tsx` | Floating progress panel |

### Modified Files (7)

| File | Change |
|---|---|
| `server/ai/types.ts` | Add `enableSearchGrounding` flag to `AIGenerateOptions` |
| `server/ai/adapters/gemini.ts` | Map `enableSearchGrounding` → `tools` + clear `responseSchema` (API constraint) |
| `server.ts` | Register `aiSearchRouter` |
| `src/views/SettingsView.tsx` | Add AI Search card + route + header |
| `src/api/index.ts` | Re-export `./aiSearch` |
| `src/App.tsx` | Wrap with `AISearchProvider` |
| `src/types.ts` | Add `AISearchJob`/`AISearchBatch` types |

---

## 13. Implementation Phases

### Phase 1: Server Engine (no frontend impact)
- [ ] `server/services/aiSearch/types.ts`
- [ ] `server/ai/types.ts` — add `enableSearchGrounding` to `AIGenerateOptions`
- [ ] `server/ai/adapters/gemini.ts` — map flag to `tools`; **clear `responseSchema`** when grounding enabled
- [x] ~~**Prerequisite**: Audit and fix `FALLBACK_MODELS` in gemini.ts (invalid model IDs)~~ ✅ Fixed — now uses `gemini-2.5-flash-lite/flash/pro`
- [ ] `server/services/aiSearch/promptTemplate.ts` — with disambiguation hints + identity validation rules
- [ ] `server/services/aiSearch/strategies/twoPass.ts` — two-pass grounding + extraction
- [ ] `server/services/aiSearch/strategies/index.ts`
- [ ] `server/services/aiSearch/mergeEngine.ts` — with transaction + allowlist guard + cache invalidation
- [ ] `server/services/aiSearch/jobQueue.ts` — with EventEmitter + cooldown + concurrency guard
- [ ] `server/services/aiSearch/index.ts`

### Phase 2: API Routes
- [ ] `server/routes/aiSearch.ts` — POST + GET status + GET SSE stream endpoints; rate-limit middleware
- [ ] `server.ts` — register router

### Phase 3: Frontend Hooks & Context
- [ ] `src/api/aiSearch.ts` — hooks
- [ ] `src/api/index.ts` — re-export
- [ ] `src/types.ts` — add types
- [ ] `src/contexts/AISearchContext.tsx` — global state + overlay

### Phase 4: Frontend UI
- [ ] `src/views/ai-search/AISearchView.tsx`
- [ ] `src/views/ai-search/components/AISearchConfirmModal.tsx`
- [ ] `src/views/ai-search/components/AISearchProgressOverlay.tsx`
- [ ] `src/views/ai-search/index.ts`
- [ ] `src/views/SettingsView.tsx` — card + route + header icon
- [ ] `src/App.tsx` — wrap with provider

### Phase 5: Testing
- [ ] Test single contact search (success path) — verify both passes succeed
- [ ] Test batch with 3+ contacts
- [ ] Verify additive merge: existing data untouched
- [ ] Test error handling: simulate LLM failure on Pass 1; simulate Zod validation failure on Pass 2
- [ ] Verify identity disambiguation: common name contact correctly matched vs null-returned
- [ ] Verify Zod `.strict()` rejects AI output with injected fields (e.g. `isArchived`)
- [ ] Verify progress overlay receives SSE updates live without polling
- [ ] Verify SSE connection closes cleanly on batch completion
- [ ] Verify sparkle badge on hydrated contacts
- [ ] Verify error badge on failed contacts
- [ ] Verify cooldown (submit batch within 5min of last completion → 429)
- [ ] Verify express-rate-limit (>5 POST requests in 1hr → 429)
- [ ] Verify FTS index updated after merge
- [ ] Verify search cache invalidated after merge
- [ ] Full regression — no impact on existing features

---

## 14. Future Extensibility Hooks

The architecture is designed so these can be added without refactoring:

| Feature | Where It Plugs In |
|---|---|
| Multi-model consensus | New strategy in `strategies/` |
| Judge/validator model | New strategy in `strategies/` |
| Pre-fetch from APIs | Additional context param on strategy |
| Persistent job history | Replace `Map` with SQLite table |
| Concurrent processing | `p-limit(N)` in `jobQueue.processBatch()` |
| User review before merge | New status `'pending-review'` + review UI |
| Cost tracking dashboard | Accumulate `tokenCount` from job results |
| Batch queueing (FIFO) | Replace 429 rejection with enqueue in `jobQueue` |
| Source attribution / citations | Wire Pass 1 `groundingMetadata` into child record `sourceUrl` |
| Per-field confidence gating | Add `confidence` field to schema; merge only >0.7 |
| Selective re-hydration | Re-search only fields older than N days |

---

## Appendix A: Review Changelog (v2.0 → v3.0)

| # | Finding | Severity | Fix Applied |
|---|---|---|---|
| 1 | `violet-*` is a **forbidden** color in the design system | 🔴 | Replaced all `violet-*` → `primary` tokens |
| 2 | SDK version hardcoded as resolved, not constraint | 🔴 | Changed to `^1.29.0` reference |
| 3 | `AIGenerateOptions.tools` leaked Gemini internals | 🔴 | Replaced with provider-agnostic `enableSearchGrounding` flag |
| 4 | `patchContact()` wastes 12 SQL queries on hydration merge engine discards | 🔴 | Replaced with direct SQL UPDATE |
| 5 | `GROUNDING_MODELS` used wrong model IDs | 🟡 | Added note to verify against API docs; clarified separate model list |
| 6 | Missing input validation on POST endpoint | 🟡 | Added Zod schema with 100-contact cap |
| 7 | No concurrency guard for overlapping batches | 🟡 | Added `isProcessing()` guard + HTTP 429 |
| 8 | `aiHydratedAt` not stamped if re-search finds no new scalars | 🟡 | Moved stamp outside conditional block |
| 9 | No transaction wrapper → N FTS rebuilds per contact | 🟡 | Wrapped all merge mutations in SQLite transaction |
| 10 | Search cache not invalidated after merge | 🟡 | Added `invalidateSearchCache()` call |
| 11 | `AISearchProgressOverlay.tsx` missing from file inventory | 🔵 | Added to inventory (now 14 new files) |
| 12 | Settings card placement description was ambiguous | 🔵 | Clarified: "second card, after Dedupe Engine" |
| 13 | `endsWith('/ai-search')` fragile for sub-routes | 🔵 | Changed to `includes('/ai-search')` |
| 14 | Batch status missing `cancelled` state | 🔵 | Added `'cancelled'` to union type |

---

## Appendix B: Review Changelog (v3.0 → v4.0)

| # | Finding | Severity | Fix Applied |
|---|---|---|---|
| 1 | `googleSearch` + `responseSchema` in same request → `400 Invalid Argument` API error | 🔴 | Replaced `singlePass.ts` with `twoPass.ts`; Pass 1 = grounding/text, Pass 2 = schema/JSON |
| 2 | `FALLBACK_MODELS` in live `gemini.ts` contains non-existent model IDs | 🔴 | Added explicit prerequisite step to audit/correct model list before deployment |
| 3 | Dynamic SQL field names in merge engine → injection risk on future edits | 🔴 | Added `ALLOWED_SCALAR_FIELDS` allowlist guard with runtime assertion |
| 4 | Prompt missing identity disambiguation hints and confidence threshold | 🟡 | Added `Suggested Search Queries` block + rules 8 (identity validation) + 9 (80% confidence) |
| 5 | FTS trigger amplification behavior mischaracterized | 🟡 | Corrected note: triggers fire per-row within transaction; WAL sync saved but not trigger count |
| 6 | 2s polling → ~1500 requests for 100-contact batch | 🟡 | Added SSE stream endpoint; polling demoted to fallback with adaptive interval |
| 7 | No cooldown between batches; no HTTP rate limiting | 🟡 | Added `COOLDOWN_MS` guard + `canStartBatch()`; `express-rate-limit` on POST route |
| 8 | Experience dedup false positives for repeat employers; `socialLinks.handle` schema mismatch | 🟡 | Dedup key updated to `company + role + startDate year`; `socialLinks` dedup simplified to `url` |
| 9 | No Zod validation of AI output before merge → malformed data silently corrupts records | 🟡 | Added `aiSearchOutputSchema.strict()` Zod parse in `TwoPassStrategy` before `mergeEngine` |
| 10 | `AISearchResult.citations` not captured from `groundingMetadata` | 🔵 | Added `citations` field to `AISearchResult`; populated from Pass 1 `groundingChunks` |
| 11 | `EventEmitter` not included in `jobQueue` — SSE had no push mechanism | 🔵 | `AISearchJobQueue` now `extends EventEmitter`; emits `batchId` events on job state changes |
| 12 | `useAISearchStatus` signature change (added `onUpdate` callback for SSE) | 🔵 | Renamed poll-only hook to `useAISearchStatusPoll`; SSE hook is primary |
| 13 | Strategy registry default referenced `single-pass` (now `two-pass`) | 🔵 | Updated default in registry and Zod body schema |
| 14 | Future extensibility table missing citation/confidence/selective re-hydration hooks | 🔵 | Added 3 new entries to Section 14 |

