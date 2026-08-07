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
// - Invalidates semantic search cache after merge
//
// PERF: FTS triggers fire per-row within the transaction. This is acceptable
// for V1 (~0.1ms per trigger fire with prepared statements). The transaction
// reduces WAL sync overhead but does not collapse trigger count.
// =============================================================================

import { sqlite } from "../../db.ts";
import { sanitizeAiOutputValue } from "../../ai/promptSafety.ts";
import { contactRepo } from "../../repositories/contactRepository.ts";
import { invalidateSearchCache } from "../../utils/aiCache.ts";
import type {
  HydratedContact,
  ChildRecordsPayload,
} from "../../repositories/types.ts";
import type { AISearchOutput } from "./promptTemplate.ts";
import { log } from "../../utils/logger.ts";

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
]);

// =============================================================================
// Merge Function
// =============================================================================

export function mergeSearchResult(
  contactId: string,
  existing: HydratedContact,
  searchResult: AISearchOutput,
): number {
  let fieldsUpdated = 0;
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
    }
  }

  // 1b. aiBackground (dossier) — synthesize a clean markdown brief from extraction
  if (!existing.aiBackground) {
    const dossier = synthesizeDossier(existing, searchResult);
    if (dossier) {
      const safeDossier = sanitizeAiOutputValue(dossier, 12_000);
      if (safeDossier !== null) {
        scalarUpdate["aiBackground"] = safeDossier;
        fieldsUpdated++;
      }
    }
  }

  // 2. Array fields — build child payload, filtering out duplicates
  const childData: ChildRecordsPayload = {};

  // ── Emails: deduplicate by email (case-insensitive) ──────────────
  if (Array.isArray(searchResult.emails) && searchResult.emails.length > 0) {
    const existingEmails = new Set(
      existing.emails.map((e) => e.email.toLowerCase()),
    );
    childData.emails = searchResult.emails.filter(
      (e) => e.email && !existingEmails.has(e.email.toLowerCase()),
    );
    fieldsUpdated += childData.emails.length;
  }

  // ── Phones: deduplicate by phone (normalized — digits only) ──────
  if (Array.isArray(searchResult.phones) && searchResult.phones.length > 0) {
    const normalize = (p: string) => p.replace(/\D/g, "");
    const existingPhones = new Set(
      existing.phones.map((p) => normalize(p.phone)),
    );
    childData.phones = searchResult.phones.filter(
      (p) => p.phone && !existingPhones.has(normalize(p.phone)),
    );
    fieldsUpdated += childData.phones.length;
  }

  // ── Social Links: deduplicate by URL (normalized) ────────────────
  if (
    Array.isArray(searchResult.socialLinks) &&
    searchResult.socialLinks.length > 0
  ) {
    const normalizeUrl = (u: string) => u.toLowerCase().replace(/\/$/, "");
    const existingUrls = new Set(
      existing.socialLinks.map((s) => normalizeUrl(s.url)),
    );
    childData.socialLinks = searchResult.socialLinks.filter(
      (s) => s.url && !existingUrls.has(normalizeUrl(s.url)),
    );
    fieldsUpdated += childData.socialLinks.length;
  }

  // ── Education: deduplicate by school + degree ────────────────────
  if (
    Array.isArray(searchResult.education) &&
    searchResult.education.length > 0
  ) {
    const existingEdu = new Set(
      existing.education.map(
        (e) =>
          `${(e.school || "").toLowerCase()}|${(e.degree || "").toLowerCase()}`,
      ),
    );
    childData.education = searchResult.education.filter(
      (e) =>
        e.school &&
        !existingEdu.has(
          `${e.school.toLowerCase()}|${(e.degree || "").toLowerCase()}`,
        ),
    );
    fieldsUpdated += childData.education.length;
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
    const existingExpFull = new Set(
      existing.experience.map(
        (e) =>
          `${(e.company || "").toLowerCase()}|${(e.role || "").toLowerCase()}|${getYear(e.startDate)}`,
      ),
    );
    // Loose key: company + role only (for entries without startDate)
    const existingExpLoose = new Set(
      existing.experience.map(
        (e) =>
          `${(e.company || "").toLowerCase()}|${(e.role || "").toLowerCase()}`,
      ),
    );
    childData.experience = searchResult.experience
      .filter((e) => {
        if (!e.company) return false;
        const looseKey = `${e.company.toLowerCase()}|${(e.role || "").toLowerCase()}`;
        const fullKey = `${looseKey}|${getYear(e.startDate)}`;
        // If the incoming entry has no startDate, use loose matching
        if (!e.startDate) return !existingExpLoose.has(looseKey);
        // Otherwise, use full matching (company + role + year)
        return !existingExpFull.has(fullKey);
      })
      // Sanitize: strip the literal string "null" from date fields.
      // LLMs sometimes return "null" as a string instead of omitting the field.
      .map((e) => ({
        ...e,
        startDate:
          e.startDate && e.startDate !== "null" ? e.startDate : undefined,
        endDate: e.endDate && e.endDate !== "null" ? e.endDate : undefined,
      }));
    fieldsUpdated += childData.experience.length;
  }

  // ── Tags: deduplicate by tag (exact match) ───────────────────────
  if (Array.isArray(searchResult.tags) && searchResult.tags.length > 0) {
    const existingTags = new Set(
      (existing.tags || []).map((t) => t.tag.toLowerCase()),
    );
    childData.tags = searchResult.tags
      .filter((t) => t.tag && !existingTags.has(t.tag.toLowerCase()))
      .map((t) => ({ tag: t.tag }));
    fieldsUpdated += childData.tags.length;
  }

  // ── Interests: upsert via ON CONFLICT (handled by insertChildRecords) ──
  // Force isAiGenerated: true — all interests from AI Search are AI-generated
  // by definition. Don't rely on the LLM to set this flag correctly.
  if (
    Array.isArray(searchResult.interests) &&
    searchResult.interests.length > 0
  ) {
    childData.interests = searchResult.interests.map((i) => ({
      interest: i.interest,
      isAiGenerated: true,
    }));
    fieldsUpdated += childData.interests.length;
  }

  // ── Attributes: upsert via ON CONFLICT (handled by insertChildRecords) ──
  if (
    Array.isArray(searchResult.attributes) &&
    searchResult.attributes.length > 0
  ) {
    childData.attributes = searchResult.attributes;
    fieldsUpdated += childData.attributes.length;
  }

  // ── Addresses: deduplicate by address string (case-insensitive) ──
  if (
    Array.isArray(searchResult.addresses) &&
    searchResult.addresses.length > 0
  ) {
    const existingAddrs = new Set(
      (existing.addresses || []).map((a) => a.address.toLowerCase()),
    );
    childData.addresses = searchResult.addresses.filter(
      (a) => a.address && !existingAddrs.has(a.address.toLowerCase()),
    );
    fieldsUpdated += childData.addresses.length;
  }

  // 3. TRANSACTION: Apply all mutations atomically
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
          `UPDATE contacts SET ${setClauses}, updatedAt = ? WHERE id = ?`,
        )
        .run(...values, new Date().toISOString(), contactId);
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
      .prepare("UPDATE contacts SET aiHydratedAt = ? WHERE id = ?")
      .run(new Date().toISOString(), contactId);
  });
  txn();

  // Invalidate the semantic search cache so updated data is searchable
  invalidateSearchCache();

  log.info(
    "MergeEngine",
    `Contact ${contactId}: ${fieldsUpdated} field(s) merged`,
  );
  return fieldsUpdated;
}

