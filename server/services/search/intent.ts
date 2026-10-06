// Query intent: what kind of question this is, before any model runs, in under
// a millisecond. Names, emails, phone numbers and quoted phrases are "local"
// kinds: local retrieval is the final answer and no model runs. Everything else
// shows the local list first and then asks the model. Each kind's weights are
// what `localRetrieval` gives the keyword and vector lists in the fusion.

import { searchTokens } from "./lexical.ts";
import { STRONG_APPROXIMATE_SCORE } from "./approximateName.ts";
import { isPhoneQuery } from "../../utils/nlp/phone.ts";
import { lookupGivenName, foldName } from "../../utils/nlp/givenNames.ts";
import {
  NICKNAME_GROUPS,
  areNicknameEquivalent,
} from "../../utils/nlp/nicknames.ts";

export type QueryKind =
  "email" | "phone" | "quoted" | "name" | "conceptual" | "mixed";

export interface IntentWeights {
  lexical: number;
  dense: number;
}

export interface QueryIntent {
  kind: QueryKind;
  /** Local retrieval is the final answer, and no model runs. */
  local: boolean;
  /** The fusion weight of each channel for this kind. */
  weights: IntentWeights;
  /** The query's tokens, lower case, accents folded. */
  tokens: string[];
}

/** The local evidence that a query is somebody's name. */
export interface NameSignals {
  /** Every local result's name starts with the query tokens. */
  namesStartWithTokens: boolean;
  /** The best approximate-name score among the local results, 0 for none. */
  bestApproximateScore: number;
  /** The first token is a known given name or nickname, and a result's name carries it. */
  givenNameHit: boolean;
}

/** A local result, as far as the name signals need it. */
export interface NamedResult {
  name: string;
  approximate?: boolean;
  score?: number;
}

const NO_SIGNALS: NameSignals = {
  namesStartWithTokens: false,
  bestApproximateScore: 0,
  givenNameHit: false,
};

/** Words that start a question, or that ask for a group of people. */
const QUESTION_WORDS = new Set([
  "who",
  "which",
  "what",
  "find",
  "show",
  "list",
  "people",
  "anyone",
  "someone",
  "somebody",
]);

/** An approximate name this close is a name, not a coincidence. */
export const NAME_SIGNAL_SCORE = STRONG_APPROXIMATE_SCORE;

const WEIGHTS: Record<"local" | "conceptual" | "mixed", IntentWeights> = {
  local: { lexical: 0.7, dense: 0.3 },
  conceptual: { lexical: 0.3, dense: 0.7 },
  mixed: { lexical: 0.5, dense: 0.5 },
};

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;
const QUOTED = /^(?:"[^"]+"|“[^“”]+”)$/;

const NICKNAMES = new Set(NICKNAME_GROUPS.flat());

/** The word tokens of a name or a query, folded. */
function wordTokens(text: string): string[] {
  return foldName(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * The name evidence in a set of local results.
 *
 * `results` are the strict keyword results of the query: exact rows first,
 * then approximate names with their similarity score.
 */
export function nameSignals(
  query: string,
  results: NamedResult[],
): NameSignals {
  const tokens = wordTokens(query);
  if (!tokens.length || !results.length) return NO_SIGNALS;
  const names = results.map((result) => wordTokens(result.name));

  const namesStartWithTokens =
    tokens.length <= 4 &&
    names.every((nameTokens) =>
      tokens.every((token) =>
        nameTokens.some((part) => part.startsWith(token)),
      ),
    );

  const bestApproximateScore = results.reduce(
    (best, result) =>
      result.approximate && typeof result.score === "number"
        ? Math.max(best, result.score)
        : best,
    0,
  );

  const first = tokens[0];
  const known = NICKNAMES.has(first) || lookupGivenName(first) !== null;
  const givenNameHit =
    known &&
    names.some((nameTokens) =>
      nameTokens.some((part) => areNicknameEquivalent(part, first)),
    );

  return { namesStartWithTokens, bestApproximateScore, givenNameHit };
}

/**
 * Classify a query:
 * - `email`: the query is an email address.
 * - `phone`: at least 7 digits, and digits plus `+()-. ` make up the query.
 * - `quoted`: the query is one quoted phrase.
 * - `name`: at most 4 tokens, no question word, and a name signal.
 * - `conceptual`: starts with a question word or has 5 or more tokens, and no
 *   name signal.
 * - `mixed`: everything else.
 *
 * Without `signals` a query can only be one of the first three, `conceptual` or
 * `mixed`.
 */
export function classifyQuery(
  query: string,
  signals: NameSignals = NO_SIGNALS,
): QueryIntent {
  const text = query.trim();
  const tokens = searchTokens(text).map(foldName);
  const result = (kind: QueryKind): QueryIntent => {
    const local = kind !== "conceptual" && kind !== "mixed";
    const weights = local ? WEIGHTS.local : WEIGHTS[kind];
    return { kind, local, weights: { ...weights }, tokens };
  };

  if (EMAIL.test(text)) return result("email");
  if (isPhoneQuery(text)) return result("phone");
  if (QUOTED.test(text)) return result("quoted");

  const nameSignal =
    signals.namesStartWithTokens ||
    signals.bestApproximateScore >= NAME_SIGNAL_SCORE ||
    signals.givenNameHit;
  const hasQuestionWord = tokens.some((token) => QUESTION_WORDS.has(token));
  if (tokens.length && tokens.length <= 4 && !hasQuestionWord && nameSignal)
    return result("name");
  if (
    (QUESTION_WORDS.has(tokens[0] ?? "") || tokens.length >= 5) &&
    !nameSignal
  )
    return result("conceptual");
  return result("mixed");
}
