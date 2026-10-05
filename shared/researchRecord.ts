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
//   addedEntries  every entry research added, and the run that added it, so
//                 that it never adds back one the person removed, and a run
//                 marked "Not this person" can take back what it added
//   rejectedSources  the pages of runs marked "Not this person", which later
//                 runs leave out
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

/**
 * True for an absolute http or https address.
 *
 * The dossier renders every cited address as a link. The addresses come from
 * a provider's grounding metadata and from redirects it resolved, so nothing
 * but this check stands between a `javascript:` or `data:` address and an
 * anchor on the page.
 */
function isWebUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const webUrl = z
  .string()
  .max(2000)
  .refine(isWebUrl, "Expected an absolute http or https address");

/** One page a run cited. */
const researchSourceSchema = z.object({
  url: webUrl,
  title: z.string().max(300),
  /** When a run first cited it. */
  firstSeenAt: z.string().max(40),
});

/**
 * The record's sources, without any that do not parse.
 *
 * One page with a bad address must not cost the whole record: the dossier
 * would lose every run, and the next enrichment would start a fresh record
 * as if none had happened. A source is only an address and its title, so a
 * bad one is dropped and the rest stay.
 */
const researchSourcesSchema = z.preprocess(
  (value) =>
    Array.isArray(value)
      ? value.filter((entry) => researchSourceSchema.safeParse(entry).success)
      : value,
  z.array(researchSourceSchema).max(MAX_RESEARCH_SOURCES),
);

/**
 * One fact the search pass reported, as it wrote it:
 * "Past role: Associate, Harbor Point Partners, 2018 to 2020 [finra.org]".
 */
const researchFindingSchema = z.object({
  topic: z.string().max(60),
  text: z.string().max(600),
  /** The site the search pass named for the fact, when it named one. */
  site: z.string().max(200).optional(),
  /**
   * The page the provider says backs the fact, when it says one. A bad
   * address reads as none: the fact itself is still worth showing.
   */
  url: webUrl.optional().catch(undefined),
});

/** How many entries one run added to one field: education, 2. */
const researchAdditionSchema = z.object({
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
const researchUsageSchema = z.object({
  calls: z.number().int().nonnegative(),
  searches: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

const researchRunSchema = z.object({
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
  /**
   * The person said this run found someone else. What it added was taken
   * back, and its pages are left out of later runs (`rejectedSources`).
   */
  rejected: z.boolean().optional(),
});

/**
 * One entry a run added to a list field, in the words the merge compares:
 * "education", "University of Example", "BA", "2017".
 */
const researchAddedEntrySchema = z.object({
  field: z.string().max(40),
  /** The school, the employer, the address, the email, the tag or the name. */
  value: z.string().max(300),
  /**
   * A school's degree, a job's role, a list item, or the whole list a run
   * made for an attribute (up to an attribute's 2,000 characters).
   */
  detail: z.string().max(2000).optional(),
  /** A school's end date, or a job's start date. */
  date: z.string().max(20).optional(),
  /** The run that added it (`ResearchRun.at`). Absent on older records. */
  at: z.string().max(40).optional(),
});

export const researchRecordSchema = z.object({
  version: z.literal(1),
  runs: z.array(researchRunSchema).max(MAX_RESEARCH_RUNS),
  sources: researchSourcesSchema,
  /**
   * Every entry research added, newest last. One that the contact no longer
   * has, the person removed, and research does not add it back. Absent on
   * records written before it was kept.
   */
  addedEntries: z
    .array(researchAddedEntrySchema)
    .max(MAX_ADDED_ENTRIES)
    .optional(),
  /**
   * The pages of runs the person marked "Not this person". Later runs drop
   * them and the facts they back. A bad address is dropped, like a source's.
   */
  rejectedSources: z
    .preprocess(
      (value) =>
        Array.isArray(value)
          ? value.filter((entry) => webUrl.safeParse(entry).success)
          : value,
      z.array(webUrl).max(MAX_RESEARCH_SOURCES),
    )
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
 *
 * A bad address is not a reason to lose the record. A source whose address
 * is not http or https is dropped, and a finding's bad address reads as
 * none. The enrichment merge writes through the same schema, so a bad
 * address from a new run is dropped the same way before it is stored.
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
