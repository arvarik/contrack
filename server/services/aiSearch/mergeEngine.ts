// =============================================================================
// AI Search — Merge Engine
// =============================================================================
// Applies AI Search results to the database using a strictly additive strategy.
// Never overwrites existing user data. All mutations are wrapped in a single
// SQLite transaction for atomicity.
//
// Design decisions:
// - Direct SQL UPDATE for scalars (avoids 12 unnecessary hydration queries)
// - Field name allowlist guard (defense-in-depth against SQL injection)
// - Deduplication logic per child table (see table below)
// - Always stamps aiHydratedAt, even if no new data was found
// - Every run is recorded in `aiResearch`: what it added, field by field, the
//   facts it reported and the pages it cited (shared/researchRecord.ts)
// - Invalidates semantic search cache after merge
//
// PERF: FTS triggers fire per-row within the transaction. This is acceptable
// for V1 (~0.1ms per trigger fire with prepared statements). The transaction
// reduces WAL sync overhead but does not collapse trigger count.
// =============================================================================

import { sqlite } from "../../db.ts";
import { sanitizeAiOutputValue } from "../../ai/promptSafety.ts";
import { contactRepo } from "../../repositories/contactRepository.ts";
import { scheduleSearchIndex } from "../search/indexQueue.ts";
import { aiCache, ownerKey } from "../../utils/aiCache.ts";
import type {
  HydratedContact,
  ChildRecordsPayload,
} from "../../repositories/types.ts";
import { aiSearchOutputSchema } from "./promptTemplate.ts";
import {
  degreeLevel,
  linkedInHandle,
  orgKey,
  sameLabel,
  sameOrg,
  textKey,
} from "./normalize.ts";
import { contactFingerprint, enrichmentContact } from "./contactSnapshot.ts";
import { AppError } from "../../utils/AppError.ts";
import { log } from "../../utils/logger.ts";
import type { Scope } from "../../tenancy/scope.ts";
import {
  isLegacyDossier,
  MAX_ADDED_ENTRIES,
  MAX_RESEARCH_RUNS,
  MAX_RESEARCH_SOURCES,
  parseResearchRecord,
  researchRecordSchema,
  type ResearchAddedEntry,
  type ResearchAddition,
  type ResearchFinding,
  type ResearchOutcome,
  type ResearchRecord,
  type ResearchRun,
  type ResearchUsage,
} from "../../../shared/researchRecord.ts";
import type { ResearchDepth } from "../../../shared/researchDepth.ts";

// =============================================================================
// Allowed Scalar Fields
// =============================================================================
// SECURITY: Only these field names may be interpolated into SQL SET clauses.
// This is a defense-in-depth guard — even though the Zod schema already
// constrains the input, this prevents regressions if the schema is loosened.
// =============================================================================

const ALLOWED_SCALAR_FIELDS = new Set([
  "role",
  "company",
  "headline",
  "about",
  "industry",
  "website",
  "location",
  "pronouns",
  "birthday",
  "aiBackground",
  "aiResearch",
]);

/** Runs that keep their fact lines. Older runs keep their summary only. */
const RUNS_WITH_FINDINGS = 2;

/** A school entry, saved or researched, as the merge compares it. */
interface SchoolEntry {
  school: string;
  degree?: string | null;
  endDate?: string | null;
}

/** A job entry, saved or researched, as the merge compares it. */
interface JobEntry {
  company: string;
  role?: string | null;
  startDate?: string | null;
}

/** End years a year apart or less, or a year missing on either side. */
function yearsClose(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return true;
  return Math.abs(Number(a.slice(0, 4)) - Number(b.slice(0, 4))) <= 1;
}

// =============================================================================
// Research history
// =============================================================================

/** What a strategy says about the research behind its data. */
export interface ResearchProvenance {
  /** The pages the research cited, with real addresses. */
  citations?: Array<{ title: string; uri: string }>;
  /** The facts the search pass reported, one per line. */
  findings?: ResearchFinding[];
  /** The models that ran, search pass first. */
  models?: string[];
  /** The searches the search pass ran. */
  searchQueries?: string[];
  /** `"no-public-info"` when no page was about this person. */
  outcome?: "found" | "no-public-info";
  /** How thoroughly the research ran. */
  depth?: ResearchDepth;
  /** What it spent, over every call. */
  usage?: ResearchUsage;
}

