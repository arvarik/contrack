import crypto from "crypto";
import { sqlite } from "../../db.ts";
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
 * Compute a fitness score for a contact as a primary/keeper candidate.
 * Higher score = richer record = better primary.
 *
 * Accepts `HydratedContact | null` because callers pass `contactRepo.hydrate()`
 * results directly; hydrate() only returns null for malformed input rows, which
 * callers never provide (this was an implicit assumption under `any`).
 */
export function computePrimaryScore(candidate: HydratedContact | null): number {
  const contact = candidate!;
  let score = 0;

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

  const row = sqlite
    .prepare("SELECT COUNT(*) as c FROM interactions WHERE contactId = ?")
    .get(contact.id) as { c: number } | undefined;
  score += (row?.c ?? 0) * 5;

  if (contact.updatedAt) {
    const ageMs = Date.now() - new Date(contact.updatedAt).getTime();
    if (ageMs < 30 * 24 * 60 * 60 * 1000) score += 5;
  }

  if (contact.aiHydratedAt) score += 8;

  return score;
}

/** Select the contact with the highest primary score from a list. */
export function selectBestPrimary(
  contacts: HydratedContact[],
): HydratedContact {
  let best = contacts[0];
  let bestScore = computePrimaryScore(best);
  for (let i = 1; i < contacts.length; i++) {
    const score = computePrimaryScore(contacts[i]);
    if (score > bestScore) {
      best = contacts[i];
      bestScore = score;
    }
  }
  return best;
}

/**
 * Generate a human-readable summary describing why the cluster was grouped.
 */
export function generateClusterSummary(
  contacts: HydratedContact[],
  pairs: ClusterPair[],
): string {
  const parts: string[] = [];

  const emailPairs = pairs.filter((p) => p.matchType === "email");
  if (emailPairs.length > 0) {
    const emails = [
      ...new Set(emailPairs.map((p) => p.matchedField).filter(Boolean)),
    ];
    parts.push(
      `shared email${emails.length > 1 ? "s" : ""} ${emails.join(", ")}`,
    );
  }

  const phonePairs = pairs.filter((p) => p.matchType === "phone");
  if (phonePairs.length > 0) {
    const phones = [
      ...new Set(phonePairs.map((p) => p.matchedField).filter(Boolean)),
    ];
    parts.push(
      `shared phone${phones.length > 1 ? "s" : ""} ${phones.join(", ")}`,
    );
  }

  const namePairs = pairs.filter(
    (p) => p.matchType === "name" || p.matchType === "name_company",
  );
  if (namePairs.length > 0) {
    parts.push("exact name match");
  }

  const nickPairs = pairs.filter((p) => p.matchType === "nickname");
  if (nickPairs.length > 0) {
    const names = [...new Set(contacts.map((c) => c.name))];
    parts.push(`nickname match (${names.join(" ↔ ")})`);
  }

  const crossPairs = pairs.filter((p) => p.matchType === "cross_source");
  if (crossPairs.length > 0) {
    parts.push("same name from different import sources");
  }

  const fuzzyPairs = pairs.filter((p) => p.matchType === "fuzzy");
  if (fuzzyPairs.length > 0) {
    parts.push("high composite similarity");
  }

  const aiPairs = pairs.filter((p) => p.matchType === "ai");
  if (aiPairs.length > 0 && namePairs.length === 0 && nickPairs.length === 0) {
    const names = [...new Set(contacts.map((c) => c.name))];
    if (names.length > 1) {
      parts.push(`AI-confirmed match (${names.join(" ↔ ")})`);
    }
  }

  if (parts.length === 0) {
    return `${contacts.length} contacts may represent the same person.`;
  }

  return `These ${contacts.length} contacts have ${parts.join(" and ")}.`;
}

/** Clusters above this size require explicit user confirmation before merging */
const LARGE_CLUSTER_THRESHOLD = 10;

/**
 * Group detected pairs into clusters using Union-Find transitive closure.
 */
export function buildClusters(
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

  for (const [, memberIds] of clusterGroups) {
    const contacts = memberIds
      .map((id) => contactMap.get(id))
      .filter(Boolean)
      // Non-null assertion: hydrate() only returns null for malformed rows,
      // and every input here is a live row from contactMap.
      .map((raw) => contactRepo.hydrate(raw)!);

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
      }));

    const primary = selectBestPrimary(contacts);
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
