/**
 * useSingleKeyShortcuts — whether printable single-key shortcuts are active.
 *
 * Bare-letter shortcuts (like '/', 'h', 'n') can be triggered by stray keystrokes.
 * Defaults to true.
 *
 * @module hooks/useSingleKeyShortcuts
 */

export function useSingleKeyShortcuts(): boolean {
  return true;
}
