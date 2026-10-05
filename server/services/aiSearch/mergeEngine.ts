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
import { aiSearchOutputSchema, clipList } from "./promptTemplate.ts";
import {
  degreeLevel,
  linkedInHandle,
  listItems,
  orgKey,
  sameItem,
  sameLabel,
  sameOrg,
  sameSchool,
  textKey,
} from "./normalize.ts";
import {
  contactFingerprint,
  enrichmentContact,
  lockEnrichment,
} from "./contactSnapshot.ts";
import { AppError } from "../../utils/AppError.ts";
import { log } from "../../utils/logger.ts";
import type { Scope } from "../../tenancy/scope.ts";
import {
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

/** The fields research fills, and "Not this person" may clear. */
const RESEARCH_SCALARS = [
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
    // A list a run made is kept whole, so "Not this person" takes back
    // each of its items.
    ...(detail && {
      detail: detail.slice(0, field === "attributes" ? 2_000 : 200),
    }),
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
  // What runs the person marked "Not this person" wrote. A list entry of
  // theirs is filtered as a removed one; a field's value is checked here.
  const rejectedRuns = new Set(
    (history?.runs ?? []).filter((run) => run.rejected).map((run) => run.at),
  );
  const rejectedValue = (field: string, value: string) =>
    before(field).some(
      (entry) =>
        !!entry.at &&
        rejectedRuns.has(entry.at) &&
        entry.value === value.slice(0, 300),
    );
  const runAt = new Date().toISOString();

  let fieldsUpdated = 0;
  const added: ResearchAddition[] = [];
  const note = (field: string, count: number) => {
    if (count > 0) added.push({ field, count });
  };
  const scalarUpdate: Record<string, unknown> = {};

  // 1. Scalar fields — only fill if currently null/empty
  for (const field of RESEARCH_SCALARS) {
    const newVal = searchResult[field];
    const existingVal = existing[field as keyof HydratedContact];
    if (newVal && !existingVal) {
      // Write-side injection backstop: cap length, strip control chars, and
      // discard values that echo instruction-injection phrases from the web.
      const safeVal = sanitizeAiOutputValue(
        String(newVal),
        field === "about" ? 4_000 : 500,
      );
      if (safeVal === null || rejectedValue(field, safeVal)) continue;
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
  // for its long one (2026-09-26). It also wrote "Harbor School of
  // Engineering at Example University" for a saved "Example University"
  // (2026-10-05): a school is one however a page names its
  // parts (`sameSchool`). A degree missing on either side matches any: a
  // roster names the school, a profile the degree. End years more than a
  // year apart are two entries.
  if (
    Array.isArray(searchResult.education) &&
    searchResult.education.length > 0
  ) {
    const sameEntry = (a: SchoolEntry, b: SchoolEntry) =>
      sameSchool(a.school, b.school) &&
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
    // title is worded, or one title worded two ways ("Editor, Writer" and
    // "Editor and Writer": every word of one in the other, `sameLabel`)
    // with the same start year when both sides have one. A second round
    // wrote "Associate" for a saved "Associate, Restructuring Group" that
    // started the same month (2026-09-26), and of 2,646 simulated second
    // rounds, 0.66 a round added a reworded title again (2026-10-05).
    // "Research Assistant" and "Teaching Assistant" stay two, and so do two
    // titles with different start years.
    const month = (d?: string | null) =>
      d && d.length >= 7 ? d.slice(0, 7) : "";
    const sameJob = (a: JobEntry, b: JobEntry) =>
      sameOrg(a.company, b.company) &&
      ((month(a.startDate) !== "" &&
        month(a.startDate) === month(b.startDate)) ||
        ((textKey(a.role) === textKey(b.role) ||
          sameLabel(a.role ?? "", b.role ?? "")) &&
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

  // ── Attributes: one entry per kind, and research's own kind gains items ──
  // An attribute holds a list of one kind ("Publications": "A; B"). A
  // second round used to skip a kind the contact had, list and all: 2.1 new
  // items a round were lost (2026-10-05). Now a kind an earlier run added
  // gains the items it lacks, each once (`sameItem`), through the upsert in
  // insertChildRecords. A kind the person wrote is theirs, and stays as it
  // is. A kind or an item research added and the person removed is not
  // added back.
  const appendedItems = new Map<string, string[]>();
  if (
    Array.isArray(searchResult.attributes) &&
    searchResult.attributes.length > 0
  ) {
    const kindsAdded = new Set(
      before("attributes").map((e) => e.value.toLowerCase()),
    );
    const kept: NonNullable<typeof searchResult.attributes> = [];
    for (const attribute of searchResult.attributes) {
      const saved = existing.attributes.find(
        (entry) => entry.name.toLowerCase() === attribute.name.toLowerCase(),
      );
      if (!saved) {
        if (!kindsAdded.has(attribute.name.toLowerCase())) kept.push(attribute);
        continue;
      }
      if (!kindsAdded.has(saved.name.toLowerCase())) continue;
      const have = listItems(saved.value);
      const removedItems = before("attributeItems")
        .filter(
          (entry) =>
            entry.value.toLowerCase() === saved.name.toLowerCase() &&
            !!entry.detail &&
            !have.some((item) => sameItem(item, entry.detail!)),
        )
        .map((entry) => entry.detail!);
      const fresh = listItems(attribute.value).filter(
        (item) =>
          !have.some((other) => sameItem(other, item)) &&
          !removedItems.some((gone) => sameItem(gone, item)),
      );
      const value = clipList([...have, ...fresh].join("; "));
      const fits = fresh.filter((item) => listItems(value).includes(item));
      if (fits.length === 0) continue;
      kept.push({ name: saved.name, value });
      appendedItems.set(saved.name, fits);
    }
    childData.attributes = kept;
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
    ...(childData.attributes ?? []).flatMap((a) =>
      appendedItems.has(a.name)
        ? appendedItems
            .get(a.name)!
            .map((item) => addedEntry("attributeItems", a.name, item))
        : [addedEntry("attributes", a.name, a.value)],
    ),
    ...(childData.addresses ?? []).map((a) =>
      addedEntry("addresses", entryText(a, "address")),
    ),
    // A field's value too, so "Not this person" can take it back.
    ...Object.entries(scalarUpdate).map(([field, value]) =>
      addedEntry(field, String(value)),
    ),
  ]
    .filter((entry) => entry.value)
    .map((entry) => ({ ...entry, at: runAt }));

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
      at: runAt,
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

// =============================================================================
// Not this person
// =============================================================================

/** The child tables a run's entries can live in, by field. */
const ENTRY_TABLES: Record<string, string> = {
  emails: "contact_emails",
  phones: "contact_phones",
  socialLinks: "contact_social_links",
  education: "contact_education",
  experience: "contact_experience",
  tags: "contact_tags",
  interests: "contact_interests",
  addresses: "contact_addresses",
};

/** Text compared as research wrote it: trimmed, without case. */
const sameText = (a?: string | null, b?: string | null) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * The saved rows an entry names, as research wrote them. A row the person
 * edited since reads differently, and is not one of them.
 */
function rowsFor(
  contact: HydratedContact,
  entry: ResearchAddedEntry,
): string[] {
  const digits = (value: string) => value.replace(/\D/g, "");
  const url = (value: string) => value.toLowerCase().replace(/\/$/, "");
  const date = (value?: string | null) => (value ?? "").slice(0, 20);
  switch (entry.field) {
    case "emails":
      return contact.emails
        .filter((row) => sameText(row.email, entry.value))
        .map((row) => row.id);
    case "phones":
      return contact.phones
        .filter((row) => digits(row.phone) === digits(entry.value))
        .map((row) => row.id);
    case "socialLinks":
      return contact.socialLinks
        .filter((row) => url(row.url) === url(entry.value))
        .map((row) => row.id);
    case "education":
      return contact.education
        .filter(
          (row) =>
            sameText(row.school.slice(0, 300), entry.value) &&
            sameText(row.degree?.slice(0, 200), entry.detail) &&
            date(row.endDate) === date(entry.date),
        )
        .map((row) => row.id);
    case "experience":
      return contact.experience
        .filter(
          (row) =>
            sameText(row.company.slice(0, 300), entry.value) &&
            sameText(row.role?.slice(0, 200), entry.detail) &&
            date(row.startDate) === date(entry.date),
        )
        .map((row) => row.id);
    case "tags":
      return contact.tags
        .filter((row) => sameText(row.tag, entry.value))
        .map((row) => row.id);
    case "interests":
      return contact.interests
        .filter((row) => sameText(row.interest, entry.value))
        .map((row) => row.id);
    case "addresses":
      return contact.addresses
        .filter((row) => sameText(row.address.slice(0, 300), entry.value))
        .map((row) => row.id);
    default:
      return [];
  }
}

/**
 * Take back what one research run added, because it found someone else.
 *
 * Every entry the run added that the contact still has as research wrote it
 * goes: a row or a field the person edited since reads differently and
 * stays, and so does anything they added themselves. The run is marked
 * `rejected`, its fact lines go, and its pages move to `rejectedSources`,
 * which later runs leave out with the passages they back. The run's entries
 * stay in the record, so research never adds them back.
 *
 * @param scope - The account that owns the contact.
 * @param contactId - The contact researched.
 * @param runAt - The run, by its `at`.
 * @returns How many fields, entries and list items were taken back.
 * @throws AppError 404 when the contact has no such run, or it was marked
 *   already, and 409 while research runs for the contact.
 */
export function rejectResearchRun(
  scope: Scope,
  contactId: string,
  runAt: string,
): { removed: number } {
  const release = lockEnrichment(contactId);
  try {
    const contact = enrichmentContact(scope, contactId);
    const record = parseResearchRecord(contact.aiResearch);
    const run = record?.runs.find((entry) => entry.at === runAt);
    if (!record || !run || run.rejected)
      throw new AppError("That research run is not on this contact.", 404, {
        code: "RESEARCH_RUN_NOT_FOUND",
      });
    const entries = (record.addedEntries ?? []).filter(
      (entry) => entry.at === runAt,
    );

    const rows: Array<{ table: string; id: string }> = [];
    const attributeValues = new Map<string, string | null>();
    const cleared: string[] = [];
    for (const entry of entries) {
      const table = ENTRY_TABLES[entry.field];
      if (table) {
        for (const id of rowsFor(contact, entry)) rows.push({ table, id });
        continue;
      }
      if (entry.field === "attributes" || entry.field === "attributeItems") {
        const saved = contact.attributes.find((row) =>
          sameText(row.name, entry.value),
        );
        if (!saved || !entry.detail) continue;
        const current = attributeValues.has(saved.id)
          ? attributeValues.get(saved.id)
          : saved.value;
        if (current == null) continue;
        // The items this run wrote: the list it made, or one item it added.
        // An item another run added, or one the person changed, stays.
        const gone =
          entry.field === "attributes"
            ? listItems(entry.detail)
            : [entry.detail];
        const items = listItems(current);
        const left = items.filter(
          (item) => !gone.some((other) => sameItem(other, item)),
        );
        if (left.length < items.length)
          attributeValues.set(
            saved.id,
            left.length > 0 ? left.join("; ") : null,
          );
        continue;
      }
      const value = contact[entry.field as keyof HydratedContact];
      if (
        (RESEARCH_SCALARS as readonly string[]).includes(entry.field) &&
        typeof value === "string" &&
        value.slice(0, 300) === entry.value
      )
        cleared.push(entry.field);
    }

    const pages = record.sources.filter(
      (source) => source.firstSeenAt === runAt,
    );
    const next: ResearchRecord = {
      ...record,
      runs: record.runs.map((entry) =>
        entry.at === runAt ? { ...entry, rejected: true, findings: [] } : entry,
      ),
      sources: record.sources.filter((source) => source.firstSeenAt !== runAt),
      rejectedSources: [
        ...new Set([
          ...(record.rejectedSources ?? []),
          ...pages.map((source) => source.url),
        ]),
      ].slice(-MAX_RESEARCH_SOURCES),
    };
    const checked = researchRecordSchema.parse(next);

    const removed = rows.length + attributeValues.size + new Set(cleared).size;
    const write = sqlite.transaction(() => {
      for (const { table, id } of rows)
        sqlite
          .prepare(`DELETE FROM ${table} WHERE id = ? AND contactId = ?`)
          .run(id, contactId);
      for (const [id, value] of attributeValues)
        if (value === null)
          sqlite
            .prepare(
              "DELETE FROM contact_attributes WHERE id = ? AND contactId = ?",
            )
            .run(id, contactId);
        else
          sqlite
            .prepare(
              "UPDATE contact_attributes SET value = ? WHERE id = ? AND contactId = ?",
            )
            .run(value, id, contactId);
      // A pin the geocoder placed from a location that goes, goes with it.
      // One a person dragged into place stays.
      const fields = [...new Set(cleared)].map((field) => `${field} = NULL`);
      if (cleared.includes("location"))
        fields.push(
          "lat = CASE WHEN geoSource = 'manual' THEN lat END",
          "lng = CASE WHEN geoSource = 'manual' THEN lng END",
        );
      sqlite
        .prepare(
          `UPDATE contacts SET ${[...fields, "aiResearch = ?", "updatedAt = ?"].join(", ")}
             WHERE id = ? AND ownerId = ?`,
        )
        .run(
          JSON.stringify(checked),
          new Date().toISOString(),
          contactId,
          scope.ownerId,
        );
    });
    write();

    aiCache.invalidateForOwner("rerank", scope.ownerId);
    aiCache.invalidateForOwner("synthesis", scope.ownerId);
    aiCache.invalidate("briefing", ownerKey(scope, contactId));
    scheduleSearchIndex(contactId);
    log.info(
      "MergeEngine",
      `Contact ${contactId}: run ${runAt} marked as someone else; ${removed} taken back, ${pages.length} pages left out from now on`,
    );
    return { removed };
  } finally {
    release();
  }
}
