// =============================================================================
// Server Helpers — Lightweight Utilities
// =============================================================================
// This file is intentionally minimal. Domain logic has been extracted to:
//   - server/repositories/contactRepository.ts  (hydration + child persistence)
//   - server/utils/nlp.ts                       (name similarity, nicknames, etc.)
//
// URL utilities (detectPlatformFromUrl, extractHandleFromUrl) live in
// contactRepository.ts — the sole consumer.
// =============================================================================

/** Map request body to contacts table columns. Always stamps updatedAt. */
export function buildContactUpdate(body: Record<string, unknown>) {
  const fields = [
    'name', 'firstName', 'lastName', 'headline', 'role', 'company',
    'location', 'birthday', 'preferences', 'avatarUrl', 'cadenceDays',
    'lastContactedAt', 'nextFollowUpAt', 'themeColor', 'about',
    'pronouns', 'industry', 'website', 'isArchived', 'aiBriefing',
    'aiBackground', 'aiSummary', 'aiHydratedAt',
  ] as const;

  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const f of fields) {
    if (body[f] !== undefined) {
      // SQLite can't bind JS booleans — coerce to 0/1
      update[f] = typeof body[f] === 'boolean' ? (body[f] ? 1 : 0) : body[f];
    }
  }
  return update;
}
