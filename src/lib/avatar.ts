/**
 * Shared fallback avatar URL builder for the frontend.
 *
 * When a contact has no `avatarUrl`, this generates a consistent
 * DiceBear avataaars URL with emoji-yellow skin tone.
 *
 * Centralised here so all components use the same defaults and
 * version — avoids the DRY violation of 17 inline template strings.
 */
export function fallbackAvatarUrl(name: string): string {
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(name)}&mouth=default,smile,serious&skinColor=f8d25c`;
}
