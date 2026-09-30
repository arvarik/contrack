/**
 * Smart Avatar — which look the default avatar draws for a contact.
 *
 * The avatar service keeps three pools of hair and clothing: female, male and
 * neutral. This module picks the pool. It never calls a network service, and
 * the same input always gives the same answer.
 *
 * The order of evidence:
 *
 *   1. Pronouns, when the contact has them. "she/her" is female, "he/him" is
 *      male, and any other pronoun ("they/them", "xe", "any") is neutral.
 *   2. A title the name starts with: Mr, Sir, Herr are male; Mrs, Ms, Dame,
 *      Frau are female; Mx is neutral. Dr, Prof and the like are dropped.
 *   3. The first name, looked up in a table built from the World Gender Name
 *      Dictionary (see nlp/givenNames.ts). The table has a line only for
 *      names that nine in ten people who carry them share a gender.
 *
 * Anything else is neutral. A neutral face has no beard and hair that reads
 * either way, so a name the data cannot call costs a guess, never a wrong one.
 * The old lookup forced every name into male or female, so Jordan, Taylor and
 * Kim each got a gender by coin toss.
 *
 * The asset pools live in services/avatarService.
 */

import { foldName, lookupGivenName } from "./nlp/givenNames.ts";

/** The three pools avatarService keys off. */
export type AvatarLook = "female" | "male" | "neutral";

// =============================================================================
// Pronouns
// =============================================================================

const PRONOUN_LOOK = new Map<string, AvatarLook>([
  ["she", "female"],
  ["her", "female"],
  ["hers", "female"],
  ["he", "male"],
  ["him", "male"],
  ["his", "male"],
]);

/** Values that mean "nobody filled this in", not a pronoun. */
const NO_PRONOUNS = new Set([
  "",
  "-",
  "?",
  "n/a",
  "na",
  "none",
  "null",
  "unknown",
  "unspecified",
]);

/**
 * The look a pronoun field asks for, or null when the field is empty.
 *
 * The first pronoun decides, because that is the one a person lists first:
 * "she/they" is female, "they/she" is neutral. A pronoun this does not know is
 * neutral rather than ignored. Someone who wrote "ze/hir" told us something,
 * and guessing from their name would throw that away.
 */
export function lookFromPronouns(
  pronouns: string | null | undefined,
): AvatarLook | null {
  const text = (pronouns ?? "").trim().toLowerCase();
  if (NO_PRONOUNS.has(text)) return null;
  const first = text.split(/[\s/,;|()+&]+/).find(Boolean) ?? "";
  return PRONOUN_LOOK.get(first) ?? "neutral";
}

// =============================================================================
// Names
// =============================================================================

/**
 * Words a name can start with that are not a first name. The value is the
 * look the word implies, or null for a title that says nothing about gender.
 * "Sr." and "Fr." carry null: each means a man in one language (Señor,
 * Father) and a woman in another (Sister, Frau).
 */
const LEADING_WORDS = new Map<string, AvatarLook | null>(
  Object.entries({
    mr: "male",
    mister: "male",
    sir: "male",
    lord: "male",
    herr: "male",
    monsieur: "male",
    senor: "male",
    signor: "male",
    don: "male",
    uncle: "male",
    grandpa: "male",
    grandfather: "male",
    father: "male",
    brother: "male",
    mrs: "female",
    ms: "female",
    miss: "female",
    mme: "female",
    madame: "female",
    mlle: "female",
    mademoiselle: "female",
    frau: "female",
    senora: "female",
    sra: "female",
    srta: "female",
    senorita: "female",
    signora: "female",
    dona: "female",
    dame: "female",
    lady: "female",
    aunt: "female",
    auntie: "female",
    aunty: "female",
    grandma: "female",
    grandmother: "female",
    mother: "female",
    sister: "female",
    mx: "neutral",
    dr: null,
    doctor: null,
    prof: null,
    professor: null,
    rev: null,
    reverend: null,
    sr: null,
    fr: null,
    capt: null,
    captain: null,
    col: null,
    gen: null,
    lt: null,
    maj: null,
    sgt: null,
    hon: null,
    judge: null,
    justice: null,
    rabbi: null,
    imam: null,
    pastor: null,
    cmdr: null,
    adm: null,
    gov: null,
    sen: null,
    rep: null,
    amb: null,
  }),
);

