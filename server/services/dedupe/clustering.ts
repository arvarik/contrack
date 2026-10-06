import crypto from "crypto";
import { sqlite } from "../../db.ts";
import type { Scope } from "../../tenancy/scope.ts";
import { log } from "../../utils/logger.ts";
import { contactRepo } from "../../repositories/contactRepository.ts";
import { UnionFind } from "../../utils/unionFind.ts";
import type {
  RawPair,
  DedupeCluster,
  ClusterPair,
  ContactRow,
  HydratedContact,
} from "./types.ts";

/**
 * A contact's fitness to be the one a merge keeps: a richer record scores
 * higher. Takes `HydratedContact | null` because callers pass
 * `contactRepo.hydrate()` results directly; hydrate() returns null only for a
 * malformed row, which callers never pass.
 */
export function computePrimaryScore(
  scope: Scope,
  candidate: HydratedContact | null,
): number {
  const contact = candidate!;
  let score = 0;

  // A ghost never survives a merge with a real contact. A ghost is a name a
  // model pulled out of a note; the other side is somebody the account added.
  // Every other term counts fields, and a bare real contact scores the same 5
  // as a ghost, so without this the survivor would be whichever id sorts first.
  // Mention resolution queues exactly this pair (a ghost and the contact it may
  // be), so it is the common case. Large enough to decide: a ghost has a name
  // and sometimes a company, so it scores at most about 8.
  if (contact.isGhost) score -= 50;

  // Custom imported avatar = massive priority boost (user invested effort)
  if (contact.avatarUrl) {
    const isCustom = contact.avatarUrl.startsWith("/uploads/avatars/");
    score += isCustom ? 100 : 5;
  }
  if (contact.about) score += 5;
  if (contact.role) score += 3;
  if (contact.company) score += 3;
  if (contact.location) score += 2;
  if (contact.industry) score += 2;
  if (contact.website) score += 2;

  score += (contact.emails?.length ?? 0) * 3;
  score += (contact.phones?.length ?? 0) * 3;
  score += (contact.socialLinks?.length ?? 0) * 2;
  score += contact.tags?.length ?? 0;
  score += (contact.education?.length ?? 0) * 2;
  score += (contact.experience?.length ?? 0) * 2;

  const interactionCount =
    contact.interactionCount ??
    (
      sqlite
        .prepare(
          `SELECT COUNT(*) as c FROM interactions
            WHERE contactId = ? AND ownerId = ?`,
        )
        .get(contact.id, scope.ownerId) as { c: number } | undefined
    )?.c ??
    0;
  score += interactionCount * 5;

  if (contact.updatedAt) {
    const ageMs = Date.now() - new Date(contact.updatedAt).getTime();
    if (ageMs < 30 * 24 * 60 * 60 * 1000) score += 5;
  }

  if (contact.aiHydratedAt) score += 8;

  return score;
}

/** Select the contact with the highest primary score from a list. */
export function selectBestPrimary(
  scope: Scope,
  contacts: HydratedContact[],
): HydratedContact {
  if (contacts.length === 0) {
    throw new Error("Cannot select primary contact from empty array");
  }
  let best = contacts[0];
  let bestScore = computePrimaryScore(scope, best);
  for (let i = 1; i < contacts.length; i++) {
    const score = computePrimaryScore(scope, contacts[i]);
    if (score > bestScore) {
      best = contacts[i];
      bestScore = score;
    }
  }
  return best;
}

/** What each kind of match says, in the summary of a group. */
const SUMMARY_PHRASE: Partial<Record<ClusterPair["matchType"], string>> = {
  email: "same email address",
  phone: "same phone number",
  social: "same profile link",
  name: "same name",
  name_company: "same name",
  cross_source: "same name",
  nickname: "a nickname",
  middle_name: "a middle name added",
  fuzzy: "similar details",
  ai: "checked by AI",
  mention: "mentioned in a note",
};

/**
 * Why a group was put together, in plain words: "Same email address" for a
 * pair, "3 contacts: same email address, similar details" for a group. The
 * matched values stay in each pair's `matchedField`.
 */
export function generateClusterSummary(
  contacts: HydratedContact[],
  pairs: ClusterPair[],
): string {
  const phrases = [
    ...new Set(
      pairs
        .map((p) => SUMMARY_PHRASE[p.matchType])
        .filter((p): p is string => !!p),
    ),
  ];
  const list = phrases.length > 0 ? phrases.join(", ") : "may be one person";
  if (contacts.length <= 2) {
    return `${list.charAt(0).toUpperCase()}${list.slice(1)}`;
  }
  return `${contacts.length} contacts: ${list}`;
}

/** Clusters above this size require explicit user confirmation before merging */
const LARGE_CLUSTER_THRESHOLD = 10;

/**
 * Group detected pairs into clusters using Union-Find transitive closure.
 */
export function buildClusters(
  scope: Scope,
  pairs: RawPair[],
  contactMap: Map<string, ContactRow>,
  rid: string,
): DedupeCluster[] {
  if (pairs.length === 0) return [];

  const uf = new UnionFind();
  for (const pair of pairs) {
    uf.union(pair.idA, pair.idB);
  }

  const clusterGroups = uf.getClusters();
  const clusters: DedupeCluster[] = [];

  // Pre-hydrate all cluster member contacts in a single batch to avoid N+1 queries
  const allMemberIds = [
    ...new Set(Array.from(clusterGroups.values()).flatMap((ids) => ids)),
  ];
  const rawRows = allMemberIds.map((id) => contactMap.get(id)).filter(Boolean);
  const hydratedMap = new Map(
    contactRepo.hydrateMany(rawRows).map((c) => [c.id, c]),
  );

  for (const [, memberIds] of clusterGroups) {
    const contacts = memberIds
      .map((id) => hydratedMap.get(id))
      .filter((c): c is HydratedContact => !!c);

    if (contacts.length < 2) continue;

    const clusterRoot = uf.find(memberIds[0]);
    const clusterPairs: ClusterPair[] = pairs
      .filter((p) => uf.find(p.idA) === clusterRoot)
      .map((p) => ({
        contactIdA: p.idA,
        contactIdB: p.idB,
        matchType: p.matchType,
        confidence: p.confidence,
        reasoning: p.reasoning,
        matchedField: p.matchedField,
        caveat: p.caveat ?? null,
      }));

    const primary = selectBestPrimary(scope, contacts);
    const confidences = clusterPairs.map((p) => p.confidence);
    const aggregateConfidence = Math.max(...confidences);
    const minConfidence = Math.min(...confidences);
    const isLarge = contacts.length > LARGE_CLUSTER_THRESHOLD;

    if (isLarge) {
      log.warn(
        "DedupeService",
        `[${rid}] Large cluster detected: ${contacts.length} contacts (threshold: ${LARGE_CLUSTER_THRESHOLD}) — will require user confirmation`,
      );
    }

    clusters.push({
      id: crypto.randomUUID(),
      contacts,
      suggestedPrimaryId: primary.id,
      pairs: clusterPairs,
      aggregateConfidence,
      summary: generateClusterSummary(contacts, clusterPairs),
      size: contacts.length,
      hasWeakLink: minConfidence < 0.6,
      minConfidence,
      requiresConfirmation: isLarge,
    });
  }

  clusters.sort((a, b) => b.aggregateConfidence - a.aggregateConfidence);
  log.info(
    "DedupeService",
    `[${rid}] Clustered ${pairs.length} pair(s) into ${clusters.length} cluster(s)`,
  );
  return clusters;
}
