// The semantic cache (L2). L1 (`getCachedSearch`) answers a question typed the
// same way twice. L2 answers one asked in other words, "Berlin founders" after
// "founders in Berlin", with no model call. It keeps the verified answers of
// the last five minutes, up to 100 per account, each with the query vector the
// local stage computed. A new question reuses an answer when all of these hold:
//
// - the same account, search revision and notes revision, so no contact, note
//   or merge changed since;
// - the same facets and answer source (provider and model);
// - the same entity key: the capitalized words, numbers, quoted phrases and
//   email addresses in the question;
// - the same ordered constraint text and comparison operators, once proven
//   facets and leading request words are removed;
// - a cosine similarity of 0.97 or more between the two query vectors.
//
// On the built-in MiniLM model, word-order paraphrases score 0.96 to 0.99 and
// city swaps ("founders in Berlin", "founders in Munich") 0.79 to 0.85. The
// entity key blocks a swapped name, number or place even when the vectors are
// close. The threshold holds for the built-in model only, so a provider's
// embedding model turns this tier off.
//
// The revisions are the only invalidation an edit needs: the search_revision
// triggers bump on every change to a searched column, tag, interest, email or
// phone, and on every merge, and the notes revision (`notesRevision` in
// searchService.ts) follows notes. A flush of every AI cache tier (a change of
// AI settings) empties this tier too.

import type { Scope } from "../../tenancy/scope.ts";
import { aiCache } from "../../utils/aiCache.ts";

/** What an answer was computed from. Every field must match for a hit. */
export interface SemanticKey {
  /** The owner's search revision when the answer was computed. */
  revision: number;
  /** The owner's notes revision when the answer was computed. */
  notes: number;
  /** The serialized facets the answer applied (`facetKey`). */
  facets: string;
  /** The provider and model that verified the answer. */
  answeredBy: string;
  /** `entityKey` of the question. */
  entities: string;
  /** Ordered constraint text after deterministic facets and request wording. */
  constraints: string;
  /** The question's vector, from the local stage. */
  vector: Float32Array;
}

/** Minimum similarity after the constraint, entity and scope checks pass. */
export const SEMANTIC_THRESHOLD = 0.97;

/** How long an answer stays reusable. */
export const SEMANTIC_TTL_MS = 5 * 60_000;

/** Answers kept per account. The oldest goes first. */
export const SEMANTIC_PER_OWNER = 100;

/** Accounts kept. The one that searched least recently goes first. */
const MAX_OWNERS = 50;

interface Entry extends SemanticKey {
  norm: number;
  value: unknown;
  createdAt: number;
}

/** Entries per owner. Map order is the order owners last searched in. */
const byOwner = new Map<string, Entry[]>();

/** Words that ask a question rather than name something. */
const FUNCTION_WORDS = new Set([
  "a",
  "all",
  "an",
  "and",
  "any",
  "anybody",
  "anyone",
  "are",
  "at",
  "can",
  "could",
  "did",
  "do",
  "does",
  "everyone",
  "find",
  "for",
  "from",
  "get",
  "give",
  "how",
  "i",
  "i'd",
  "i'm",
  "i've",
  "in",
  "is",
  "list",
  "me",
  "my",
  "of",
  "on",
  "or",
  "people",
  "please",
  "show",
  "somebody",
  "someone",
  "tell",
  "the",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "whose",
  "why",
  "with",
]);

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/’/g, "'")
    .toLowerCase();

/**
 * The names in a question as one string: capitalized words, numbers, quoted
 * phrases and email addresses, folded and sorted. A capitalized word that only
 * starts a question ("Who", "Find", "I") is not a name, so asking words are
 * left out. Case and accents are folded, so "Zürich" and "ZURICH" are one. A
 * question all in lower case has no capitalized words, and matches only another
 * with none.
 */
