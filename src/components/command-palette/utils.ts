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

/** cmdk group heading style — reused across all Command.Group instances */
export const GROUP_HEADING =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest";

/** Group heading color variants */
export const GROUP_HEADING_DEFAULT = `${GROUP_HEADING} [&_[cmdk-group-heading]]:text-on-surface-variant`;
export const GROUP_HEADING_PRIMARY = `${GROUP_HEADING} [&_[cmdk-group-heading]]:text-primary`;
export const GROUP_HEADING_EMERALD = `${GROUP_HEADING} [&_[cmdk-group-heading]]:text-emerald-500`;

/** Strip the mode prefix from a search query for display purposes */
export function stripModePrefix(query: string): string {
  return query.replace(/^[?>]\s*/, '').trim();
}
