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
// Each child entity has its own database table with a CASCADE FK to `contacts`.
// All `id` fields are server-issued UUIDv4 strings (`nanoid`-compatible).
// =============================================================================

/** A single email address attached to a contact. Multiple per contact allowed. */
export interface ContactEmail {
  /** Server-issued primary key. */
  id: string;
  /** RFC-5321 syntactically valid email address. Not validated for deliverability. */
  email: string;
  /** Free-form label such as `"work"`, `"personal"`, or the importer's tag. */
  label: string;
  /** True when this email should be presented as the contact's default. */
  isPrimary: boolean;
  /** Origin tag (`"linkedin"`, `"google"`, `"manual"`, etc.) or `null` if unknown. */
  source: string | null;
}

/** A single phone number attached to a contact. Stored as the original string. */
export interface ContactPhone {
  id: string;
  /** Raw phone string as entered/imported. Not normalized to E.164 in this type. */
  phone: string;
  label: string;
  isPrimary: boolean;
  source: string | null;
}

/** A social or professional URL with platform classification. */
export interface ContactSocialLink {
  id: string;
  /** Normalized platform tag (`"linkedin"`, `"twitter"`, `"github"`, …). */
  platform: string;
  url: string;
  /** Username/handle extracted from the URL when one is detectable. */
  handle: string | null;
  source: string | null;
}