/**
 * This contact's research so far, or null before any.
 *
 * A contact enriched before the record existed has `aiHydratedAt` and no
 * record. It counts as one earlier run whose details were not kept, so the
 * next enrichment is told it is a second round, and the dossier's history
 * says the earlier one happened.
 */
export function researchHistory(
  contact: Pick<HydratedContact, "aiResearch" | "aiHydratedAt">,
): ResearchRecord | null {
  const record = parseResearchRecord(contact.aiResearch);
  if (record) return record;
  if (!contact.aiHydratedAt) return null;
  return {
    version: 1,
    runs: [
      {
        at: contact.aiHydratedAt,
        models: [],
        outcome: "added",
        added: [],
        sourceCount: 0,
        queries: [],
        findings: [],
      },
    ],
    sources: [],
  };
}

/**
 * The record with this run added.
 *
 * Sources merge by address and keep the time a run first cited them. Only
 * the latest runs keep their fact lines, because the record travels with
 * the contact on every read. The entries the run added join the earlier
 * runs' entries, and the oldest drop off past `MAX_ADDED_ENTRIES`.
 */
function recordRun(
  history: ResearchRecord | null,
  run: Omit<ResearchRun, "sourceCount">,
  citations: Array<{ title: string; uri: string }>,
  addedEntries: ResearchAddedEntry[],
): ResearchRecord {
  const entries = [...(history?.addedEntries ?? []), ...addedEntries].slice(
    -MAX_ADDED_ENTRIES,
  );
  const sources = [...(history?.sources ?? [])];
  const known = new Set(sources.map((source) => source.url));
  for (const citation of citations) {
    if (known.has(citation.uri) || citation.uri.length > 2000) continue;
    known.add(citation.uri);
    sources.push({
      url: citation.uri,
      title: citation.title.slice(0, 300),
      firstSeenAt: run.at,
    });
  }
  const runs = [
    ...(history?.runs ?? []),
    { ...run, sourceCount: citations.length },
  ].slice(-MAX_RESEARCH_RUNS);
  return {
    version: 1,
    runs: runs.map((entry, index) =>
      index < runs.length - RUNS_WITH_FINDINGS
        ? { ...entry, findings: [] }
        : entry,
    ),
    sources: sources.slice(-MAX_RESEARCH_SOURCES),
    ...(entries.length > 0 && { addedEntries: entries }),
  };
}

/** A child record's text, whether it is written as a string or an object. */
function entryText(entry: unknown, key: string): string {
  if (typeof entry === "string") return entry;
  const value = (entry as Record<string, unknown> | null)?.[key];
  return typeof value === "string" ? value : "";
}

/** An entry as the record keeps it, each part cut to the schema's length. */
function addedEntry(
  field: string,
  value: string,
  detail?: string | null,
  date?: string | null,
): ResearchAddedEntry {
  return {
    field,
    value: value.slice(0, 300),
    ...(detail && { detail: detail.slice(0, 200) }),
    ...(date && { date: date.slice(0, 20) }),
  };
}

// =============================================================================
// Merge Function
// =============================================================================

/**
 * Merge one research result into a contact, and record the run.
 *
 * @param scope - The account that owns the contact.
 * @param contactId - The contact researched.
 * @param existing - The contact as it was when the research started. The
 *   merge refuses when it has changed since, so research never writes over
 *   an edit made while it ran.
 * @param output - The structured result, validated here again.
 * @param provenance - What the strategy says about the research: the pages,
 *   the fact lines, the models and the searches. Recorded, not merged.
 * @returns How many fields and entries the run added.
 */
