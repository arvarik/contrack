import { createHash } from "node:crypto";
import { sqlite } from "../../db.ts";
import { ACTIVE_CONTACT_SQL } from "./ftsIndex.ts";
import { PASSAGE_VERSION } from "./passageIndex.ts";
import { searchTokens, scopedMatch } from "./lexical.ts";
import type { Scope } from "../../tenancy/scope.ts";
import type { CompiledFacets } from "./facetSql.ts";

export interface SearchPassage {
  id: string;
  contactId: string;
  ownerId: string;
  field: "about" | "preferences" | "experience" | "education";
  sourceId: string;
  sourceHash: string;
  context: string;
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface PassageSnapshot {
  ownerId: string;
  fingerprint: string;
  passages: SearchPassage[];
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const CHARS = 480;
const OVERLAP = 80;

/** Exact slices retain offsets and overlap so a boundary cannot lose a short fact. */
export function splitPassage(
  text: string,
): { text: string; startOffset: number; endOffset: number }[] {
  const result = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + CHARS, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end);
      if (boundary > start + CHARS / 2) end = boundary;
      // Keep UTF-16 surrogate pairs together in both slices.
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    if (text.slice(start, end).trim())
      result.push({
        text: text.slice(start, end),
        startOffset: start,
        endOffset: end,
      });
    if (end === text.length) break;
    start = end - OVERLAP;
    if (/[\uDC00-\uDFFF]/.test(text[start])) start++;
  }
  return result;
}

/** Source rows remain authoritative. Raw import payloads never become model instructions. */
export function passageSnapshot(contactId: string): PassageSnapshot | null {
  const contact = sqlite
    .prepare(
      // The caller obtained this id through a scoped contact lookup or the durable index queue.
      // tenant-lint: allow owner-checked by caller
      `SELECT c.ownerId, c.about, c.preferences FROM contacts c WHERE c.id = ? AND ${ACTIVE_CONTACT_SQL}`,
    )
    .get(contactId) as
    | { ownerId: string; about: string | null; preferences: string | null }
    | undefined;
  if (!contact?.ownerId) return null;
  const sources: {
    field: SearchPassage["field"];
    sourceId: string;
    text: string;
    context?: string;
  }[] = [];
  for (const field of ["about", "preferences"] as const) {
    if (contact[field])
      sources.push({ field, sourceId: contactId, text: contact[field] });
  }
  const experience = sqlite
    .prepare("SELECT * FROM contact_experience WHERE contactId = ? ORDER BY id")
    .all(contactId) as {
    id: string;
    company: string;
    role: string | null;
    isCurrent: number | null;
    startDate: string | null;
    endDate: string | null;
    description: string | null;
    location: string | null;
  }[];
  for (const row of experience) {
    // A missing end date does not prove that a job is current.
    const status = row.endDate
      ? "Former employment"
      : row.isCurrent === 1
        ? "Current employment"
        : "Employment, status unknown";
    sources.push({
      field: "experience",
      sourceId: row.id,
      context: [status, row.role, row.company, row.startDate, row.endDate]
        .filter(Boolean)
        .join(" | "),
      text: [
        status,
        row.role,
        row.company,
        row.location,
        row.startDate && `Start: ${row.startDate}`,
        row.endDate && `End: ${row.endDate}`,
        row.description,
      ]
        .filter(Boolean)
        .join(" | "),
    });
  }
  const education = sqlite
    .prepare("SELECT * FROM contact_education WHERE contactId = ? ORDER BY id")
    .all(contactId) as {
    id: string;
    school: string;
    degree: string | null;
    fieldOfStudy: string | null;
    startDate: string | null;
    endDate: string | null;
    description: string | null;
  }[];
  for (const row of education)
    sources.push({
      field: "education",
      sourceId: row.id,
      context: ["Education", row.school, row.degree, row.fieldOfStudy]
        .filter(Boolean)
        .join(" | "),
      text: [
        "Education",
        row.school,
        row.degree,
        row.fieldOfStudy,
        row.startDate,
        row.endDate,
        row.description,
      ]
        .filter(Boolean)
        .join(" | "),
    });
  const passages = sources.flatMap((source) => {
    const sourceHash = hash(source.text);
    return splitPassage(source.text).map((slice) => ({
      ...slice,
      contactId,
      ownerId: contact.ownerId,
      field: source.field,
      sourceId: source.sourceId,
      sourceHash,
      context: source.context ?? source.field,
      id: hash(
        JSON.stringify([
          PASSAGE_VERSION,
          contactId,
          source.field,
          source.sourceId,
          sourceHash,
          slice.startOffset,
        ]),
      ),
    }));
  });
  return {
    ownerId: contact.ownerId,
    fingerprint: hash(
      JSON.stringify([PASSAGE_VERSION, contact.ownerId, sources]),
    ),
    passages,
  };
}

