/**
 * Shared fallback avatar URL builder for the frontend.
 *
 * When a contact has no `avatarUrl`, this points at the app's own avatar route,
 * which generates the SVG in-process (see server/services/avatarService).
 *
 * This used to return an `api.dicebear.com` URL with the contact's name in the
 * query string, so rendering the contact list announced the name of every
 * person the user knows to a third party — and broke entirely offline. Same
 * artwork, same deterministic faces, no request leaving the machine.
 */
export function fallbackAvatarUrl(name: string): string {
  return `/api/avatar/avataaars?seed=${encodeURIComponent(name)}`;
}
