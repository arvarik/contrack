// =============================================================================
// AI Search — Normalization
// =============================================================================
// How research output is compared and tidied, in one place for the parser
// and the merge engine:
//
//   orgKey / sameOrg  one employer or school, however a page writes it
//   textKey           text compared without case or punctuation
//   degreeLevel       one degree, however a page names it: "AB" is a "BA"
//   sameLabel         one interest or tag, however a page words it
//   researchDate      a date as the dossier stores it: "YYYY" or "YYYY-MM"
// =============================================================================

/**
 * One employer or school, however a page writes it: "Northwind Partners, LP"
 * and "Northwind Partners" are one firm, "The University of Example" and
 * "University of Example" one school.
 */
export function orgKey(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(the|inc|incorporated|llc|lp|llp|ltd|limited|co|corp|corporation|company|plc|gmbh|ag|sa)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when two names are one organization: the same key, or one key the
 * start of the other ("kestrel" and "kestrel securities international").
 */
export function sameOrg(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const x = orgKey(a);
  const y = orgKey(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `);
}

/** Text compared without case or punctuation. */
export function textKey(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Degree names by level, the Latin order ("AB", "SB") with the English, on
 * text as textKey writes it. The first match wins, so medicine and law come
 * before the doctorate and the master that would also match them.
 */
const DEGREE_LEVELS: Array<[level: string, pattern: RegExp]> = [
  ["medicine", /^(?:m ?d|doctor of medicine)\b/],
  ["law", /^(?:j ?d|juris doctor|ll ?m|ll ?b)\b/],
  ["doctorate", /^(?:ph ?d|d ?phil|ed ?d|doctor(?:ate)?)\b/],
  ["master", /^(?:m ?b ?a|m ?[a-z]{1,3}|a ?m|s ?m|master(?:s|'s)?)\b/],
  ["bachelor", /^(?:b ?[a-z]{1,3}|a ?b|s ?b|bachelor(?:s|'s)?)\b/],
  ["associate", /^(?:a ?a|a ?s|a ?a ?s|associate)\b/],
  ["school", /^(?:high school|secondary|diploma|ged)\b/],
];

/**
 * One degree, however a page names it: "AB", "B.A." and "Bachelor of Arts
 * in Economics" are all "bachelor". A name no level matches is compared as
 * written.
 */
export function degreeLevel(value: string | null | undefined): string {
  const text = textKey(value);
  if (!text) return "";
  const found = DEGREE_LEVELS.find(([, pattern]) => pattern.test(text));
  return found ? found[0] : text;
}

const LABEL_FILLER = new Set(["and", "of", "the", "in", "for", "a", "an"]);

/** A label's words cut to five letters, so "producer" meets "production". */
function labelStems(value: string): Set<string> {
  return new Set(
    textKey(value)
      .split(" ")
      .filter((word) => word && !LABEL_FILLER.has(word))
      .map((word) => word.slice(0, 5)),
  );
}

/**
 * True when two interests or tags say one thing: every word of the shorter
 * one is in the longer. "Distance running" and "Distance running coach" are
 * one interest; "Machine learning" and "Machine vision" are two.
 */
export function sameLabel(a: string, b: string): boolean {
  const x = labelStems(a);
  const y = labelStems(b);
  if (x.size === 0 || y.size === 0) return false;
  const [shorter, longer] = x.size <= y.size ? [x, y] : [y, x];
  return [...shorter].every((stem) => longer.has(stem));
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/**
 * A research date as the dossier stores it, or undefined.
 *
 * "2018", "2018-1", "2018-01-15", "2018-01-15T00:00:00Z", "Jan 2018",
 * "January 2018" and "1/2018" all read; "Present" and anything else do not,
 * because the dossier would print it as written. A model wrote
 * "2023-08-01T00:00:00.000Z-05:00 to 2025-05-01…" into one field, and
 * "2023-08" followed by a stray character into another (2026-09-26).
 */
export function researchDate(
  value: string | null | undefined,
): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const pad = (month: number) => String(month).padStart(2, "0");
  let match = /^(\d{4})(?:-(\d{1,2})(?:-\d{1,2}(?:T[\d:.]+Z?)?)?)?$/.exec(text);
  if (match) {
    const month = match[2] ? Number(match[2]) : 0;
    if (month > 12) return undefined;
    return month ? `${match[1]}-${pad(month)}` : match[1];
  }
  match = /^([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(text);
  if (match) {
    const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
    return month ? `${match[2]}-${pad(month)}` : undefined;
  }
  match = /^(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) {
    const month = Number(match[1]);
    return month >= 1 && month <= 12 ? `${match[2]}-${pad(month)}` : undefined;
  }
  return undefined;
}
