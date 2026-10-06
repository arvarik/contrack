/**
 * Shared Frontend Type Definitions.
 *
 * The JSON shapes React components and React Query hooks read. A resource
 * with a contract in `shared/contracts/` takes its type from there, under the
 * name the app has always used, so the server's answer and the app's type
 * cannot drift apart. The rest are written here by hand.
 *
 * @see {@link file://shared/contracts/index.ts} — the contracts
 */

import type { MatchedOn } from "../shared/matchedOn";
import type { RefineOption } from "../shared/facetQuery";
import type {
  ActionItem as ActionItemContract,
  QueuedActionItem,
} from "../shared/contracts/actionItems";
import type {
  Contact as ContactContract,
  ContactAddress,
  ContactEducation,
  ContactEmail,
  ContactExperience,
  ContactPhone,
  ContactSocialLink,
} from "../shared/contracts/contacts";
import type {
  Interaction as InteractionContract,
  InteractionSearchHit,
  TimelineEntry,
} from "../shared/contracts/interactions";

export type {
  ContactAddress,
  ContactEducation,
  ContactExperience,
  ContactSocialLink,
};
export type { ContactList } from "../shared/contracts/lists";

// =============================================================================
// Primary Entity Types
// =============================================================================

/**
 * A contact as the app holds it: the whole contact that
 * `GET /api/contacts/:id` sends (`Contact` in shared/contracts/contacts.ts),
 * and the fields that only the list view and the search answers add.
 *
 * Two fields keep the type the views have always read. The server sends
 * `cadenceDays: null` and `themeColor: null` after a write that sent null,
 * and the views read a number and a string, so the hooks in `src/api/` cast
 * the contract's contact to this one at the fetch.
 *
 * The app keeps the list view's rows as Contacts too, although the server
 * sends them with fewer fields (`SlimContact`): see `fetchContactsSlim`.
 */
export type Contact = Omit<
  ContactContract,
  "cadenceDays" | "themeColor" | "archivedAt"
> & {
  cadenceDays: number;
  themeColor: string;
  /** When it was archived. The full contact has it, a list row does not. */
  archivedAt?: string | null;
  /** The list view: how many social links the contact has. */
  socialLinkCount?: number;
  /** The list view: the last research run's outcome, or null before any run. */
  researchOutcome?: "added" | "nothing-new" | "no-public-info" | null;
  /** True when returned via approximate/fuzzy matching rather than exact FTS5 match */
  approximate?: boolean;
  matchType?: "exact" | "approximate";
};

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
  /**
   * The contact page sends its interests back as it got them, with the flag
   * as the server sends it: 0 or 1.
   */
  interests?: {
    id?: string;
    interest: string;
    isAiGenerated?: boolean | number | null;
  }[];
  attributes?: { id?: string; name: string; value: string }[];
  tags?: { id?: string; tag?: string }[];
  education?: Partial<ContactEducation>[];
  experience?: Partial<ContactExperience>[];
};

/**
 * AI-parsed contact fields returned by POST /api/parse-contact (Magic Paste).
 * Child entries are partial — the parser omits ids and unknown fields.
 */
export interface ParsedContactData extends Partial<
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
> {
  /** Flat convenience fields present in some parser responses. */
  email?: string;
  phone?: string;
  emails?: Partial<ContactEmail>[];
  phones?: Partial<ContactPhone>[];
  socialLinks?: Partial<ContactSocialLink>[];
  education?: Partial<ContactEducation>[];
  experience?: Partial<ContactExperience>[];
}

/**
 * An interaction as the app holds it: the row every interaction route sends
 * (`Interaction` in shared/contracts/interactions.ts), with what the
 * timeline adds to each entry.
 *
 * `type` is a free-form string. Well-known values the UI renders: `note`,
 * `call`, `meeting`, `email`, `message`, `sms`, `import`, `linkedin`,
 * `facebook`.
 */
export type Interaction = InteractionContract &
  Partial<Pick<TimelineEntry, "isViaName" | "isViaId" | "actionItems">> & {
    /**
     * Write-only: `POST /api/contacts/:id/interactions` makes this follow-up
     * in the same write as the note.
     */
    actionItem?: { title: string; dueAt: string };
  };

/**
 * A follow-up task linked to a contact (`ActionItem` in
 * shared/contracts/actionItems.ts).
 *
 * The `contact*` fields come only with the account's queue
 * (`GET /api/action-items` and `/completed`). One contact's own items are the
 * bare row. `interactionId` and `ownerId` stay optional because the Pulse
 * payload of `GET /api/dashboard`, which has no contract yet, types its items
 * by this one too.
 */
export type ActionItem = Omit<ActionItemContract, "interactionId" | "ownerId"> &
  Partial<Pick<ActionItemContract, "interactionId" | "ownerId">> &
  Partial<
    Pick<
      QueuedActionItem,
      | "contactName"
      | "contactCompany"
      | "contactAvatarUrl"
      | "contactThemeColor"
    >
  >;

// =============================================================================
// Dedupe Engine Types
// =============================================================================

/**
 * A persisted dedupe suggestion row from /api/dedupe/suggestions.
 * Mirrors the server's DedupeSuggestion (server/services/dedupe/suggestions.ts).
 */
