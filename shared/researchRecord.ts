// =============================================================================
// Contact research record — what enrichment read and what it added
// =============================================================================
// Stored as JSON in `contacts.aiResearch`, written only by the enrichment
// merge, and read by the dossier's Research card. One record per contact:
//
//   runs          every enrichment, newest last: when, which models, what it
//                 added field by field, the searches it ran and the facts it
//                 reported
//   sources       every page the runs cited, deduplicated by address
//   addedEntries  every list entry research added, so that it never adds
//                 back one the person removed
//
// The dossier used to carry this as markdown inside `aiBackground`: the
// sources as "Source 1", "Source 2" links to Google redirects, and a copy of
// the about, career and education cards. Structured, the card can say where
// each fact came from, and a second enrichment adds to the record instead of
// being dropped because a dossier already existed.
// =============================================================================

import { z } from "zod";
import { researchDepthSchema } from "./researchDepth.ts";

/** Runs kept per contact. Older runs drop off the front. */
export const MAX_RESEARCH_RUNS = 12;
/** Sources kept per contact, across runs. */
export const MAX_RESEARCH_SOURCES = 60;
/** Entries research added, kept per contact across runs, newest last. */
export const MAX_ADDED_ENTRIES = 150;

/** One page a run cited. */
export const researchSourceSchema = z.object({
  url: z.string().max(2000),
  title: z.string().max(300),
  /** When a run first cited it. */
  firstSeenAt: z.string().max(40),
});

/**
 * One fact the search pass reported, as it wrote it:
 * "Past role: Associate, Harbor Point Partners, 2018 to 2020 [finra.org]".
 */
export const researchFindingSchema = z.object({
  topic: z.string().max(60),
  text: z.string().max(600),
  /** The site the search pass named for the fact, when it named one. */
  site: z.string().max(200).optional(),
  /** The page the provider says backs the fact, when it says one. */
  url: z.string().max(2000).optional(),
});

/** How many entries one run added to one field: education, 2. */
export const researchAdditionSchema = z.object({
  field: z.string().max(40),
  count: z.number().int().positive(),
});

/**
 * One enrichment.
 *
 * `outcome` is what the person reads first: it added details, it read pages
 * but everything on them was already known, or no page matched the person.
 */
/**
 * What a run spent: the web searches the provider reported, and the tokens
 * of every call, thinking included. Gemini does not always report the
 * searches of a pass that found nothing, so the count can be low.
 */
export const researchUsageSchema = z.object({
  calls: z.number().int().nonnegative(),
  searches: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

export const researchRunSchema = z.object({
  at: z.string().max(40),
  models: z.array(z.string().max(120)).max(4),
  /** Absent on runs recorded before there were two depths. */
  depth: researchDepthSchema.optional(),
  usage: researchUsageSchema.optional(),
  outcome: z.enum(["added", "nothing-new", "no-public-info"]),
  added: z.array(researchAdditionSchema).max(30),
  sourceCount: z.number().int().nonnegative(),
  queries: z.array(z.string().max(300)).max(24),
  findings: z.array(researchFindingSchema).max(80),
});

/**
 * One entry a run added to a list field, in the words the merge compares:
 * "education", "University of Example", "BA", "2017".
 */
export const researchAddedEntrySchema = z.object({
  field: z.string().max(40),
  /** The school, the employer, the address, the email, the tag or the name. */
  value: z.string().max(300),
  /** A school's degree, or a job's role. */
  detail: z.string().max(200).optional(),
  /** A school's end date, or a job's start date. */
  date: z.string().max(20).optional(),
});

export const researchRecordSchema = z.object({
  version: z.literal(1),
  runs: z.array(researchRunSchema).max(MAX_RESEARCH_RUNS),
  sources: z.array(researchSourceSchema).max(MAX_RESEARCH_SOURCES),
  /**
   * Every entry research added, newest last. One that the contact no longer
   * has, the person removed, and research does not add it back. Absent on
   * records written before it was kept.
   */
  addedEntries: z
    .array(researchAddedEntrySchema)
    .max(MAX_ADDED_ENTRIES)
    .optional(),
});

export type ResearchSource = z.infer<typeof researchSourceSchema>;
export type ResearchFinding = z.infer<typeof researchFindingSchema>;
export type ResearchAddition = z.infer<typeof researchAdditionSchema>;
export type ResearchAddedEntry = z.infer<typeof researchAddedEntrySchema>;
export type ResearchRun = z.infer<typeof researchRunSchema>;
export type ResearchUsage = z.infer<typeof researchUsageSchema>;
export type ResearchRecord = z.infer<typeof researchRecordSchema>;
export type ResearchOutcome = ResearchRun["outcome"];

/**
 * The record in a stored value, or null.
 *
 * The column is JSON text, and a value that does not parse or match is read
 * as no record rather than thrown on: the dossier still renders, and the next
 * enrichment writes a fresh record.
 */
export function parseResearchRecord(value: unknown): ResearchRecord | null {
  if (value == null || value === "") return null;
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const parsed = researchRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * The site part of an address, for display and for matching a finding's
 * "[finra.org]" to a source: "files.brokercheck.finra.org".
 */
export function siteOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The source a finding names, if any.
 *
 * The search pass names a site loosely: "finra.org" for a page on
 * brokercheck.finra.org, or "LinkedIn" for linkedin.com. A source matches
 * when its host is the named site, ends with it, or starts with its first
 * label.
 */
export function sourceForSite(
  site: string | undefined,
  sources: readonly ResearchSource[],
): ResearchSource | null {
  const named = site
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  if (!named) return null;
  const label = named.split(".")[0];
  let loose: ResearchSource | null = null;
  for (const source of sources) {
    const host = siteOf(source.url);
    if (!host) continue;
    if (host === named || host.endsWith(`.${named}`)) return source;
    if (!loose && label.length >= 3 && host.split(".").includes(label))
      loose = source;
  }
  return loose;
}

/**
 * The dossier the enrichment merge wrote until 2026-09-26: a copy of the
 * about, career and education cards, and its sources as "Source 1" links to
 * Google redirects. The dossier tab builds those parts from the fields
 * themselves, and the next enrichment replaces this text with a record.
 */
export function isLegacyDossier(text: string | null | undefined): boolean {
  return !!text && /\n### Sources\n- \[Source 1\]\(</.test(text);
}
