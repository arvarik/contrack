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
}

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
}



// =============================================================================
// Dedupe Engine Types
// =============================================================================

export interface DedupeSuggestion {
  id: string;
  contactA: Contact;
  contactB: Contact;
  matchType: 'email' | 'phone' | 'ai';
  confidence: number;
  reasoning: string;
  matchedField?: string;
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
