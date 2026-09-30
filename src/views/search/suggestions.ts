/**
 * The questions under "Try asking" on Ask Contrack, in People mode, and in
 * the palette's AI mode.
 *
 * The server keeps a pool of questions built from the person's own network
 * (`GET /api/search/starters`): its industries, cities, companies, roles,
 * interests and tags, each held by someone, and seven questions any network
 * can ask, so a press always finds people. The page shows six of them at
 * random, drawn each time the list appears, so the list changes from visit to
 * visit. The palette shows four, through the same draw.
 *
 * A draw picks kinds first. The pool is mostly companies and roles, and
 * seven general questions among five hundred would almost never be drawn by a
 * shuffle of the whole pool. With the kind chosen first, every kind has a
 * place in a draw when there are places enough: six questions from six
 * different kinds, and never more than two of one kind while other kinds are
 * left.
 *
 * The list used to be three questions from the network and fixed examples
 * for the rest. On a real network most examples found no one.
 *
 * @module views/search/suggestions
 */
import type { StarterQuestion } from "../../../shared/starterQuestions";

/** How many questions the Ask page shows. */
export const SUGGESTION_COUNT = 6;

/** How many questions the palette's AI mode shows. */
export const PALETTE_SUGGESTION_COUNT = 4;

/** The most questions of one kind in a draw, while other kinds are left. */
const PER_KIND = 2;

/** A shuffled copy (Fisher-Yates, with `random`). */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Draw `count` questions from the pool at random, mixing the kinds.
 *
 * 1. Group the pool by kind, and shuffle the kinds and each kind's questions
 *    (with `random`).
 * 2. Take one question from each kind in turn, then a second from each, until
 *    the draw is full. So six kinds give six kinds, and at most
 *    {@link PER_KIND} of one kind are taken here.
 * 3. If the draw is still short, because the pool has few kinds, fill it
 *    from the questions left, in their shuffled order.
 *
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
