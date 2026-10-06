// =============================================================================
// The reasons a pair gives, in plain words
// =============================================================================
// Every rule that finds a pair writes why, and the review screen shows it as
// written. So the words are a person's: "Same phone number", "Nickname: Bob
// for Robert", "Similar names, same company and city". No percentages, no
// engine terms such as "embedding" or "score", and no lowercased normalized
// names. The matched value travels in `matchedField`, and anything that argues
// against the match is the pair's caveat (policy.ts), not part of its reason.
// =============================================================================

import type { MatchSignals } from "./types.ts";

/** What each rule writes as its reason, in the words the review screen shows. */
export const REASON = {
  email: "Same email address",
  phone: "Same phone number",
  social: "Same profile link",
  nameCompany: "Same name and company",
  name: "Same name",
  middleName: "Same name with a middle name added",
} as const;

/** An import source by its own name, for a reason a person reads. */
const SOURCE_NAME: Record<string, string> = {
  apple: "Apple",
  csv: "a CSV file",
  facebook: "Facebook",
  google: "Google",
  icloud: "iCloud",
  linkedin: "LinkedIn",
  outlook: "Outlook",
  vcard: "a vCard file",
};

function sourceName(platform: string): string {
  const key = platform.toLowerCase();
  return SOURCE_NAME[key] ?? `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/** "Same name, from Google and LinkedIn": one source from each side. */
export function crossSourceReason(
  sourcesA: string[],
  sourcesB: string[],
): string {
  const [x, y] = [sourcesA[0], sourcesB[0]].map(sourceName).sort();
  return `Same name, from ${x} and ${y}`;
}

/** "Nickname: Bob for Robert": the short form first, then the full name. */
export function nicknameReason(firstA: string, firstB: string): string {
  const [short, long] = [firstA, firstB].sort(
    (x, y) => x.length - y.length || (x < y ? -1 : 1),
  );
  const cap = (name: string) =>
    `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  return `Nickname: ${cap(short)} for ${cap(long)}`;
}

/**
 * Why the funnel thinks two contacts are one person, in plain words.
 *
 * No numbers and no engine terms: "Similar names, same company and city".
 * A shared inbox is not a reason here, it is a caveat (`scoringCaveat`).
 */
export function buildScoringReasoning(signals: MatchSignals): string {
  if (signals.emailOverlap) return REASON.email;
  if (signals.phoneOverlap) return REASON.phone;
  if (signals.socialUrlOverlap) return REASON.social;

  const parts: string[] = [];

  if (signals.nameExactMatch) parts.push("same name");
  else if (signals.nicknameMatch) parts.push("a nickname of the same name");
  else if (signals.nameJaroWinkler >= 0.85 || signals.nameMetaphoneMatch)
    parts.push("similar names");

  const company = signals.companyMatch
    ? "same company"
    : signals.companyFuzzy > 0.7
      ? "similar company names"
      : null;
  if (company === "same company" && signals.locationOverlap) {
    parts.push("same company and city");
  } else {
    if (company) parts.push(company);
    if (signals.locationOverlap) parts.push("same city");
  }
  if (signals.embeddingSimilarity >= 0.85) {
    parts.push("profiles that read alike");
  }
  if (signals.isCrossSource) parts.push("from two different imports");

  const reasoning = parts.length > 0 ? parts.join(", ") : "similar details";
  return `${reasoning.charAt(0).toUpperCase()}${reasoning.slice(1)}`;
}

/** What argues against a funnel pair, or null. */
export function scoringCaveat(signals: MatchSignals): string | null {
  return signals.sharedMailboxOverlap ? "A shared inbox" : null;
}
