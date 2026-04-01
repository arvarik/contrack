export interface Contact {
  id: string;
  name: string;
  role: string;
  company: string;
  email: string;
  phone: string;
  location: string;
  birthday: string;
  preferences: string;
  avatarUrl: string;
  isPremium: boolean;
  addedAt: string;
  sources?: string; // JSON string from DB
}

export interface Note {
  id: string;
  contactId: string;
  title: string;
  content: string;
  date: string;
}

export interface Activity {
  id: string;
  contactId: string;
  type: 'call' | 'proposal' | 'meeting' | 'email';
  title: string;
  date: string;
  duration?: string;
  details?: string;
}

export interface AIInsight {
  contactId: string;
  nextRecommendedContact: string;
  summarySentiment: string;
  sentimentDescription: string;
}
