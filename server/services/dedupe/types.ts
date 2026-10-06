// Shared Types for Dedupe Engine

import type { NormalizedContact } from "./normalization.ts";
import type { Scope } from "../../tenancy/scope.ts";
import type { ContactRow, HydratedContact } from "../../repositories/types.ts";
export type { NormalizedContact, ContactRow, HydratedContact };

export type MatchType =
  | "email"
  | "phone"
  | "name"
  | "name_company"
  | "nickname"
  /** One name is the other with middle names added. */
  | "middle_name"
  /** The same personal profile link, such as one LinkedIn page. */
  | "social"
  | "cross_source"
  | "fuzzy"
  | "ai"
  /**
   * A name in a note that might be a contact the account has. Written by
   * mention resolution, not a scan, but a pair like any other: the ghost the
   * note made and the person it looks like. Accepting it merges the ghost away,
   * and the mention follows.
   */
  | "mention";

export interface RawPair {
  idA: string;
  idB: string;
  matchType: MatchType;
  confidence: number;
  /** Why the two look like one person, in plain words with no numbers. */
  reasoning: string;
  matchedField?: string;
  /** Why to look twice before merging, or null. See `WeighedMatch.caveat`. */
  caveat?: string | null;
}

/**
 * How many active contacts in one account carry each value, built once per scan
 * or import by `countValues` in policy.ts. A match on a value three contacts
 * carry is weaker than one on a value two carry.
 */
export interface ValueFrequency {
  /** Lowercased email address → contacts carrying it. */
  emails: Map<string, number>;
  /** Normalized phone number → contacts carrying it. */
  phones: Map<string, number>;
  /** Normalized full name → contacts carrying it. */
  names: Map<string, number>;
}

export interface PassContext {
  /**
   * The one account this scan runs for. A pass reads whole child tables through
   * the context, not a parameter, so the owner travels with the rows it
   * selected, and a context built for one account never hands a pass another's
   * candidate.
   */
  scope: Scope;
  allContacts: ContactRow[];
  contactMap: Map<string, ContactRow>;
  normalized: NormalizedContact[];
  normalizedMap: Map<string, NormalizedContact>;
  seenPairs: Set<string>;
  distinctPairs: Set<string>;
  socialUrlsByContact: Map<string, string[]>;
  /** How widely each address, number and name is shared in the account. */
  frequency: ValueFrequency;
  embeddingSimCache: Map<string, number>;
  rid: string;
}

export type PairClassification = "auto" | "ai" | "discard";

export interface MatchSignals {
  /** A shared address that names a person. An identity anchor. */
  emailOverlap: boolean;
  /**
   * A shared address that names a group (`info@`, `team.x@`, `smith.family@`):
   * the two share an employer or a household, not an identity. Scored like a
   * company match, not like `emailOverlap`.
   */
  sharedMailboxOverlap: boolean;
  phoneOverlap: boolean;
  socialUrlOverlap: boolean;
  nameExactMatch: boolean;
  nicknameMatch: boolean;
  nameJaroWinkler: number;
  nameMetaphoneMatch: boolean;
  lastNameExactMatch: boolean;
  companyMatch: boolean;
  companyFuzzy: number;
  locationOverlap: boolean;
  isCrossSource: boolean;
  isKnownDistinct: boolean;
  embeddingSimilarity: number;
  /**
   * The two names say two different people: first names that are not the same,
   * a nickname, an initial, a near spelling or the same sound, or two different
   * generational suffixes. A shared identifier between such names is a
   * household or an office, and the pair is capped below every auto-merge
   * preset.
   */
  namesContradict: boolean;
  /**
   * How many contacts in the account carry the shared value: two when only the
   * pair does or the count is unknown. Each carrier beyond two weakens the
   * match.
   */
  emailCarriers: number;
  phoneCarriers: number;
  nameCarriers: number;
}

export type DedupeScanMode = "quick" | "deep" | "full";
export type DedupeScanPhase =
  | "starting"
  | "normalizing"
  | "deterministic"
  | "blocking"
  | "scoring"
  | "ai"
  | "clustering"
  | "persisting"
  | "complete"
  | "error";

export interface DedupeScanProgress {
  scanId: string;
  mode: DedupeScanMode;
  phase: DedupeScanPhase;
  phaseName: string;
  contactsScanned: number;
  totalContacts: number;
  deterministicFound: number;
  aiCandidatesFound: number;
  aiEvaluated: number;
  blockingCandidates: number;
  scoringAutoMerge: number;
  scoringAiQueue: number;
  scoringDiscarded: number;
  clustersFound: number;
  totalPairs: number;
  autoMerged: number;
  pendingSuggestions: number;
  clusters: DedupeCluster[];
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export interface ClusterPair {
  contactIdA: string;
  contactIdB: string;
  matchType: MatchType;
  confidence: number;
  reasoning: string;
  matchedField?: string;
  caveat?: string | null;
}

export interface DedupeCluster {
  id: string;
  contacts: HydratedContact[];
  suggestedPrimaryId: string;
  pairs: ClusterPair[];
  aggregateConfidence: number;
  summary: string;
  size: number;
  hasWeakLink: boolean;
  minConfidence: number;
  /** True for clusters with >10 contacts — requires explicit user confirmation before merge */
  requiresConfirmation: boolean;
}

export interface MergeConflict {
  type: "scalar_edited" | "record_edited" | "record_deleted" | "task_completed";
  entity: string;
  id?: string;
  field?: string;
  primaryValue?: unknown;
  duplicateValue?: unknown;
  currentValue?: unknown;
  oldValue?: unknown;
  message: string;
}

export interface MergeSnapshotData {
  version: 1;
  primaryId: string;
  duplicateId: string;
  primary: {
    contact: Record<string, unknown>;
    listIds: string[];
    emails: Array<Record<string, unknown>>;
    phones: Array<Record<string, unknown>>;
    addresses: Array<Record<string, unknown>>;
    attributes: Array<Record<string, unknown>>;
  };
  duplicate: {
    contact: Record<string, unknown>;
    listIds: string[];
    emails: Array<Record<string, unknown>>;
    phones: Array<Record<string, unknown>>;
    addresses: Array<Record<string, unknown>>;
    socialLinks: Array<Record<string, unknown>>;
    education: Array<Record<string, unknown>>;
    experience: Array<Record<string, unknown>>;
    sources: Array<Record<string, unknown>>;
    tags: Array<Record<string, unknown>>;
    interests: Array<Record<string, unknown>>;
    attributes: Array<Record<string, unknown>>;
    interactions: Array<Record<string, unknown>>;
    actionItems: Array<Record<string, unknown>>;
    mentions: Array<{ interactionId: string; contactId: string }>;
  };
  changes: {
    movedRecords: {
      interactions: string[];
      actionItems: string[];
      emails: string[];
      phones: string[];
      socialLinks: string[];
      education: string[];
      experience: string[];
      sources: string[];
      tags: string[];
      interests: string[];
      attributes: string[];
      addresses: string[];
    };
    movedMentions: string[];
    deletedMentions: string[];
    scalarUpdates: Record<
      string,
      { oldValue: unknown; transferredValue: unknown }
    >;
    addedListIds: string[];
    addedAtUpdated?: { oldAddedAt: string | null; newAddedAt: string | null };
  };
}

export interface UndoMergeResult {
  restoredContactId: string;
  conflicts: MergeConflict[];
  /** Whether the undo also recorded the two as different people. */
  keptSeparate: boolean;
}
