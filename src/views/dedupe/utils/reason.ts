/**
 * Why two contacts look like one person, in the words a review row shows.
 * The server writes plain words, and an AI match carries the model's
 * sentence. A stored pair can still hold an engine line ("embedding
 * similarity 94%") until the next check: it shows its match type's words.
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

/** Each match type's words, for a line that has none. */
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

/** An engine line: a number, a score, an arrow, or an older opening. */
const ENGINE_WORDS =
  /\d+%|\bscore\b|embedding|similarity|↔|^Shared (email|phone)|^Exact name match|^Nickname match/i;

/**
 * The match type a merge-history line names, in either wording. Merge
 * history keeps no match type of its own.
 */
export function guessMatchType(reasoning: string): string {
  const line = reasoning.trim();
  if (/^Shared email|^Same email/i.test(line)) return "email";
  if (/^Shared phone|^Same phone/i.test(line)) return "phone";
  if (/profile link/i.test(line)) return "social";
  if (/^Exact name match.*same company|^Same name and company/i.test(line)) {
    return "name_company";
  }
  if (
    /^Exact name match.*(different sources|across)|^Same name, (in two imports|from)/i.test(
      line,
    )
  ) {
    return "cross_source";
  }
  if (/^Exact name match|^Same name$/i.test(line)) return "name";
  if (/^Nickname/i.test(line)) return "nickname";
  if (/middle name/i.test(line)) return "middle_name";
  if (/\d+%|\bscore\b|embedding|similarity/i.test(line)) return "fuzzy";
  return "";
}

/** True when a model wrote the reason. Only those wear the AI color. */
export const isAiReason = (matchType: string): boolean => matchType === "ai";

/** The reason a row shows, without a closing period. */
export function plainReason(matchType: string, reasoning: string): string {
  const text = reasoning.trim().replace(/\.$/, "");
  if (isAiReason(matchType)) return text || TYPE_WORDS.ai;
  if (!text || ENGINE_WORDS.test(text)) {
    return TYPE_WORDS[matchType] ?? "Similar details";
  }
  // Drop a caveat stored after the reason ("Same profile link. the first
  // names differ"): the row shows caveats on their own.
  return text.replace(/\.\s+[a-z].*$/, "");
}

const capitalize = (word: string) =>
  word.charAt(0).toUpperCase() + word.slice(1);

/** A generation in a stored line, and in caveat words. */
const GENERATION: Record<string, string> = {
  jr: "Jr.",
  sr: "Sr.",
  ii: "II",
  iii: "III",
  iv: "IV",
};

/** A shared value's noun in a stored line, and in caveat words. */
const SHARED_NOUN: Record<string, string> = {
  address: "email address",
  number: "phone number",
  "profile link": "profile link",
  name: "name",
};

/** A pair's caveats, one a line. The server joins them with a full stop. */
export function pairCaveats(
  caveat: string | null | undefined,
  reasoning: string,
): string[] {
  const joined = pairCaveat(caveat, reasoning);
  return joined ? joined.split(/\.\s+(?=[A-Z0-9])/) : [];
}

/**
 * A pair's caveat: the server's field, or else the one at the end of a
 * stored reason line, in the server's caveat words.
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
