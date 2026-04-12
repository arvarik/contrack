/**
 * Shared Frontend Type Definitions.
 *
 * These interfaces define the JSON shapes consumed by React components and
 * React Query hooks. They mirror the server's `HydratedContact` shape from
 * `server/repositories/types.ts` — if you modify one, verify the other.
 *
 * @see {@link file://server/repositories/types.ts} — Server-side counterpart
 */

// =============================================================================
// Normalized Child Entity Types
// =============================================================================

export interface ContactEmail {
  id: string;
  email: string;
  label: string;
  isPrimary: boolean;
  source: string | null;
}

export interface ContactPhone {
  id: string;
  phone: string;
  label: string;
  isPrimary: boolean;
  source: string | null;
}

export interface ContactSocialLink {
  id: string;
  platform: string;
  url: string;
  handle: string | null;
  source: string | null;
}

export interface ContactEducation {
  id: string;
  school: string;
  degree: string | null;
  fieldOfStudy: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

export interface ContactExperience {
  id: string;
  company: string;
  role: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  description: string | null;
  location: string | null;
}

export interface ContactSource {
  id: string;
  platform: string;
  externalId: string | null;
  connectedOn: string | null;
  importedAt: string;
}

export interface ContactTag {
  id: string;
  tag: string;
}

export interface ContactList {
  id: string;
  name: string;
  icon: string;
  sortOrder: number;
  createdAt: string;
  memberCount?: number;
}

export interface ContactAddress {
  id: string;
  address: string;
  label: string;
  isPrimary: boolean;
}

// =============================================================================
// Primary Entity Types
// =============================================================================

export interface Contact {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  headline: string | null;
  role: string | null;
  company: string | null;
  location: string | null;
  birthday: string | null;
  preferences: string | null;
  avatarUrl: string | null;
  isGhost: boolean;
  isArchived: boolean;
  addedAt: string;
  updatedAt: string;
  cadenceDays: number;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  themeColor: string;
  about: string | null;
  pronouns: string | null;
  industry: string | null;
  website: string | null;
  lat: number | null;
  lng: number | null;
  aiBriefing?: string | null;
  aiBriefingAt?: string | null;
  aiSummary?: string | null;
  aiBackground?: string | null;
  aiHydratedAt?: string | null;
  // Relations (populated by server JOINs)
  emails: ContactEmail[];
  phones: ContactPhone[];
  socialLinks: ContactSocialLink[];
  education: ContactEducation[];
  experience: ContactExperience[];
  sources: ContactSource[];
  tags: ContactTag[];
  lists: ContactList[];
  addresses: ContactAddress[];
  interests: { id: string; interest: string; isAiGenerated?: boolean; }[];
  attributes: { id: string; name: string; value: string; }[];
  interactionCount?: number;
  relationshipScore?: number;
  /** Computed by API — number of social links (available in slim view) */
  socialLinkCount?: number;
}

/**
 * Mutation payload type for contact updates.
 *
 * Intentionally looser than `Partial<Contact>` because the server accepts
 * partial child entities (e.g., emails without `id`, addresses without
 * `source`), which TypeScript's strict Partial<ContactEmail>[] rejects.
 */
export type ContactUpdateData = Partial<Omit<Contact,
  'emails' | 'phones' | 'addresses' | 'socialLinks' | 'interests' | 'attributes' |
  'education' | 'experience' | 'sources' | 'tags' | 'lists'
>> & {
  emails?: Partial<ContactEmail>[];
  phones?: Partial<ContactPhone>[];
  addresses?: Partial<ContactAddress>[];
  socialLinks?: Partial<ContactSocialLink>[];
  interests?: { id?: string; interest: string; isAiGenerated?: boolean }[];
  attributes?: { id?: string; name: string; value: string }[];
  tags?: Partial<ContactTag>[];
};

/** Well-known types: note, call, meeting, email, message, sms, import, linkedin, facebook */
export interface Interaction {
  id: string;
  contactId: string;
  type: string;
  title: string;
  content: string | null;
  date: string;
  duration: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  source?: string | null;
  mentions?: string | null;
  isViaName?: string | null;
  isViaId?: string | null;
  updatedAt?: string | null;
  actionItems?: {
    id: string;
    title: string;
    dueAt: string;
    completedAt: string | null;
  }[];
  /** Write-only — accepted by POST to create a linked action item */
  actionItem?: { title: string; dueAt: string };
}

export interface ActionItem {
  id: string;
  contactId: string;
  title: string;
  dueAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Joined from contacts (only on global list endpoints)
  contactName?: string;
  contactCompany?: string | null;
  contactAvatarUrl?: string | null;
  contactThemeColor?: string;
}



// =============================================================================
// Dedupe Engine Types
// =============================================================================

/** @deprecated Pairwise suggestion — kept for backward compat during Phase 3 migration. */
export interface DedupeSuggestion {
  id: string;
  contactA: Contact;
  contactB: Contact;
  matchType: 'email' | 'phone' | 'ai';
  confidence: number;
  reasoning: string;
  matchedField?: string;
}

/** A single piece of evidence connecting two contacts within a cluster. */
export interface ClusterPair {
  contactIdA: string;
  contactIdB: string;
  matchType: 'email' | 'phone' | 'name' | 'name_company' | 'nickname' | 'cross_source' | 'fuzzy' | 'ai';
  confidence: number;
  reasoning: string;
  matchedField?: string;
}

/** A group of contacts that the engine believes represent the same person. */
export interface DedupeCluster {
  id: string;
  contacts: Contact[];
  suggestedPrimaryId: string;
  pairs: ClusterPair[];
  aggregateConfidence: number;
  summary: string;
  size: number;
  hasWeakLink: boolean;
  minConfidence: number;
  /** True for clusters with >10 contacts — requires explicit confirmation before merge */
  requiresConfirmation: boolean;
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
  suggestions: DedupeSuggestion[];    // Deprecated — kept for backward compat only
  clustersFound: number;
  totalPairs: number;
  autoMerged: number;
  pendingSuggestions: number;
  clusters: DedupeCluster[];
  error?: string;
  startedAt: string;
  completedAt?: string;
}

// =============================================================================
// Semantic RAG Search Types
// =============================================================================

/**
 * A contact returned from a semantic AI search, augmented with Gemini's
 * one-sentence explanation of why it matched the query.
 * `aiReason` is null when the FTS5 fallback path fires instead of Gemini.
 */
export interface SemanticMatch extends Contact {
  aiReason: string | null;
}

/**
 * Full response envelope from POST /api/search/semantic.
 * `fallback: true` signals that Gemini was unavailable and the results
 * are plain FTS5 keyword matches with no AI reasoning.
 */
export interface SemanticSearchResult {
  matches: SemanticMatch[];
  fallback: boolean;
  tokensUsed?: number;
}

// =============================================================================
// AI Search Types
// =============================================================================

/** Status lifecycle: queued → searching → merging → success | error */
export type AISearchJobStatus = 'queued' | 'searching' | 'merging' | 'success' | 'error';

/** Error classification for contextual UI messages. */
export type AISearchErrorType =
  | 'rate_limit'
  | 'validation'
  | 'network'
  | 'auth'
  | 'ambiguous'
  | 'unknown';

export interface AISearchJob {
  id: string;
  contactId: string;
  contactName: string;
  status: AISearchJobStatus;
  error?: string;
  errorType?: AISearchErrorType;
  fieldsUpdated: number;
  startedAt?: string;
  completedAt?: string;
  latencyMs?: number;
}

export interface AISearchBatch {
  id: string;
  strategy: string;
  jobs: AISearchJob[];
  createdAt: string;
  status: 'processing' | 'complete' | 'cancelled';
  totalTokens: number;
}

// =============================================================================
// Command Palette Zero-State Types
// =============================================================================

/** A single CRM intelligence signal for the Cmd+K zero-state. */
export interface ZeroStateInsight {
  type: 'action_items' | 'at_risk' | 'ghost' | 'stale_data' | 'dedupe';
  label: string;
  count?: number;
  contact?: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  daysSince?: number;
  score?: number;
  mentionCount?: number;
}

/** Response payload from GET /api/command-palette/zero-state. */
export interface ZeroStatePayload {
  insights: ZeroStateInsight[];
}
