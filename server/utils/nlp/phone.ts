// =============================================================================
// Phone Normalization
// =============================================================================

/** Strip all non-digits. Returns the last 10 digits to normalize country-code variants. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Digits and the characters people type between them: `+ ( ) - .` and space. */
const PHONE_CHARACTERS = /^[\d+()\-. ]+$/;

/**
 * True when a query is a phone number: at least 7 digits, and nothing but
 * digits and `+()-. ` in it. "+1 (415) 555-1234", "4155551234" and
 * "555-1234" are. "Suite 1200" and "555-12" are not.
 */
export function isPhoneQuery(text: string): boolean {
  const trimmed = text.trim();
  return (
    PHONE_CHARACTERS.test(trimmed) && (trimmed.match(/\d/g)?.length ?? 0) >= 7
  );
}