/** Words that close a name after a comma: "Jane Doe, PhD". */
const SUFFIX =
  /^(jr|sr|ii|iii|iv|phd|md|mba|cpa|esq|dds|rn|pe|jd|obe|mbe|cbe)\.?$/i;

/**
 * Common Chinese, Korean and Vietnamese family names.
 *
 * Those names are often written family name first ("Li Na", "Kim Min-jun").
 * Several of the family names are also given names elsewhere: Li is a
 * Swedish girl's name, Lee an American one for boys. So when one of these
 * words starts a name of two or more words, the first word is probably not
 * the given name, and the answer is neutral.
 */
const FAMILY_NAME_FIRST = new Set(
  (
    "li wang zhang liu chen yang huang zhao wu zhou xu sun ma zhu hu guo he " +
    "lin gao luo zheng liang xie song tang han feng deng cao peng zeng xiao " +
    "tian dong pan yuan cai jiang yu du ye cheng wei su lu ding ren shen yao " +
    "jin kim lee park choi jung jeong kang cho yoon jang lim oh seo shin kwon " +
    "hwang ahn yoo hong jeon moon son bae baek nam nguyen tran le pham hoang " +
    "huynh phan vu vo dang bui do ho ngo duong ly"
  ).split(" "),
);

/** "J.", "J" or "J.R." ahead of the name a person goes by. */
const INITIALS = /^\p{L}\.?$|^(\p{L}\.){2,}$/u;

/** A three-syllable Hangul name is almost always a one-syllable family name first. */
const HANGUL_FULL_NAME = /^\p{Script=Hangul}{3}$/u;

/**
 * The words of a display name with the parts that are never a first name
 * removed: an email domain, parentheticals, quoted nicknames, and a
 * "Last, First" comma.
 */
function nameWords(fullName: string): string[] {
  let name = fullName.normalize("NFC").trim();

  // "john.smith@example.com" → "john"
  if (/^[^\s@]+@[^\s@]+$/.test(name)) {
    name =
      name
        .split("@")[0]
        .split(/[._+\-\d]+/)
        .find((part) => part.length >= 2) ?? "";
  }

  name = name
    // "Sabrina Hans (Coordinator)", "Robert (Bob) Smith"
    .replace(/\([^)]*\)/g, " ")
    // 'Robert "Bob" Smith'
    .replace(/["“”«»][^"“”«»]*["“”«»]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // "John Smith, PhD" → "John Smith"; "Smith, John" → "John Smith"
  const parts = name
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  while (parts.length > 1 && SUFFIX.test(parts[parts.length - 1])) parts.pop();
  if (parts.length === 2) name = `${parts[1]} ${parts[0]}`;
  else if (parts.length > 2) name = parts[0];

  return name.split(" ").filter(Boolean);
}

/** The look a first name implies, trying the whole word, then its first half. */
function lookFromGivenName(word: string): AvatarLook | null {
  const bare = word.replace(/^['’.]+|['’.]+$/g, "");
  if (bare.length < 2) return null;

  const candidates = [bare];
  // Mary-Jane is looked up as written first; the table knows most compound
  // names. Only then its first half, since Jean-Marie is a man.
  if (bare.includes("-")) candidates.push(bare.split("-")[0]);
  // 김민준 → 민준
  if (HANGUL_FULL_NAME.test(bare)) candidates.push(bare.slice(1));

  for (const candidate of candidates) {
    const gender = lookupGivenName(candidate);
    if (gender) return gender;
  }
  return null;
}

/**
 * Classify a display name into the look its avatar should draw.
 * Accepts anything a contact's name field can hold, including an email.
 */
export function classifyName(fullName: string): AvatarLook {
  const words = nameWords(fullName ?? "");

  // A title a person chose outranks what their first name suggests, so
  // "Mr. Jordan Lee" is male and "Mx. Sam Lee" is neutral.
  while (words.length > 0) {
    const key = foldName(words[0]).replace(/\.$/, "");
    if (!LEADING_WORDS.has(key)) break;
    const titleLook = LEADING_WORDS.get(key);
    if (titleLook) return titleLook;
    words.shift();
  }

  while (words.length > 1 && INITIALS.test(words[0])) words.shift();

  if (words.length >= 2 && FAMILY_NAME_FIRST.has(foldName(words[0]))) {
    return "neutral";
  }

  return (words[0] && lookFromGivenName(words[0])) || "neutral";
}
