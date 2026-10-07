/**
 * The "Try asking" questions on Ask Contrack and in the palette's AI mode,
 * drawn at random from a pool the server builds from the person's own
 * network (`GET /api/search/starters`), so a press always finds people.
 *
 * A draw picks kinds first. The pool is mostly companies and roles, so a
 * plain shuffle of about five hundred would almost never draw the seven
 * general questions.
 */
import type { StarterQuestion } from "../../../shared/starterQuestions";

export const SUGGESTION_COUNT = 6;

export const PALETTE_SUGGESTION_COUNT = 4;

/** The most questions of one kind in a draw, while other kinds are left. */
const PER_KIND = 2;

/** A Fisher-Yates shuffled copy. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Draws `count` questions: one from each shuffled kind in turn, up to
 * {@link PER_KIND} rounds, then fills any gap from the rest of the pool.
 * Returns the whole pool, shuffled, when it holds `count` or fewer.
 */
export function drawSuggestions(
  pool: readonly StarterQuestion[],
  count: number = SUGGESTION_COUNT,
  random: () => number = Math.random,
): string[] {
  if (count < 1 || pool.length === 0) return [];
  const groups = new Map<string, StarterQuestion[]>();
  for (const question of pool) {
    const group = groups.get(question.kind);
    if (group) group.push(question);
    else groups.set(question.kind, [question]);
  }
  const kinds = shuffled([...groups.keys()], random);
  const inKind = new Map(
    kinds.map((kind) => [kind, shuffled(groups.get(kind)!, random)]),
  );

  const taken: StarterQuestion[] = [];
  for (let round = 0; round < PER_KIND && taken.length < count; round++) {
    for (const kind of kinds) {
      if (taken.length >= count) break;
      const question = inKind.get(kind)![round];
      if (question) taken.push(question);
    }
  }
  if (taken.length < count) {
    const chosen = new Set(taken);
    for (const question of shuffled(pool, random)) {
      if (taken.length >= count) break;
      if (!chosen.has(question)) taken.push(question);
    }
  }
  return taken.map((question) => question.text);
}
