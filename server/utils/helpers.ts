// =============================================================================
// Server Helpers — Lightweight Utilities
// =============================================================================
// This file is intentionally minimal. Domain logic has been extracted to:
//   - server/repositories/contactRepository.ts  (hydration + child persistence)
//   - server/utils/nlp/index.ts                       (name similarity, nicknames, etc.)
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
    'pronouns', 'industry', 'website', 'isArchived', 'aiBriefing', 'aiBriefingAt',
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

/**
 * Extract a human-readable error message from an unknown thrown value.
 *
 * TypeScript `catch` blocks receive `unknown` by default. This utility
 * provides a type-safe one-liner replacement for the `catch (err: unknown)`
 * anti-pattern used across the codebase.
 *
 * @example
 * ```ts
 * try { ... } catch (err: unknown) {
 *   log.error('context', getErrorMessage(err));
 * }
 * ```
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
