/**
 * The pending pairs, as the groups a person reviews.
 *
 * The server stores pairs. Pairs (A, B) and (B, C) are one problem with
 * three contacts, so the review list shows one group for them, as the
 * count on every badge does (`getPendingClusterCount`).
 *
 * A group holds together only as well as its weakest needed link: if A and
 * B share an address and B and C only a similar name, merging all three
 * rests on the similar name. So the group's level comes from the bottleneck
 * of its strongest links (Kruskal's order: the pairs from the most sure
 * down, each joining two parts until one part remains), and any caveat in
 * the group makes it "Check carefully".
 *
 * @module views/dedupe/utils/groups
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
  /** The contact to keep first, then the rest by name, so a row reads the same each time. */
  contacts: SuggestedContact[];
  /** Every pending pair inside the group, the most sure first. */
  suggestions: PersistedDedupeSuggestion[];
  /** The most sure pair, whose reason the row shows. */
  lead: PersistedDedupeSuggestion;
  /** What a person should look twice at, each once. */
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
    // Path compression: every id on the way points at the root.
    for (let at = id; at !== root;) {
      const next = parent.get(at)!;
      parent.set(at, root);
      at = next;
    }
    return root;
  };
  /** The weakest link each part needed, kept on the part's root. */
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

  // The easy decisions first, then the sure ones before the unsure.
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
