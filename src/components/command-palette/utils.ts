export function getMode(search: string): 'normal' | 'action' | 'ai' {
  const trimmed = search.trim();
  if (trimmed.startsWith('?')) return 'ai';
  if (trimmed.startsWith('>')) return 'action';
  return 'normal';
}

export const EXAMPLE_QUERIES = [
  'Who do I know in London working in FinTech?',
  'Who likes espresso?',
  "Who haven't I contacted in over 3 months?",
  'Who works at a startup as a designer?',
];
