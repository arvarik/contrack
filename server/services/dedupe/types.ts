// =============================================================================
// Shared Types for Dedupe Engine
// =============================================================================

import type { NormalizedContact } from "./normalization.ts";
export type { NormalizedContact };

export type MatchType = 'email' | 'phone' | 'name' | 'name_company' | 'nickname' | 'cross_source' | 'fuzzy' | 'ai';

export interface RawPair {
  idA: string;
  idB: string;
  matchType: MatchType;
  confidence: number;
  reasoning: string;
  matchedField?: string;
}

export interface PassContext {
  allContacts: any[];
  contactMap: Map<string, any>;
  normalized: NormalizedContact[];
  normalizedMap: Map<string, NormalizedContact>;
  seenPairs: Set<string>;
  distinctPairs: Set<string>;
  socialUrlsByContact: Map<string, string[]>;
  embeddingSimCache: Map<string, number>;
  rid: string;
}

export type PairClassification = "auto" | "ai" | "discard";

export interface MatchSignals {
  emailOverlap: boolean;
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
}

export type DedupeScanMode = 'deterministic' | 'ai' | 'both' | 'quick' | 'deep' | 'full';
export type DedupeScanPhase = 'starting' | 'normalizing' | 'deterministic' | 'blocking' | 'scoring' | 'ai' | 'clustering' | 'persisting' | 'complete' | 'error';

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
}

export interface DedupeCluster {
  id: string;
  contacts: any[];           
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
