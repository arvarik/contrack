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
  isPremium: boolean;
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
  // Relations (populated by server JOINs)
  emails: ContactEmail[];
  phones: ContactPhone[];
  socialLinks: ContactSocialLink[];
  education: ContactEducation[];
  experience: ContactExperience[];
  sources: ContactSource[];
  tags: ContactTag[];
}

export interface Interaction {
  id: string;
  contactId: string;
  type: 'note' | 'call' | 'meeting' | 'email' | 'message' | 'sms' | 'import' | 'linkedin' | 'facebook';
  title: string;
  content: string | null;
  date: string;
  duration: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  source?: string | null;
}

export interface AIInsight {
  contactId: string;
  nextRecommendedContact: string;
  summarySentiment: string;
  sentimentDescription: string;
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