export interface PersistedDedupeSuggestion {
  id: string;
  contactIdA: string;
  contactIdB: string;
  matchType: string;
  confidence: number;
  /** Why the two look like one person, in plain words. */
  reasoning: string;
  /**
   * Why a person should look twice, or null: "First names differ: Ada and
   * Ben". Older rows kept it at the end of `reasoning`.
   */
  caveat?: string | null;
  matchedField: string | null;
  status: "pending" | "auto_merged" | "merged" | "dismissed";
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  contactA?: SuggestedContact | null;
  contactB?: SuggestedContact | null;
}

/** A contact in a suggestion, with its open follow-ups counted. */
export type SuggestedContact = Contact & { openFollowUpCount?: number };

/** A trashed (soft-deleted) contact row from /api/trash. */
export interface TrashedContact {
  id: string;
  name: string;
  company: string | null;
  avatarUrl: string | null;
  deletedAt: string;
}

/** A merge audit-log row from /api/dedupe/merge-log. */
export interface MergeLogEntry {
  id: string;
  primaryId: string;
  duplicateId: string;
  mergedBy: string;
  mergeType: string;
  confidence: number;
  reasoning: string;
  mergedAt: string;
  undoneAt: string | null;
  duplicateSnapshot: string | null;
  primaryName?: string;
  duplicateName?: string;
  /** What tells two entries for one name apart. */
  primaryCompany?: string | null;
  primaryLocation?: string | null;
  duplicateCompany?: string | null;
  duplicateLocation?: string | null;
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
  /** Exact evidence for a passage match. The server checks the contact and source revision. */
  aiEvidence?: {
    contactId: string;
    passageId: string;
    field: string;
    sourceId: string;
    sourceHash: string;
    startOffset: number;
    endOffset: number;
    quote: string;
  };
  aiReason: string | null;
  /** True when an exact answer, the model or a filter proved it. Older servers omit it. */
  verified?: boolean;
  /**
   * The fields that answer the question, most telling first, with the
   * question's words marked. Empty for a name, an email or a phone number,
   * which the card shows anyway.
   */
  matchedOn?: MatchedOn[];
}

/**
 * Full response envelope from POST /api/search/semantic.
 * `fallback: true` signals that the model did not verify this list: the
 * instant local list, or a final list when AI was off, failed or timed out.
 */
export interface SemanticSearchResult {
  /**
   * The question these matches answer, exactly as it was sent.
   *
   * Written by the client, not the server: `useSemanticSearch` stamps it on
   * every chunk it stores. It lives on the result rather than beside it so a
   * result set can never be shown under a question it did not answer. The
   * synthesis brief reads this, never the editable input.
   */
  query: string;
  matches: SemanticMatch[];
  fallback: boolean;
  tokensUsed?: number;
  /**
   * For a question of facets alone, how many contacts they hold. The list
   * stops at 30, and "Who do I track?" can hold thousands.
   */
  total?: number;
  /** For a question of facets alone, the same list as a Network query. */
  facets?: string;
  /** For a question of facets alone, cut at 30: the facets that split it. */
  refine?: RefineOption[];
}

// =============================================================================
// AI Search Types
// =============================================================================

export type { AISearchBatch, AISearchJob } from "../shared/aiSearchContract";

// =============================================================================
// Command Palette Zero-State Types
// =============================================================================

/** A single CRM intelligence signal for the Cmd+K zero-state. */
export interface ZeroStateInsight {
  type: "action_items" | "catch_up" | "ghost" | "stale_data" | "dedupe";
  label: string;
  count?: number;
  contact?: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  /** A catch-up: days since the clock, and how far past the cadence. */
  daysSince?: number;
  overshootDays?: number;
  mentionCount?: number;
}

/** Response payload from GET /api/command-palette/zero-state. */
export interface ZeroStatePayload {
  insights: ZeroStateInsight[];
}

// =============================================================================
// Interaction Search Types — GET /api/search/interactions
// =============================================================================

/** Start and end offsets of a matched term, in UTF-16 code units. */
export type HighlightRange = [number, number];

/**
 * One note that answered a search: the person, the date, and the passage.
 * `GET /api/interactions/search` has its contract, and this route sends the
 * same hits.
 */
export type { InteractionSearchHit };

/** The period a search was limited to, and where it came from. */
interface InteractionSearchRange {
  /** ISO instant, inclusive. Null when open at this end. */
  from: string | null;
  /** ISO instant, exclusive. Null when open at this end. */
  to: string | null;
  /** `filter` when the caller set it, `phrase` when the question named it. */
  source: "filter" | "phrase";
}

/** Response envelope from GET /api/search/interactions. */
export interface InteractionSearchResult {
  query: {
    /** The words that went to the index, after the date phrase came out. */
    text: string;
    tokens: string[];
    /** `all` words, `any` word, or `none` when the search is a date browse. */
    mode: "all" | "any" | "none";
    /** The words read as a period, when the question named one. */
    phrase: string | null;
    range: InteractionSearchRange | null;
    timeZone: string;
  };
  total: number;
  limit: number;
  offset: number;
  hits: InteractionSearchHit[];
}
