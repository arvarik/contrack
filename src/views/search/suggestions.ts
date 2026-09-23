/**
 * The questions under "Try asking" on Ask Contrack, in People mode.
 *
 * The first three come from the person's own network: its most common
 * industry, city and company. Those are the facts People search matches, so
 * a press always finds someone. Fixed examples fill the rest, for the kinds
 * of question the search also answers (a sector, a role, an interest).
 *
 * The list used to be six fixed questions. On a real network most found no
 * one, and "Who haven't I contacted in over 3 months?" never could: People
 * search reads profiles, not dates.
 *
 * @module views/search/suggestions
 */
import type { Contact } from "../../types";

/** The fixed examples, in the order they fill the list. */
export const FIXED_QUESTIONS: readonly string[] = [
  "Who do I know in venture capital?",
  "Who works at a startup as a designer?",
  "Find people interested in AI or machine learning",
  "Who likes espresso?",
];

/** How many questions the page shows. */
const LIMIT = 6;

/** The most common value, held by two people at least, or null. */
function mostCommon(values: readonly (string | null | undefined)[]) {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 1;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** The questions to suggest for these contacts. Ghosts do not count. */
export function suggestedQuestions(
  contacts: readonly Pick<
    Contact,
    "industry" | "location" | "company" | "isGhost"
  >[],
): string[] {
  const people = contacts.filter((c) => !c.isGhost);
  const industry = mostCommon(people.map((c) => c.industry));
  // "Austin, TX" is Austin: the city is what a person says.
  const city = mostCommon(people.map((c) => c.location?.split(",")[0]));
  const company = mostCommon(people.map((c) => c.company));
  const fromNetwork = [
    industry && `Who works in ${industry}?`,
    city && `Who do I know in ${city}?`,
    company && `Who works at ${company}?`,
  ].filter((q): q is string => Boolean(q));
  return [...fromNetwork, ...FIXED_QUESTIONS].slice(0, LIMIT);
}
