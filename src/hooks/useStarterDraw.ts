/**
 * The questions under "Try asking", drawn once from the account's pool.
 *
 * The Ask page draws six and the palette's AI mode draws four, and both come
 * through here, so the two can never disagree about where their questions come
 * from. The pool is the server's (`GET /api/search/starters`), which the app
 * fetches in an idle moment, so the questions are there when a list opens.
 *
 * A draw is made when the list first has a pool, and it stays put while the
 * pool refreshes behind it, so no chip moves under a pointer. A new `draw`
 * number draws again: the Ask page's Clear bumps it. A pool that is empty, or
 * that failed to load, draws nothing: a question that finds nobody is worse
 * than no question.
 *
 * @module hooks/useStarterDraw
 */
import { useEffect, useState } from "react";
import { useStarterQuestions } from "../api";
import { drawSuggestions } from "../views/search/suggestions";

export function useStarterDraw(count: number, draw = 0): string[] {
  const pool = useStarterQuestions().data?.questions;
  const [drawn, setDrawn] = useState<{ draw: number; questions: string[] }>(
    () => ({ draw, questions: pool ? drawSuggestions(pool, count) : [] }),
  );
  useEffect(() => {
    if (!pool) return;
    setDrawn((current) =>
      current.draw === draw && current.questions.length > 0
        ? current
        : { draw, questions: drawSuggestions(pool, count) },
    );
  }, [pool, draw, count]);
  return drawn.questions;
}