export function entityKey(question: string): string {
  const entities = new Set<string>();
  const rest = question
    .replace(/[^\s@"“”]+@[^\s@"“”]+\.[^\s@"“”]+/g, (email) => {
      entities.add(fold(email));
      return " ";
    })
    .replace(
      /"([^"]+)"|“([^”]+)”/g,
      (_quote, plain?: string, curly?: string) => {
        entities.add(fold((plain ?? curly ?? "").trim()));
        return " ";
      },
    );
  for (const number of rest.match(/\d+(?:[.,]\d+)*/g) ?? [])
    entities.add(number);
  for (const word of rest.match(/\p{Lu}[\p{L}\p{M}'’-]*/gu) ?? []) {
    const folded = fold(word);
    if (!FUNCTION_WORDS.has(folded)) entities.add(folded);
  }
  return [...entities].sort().join("|");
}

/**
 * Keep the order and operators of the remaining question. MiniLM scores "AI and
 * machine learning" against "AI or machine learning" above 0.97, and confuses
 * opposite career moves, so similar vectors cannot allow a different
 * constraint. Only leading request words are ignored. The caller removes proven
 * facets first, so a place can move in a question without changing this key.
 */
export function constraintKey(question: string, remainder = question): string {
  let text = fold(remainder).replace(/\s+/g, " ").trim();
  text = text
    .replace(/^please /, "")
    .replace(/^(?:find|show|list|give)(?: me)? /, "")
    .replace(/^(?:who|which people|people who|contacts who)(?: are| is)? /, "");
  // The facet parser tokenizes words, so preserve operators from the
  // original question too. Otherwise "> 10" and "< 10" become identical.
  const operators = question.match(/[^\p{L}\p{M}\p{N}\s.,?？'’"-]/gu) ?? [];
  return JSON.stringify([text.replace(/[?？]+$/, "").trim(), operators]);
}

function norm(vector: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i];
  return Math.sqrt(sum);
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/** The owner's live entries, with every expired one removed. */
function liveEntries(ownerId: string, now: number): Entry[] {
  const entries = byOwner.get(ownerId);
  if (!entries) return [];
  const live = entries.filter(
    (entry) => now - entry.createdAt < SEMANTIC_TTL_MS,
  );
  if (live.length !== entries.length) {
    if (live.length) byOwner.set(ownerId, live);
    else byOwner.delete(ownerId);
  }
  return live;
}

/**
 * The closest answer to `key` at 0.97 or more, or null. Only this owner's
 * entries are read, and an entry must match the revision, facets, answer source
 * and entity key before its vector counts.
 */
export function getSemanticAnswer<T>(scope: Scope, key: SemanticKey): T | null {
  const entries = liveEntries(scope.ownerId, Date.now());
  const size = norm(key.vector);
  if (!entries.length || size === 0) return null;
  let best: Entry | null = null;
  let bestScore = SEMANTIC_THRESHOLD;
  for (const entry of entries) {
    if (
      entry.revision !== key.revision ||
      entry.notes !== key.notes ||
      entry.facets !== key.facets ||
      entry.answeredBy !== key.answeredBy ||
      entry.entities !== key.entities ||
      entry.constraints !== key.constraints ||
      entry.vector.length !== key.vector.length
    )
      continue;
    const cosine = dot(entry.vector, key.vector) / (entry.norm * size);
    if (cosine >= bestScore) {
      best = entry;
      bestScore = cosine;
    }
  }
  if (!best) return null;
  // The owner searched now, so it moves to the end of the eviction order.
  byOwner.delete(scope.ownerId);
  byOwner.set(scope.ownerId, entries);
  return best.value as T;
}

/** Keep a verified answer with the key it was computed from. */
export function setSemanticAnswer(
  scope: Scope,
  key: SemanticKey,
  value: unknown,
): void {
  const size = norm(key.vector);
  if (size === 0) return;
  const entries = liveEntries(scope.ownerId, Date.now());
  entries.push({
    ...key,
    // A copy: the caller's vector can be a view of a buffer that is reused.
    vector: Float32Array.from(key.vector),
    norm: size,
    value,
    createdAt: Date.now(),
  });
  if (entries.length > SEMANTIC_PER_OWNER)
    entries.splice(0, entries.length - SEMANTIC_PER_OWNER);
  byOwner.delete(scope.ownerId);
  byOwner.set(scope.ownerId, entries);
  while (byOwner.size > MAX_OWNERS) {
    const oldest = byOwner.keys().next().value;
    if (oldest === undefined) break;
    byOwner.delete(oldest);
  }
}

/** How many answers an owner has, live or not yet pruned. Tests only. */
export function semanticEntryCount(ownerId: string): number {
  return byOwner.get(ownerId)?.length ?? 0;
}

/** Forget every answer. */
export function clearSemanticCache(): void {
  byOwner.clear();
}

aiCache.onInvalidateAll(clearSemanticCache);