export function mergeSearchResult(
  scope: Scope,
  contactId: string,
  existing: HydratedContact,
  output: unknown,
  provenance: ResearchProvenance = {},
): number {
  const fresh = enrichmentContact(scope, contactId);
  if (contactFingerprint(fresh) !== contactFingerprint(existing))
    throw new AppError(
      "Contact changed during research. Review the contact and try again.",
      409,
    );
  existing = fresh;
  const parsed = aiSearchOutputSchema.safeParse(output);
  if (!parsed.success)
    throw new AppError("AI research failed schema validation.", 502, {
      code: "AI_SCHEMA_MISMATCH",
    });
  const searchResult = parsed.data;
  // Deduplicate incoming arrays before comparing them with existing records.
  const keys = {
    emails: (entry: { email: string }) => entry.email.trim().toLowerCase(),
    phones: (entry: { phone: string }) => entry.phone.replace(/\D/g, ""),
    socialLinks: (entry: { url: string }) =>
      entry.url.toLowerCase().replace(/\/$/, ""),
    education: (entry: { school: string; degree?: string }) =>
      `${orgKey(entry.school)}|${textKey(entry.degree)}`,
    experience: (entry: {
      company: string;
      role?: string;
      startDate?: string;
    }) =>
      `${orgKey(entry.company)}|${textKey(entry.role)}|${(entry.startDate ?? "").slice(0, 4)}`,
    tags: (entry: { tag: string }) => entry.tag.toLowerCase(),
    interests: (entry: { interest: string }) => entry.interest.toLowerCase(),
    attributes: (entry: { name: string }) => entry.name.toLowerCase(),
    addresses: (entry: { address: string }) => entry.address.toLowerCase(),
  };
  for (const field of Object.keys(keys) as (keyof typeof keys)[]) {
    const entries = searchResult[field];
    if (!entries) continue;
    const seen = new Set<string>();
    const key = keys[field] as (entry: unknown) => string;
    Object.assign(searchResult, {
      [field]: entries.filter((entry) => {
        const value = key(entry);
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
      }),
    });
  }
  // What earlier runs added. An entry among them that the contact still has
  // is filtered below as a saved one. The rest the person removed, and
  // research does not add them back: a school deleted as someone else's
  // came back at the next Enrich again.
  const history = researchHistory(existing);
  const before = (field: string) =>
    (history?.addedEntries ?? []).filter((entry) => entry.field === field);

  let fieldsUpdated = 0;
  const added: ResearchAddition[] = [];
  const note = (field: string, count: number) => {
    if (count > 0) added.push({ field, count });
  };
  const scalarUpdate: Record<string, unknown> = {};

  // 1. Scalar fields — only fill if currently null/empty
  const scalarFields = [
    "role",
    "company",
    "headline",
    "about",
    "industry",
    "website",
    "location",
    "pronouns",
    "birthday",
  ] as const;

  for (const field of scalarFields) {
    const newVal = searchResult[field];
    const existingVal = existing[field as keyof HydratedContact];
    if (newVal && !existingVal) {
      // Write-side injection backstop: cap length, strip control chars, and
      // discard values that echo instruction-injection phrases from the web.
      const safeVal = sanitizeAiOutputValue(
        String(newVal),
        field === "about" ? 4_000 : 500,
      );
      if (safeVal === null) continue;
      scalarUpdate[field] = safeVal;
      fieldsUpdated++;
      note(field, 1);
    }
  }

  // 2. Array fields — build child payload, filtering out duplicates
  const childData: ChildRecordsPayload = {};

  // ── Emails: deduplicate by email (case-insensitive) ──────────────
  if (Array.isArray(searchResult.emails) && searchResult.emails.length > 0) {
    // Saved, or added before and removed.
    const skip = new Set(
      [
        ...existing.emails.map((e) => e.email),
        ...before("emails").map((e) => e.value),
      ].map((email) => email.toLowerCase()),
    );
    childData.emails = searchResult.emails.filter(
      (e) => e.email && !skip.has(e.email.toLowerCase()),
    );
  }

  // ── Phones: deduplicate by phone (normalized — digits only) ──────
  if (Array.isArray(searchResult.phones) && searchResult.phones.length > 0) {
    const normalize = (p: string) => p.replace(/\D/g, "");
    const skip = new Set(
      [
        ...existing.phones.map((p) => p.phone),
        ...before("phones").map((p) => p.value),
      ].map(normalize),
    );
    childData.phones = searchResult.phones.filter(
      (p) => p.phone && !skip.has(normalize(p.phone)),
    );
  }

  // ── Social Links: deduplicate by URL (normalized) ────────────────
  // A person has one LinkedIn profile. When the contact has one, from an
  // import or by hand, a researched profile under another handle is someone
  // else with the same name: a second round added one to a contact imported
  // from LinkedIn (2026-09-26). The same handle at another address, such as
  // "uk.linkedin.com", is the profile the contact has. With none saved, the
  // first researched profile is kept and any other one dropped.
  if (
    Array.isArray(searchResult.socialLinks) &&
    searchResult.socialLinks.length > 0
  ) {
    const normalizeUrl = (u: string) => u.toLowerCase().replace(/\/$/, "");
    const removed = before("socialLinks").map((s) => s.value);
    const skip = new Set(
      [...existing.socialLinks.map((s) => s.url), ...removed].map(normalizeUrl),
    );
    const removedHandles = new Set(
      removed
        .map(linkedInHandle)
        .filter((handle): handle is string => handle !== null),
    );
    let hasLinkedIn = existing.socialLinks.some(
      (s) => linkedInHandle(s.url) !== null,
    );
    childData.socialLinks = searchResult.socialLinks.filter((s) => {
      if (!s.url || skip.has(normalizeUrl(s.url))) return false;
      const handle = linkedInHandle(s.url);
      if (handle === null) return true;
      if (hasLinkedIn || removedHandles.has(handle)) return false;
      hasLinkedIn = true;
      return true;
    });
  }

  // ── Education: one school and one degree, however a page writes them ──
  // A second round found "The University of Example", "AB", 2017, for the
  // "University of Example" "BA" of 2013 to 2017, and a school's short name
  // for its long one (2026-09-26). A degree missing on either side matches
  // any: a roster names the school, a profile the degree. End years more
  // than a year apart are two entries.
  if (
    Array.isArray(searchResult.education) &&
    searchResult.education.length > 0
  ) {
    const sameEntry = (a: SchoolEntry, b: SchoolEntry) =>
      sameOrg(a.school, b.school) &&
      (!a.degree ||
        !b.degree ||
        degreeLevel(a.degree) === degreeLevel(b.degree)) &&
      yearsClose(a.endDate, b.endDate);
    const removed: SchoolEntry[] = before("education").map((e) => ({
      school: e.value,
      degree: e.detail,
      endDate: e.date,
    }));
    const kept: NonNullable<typeof searchResult.education> = [];
    for (const entry of searchResult.education) {
      if (!entry.school) continue;
      if (existing.education.some((saved) => sameEntry(saved, entry))) continue;
      if (removed.some((gone) => sameEntry(gone, entry))) continue;
      if (kept.some((other) => sameEntry(other, entry))) continue;
      kept.push(entry);
    }
    childData.education = kept;
  }

  // ── Experience: deduplicate by company + role (+ startDate year when available)
  // When the AI returns an entry without a startDate, we match by company+role
  // only. This prevents duplicates like "COO at Robotics Inc" being inserted
  // twice when the AI doesn't know the start date but the DB does.
  if (
    Array.isArray(searchResult.experience) &&
    searchResult.experience.length > 0
  ) {
    const getYear = (d?: string | null) => (d ? d.slice(0, 4) : "");
    // One employer however it is written ("Kestrel" and "Kestrel Securities
    // International, Inc."), and either the same start month, however the
    // title is worded, or the same role and the same start year when both
    // sides have one. A second round wrote "Associate" for a saved
    // "Associate, Restructuring Group" that started the same month
    // (2026-09-26).
    const month = (d?: string | null) =>
      d && d.length >= 7 ? d.slice(0, 7) : "";
    const sameJob = (a: JobEntry, b: JobEntry) =>
      sameOrg(a.company, b.company) &&
      ((month(a.startDate) !== "" &&
        month(a.startDate) === month(b.startDate)) ||
        (textKey(a.role) === textKey(b.role) &&
          (!a.startDate ||
            !b.startDate ||
            getYear(a.startDate) === getYear(b.startDate))));
    const removed: JobEntry[] = before("experience").map((e) => ({
      company: e.value,
      role: e.detail,
      startDate: e.date,
    }));
    const kept: NonNullable<typeof searchResult.experience> = [];
    for (const entry of searchResult.experience) {
      if (!entry.company) continue;
      if (existing.experience.some((saved) => sameJob(saved, entry))) continue;
      if (removed.some((gone) => sameJob(gone, entry))) continue;
      if (kept.some((other) => sameJob(other, entry))) continue;
      kept.push(entry);
    }
    childData.experience = kept
      // Sanitize: strip the literal string "null" from date fields.
      // LLMs sometimes return "null" as a string instead of omitting the field.
      .map((e) => ({
        ...e,
        startDate:
          e.startDate && e.startDate !== "null" ? e.startDate : undefined,
        endDate: e.endDate && e.endDate !== "null" ? e.endDate : undefined,
      }));
  }

  // ── Tags: one tag however it is worded ("statistics", "statistical
  // analysis") ───────────────────────────────────────────────────────
  if (Array.isArray(searchResult.tags) && searchResult.tags.length > 0) {
    const removed = before("tags").map((e) => e.value);
    const kept: string[] = [];
    for (const { tag } of searchResult.tags) {
      if (!tag) continue;
      if ((existing.tags || []).some((saved) => sameLabel(saved.tag, tag)))
        continue;
      if (removed.some((gone) => sameLabel(gone, tag))) continue;
      if (kept.some((other) => sameLabel(other, tag))) continue;
      kept.push(tag);
    }
    childData.tags = kept.map((tag) => ({ tag }));
  }

  // ── Interests: upsert via ON CONFLICT (handled by insertChildRecords) ──
  // Force isAiGenerated: true — all interests from AI Search are AI-generated
  // by definition. Don't rely on the LLM to set this flag correctly.
  if (
    Array.isArray(searchResult.interests) &&
    searchResult.interests.length > 0
  ) {
    // One interest however it is worded: a second round wrote "Distance
    // running coach" for "Distance running" (2026-09-26).
    const removed = before("interests").map((e) => e.value);
    const kept: string[] = [];
    for (const { interest } of searchResult.interests) {
      if (!interest) continue;
      if (
        existing.interests.some((saved) => sameLabel(saved.interest, interest))
      )
        continue;
      if (removed.some((gone) => sameLabel(gone, interest))) continue;
      if (kept.some((other) => sameLabel(other, interest))) continue;
      kept.push(interest);
    }
    childData.interests = kept.map((interest) => ({
      interest,
      isAiGenerated: true,
    }));
  }

  // ── Attributes: upsert via ON CONFLICT (handled by insertChildRecords) ──
  if (
    Array.isArray(searchResult.attributes) &&
    searchResult.attributes.length > 0
  ) {
    const removed = new Set(
      before("attributes").map((e) => e.value.toLowerCase()),
    );
    childData.attributes = searchResult.attributes.filter(
      (attribute) =>
        !removed.has(attribute.name.toLowerCase()) &&
        !existing.attributes.some(
          (saved) => saved.name.toLowerCase() === attribute.name.toLowerCase(),
        ),
    );
  }

  // ── Addresses: deduplicate by address string (case-insensitive) ──
  if (
    Array.isArray(searchResult.addresses) &&
    searchResult.addresses.length > 0
  ) {
    const skip = new Set(
      [
        ...(existing.addresses || []).map((a) => a.address),
        ...before("addresses").map((a) => a.value),
      ].map((address) => address.toLowerCase()),
    );
    childData.addresses = searchResult.addresses.filter(
      (a) => a.address && !skip.has(a.address.toLowerCase()),
    );
  }

  for (const [field, entries] of Object.entries(childData)) {
    const count = Array.isArray(entries) ? entries.length : 0;
    fieldsUpdated += count;
    note(field, count);
  }

  // What this run adds, in the words the next run compares.
  const addedNow: ResearchAddedEntry[] = [
    ...(childData.emails ?? []).map((e) =>
      addedEntry("emails", entryText(e, "email")),
    ),
    ...(childData.phones ?? []).map((p) =>
      addedEntry("phones", entryText(p, "phone")),
    ),
    ...(childData.socialLinks ?? []).map((s) =>
      addedEntry("socialLinks", entryText(s, "url")),
    ),
    ...(childData.education ?? []).map((e) =>
      addedEntry("education", e.school, e.degree, e.endDate),
    ),
    ...(childData.experience ?? []).map((e) =>
      addedEntry("experience", e.company, e.role, e.startDate),
    ),
    ...(childData.tags ?? []).map((t) =>
      addedEntry("tags", entryText(t, "tag")),
    ),
    ...(childData.interests ?? []).map((i) =>
      addedEntry("interests", entryText(i, "interest")),
    ),
    ...(childData.attributes ?? []).map((a) =>
      addedEntry("attributes", a.name),
    ),
    ...(childData.addresses ?? []).map((a) =>
      addedEntry("addresses", entryText(a, "address")),
    ),
  ].filter((entry) => entry.value);

  // 3. The research record — every run, whatever it found
  const outcome: ResearchOutcome =
    provenance.outcome === "no-public-info"
      ? "no-public-info"
      : fieldsUpdated > 0
        ? "added"
        : "nothing-new";
  const findings = (provenance.findings ?? []).flatMap((finding) => {
    // Web text shown on the dossier: the same backstop as the fields.
    const text = sanitizeAiOutputValue(finding.text, 600);
    return text ? [{ ...finding, text }] : [];
  });
  const record = recordRun(
    history,
    {
      at: new Date().toISOString(),
      models: (provenance.models ?? []).slice(0, 4),
      ...(provenance.depth && { depth: provenance.depth }),
      ...(provenance.usage && { usage: provenance.usage }),
      outcome,
      added: added.slice(0, 30),
      queries: (provenance.searchQueries ?? [])
        .map((query) => query.slice(0, 300))
        .slice(0, 24),
      findings: findings.slice(0, 80),
    },
    provenance.citations ?? [],
    addedNow,
  );
  const checked = researchRecordSchema.safeParse(record);
  if (checked.success)
    scalarUpdate["aiResearch"] = JSON.stringify(checked.data);
  else
    log.warn(
      "MergeEngine",
      `Contact ${contactId}: research record did not validate; not saved`,
    );
  // The old dossier copied the cards the tab now builds, and linked its
  // sources as "Source 1". The record replaces it.
  if (isLegacyDossier(existing.aiBackground))
    scalarUpdate["aiBackground"] = null;

  // 4. TRANSACTION: Apply all mutations atomically
  const txn = sqlite.transaction(() => {
    // Apply scalar updates via direct UPDATE (skip hydration overhead)
    if (Object.keys(scalarUpdate).length > 0) {
      // Validate field names against allowlist before interpolating into SQL
      for (const key of Object.keys(scalarUpdate)) {
        if (!ALLOWED_SCALAR_FIELDS.has(key)) {
          throw new Error(
            `mergeEngine: disallowed field "${key}" in scalar update`,
          );
        }
      }
      const setClauses = Object.keys(scalarUpdate)
        .map((k) => `${k} = ?`)
        .join(", ");
      const values = Object.values(scalarUpdate);
      sqlite
        .prepare(
          `UPDATE contacts SET ${setClauses}, updatedAt = ?
             WHERE id = ? AND ownerId = ?`,
        )
        .run(...values, new Date().toISOString(), contactId, scope.ownerId);
    }

    // Insert new child records with source='ai-search'
    const hasChildData = Object.values(childData).some(
      (arr) => Array.isArray(arr) && arr.length > 0,
    );
    if (hasChildData) {
      contactRepo.insertChildRecords(contactId, childData, "ai-search");
    }

    // ALWAYS stamp aiHydratedAt on successful search — even if no new
    // data was found (re-search confirms data is still current)
    sqlite
      .prepare(
        "UPDATE contacts SET aiHydratedAt = ? WHERE id = ? AND ownerId = ?",
      )
      .run(new Date().toISOString(), contactId, scope.ownerId);
  });
  txn();

  // Invalidate this owner's cached search work so the new data is searchable.
  // It used to flush the whole rerank tier, so one account's research made
  // every other account on the instance pay for a fresh search.
  aiCache.invalidateForOwner("rerank", scope.ownerId);
  aiCache.invalidateForOwner("synthesis", scope.ownerId);
  aiCache.invalidate("briefing", ownerKey(scope, contactId));
  aiCache.invalidateForOwner("dailyInsight", scope.ownerId);
  scheduleSearchIndex(contactId);

  log.info(
    "MergeEngine",
    `Contact ${contactId}: ${fieldsUpdated} field(s) merged (${outcome}; ${added.map((a) => `${a.field} ${a.count}`).join(", ") || "none"})`,
  );
  return fieldsUpdated;
}
