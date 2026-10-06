/**
 * errorText: the words of an error, for a person to read.
 *
 * Every error toast is "Could not <act>: <the reason>". The reason is the
 * error's message, which for an `ApiError` is the server's own sentence. A
 * server sentence often ends with a period, and a statement on screen ends
 * without one (`.agent/STYLE.md`, "Type"), so the period goes. Thirty call
 * sites wrote `err instanceof Error ? err.message : String(err)` by hand,
 * and only two of them dropped the period.
 *
 * @module lib/errorText
 */

/**
 * The message of an error, without a closing period.
 *
 * @param err - What a promise rejected with, or a `catch` caught.
 * @param fallback - The words for a value that is not an `Error`. The
 *   default is the value as a string.
 * @returns The reason, ready to follow "Could not <act>: ".
 * @example toast.error(`Could not restore ${name}: ${errorText(err)}`)
 */
export function errorText(err: unknown, fallback?: string): string {
  const text = err instanceof Error ? err.message : (fallback ?? String(err));
  return text.replace(/\.$/, "");
}
