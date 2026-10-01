// =============================================================================
// Why a person matches: the profile fields that answer the question
// =============================================================================
// The reranker used to write one sentence per match, and the model's time
// went with it. `reasons.ts` builds one sentence from the field a filter or
// the reranker proved. This module says more, with no model call:
//
//   1. The fields a filter or the reranker proved, first.
//   2. Every other field that holds the question's words: its role, its
//      company, its interests, its tags, its about text. "Who is interested
//      in machine learning?" finds one person through their interests and
//      another through their role, and each result names its own field.
//   3. For a result with neither, the passage the search found close in
//      meaning, when the search read passages for this question.
//
// The question's words are the ones left when the words that only ask for
// people are gone ("who", "is", "interested", "in"). Each also matches its
// other forms ("designers" finds Design) and a few common initialisms (ML,
// machine learning). Matching ignores case and accents, and the marks are
// offsets into the contact's own text.
//
// About 0.1 ms a result. Every Ask answer carries it, the local list and
// the answer AI checked alike.
// =============================================================================

import type {
  MatchedField,
  MatchedHow,
  MatchedOn,
} from "../../../shared/matchedOn.ts";
import { roleVariants } from "../../ai/queryConstraints.ts";
import { foldName } from "../../utils/nlp/givenNames.ts";
import { FILLER } from "./implicitFacets.ts";
import { searchTokens } from "./lexical.ts";
import type { SearchPassage } from "./passages.ts";
import { lastContactAgo, type ReasonEvidence } from "./reasons.ts";

/** The most fields a result lists. */
export const MAX_MATCHED = 3;
/** A field's text is cut to this many characters round its first mark. */
const WINDOW = 110;
/** The characters a cut keeps before the first mark. */
const LEAD = 20;
/** The most characters of one field searched for the question's words. */
const MAX_SEARCHED = 4_000;
/** The most items of a list field (interests, tags, jobs) in one entry. */
const MAX_ITEMS = 3;

/**
 * Words that ask about a person without naming anything about them, on top
 * of the question words implicit facets skip.
 */
const ASKING = new Set([
  "interested",
  "into",
  "like",
  "likes",
  "love",
  "loves",
  "enjoy",
  "enjoys",
  "passionate",
  "about",
  "fan",
  "fans",
  "with",
  "for",
  "from",
  "to",
  "on",
  "and",
  "or",
  "as",
  "by",
  "has",
  "have",
  "had",
  "be",
  "been",
  "am",
  "can",
  "could",
  "would",
  "should",
  "will",
  "did",
  "how",
  "where",
  "when",
  "why",
  "whom",
  "whose",
  "this",
  "these",
  "those",
  "them",
  "they",
  "their",
  "he",
  "she",
  "his",
  "her",
  "it",
  "its",
  "you",
  "your",
  "us",
  "some",
  "many",
  "more",
  "most",
  "very",
  "really",
  "also",
  "not",
  "no",
  "currently",
  "recently",
  "used",
  "tagged",
  "met",
]);

/** Initialisms and the phrases they stand for, both ways. */
const INITIALISMS: readonly [string, string][] = [
  ["ai", "artificial intelligence"],
  ["ml", "machine learning"],
  ["vc", "venture capital"],
  ["pm", "product manager"],
  ["ux", "user experience"],
  ["nlp", "natural language processing"],
  ["hr", "human resources"],
];

/** Words that say the question is about what a person likes. */
const LIKING = new Set([
  "interested",
  "into",
  "like",
  "likes",
  "love",
  "loves",
  "enjoy",
  "enjoys",
  "passionate",
  "fan",
  "fans",
  "hobby",
  "hobbies",
]);
/** Words that say the question is about a person's work. */
const WORKING = new Set([
  "works",
  "work",
  "working",
  "worked",
  "job",
  "role",
  "title",
  "employed",
  "hire",
  "hiring",
]);

