/**
 * Why two contacts look like one person, in the words a review row shows.
 *
 * The server writes the reason in plain words: "Same email address",
 * "Similar names, same company and city". An AI match carries the model's
 * own sentence. A pair stored before the plain words keeps its old line,
 * such as "High name similarity (94%), embedding similarity 94% (score:
 * 81%)", until the next check replaces it, so such a line is shown as the
 * plain words of its match type instead.
 *
 * @module views/dedupe/utils/reason
 */
import {
  AtSign,
  Link2,
  Mail,
  Phone,
  ScanSearch,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";

/** The plain words of each match type, for a line that has none. */
const TYPE_WORDS: Record<string, string> = {
  email: "Same email address",
  phone: "Same phone number",
  social: "Same profile link",
  name_company: "Same name and company",
  cross_source: "Same name, in two imports",
  name: "Same name",
  nickname: "Same name, with a nickname",
  middle_name: "Same name with a middle name added",
  fuzzy: "Similar names",
  mention: "Mentioned in a note",
  ai: "AI thinks they are one person",
};

/**
 * An engine line from before the plain words: a number, a score, a vector,
 * two normalized names joined by an arrow, or one of the old openings,
 * which named the value after a colon ("Shared phone number: 555 0142").
 */
const ENGINE_WORDS =
  /\d+%|\bscore\b|embedding|similarity|↔|^Shared (email|phone)|^Exact name match|^Nickname match/i;

/** True when a model wrote the reason. Only those wear the AI colour. */
export const isAiReason = (matchType: string): boolean => matchType === "ai";

/** The reason a row shows, without a closing period. */
export function plainReason(matchType: string, reasoning: string): string {
  const text = reasoning.trim().replace(/\.$/, "");
  if (isAiReason(matchType)) return text || TYPE_WORDS.ai;
  if (!text || ENGINE_WORDS.test(text)) {
    return TYPE_WORDS[matchType] ?? "Similar details";
  }
  // An old caveat followed the reason after a full stop, in lower case:
  // "Same profile link. the first names differ". The caveat has its own
  // place on the row now.
  return text.replace(/\.\s+[a-z].*$/, "");
}

const capitalize = (word: string) =>
  word.charAt(0).toUpperCase() + word.slice(1);

/** How an old line wrote a generation, and how the caveat writes it. */
const GENERATION: Record<string, string> = {
  jr: "Jr.",
  sr: "Sr.",
  ii: "II",
  iii: "III",
  iv: "IV",
};

/** What an old line called the shared value, and what the caveat calls it. */
const SHARED_NOUN: Record<string, string> = {
  address: "email address",
  number: "phone number",
  "profile link": "profile link",
  name: "name",
};

/**
 * The caveats of a pair, one a line. The server joins two with a full stop:
 * "First names differ: Ada and Ben. 3 contacts share this phone number".
 */
export function pairCaveats(
  caveat: string | null | undefined,
  reasoning: string,
): string[] {
  const joined = pairCaveat(caveat, reasoning);
  return joined ? joined.split(/\.\s+(?=[A-Z0-9])/) : [];
}

/**
 * The caveat of a pair: the server's own, or for a pair stored before the
 * caveat had its own field, the one its old line ended with, in the same
 * words the server writes now.
 */
export function pairCaveat(
  caveat: string | null | undefined,
  reasoning: string,
): string | null {
  if (caveat) return caveat;
  const names = reasoning.match(/first names differ \("([^"]+)" ↔ "([^"]+)"\)/);
  if (names) {
    return `First names differ: ${capitalize(names[1])} and ${capitalize(names[2])}`;
  }
  const generations = reasoning.match(
    /one is "([^"]+)" and the other "([^"]+)"/,
  );
  if (generations) {
    const [a, b] = [generations[1], generations[2]].map(
      (g) => GENERATION[g] ?? g,
    );
    return `One is ${a} and the other ${b}`;
  }
  const shared = reasoning.match(
    /(\d+) contacts carry this (address|number|profile link|name)/,
  );
  if (shared)
    return `${shared[1]} contacts share this ${SHARED_NOUN[shared[2]]}`;
  return null;
}

/** The glyph beside a reason: what the two contacts share. */
export function reasonIcon(matchType: string): LucideIcon {
  switch (matchType) {
    case "email":
      return Mail;
    case "phone":
      return Phone;
    case "social":
      return Link2;
    case "mention":
      return AtSign;
    case "ai":
      return Sparkles;
    case "fuzzy":
      return ScanSearch;
    default:
      return UserRound;
  }
}
