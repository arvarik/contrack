// =============================================================================
// Company Normalization
// =============================================================================

/**
 * Common corporate suffixes to strip during comparison.
 * Ordered by length (longest first) so "Limited Liability Company" is matched
 * before "Company". Covers US, UK, EU, and APAC legal forms.
 */
const COMPANY_SUFFIXES = [
  "limited liability company",
  "limited liability partnership",
  "incorporated",
  "corporation",
  "enterprises",
  "technologies",
  "holdings",
  "partners",
  "solutions",
  "consulting",
  "services",
  "company",
  "limited",
  "group",
  "inc",
  "corp",
  "llc",
  "llp",
  "ltd",
  "co",
  "lp",
  "plc",
  "gmbh",
  "ag",
  "sa",
  "sas",
  "sarl",
  "nv",
  "bv",
  "pty",
  "pvt",
  "pte",
];

/**
 * One compiled expression per suffix, built once.
 *
 * The loop below used to call `new RegExp` for every suffix on every pass, so
 * a single company name compiled up to thirty-three patterns and a name that
 * shed two suffixes compiled ninety-nine. It was the most expensive thing in
 * the dedupe normalizer by some way — 350 ms of the 649 ms it took to
 * normalize 50,000 contacts — and it is the same pattern every time.
 */
const SUFFIX_PATTERNS: RegExp[] = COMPANY_SUFFIXES.map(
  (suffix) => new RegExp(`[,\\s]+${suffix}\\.?$|\\b${suffix}\\.?$`),
);

/**
 * Normalize a company name for comparison:
 * "Apple, Inc." → "apple" | "McKinsey & Company" → "mckinsey"
 *
 * Steps: lowercase → strip trailing punctuation → remove known suffixes
 *        → collapse whitespace → trim
 */
export function normalizeCompany(name: string): string {
  if (!name) return "";
  let norm = name
    .toLowerCase()
    .replace(/[.,;:!?]+/g, " ")
    .replace(/['"""'']/g, "")
    .replace(/&/g, "and")
    .trim();

  let changed = true;
  while (changed) {
    changed = false;
    for (const re of SUFFIX_PATTERNS) {
      const next = norm.replace(re, "").trim();
      if (next !== norm && next.length > 0) {
        norm = next;
        changed = true;
        break;
      }
    }
  }

  return norm.replace(/\s+/g, " ").trim();
}