/** The question, read once for every result it explains. */
export interface QuestionTerms {
  /**
   * Finds any of the question's words or phrases, and their other forms, as
   * whole words in folded text. Null when the question has no such words.
   */
  pattern: RegExp | null;
  /**
   * What the question leans on. "Who is interested in X?" lists interests
   * before a role, and "Who works in X?" the other way round.
   */
  focus: "liking" | "work" | null;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Read a question's words: the runs of words left when the asking words are
 * gone, each run as a phrase and each word on its own, every one with its
 * other forms and its initialism.
 */
export function questionTerms(question: string): QuestionTerms {
  const tokens = searchTokens(question).map(foldName);
  const liking = tokens.some((token) => LIKING.has(token));
  const working = tokens.some((token) => WORKING.has(token));
  const focus =
    liking && !working ? "liking" : working && !liking ? "work" : null;

  const runs: string[][] = [];
  let run: string[] = [];
  for (const token of tokens) {
    const skip = FILLER.has(token) || ASKING.has(token) || WORKING.has(token);
    if (skip || token.length < 2) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push(token);
  }
  if (run.length) runs.push(run);

  const forms = new Set<string>();
  for (const words of runs) {
    const phrases = [words.join(" "), ...(words.length > 1 ? words : [])];
    for (const phrase of phrases) {
      for (const form of roleVariants(phrase)) forms.add(form);
      for (const [short, long] of INITIALISMS) {
        if (phrase === short) forms.add(long);
        if (phrase === long) forms.add(short);
      }
    }
  }
  if (!forms.size) return { pattern: null, focus };
  // Longest first, so "machine learning" is marked whole, not word by word.
  const alternation = [...forms]
    .sort((a, b) => b.length - a.length)
    .map((form) => form.split(" ").map(escape).join("\\s+"))
    .join("|");
  return {
    pattern: new RegExp(
      `(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`,
      "gu",
    ),
    focus,
  };
}

/**
 * Where the question's words are in `text`, as offsets into `text` itself.
 * The text is folded a character at a time, so a mark on "Zürich" found by
 * "zurich" lands on the original letters.
 */
export function findMarks(
  text: string,
  terms: QuestionTerms,
): [number, number][] {
  if (!terms.pattern || !text) return [];
  const source =
    text.length > MAX_SEARCHED ? text.slice(0, MAX_SEARCHED) : text;
  let folded = foldName(source);
  // Folding almost never changes the length: "é" becomes "e". Then each
  // folded character sits where its original does. Only a text where it
  // does ("ß" to "ss", a combining accent) is folded a character at a time,
  // keeping, for each folded character, the offset it came from.
  let from: number[] | null = null;
  if (folded.length !== source.length) {
    folded = "";
    from = [];
    for (let i = 0; i < source.length;) {
      const width = source.codePointAt(i)! > 0xffff ? 2 : 1;
      const piece = foldName(source.slice(i, i + width));
      for (let k = 0; k < piece.length; k++) from.push(i);
      folded += piece;
      i += width;
    }
  }
  const marks: [number, number][] = [];
  terms.pattern.lastIndex = 0;
  for (const hit of folded.matchAll(terms.pattern)) {
    const end = hit.index + hit[0].length;
    if (!from) {
      marks.push([hit.index, end]);
      continue;
    }
    const last = from[end - 1]!;
    marks.push([
      from[hit.index]!,
      last + (source.codePointAt(last)! > 0xffff ? 2 : 1),
    ]);
  }
  return marks;
}

/** One line of text: runs of space as one space, trimmed. */
const oneLine = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

/**
 * A text cut to one line's worth round its first mark.
 *
 * The card shows at most two lines of a field, and a phone fits about forty
 * characters in them. So a mark that starts more than {@link LEAD} plus ten
 * characters in keeps only {@link LEAD} characters before it, from the start
 * of a word, and the text runs on for at most {@link WINDOW} characters in
 * all, cut at a word. Each cut end gets an ellipsis. Marks outside the cut
 * are dropped and the rest move with it. A text with no marks is only cut
 * at its end.
 */
export function windowed(
  text: string,
  marks: [number, number][],
): { text: string; marks: [number, number][] } {
  const first = marks[0] ?? [0, 0];
  let start = 0;
  if (first[0] > LEAD + 10) {
    // From the start of the first whole word inside the lead.
    const space = text.indexOf(" ", first[0] - LEAD);
    start = space !== -1 && space < first[0] ? space + 1 : first[0];
  }
  let end = Math.min(text.length, start + WINDOW);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > Math.max(start, first[1])) end = space;
  }
  if (start === 0 && end === text.length) return { text, marks };
  const lead = start > 0 ? "…" : "";
  const tail = end < text.length ? "…" : "";
  const shift = lead.length - start;
  return {
    text: `${lead}${text.slice(start, end)}${tail}`,
    marks: marks
      .filter(([a, b]) => a >= start && b <= end)
      .map(([a, b]) => [a + shift, b + shift]),
  };
}

