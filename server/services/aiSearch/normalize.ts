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
//   sameTitle         one job title worded two ways, never a promotion
//   sameSchool        one school, however a page names its parts
//   listItems / sameItem  the items of a list value, and one item however
//                     a page cuts or numbers it
//   researchDate      a date as the dossier stores it: "YYYY" or "YYYY-MM"
//   linkedInHandle    the profile a LinkedIn address names
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
 * True when two interests, tags or job titles say one thing: every word of
 * the shorter one is in the longer. "Distance running" and "Distance running
 * coach" are one interest, and "Editor, Writer" and "Editor and Writer"
 * one title. "Machine learning" and "Machine vision" are two, and so are
 * "Research Assistant" and "Teaching Assistant".
 */
export function sameLabel(a: string, b: string): boolean {
  const x = labelStems(a);
  const y = labelStems(b);
  if (x.size === 0 || y.size === 0) return false;
  const [shorter, longer] = x.size <= y.size ? [x, y] : [y, x];
  return [...shorter].every((stem) => longer.has(stem));
}

/** A part that names a field, not a school: "School of Engineering". */
const GENERIC_SCHOOL_PART =
  /^(?:the\s+)?(?:graduate\s+)?(?:school|college|faculty|department|division|institute)\s+of\b/i;

/** A unit inside a school, before " at ": "Harbor School of Engineering". */
const SCHOOL_UNIT =
  /\b(?:school|college|faculty|department|division|cent(?:er|re))\b/i;

/**
 * The parts of a school's name. "Harbor School of Engineering at Example
 * University" is its unit and its university, and so is "University of
 * Example - Vale School of Business". A name such as
 * "University of Texas at Austin" is one part: " at " splits only after a
 * unit. A part that names only a field is left out, since many schools have
 * one.
 */
function schoolParts(value: string): string[] {
  return value
    .split(/\s+[-–—|/]\s+|\s*,\s*/)
    .flatMap((part) => {
      const at = part.split(/\s+at\s+/i);
      return at.length === 2 && SCHOOL_UNIT.test(at[0]) ? at : [part];
    })
    .map((part) => part.trim())
    .filter((part) => part && !GENERIC_SCHOOL_PART.test(part));
}

/**
 * True when two school names are one school: one name, as `sameOrg` reads
 * it, or every part of the name with fewer parts in the other, at least one
 * of them the same name. Pages name a school with or without its unit:
 * "Example University" and "Harbor School of Engineering at Example
 * University" are one, and so are two wordings of one unit beside the same
 * university. Two campuses, "University of Example - Riverside" and "-
 * Lakeside", are two, and so are "University of Example" and "Example State
 * University": a unit may be worded two ways, a university may not.
 */
export function sameSchool(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (sameOrg(a, b)) return true;
  const x = schoolParts(a ?? "");
  const y = schoolParts(b ?? "");
  if (x.length === 0 || y.length === 0) return false;
  const [fewer, more] = x.length <= y.length ? [x, y] : [y, x];
  const unit = (part: string) => SCHOOL_UNIT.test(part);
  return (
    fewer.some((part) => more.some((other) => sameOrg(part, other))) &&
    fewer.every((part) =>
      more.some(
        (other) =>
          sameOrg(part, other) ||
          (unit(part) && unit(other) && sameLabel(part, other)),
      ),
    )
  );
}

/** Words of rank in a job title: the step from one job to the next. */
const RANK_STEMS = new Set(
  [
    "senior",
    "sr",
    "junior",
    "jr",
    "lead",
    "principal",
    "staff",
    "chief",
    "head",
    "assistant",
    "associate",
    "deputy",
    "vice",
    "executive",
    "manager",
    "director",
    "intern",
    "trainee",
  ].map((word) => word.slice(0, 5)),
);

/**
 * True when two job titles are one title worded two ways: every word of one
 * is in the other (`sameLabel`), and no word between them is a rank.
 * "Editor, Writer" and "Editor and Writer" are one, and so are
 * "Researcher" and "Department of Surgery Researcher". "Analyst" and
 * "Senior Analyst" are a promotion, and so are "Engineer" and "Engineering
 * Manager".
 */
export function sameTitle(a: string, b: string): boolean {
  if (!sameLabel(a, b)) return false;
  const x = labelStems(a);
  const y = labelStems(b);
  return ![...x, ...y].some(
    (stem) => !(x.has(stem) && y.has(stem)) && RANK_STEMS.has(stem),
  );
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

/**
 * The profile a LinkedIn address names, or null for any other address:
 * "rowan-vale" for "https://uk.linkedin.com/in/Rowan-Vale/?trk=x". A country
 * subdomain, the case, a trailing slash and a query all name one profile.
 */
export function linkedInHandle(url: string | null | undefined): string | null {
  const text = url?.trim();
  if (!text) return null;
  let parsed: URL;
  try {
    parsed = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`,
    );
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  const match = /^\/(?:in|pub)\/([^/]+)/i.exec(parsed.pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return match[1].toLowerCase();
  }
}

/** The items of a list value: "Paper A; Paper B" is two. */
export function listItems(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/\s*;\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** An item as `sameItem` compares it: no quotes, no leading number. */
function itemKey(item: string): string {
  return textKey(item.replace(/^\s*\d+\s+(?=\D)/, ""));
}

/**
 * True when two items of a list value are one: the same words, or one a
 * cut-off copy of the other. A page wrote "572 Tidal Patterns in Harbor
 * Sediment" for "Tidal Patterns in Harbor Sediment", and another cut a title
 * short (2026-10-05). Short items must match whole, so "Award" and "Awards
 * dinner" stay two.
 */
export function sameItem(a: string, b: string): boolean {
  const x = itemKey(a);
  const y = itemKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  return shorter.length >= 24 && longer.startsWith(shorter);
}
