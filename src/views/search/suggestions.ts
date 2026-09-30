/**
 * The questions under "Try asking" on Ask Contrack, in People mode.
 *
 * The server keeps a pool of questions built from the person's own network
 * (`GET /api/search/starters`): its industries, cities, companies, roles,
 * interests and tags, each held by someone, so a press always finds people.
 * The page shows six of them, drawn at random each time the list appears,
 * so the list changes from visit to visit.
 *
 * A draw mixes the kinds: at most two questions of one kind while other
 * kinds are left, so six questions are never six companies.
 *
 * The list used to be three questions from the network and fixed examples
 * for the rest. On a real network most examples found no one.
 *
 * @module views/search/suggestions
 */
import type { StarterQuestion } from "../../../shared/starterQuestions";

/** How many questions the page shows. */
export const SUGGESTION_COUNT = 6;

/** The most questions of one kind in a draw, while other kinds are left. */
const PER_KIND = 2;

/**
 * Draw `count` questions from the pool at random, mixing the kinds.
 *
 * 1. Shuffle the pool (Fisher-Yates, with `random`).
 * 2. Walk it and take a question unless its kind already has
 *    {@link PER_KIND} in the draw.
 * 3. If the draw is still short, because the pool has few kinds, fill it
 *    from the questions step 2 passed over, in their shuffled order.
 *
 * Returns the whole pool, shuffled, when it holds `count` or fewer.
 */
export function drawSuggestions(
  pool: readonly StarterQuestion[],
  count: number = SUGGESTION_COUNT,
  random: () => number = Math.random,
): string[] {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const taken: StarterQuestion[] = [];
  const passed: StarterQuestion[] = [];
  const perKind = new Map<string, number>();
  for (const question of shuffled) {
    if (taken.length >= count) break;
    const held = perKind.get(question.kind) ?? 0;
    if (held >= PER_KIND) {
      passed.push(question);
      continue;
    }
    perKind.set(question.kind, held + 1);
    taken.push(question);
  }
  for (const question of passed) {
    if (taken.length >= count) break;
    taken.push(question);
  }
  return taken.map((question) => question.text);
}