/** The contact fields this module reads. A hydrated contact has them all. */
export interface MatchedContact {
  [field: string]: unknown;
  role?: unknown;
  headline?: unknown;
  company?: unknown;
  industry?: unknown;
  location?: unknown;
  about?: unknown;
  preferences?: unknown;
  lastContactedAt?: unknown;
  interests?: unknown;
  tags?: unknown;
  experience?: unknown;
  education?: unknown;
  addresses?: unknown;
}

/** A proven field and what proved it. */
export interface MatchProof {
  evidence: ReasonEvidence;
  how: Extract<MatchedHow, "filter" | "ai">;
}

/** The strings under `key` in a list of rows, such as each tag's `tag`. */
function strings(list: unknown, key: string): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => oneLine((item as Record<string, unknown>)?.[key]))
    .filter(Boolean);
}

/** A job as a line: "Data Scientist at Globex", or the one it has. */
function jobLine(job: Record<string, unknown>): string {
  const role = oneLine(job.role);
  const company = oneLine(job.company);
  return role && company ? `${role} at ${company}` : role || company;
}

/** A school as a line: "Stanford University, MS, Computer Science". */
function schoolLine(school: Record<string, unknown>): string {
  return [school.school, school.degree, school.fieldOfStudy]
    .map(oneLine)
    .filter(Boolean)
    .join(", ");
}

/**
 * Items of a list field joined into one line, the ones with marks first,
 * with the marks moved to where each item lands in the line.
 */
function joinItems(
  items: string[],
  terms: QuestionTerms,
  onlyMarked: boolean,
): { text: string; marks: [number, number][] } | null {
  const scored = items.map((item) => ({ item, marks: findMarks(item, terms) }));
  const chosen = scored
    .filter((entry) => !onlyMarked || entry.marks.length > 0)
    .sort((a, b) => Number(b.marks.length > 0) - Number(a.marks.length > 0))
    .slice(0, MAX_ITEMS);
  if (!chosen.length) return null;
  let text = "";
  const marks: [number, number][] = [];
  for (const { item, marks: own } of chosen) {
    if (text) text += ", ";
    for (const [a, b] of own) marks.push([a + text.length, b + text.length]);
    text += item;
  }
  return { text, marks };
}