/** A school / degree row from a contact's education history. */
export interface ContactEducation {
  id: string;
  school: string;
  degree: string | null;
  fieldOfStudy: string | null;
  /** ISO-8601 date string or `null` if unknown. */
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

/** A single job / role in a contact's work history. */
export interface ContactExperience {
  id: string;
  company: string;
  role: string | null;
  startDate: string | null;
  endDate: string | null;
  /** True for the contact's current job. Multiple `isCurrent: true` rows are allowed. */
  isCurrent: boolean;
  description: string | null;
  location: string | null;
}

/** A per-import provenance record — which platform did this contact come from. */
export interface ContactSource {
  id: string;
  platform: string;
  /** External system's stable ID for this contact (e.g. LinkedIn member URN). */
  externalId: string | null;
  /** When the relationship was originally formed on the source platform. */
  connectedOn: string | null;
  /** When this row was created in Contrack. */
  importedAt: string;
}

/** A free-form tag. Multiple tags per contact, no schema-enforced taxonomy. */
export interface ContactTag {
  id: string;
  tag: string;
}

/** A user-created list/group of contacts. */
export interface ContactList {
  id: string;
  name: string;
  /** Lucide icon name used for the list's chip rendering. */
  icon: string;
  /** Drag-and-drop order. Lower values appear first. */
  sortOrder: number;
  createdAt: string;
  /** Server-computed count of members; only populated when this list is fetched in list-mode. */
  memberCount?: number;
}

/** A postal address attached to a contact. */
export interface ContactAddress {
  id: string;
  address: string;
  label: string;
  isPrimary: boolean;
}

// =============================================================================
// Primary Entity Types
// =============================================================================

/**
 * The fully-hydrated contact shape returned by `GET /api/contacts/:id`.
 *
 * Mirror of {@link import("../../server/repositories/types").HydratedContact} —
 * if you change the server-side `HydratedContact`, update this interface too.
 *
 * Optional fields (`aiBriefing`, `aiSummary`, etc.) are present only on
 * single-contact responses. The list endpoint returns a `ContactSlim`
 * variant in `src/api/contacts.ts`.
 */
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
  interests: { id: string; interest: string; isAiGenerated?: boolean }[];
  attributes: { id: string; name: string; value: string }[];
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
export type ContactUpdateData = Partial<
  Omit<
    Contact,
    | "emails"
    | "phones"
    | "addresses"
    | "socialLinks"
    | "interests"
    | "attributes"
    | "education"
    | "experience"
    | "sources"
    | "tags"
    | "lists"
  >
> & {
  emails?: Partial<ContactEmail>[];
  phones?: Partial<ContactPhone>[];
  addresses?: Partial<ContactAddress>[];
  socialLinks?: Partial<ContactSocialLink>[];
  interests?: { id?: string; interest: string; isAiGenerated?: boolean }[];
  attributes?: { id?: string; name: string; value: string }[];
  tags?: Partial<ContactTag>[];
};

/**
 * A single entry on a contact's interaction timeline.
 *
 * `type` is intentionally a free-form string (not an enum) because the UI
 * recognizes a closed set but the import pipeline may inject custom types
 * (e.g. CSV import sources). Well-known values rendered by the UI:
 *   `note`, `call`, `meeting`, `email`, `message`, `sms`, `import`,
 *   `linkedin`, `facebook`.
 */
export interface Interaction {
  id: string;
  contactId: string;
  /** Well-known: `note`, `call`, `meeting`, `email`, `message`, `sms`, `import`, `linkedin`, `facebook`. */
  type: string;
  title: string;
  /** Tiptap-rendered HTML or raw text. Nullable for type-only entries (e.g. system imports). */
  content: string | null;
  /** ISO-8601 instant when the interaction occurred (NOT the row's insert time). */
  date: string;
  /** Human-formatted duration (`"42m"`, `"1h 5m"`). Stored as a string for free-form display. */
  duration: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  source?: string | null;
  /** JSON-encoded array of mentioned contact IDs. Decoded on the server side. */
  mentions?: string | null;
  /** When this interaction was created via a @mention, the displayed name of the mentioning contact. */
  isViaName?: string | null;
  /** When this interaction was created via a @mention, the ID of the mentioning contact. */
  isViaId?: string | null;
  updatedAt?: string | null;
  /** Linked follow-up tasks. Populated by joined queries; absent on the bare POST request. */
  actionItems?: {
    id: string;
    title: string;
    dueAt: string;
    completedAt: string | null;
  }[];
  /** Write-only — accepted by POST to create a linked action item in the same call. */
  actionItem?: { title: string; dueAt: string };
}

/**
 * A first-class follow-up task linked to a contact.
 *
 * Fields prefixed with `contact*` are joined from `contacts` and are only
 * populated on global-list endpoints (`GET /api/action-items`). The
 * per-contact endpoint returns the bare row.
 */
export interface ActionItem {
  id: string;
  contactId: string;
  title: string;
  /** ISO-8601 instant of the next planned outreach. */
  dueAt: string;
  /** `null` until completed. Once stamped, the row is hidden from the active queue. */
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
  matchType: "email" | "phone" | "ai";
  confidence: number;
  reasoning: string;
  matchedField?: string;
}

/** A single piece of evidence connecting two contacts within a cluster. */
export interface ClusterPair {
  contactIdA: string;
  contactIdB: string;
  matchType:
    | "email"
    | "phone"
    | "name"
    | "name_company"
    | "nickname"
    | "cross_source"
    | "fuzzy"
    | "ai";
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

export type DedupeScanMode =
  | "deterministic"
  | "ai"
  | "both"
  | "quick"
  | "deep"
  | "full";
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
  suggestions: DedupeSuggestion[]; // Deprecated — kept for backward compat only
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
 * A contact returned from a semantic AI search, augmented with the AI provider's
 * reasoning for why this contact matches the query.
 * `aiReason` is null when the FTS5 fallback path fires instead of the AI provider.
 */
export interface SemanticMatch extends Contact {
  aiReason: string | null;
}

/**
 * Full response envelope from POST /api/search/semantic.
 * `fallback: true` signals that the AI provider was unavailable and the results
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
export type AISearchJobStatus =
  | "queued"
  | "searching"
  | "merging"
  | "success"
  | "error";

/** Error classification for contextual UI messages. */
export type AISearchErrorType =
  | "rate_limit"
  | "validation"
  | "network"
  | "auth"
  | "ambiguous"
  | "unknown";

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
  status: "processing" | "complete" | "cancelled";
  totalTokens: number;
}

// =============================================================================
// Command Palette Zero-State Types
// =============================================================================

/** A single CRM intelligence signal for the Cmd+K zero-state. */
export interface ZeroStateInsight {
  type: "action_items" | "at_risk" | "ghost" | "stale_data" | "dedupe";
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