/**
 * Keyword passage retrieval, with ownership, visibility and hard filters
 * applied before its limit. `CROSS JOIN` keeps the full-text match first, with
 * the passage and its contact looked up from each hit; with stale row counts
 * SQLite would scan `contacts` first (see `findPassageNeighbors`).
 */
export function findPassages(
  scope: Scope,
  query: string,
  ids?: Set<string> | null,
  facets?: CompiledFacets | null,
): SearchPassage[] {
  const tokens = searchTokens(query);
  if (!tokens.length || ids?.size === 0) return [];
  return sqlite
    .prepare(
      `
    SELECT p.* FROM search_passages_fts f
    CROSS JOIN search_passages p ON p.rowid = f.rowid
    CROSS JOIN contacts c ON c.id = p.contactId
    WHERE search_passages_fts MATCH ? AND c.ownerId = ? AND p.ownerId = ? AND ${ACTIVE_CONTACT_SQL}
      ${ids ? "AND c.id IN (SELECT value FROM json_each(?))" : ""}
      ${facets ? `AND (${facets.sql})` : ""}
    ORDER BY bm25(search_passages_fts, 1, 0), p.id LIMIT 300
  `,
    )
    .all(
      scopedMatch(scope, tokens.map((token) => `"${token}"`).join(" OR ")),
      scope.ownerId,
      scope.ownerId,
      ...(ids ? [JSON.stringify([...ids])] : []),
      ...(facets?.params ?? []),
    ) as SearchPassage[];
}

/** At most two passages per contact keep verification cost independent of source length. */
export function selectPassages(
  scope: Scope,
  query: string,
  ids: string[],
  semantic: SearchPassage[] = [],
): Map<string, SearchPassage[]> {
  const allowed = new Set(ids);
  const selected = new Map<string, SearchPassage[]>();
  for (const passage of [...findPassages(scope, query, allowed), ...semantic]) {
    if (!allowed.has(passage.contactId) || passage.ownerId !== scope.ownerId)
      continue;
    const rows = selected.get(passage.contactId) ?? [];
    if (rows.length >= 2 || rows.some((row) => row.id === passage.id)) continue;
    // Overlapping copies of one fact must not consume both evidence slots.
    if (
      rows.some(
        (row) =>
          row.sourceId === passage.sourceId &&
          row.field === passage.field &&
          row.startOffset < passage.endOffset &&
          passage.startOffset < row.endOffset,
      )
    )
      continue;
    rows.push(passage);
    selected.set(passage.contactId, rows);
  }
  return selected;
}

/** A citation remains valid only while this owner still owns the exact source revision. */
export function currentPassage(
  scope: Scope,
  contactId: string,
  id: string,
  quote: string,
): SearchPassage | null {
  const passage = sqlite
    .prepare(
      `SELECT p.* FROM search_passages p JOIN contacts c ON c.id = p.contactId
    WHERE p.id = ? AND p.contactId = ? AND p.ownerId = ? AND c.ownerId = ? AND ${ACTIVE_CONTACT_SQL}`,
    )
    .get(id, contactId, scope.ownerId, scope.ownerId) as
    SearchPassage | undefined;
  return passage &&
    passage.text.toLocaleLowerCase().includes(quote.toLocaleLowerCase())
    ? passage
    : null;
}

// TODO(v2.1): Compile explicit current/former employment conditions against the source row identified here.
// Keep date and employer predicates on the same row so unrelated jobs cannot jointly prove one condition.