// =============================================================================
// Dossier Synthesis
// =============================================================================
// Generates a clean, human-readable markdown dossier from the structured
// extraction result. This is what appears in the "AI Dossier" card on the
// contact detail page — rendered via ReactMarkdown.
//
// Design: Combine new findings with existing contact data to produce the
// richest possible brief. Only include sections that have content.
// =============================================================================

function synthesizeDossier(
  existing: HydratedContact,
  searchResult: AISearchOutput,
): string | null {
  const name = existing.name || "This contact";
  const sections: string[] = [];

  // ── Professional Summary ───────────────────────────────────────────
  const about = searchResult.about || existing.about;
  const headline = searchResult.headline || existing.headline;
  if (about) {
    sections.push(about);
  } else if (headline) {
    sections.push(`${name} is ${headline}.`);
  }

  // ── Industry & Location ────────────────────────────────────────────
  const industry = searchResult.industry || existing.industry;
  const location = searchResult.location || existing.location;
  if (industry || location) {
    const parts: string[] = [];
    if (industry) parts.push(`**Industry:** ${industry}`);
    if (location) parts.push(`**Location:** ${location}`);
    sections.push(parts.join("  \n"));
  }

  // ── Career Highlights ──────────────────────────────────────────────
  const experience = searchResult.experience?.length
    ? searchResult.experience
    : existing.experience;
  if (experience && experience.length > 0) {
    const lines = experience.map((exp) => {
      const current = exp.isCurrent ? " *(Current)*" : "";
      const dates = formatDateRange(exp.startDate, exp.endDate, exp.isCurrent);
      const loc = exp.location ? ` · ${exp.location}` : "";
      let line = `- **${exp.role || "Role"}** at ${exp.company}${current}`;
      if (dates || loc) line += `  \n  ${dates}${loc}`;
      if (exp.description) line += `  \n  ${exp.description}`;
      return line;
    });
    sections.push(`### Career\n${lines.join("\n")}`);
  }

  // ── Education ──────────────────────────────────────────────────────
  const education = searchResult.education?.length
    ? searchResult.education
    : existing.education;
  if (education && education.length > 0) {
    const lines = education.map((edu) => {
      const field = edu.fieldOfStudy ? ` in ${edu.fieldOfStudy}` : "";
      const dates = formatDateRange(edu.startDate, edu.endDate);
      let line = `- **${edu.degree || "Degree"}**${field} — ${edu.school}`;
      if (dates) line += ` (${dates})`;
      return line;
    });
    sections.push(`### Education\n${lines.join("\n")}`);
  }

  // ── Notable Details (attributes) ──────────────────────────────────
  if (searchResult.attributes && searchResult.attributes.length > 0) {
    const lines = searchResult.attributes.map(
      (a) => `- **${a.name}:** ${a.value}`,
    );
    sections.push(`### Notable\n${lines.join("\n")}`);
  }

  // ── Interests ──────────────────────────────────────────────────────
  const interests = searchResult.interests?.length
    ? searchResult.interests.map((i) => i.interest || i)
    : existing.interests?.map((i) => i.interest);
  if (interests && interests.length > 0) {
    sections.push(`### Interests\n${interests.join(" · ")}`);
  }

  // Only produce a dossier if we have at least one substantive section
  if (sections.length === 0) return null;

  return sections.join("\n\n");
}

/** Format a date range, handling null/"null" sentinel values */
function formatDateRange(
  start?: string | null,
  end?: string | null,
  isCurrent?: boolean,
): string {
  const s = start && start !== "null" ? start : "";
  const e = end && end !== "null" ? end : isCurrent ? "Present" : "";
  if (s && e) return `${s} – ${e}`;
  if (s) return `${s} – Present`;
  if (e && e !== "Present") return `Until ${e}`;
  return "";
}