/** The text a field shows. `value` is what a filter or the reranker proved. */
function fieldText(
  contact: MatchedContact,
  field: MatchedField,
  terms: QuestionTerms,
  value: string | undefined,
  onlyMarked: boolean,
  now: Date,
): { text: string; marks: [number, number][] } | null {
  const plain = (text: string) => {
    if (!text) return null;
    const marks = findMarks(text, terms);
    if (onlyMarked && !marks.length) return null;
    return windowed(text, marks);
  };
  switch (field) {
    case "role":
      return plain(value || oneLine(contact.role) || oneLine(contact.headline));
    case "headline":
      return plain(value || oneLine(contact.headline));
    case "company":
    case "industry":
    case "location":
      return plain(value || oneLine(contact[field]));
    case "about":
    case "preferences":
      // A proof quotes its passage. Otherwise the field is searched whole.
      return plain(value || oneLine(contact[field]));
    case "interest":
      return value
        ? plain(value)
        : joinItems(strings(contact.interests, "interest"), terms, onlyMarked);
    case "tag":
      return value
        ? plain(value)
        : joinItems(strings(contact.tags, "tag"), terms, onlyMarked);
    case "experience": {
      if (value) return plain(value);
      const jobs = Array.isArray(contact.experience)
        ? (contact.experience as Record<string, unknown>[])
        : [];
      // A job whose own line has no words can still match on its notes.
      const lines = jobs.map((job) => {
        const line = jobLine(job);
        const notes = oneLine(job.description);
        return findMarks(line, terms).length || !notes
          ? line
          : `${line}: ${notes}`;
      });
      const joined = joinItems(lines.filter(Boolean), terms, onlyMarked);
      return joined && windowed(joined.text, joined.marks);
    }
    case "education": {
      if (value) return plain(value);
      const schools = Array.isArray(contact.education)
        ? (contact.education as Record<string, unknown>[]).map(schoolLine)
        : [];
      return joinItems(schools.filter(Boolean), terms, onlyMarked);
    }
    case "address":
      // No filter, reranker or passage proves an address, so there is never
      // a value to quote.
      return joinItems(
        strings(contact.addresses, "address"),
        terms,
        onlyMarked,
      );
    case "lastContact": {
      const ago = lastContactAgo(contact.lastContactedAt, now);
      return { text: ago ?? "None logged", marks: [] };
    }
  }
}

/** The fields searched for the question's words, in the order they are listed. */
const WORK_ORDER: readonly MatchedField[] = [
  "role",
  "headline",
  "company",
  "industry",
  "experience",
  "interest",
  "tag",
  "location",
  "education",
  "about",
  "preferences",
  // Last: an address is the least telling text a contact has, and the index
  // ranks it last too.
  "address",
];
const LIKING_ORDER: readonly MatchedField[] = [
  "interest",
  "tag",
  "about",
  "preferences",
  "role",
  "headline",
  "industry",
  "company",
  "experience",
  "location",
  "education",
  "address",
];

/** The field a reason's evidence names, as a matched field. */
const fieldOf = (evidence: ReasonEvidence): MatchedField => evidence.field;

/**
 * The fields that answer the question for one contact, most telling first,
 * at most {@link MAX_MATCHED}.
 *
 * @param proofs - What a filter or the reranker proved, in reason order.
 * @param passages - Passages the search picked for this contact, best
 *   first. The first one names a field that matched in meaning when
 *   nothing else did.
 */
export function explainMatch(
  contact: MatchedContact,
  terms: QuestionTerms,
  proofs: readonly MatchProof[] = [],
  passages: readonly Pick<SearchPassage, "field" | "text">[] = [],
  now: Date = new Date(),
): MatchedOn[] {
  const out: MatchedOn[] = [];
  const listed = new Set<MatchedField>();
  const add = (
    field: MatchedField,
    how: MatchedHow,
    shown: { text: string; marks: [number, number][] } | null,
  ) => {
    if (!shown?.text || listed.has(field) || out.length >= MAX_MATCHED) return;
    listed.add(field);
    out.push({ field, text: shown.text, marks: shown.marks, how });
  };

  for (const { evidence, how } of proofs) {
    const field = fieldOf(evidence);
    add(
      field,
      how,
      fieldText(
        contact,
        field,
        terms,
        oneLine(evidence.value) || undefined,
        false,
        now,
      ),
    );
  }
  const order = terms.focus === "liking" ? LIKING_ORDER : WORK_ORDER;
  for (const field of order)
    add(field, "words", fieldText(contact, field, terms, undefined, true, now));
  if (!out.length && passages.length) {
    const passage = passages[0]!;
    const text = oneLine(passage.text);
    const marks = findMarks(text, terms);
    add(
      passage.field,
      marks.length ? "words" : "meaning",
      windowed(text, marks),
    );
  }
  return out;
}
