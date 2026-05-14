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
    for (const suffix of COMPANY_SUFFIXES) {
      const re = new RegExp(`[,\\s]+${suffix}\\.?$|\\b${suffix}\\.?$`);
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
