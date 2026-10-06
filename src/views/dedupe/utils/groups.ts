/**
 * The pending pairs, joined into the groups a person reviews: (A, B) and
 * (B, C) are one group, as the badge count (`getPendingClusterCount`) says.
 *
 * A group is only as sure as its weakest needed link, so its confidence is
 * the bottleneck of its strongest links, joined in Kruskal's order. Any
 * caveat makes the group "Check carefully".
 */
import type {
  PersistedDedupeSuggestion,
  SuggestedContact,
} from "../../../types";
import { LEVEL_ORDER, matchLevel, type MatchLevel } from "./level";
import { pairCaveats } from "./reason";
import { suggestKeeper } from "./mergeOutcome";

export interface DuplicateGroup {
  /** The members' ids, sorted and joined: stable while the members stay. */
  key: string;
  /** The suggested keeper first, then the rest by name. */
  contacts: SuggestedContact[];
  /** The most sure first. */
  suggestions: PersistedDedupeSuggestion[];
  /** The most sure pair, whose reason the row shows. */
  lead: PersistedDedupeSuggestion;
  caveats: string[];
  /** The weakest link the group needs. */
  confidence: number;
  level: MatchLevel;
}

export function buildGroups(
  suggestions: PersistedDedupeSuggestion[],
): DuplicateGroup[] {
  const usable = suggestions
    .filter((s) => s.contactA && s.contactB)
    .sort((a, b) => b.confidence - a.confidence);

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.has(root) && parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    // Path compression.
    for (let at = id; at !== root;) {
      const next = parent.get(at)!;
      parent.set(at, root);
      at = next;
    }
    return root;
  };
  /** The weakest link each part needs, keyed by the part's root. */
  const bottleneck = new Map<string, number>();
  const contacts = new Map<string, SuggestedContact>();

  for (const s of usable) {
    contacts.set(s.contactIdA, s.contactA!);
    contacts.set(s.contactIdB, s.contactB!);
    if (!parent.has(s.contactIdA)) parent.set(s.contactIdA, s.contactIdA);
    if (!parent.has(s.contactIdB)) parent.set(s.contactIdB, s.contactIdB);
    const a = find(s.contactIdA);
    const b = find(s.contactIdB);
    if (a === b) continue;
    parent.set(b, a);
    bottleneck.set(
      a,
      Math.min(bottleneck.get(a) ?? 1, bottleneck.get(b) ?? 1, s.confidence),
    );
  }

  const byRoot = new Map<string, PersistedDedupeSuggestion[]>();
  for (const s of usable) {
    const root = find(s.contactIdA);
    byRoot.set(root, [...(byRoot.get(root) ?? []), s]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [root, pairs] of byRoot) {
    const ids = [
      ...new Set(pairs.flatMap((s) => [s.contactIdA, s.contactIdB])),
    ];
    const caveats = [
      ...new Set(pairs.flatMap((s) => pairCaveats(s.caveat, s.reasoning))),
    ];
    const confidence = bottleneck.get(root) ?? pairs[0].confidence;
    const members = ids
      .map((id) => contacts.get(id)!)
      .sort((x, y) => x.name.localeCompare(y.name) || x.id.localeCompare(y.id));
    const keeper = suggestKeeper(members);
    groups.push({
      key: [...ids].sort().join(","),
      contacts: [keeper, ...members.filter((c) => c !== keeper)],
      suggestions: pairs,
      lead: pairs[0],
      caveats,
      confidence,
      level: matchLevel(confidence, caveats[0]),
    });
  }

  // By level, then the sure before the unsure.
  return groups.sort(
    (a, b) =>
      LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
      b.confidence - a.confidence,
  );
}

/** The pairs that tie one member to the rest of its group. */
export function pairsOf(
  group: DuplicateGroup,
  contactId: string,
): PersistedDedupeSuggestion[] {
  return group.suggestions.filter(
    (s) => s.contactIdA === contactId || s.contactIdB === contactId,
  );
}
