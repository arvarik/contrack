/**
 * The country calling codes with two digits (ITU E.164). `1` and `7` are the
 * only codes with one digit, and every other code has three. No code starts
 * another, so the first digits of an international number name its code.
 */
const TWO_DIGIT_CODES = new Set(
  "20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98".split(
    " ",
  ),
);

function countryCodeLength(digits: string): number {
  if (digits[0] === "1" || digits[0] === "7") return 1;
  return TWO_DIGIT_CODES.has(digits.slice(0, 2)) ? 2 : 3;
}

/**
 * The digits that name a phone number, for matching. A number written with
 * `+` or `00` loses its country code, and every number loses the leading 0 of
 * national dialing, so "+33 6 12 34 56 78", "0033 6 12 34 56 78" and
 * "06 12 34 56 78" all give "612345678". The last 10 digits stay, so a
 * national prefix such as the 1 of "1-415-555-1234" falls away too.
 */
export function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  const international = /^\D*\+/.test(phone) || digits.startsWith("00");
  if (international) {
    digits = digits.replace(/^00/, "");
    digits = digits.slice(countryCodeLength(digits));
  }
  digits = digits.replace(/^0+/, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Digits and the characters people type between them: `+ ( ) - .` and space. */
const PHONE_CHARACTERS = /^[\d+()\-. ]+$/;

/**
 * True when a query is a phone number: at least 7 digits, and nothing but
 * digits and `+()-. `. "+1 (415) 555-1234", "4155551234" and "555-1234" are;
 * "Suite 1200" and "555-12" are not.
 */
export function isPhoneQuery(text: string): boolean {
  const trimmed = text.trim();
  return (
    PHONE_CHARACTERS.test(trimmed) && (trimmed.match(/\d/g)?.length ?? 0) >= 7
  );
}
